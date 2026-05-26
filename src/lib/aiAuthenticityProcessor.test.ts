import { describe, it, expect } from 'vitest';
import {
  processAudio,
  computeAIScore,
  detectCutoffFrequency,
  PRESETS
} from './aiAuthenticityProcessor';

describe('AI Authenticity Processor DSP Suite', () => {
  const sampleRate = 44100;
  const numSamples = 44100 * 2; // 2 seconds of audio

  // Generate an audio buffer with high AI-like features:
  // - A brick-wall cutoff at 12000 Hz
  // - Perfectly coherent phases (pure sine wave harmonics)
  // - Silence blocks (to trigger noise floor penalty)
  function generateAILikeAudio(): Float32Array {
    const data = new Float32Array(numSamples);
    
    // Add multiple harmonics below 12000Hz (perfectly coherent, no random phases)
    const freqs = [200, 500, 1000, 2500, 6000, 11000];
    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      // Inject periodic quiet blocks (10% silent blocks)
      const sec = Math.floor(t * 5); // 5 blocks per second
      if (sec % 5 === 0) {
        data[i] = 0; // complete silence block
        continue;
      }
      
      let val = 0;
      for (const f of freqs) {
        val += Math.sin(2 * Math.PI * f * t);
      }
      data[i] = val / freqs.length;
    }
    
    // Normalize to peak 0.8
    let max = 0;
    for (let i = 0; i < numSamples; i++) {
      const a = Math.abs(data[i]);
      if (a > max) max = a;
    }
    if (max > 0) {
      for (let i = 0; i < numSamples; i++) data[i] = (data[i] / max) * 0.8;
    }
    
    return data;
  }

  it('correctly detects brick-wall cutoff frequency', () => {
    const data = generateAILikeAudio();
    const cutoff = detectCutoffFrequency(data, sampleRate);
    expect(cutoff).toBeLessThan(sampleRate / 2 * 0.8);
  });

  it('computes a high AI score for unprocessed AI-like audio', () => {
    const data = generateAILikeAudio();
    const score = computeAIScore(data, sampleRate);
    expect(score).toBeGreaterThan(40);
  });

  it('preserves audio integrity perfectly after processing (no NaNs, no silent tails)', () => {
    const input = generateAILikeAudio();
    const result = processAudio([input], sampleRate, PRESETS['Studio Master']);
    
    expect(result.channels.length).toBe(1);
    const output = result.channels[0];
    expect(output.length).toBe(input.length);
    
    // Ensure no NaNs or Infinities
    for (let i = 0; i < output.length; i++) {
      expect(Number.isFinite(output[i])).toBe(true);
    }

    // Ensure the output is not silent or significantly scaled down (no volume pumping)
    let outputMax = 0;
    for (let i = 0; i < output.length; i++) {
      const a = Math.abs(output[i]);
      if (a > outputMax) outputMax = a;
    }
    expect(outputMax).toBeGreaterThan(0.3); // original peak was 0.8, should remain high
  });

  it('successfully lowers the AI score using Suno Killer (Max Evasion)', () => {
    const input = generateAILikeAudio();
    const beforeScore = computeAIScore(input, sampleRate);
    
    const result = processAudio([input], sampleRate, PRESETS['Suno Killer (Max Evasion)']);
    const afterScore = result.aiScore;

    expect(afterScore).toBeLessThan(beforeScore);
  });
});
