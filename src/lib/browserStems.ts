/**
 * In-browser Demucs stem separation — WebGPU with WASM(threads) fallback.
 *
 * The middle tier of the separation ladder (ADR-0010): when no self-hosted
 * Demucs server is reachable, run the real HT-Demucs model on the *user's own
 * device* via `demucs-web` + onnxruntime-web. WebGPU is used when available,
 * otherwise multithreaded WASM (requires cross-origin isolation, which JAAD's
 * COOP/COEP headers provide). The ~172MB ONNX model is downloaded once and
 * cached in the local asset store (OPFS/IndexedDB).
 *
 * Heavy deps (`demucs-web`, `onnxruntime-web`) are dynamic-imported so they
 * code-split out of the main bundle.
 */

import { saveAsset, getAsset } from './assetManager';

// Vite bundles onnxruntime-web's runtime assets from node_modules and returns
// hashed same-origin URLs — required because CSP script-src is 'self' (no CDN).
// The .jsep build is the WebGPU-enabled one. Imported via explicit node_modules
// paths because the package's `exports` field does not expose ./dist/*.
import ortJsepWasmUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url';
import ortJsepMjsUrl from '../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url';

/** JAAD instrument labels the in-browser 4-stem model can truly separate. */
export const BROWSER_STEM_MAP: Record<string, 'vocals' | 'drums' | 'bass' | 'other'> = {
  Vocals: 'vocals',
  Drums: 'drums',
  Bass: 'bass',
};

export const BROWSER_MODEL_SIZE_MB = 172;
const MODEL_ASSET_ID = 'demucs_web_htdemucs_embedded_v1';
const MODEL_SAMPLE_RATE = 44100;

export interface BrowserStemsSupport {
  /** Feasible at all on this device/browser. */
  supported: boolean;
  /** WebGPU available (fast path). */
  webgpu: boolean;
  /** Multithreaded WASM available (crossOriginIsolated). */
  threads: boolean;
}

/** Capability probe — cheap and synchronous, safe to call every render. */
export function detectBrowserStemsSupport(): BrowserStemsSupport {
  const webgpu =
    typeof navigator !== 'undefined' && 'gpu' in navigator && !!(navigator as { gpu?: unknown }).gpu;
  const threads = typeof crossOriginIsolated !== 'undefined' && crossOriginIsolated === true;
  const wasmOk = typeof WebAssembly !== 'undefined';
  // Single-threaded WASM technically works but is painfully slow for a
  // transformer — only offer the tier when a real accelerator path exists.
  return { supported: wasmOk && (webgpu || threads), webgpu, threads };
}

/** Has the ONNX model already been downloaded into the local asset store? */
export async function isBrowserModelCached(): Promise<boolean> {
  try {
    return !!(await getAsset(MODEL_ASSET_ID));
  } catch {
    return false;
  }
}

/**
 * One-time model download (from the demucs-web HuggingFace repo) with streaming
 * progress, persisted via the normal asset store so refreshes don't re-download.
 */
export async function downloadBrowserModel(onProgress?: (pct: number) => void): Promise<void> {
  const { CONSTANTS } = await import('demucs-web');
  const res = await fetch(CONSTANTS.DEFAULT_MODEL_URL);
  if (!res.ok || !res.body) {
    throw new Error(`Model download failed (${res.status})`);
  }
  const total = parseInt(res.headers.get('content-length') || '0', 10);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    if (total > 0) onProgress?.(Math.min(99, Math.round((received / total) * 100)));
  }
  const blob = new Blob(chunks as BlobPart[], { type: 'application/octet-stream' });
  await saveAsset(MODEL_ASSET_ID, blob);
  onProgress?.(100);
}

/** Resample/upmix any AudioBuffer to the stereo 44.1kHz the model expects. */
async function toModelChannels(
  buffer: AudioBuffer,
): Promise<{ left: Float32Array; right: Float32Array }> {
  if (buffer.sampleRate === MODEL_SAMPLE_RATE && buffer.numberOfChannels >= 2) {
    return { left: buffer.getChannelData(0), right: buffer.getChannelData(1) };
  }
  const length = Math.ceil(buffer.duration * MODEL_SAMPLE_RATE);
  const ctx = new OfflineAudioContext(2, length, MODEL_SAMPLE_RATE);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  const rendered = await ctx.startRendering();
  return { left: rendered.getChannelData(0), right: rendered.getChannelData(1) };
}

export interface BrowserStemResult {
  /** JAAD instrument label (e.g. "Vocals") */
  instrument: string;
  /** Separated stereo stem at 44.1kHz */
  buffer: AudioBuffer;
}

/**
 * Separate `source` on this device. Only instruments present in
 * BROWSER_STEM_MAP are produced. Progress: 0-8 prep, 8-95 separation, 100 done.
 */
export async function separateInBrowser(
  source: AudioBuffer,
  instruments: string[],
  onProgress?: (pct: number, step: string) => void,
): Promise<BrowserStemResult[]> {
  const wanted = instruments.filter((i) => BROWSER_STEM_MAP[i]);
  if (wanted.length === 0) return [];

  const support = detectBrowserStemsSupport();
  if (!support.supported) {
    throw new Error('This browser cannot run on-device separation (needs WebGPU or cross-origin isolation)');
  }

  onProgress?.(1, 'Loading on-device AI model...');
  const cachedModel = await getAsset(MODEL_ASSET_ID);
  if (!cachedModel) {
    throw new Error('On-device model not downloaded yet');
  }

  const [{ DemucsProcessor }, ort] = await Promise.all([
    import('demucs-web'),
    import('onnxruntime-web'),
  ]);

  // Serve ort's runtime from our own origin (CSP: script-src 'self').
  (ort.env.wasm as { wasmPaths?: unknown }).wasmPaths = {
    wasm: ortJsepWasmUrl,
    mjs: ortJsepMjsUrl,
  };
  if (support.threads && typeof navigator !== 'undefined') {
    ort.env.wasm.numThreads = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
  } else {
    ort.env.wasm.numThreads = 1;
  }

  const label = support.webgpu ? 'WebGPU' : 'WASM';
  const processor = new DemucsProcessor({
    ort,
    onProgress: (p: { progress?: number; currentSegment?: number; totalSegments?: number }) => {
      const pct = 8 + Math.round((p.progress || 0) * 87);
      onProgress?.(
        Math.min(95, pct),
        `Separating on this device (${label}) — segment ${p.currentSegment ?? '?'}/${p.totalSegments ?? '?'}...`,
      );
    },
  });

  await processor.loadModel(await cachedModel.arrayBuffer());
  onProgress?.(6, 'Preparing audio...');
  const { left, right } = await toModelChannels(source);

  const stems = await processor.separate(left, right);

  const results: BrowserStemResult[] = [];
  for (const instrument of wanted) {
    const stem = stems[BROWSER_STEM_MAP[instrument]];
    if (!stem) continue;
    const out = new OfflineAudioContext(2, 1, MODEL_SAMPLE_RATE).createBuffer(
      2,
      stem.left.length,
      MODEL_SAMPLE_RATE,
    );
    out.copyToChannel(stem.left, 0);
    out.copyToChannel(stem.right, 1);
    results.push({ instrument, buffer: out });
  }
  onProgress?.(100, 'Done');
  return results;
}
