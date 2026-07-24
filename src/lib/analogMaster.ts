/**
 * Analog Character Master Rack
 * ────────────────────────────
 * A genuine mastering/analog-character processor for making dull, band-limited
 * sources (e.g. AI-generated audio) sound fuller and more natural. NOT a detector
 * tool — this is quality DSP: harmonic restoration, tape warmth, width, tone.
 *
 * Signal chain (per render):
 *   tone shelves (warmth low / air high) → spectral HF exciter → tape saturation
 *   → stereo width → dry/wet mix → output gain
 *
 * The **exciter** is an STFT process (analysis FFT → spectral band replication
 * above the rolloff → synthesis IFFT), batched through the WebGPU FFT accelerator
 * in gpuFFT.ts — so it runs on the GPU when one is available (with a transparent
 * optimized-CPU fallback), which is where a discrete GPU actually earns its keep.
 */

import { getGPUFFTAccelerator } from './gpuFFT';

export interface AnalogMasterSettings {
  /** Dry/wet blend, 0..1 (1 = fully processed). */
  mix: number;
  /** Tape/tube harmonic drive, 0..1. */
  saturation: number;
  /** Spectral high-frequency restoration amount, 0..1. */
  exciter: number;
  /** Crossover (Hz) above which the exciter synthesizes air. */
  exciterFreq: number;
  /** Stereo width, 0..2 (1 = unchanged, <1 narrower, >1 wider). */
  width: number;
  /** High-shelf "air" boost, 0..1. */
  air: number;
  /** Low-shelf "warmth" boost, 0..1. */
  warmth: number;
  /** Dynamic de-harsher amount — tames 3–8 kHz "musical noise" that source
   *  separation leaves behind (the tinny/harsh AI-stem tell), 0..1. */
  deHarsh: number;
  /** Output makeup gain (linear). */
  outputGain: number;
}

export const ANALOG_MASTER_DEFAULTS: AnalogMasterSettings = {
  mix: 1,
  saturation: 0.28,
  exciter: 0.35,
  exciterFreq: 7000,
  width: 1.12,
  air: 0.3,
  warmth: 0.2,
  deHarsh: 0.25,
  outputGain: 1,
};

export const ANALOG_MASTER_PRESETS: Record<string, AnalogMasterSettings> = {
  'Subtle Glue': { mix: 0.8, saturation: 0.18, exciter: 0.2, exciterFreq: 8000, width: 1.05, air: 0.18, warmth: 0.15, deHarsh: 0.15, outputGain: 1 },
  'Warm Tape': { mix: 1, saturation: 0.45, exciter: 0.25, exciterFreq: 7500, width: 1.08, air: 0.2, warmth: 0.4, deHarsh: 0.2, outputGain: 1 },
  'Air & Sheen': { mix: 1, saturation: 0.22, exciter: 0.6, exciterFreq: 6000, width: 1.15, air: 0.5, warmth: 0.12, deHarsh: 0.3, outputGain: 1 },
  'Wide Master': { mix: 1, saturation: 0.3, exciter: 0.4, exciterFreq: 7000, width: 1.4, air: 0.35, warmth: 0.2, deHarsh: 0.25, outputGain: 1 },
  'Vocal Rescue': { mix: 1, saturation: 0.18, exciter: 0.45, exciterFreq: 6500, width: 1.05, air: 0.4, warmth: 0.18, deHarsh: 0.6, outputGain: 1 },
  'Bass Warmth': { mix: 1, saturation: 0.35, exciter: 0.12, exciterFreq: 9000, width: 0.85, air: 0.1, warmth: 0.5, deHarsh: 0.1, outputGain: 1 },
};

// ── Windowing ──────────────────────────────────────────────────────────────
function hannWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

// ── Biquad shelves (RBJ cookbook) ──────────────────────────────────────────
type Biquad = { b0: number; b1: number; b2: number; a1: number; a2: number };

function lowShelf(sampleRate: number, freq: number, gainDb: number): Biquad {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const S = 0.9;
  const alpha = (sin / 2) * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2);
  const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
  const b0 = A * (A + 1 - (A - 1) * cos + twoSqrtAAlpha);
  const b1 = 2 * A * (A - 1 - (A + 1) * cos);
  const b2 = A * (A + 1 - (A - 1) * cos - twoSqrtAAlpha);
  const a0 = A + 1 + (A - 1) * cos + twoSqrtAAlpha;
  const a1 = -2 * (A - 1 + (A + 1) * cos);
  const a2 = A + 1 + (A - 1) * cos - twoSqrtAAlpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function highShelf(sampleRate: number, freq: number, gainDb: number): Biquad {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w0);
  const sin = Math.sin(w0);
  const S = 0.9;
  const alpha = (sin / 2) * Math.sqrt((A + 1 / A) * (1 / S - 1) + 2);
  const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;
  const b0 = A * (A + 1 + (A - 1) * cos + twoSqrtAAlpha);
  const b1 = -2 * A * (A - 1 + (A + 1) * cos);
  const b2 = A * (A + 1 + (A - 1) * cos - twoSqrtAAlpha);
  const a0 = A + 1 - (A - 1) * cos + twoSqrtAAlpha;
  const a1 = 2 * (A - 1 - (A + 1) * cos);
  const a2 = A + 1 - (A - 1) * cos - twoSqrtAAlpha;
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function applyBiquad(data: Float32Array, bq: Biquad): void {
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < data.length; i++) {
    const x0 = data[i];
    const y0 = bq.b0 * x0 + bq.b1 * x1 + bq.b2 * x2 - bq.a1 * y1 - bq.a2 * y2;
    x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    data[i] = y0;
  }
}

// ── Tape/tube saturation (odd-harmonic soft clip) ──────────────────────────
function applySaturation(data: Float32Array, amount: number): void {
  if (amount <= 0) return;
  const drive = 1 + amount * 3.5;
  const norm = Math.tanh(drive);
  for (let i = 0; i < data.length; i++) {
    const sat = Math.tanh(data[i] * drive) / norm;
    data[i] = data[i] * (1 - amount) + sat * amount;
  }
}

// ── RBJ resonance filters (for the de-harsher band) ────────────────────────
function lowpass(sampleRate: number, freq: number, Q = 0.707): Biquad {
  const w0 = (2 * Math.PI * Math.min(freq, sampleRate * 0.49)) / sampleRate;
  const cos = Math.cos(w0), sin = Math.sin(w0), alpha = sin / (2 * Q);
  const a0 = 1 + alpha;
  return { b0: ((1 - cos) / 2) / a0, b1: (1 - cos) / a0, b2: ((1 - cos) / 2) / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

function highpass(sampleRate: number, freq: number, Q = 0.707): Biquad {
  const w0 = (2 * Math.PI * freq) / sampleRate;
  const cos = Math.cos(w0), sin = Math.sin(w0), alpha = sin / (2 * Q);
  const a0 = 1 + alpha;
  return { b0: ((1 + cos) / 2) / a0, b1: (-(1 + cos)) / a0, b2: ((1 + cos) / 2) / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

// ── Dynamic de-harsher (parallel de-esser on the 3–8 kHz band) ─────────────
// Source separation leaves "musical noise" in the presence band; this isolates
// 3–8 kHz, follows its envelope, and subtracts only the energy that spikes over
// a threshold — so harsh transients are tamed while the tone is untouched.
function applyDeHarsh(data: Float32Array, sampleRate: number, amount: number): void {
  if (amount <= 0) return;
  const band = new Float32Array(data);
  applyBiquad(band, highpass(sampleRate, 3000));
  applyBiquad(band, lowpass(sampleRate, 8000));

  const atk = Math.exp(-1 / (sampleRate * 0.002)); // 2 ms
  const rel = Math.exp(-1 / (sampleRate * 0.05));  // 50 ms
  const thresh = 0.02 + (1 - amount) * 0.08;        // more amount → lower threshold
  const floor = 1 - amount;                          // max attenuation of the band
  let env = 0;
  let g = 1;
  for (let i = 0; i < data.length; i++) {
    const a = Math.abs(band[i]);
    env = a > env ? atk * env + (1 - atk) * a : rel * env + (1 - rel) * a;
    const target = env > thresh ? Math.max(floor, thresh / env) : 1;
    // Smooth the gain (fast to duck, slow to recover) to avoid clicks.
    g = target < g ? atk * g + (1 - atk) * target : rel * g + (1 - rel) * target;
    data[i] -= band[i] * (1 - g); // subtract the over-threshold portion of the band
  }
}

// ── Stereo width via mid/side ──────────────────────────────────────────────
function applyWidth(left: Float32Array, right: Float32Array, width: number): void {
  for (let i = 0; i < left.length; i++) {
    const mid = (left[i] + right[i]) * 0.5;
    const side = (left[i] - right[i]) * 0.5 * width;
    left[i] = mid + side;
    right[i] = mid - side;
  }
}

// ── Spectral HF exciter (GPU-accelerated STFT band replication) ────────────
const FFT_SIZE = 2048;
const HOP = FFT_SIZE / 4; // 75% overlap (WOLA with hann → click-free)

/**
 * Restore/energize the top end by, for each STFT frame, injecting an attenuated
 * copy of the octave-below spectrum into the bins above the crossover — i.e.
 * spectral band replication. Fills the "dead air" above a low rolloff with
 * harmonically-related content. Runs the whole STFT batch through the WebGPU FFT.
 */
async function spectralExciter(
  input: Float32Array,
  sampleRate: number,
  amount: number,
  crossoverHz: number,
): Promise<Float32Array> {
  if (amount <= 0 || input.length < FFT_SIZE) return input.slice();

  const win = hannWindow(FFT_SIZE);
  const numFrames = Math.max(1, Math.ceil((input.length - FFT_SIZE) / HOP) + 1);

  // Analysis: window each frame into { real, imag } buffers.
  const frames: { real: Float32Array; imag: Float32Array }[] = [];
  for (let f = 0; f < numFrames; f++) {
    const start = f * HOP;
    const real = new Float32Array(FFT_SIZE);
    const imag = new Float32Array(FFT_SIZE);
    for (let i = 0; i < FFT_SIZE; i++) {
      const idx = start + i;
      real[i] = idx < input.length ? input[idx] * win[i] : 0;
    }
    frames.push({ real, imag });
  }

  const acc = await getGPUFFTAccelerator();
  await acc.batchFFT(frames, false); // forward FFT (GPU batch)

  const nyquist = FFT_SIZE / 2;
  const crossBin = Math.max(2, Math.min(nyquist - 1, Math.round((crossoverHz / (sampleRate / 2)) * nyquist)));
  const span = Math.max(1, nyquist - crossBin);

  for (const frame of frames) {
    // Inject octave-below content into HF bins, rolling off toward Nyquist so it
    // adds air without harshness.
    for (let k = nyquist - 1; k >= crossBin; k--) {
      const src = k >> 1; // octave below
      const rolloff = 1 - (k - crossBin) / span; // 1 at crossover → 0 at Nyquist
      const g = amount * 0.7 * rolloff;
      frame.real[k] += frame.real[src] * g;
      frame.imag[k] += frame.imag[src] * g;
    }
    // Re-impose Hermitian symmetry so the IFFT yields a real signal.
    for (let k = nyquist + 1; k < FFT_SIZE; k++) {
      frame.real[k] = frame.real[FFT_SIZE - k];
      frame.imag[k] = -frame.imag[FFT_SIZE - k];
    }
  }

  await acc.batchFFT(frames, true); // inverse FFT (GPU batch)

  // Weighted overlap-add (synthesis window + normalization for COLA).
  const out = new Float32Array(input.length);
  const norm = new Float32Array(input.length);
  for (let f = 0; f < numFrames; f++) {
    const start = f * HOP;
    const real = frames[f].real;
    for (let i = 0; i < FFT_SIZE; i++) {
      const idx = start + i;
      if (idx >= input.length) break;
      const w = win[i];
      out[idx] += real[i] * w;
      norm[idx] += w * w;
    }
  }
  for (let i = 0; i < out.length; i++) {
    out[i] = norm[i] > 1e-8 ? out[i] / norm[i] : 0;
  }
  return out;
}

export interface AnalogMasterResult {
  channels: Float32Array[];
  /** True if the FFT ran on the GPU (WebGPU), false if it used the CPU fallback. */
  gpu: boolean;
}

/**
 * Process one or two channels through the analog master rack. Returns new
 * Float32Arrays (input is not mutated). Async because the exciter batches its
 * FFT through WebGPU.
 */
export async function processAnalogMaster(
  channels: Float32Array[],
  sampleRate: number,
  settings: AnalogMasterSettings,
): Promise<AnalogMasterResult> {
  const dry = channels.map((c) => c.slice());
  const wet = channels.map((c) => c.slice());

  // 1. Tone shelves — warmth (low) + air (high).
  if (settings.warmth > 0) {
    const bq = lowShelf(sampleRate, 130, settings.warmth * 4.5);
    wet.forEach((c) => applyBiquad(c, bq));
  }
  if (settings.air > 0) {
    // Clamp below Nyquist so the RBJ shelf stays valid for low-rate clips.
    const airFreq = Math.min(11000, sampleRate * 0.45);
    const bq = highShelf(sampleRate, airFreq, settings.air * 5);
    wet.forEach((c) => applyBiquad(c, bq));
  }

  // 1b. De-harsh: tame the 3–8 kHz separation "musical noise" BEFORE adding air.
  if (settings.deHarsh > 0) {
    wet.forEach((c) => applyDeHarsh(c, sampleRate, settings.deHarsh));
  }

  // 2. Spectral HF exciter (GPU FFT). Track whether the GPU path was used.
  const acc = await getGPUFFTAccelerator();
  if (settings.exciter > 0) {
    for (let c = 0; c < wet.length; c++) {
      wet[c] = await spectralExciter(wet[c], sampleRate, settings.exciter, settings.exciterFreq);
    }
  }

  // 3. Tape saturation.
  wet.forEach((c) => applySaturation(c, settings.saturation));

  // 4. Stereo width (needs a pair).
  if (wet.length >= 2 && settings.width !== 1) {
    applyWidth(wet[0], wet[1], settings.width);
  }

  // 5. Dry/wet mix + output gain, with a gentle safety limiter.
  const out = channels.map((_, c) => {
    const o = new Float32Array(dry[c].length);
    for (let i = 0; i < o.length; i++) {
      let v = (dry[c][i] * (1 - settings.mix) + wet[c][i] * settings.mix) * settings.outputGain;
      // Soft ceiling so makeup gain / excitation can't hard-clip.
      if (v > 1 || v < -1) v = Math.tanh(v);
      o[i] = v;
    }
    return o;
  });

  // The exciter is the only FFT consumer, so only report GPU use when it ran.
  return { channels: out, gpu: acc.available && settings.exciter > 0 };
}
