import { describe, it, expect } from 'vitest';
import { estimateWavSize } from './exportUtils';

describe('estimateWavSize', () => {
  it('should return 0 for 0 duration', () => {
    expect(estimateWavSize(0)).toBe(0);
  });

  it('should return correct size for 1 second duration', () => {
    // 1 * 44100 samples/sec * 2 channels * 2 bytes/sample = 176400
    expect(estimateWavSize(1)).toBe(176400);
  });

  it('should return correct size for 0.5 second duration', () => {
    // 0.5 * 44100 * 2 * 2 = 88200
    expect(estimateWavSize(0.5)).toBe(88200);
  });

  it('should return correct size for 10 second duration', () => {
    // 10 * 44100 * 2 * 2 = 1764000
    expect(estimateWavSize(10)).toBe(1764000);
  });
});
