import { describe, it, expect } from 'vitest';
import { findNearestZeroCrossing } from './audioUtils';

describe('findNearestZeroCrossing', () => {
  it('identifies exact zero crossing in standard waveform arrays', () => {
    // Construct a mock AudioBuffer
    const sampleRate = 1000; // 1000Hz for easy index-to-second tracking
    const channelData = new Float32Array(100);
    
    // Create a wave that crosses zero exactly at index 50
    // e.g. positive values before, negative values after
    for (let i = 0; i < 100; i++) {
      if (i < 50) {
        channelData[i] = 0.5;
      } else if (i === 50) {
        channelData[i] = 0.0; // exact crossing
      } else {
        channelData[i] = -0.5;
      }
    }

    const mockBuffer = {
      sampleRate,
      length: 100,
      duration: 0.1,
      getChannelData: () => channelData,
    } as unknown as AudioBuffer;

    // Target a relative time of 0.052s (index 52)
    // The closest zero crossing is index 50 (0.05s)
    const result = findNearestZeroCrossing(mockBuffer, 0.052, 50);
    expect(result).toBe(0.05); // 50 / 1000 = 0.05
  });

  it('correctly returns target if no zero crossing is found in the search window', () => {
    const sampleRate = 1000;
    const channelData = new Float32Array(100);
    channelData.fill(0.8); // completely positive, no crossings

    const mockBuffer = {
      sampleRate,
      length: 100,
      duration: 0.1,
      getChannelData: () => channelData,
    } as unknown as AudioBuffer;

    const result = findNearestZeroCrossing(mockBuffer, 0.05, 10);
    expect(result).toBe(0.05);
  });

  it('finds sign-flip crossings when exact 0.0 value is not present', () => {
    const sampleRate = 1000;
    const channelData = new Float32Array([0.5, 0.5, 0.5, -0.5, -0.5]);

    const mockBuffer = {
      sampleRate,
      length: 5,
      duration: 0.005,
      getChannelData: () => channelData,
    } as unknown as AudioBuffer;

    // Target index 1 (0.001s). Crossing occurs between index 2 and index 3.
    // The closest sample to the crossing is index 2 (value: 0.5, next: -0.5)
    const result = findNearestZeroCrossing(mockBuffer, 0.001, 50);
    expect(result).toBe(0.002); // index 2 -> 0.002s
  });
});
