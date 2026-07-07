import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock heavy/dynamic deps before importing the module under test.
const mockSeparate = vi.fn();
const mockLoadModel = vi.fn();
vi.mock('demucs-web', () => ({
  DemucsProcessor: class {
    onProgress: (e: unknown) => void;
    constructor(opts: { onProgress?: (e: unknown) => void }) {
      this.onProgress = opts?.onProgress || (() => {});
    }
    loadModel = mockLoadModel;
    separate = (...args: unknown[]) => {
      // emit one progress event like the real processor does per segment
      this.onProgress({ progress: 0.5, currentSegment: 1, totalSegments: 2 });
      return mockSeparate(...args);
    };
  },
  CONSTANTS: {
    DEFAULT_MODEL_URL: 'https://huggingface.co/timcsy/demucs-web-onnx/resolve/main/htdemucs_embedded.onnx',
  },
}));
vi.mock('onnxruntime-web', () => ({ env: { wasm: {} } }));

const mockGetAsset = vi.fn();
const mockSaveAsset = vi.fn();
vi.mock('./assetManager', () => ({
  getAsset: (...a: unknown[]) => mockGetAsset(...a),
  saveAsset: (...a: unknown[]) => mockSaveAsset(...a),
}));

import {
  detectBrowserStemsSupport,
  isBrowserModelCached,
  downloadBrowserModel,
  separateInBrowser,
  BROWSER_STEM_MAP,
} from './browserStems';

const stemChannels = () => ({ left: new Float32Array(4), right: new Float32Array(4) });

class MockOfflineAudioContext {
  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = Array.from({ length: channels }, () => new Float32Array(length));
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: (i: number) => data[i],
      copyToChannel: (src: Float32Array, i: number) => data[i].set(src.subarray(0, length)),
    };
  }
}

const makeSourceBuffer = (sampleRate = 44100, channels = 2) => {
  const ctx = new MockOfflineAudioContext();
  return ctx.createBuffer(channels, 8, sampleRate) as unknown as AudioBuffer;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('OfflineAudioContext', MockOfflineAudioContext);
  vi.stubGlobal('crossOriginIsolated', true);
  vi.stubGlobal('navigator', { gpu: {}, hardwareConcurrency: 8 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('browserStems', () => {
  it('detects WebGPU and threaded-WASM capability', () => {
    expect(detectBrowserStemsSupport()).toEqual({ supported: true, webgpu: true, threads: true });

    vi.stubGlobal('navigator', { hardwareConcurrency: 8 }); // no gpu
    vi.stubGlobal('crossOriginIsolated', false);
    const s = detectBrowserStemsSupport();
    expect(s.supported).toBe(false); // neither accelerator path
    expect(s.webgpu).toBe(false);

    vi.stubGlobal('crossOriginIsolated', true); // threads only
    expect(detectBrowserStemsSupport()).toMatchObject({ supported: true, webgpu: false, threads: true });
  });

  it('reports model cache state via the asset store', async () => {
    mockGetAsset.mockResolvedValueOnce(null);
    expect(await isBrowserModelCached()).toBe(false);
    mockGetAsset.mockResolvedValueOnce(new Blob(['model']));
    expect(await isBrowserModelCached()).toBe(true);
  });

  it('downloads the model with streaming progress and persists it', async () => {
    const chunk = new Uint8Array(50);
    let read = 0;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => '100' },
      body: {
        getReader: () => ({
          read: async () =>
            read++ < 2 ? { done: false, value: chunk } : { done: true, value: undefined },
        }),
      },
    }));

    const progress: number[] = [];
    await downloadBrowserModel((p) => progress.push(p));

    expect(mockSaveAsset).toHaveBeenCalledWith(
      'demucs_web_htdemucs_embedded_v1',
      expect.any(Blob),
    );
    expect(progress).toContain(50);
    expect(progress[progress.length - 1]).toBe(100);
  });

  it('separates on-device and maps demucs stems to JAAD instruments', async () => {
    mockGetAsset.mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(8) });
    mockSeparate.mockResolvedValue({
      drums: stemChannels(),
      bass: stemChannels(),
      other: stemChannels(),
      vocals: stemChannels(),
    });

    const steps: string[] = [];
    const results = await separateInBrowser(makeSourceBuffer(), ['Vocals', 'Drums'], (_p, s) =>
      steps.push(s),
    );

    expect(mockLoadModel).toHaveBeenCalledWith(expect.any(ArrayBuffer));
    expect(results.map((r) => r.instrument)).toEqual(['Vocals', 'Drums']);
    expect(results[0].buffer.numberOfChannels).toBe(2);
    expect(results[0].buffer.sampleRate).toBe(44100);
    expect(steps.some((s) => s.includes('WebGPU'))).toBe(true);
  });

  it('returns [] without loading anything when no browser-capable stems are requested', async () => {
    const results = await separateInBrowser(makeSourceBuffer(), ['Strings', 'FX']);
    expect(results).toEqual([]);
    expect(mockLoadModel).not.toHaveBeenCalled();
    expect(BROWSER_STEM_MAP['Strings']).toBeUndefined();
  });

  it('throws a clear error when the model has not been downloaded', async () => {
    mockGetAsset.mockResolvedValue(null);
    await expect(separateInBrowser(makeSourceBuffer(), ['Vocals'])).rejects.toThrow(
      /not downloaded/,
    );
  });
});
