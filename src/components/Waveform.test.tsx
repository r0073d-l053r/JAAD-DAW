import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, act } from '@testing-library/react';
import { Waveform } from './Waveform';
import { audioEngine } from '../lib/audioEngine';

// Mock useApp hook
vi.mock('../lib/store', () => ({
  useApp: () => ({
    state: { buffersVersion: 0 },
  }),
}));

// Mock audioEngine buffers
vi.mock('../lib/audioEngine', () => ({
  audioEngine: {
    buffers: new Map(),
  },
}));

describe('Waveform', () => {
  let mockContext: any;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    audioEngine.buffers.clear();

    mockContext = {
      clearRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: '',
      lineWidth: 1,
      globalAlpha: 1.0,
    };

    // Stub canvas getContext
    HTMLCanvasElement.prototype.getContext = vi.fn().mockReturnValue(mockContext);
  });

  it('renders a straight placeholder line when buffer is missing', () => {
    const { container } = render(
      <Waveform
        clipId="non_existent_clip"
        color="#ff2d55"
        duration={5.0}
        width={100}
        height={50}
      />
    );

    const canvas = container.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(mockContext.clearRect).toHaveBeenCalled();
    expect(mockContext.moveTo).toHaveBeenCalledWith(0, 25); // (height / 2)
    expect(mockContext.lineTo).toHaveBeenCalled();
    expect(mockContext.stroke).toHaveBeenCalled();
  });

  it('draws authentic waveforms when buffer is loaded', async () => {
    // 1. Setup mock AudioBuffer containing dynamic sound wave points
    const mockChannelData = new Float32Array([0.5, -0.5, 0.8, -0.8, 0.0, 1.0]);
    const mockBuffer = {
      sampleRate: 44100,
      duration: 1.0,
      length: mockChannelData.length,
      getChannelData: vi.fn().mockReturnValue(mockChannelData),
    } as unknown as AudioBuffer;

    audioEngine.buffers.set('loaded_clip', mockBuffer);

    // 2. Render waveform
    render(
      <Waveform
        clipId="loaded_clip"
        color="#ff2d55"
        duration={1.0}
        width={100}
        height={50}
      />
    );

    // Initial timeout check for buffer will trigger loaded=true immediately since buffer exists
    expect(mockContext.clearRect).toHaveBeenCalled();
    expect(mockContext.strokeStyle).toBe('#ff2d55');
    expect(mockContext.lineTo).toHaveBeenCalled();
    expect(mockContext.stroke).toHaveBeenCalled();
  });

  it('waits and schedules checks for delayed buffer loads', () => {
    const { rerender } = render(
      <Waveform
        clipId="delayed_clip"
        color="#ff2d55"
        duration={1.0}
        width={100}
        height={50}
      />
    );

    // Buffer not loaded yet: draws placeholder line
    expect(mockContext.stroke).toHaveBeenCalledTimes(1);

    // Populate buffer later
    const mockChannelData = new Float32Array([0.1, -0.1]);
    const mockBuffer = {
      sampleRate: 44100,
      duration: 1.0,
      length: mockChannelData.length,
      getChannelData: vi.fn().mockReturnValue(mockChannelData),
    } as unknown as AudioBuffer;
    audioEngine.buffers.set('delayed_clip', mockBuffer);

    // Fast-forward timeout loop (500ms)
    act(() => {
      vi.advanceTimersByTime(550);
    });

    // Drawing context is cleared and drawn with real waveform
    expect(mockContext.clearRect).toHaveBeenCalledTimes(2);
  });
});
