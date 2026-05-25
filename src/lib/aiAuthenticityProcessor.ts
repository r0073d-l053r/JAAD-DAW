/**
 * AI Audio Authenticity Processor
 * Removes telltale spectral artifacts from AI-generated audio.
 * Inspired by iZotope RX spectral repair.
 */

// ── Types ──────────────────────────────────────────────────────────────

export interface AuthenticitySettings {
  spectralExtension: { enabled: boolean; intensity: number };    // 0–1
  noiseFloor:        { enabled: boolean; level: number; profile: NoiseProfile }; // level: 0–1
  microVariation:    { enabled: boolean; amount: number };       // 0–1
  spectralSmoothing: { enabled: boolean; slope: number };        // 0–1
  harmonicSaturation:{ enabled: boolean; drive: number; even: number; odd: number }; // 0–1 each
  stereoHumanize:    { enabled: boolean; width: number };        // 0–1
}

export type NoiseProfile = 'studio' | 'tape' | 'vinyl' | 'room';

export interface ProcessingResult {
  channels: Float32Array[];
  detectedCutoff: number;
  aiScore: number; // 0–100, higher = more likely AI
}

export const DEFAULT_SETTINGS: AuthenticitySettings = {
  spectralExtension:  { enabled: true,  intensity: 0.6 },
  noiseFloor:         { enabled: true,  level: 0.3, profile: 'studio' },
  microVariation:     { enabled: true,  amount: 0.25 },
  spectralSmoothing:  { enabled: true,  slope: 0.5 },
  harmonicSaturation: { enabled: true,  drive: 0.2, even: 0.6, odd: 0.4 },
  stereoHumanize:     { enabled: true,  width: 0.4 },
};

export const PRESETS: Record<string, AuthenticitySettings> = {
  'Subtle Polish': {
    spectralExtension:  { enabled: true,  intensity: 0.3 },
    noiseFloor:         { enabled: true,  level: 0.15, profile: 'studio' },
    microVariation:     { enabled: false, amount: 0.1 },
    spectralSmoothing:  { enabled: true,  slope: 0.3 },
    harmonicSaturation: { enabled: true,  drive: 0.1, even: 0.7, odd: 0.3 },
    stereoHumanize:     { enabled: false, width: 0.2 },
  },
  'Studio Master': { ...DEFAULT_SETTINGS },
  'Vinyl Warmth': {
    spectralExtension:  { enabled: false, intensity: 0.2 },
    noiseFloor:         { enabled: true,  level: 0.55, profile: 'vinyl' },
    microVariation:     { enabled: true,  amount: 0.6 },
    spectralSmoothing:  { enabled: true,  slope: 0.7 },
    harmonicSaturation: { enabled: true,  drive: 0.45, even: 0.8, odd: 0.2 },
    stereoHumanize:     { enabled: true,  width: 0.3 },
  },
  'Aggressive Humanize': {
    spectralExtension:  { enabled: true,  intensity: 0.85 },
    noiseFloor:         { enabled: true,  level: 0.5, profile: 'tape' },
    microVariation:     { enabled: true,  amount: 0.7 },
    spectralSmoothing:  { enabled: true,  slope: 0.9 },
    harmonicSaturation: { enabled: true,  drive: 0.5, even: 0.5, odd: 0.5 },
    stereoHumanize:     { enabled: true,  width: 0.7 },
  },
};

// ── DSP Utilities ──────────────────────────────────────────────────────

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ── Module 1: Spectral Extension ───────────────────────────────────────

export function detectCutoffFrequency(data: Float32Array, sampleRate: number): number {
  const fftSize = 2048;
  const numBins = fftSize / 2;
  // Average magnitude across several frames
  const hopSize = fftSize;
  const numFrames = Math.min(20, Math.floor(data.length / hopSize));
  if (numFrames < 1) return sampleRate / 2;

  const avgMagnitude = new Float64Array(numBins);

  for (let f = 0; f < numFrames; f++) {
    const start = f * hopSize;
    const real = new Float64Array(fftSize);
    const imag = new Float64Array(fftSize);
    for (let i = 0; i < fftSize && start + i < data.length; i++) {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (fftSize - 1)));
      real[i] = data[start + i] * w;
    }
    simplFFT(real, imag);
    for (let b = 0; b < numBins; b++) {
      avgMagnitude[b] += Math.sqrt(real[b] * real[b] + imag[b] * imag[b]);
    }
  }
  for (let b = 0; b < numBins; b++) avgMagnitude[b] /= numFrames;

  // Find the bin where magnitude drops by >20dB relative to the average of bins 10–200
  let refLevel = 0;
  const refEnd = Math.min(200, numBins);
  for (let b = 10; b < refEnd; b++) refLevel += avgMagnitude[b];
  refLevel /= (refEnd - 10);

  const thresholdDb = -20;
  const threshold = refLevel * Math.pow(10, thresholdDb / 20);

  for (let b = Math.floor(numBins * 0.5); b < numBins; b++) {
    if (avgMagnitude[b] < threshold) {
      return (b / numBins) * (sampleRate / 2);
    }
  }
  return sampleRate / 2; // No cutoff detected
}

export function applySpectralExtension(
  data: Float32Array, sampleRate: number, intensity: number, cutoffHz: number
): Float32Array {
  const output = new Float32Array(data.length);
  data.forEach((v, i) => output[i] = v);

  if (cutoffHz >= sampleRate / 2 - 500 || intensity <= 0) return output;

  // Harmonic exciter: rectify + filter to generate harmonics above cutoff
  const rand = seededRandom(42);
  const rolloffStart = cutoffHz;
  const nyquist = sampleRate / 2;

  // Process in overlapping frames
  const frameSize = 2048;
  const hopSize = frameSize / 2;

  for (let pos = 0; pos + frameSize <= data.length; pos += hopSize) {
    const real = new Float64Array(frameSize);
    const imag = new Float64Array(frameSize);
    for (let i = 0; i < frameSize; i++) {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (frameSize - 1)));
      real[i] = data[pos + i] * w;
    }
    simplFFT(real, imag);

    const numBins = frameSize / 2;
    // Generate harmonics above cutoff from content below
    for (let b = 0; b < numBins; b++) {
      const freq = (b / numBins) * nyquist;
      if (freq > rolloffStart) {
        // Find a source bin at half frequency
        const srcBin = Math.floor(b / 2);
        const mag = Math.sqrt(real[srcBin] * real[srcBin] + imag[srcBin] * imag[srcBin]);
        const phase = rand() * 2 * Math.PI; // randomized phase for natural sound
        // Apply natural roll-off: -6dB/octave above cutoff
        const octavesAbove = Math.log2(freq / rolloffStart);
        const gain = intensity * 0.3 * Math.pow(0.5, octavesAbove);
        real[b] += mag * gain * Math.cos(phase);
        imag[b] += mag * gain * Math.sin(phase);
      }
    }

    simplIFFT(real, imag);
    // Overlap-add
    for (let i = 0; i < frameSize; i++) {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (frameSize - 1)));
      if (pos + i < output.length) {
        output[pos + i] += real[i] * w * 0.5; // 0.5 for overlap normalization
      }
    }
  }
  return output;
}

// ── Module 2: Noise Floor Injection ────────────────────────────────────

const NOISE_PROFILES: Record<NoiseProfile, { spectralShape: number[]; baseDb: number }> = {
  studio: { spectralShape: [1.0, 0.8, 0.5, 0.3, 0.2, 0.15, 0.1, 0.08], baseDb: -72 },
  tape:   { spectralShape: [0.6, 1.0, 0.9, 0.7, 0.5, 0.4, 0.35, 0.3], baseDb: -60 },
  vinyl:  { spectralShape: [1.0, 0.9, 0.6, 0.4, 0.3, 0.2, 0.15, 0.5], baseDb: -55 },
  room:   { spectralShape: [1.0, 0.7, 0.4, 0.2, 0.1, 0.05, 0.03, 0.02], baseDb: -66 },
};

export function applyNoiseFloor(
  data: Float32Array, sampleRate: number, level: number, profile: NoiseProfile
): Float32Array {
  const output = new Float32Array(data.length);
  const config = NOISE_PROFILES[profile];
  const rand = seededRandom(137);

  // Map level 0–1 to dB range
  const noiseDb = config.baseDb + level * 20; // e.g., -72 to -52
  const noiseAmp = Math.pow(10, noiseDb / 20);

  // Compute RMS envelope for adaptive level
  const blockSize = Math.floor(sampleRate * 0.05); // 50ms blocks

  for (let i = 0; i < data.length; i++) {
    // Shaped noise generation
    const band = Math.min(config.spectralShape.length - 1, Math.floor((i % 256) / 32));
    const shaping = config.spectralShape[band];

    // Simple pink-ish noise from white
    const white = (rand() - 0.5) * 2;
    const noise = white * noiseAmp * shaping;

    // Adaptive: scale noise with local signal level
    const blockStart = Math.floor(i / blockSize) * blockSize;
    let localRms = 0;
    const blockEnd = Math.min(blockStart + blockSize, data.length);
    for (let j = blockStart; j < blockEnd; j += 8) { // sample every 8th for speed
      localRms += data[j] * data[j];
    }
    localRms = Math.sqrt(localRms / ((blockEnd - blockStart) / 8));
    const adaptiveGain = 0.5 + 0.5 * Math.min(1, localRms * 10);

    output[i] = data[i] + noise * adaptiveGain;
  }
  return output;
}

// ── Module 3: Micro-Variation (Wow & Flutter) ──────────────────────────

export function applyMicroVariation(
  data: Float32Array, sampleRate: number, amount: number
): Float32Array {
  const output = new Float32Array(data.length);
  if (amount <= 0) { data.forEach((v, i) => output[i] = v); return output; }

  // LFO parameters
  const wowFreq = 0.5;    // Hz - slow drift
  const flutterFreq = 6.0; // Hz - faster wobble
  const maxDeviationSamples = amount * 0.0005 * sampleRate; // max ~0.5ms at full

  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    const wow = Math.sin(2 * Math.PI * wowFreq * t) * 0.7;
    const flutter = Math.sin(2 * Math.PI * flutterFreq * t + 0.3) * 0.3;
    const deviation = (wow + flutter) * maxDeviationSamples;

    const readPos = i + deviation;
    const idx0 = Math.floor(readPos);
    const frac = readPos - idx0;

    if (idx0 >= 0 && idx0 + 1 < data.length) {
      output[i] = data[idx0] * (1 - frac) + data[idx0 + 1] * frac;
    } else if (idx0 >= 0 && idx0 < data.length) {
      output[i] = data[idx0];
    } else {
      output[i] = 0;
    }
  }
  return output;
}

// ── Module 4: Spectral Smoothing ───────────────────────────────────────

export function applySpectralSmoothing(
  data: Float32Array, sampleRate: number, slope: number, cutoffHz: number
): Float32Array {
  if (cutoffHz >= sampleRate / 2 - 500 || slope <= 0) {
    const out = new Float32Array(data.length);
    data.forEach((v, i) => out[i] = v);
    return out;
  }

  const output = new Float32Array(data.length);
  const frameSize = 2048;
  const hopSize = frameSize / 2;
  const nyquist = sampleRate / 2;
  const transitionBw = 500 + slope * 2500; // 500Hz to 3kHz bandwidth

  for (let pos = 0; pos + frameSize <= data.length; pos += hopSize) {
    const real = new Float64Array(frameSize);
    const imag = new Float64Array(frameSize);
    for (let i = 0; i < frameSize; i++) {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (frameSize - 1)));
      real[i] = data[pos + i] * w;
    }
    simplFFT(real, imag);

    const numBins = frameSize / 2;
    for (let b = 0; b < numBins; b++) {
      const freq = (b / numBins) * nyquist;
      if (freq > cutoffHz - transitionBw / 2) {
        // Smooth transition instead of brick wall
        const t = Math.min(1, Math.max(0, (freq - (cutoffHz - transitionBw / 2)) / transitionBw));
        const gain = 1 - t * t * (3 - 2 * t); // smoothstep
        real[b] *= gain;
        imag[b] *= gain;
      }
    }

    simplIFFT(real, imag);
    for (let i = 0; i < frameSize; i++) {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (frameSize - 1)));
      if (pos + i < output.length) {
        output[pos + i] += real[i] * w * (2.0 / 3.0);
      }
    }
  }
  return output;
}

// ── Module 5: Harmonic Saturation ──────────────────────────────────────

export function applyHarmonicSaturation(
  data: Float32Array, drive: number, even: number, odd: number
): Float32Array {
  const output = new Float32Array(data.length);
  if (drive <= 0) { data.forEach((v, i) => output[i] = v); return output; }

  const gain = 1 + drive * 4; // 1x to 5x input gain
  const mix = drive * 0.5;    // wet/dry based on drive

  for (let i = 0; i < data.length; i++) {
    const x = data[i] * gain;

    // Soft clipping waveshaper with even/odd harmonic control
    // Odd harmonics: tanh-like symmetric
    const oddHarm = Math.tanh(x);
    // Even harmonics: asymmetric (tube-like)
    const evenHarm = (1 / (1 + Math.exp(-x * 2))) - 0.5;

    const saturated = oddHarm * odd + evenHarm * even * 2;
    const normalized = saturated / (odd + even + 0.001); // prevent div by 0

    output[i] = data[i] * (1 - mix) + normalized * mix;
  }
  return output;
}

// ── Module 6: Stereo Humanization ──────────────────────────────────────

export function applyStereoHumanize(
  left: Float32Array, right: Float32Array, sampleRate: number, width: number
): { left: Float32Array; right: Float32Array } {
  const outL = new Float32Array(left.length);
  const outR = new Float32Array(right.length);
  if (width <= 0) {
    left.forEach((v, i) => outL[i] = v);
    right.forEach((v, i) => outR[i] = v);
    return { left: outL, right: outR };
  }

  const randL = seededRandom(271);
  const randR = seededRandom(314);

  // Micro-delay: 0 to 0.5ms
  const maxDelay = Math.floor(width * 0.0005 * sampleRate);
  const delayL = Math.floor(maxDelay * 0.3);
  const delayR = Math.floor(maxDelay * 0.7);

  // Per-channel noise
  const noiseLevel = width * 0.0003;

  for (let i = 0; i < left.length; i++) {
    const srcL = i - delayL;
    const srcR = i - delayR;

    outL[i] = (srcL >= 0 ? left[srcL] : 0) + (randL() - 0.5) * noiseLevel;
    outR[i] = (srcR >= 0 ? right[srcR] : 0) + (randR() - 0.5) * noiseLevel;

    // Subtle EQ difference: slight high-shelf boost on left
    if (i > 0) {
      const diffL = outL[i] - outL[i - 1];
      outL[i] += diffL * width * 0.02;
      const diffR = outR[i] - outR[i - 1];
      outR[i] -= diffR * width * 0.015;
    }
  }
  return { left: outL, right: outR };
}

// ── AI Detection Score ─────────────────────────────────────────────────

export function computeAIScore(data: Float32Array, sampleRate: number): number {
  let score = 0;

  // 1. Check for brick-wall cutoff (0–30 points)
  const cutoff = detectCutoffFrequency(data, sampleRate);
  const nyquist = sampleRate / 2;
  if (cutoff < nyquist * 0.85) {
    score += 30 * (1 - cutoff / nyquist);
  }

  // 2. Check noise floor level (0–25 points)
  const blockSize = 4096;
  let silentBlocks = 0;
  let totalBlocks = 0;
  for (let i = 0; i + blockSize < data.length; i += blockSize) {
    let maxAbs = 0;
    for (let j = i; j < i + blockSize; j++) {
      const a = Math.abs(data[j]);
      if (a > maxAbs) maxAbs = a;
    }
    if (maxAbs < 0.0001) silentBlocks++; // -80dB threshold
    totalBlocks++;
  }
  if (totalBlocks > 0) {
    const silentRatio = silentBlocks / totalBlocks;
    if (silentRatio > 0.05) score += Math.min(25, silentRatio * 100);
  }

  // 3. Check stereo correlation (0–25 points) — only if stereo
  // (handled externally when we have both channels)

  // 4. Check spectral uniformity (0–20 points)
  const frameSize = 1024;
  const magnitudes: number[] = [];
  for (let pos = 0; pos + frameSize < data.length && magnitudes.length < 30; pos += frameSize * 4) {
    let energy = 0;
    for (let i = 0; i < frameSize; i++) {
      energy += data[pos + i] * data[pos + i];
    }
    magnitudes.push(energy);
  }
  if (magnitudes.length > 4) {
    let variance = 0;
    const mean = magnitudes.reduce((a, b) => a + b, 0) / magnitudes.length;
    for (const m of magnitudes) variance += (m - mean) * (m - mean);
    variance /= magnitudes.length;
    const cv = Math.sqrt(variance) / (mean + 1e-10);
    if (cv < 0.3) score += 20 * (1 - cv / 0.3); // Low variance = AI-like
  }

  return Math.round(Math.min(100, Math.max(0, score)));
}

// ── Full Processing Pipeline ───────────────────────────────────────────

export function processAudio(
  channels: Float32Array[],
  sampleRate: number,
  settings: AuthenticitySettings
): ProcessingResult {
  let left = new Float32Array(channels[0]);
  let right = channels.length > 1 ? new Float32Array(channels[1]) : new Float32Array(left);

  const detectedCutoff = detectCutoffFrequency(left, sampleRate);
  const aiScoreBefore = computeAIScore(left, sampleRate);

  // Stage 1: Spectral Smoothing (before extension to clean up the cutoff edge)
  if (settings.spectralSmoothing.enabled) {
    left = applySpectralSmoothing(left, sampleRate, settings.spectralSmoothing.slope, detectedCutoff);
    right = applySpectralSmoothing(right, sampleRate, settings.spectralSmoothing.slope, detectedCutoff);
  }

  // Stage 2: Spectral Extension
  if (settings.spectralExtension.enabled) {
    left = applySpectralExtension(left, sampleRate, settings.spectralExtension.intensity, detectedCutoff);
    right = applySpectralExtension(right, sampleRate, settings.spectralExtension.intensity, detectedCutoff);
  }

  // Stage 3: Harmonic Saturation
  if (settings.harmonicSaturation.enabled) {
    const s = settings.harmonicSaturation;
    left = applyHarmonicSaturation(left, s.drive, s.even, s.odd);
    right = applyHarmonicSaturation(right, s.drive, s.even, s.odd);
  }

  // Stage 4: Micro-Variation
  if (settings.microVariation.enabled) {
    left = applyMicroVariation(left, sampleRate, settings.microVariation.amount);
    right = applyMicroVariation(right, sampleRate, settings.microVariation.amount);
  }

  // Stage 5: Noise Floor
  if (settings.noiseFloor.enabled) {
    left = applyNoiseFloor(left, sampleRate, settings.noiseFloor.level, settings.noiseFloor.profile);
    right = applyNoiseFloor(right, sampleRate, settings.noiseFloor.level, settings.noiseFloor.profile);
  }

  // Stage 6: Stereo Humanize
  if (settings.stereoHumanize.enabled) {
    const result = applyStereoHumanize(left, right, sampleRate, settings.stereoHumanize.width);
    left = result.left;
    right = result.right;
  }

  // Normalize to prevent clipping
  let peak = 0;
  for (let i = 0; i < left.length; i++) {
    const a = Math.abs(left[i]);
    if (a > peak) peak = a;
  }
  for (let i = 0; i < right.length; i++) {
    const a = Math.abs(right[i]);
    if (a > peak) peak = a;
  }
  if (peak > 0.99) {
    const norm = 0.98 / peak;
    for (let i = 0; i < left.length; i++) left[i] *= norm;
    for (let i = 0; i < right.length; i++) right[i] *= norm;
  }

  return {
    channels: channels.length > 1 ? [left, right] : [left],
    detectedCutoff,
    aiScore: computeAIScore(left, sampleRate),
  };
}

// ── Minimal FFT (reused from spectrogram worker pattern) ───────────────

function bitReverse(n: number, bits: number): number {
  let reversed = 0;
  for (let i = 0; i < bits; i++) {
    if ((n & (1 << i)) !== 0) reversed |= (1 << (bits - 1 - i));
  }
  return reversed;
}

function simplFFT(real: Float64Array, imag: Float64Array) {
  const n = real.length;
  const bits = Math.round(Math.log2(n));
  for (let i = 0; i < n; i++) {
    const j = bitReverse(i, bits);
    if (i < j) {
      [real[i], real[j]] = [real[j], real[i]];
      [imag[i], imag[j]] = [imag[j], imag[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * Math.PI / len;
    const wr = Math.cos(angle), wi = Math.sin(angle);
    for (let i = 0; i < n; i += len) {
      let w_r = 1, w_i = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const ur = real[i + j], ui = imag[i + j];
        const vr = real[i + j + half] * w_r - imag[i + j + half] * w_i;
        const vi = real[i + j + half] * w_i + imag[i + j + half] * w_r;
        real[i + j] = ur + vr; imag[i + j] = ui + vi;
        real[i + j + half] = ur - vr; imag[i + j + half] = ui - vi;
        const nwr = w_r * wr - w_i * wi;
        w_i = w_r * wi + w_i * wr;
        w_r = nwr;
      }
    }
  }
}

function simplIFFT(real: Float64Array, imag: Float64Array) {
  const n = real.length;
  for (let i = 0; i < n; i++) imag[i] = -imag[i];
  simplFFT(real, imag);
  for (let i = 0; i < n; i++) {
    real[i] /= n;
    imag[i] = -imag[i] / n;
  }
}
