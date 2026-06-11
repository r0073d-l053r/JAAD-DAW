import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { audioEngine } from './audioEngine';

/* ------------------------------------------------------------------------ */
/* Minimal Web Audio mock harness (jsdom ships no Web Audio implementation). */
/* The engine only touches `window.AudioContext`, the `AudioWorkletNode` and */
/* `AudioBufferSourceNode` globals, so stubbing those three is sufficient.   */
/* ------------------------------------------------------------------------ */

class MockAudioParam {
  value = 1;
  setValueAtTime = vi.fn();
  linearRampToValueAtTime = vi.fn();
  exponentialRampToValueAtTime = vi.fn();
  setTargetAtTime = vi.fn();
}

class MockAudioNode {
  connect = vi.fn().mockReturnThis();
  disconnect = vi.fn();
}

class MockGainNode extends MockAudioNode {
  gain = new MockAudioParam();
}

class MockStereoPannerNode extends MockAudioNode {
  pan = new MockAudioParam();
}

class MockAnalyserNode extends MockAudioNode {
  fftSize = 2048;
  smoothingTimeConstant = 0.8;
  frequencyBinCount = 512;
  getByteTimeDomainData = vi.fn();
  getByteFrequencyData = vi.fn();
}

class MockAudioBufferSourceNode extends MockAudioNode {
  buffer: any = null;
  playbackRate = new MockAudioParam();
  onended: (() => void) | null = null;
  start = vi.fn();
  stop = vi.fn();
}

// Flipped on by individual tests to simulate a worklet processor that has
// not been registered (AudioWorkletNode constructor throws in that case).
let workletConstructorShouldThrow = false;

class MockAudioWorkletNode extends MockAudioNode {
  port = { postMessage: vi.fn(), onmessage: null as any };
  parameters = new Map<string, MockAudioParam>();
  processorName: string;

  constructor(_context: any, name: string, _options?: any) {
    super();
    if (workletConstructorShouldThrow) {
      throw new Error('AudioWorkletNode: processor not registered');
    }
    this.processorName = name;
  }
}

class MockAudioContext {
  currentTime = 0;
  outputLatency = 0.05;
  baseLatency = 0;
  sampleRate = 44100;
  state = 'running';
  destination = new MockAudioNode();
  audioWorklet = { addModule: vi.fn().mockResolvedValue(undefined) };

  createdGains: MockGainNode[] = [];

  createGain = vi.fn(() => {
    const g = new MockGainNode();
    this.createdGains.push(g);
    return g;
  });
  createAnalyser = vi.fn(() => new MockAnalyserNode());
  createStereoPanner = vi.fn(() => new MockStereoPannerNode());
  createBufferSource = vi.fn(() => new MockAudioBufferSourceNode());
  createOscillator = vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    frequency: new MockAudioParam(),
    start: vi.fn(),
    stop: vi.fn(),
  }));
  decodeAudioData = vi.fn();
  createBuffer = vi.fn();
  resume = vi.fn();
  suspend = vi.fn();
}

const ctx = () => audioEngine.context as unknown as MockAudioContext;

const makeBuffer = (duration: number) => ({ duration } as unknown as AudioBuffer);

function resetEngine() {
  if (audioEngine.metronomeTimerID !== null) {
    window.clearTimeout(audioEngine.metronomeTimerID);
    audioEngine.metronomeTimerID = null;
  }
  audioEngine.context = null;
  audioEngine.masterGain = null;
  audioEngine.masterAnalyser = null;
  audioEngine.buffers.clear();
  audioEngine.trackNodes.clear();
  audioEngine.analysers.clear();
  audioEngine.activeSources.clear();
  audioEngine.playStartTime = 0;
  audioEngine.playPositionAtStart = 0;
  audioEngine.isPlaying = false;
  audioEngine.playbackRate = 1.0;
  audioEngine.isLooping = false;
  audioEngine.loopStart = 0;
  audioEngine.loopEnd = 0;
  audioEngine.metronomeEnabled = false;
  audioEngine.tempoAutomation = [{ time: 0, bpm: 120 }];
}

beforeEach(() => {
  workletConstructorShouldThrow = false;
  vi.stubGlobal('AudioContext', MockAudioContext as unknown as typeof AudioContext);
  vi.stubGlobal('AudioWorkletNode', MockAudioWorkletNode as unknown as typeof AudioWorkletNode);
  vi.stubGlobal(
    'AudioBufferSourceNode',
    MockAudioBufferSourceNode as unknown as typeof AudioBufferSourceNode
  );
  resetEngine();
  audioEngine.init();
});

afterEach(() => {
  resetEngine();
  vi.unstubAllGlobals();
});

describe('audioEngine.init', () => {
  it('creates a context with master gain -> analyser -> destination routing once', () => {
    const context = ctx();
    expect(context).toBeInstanceOf(MockAudioContext);
    expect(audioEngine.masterGain).toBeTruthy();
    expect(audioEngine.masterAnalyser).toBeTruthy();

    const masterGain = audioEngine.masterGain as unknown as MockGainNode;
    const masterAnalyser = audioEngine.masterAnalyser as unknown as MockAnalyserNode;
    expect(masterGain.connect).toHaveBeenCalledWith(masterAnalyser);
    expect(masterAnalyser.connect).toHaveBeenCalledWith(context.destination);

    // Registers all three worklet modules
    expect(context.audioWorklet.addModule).toHaveBeenCalledTimes(3);

    // Calling init again must not create a new context
    audioEngine.init();
    expect(audioEngine.context).toBe(context as unknown as AudioContext);
  });
});

describe('audioEngine.getCurrentTime', () => {
  it('returns playPositionAtStart when playback has not started', () => {
    audioEngine.playStartTime = 0;
    audioEngine.playPositionAtStart = 7.25;
    expect(audioEngine.getCurrentTime()).toBe(7.25);

    audioEngine.context = null;
    expect(audioEngine.getCurrentTime()).toBe(7.25);
  });

  it('returns playPositionAtStart + elapsed - outputLatency at rate 1.0', () => {
    audioEngine.playStartTime = 10;
    audioEngine.playPositionAtStart = 1;
    ctx().currentTime = 12;
    ctx().outputLatency = 0.05;
    // 1 + (12 - 10) * 1.0 - 0.05
    expect(audioEngine.getCurrentTime()).toBeCloseTo(2.95, 10);
  });

  it('scales elapsed wall time by playbackRate', () => {
    audioEngine.playStartTime = 10;
    audioEngine.playPositionAtStart = 1;
    audioEngine.playbackRate = 2.0;
    ctx().currentTime = 12;
    ctx().outputLatency = 0.05;
    // 1 + (12 - 10) * 2.0 - 0.05
    expect(audioEngine.getCurrentTime()).toBeCloseTo(4.95, 10);
  });

  it('does not subtract latency before playback has actually elapsed', () => {
    audioEngine.playStartTime = 10;
    audioEngine.playPositionAtStart = 3;
    ctx().currentTime = 10; // elapsed === 0
    expect(audioEngine.getCurrentTime()).toBe(3);
  });

  it('falls back to baseLatency, then a 50ms default, when outputLatency is unset', () => {
    audioEngine.playStartTime = 10;
    audioEngine.playPositionAtStart = 1;
    ctx().currentTime = 12;

    ctx().outputLatency = 0;
    ctx().baseLatency = 0.02;
    expect(audioEngine.getCurrentTime()).toBeCloseTo(2.98, 10);

    ctx().baseLatency = 0;
    expect(audioEngine.getCurrentTime()).toBeCloseTo(2.95, 10);
  });

  it('clamps to zero when the latency compensation would go negative', () => {
    audioEngine.playStartTime = 10;
    audioEngine.playPositionAtStart = 0;
    ctx().currentTime = 10.01; // elapsed 0.01 < 0.05 latency
    ctx().outputLatency = 0.05;
    expect(audioEngine.getCurrentTime()).toBe(0);
  });

  it('wraps time back into the loop region while looping', () => {
    audioEngine.setLoop(true, 2, 4);
    audioEngine.playStartTime = 10;
    audioEngine.playPositionAtStart = 2;
    ctx().currentTime = 13;
    ctx().outputLatency = 0.05;
    // Raw time: 2 + 3 - 0.05 = 4.95 -> over = 0.95 -> 2 + (0.95 % 2)
    expect(audioEngine.getCurrentTime()).toBeCloseTo(2.95, 10);
  });
});

describe('audioEngine.getBpmAtTime', () => {
  it('returns the bpm of the latest automation point at or before the given time', () => {
    audioEngine.setMetronomeState(false, [
      { time: 0, bpm: 100 },
      { time: 10, bpm: 140 },
      { time: 20, bpm: 90 },
    ]);

    expect(audioEngine.getBpmAtTime(0)).toBe(100);
    expect(audioEngine.getBpmAtTime(9.999)).toBe(100);
    expect(audioEngine.getBpmAtTime(10)).toBe(140); // boundary is inclusive
    expect(audioEngine.getBpmAtTime(15)).toBe(140);
    expect(audioEngine.getBpmAtTime(20)).toBe(90);
    expect(audioEngine.getBpmAtTime(9999)).toBe(90);
  });

  it('falls back to 120 bpm for an empty automation array', () => {
    audioEngine.tempoAutomation = [];
    expect(audioEngine.getBpmAtTime(5)).toBe(120);
  });
});

describe('audioEngine.setLoop', () => {
  it('stores loop flags and boundaries', () => {
    audioEngine.setLoop(true, 1.5, 9.25);
    expect(audioEngine.isLooping).toBe(true);
    expect(audioEngine.loopStart).toBe(1.5);
    expect(audioEngine.loopEnd).toBe(9.25);

    audioEngine.setLoop(false, 0, 0);
    expect(audioEngine.isLooping).toBe(false);
  });
});

describe('audioEngine.playClip (native rate-1.0 path)', () => {
  beforeEach(() => {
    audioEngine.buffers.set('bufA', makeBuffer(10));
    audioEngine.setupTrackRouting('track1', 0.8, 0);
  });

  it('schedules a buffer source with the requested time/offset/duration', () => {
    ctx().currentTime = 0;
    audioEngine.playClip('clip1', 'track1', 2, 1, 3, 'bufA');

    const entry = audioEngine.activeSources.get('clip1')!;
    expect(entry).toBeTruthy();
    expect(entry.soundtouch).toBeUndefined();

    const source = entry.node as unknown as MockAudioBufferSourceNode;
    expect(source.buffer).toBe(audioEngine.buffers.get('bufA'));
    expect(source.start).toHaveBeenCalledWith(2, 1, 3);

    const trackGain = audioEngine.trackNodes.get('track1')!.gain;
    expect(source.connect).toHaveBeenCalledWith(trackGain);
  });

  it('advances the buffer offset when playAtTime is already in the past', () => {
    ctx().currentTime = 5;
    audioEngine.playClip('clip1', 'track1', 2, 1, 3, 'bufA');

    const source = audioEngine.activeSources.get('clip1')!
      .node as unknown as MockAudioBufferSourceNode;
    // targetTime clamps to now (5); the 3s we missed are added to the offset.
    expect(source.start).toHaveBeenCalledWith(5, 4, 3);
  });

  it('passes undefined duration when duration is 0 (play to end)', () => {
    ctx().currentTime = 0;
    audioEngine.playClip('clip1', 'track1', 2, 1, 0, 'bufA');

    const source = audioEngine.activeSources.get('clip1')!
      .node as unknown as MockAudioBufferSourceNode;
    expect(source.start).toHaveBeenCalledWith(2, 1, undefined);
  });

  it('does not start or register a source when the offset is past the buffer end', () => {
    ctx().currentTime = 0;
    audioEngine.playClip('clip1', 'track1', 0, 11, 0, 'bufA'); // buffer is 10s long
    expect(audioEngine.activeSources.size).toBe(0);
  });

  it('is a no-op when the buffer id is unknown', () => {
    audioEngine.playClip('clip1', 'track1', 0, 0, 0, 'missing-buffer');
    expect(ctx().createBufferSource).not.toHaveBeenCalled();
    expect(audioEngine.activeSources.size).toBe(0);
  });

  it('replaces (and releases) an existing source playing under the same clip id', () => {
    ctx().currentTime = 0;
    audioEngine.playClip('clip1', 'track1', 0, 0, 0, 'bufA');
    const first = audioEngine.activeSources.get('clip1')!
      .node as unknown as MockAudioBufferSourceNode;

    audioEngine.playClip('clip1', 'track1', 1, 0, 0, 'bufA');
    const second = audioEngine.activeSources.get('clip1')!
      .node as unknown as MockAudioBufferSourceNode;

    expect(second).not.toBe(first);
    expect(first.disconnect).toHaveBeenCalled();
    expect(audioEngine.activeSources.size).toBe(1);
  });

  it('routes through an envelope gain and schedules ramps for future points', () => {
    ctx().currentTime = 0;
    audioEngine.playClip('clip1', 'track1', 2, 1, 0, 'bufA', [
      { time: 0, value: 0.5 },
      { time: 3, value: 1 },
    ]);

    const source = audioEngine.activeSources.get('clip1')!
      .node as unknown as MockAudioBufferSourceNode;
    const envGain = ctx().createdGains[ctx().createdGains.length - 1];
    const trackGain = audioEngine.trackNodes.get('track1')!.gain;

    expect(source.connect).toHaveBeenCalledWith(envGain);
    expect(envGain.connect).toHaveBeenCalledWith(trackGain);
    // Initial value pinned at the schedule time
    expect(envGain.gain.setValueAtTime).toHaveBeenCalledWith(0.5, 2);
    // Clip starts (in context time) at targetTime - startOffset = 1; the
    // point at clip-relative t=3 lands at context time 4 (>= targetTime 2).
    expect(envGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 4);
    // The t=0 point is in the past relative to targetTime, so no ramp for it.
    expect(envGain.gain.linearRampToValueAtTime).toHaveBeenCalledTimes(1);
  });
});

describe('audioEngine.playClip clip fades', () => {
  beforeEach(() => {
    audioEngine.buffers.set('bufA', makeBuffer(10));
    audioEngine.setupTrackRouting('track1', 0.8, 0);
  });

  const lastGain = () => ctx().createdGains[ctx().createdGains.length - 1];

  it('routes through a fade gain and schedules fade-in/out ramps (rate 1.0)', () => {
    ctx().currentTime = 0;
    audioEngine.playClip('clip1', 'track1', 2, 0, 6, 'bufA', undefined, undefined, {
      fadeIn: 1,
      fadeOut: 2,
      clipOffset: 0,
    });

    const source = audioEngine.activeSources.get('clip1')!
      .node as unknown as MockAudioBufferSourceNode;
    const fadeGain = lastGain();
    const trackGain = audioEngine.trackNodes.get('track1')!.gain;

    expect(source.connect).toHaveBeenCalledWith(fadeGain);
    expect(fadeGain.connect).toHaveBeenCalledWith(trackGain);

    // Starts (near) silent at the clip start, scheduled at targetTime 2
    expect(fadeGain.gain.setValueAtTime).toHaveBeenCalledWith(0.0001, 2);
    // Fade-in completes 1s after the clip start
    expect(fadeGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 3);
    // Unity gain holds until the fade-out begins (clip end 8 minus 2s fade)
    expect(fadeGain.gain.setValueAtTime).toHaveBeenCalledWith(1, 6);
    // Fade-out lands at the clip end
    expect(fadeGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.0001, 8);
  });

  it('starts at the correct partial gain when playback begins mid fade-in', () => {
    ctx().currentTime = 0;
    // Playback starts 0.5s into the clip; fade-in is 1s, remaining clip is 5.5s.
    audioEngine.playClip('clip1', 'track1', 2, 0.5, 5.5, 'bufA', undefined, undefined, {
      fadeIn: 1,
      fadeOut: 2,
      clipOffset: 0.5,
    });

    const fadeGain = lastGain();
    // Half-way through the 1s fade-in -> gain 0.5 at the schedule time
    expect(fadeGain.gain.setValueAtTime).toHaveBeenCalledWith(0.5, 2);
    // Remaining half of the fade-in finishes 0.5s later
    expect(fadeGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 2.5);
    // Fade-out starts at clip time 4 (= 6 - 2) -> context time 2 + (4 - 0.5)
    expect(fadeGain.gain.setValueAtTime).toHaveBeenCalledWith(1, 5.5);
    // Clip ends at clip time 6 -> context time 2 + (6 - 0.5)
    expect(fadeGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.0001, 7.5);
  });

  it('starts inside the fade-out at the correct residual gain', () => {
    ctx().currentTime = 0;
    // Clip is 6s with a 2s fade-out; playback starts 5s in, 1s remaining.
    audioEngine.playClip('clip1', 'track1', 2, 5, 1, 'bufA', undefined, undefined, {
      fadeOut: 2,
      clipOffset: 5,
    });

    const fadeGain = lastGain();
    // 1s left of a 2s fade-out -> gain 0.5, decaying to silence at the end
    expect(fadeGain.gain.setValueAtTime).toHaveBeenCalledWith(0.5, 2);
    expect(fadeGain.gain.setValueAtTime).toHaveBeenCalledTimes(1); // no unity hold
    expect(fadeGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.0001, 3);
    expect(fadeGain.gain.linearRampToValueAtTime).toHaveBeenCalledTimes(1);
  });

  it('divides fade times by the playback rate on the stretch path', () => {
    audioEngine.playbackRate = 2.0;
    ctx().currentTime = 0;
    audioEngine.playClip('clip1', 'track1', 0, 0, 6, 'bufA', undefined, undefined, {
      fadeIn: 1,
      fadeOut: 2,
      clipOffset: 0,
    });

    const entry = audioEngine.activeSources.get('clip1')!;
    const soundtouch = entry.soundtouch as unknown as MockAudioWorkletNode;
    const fadeGain = lastGain();
    const trackGain = audioEngine.trackNodes.get('track1')!.gain;

    // Routing: source -> soundtouch -> fade gain -> track gain
    expect(soundtouch.connect).toHaveBeenCalledWith(fadeGain);
    expect(fadeGain.connect).toHaveBeenCalledWith(trackGain);

    expect(fadeGain.gain.setValueAtTime).toHaveBeenCalledWith(0.0001, 0);
    // 1s clip-time fade-in takes 0.5s of wall time at rate 2.0
    expect(fadeGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 0.5);
    // Fade-out starts at clip time 4 -> wall time 2; ends at clip time 6 -> wall time 3
    expect(fadeGain.gain.setValueAtTime).toHaveBeenCalledWith(1, 2);
    expect(fadeGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.0001, 3);
  });

  it('scales down fades whose combined length exceeds the clip duration', () => {
    ctx().currentTime = 0;
    // 4s clip with 4s + 4s fades -> both scaled to 2s, meeting in the middle.
    audioEngine.playClip('clip1', 'track1', 0, 0, 4, 'bufA', undefined, undefined, {
      fadeIn: 4,
      fadeOut: 4,
      clipOffset: 0,
    });

    const fadeGain = lastGain();
    expect(fadeGain.gain.setValueAtTime).toHaveBeenCalledWith(0.0001, 0);
    expect(fadeGain.gain.setValueAtTime).toHaveBeenCalledTimes(1); // no unity hold
    expect(fadeGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 2);
    expect(fadeGain.gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.0001, 4);
  });

  it('chains the fade gain after the volume envelope gain', () => {
    ctx().currentTime = 0;
    audioEngine.playClip(
      'clip1', 'track1', 0, 0, 4, 'bufA',
      [{ time: 0, value: 0.5 }],
      undefined,
      { fadeIn: 1, clipOffset: 0 }
    );

    const gains = ctx().createdGains;
    const envGain = gains[gains.length - 2];
    const fadeGain = gains[gains.length - 1];
    const trackGain = audioEngine.trackNodes.get('track1')!.gain;
    const source = audioEngine.activeSources.get('clip1')!
      .node as unknown as MockAudioBufferSourceNode;

    expect(source.connect).toHaveBeenCalledWith(fadeGain);
    expect(fadeGain.connect).toHaveBeenCalledWith(envGain);
    expect(envGain.connect).toHaveBeenCalledWith(trackGain);
  });

  it('does not create a fade gain when fades are absent or zero', () => {
    ctx().currentTime = 0;
    const gainsBefore = ctx().createdGains.length;
    audioEngine.playClip('clip1', 'track1', 0, 0, 4, 'bufA', undefined, undefined, {
      fadeIn: 0,
      fadeOut: 0,
      clipOffset: 0,
    });

    expect(ctx().createdGains.length).toBe(gainsBefore);
    const source = audioEngine.activeSources.get('clip1')!
      .node as unknown as MockAudioBufferSourceNode;
    const trackGain = audioEngine.trackNodes.get('track1')!.gain;
    expect(source.connect).toHaveBeenCalledWith(trackGain);
  });
});

describe('audioEngine.playClip (time-stretch path, rate != 1.0)', () => {
  beforeEach(() => {
    audioEngine.buffers.set('bufA', makeBuffer(10));
    audioEngine.setupTrackRouting('track1', 0.8, 0);
    audioEngine.playbackRate = 1.5;
  });

  it('sets source.playbackRate and inserts a soundtouch worklet with an INIT message', () => {
    ctx().currentTime = 0;
    audioEngine.playClip('clip1', 'track1', 0, 1, 4, 'bufA');

    const entry = audioEngine.activeSources.get('clip1')!;
    const source = entry.node as unknown as MockAudioBufferSourceNode;
    const soundtouch = entry.soundtouch as unknown as MockAudioWorkletNode;

    expect(source.playbackRate.value).toBe(1.5);
    expect(soundtouch).toBeTruthy();
    expect(soundtouch.processorName).toBe('soundtouch-processor');
    expect(soundtouch.port.postMessage).toHaveBeenCalledWith({
      type: 'INIT',
      tempo: 1.5,
      sampleRate: 44100,
    });

    // Routing: source -> soundtouch -> track gain
    const trackGain = audioEngine.trackNodes.get('track1')!.gain;
    expect(source.connect).toHaveBeenCalledWith(soundtouch);
    expect(soundtouch.connect).toHaveBeenCalledWith(trackGain);

    expect(source.start).toHaveBeenCalledWith(0, 1, 4);
  });

  it('releases the worklet and unregisters the clip when the source ends naturally', () => {
    audioEngine.playClip('clip1', 'track1', 0, 0, 0, 'bufA');

    const entry = audioEngine.activeSources.get('clip1')!;
    const source = entry.node as unknown as MockAudioBufferSourceNode;
    const soundtouch = entry.soundtouch as unknown as MockAudioWorkletNode;

    expect(typeof source.onended).toBe('function');
    source.onended!();

    expect(audioEngine.activeSources.has('clip1')).toBe(false);
    expect(soundtouch.port.postMessage).toHaveBeenCalledWith({ type: 'STOP' });
    expect(soundtouch.disconnect).toHaveBeenCalled();
  });

  it('falls back to direct (pitched) playback when the worklet cannot be constructed', () => {
    workletConstructorShouldThrow = true;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    audioEngine.playClip('clip1', 'track1', 0, 0, 0, 'bufA');

    const entry = audioEngine.activeSources.get('clip1')!;
    expect(entry).toBeTruthy();
    expect(entry.soundtouch).toBeUndefined();

    const source = entry.node as unknown as MockAudioBufferSourceNode;
    const trackGain = audioEngine.trackNodes.get('track1')!.gain;
    expect(source.connect).toHaveBeenCalledWith(trackGain);
    expect(source.start).toHaveBeenCalled();
    expect(source.playbackRate.value).toBe(1.5);

    errorSpy.mockRestore();
  });
});

describe('audioEngine.setPlaybackRate', () => {
  it('updates the engine rate, live source rates, and posts SET_TEMPO to worklet ports', () => {
    audioEngine.buffers.set('bufA', makeBuffer(10));
    audioEngine.setupTrackRouting('track1', 0.8, 0);

    // clip1 plays at rate 1.0 -> native source, no soundtouch attached
    audioEngine.playClip('clip1', 'track1', 0, 0, 0, 'bufA');
    // clip2 plays while stretched -> soundtouch attached
    audioEngine.playbackRate = 1.25;
    audioEngine.playClip('clip2', 'track1', 0, 0, 0, 'bufA');

    audioEngine.setPlaybackRate(1.5);

    expect(audioEngine.playbackRate).toBe(1.5);

    const native = audioEngine.activeSources.get('clip1')!;
    const stretched = audioEngine.activeSources.get('clip2')!;

    expect((native.node as unknown as MockAudioBufferSourceNode).playbackRate.value).toBe(1.5);
    expect((stretched.node as unknown as MockAudioBufferSourceNode).playbackRate.value).toBe(1.5);

    const soundtouch = stretched.soundtouch as unknown as MockAudioWorkletNode;
    expect(soundtouch.port.postMessage).toHaveBeenCalledWith({
      type: 'SET_TEMPO',
      tempo: 1.5,
    });
    // The native entry has no worklet; setPlaybackRate must not blow up on it.
    expect(native.soundtouch).toBeUndefined();
  });
});

describe('audioEngine.stopClip / stopAll', () => {
  beforeEach(() => {
    audioEngine.buffers.set('bufA', makeBuffer(10));
    audioEngine.setupTrackRouting('track1', 0.8, 0);
  });

  it('stopClip disconnects the node, posts STOP to its worklet, and unregisters it', () => {
    audioEngine.playbackRate = 1.5;
    audioEngine.playClip('clip1', 'track1', 0, 0, 0, 'bufA');
    audioEngine.playClip('clip2', 'track1', 0, 0, 0, 'bufA');

    const entry = audioEngine.activeSources.get('clip1')!;
    const source = entry.node as unknown as MockAudioBufferSourceNode;
    const soundtouch = entry.soundtouch as unknown as MockAudioWorkletNode;

    audioEngine.stopClip('clip1');

    expect(audioEngine.activeSources.has('clip1')).toBe(false);
    expect(audioEngine.activeSources.has('clip2')).toBe(true);
    expect(source.disconnect).toHaveBeenCalled();
    expect(source.onended).toBeNull(); // releaseSource clears the handler
    expect(soundtouch.port.postMessage).toHaveBeenCalledWith({ type: 'STOP' });
    expect(soundtouch.disconnect).toHaveBeenCalled();
  });

  it('stopClip is a no-op for an unknown clip id', () => {
    audioEngine.playClip('clip1', 'track1', 0, 0, 0, 'bufA');
    audioEngine.stopClip('does-not-exist');
    expect(audioEngine.activeSources.size).toBe(1);
  });

  it('stopAll releases every source, clears state, and stops the metronome timer', () => {
    audioEngine.playbackRate = 1.5;
    audioEngine.playClip('clip1', 'track1', 0, 0, 0, 'bufA');
    audioEngine.playClip('clip2', 'track1', 0, 0, 0, 'bufA');

    const sources = ['clip1', 'clip2'].map((id) => {
      const entry = audioEngine.activeSources.get(id)!;
      return {
        node: entry.node as unknown as MockAudioBufferSourceNode,
        soundtouch: entry.soundtouch as unknown as MockAudioWorkletNode,
      };
    });

    audioEngine.playStartTime = 123;
    audioEngine.isPlaying = true;
    audioEngine.metronomeTimerID = window.setTimeout(() => {}, 100000);

    audioEngine.stopAll();

    expect(audioEngine.activeSources.size).toBe(0);
    expect(audioEngine.playStartTime).toBe(0);
    expect(audioEngine.isPlaying).toBe(false);
    expect(audioEngine.metronomeTimerID).toBeNull();

    for (const s of sources) {
      expect(s.node.disconnect).toHaveBeenCalled();
      expect(s.soundtouch.port.postMessage).toHaveBeenCalledWith({ type: 'STOP' });
      expect(s.soundtouch.disconnect).toHaveBeenCalled();
    }
  });
});
