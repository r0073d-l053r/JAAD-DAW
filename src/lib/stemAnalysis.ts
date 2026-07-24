/**
 * Stem Analysis + Auto-Master
 * ───────────────────────────
 * Listens to a stem (measures real spectral/dynamic features) and decides the
 * best Analog Master settings to restore what source separation stole — the
 * rolled-off top end, the 3–8 kHz "musical noise", the smeared punch.
 *
 * Deterministic DSP — no API key, works offline. This is the "one-click" brain.
 */

import { optimizedFFT } from './gpuFFT';
import { type AnalogMasterSettings, ANALOG_MASTER_DEFAULTS } from './analogMaster';

export type StemArchetype = 'bass' | 'vocal' | 'drums' | 'dull' | 'full';

export interface StemFeatures {
  rolloffHz: number;   // 95%-energy spectral rolloff (where the top end dies)
  centroidHz: number;  // spectral centroid (perceived brightness)
  lowRatio: number;    // fraction of energy below 200 Hz
  harshRatio: number;  // fraction of energy in 3–8 kHz (the harsh band)
  highRatio: number;   // fraction of energy above 8 kHz (air)
  crest: number;       // peak / RMS (transient content — high for drums)
  width: number;       // stereo side/mid energy (0 = mono)
  rms: number;
  archetype: StemArchetype;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function downmix(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = channels[0].length;
  const out = new Float32Array(n);
  for (let c = 0; c < channels.length; c++) {
    const ch = channels[c];
    for (let i = 0; i < n; i++) out[i] += ch[i];
  }
  const g = 1 / channels.length;
  for (let i = 0; i < n; i++) out[i] *= g;
  return out;
}

/** Extract spectral + dynamic features from a stem's channel data. */
export function analyzeStem(channels: Float32Array[], sampleRate: number): StemFeatures {
  const mono = downmix(channels);
  const N = 4096;
  const half = N / 2;

  // Averaged magnitude spectrum (Welch-style, Hann-windowed, non-overlapping).
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const spec = new Float64Array(half);
  let frames = 0;
  for (let start = 0; start + N <= mono.length; start += N) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = mono[start + i] * win[i];
    optimizedFFT(re, im);
    for (let k = 0; k < half; k++) spec[k] += Math.hypot(re[k], im[k]);
    frames++;
  }
  if (frames === 0 && mono.length > 0) {
    // Clip shorter than one frame: analyze a single zero-padded frame.
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < Math.min(N, mono.length); i++) re[i] = mono[i] * win[i];
    optimizedFFT(re, im);
    for (let k = 0; k < half; k++) spec[k] += Math.hypot(re[k], im[k]);
  }

  const binHz = sampleRate / N;
  let total = 0, centroidNum = 0, low = 0, harsh = 0, high = 0;
  for (let k = 1; k < half; k++) {
    const m = spec[k] * spec[k];
    const f = k * binHz;
    total += m;
    centroidNum += f * m;
    if (f < 200) low += m;
    if (f >= 3000 && f < 8000) harsh += m;
    if (f >= 8000) high += m;
  }
  const safeTotal = total > 0 ? total : 1;
  const centroidHz = centroidNum / safeTotal;

  // 95% energy rolloff.
  let cum = 0;
  let rolloffHz = sampleRate / 2;
  const rollThresh = total * 0.95;
  for (let k = 1; k < half; k++) {
    cum += spec[k] * spec[k];
    if (cum >= rollThresh) { rolloffHz = k * binHz; break; }
  }

  // Crest factor + RMS (time domain).
  let peak = 0, sq = 0;
  for (let i = 0; i < mono.length; i++) {
    const a = Math.abs(mono[i]);
    if (a > peak) peak = a;
    sq += mono[i] * mono[i];
  }
  const rms = Math.sqrt(sq / Math.max(1, mono.length));
  const crest = rms > 1e-6 ? peak / rms : 1;

  // Stereo width (side/mid energy).
  let width = 0;
  if (channels.length >= 2) {
    let mid = 0, side = 0;
    const L = channels[0], R = channels[1];
    for (let i = 0; i < L.length; i++) {
      const m = (L[i] + R[i]) * 0.5;
      const s = (L[i] - R[i]) * 0.5;
      mid += m * m;
      side += s * s;
    }
    width = mid > 1e-9 ? Math.sqrt(side / mid) : 0;
  }

  const lowRatio = low / safeTotal;
  const harshRatio = harsh / safeTotal;
  const highRatio = high / safeTotal;

  const f: Omit<StemFeatures, 'archetype'> = { rolloffHz, centroidHz, lowRatio, harshRatio, highRatio, crest, width, rms };
  return { ...f, archetype: classify(f) };
}

function classify(f: Omit<StemFeatures, 'archetype'>): StemArchetype {
  if (f.lowRatio > 0.5 && f.centroidHz < 1500) return 'bass';
  if (f.crest > 6 && f.highRatio > 0.1) return 'drums';
  if (f.centroidHz > 1200 && f.centroidHz < 5000 && f.harshRatio > 0.1) return 'vocal';
  if (f.rolloffHz < 9000) return 'dull';
  return 'full';
}

export interface AutoMasterDecision {
  settings: AnalogMasterSettings;
  archetype: StemArchetype;
  notes: string; // human-readable summary of what it decided
  features: StemFeatures;
}

/** Map measured features → the Analog Master settings that best restore the stem. */
export function pickMasterSettings(features: StemFeatures): AutoMasterDecision {
  const s: AnalogMasterSettings = { ...ANALOG_MASTER_DEFAULTS };
  const notes: string[] = [];

  // Restore high end proportional to how far the top is rolled off.
  const rollK = features.rolloffHz / 1000;
  if (rollK < 12) {
    s.exciter = clamp(0.25 + (12 - rollK) * 0.045, 0.2, 0.7);
    s.exciterFreq = clamp(features.rolloffHz * 0.85, 5000, 11000);
    s.air = clamp(0.25 + (12 - rollK) * 0.025, 0.15, 0.55);
    notes.push('restore top end');
  } else {
    s.exciter = 0.18;
    s.air = 0.2;
  }

  // De-harsh proportional to how hot the 3–8 kHz band is (the separation tell).
  if (features.harshRatio > 0.12) {
    s.deHarsh = clamp((features.harshRatio - 0.12) * 4, 0.25, 0.85);
    notes.push('de-harsh');
  } else {
    s.deHarsh = 0.1;
  }

  // Archetype-specific voicing.
  switch (features.archetype) {
    case 'bass':
      s.warmth = 0.45; s.saturation = 0.35; s.width = 0.85; s.exciter *= 0.4; s.air *= 0.4;
      notes.push('warm + tighten low end');
      break;
    case 'vocal':
      s.saturation = 0.18; s.width = 1.06; s.warmth = 0.16;
      notes.push('presence');
      break;
    case 'drums':
      s.saturation = 0.4; s.width = 1.1;
      notes.push('punch');
      break;
    case 'dull':
      s.saturation = 0.25; s.width = 1.05;
      break;
    case 'full':
      s.saturation = 0.25; s.width = 1.12;
      break;
  }

  // Don't widen an already-wide stem.
  if (features.width > 0.6) s.width = Math.min(s.width, 1.05);

  return { settings: s, archetype: features.archetype, notes: notes.join(' · '), features };
}

/** Convenience: analyze + decide in one call. */
export function autoMaster(channels: Float32Array[], sampleRate: number): AutoMasterDecision {
  return pickMasterSettings(analyzeStem(channels, sampleRate));
}
