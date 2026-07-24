import { describe, it, expect } from 'vitest';
import { analyzeStem, pickMasterSettings } from './stemAnalysis';

const SR = 48000;

function tone(len: number, freqs: number[], amp = 0.4): Float32Array {
  const x = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (const f of freqs) s += Math.sin((2 * Math.PI * f * i) / SR);
    x[i] = (s / freqs.length) * amp;
  }
  return x;
}

describe('stem analysis', () => {
  it('classifies a low-frequency stem as bass', () => {
    const f = analyzeStem([tone(48000, [70, 120, 180])], SR);
    expect(f.archetype).toBe('bass');
    expect(f.lowRatio).toBeGreaterThan(0.4);
    expect(f.centroidHz).toBeLessThan(1500);
  });

  it('flags a band-limited (dull) stem and prescribes more exciter', () => {
    const dull = analyzeStem([tone(48000, [200, 1000, 3000, 5500])], SR);
    expect(dull.rolloffHz).toBeLessThan(9000);
    const decision = pickMasterSettings(dull);
    expect(decision.settings.exciter).toBeGreaterThan(0.25); // restore top end
    expect(decision.notes).toContain('restore top end');
  });

  it('prescribes de-harsh when the 3-8kHz band is hot', () => {
    // Heavy 4-6kHz content → high harshRatio.
    const harsh = analyzeStem([tone(48000, [4000, 5000, 6000], 0.6)], SR);
    expect(harsh.harshRatio).toBeGreaterThan(0.12);
    const decision = pickMasterSettings(harsh);
    expect(decision.settings.deHarsh).toBeGreaterThan(0.25);
    expect(decision.notes).toContain('de-harsh');
  });

  it('does not widen an already-wide stereo stem', () => {
    const len = 16384;
    const l = tone(len, [440, 880]);
    const r = tone(len, [550, 660]); // different content per side → genuinely wide
    const f = analyzeStem([l, r], SR);
    expect(f.width).toBeGreaterThan(0.6);
    const decision = pickMasterSettings(f);
    expect(decision.settings.width).toBeLessThanOrEqual(1.05);
  });

  it('returns finite features for a tiny (sub-frame) clip', () => {
    const f = analyzeStem([tone(512, [1000])], SR);
    expect(Number.isFinite(f.rolloffHz)).toBe(true);
    expect(Number.isFinite(f.centroidHz)).toBe(true);
    expect(Number.isFinite(f.crest)).toBe(true);
  });
});
