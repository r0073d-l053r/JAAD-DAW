/**
 * Tempo-shifted playback pitch corrector.
 *
 * The audio engine plays each AudioBufferSourceNode at `playbackRate = tempo`,
 * which gives the correct timeline speed but shifts pitch by `tempo`. This
 * processor restores the original pitch by resampling through a delay line
 * with two crossfaded granular read taps (the classic "Jungle" technique),
 * shifting pitch by `1 / tempo`.
 *
 * Latency: roughly one grain (~80 ms) when tempo != 1. Bypassed (zero
 * latency, pure copy) when tempo == 1.
 *
 * Messages:
 *   { type: 'INIT', tempo, sampleRate } — initial configuration
 *   { type: 'SET_TEMPO', tempo }        — live tempo update
 *   { type: 'STOP' }                    — release the processor
 */
class SoundTouchProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.port.onmessage = this.handleMessage.bind(this);

    this.tempo = 1.0;
    this.pitchRatio = 1.0; // 1 / tempo
    this.bypass = true;
    this.stopped = false;

    // ~80ms grains balance smearing (longer) vs. modulation artifacts (shorter)
    this.grainSize = Math.max(256, Math.round(sampleRate * 0.08));
    // Power-of-two ring buffer comfortably larger than the maximum tap delay
    this.bufferLength = 1 << Math.ceil(Math.log2(this.grainSize * 4 + 256));
    this.bufferMask = this.bufferLength - 1;
    this.delayLines = []; // lazily allocated per channel
    this.writePos = 0;
    this.phase = 0; // sawtooth 0..1, advances 1/grainSize per sample
  }

  handleMessage(event) {
    const data = event.data || {};
    if (data.type === 'INIT') {
      this.setTempo(data.tempo);
      this.port.postMessage({ type: 'INIT_COMPLETE' });
    } else if (data.type === 'SET_TEMPO') {
      this.setTempo(data.tempo);
    } else if (data.type === 'STOP') {
      this.stopped = true;
    }
  }

  setTempo(tempo) {
    const t = typeof tempo === 'number' && isFinite(tempo) && tempo > 0.05 ? tempo : 1.0;
    this.tempo = t;
    this.pitchRatio = 1.0 / t;
    this.bypass = Math.abs(t - 1.0) < 0.001;
  }

  getDelayLine(channel) {
    if (!this.delayLines[channel]) {
      this.delayLines[channel] = new Float32Array(this.bufferLength);
    }
    return this.delayLines[channel];
  }

  process(inputs, outputs) {
    if (this.stopped) return false;

    const input = inputs[0];
    const output = outputs[0];
    if (!output || output.length === 0) return true;

    const hasInput = input && input.length > 0 && input[0] && input[0].length > 0;
    const frames = output[0].length;

    if (this.bypass) {
      if (hasInput) {
        for (let ch = 0; ch < output.length; ch++) {
          const inChannel = input[Math.min(ch, input.length - 1)];
          output[ch].set(inChannel);
        }
      }
      return true;
    }

    const grain = this.grainSize;
    const mask = this.bufferMask;
    const p = this.pitchRatio;
    // For pitch-up (p > 1) the sweeping tap moves toward the write head, so a
    // base delay keeps reads behind it. +4 samples guards the interpolator.
    const baseDelay = Math.max(0, (p - 1) * grain) + 4;
    const channels = output.length;

    for (let ch = 0; ch < channels; ch++) {
      const inChannel = hasInput ? input[Math.min(ch, input.length - 1)] : null;
      const outChannel = output[ch];
      const line = this.getDelayLine(ch);

      let writePos = this.writePos;
      let phase = this.phase;

      for (let i = 0; i < frames; i++) {
        line[writePos & mask] = inChannel ? inChannel[i] : 0;

        let sample = 0;
        // Two read taps half a grain apart; Hann gains sum to exactly 1.
        for (let voice = 0; voice < 2; voice++) {
          let ph = phase + voice * 0.5;
          if (ph >= 1) ph -= 1;
          const delay = baseDelay + (1 - p) * ph * grain;
          const readPos = writePos - delay;
          const readFloor = Math.floor(readPos);
          const frac = readPos - readFloor;
          const s0 = line[readFloor & mask];
          const s1 = line[(readFloor + 1) & mask];
          const gain = 0.5 * (1 - Math.cos(2 * Math.PI * ph));
          sample += gain * (s0 + frac * (s1 - s0));
        }
        outChannel[i] = sample;

        writePos++;
        phase += 1 / grain;
        if (phase >= 1) phase -= 1;
      }
    }

    this.writePos += frames;
    this.phase += frames / grain;
    this.phase -= Math.floor(this.phase);

    return true;
  }
}

registerProcessor('soundtouch-processor', SoundTouchProcessor);
