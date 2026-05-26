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
  phaseEntropy:      { enabled: boolean; intensity: number };    // 0–1
  dynamicEnvelope:   { enabled: boolean; depth: number };        // 0–1
  spectralMasking:   { enabled: boolean; intensity: number };    // 0–1
  mfccShaping:       { enabled: boolean; strength: number };     // 0–1
  quality?:          'fast' | 'balanced' | 'maximum';
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
  phaseEntropy:       { enabled: true,  intensity: 0.4 },
  dynamicEnvelope:    { enabled: true,  depth: 0.35 },
  spectralMasking:    { enabled: true,  intensity: 0.5 },
  mfccShaping:        { enabled: true,  strength: 0.4 },
  quality:            'balanced',
};

export const PRESETS: Record<string, AuthenticitySettings> = {
  'Subtle Polish': {
    spectralExtension:  { enabled: true,  intensity: 0.3 },
    noiseFloor:         { enabled: true,  level: 0.15, profile: 'studio' },
    microVariation:     { enabled: false, amount: 0.1 },
    spectralSmoothing:  { enabled: true,  slope: 0.3 },
    harmonicSaturation: { enabled: true,  drive: 0.1, even: 0.7, odd: 0.3 },
    stereoHumanize:     { enabled: false, width: 0.2 },
    phaseEntropy:       { enabled: true,  intensity: 0.15 },
    dynamicEnvelope:    { enabled: false, depth: 0.1 },
    spectralMasking:    { enabled: true,  intensity: 0.25 },
    mfccShaping:        { enabled: false, strength: 0.15 },
    quality:            'fast',
  },
  'Studio Master': { ...DEFAULT_SETTINGS },
  'Vinyl Warmth': {
    spectralExtension:  { enabled: false, intensity: 0.2 },
    noiseFloor:         { enabled: true,  level: 0.55, profile: 'vinyl' },
    microVariation:     { enabled: true,  amount: 0.6 },
    spectralSmoothing:  { enabled: true,  slope: 0.7 },
    harmonicSaturation: { enabled: true,  drive: 0.45, even: 0.8, odd: 0.2 },
    stereoHumanize:     { enabled: true,  width: 0.3 },
    phaseEntropy:       { enabled: true,  intensity: 0.5 },
    dynamicEnvelope:    { enabled: true,  depth: 0.5 },
    spectralMasking:    { enabled: true,  intensity: 0.6 },
    mfccShaping:        { enabled: true,  strength: 0.5 },
    quality:            'balanced',
  },
  'Aggressive Humanize': {
    spectralExtension:  { enabled: true,  intensity: 0.85 },
    noiseFloor:         { enabled: true,  level: 0.5, profile: 'tape' },
    microVariation:     { enabled: true,  amount: 0.7 },
    spectralSmoothing:  { enabled: true,  slope: 0.9 },
    harmonicSaturation: { enabled: true,  drive: 0.5, even: 0.5, odd: 0.5 },
    stereoHumanize:     { enabled: true,  width: 0.7 },
    phaseEntropy:       { enabled: true,  intensity: 0.8 },
    dynamicEnvelope:    { enabled: true,  depth: 0.75 },
    spectralMasking:    { enabled: true,  intensity: 0.85 },
    mfccShaping:        { enabled: true,  strength: 0.8 },
    quality:            'balanced',
  },
  'Suno Killer (Max Evasion)': {
    spectralExtension:  { enabled: true,  intensity: 0.95 },
    noiseFloor:         { enabled: true,  level: 0.6, profile: 'tape' },
    microVariation:     { enabled: true,  amount: 0.85 },
    spectralSmoothing:  { enabled: true,  slope: 0.95 },
    harmonicSaturation: { enabled: true,  drive: 0.55, even: 0.6, odd: 0.6 },
    stereoHumanize:     { enabled: true,  width: 0.8 },
    phaseEntropy:       { enabled: true,  intensity: 0.95 },
    dynamicEnvelope:    { enabled: true,  depth: 0.9 },
    spectralMasking:    { enabled: true,  intensity: 0.95 },
    mfccShaping:        { enabled: true,  strength: 0.9 },
    quality:            'maximum',
  },
  'AI Shield Max': {
    spectralExtension:  { enabled: true,  intensity: 0.9 },
    noiseFloor:         { enabled: true,  level: 0.5, profile: 'studio' },
    microVariation:     { enabled: true,  amount: 0.75 },
    spectralSmoothing:  { enabled: true,  slope: 0.85 },
    harmonicSaturation: { enabled: true,  drive: 0.4, even: 0.5, odd: 0.5 },
    stereoHumanize:     { enabled: true,  width: 0.75 },
    phaseEntropy:       { enabled: true,  intensity: 0.95 },
    dynamicEnvelope:    { enabled: true,  depth: 0.85 },
    spectralMasking:    { enabled: true,  intensity: 0.9 },
    mfccShaping:        { enabled: true,  strength: 0.85 },
    quality:            'maximum',
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
  data: Float32Array, sampleRate: number, intensity: number, cutoffHz: number,
  frameSize = 2048, hopSize = frameSize / 2
): Float32Array {
  if (cutoffHz >= sampleRate / 2 - 500 || intensity <= 0) {
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data[i];
    return out;
  }

  const rand = seededRandom(42);
  const rolloffStart = cutoffHz;
  const nyquist = sampleRate / 2;

  const outBuf = new Float64Array(data.length);
  const weightBuf = new Float64Array(data.length);

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
      if (freq > rolloffStart) {
        const srcBin = Math.floor(b / 2);
        const mag = Math.sqrt(real[srcBin] * real[srcBin] + imag[srcBin] * imag[srcBin]);
        const phase = rand() * 2 * Math.PI;
        const octavesAbove = Math.log2(freq / rolloffStart);
        // Tame harmonic extension gain to prevent artificial boost/harshness
        const gain = intensity * 0.12 * Math.pow(0.5, octavesAbove);
        real[b] = mag * gain * Math.cos(phase);
        imag[b] = mag * gain * Math.sin(phase);
      }
    }

    simplIFFT(real, imag);
    for (let i = 0; i < frameSize; i++) {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (frameSize - 1)));
      if (pos + i < outBuf.length) {
        outBuf[pos + i] += real[i] * w;
        weightBuf[pos + i] += w * w;
      }
    }
  }

  const output = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    if (weightBuf[i] > 1e-4) {
      output[i] = outBuf[i] / weightBuf[i];
    } else {
      output[i] = data[i];
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

// ── Module 3: Micro-Variation & Temporal Drift Engine ──────────────────

export function applyMicroVariation(
  data: Float32Array, sampleRate: number, amount: number
): Float32Array {
  const output = new Float32Array(data.length);
  if (amount <= 0) { data.forEach((v, i) => output[i] = v); return output; }

  const rand = seededRandom(555 + Math.floor(amount * 100));

  // Max deviation: ~0.5ms at full amount
  const maxDeviationSamples = amount * 0.0005 * sampleRate;

  // Brownian motion random walk filters (Ornstein-Uhlenbeck process)
  let slowDrift = 0;
  let fastDrift = 0;
  const slowBeta = 0.99995; // very high persistence (slow drift)
  const fastBeta = 0.9995;  // high persistence (moderate flutter)

  for (let i = 0; i < data.length; i++) {
    // Brownian steps (Gaussian approximation)
    const stepSlow = (rand() - 0.5) * 2 * 0.001;
    const stepFast = (rand() - 0.5) * 2 * 0.008;

    // Ornstein-Uhlenbeck process (mean-reverting random walk)
    slowDrift = slowBeta * slowDrift + stepSlow - 0.0001 * slowDrift;
    fastDrift = fastBeta * fastDrift + stepFast - 0.001 * fastDrift;

    // Total drift deviation
    const deviation = (slowDrift * 0.7 + fastDrift * 0.3) * maxDeviationSamples;

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

// ── Module 7: Phase Entropy Disruption ──────────────────────────────────

export function applyPhaseEntropy(
  data: Float32Array, sampleRate: number, intensity: number,
  frameSize = 2048, hopSize = frameSize / 2
): Float32Array {
  if (intensity <= 0) {
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data[i];
    return out;
  }

  const rand = seededRandom(415 + Math.floor(intensity * 100));
  const gaussianRand = () => {
    const u = 1 - rand();
    const v = 1 - rand();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
  };

  const nyquist = sampleRate / 2;
  const outBuf = new Float64Array(data.length);
  const weightBuf = new Float64Array(data.length);

  for (let pos = 0; pos + frameSize <= data.length; pos += hopSize) {
    const real = new Float64Array(frameSize);
    const imag = new Float64Array(frameSize);
    for (let i = 0; i < frameSize; i++) {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (frameSize - 1)));
      real[i] = data[pos + i] * w;
    }
    simplFFT(real, imag);

    const numBins = frameSize / 2;
    for (let b = 1; b < numBins; b++) {
      const freq = (b / numBins) * nyquist;
      if (freq > 200) {
        const mag = Math.sqrt(real[b] * real[b] + imag[b] * imag[b]);
        if (mag > 1e-8) {
          let phase = Math.atan2(imag[b], real[b]);
          // Independent per-bin perturbation (NOT cumulative walk)
          const maxPerturb = intensity * 0.75;
          phase += gaussianRand() * maxPerturb;
          real[b] = mag * Math.cos(phase);
          imag[b] = mag * Math.sin(phase);
        }
      }
    }

    simplIFFT(real, imag);
    for (let i = 0; i < frameSize; i++) {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (frameSize - 1)));
      if (pos + i < outBuf.length) {
        outBuf[pos + i] += real[i] * w;
        weightBuf[pos + i] += w * w;
      }
    }
  }

  const output = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    if (weightBuf[i] > 1e-4) {
      output[i] = outBuf[i] / weightBuf[i];
    } else {
      output[i] = data[i];
    }
  }
  return output;
}

// ── Module 9: Dynamic Envelope Humanization ─────────────────────────────

export function applyDynamicEnvelope(
  data: Float32Array, sampleRate: number, depth: number
): Float32Array {
  const output = new Float32Array(data.length);
  if (depth <= 0) { data.forEach((v, i) => output[i] = v); return output; }

  const rand = seededRandom(888 + Math.floor(depth * 100));

  // Non-integer related speeds for dynamic breath
  const slowFreq1 = 0.15;
  const slowFreq2 = 0.37;
  const fastFreq = 1.63;

  const maxDb = depth * 1.5; // Max ±1.5dB envelope fluctuation

  // Attack-decay envelope follower to protect transients
  let env = 0;
  const attackCoef = Math.exp(-1.0 / (sampleRate * 0.005)); // 5ms attack
  const decayCoef = Math.exp(-1.0 / (sampleRate * 0.15));   // 150ms decay

  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    
    const inputAbs = Math.abs(data[i]);
    if (inputAbs > env) {
      env = env * attackCoef + inputAbs * (1.0 - attackCoef);
    } else {
      env = env * decayCoef + inputAbs * (1.0 - decayCoef);
    }

    const lfo = Math.sin(2 * Math.PI * slowFreq1 * t) * 0.5 +
                Math.sin(2 * Math.PI * slowFreq2 * t) * 0.35 +
                Math.sin(2 * Math.PI * fastFreq * t) * 0.15;

    const dbMod = lfo * maxDb;
    const gainMod = Math.pow(10, dbMod / 20);

    const isTransient = env > 0.05 ? Math.max(0, inputAbs / env - 1.2) : 0;
    const transientProtection = Math.max(0, 1 - isTransient);

    const gain = 1.0 + (gainMod - 1.0) * transientProtection * Math.min(1.0, env * 10.0);

    output[i] = data[i] * gain;
  }
  return output;
}

// ── Module 10: Spectral Fingerprint Masking ────────────────────────────

export function applySpectralMasking(
  data: Float32Array, sampleRate: number, intensity: number,
  frameSize = 2048, hopSize = frameSize / 2
): Float32Array {
  if (intensity <= 0) {
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data[i];
    return out;
  }

  const nyquist = sampleRate / 2;
  const rand = seededRandom(1234 + Math.floor(intensity * 100));

  const outBuf = new Float64Array(data.length);
  const weightBuf = new Float64Array(data.length);

  for (let pos = 0; pos + frameSize <= data.length; pos += hopSize) {
    const real = new Float64Array(frameSize);
    const imag = new Float64Array(frameSize);
    for (let i = 0; i < frameSize; i++) {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (frameSize - 1)));
      real[i] = data[pos + i] * w;
    }
    simplFFT(real, imag);

    const numBins = frameSize / 2;
    const magnitude = new Float64Array(numBins);
    const phase = new Float64Array(numBins);
    for (let b = 0; b < numBins; b++) {
      magnitude[b] = Math.sqrt(real[b] * real[b] + imag[b] * imag[b]);
      phase[b] = Math.atan2(imag[b], real[b]);
    }

    // Detect periodic vocal/harmonic checkerboard ripple outliers
    const windowSize = 7;
    const halfWin = Math.floor(windowSize / 2);
    
    for (let b = halfWin; b < numBins - halfWin; b++) {
      const localBins: number[] = [];
      for (let w = -halfWin; w <= halfWin; w++) {
        localBins.push(magnitude[b + w]);
      }
      localBins.sort((a, b) => a - b);
      const median = localBins[halfWin];

      const ratio = magnitude[b] / (median + 1e-8);
      if (ratio > 1.5) {
        const targetMag = median * 1.2;
        const diff = magnitude[b] - targetMag;
        magnitude[b] = magnitude[b] - diff * intensity * 0.4;
      }
    }

    // Subtle micro-jitter to break CNN pattern structures
    const jitterAmount = intensity * 0.05;
    const jitteredMagnitude = new Float64Array(magnitude);
    for (let b = 2; b < numBins - 2; b++) {
      if (rand() < 0.1) {
        const neighbor = rand() < 0.5 ? b - 1 : b + 1;
        jitteredMagnitude[b] = magnitude[b] * (1 - jitterAmount) + magnitude[neighbor] * jitterAmount;
      }
    }

    // Subtle spectral tilt modulation
    const tiltDb = (rand() - 0.5) * intensity * 0.5;
    for (let b = 0; b < numBins; b++) {
      const freq = (b / numBins) * nyquist;
      const factor = freq / nyquist;
      const gainDb = tiltDb * (factor - 0.5);
      const gain = Math.pow(10, gainDb / 20);
      jitteredMagnitude[b] *= gain;
    }

    for (let b = 0; b < numBins; b++) {
      real[b] = jitteredMagnitude[b] * Math.cos(phase[b]);
      imag[b] = jitteredMagnitude[b] * Math.sin(phase[b]);
    }

    simplIFFT(real, imag);
    for (let i = 0; i < frameSize; i++) {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (frameSize - 1)));
      if (pos + i < outBuf.length) {
        outBuf[pos + i] += real[i] * w;
        weightBuf[pos + i] += w * w;
      }
    }
  }

  const output = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    if (weightBuf[i] > 1e-4) {
      output[i] = outBuf[i] / weightBuf[i];
    } else {
      output[i] = data[i];
    }
  }
  return output;
}

// ── Module 11: MFCC Distribution Shaping ────────────────────────────────

export function applyMFCCShaping(
  data: Float32Array, sampleRate: number, strength: number,
  frameSize = 2048, hopSize = frameSize / 2
): Float32Array {
  if (strength <= 0) {
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data[i];
    return out;
  }

  const nyquist = sampleRate / 2;
  const numMelBands = 13;

  const melMin = 0;
  const melMax = 2595 * Math.log10(1 + nyquist / 700);
  const melSpacing = (melMax - melMin) / (numMelBands + 1);

  const melBins = new Int32Array(numMelBands + 2);
  for (let m = 0; m < numMelBands + 2; m++) {
    const mel = melMin + m * melSpacing;
    const freq = 700 * (Math.pow(10, mel / 2595) - 1);
    melBins[m] = Math.floor((freq / nyquist) * (frameSize / 2));
  }

  const filterbankWeights = (b: number, m: number): number => {
    const f_m_minus = melBins[m];
    const f_m = melBins[m + 1];
    const f_m_plus = melBins[m + 2];

    if (b < f_m_minus || b > f_m_plus) return 0;
    if (b >= f_m_minus && b <= f_m) {
      return (b - f_m_minus) / (f_m - f_m_minus + 1e-8);
    }
    return (f_m_plus - b) / (f_m_plus - f_m + 1e-8);
  };

  const targetMFCCDelta = [0, 0.05, 0.08, -0.05, -0.08, 0.04, -0.03, 0.05, -0.04, 0.02, -0.02, 0.03, -0.01];

  const outBuf = new Float64Array(data.length);
  const weightBuf = new Float64Array(data.length);

  for (let pos = 0; pos + frameSize <= data.length; pos += hopSize) {
    const real = new Float64Array(frameSize);
    const imag = new Float64Array(frameSize);
    for (let i = 0; i < frameSize; i++) {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (frameSize - 1)));
      real[i] = data[pos + i] * w;
    }
    simplFFT(real, imag);

    const numBins = frameSize / 2;
    const magnitude = new Float64Array(numBins);
    const phase = new Float64Array(numBins);
    for (let b = 0; b < numBins; b++) {
      magnitude[b] = Math.sqrt(real[b] * real[b] + imag[b] * imag[b]);
      phase[b] = Math.atan2(imag[b], real[b]);
    }

    // Subtle MFCC shaping with reduced delta scaling
    for (let b = 0; b < numBins; b++) {
      let gain = 1.0;
      let totalWeight = 0;
      for (let m = 0; m < numMelBands; m++) {
        const w = filterbankWeights(b, m);
        if (w > 0) {
          const targetCorrection = Math.pow(10, targetMFCCDelta[m] * strength * 0.15);
          gain += (targetCorrection - 1.0) * w;
          totalWeight += w;
        }
      }
      if (totalWeight > 0) {
        magnitude[b] *= gain;
      }
    }

    for (let b = 0; b < numBins; b++) {
      real[b] = magnitude[b] * Math.cos(phase[b]);
      imag[b] = magnitude[b] * Math.sin(phase[b]);
    }

    simplIFFT(real, imag);
    for (let i = 0; i < frameSize; i++) {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (frameSize - 1)));
      if (pos + i < outBuf.length) {
        outBuf[pos + i] += real[i] * w;
        weightBuf[pos + i] += w * w;
      }
    }
  }

  const output = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    if (weightBuf[i] > 1e-4) {
      output[i] = outBuf[i] / weightBuf[i];
    } else {
      output[i] = data[i];
    }
  }
  return output;
}

// ── Module 4: Spectral Smoothing ───────────────────────────────────────

export function applySpectralSmoothing(
  data: Float32Array, sampleRate: number, slope: number, cutoffHz: number,
  frameSize = 2048, hopSize = frameSize / 2
): Float32Array {
  if (cutoffHz >= sampleRate / 2 - 500 || slope <= 0) {
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data[i];
    return out;
  }

  const outBuf = new Float64Array(data.length);
  const weightBuf = new Float64Array(data.length);
  const nyquist = sampleRate / 2;
  const transitionBw = 500 + slope * 2500;

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
        const t = Math.min(1, Math.max(0, (freq - (cutoffHz - transitionBw / 2)) / transitionBw));
        const gain = 1 - t * t * (3 - 2 * t);
        real[b] *= gain;
        imag[b] *= gain;
      }
    }

    simplIFFT(real, imag);
    for (let i = 0; i < frameSize; i++) {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (frameSize - 1)));
      if (pos + i < outBuf.length) {
        outBuf[pos + i] += real[i] * w;
        weightBuf[pos + i] += w * w;
      }
    }
  }

  const output = new Float32Array(data.length);
  for (let i = 0; i < data.length; i++) {
    if (weightBuf[i] > 1e-4) {
      output[i] = outBuf[i] / weightBuf[i];
    } else {
      output[i] = data[i];
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

  const gain = 1 + drive * 3; // 1x to 4x input gain
  const mix = drive * 0.3;    // wet/dry based on drive (reduced to preserve audio)

  for (let i = 0; i < data.length; i++) {
    const x = data[i] * gain;

    // Soft clipping waveshaper with even/odd harmonic control
    // Odd harmonics: tanh-like symmetric
    const oddHarm = Math.tanh(x);
    // Even harmonics: asymmetric (tube-like)
    const evenHarm = (1 / (1 + Math.exp(-x * 2))) - 0.5;

    const saturated = oddHarm * odd + evenHarm * even * 2;
    // Normalize by (odd + even) to achieve unity gain scaling of saturated output,
    // and divide by gain to bring it back to the original level range in linear region
    const normalized = (saturated / (odd + even + 1e-9)) / gain;

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

export function computeAIScore(data: Float32Array, sampleRate: number, rightData?: Float32Array): number {
  let score = 0;

  // 1. Check for brick-wall cutoff (0–15 points)
  const cutoff = detectCutoffFrequency(data, sampleRate);
  const nyquist = sampleRate / 2;
  if (cutoff < nyquist * 0.85) {
    score += 15 * (1 - cutoff / nyquist);
  }

  // 2. Check noise floor level (0–10 points)
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
    if (silentRatio > 0.05) score += Math.min(10, silentRatio * 50);
  }

  // 3. Phase Entropy (0–20 points)
  const fftSize = 1024;
  const numBins = fftSize / 2;
  const numFrames = Math.min(10, Math.floor(data.length / fftSize));
  let meanPhaseVariance = 0;
  let phaseFramesCount = 0;

  for (let f = 0; f < numFrames; f++) {
    const start = f * fftSize;
    const real = new Float64Array(fftSize);
    const imag = new Float64Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      real[i] = data[start + i];
    }
    simplFFT(real, imag);

    const phases: number[] = [];
    for (let b = 10; b < numBins; b++) {
      const mag = Math.sqrt(real[b] * real[b] + imag[b] * imag[b]);
      if (mag > 0.001) {
        phases.push(Math.atan2(imag[b], real[b]));
      }
    }

    if (phases.length > 5) {
      const diffs: number[] = [];
      for (let i = 1; i < phases.length; i++) {
        let d = phases[i] - phases[i - 1];
        while (d < -Math.PI) d += 2 * Math.PI;
        while (d > Math.PI) d -= 2 * Math.PI;
        diffs.push(d);
      }
      
      const meanDiff = diffs.reduce((a, b) => a + b, 0) / diffs.length;
      let diffVariance = 0;
      for (const d of diffs) diffVariance += (d - meanDiff) * (d - meanDiff);
      diffVariance /= diffs.length;
      
      meanPhaseVariance += diffVariance;
      phaseFramesCount++;
    }
  }

  if (phaseFramesCount > 0) {
    meanPhaseVariance /= phaseFramesCount;
    if (meanPhaseVariance < 1.5) {
      score += 20 * (1 - meanPhaseVariance / 1.5);
    }
  }

  // 4. Spectral Flatness (0–15 points)
  let geoSum = 0;
  let ariSum = 0;
  let flatnessCount = 0;
  
  if (numFrames > 0) {
    const real = new Float64Array(fftSize);
    const imag = new Float64Array(fftSize);
    const avgMag = new Float64Array(numBins);
    for (let f = 0; f < numFrames; f++) {
      const start = f * fftSize;
      real.fill(0); imag.fill(0);
      for (let i = 0; i < fftSize; i++) real[i] = data[start + i];
      simplFFT(real, imag);
      for (let b = 0; b < numBins; b++) {
        avgMag[b] += Math.sqrt(real[b] * real[b] + imag[b] * imag[b]);
      }
    }
    
    for (let b = 50; b < Math.min(450, numBins); b++) {
      const val = avgMag[b] / numFrames + 1e-6;
      geoSum += Math.log(val);
      ariSum += val;
      flatnessCount++;
    }

    if (flatnessCount > 0) {
      const geom = Math.exp(geoSum / flatnessCount);
      const arith = ariSum / flatnessCount;
      const flatness = geom / arith;
      if (flatness > 0.3) {
        score += 15 * Math.min(1.0, (flatness - 0.3) / 0.3);
      }
    }
  }

  // 5. Dynamic Range CV (0–15 points)
  const rmsBlockSize = Math.floor(sampleRate * 0.1);
  const rmsList: number[] = [];
  for (let i = 0; i + rmsBlockSize < data.length; i += rmsBlockSize) {
    let sumSq = 0;
    for (let j = i; j < i + rmsBlockSize; j += 4) {
      sumSq += data[j] * data[j];
    }
    const rms = Math.sqrt(sumSq / (rmsBlockSize / 4));
    if (rms > 0.005) {
      rmsList.push(rms);
    }
  }

  if (rmsList.length > 5) {
    const avgRms = rmsList.reduce((a, b) => a + b, 0) / rmsList.length;
    let rmsVar = 0;
    for (const rms of rmsList) rmsVar += (rms - avgRms) * (rms - avgRms);
    rmsVar /= rmsList.length;
    const cv = Math.sqrt(rmsVar) / (avgRms + 1e-10);
    if (cv < 0.35) {
      score += 15 * (1 - cv / 0.35);
    }
  }

  // 6. Stereo Correlation (0–10 points)
  if (rightData && rightData.length === data.length) {
    let num = 0;
    let denL = 0;
    let denR = 0;
    const step = Math.max(1, Math.floor(data.length / 5000));
    for (let i = 0; i < data.length; i += step) {
      const l = data[i];
      const r = rightData[i];
      num += l * r;
      denL += l * l;
      denR += r * r;
    }
    const correlation = num / (Math.sqrt(denL * denR) + 1e-10);
    if (correlation > 0.96) {
      score += 10;
    } else if (correlation >= 0 && correlation < 0.1) {
      score += 5;
    }
  }

  // 7. MFCC Deviation (0–15 points)
  if (numFrames > 0) {
    const numMelBands = 13;
    const melMin = 0;
    const melMax = 2595 * Math.log10(1 + nyquist / 700);
    const melSpacing = (melMax - melMin) / (numMelBands + 1);
    const melBins = new Int32Array(numMelBands + 2);
    for (let m = 0; m < numMelBands + 2; m++) {
      const mel = melMin + m * melSpacing;
      const freq = 700 * (Math.pow(10, mel / 2595) - 1);
      melBins[m] = Math.floor((freq / nyquist) * (fftSize / 2));
    }

    const filterbankWeights = (b: number, m: number): number => {
      const f_m_minus = melBins[m];
      const f_m = melBins[m + 1];
      const f_m_plus = melBins[m + 2];
      if (b < f_m_minus || b > f_m_plus) return 0;
      if (b >= f_m_minus && b <= f_m) return (b - f_m_minus) / (f_m - f_m_minus + 1e-8);
      return (f_m_plus - b) / (f_m_plus - f_m + 1e-8);
    };

    const avgMel = new Float64Array(numMelBands);
    let countedFrames = 0;
    const real = new Float64Array(fftSize);
    const imag = new Float64Array(fftSize);

    for (let f = 0; f < numFrames; f++) {
      const start = f * fftSize;
      real.fill(0); imag.fill(0);
      for (let i = 0; i < fftSize; i++) real[i] = data[start + i];
      simplFFT(real, imag);

      const magnitude = new Float64Array(numBins);
      for (let b = 0; b < numBins; b++) {
        magnitude[b] = Math.sqrt(real[b] * real[b] + imag[b] * imag[b]);
      }

      for (let m = 0; m < numMelBands; m++) {
        let energy = 0;
        for (let b = melBins[m]; b <= melBins[m + 2]; b++) {
          energy += magnitude[b] * filterbankWeights(b, m);
        }
        avgMel[m] += Math.log(Math.max(1e-8, energy));
      }
      countedFrames++;
    }

    if (countedFrames > 0) {
      for (let m = 0; m < numMelBands; m++) avgMel[m] /= countedFrames;
      
      let meanMel = 0;
      for (let m = 0; m < numMelBands; m++) meanMel += avgMel[m];
      meanMel /= numMelBands;

      let varianceMel = 0;
      for (let m = 0; m < numMelBands; m++) {
        varianceMel += (avgMel[m] - meanMel) * (avgMel[m] - meanMel);
      }
      varianceMel /= numMelBands;

      if (varianceMel < 3.0) {
        score += 15 * (1 - varianceMel / 3.0);
      } else if (varianceMel > 15.0) {
        score += 15 * Math.min(1.0, (varianceMel - 15.0) / 10.0);
      }
    }
  }

  return Math.round(Math.min(100, Math.max(0, score)));
}

// ── Full Processing Pipeline ───────────────────────────────────────────

export function processAudio(
  channels: Float32Array[],
  sampleRate: number,
  settings: AuthenticitySettings
): ProcessingResult {
  let left: any = new Float32Array(channels[0]);
  let right: any = channels.length > 1 ? new Float32Array(channels[1]) : new Float32Array(left);

  const detectedCutoff = detectCutoffFrequency(left, sampleRate);

  const quality = settings.quality || 'balanced';
  let frameSize = 2048;
  let hopSize = 1024;
  
  if (quality === 'fast') {
    frameSize = 1024;
    hopSize = 512;
  } else if (quality === 'maximum') {
    frameSize = 2048;
    hopSize = 512; // 4x overlap for high resolution
  }

  // Stage 1: Spectral Smoothing (before extension to clean up the cutoff edge)
  if (settings.spectralSmoothing.enabled) {
    left = applySpectralSmoothing(left, sampleRate, settings.spectralSmoothing.slope, detectedCutoff, frameSize, hopSize);
    right = applySpectralSmoothing(right, sampleRate, settings.spectralSmoothing.slope, detectedCutoff, frameSize, hopSize);
  }

  // Stage 2: Spectral Extension
  if (settings.spectralExtension.enabled) {
    left = applySpectralExtension(left, sampleRate, settings.spectralExtension.intensity, detectedCutoff, frameSize, hopSize);
    right = applySpectralExtension(right, sampleRate, settings.spectralExtension.intensity, detectedCutoff, frameSize, hopSize);
  }

  // Stage 3: Spectral Fingerprint Masking
  if (settings.spectralMasking.enabled) {
    left = applySpectralMasking(left, sampleRate, settings.spectralMasking.intensity, frameSize, hopSize);
    right = applySpectralMasking(right, sampleRate, settings.spectralMasking.intensity, frameSize, hopSize);
  }

  // Stage 4: Harmonic Saturation
  if (settings.harmonicSaturation.enabled) {
    const s = settings.harmonicSaturation;
    left = applyHarmonicSaturation(left, s.drive, s.even, s.odd);
    right = applyHarmonicSaturation(right, s.drive, s.even, s.odd);
  }

  // Stage 5: Phase Entropy Disruption
  if (settings.phaseEntropy.enabled) {
    left = applyPhaseEntropy(left, sampleRate, settings.phaseEntropy.intensity, frameSize, hopSize);
    right = applyPhaseEntropy(right, sampleRate, settings.phaseEntropy.intensity, frameSize, hopSize);
  }

  // Stage 6: Micro-Variation / Temporal Drift
  if (settings.microVariation.enabled) {
    left = applyMicroVariation(left, sampleRate, settings.microVariation.amount);
    right = applyMicroVariation(right, sampleRate, settings.microVariation.amount);
  }

  // Stage 7: Dynamic Envelope Humanization
  if (settings.dynamicEnvelope.enabled) {
    left = applyDynamicEnvelope(left, sampleRate, settings.dynamicEnvelope.depth);
    right = applyDynamicEnvelope(right, sampleRate, settings.dynamicEnvelope.depth);
  }

  // Stage 8: Noise Floor
  if (settings.noiseFloor.enabled) {
    left = applyNoiseFloor(left, sampleRate, settings.noiseFloor.level, settings.noiseFloor.profile);
    right = applyNoiseFloor(right, sampleRate, settings.noiseFloor.level, settings.noiseFloor.profile);
  }

  // Stage 9: Stereo Humanize
  if (settings.stereoHumanize.enabled) {
    const result = applyStereoHumanize(left, right, sampleRate, settings.stereoHumanize.width);
    left = result.left;
    right = result.right;
  }

  // Stage 10: MFCC Distribution Shaping
  if (settings.mfccShaping.enabled && quality !== 'fast') {
    left = applyMFCCShaping(left, sampleRate, settings.mfccShaping.strength, frameSize, hopSize);
    right = applyMFCCShaping(right, sampleRate, settings.mfccShaping.strength, frameSize, hopSize);
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
    aiScore: computeAIScore(left, sampleRate, channels.length > 1 ? right : undefined),
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
