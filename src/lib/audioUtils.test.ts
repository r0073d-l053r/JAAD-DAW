import { describe, it, expect } from 'vitest';
import {
  findNearestZeroCrossing,
  reverseAudioBuffer,
  invertAudioBuffer,
  normalizeAudioBuffer,
  silenceAudioBufferRange
} from './audioUtils';

// Global AudioBuffer constructor shim for test environment (jsdom/Node)
if (typeof (global as any).AudioBuffer === 'undefined') {
  class MockAudioBuffer {
    numberOfChannels: number;
    length: number;
    sampleRate: number;
    duration: number;
    private channelData: Float32Array[];

    constructor(options: { length: number; numberOfChannels?: number; sampleRate: number }) {
      this.length = options.length;
      this.numberOfChannels = options.numberOfChannels || 1;
      this.sampleRate = options.sampleRate;
      this.duration = this.length / this.sampleRate;
      this.channelData = Array.from(
        { length: this.numberOfChannels },
        () => new Float32Array(this.length)
      );
    }

    getChannelData(channel: number) {
      return this.channelData[channel];
    }

    copyFromChannel(destination: Float32Array, channelNumber: number, startInChannel: number = 0) {
      destination.set(this.channelData[channelNumber].subarray(startInChannel, startInChannel + destination.length));
    }

    copyToChannel(source: Float32Array, channelNumber: number, startInChannel: number = 0) {
      this.channelData[channelNumber].set(source, startInChannel);
    }
  }
  
  (global as any).AudioBuffer = MockAudioBuffer;
}

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

describe('Audio DSP Utilities', () => {
  it('reverses audio buffer samples chronologically', () => {
    const buffer = new AudioBuffer({ length: 5, numberOfChannels: 1, sampleRate: 1000 });
    const data = buffer.getChannelData(0);
    data.set([1.0, 2.0, 3.0, 4.0, 5.0]);

    const result = reverseAudioBuffer(buffer);
    expect(Array.from(result.getChannelData(0))).toEqual([5.0, 4.0, 3.0, 2.0, 1.0]);
  });

  it('inverts audio buffer polarity (phase flip)', () => {
    const buffer = new AudioBuffer({ length: 4, numberOfChannels: 1, sampleRate: 1000 });
    const data = buffer.getChannelData(0);
    data.set([0.5, -0.2, 0.8, -1.0]);

    const result = invertAudioBuffer(buffer);
    const resData = result.getChannelData(0);
    expect(resData[0]).toBeCloseTo(-0.5, 5);
    expect(resData[1]).toBeCloseTo(0.2, 5);
    expect(resData[2]).toBeCloseTo(-0.8, 5);
    expect(resData[3]).toBeCloseTo(1.0, 5);
  });

  it('normalizes peak amplitude to -0.1 dB', () => {
    const buffer = new AudioBuffer({ length: 4, numberOfChannels: 1, sampleRate: 1000 });
    const data = buffer.getChannelData(0);
    data.set([0.1, -0.5, 0.25, -0.25]);

    const result = normalizeAudioBuffer(buffer);
    const targetPeak = Math.pow(10, -0.1 / 20); // ~0.98855
    const expectedScaledMax = -targetPeak;
    
    const resData = result.getChannelData(0);
    expect(resData[1]).toBeCloseTo(expectedScaledMax, 5);
    expect(resData[0]).toBeCloseTo(0.1 * (targetPeak / 0.5), 5);
  });

  it('silences a specific range inside an audio buffer', () => {
    const buffer = new AudioBuffer({ length: 10, numberOfChannels: 1, sampleRate: 10 }); // 1s at 10Hz
    const data = buffer.getChannelData(0);
    data.fill(1.0);

    // Silence from 0.2s to 0.6s (samples 2 to 5 inclusive, length 4)
    const result = silenceAudioBufferRange(buffer, 0.2, 0.4);
    const resData = Array.from(result.getChannelData(0));

    expect(resData.slice(0, 2)).toEqual([1.0, 1.0]);
    expect(resData.slice(2, 6)).toEqual([0.0, 0.0, 0.0, 0.0]);
    expect(resData.slice(6)).toEqual([1.0, 1.0, 1.0, 1.0]);
  });
});

