import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initEssentia, detectBPMOffline } from './essentiaBPM';

// Shared spy methods object
const mockRhythmResult = { bpm: 120 };
const mockBeatTicks = { ticks: 'ticks-vector' };

const mockMethods = {
  audioBufferToMonoSignal: vi.fn().mockReturnValue(new Float32Array([1, 2, 3])),
  arrayToVector: vi.fn().mockReturnValue({ delete: vi.fn() }),
  RhythmExtractor2013: vi.fn().mockReturnValue(mockRhythmResult),
  BeatTrackerDegara: vi.fn().mockReturnValue(mockBeatTicks),
  vectorToArray: vi.fn().mockReturnValue([0.0, 0.5, 1.0, 1.5]),
};

// Use constructible ES6 class to support "new Essentia(wasm)" syntax inside implementation code
class MockEssentia {
  audioBufferToMonoSignal = mockMethods.audioBufferToMonoSignal;
  arrayToVector = mockMethods.arrayToVector;
  RhythmExtractor2013 = mockMethods.RhythmExtractor2013;
  BeatTrackerDegara = mockMethods.BeatTrackerDegara;
  vectorToArray = mockMethods.vectorToArray;
}

const mockWasmObject = {
  locateFile: vi.fn(),
  ready: Promise.resolve(),
};

vi.mock('essentia.js/dist/essentia.js-core.es.js', () => ({
  default: { Essentia: MockEssentia },
  Essentia: MockEssentia,
}));

vi.mock('essentia.js/dist/essentia-wasm.es.js', () => ({
  default: mockWasmObject,
  EssentiaWASM: mockWasmObject,
}));

// Mock OfflineAudioContext and resampling hooks
class MockOfflineAudioContext {
  createBufferSource() {
    return {
      connect: vi.fn(),
      start: vi.fn(),
      buffer: null,
    };
  }
  startRendering() {
    return Promise.resolve({
      sampleRate: 44100,
      duration: 1.0,
    });
  }
}

vi.stubGlobal('OfflineAudioContext', MockOfflineAudioContext);

describe('essentiaBPM', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRhythmResult.bpm = 120; // reset
  });

  it('successfully initializes Essentia and returns instance', async () => {
    // Reset local cache module state if any (not strictly needed, but let's call init)
    const instance = await initEssentia();
    expect(instance).toBeInstanceOf(MockEssentia);
  });

  it('detects BPM via RhythmExtractor2013', async () => {
    const mockAudioBuffer = {
      sampleRate: 44100,
      duration: 2.0,
    } as unknown as AudioBuffer;

    const bpm = await detectBPMOffline(mockAudioBuffer);

    expect(bpm).toBe(120);
    expect(mockMethods.audioBufferToMonoSignal).toHaveBeenCalledWith(mockAudioBuffer);
    expect(mockMethods.RhythmExtractor2013).toHaveBeenCalled();
  });

  it('falls back to BeatTrackerDegara when RhythmExtractor fails', async () => {
    mockRhythmResult.bpm = 0; // trigger failure
    
    const mockAudioBuffer = {
      sampleRate: 44100,
      duration: 2.0,
    } as unknown as AudioBuffer;

    const bpm = await detectBPMOffline(mockAudioBuffer);

    // Calculated BPM from ticks [0.0, 0.5, 1.0, 1.5]
    // Average interval = 0.5
    // 60 / 0.5 = 120 BPM
    expect(bpm).toBe(120);
    expect(mockMethods.BeatTrackerDegara).toHaveBeenCalled();
    expect(mockMethods.vectorToArray).toHaveBeenCalledWith('ticks-vector');
  });

  it('triggers resampling if sample rate is not 44100', async () => {
    const mockAudioBuffer = {
      sampleRate: 48000,
      duration: 2.0,
    } as unknown as AudioBuffer;

    const bpm = await detectBPMOffline(mockAudioBuffer);

    expect(bpm).toBe(120);
  });

  it('returns null if BPM detection crashes', async () => {
    mockMethods.RhythmExtractor2013.mockImplementationOnce(() => {
      throw new Error('extractor failed');
    });

    const mockAudioBuffer = {
      sampleRate: 44100,
      duration: 2.0,
    } as unknown as AudioBuffer;

    const bpm = await detectBPMOffline(mockAudioBuffer);
    expect(bpm).toBeNull();
  });
});
