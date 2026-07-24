import { describe, it, expect } from 'vitest';
import { processAnalogMaster, ANALOG_MASTER_DEFAULTS } from './analogMaster';

const SR = 48000;

// Goertzel single-bin magnitude — measures energy at one frequency without a
// full FFT dependency, so the test is independent of the module internals.
function goertzel(x: Float32Array, sampleRate: number, targetFreq: number): number {
  const n = x.length;
  const k = Math.round((n * targetFreq) / sampleRate);
  const w = (2 * Math.PI * k) / n;
  const cw = Math.cos(w), sw = Math.sin(w), coeff = 2 * cw;
  let s1 = 0, s2 = 0;
  for (let i = 0; i < n; i++) {
    const s0 = x[i] + coeff * s1 - s2;
    s2 = s1; s1 = s0;
  }
  const real = s1 - s2 * cw;
  const imag = s2 * sw;
  return Math.sqrt(real * real + imag * imag) / n;
}

// Band-limited source: content only up to ~6 kHz (mimics a dull, rolled-off mix).
function bandLimited(len: number): Float32Array {
  const x = new Float32Array(len);
  const freqs = [200, 1000, 3000, 5000, 6000];
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (const f of freqs) s += Math.sin((2 * Math.PI * f * i) / SR);
    x[i] = (s / freqs.length) * 0.5;
  }
  return x;
}

function isFiniteBounded(x: Float32Array): boolean {
  for (let i = 0; i < x.length; i++) {
    if (!Number.isFinite(x[i]) || Math.abs(x[i]) > 1.0001) return false;
  }
  return true;
}

describe('analogMaster DSP', () => {
  it('exciter injects high-frequency energy above the crossover', async () => {
    const input = bandLimited(48000);
    const before = goertzel(input, SR, 9000); // above the 7 kHz crossover → ~silent
    const res = await processAnalogMaster([input], SR, {
      ...ANALOG_MASTER_DEFAULTS,
      saturation: 0, air: 0, warmth: 0, width: 1, mix: 1, exciter: 0.7,
    });
    const after = goertzel(res.channels[0], SR, 9000);
    expect(after).toBeGreaterThan(before * 3 + 1e-5); // demonstrable HF restoration
    expect(isFiniteBounded(res.channels[0])).toBe(true);
    expect(typeof res.gpu).toBe('boolean');
  });

  it('saturation generates odd harmonics', async () => {
    const len = 8192;
    const sine = new Float32Array(len);
    for (let i = 0; i < len; i++) sine[i] = Math.sin((2 * Math.PI * 1000 * i) / SR) * 0.6;
    const third = goertzel(sine, SR, 3000);
    const res = await processAnalogMaster([sine], SR, {
      ...ANALOG_MASTER_DEFAULTS,
      exciter: 0, air: 0, warmth: 0, width: 1, mix: 1, saturation: 0.8,
    });
    const thirdAfter = goertzel(res.channels[0], SR, 3000);
    expect(thirdAfter).toBeGreaterThan(third + 1e-4); // 3rd harmonic appears
    expect(isFiniteBounded(res.channels[0])).toBe(true);
  });

  it('width > 1 increases the side (L-R) signal', async () => {
    const len = 8192;
    const l = new Float32Array(len), r = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      l[i] = Math.sin((2 * Math.PI * 440 * i) / SR) * 0.5;
      r[i] = Math.sin((2 * Math.PI * 440 * i) / SR + 0.6) * 0.5; // slightly decorrelated
    }
    const sideBefore = sideEnergy(l, r);
    const res = await processAnalogMaster([l, r], SR, {
      ...ANALOG_MASTER_DEFAULTS,
      exciter: 0, air: 0, warmth: 0, saturation: 0, mix: 1, width: 1.6,
    });
    const sideAfter = sideEnergy(res.channels[0], res.channels[1]);
    expect(sideAfter).toBeGreaterThan(sideBefore);
  });

  it('leaves the signal finite and unclipped at full settings', async () => {
    const input = bandLimited(20000);
    const res = await processAnalogMaster([input.slice(), input.slice()], SR, {
      ...ANALOG_MASTER_DEFAULTS, exciter: 1, saturation: 1, air: 1, warmth: 1, width: 2, outputGain: 1.5,
    });
    expect(res.channels).toHaveLength(2);
    expect(isFiniteBounded(res.channels[0])).toBe(true);
    expect(isFiniteBounded(res.channels[1])).toBe(true);
  });
});

function sideEnergy(l: Float32Array, r: Float32Array): number {
  let e = 0;
  for (let i = 0; i < l.length; i++) {
    const s = (l[i] - r[i]) * 0.5;
    e += s * s;
  }
  return e;
}
