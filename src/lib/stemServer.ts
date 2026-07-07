/**
 * Client for the self-hosted Demucs stem-separation sidecar (docker-demucs).
 *
 * Flow: POST /separate (WAV upload) -> poll GET /jobs/{id} -> download each
 * stem WAV. The server runs Meta's Demucs (htdemucs) — real ML source
 * separation, the same model family behind commercial stem tools — as opposed
 * to the local biquad-filter approximation in stemSeparation.ts.
 */

/** Demucs stem names by model. htdemucs_6s adds guitar + piano. */
export const DEMUCS_4S = ['vocals', 'drums', 'bass', 'other'] as const;
export const DEMUCS_6S = [...DEMUCS_4S, 'guitar', 'piano'] as const;

/** Map JAAD's instrument labels to Demucs stems (only true AI targets). */
export const DEMUCS_STEM_MAP: Record<string, string> = {
  Vocals: 'vocals',
  Drums: 'drums',
  Bass: 'bass',
  Guitar: 'guitar',
  Keyboard: 'piano',
};

export interface RemoteStem {
  /** JAAD instrument label (e.g. "Vocals") */
  instrument: string;
  /** WAV audio returned by the server */
  blob: Blob;
}

export const getStemServerUrl = (): string =>
  (typeof localStorage !== 'undefined' && localStorage.getItem('jaad_stems_url')) ||
  'http://localhost:8000';

export const setStemServerUrl = (url: string) => {
  localStorage.setItem('jaad_stems_url', url);
};

const authHeaders = (): Record<string, string> => {
  const token =
    typeof localStorage !== 'undefined' ? localStorage.getItem('jaad_stems_token') : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

/** Quick reachability probe so the UI can show AI vs. filter mode honestly. */
export async function checkStemServer(timeoutMs = 2500): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const res = await fetch(`${getStemServerUrl()}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const body = await res.json().catch(() => null);
    return !!body && body.ok === true;
  } catch {
    return false;
  }
}

/**
 * Separate `wav` into stems on the server and return the requested instruments.
 * `instruments` must be keys of DEMUCS_STEM_MAP. Progress: 0..100
 * (5 = uploaded, 5-90 = separation, 90-100 = stem downloads).
 */
export async function separateViaServer(
  wav: Blob,
  instruments: string[],
  onProgress?: (pct: number, step: string) => void,
): Promise<RemoteStem[]> {
  const base = getStemServerUrl();
  const wanted = instruments.filter((i) => DEMUCS_STEM_MAP[i]);
  if (wanted.length === 0) return [];

  // 6-stem model only when guitar/piano are actually requested (the 4-stem
  // model separates vocals/drums/bass slightly better).
  const needs6s = wanted.some((i) => ['guitar', 'piano'].includes(DEMUCS_STEM_MAP[i]));
  const model = needs6s ? 'htdemucs_6s' : 'htdemucs';

  onProgress?.(1, 'Uploading audio to stem server...');
  const form = new FormData();
  form.append('file', wav, 'input.wav');
  form.append('model', model);

  const submit = await fetch(`${base}/separate`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });
  if (!submit.ok) {
    throw new Error(`Stem server rejected the upload (${submit.status})`);
  }
  const { job_id: jobId } = await submit.json();
  onProgress?.(5, 'Separating with Demucs AI...');

  // Poll until done. Long songs on CPU can take minutes — cap generously.
  const started = Date.now();
  const timeoutMs = 30 * 60 * 1000;
  for (;;) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Stem separation timed out');
    }
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(`${base}/jobs/${jobId}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`Stem server job check failed (${res.status})`);
    const job = await res.json();
    if (job.status === 'error') {
      throw new Error(job.error || 'Stem separation failed on the server');
    }
    onProgress?.(5 + Math.round((job.progress || 0) * 85), 'Separating with Demucs AI...');
    if (job.status === 'done') break;
  }

  // Download the stems we asked for.
  const results: RemoteStem[] = [];
  for (let i = 0; i < wanted.length; i++) {
    const instrument = wanted[i];
    const stemName = DEMUCS_STEM_MAP[instrument];
    onProgress?.(90 + Math.round(((i + 1) / wanted.length) * 10), `Downloading ${instrument}...`);
    const res = await fetch(`${base}/jobs/${jobId}/stem/${stemName}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`Failed to download ${instrument} stem (${res.status})`);
    results.push({ instrument, blob: await res.blob() });
  }

  // Fire-and-forget server-side cleanup of the job's temp files.
  fetch(`${base}/jobs/${jobId}`, { method: 'DELETE', headers: authHeaders() }).catch(() => {});
  return results;
}
