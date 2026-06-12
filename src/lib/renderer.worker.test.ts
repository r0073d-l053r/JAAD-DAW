import { describe, it, expect, vi, afterEach } from 'vitest';
import { audioEngine } from './audioEngine';

/* ------------------------------------------------------------------------ */
/* renderer.worker.ts registers its handler on `self.onmessage` at import    */
/* time (jsdom's `self` is the window), so each render imports the module    */
/* fresh, stubs `postMessage`, and invokes the handler with a fake message   */
/* event. Returns the rendered stereo channels.                              */
/* ------------------------------------------------------------------------ */

async function renderFreeze(
  track: Record<string, unknown>,
  clipBuffers: Record<string, Float32Array[]>,
  sampleRate: number,
  totalDuration: number,
): Promise<Float32Array[]> {
  vi.resetModules();
  const postMessage = vi.fn();
  vi.stubGlobal('postMessage', postMessage);
  await import('./renderer.worker');
  const handler = (self as unknown as { onmessage: (e: { data: unknown }) => Promise<void> })
    .onmessage;
  await handler({ data: { track, clipBuffers, sampleRate, totalDuration } });
  expect(postMessage).toHaveBeenCalledTimes(1);
  const { channels } = postMessage.mock.calls[0][0] as { channels: ArrayBuffer[] };
  return channels.map((b) => new Float32Array(b));
}

const SAMPLE_RATE = 1000;

const constantClip = (value: number, seconds: number) =>
  new Float32Array(seconds * SAMPLE_RATE).fill(value);

afterEach(() => {
  vi.unstubAllGlobals();
  audioEngine.trackNodes.clear();
});

describe('renderer.worker freeze rendering', () => {
  it('bakes clip content only — track volume and pan are NOT applied', async () => {
    const track = {
      id: 't1',
      volume: 0.5,
      pan: 1, // hard right: baking pan would zero the left channel
      clips: [{ id: 'c1', start: 0, duration: 1 }],
    };
    const [left, right] = await renderFreeze(track, { c1: [constantClip(0.8, 1)] }, SAMPLE_RATE, 1);

    // Mid-clip samples must equal the raw clip content on both channels;
    // the live gain/panner nodes apply fader and pan at playback.
    expect(left[500]).toBeCloseTo(0.8, 6);
    expect(right[500]).toBeCloseTo(0.8, 6);
  });

  it('still bakes clip fades', async () => {
    const track = {
      id: 't1',
      volume: 1,
      pan: 0,
      clips: [{ id: 'c1', start: 0, duration: 1, fadeIn: 0.5 }],
    };
    const [left] = await renderFreeze(track, { c1: [constantClip(1, 1)] }, SAMPLE_RATE, 1);

    // Halfway through the 0.5s fade-in the gain is ~0.5; after it, unity.
    expect(left[250]).toBeCloseTo(0.5, 2);
    expect(left[750]).toBeCloseTo(1, 6);
  });

  it('frozen playback matches unfrozen playback gain through the live fader', async () => {
    const volume = 0.5;
    const rawSample = 0.8;
    const track = {
      id: 't1',
      volume,
      pan: 0,
      clips: [{ id: 'c1', start: 0, duration: 1 }],
    };

    // Freeze: render the track to a buffer via the worker.
    const [left] = await renderFreeze(track, { c1: [constantClip(rawSample, 1)] }, SAMPLE_RATE, 1);
    const frozenSample = left[500];

    // Playback: frozen buffers and live clips both route through the track's
    // gain node, whose value updateTrackSettings derives from the fader.
    const gainNode = { gain: { value: 1 } };
    const pannerNode = { pan: { value: 0 } };
    audioEngine.context = null; // static (stopped) path in updateTrackSettings
    audioEngine.isPlaying = false;
    audioEngine.playStartTime = 0;
    audioEngine.playPositionAtStart = 0;
    audioEngine.trackNodes.set(
      't1',
      { gain: gainNode, panner: pannerNode } as unknown as {
        gain: GainNode;
        panner: StereoPannerNode;
      },
    );
    audioEngine.updateTrackSettings('t1', volume, 0, false);
    const liveGain = gainNode.gain.value;
    expect(liveGain).toBeCloseTo(volume, 6);

    const unfrozenOutput = rawSample * liveGain; // live clip through the fader
    const frozenOutput = frozenSample * liveGain; // frozen buffer through the fader

    // Regression: with volume baked into the freeze this was volume² (0.2, not 0.4).
    expect(frozenOutput).toBeCloseTo(unfrozenOutput, 6);
    expect(frozenOutput).toBeCloseTo(rawSample * volume, 6);
  });
});
