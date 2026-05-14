import { saveAsset } from './assetManager';

class AudioEngine {
  context: AudioContext | null = null;
  buffers: Map<string, AudioBuffer> = new Map();
  trackNodes: Map<string, { gain: GainNode; panner: StereoPannerNode }> = new Map();
  masterGain: GainNode | null = null;
  
  // Track currently playing sources
  activeSources: Map<string, AudioBufferSourceNode> = new Map();
  midiAccess: any = null;

  // New precise timing tracking
  playStartTime: number = 0;
  playPositionAtStart: number = 0;
  
  // Loop settings
  isLooping: boolean = false;
  loopStart: number = 0;
  loopEnd: number = 0;

  // Metronome and Tempo
  metronomeEnabled: boolean = false;
  tempoAutomation: { time: number; bpm: number }[] = [{ time: 0, bpm: 120 }];
  nextNoteTime: number = 0;
  currentBeat: number = 0;
  metronomeTimerID: number | null = null;
  lookahead: number = 25.0; // ms
  scheduleAheadTime: number = 0.1; // s

  init() {
    if (!this.context) {
      this.context = new window.AudioContext();
      this.masterGain = this.context.createGain();
      this.masterGain.connect(this.context.destination);
      
      const workletUrl = `${import.meta.env.BASE_URL}worklets/vst-wrapper.js`.replace(/\/+/g, '/');
      this.context.audioWorklet.addModule(workletUrl).catch(err => {
        console.warn("Failed to load vst-wrapper worklet (might be expected during SSR or tests):", err);
      });
    }
  }

  setMasterVolume(volume: number) {
    if (!this.context || !this.masterGain) this.init();
    // Smooth transition to avoid clicks
    this.masterGain!.gain.setTargetAtTime(volume, this.context!.currentTime, 0.05);
  }

  getCurrentTime(): number {
    if (!this.context || this.playStartTime === 0) return this.playPositionAtStart;
    
    // Audio hardware naturally has latency. The AudioContext time tells us when the 
    // audio was *processed*, but not when it physically comes out of the speakers.
    // By subtracting a typical output latency (~50ms), we compensate for this 
    // hardware delay and perfectly sync the visual playhead with the audible transients.
    const outputLatency = this.context.outputLatency || this.context.baseLatency || 0.05;
    let elapsed = (this.context.currentTime - this.playStartTime);
    
    // Only subtract latency once playback has actually started (elapsed > 0)
    let time = this.playPositionAtStart + (elapsed > 0 ? elapsed - outputLatency : elapsed);
    
    if (this.isLooping && time >= this.loopEnd) {
      const loopDuration = this.loopEnd - this.loopStart;
      const over = time - this.loopEnd;
      time = this.loopStart + (over >= 0 ? over % loopDuration : 0);
    }
    
    return Math.max(0, time);
  }

  setLoop(enabled: boolean, start: number, end: number) {
    this.isLooping = enabled;
    this.loopStart = start;
    this.loopEnd = end;
  }

  setMetronomeState(enabled: boolean, tempoAutomation: { time: number; bpm: number }[]) {
    this.metronomeEnabled = enabled;
    this.tempoAutomation = tempoAutomation;
  }

  getBpmAtTime(time: number): number {
    if (this.tempoAutomation.length === 0) return 120;
    let bpm = this.tempoAutomation[0].bpm;
    for (let i = 0; i < this.tempoAutomation.length; i++) {
      if (this.tempoAutomation[i].time <= time) {
        bpm = this.tempoAutomation[i].bpm;
      } else {
        break;
      }
    }
    return bpm;
  }

  nextNote() {
    const secondsPerBeat = 60.0 / this.getBpmAtTime(this.getCurrentTime());
    this.nextNoteTime += secondsPerBeat;
    this.currentBeat++;
  }

  scheduleNote(beatNumber: number, time: number) {
    if (!this.metronomeEnabled || !this.context || !this.masterGain) return;

    const osc = this.context.createOscillator();
    const gain = this.context.createGain();
    
    osc.frequency.value = (beatNumber % 4 === 0) ? 880 : 440;
    
    gain.gain.setValueAtTime(1, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
    
    osc.connect(gain);
    gain.connect(this.masterGain);
    
    osc.start(time);
    osc.stop(time + 0.05);
  }

  scheduler() {
    if (!this.context) return;
    while (this.nextNoteTime < this.context.currentTime + this.scheduleAheadTime) {
      this.scheduleNote(this.currentBeat, this.nextNoteTime);
      this.nextNote();
    }
    this.metronomeTimerID = window.setTimeout(this.scheduler.bind(this), this.lookahead);
  }

  async setupMidi() {
    if (navigator.requestMIDIAccess) {
      try {
        this.midiAccess = await navigator.requestMIDIAccess();
        for (let input of this.midiAccess.inputs.values()) {
          input.onmidimessage = this.handleMidiMessage.bind(this);
        }
      } catch (err) {
        console.warn('MIDI not supported or access denied');
      }
    }
  }

  handleMidiMessage(msg: any) {
    if (!msg.data || msg.data.length < 3) return;
    const [command, note, velocity] = msg.data;
    if (command === 144 && velocity > 0) { // Note on
      this.playSynthNote(note, velocity);
    }
  }

  playSynthNote(note: number, velocity: number) {
    if (!this.context || !this.masterGain) this.init();
    const ctx = this.context!;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sawtooth';
    osc.frequency.value = 440 * Math.pow(2, (note - 69) / 12);
    
    gain.gain.setValueAtTime(velocity / 127, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1);
    
    osc.connect(gain);
    gain.connect(this.masterGain!);
    
    osc.start();
    osc.stop(ctx.currentTime + 1);
  }

  async loadAudio(id: string, file: File | Blob): Promise<number> {
    if (!this.context) this.init();
    
    // Automatic persistence to local storage so it's available for project bundling/export
    await saveAsset(id, file);
    
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.context!.decodeAudioData(arrayBuffer);
    this.buffers.set(id, audioBuffer);
    return audioBuffer.duration;
  }

  setupTrackRouting(trackId: string, volume: number = 0.8, pan: number = 0) {
    if (!this.context || !this.masterGain) return;
    
    if (!this.trackNodes.has(trackId)) {
      const gain = this.context.createGain();
      const panner = this.context.createStereoPanner();
      gain.connect(panner);
      panner.connect(this.masterGain);
      this.trackNodes.set(trackId, { gain, panner });
    }
    
    const nodes = this.trackNodes.get(trackId)!;
    nodes.gain.gain.value = volume;
    nodes.panner.pan.value = pan;
  }

  addTrackEffect(trackId: string, type: 'reverb' | 'delay' | 'eq' | 'compressor' | 'wasm-vst' | 'limiter') {
    if (!this.context || !this.trackNodes.has(trackId)) return;
    const nodes = this.trackNodes.get(trackId)!;
    
    if (type === 'wasm-vst') {
      try {
        const vstNode = new AudioWorkletNode(this.context, 'vst-wrapper');
        vstNode.port.postMessage({ type: 'LOAD_WASM' });
        
        nodes.panner.disconnect();
        nodes.panner.connect(vstNode);
        vstNode.connect(this.masterGain!);
      } catch (err) {
        console.error("Could not instantiate vst-wrapper node. Ensure worklet is loaded.", err);
      }
    } else if (type === 'delay') {
      const delay = this.context.createDelay();
      delay.delayTime.value = 0.25;
      const fb = this.context.createGain();
      fb.gain.value = 0.4;
      
      delay.connect(fb);
      fb.connect(delay);
      
      nodes.panner.disconnect();
      nodes.panner.connect(delay);
      delay.connect(this.masterGain!);
      nodes.panner.connect(this.masterGain!); // dry signal
    } else if (type === 'eq') {
      // Simple 3-band EQ mock
      const low = this.context.createBiquadFilter();
      low.type = 'lowshelf';
      low.frequency.value = 320;
      low.gain.value = 2; // Boost lows

      const high = this.context.createBiquadFilter();
      high.type = 'highshelf';
      high.frequency.value = 3200;
      high.gain.value = 2; // Boost highs
      
      nodes.panner.disconnect();
      nodes.panner.connect(low);
      low.connect(high);
      high.connect(this.masterGain!);
    } else if (type === 'compressor' || type === 'limiter') {
      const comp = this.context.createDynamicsCompressor();
      if (type === 'limiter') {
        comp.threshold.value = -1.0;
        comp.knee.value = 0;
        comp.ratio.value = 20;
        comp.attack.value = 0.001;
        comp.release.value = 0.1;
      } else {
        comp.threshold.value = -24;
        comp.knee.value = 30;
        comp.ratio.value = 12;
        comp.attack.value = 0.003;
        comp.release.value = 0.25;
      }
      
      if (trackId === 'master' && this.masterGain) {
        this.masterGain.disconnect();
        this.masterGain.connect(comp);
        comp.connect(this.context.destination);
      } else if (nodes) {
        nodes.panner.disconnect();
        nodes.panner.connect(comp);
        comp.connect(this.masterGain!);
      }
    }
  }

  updateTrackSettings(trackId: string, volume: number, pan: number, muted: boolean) {
    if (!this.trackNodes.has(trackId)) return;
    const nodes = this.trackNodes.get(trackId)!;
    nodes.gain.gain.value = muted ? 0 : volume;
    nodes.panner.pan.value = pan;
  }

  playClip(clipId: string, trackId: string, playAtTime: number, offset: number = 0, duration: number = 0, bufferId?: string, volumeEnvelope?: { time: number; value: number }[]) {
    const effectiveBufferId = bufferId || clipId;
    if (!this.context || !this.buffers.has(effectiveBufferId)) return;
    
    const buffer = this.buffers.get(effectiveBufferId)!;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    
    if (!this.trackNodes.has(trackId)) {
      this.setupTrackRouting(trackId);
    }
    const nodes = this.trackNodes.get(trackId)!;
    
    const targetTime = Math.max(this.context.currentTime, playAtTime);
    const timeDelta = targetTime - playAtTime;
    const startOffset = offset + timeDelta;
    const remainingDuration = Math.max(0, duration - timeDelta);
    
    let targetNode: AudioNode = nodes.gain;

    if (volumeEnvelope && volumeEnvelope.length > 0) {
      const envGain = this.context.createGain();
      const clipStartContextTime = targetTime - startOffset;
      
      // Basic approach: set initial value, ramp to subsequent points
      envGain.gain.setValueAtTime(volumeEnvelope[0].value, targetTime);
      for (const pt of volumeEnvelope) {
        const pointTime = clipStartContextTime + pt.time;
        if (pointTime >= targetTime) {
          envGain.gain.linearRampToValueAtTime(Math.max(0.0001, pt.value), pointTime);
        }
      }
      envGain.connect(nodes.gain);
      targetNode = envGain;
    }
    
    source.connect(targetNode);
    
    if (startOffset < buffer.duration && remainingDuration > 0) {
      source.start(targetTime, startOffset, remainingDuration);
      this.activeSources.set(clipId, source);
    }
  }

  startPlayback(startTimeInSeconds: number, contextStartTime?: number) {
    this.init();
    this.resume();
    this.playStartTime = contextStartTime || this.context!.currentTime;
    this.playPositionAtStart = startTimeInSeconds;
    
    this.currentBeat = 0;
    this.nextNoteTime = this.playStartTime;
    if (this.metronomeTimerID !== null) {
      window.clearTimeout(this.metronomeTimerID);
    }
    this.scheduler();
  }

  stopAll() {
    this.activeSources.forEach((source, clipId) => {
      try {
        source.stop();
        source.disconnect();
      } catch (e) {
        // Source might have already stopped
      }
    });
    this.activeSources.clear();
    this.playStartTime = 0;
    
    if (this.metronomeTimerID !== null) {
      window.clearTimeout(this.metronomeTimerID);
      this.metronomeTimerID = null;
    }
  }

  stopClip(clipId: string) {
    const source = this.activeSources.get(clipId);
    if (source) {
      try {
        source.stop();
        source.disconnect();
      } catch (e) {
        // Already stopped
      }
      this.activeSources.delete(clipId);
    }
  }

  resume() {
    this.context?.resume();
  }

  suspend() {
    this.context?.suspend();
    this.stopAll();
  }

  async renderMixdown(tracks: any[], duration: number): Promise<AudioBuffer> {
    const offlineCtx = new OfflineAudioContext(2, Math.ceil(duration * 44100), 44100);
    
    // Set up routing in offline context
    const masterGain = offlineCtx.createGain();
    masterGain.gain.value = 1.0; // Ensure master gain starts at unity
    masterGain.connect(offlineCtx.destination);

    for (const track of tracks) {
      if (track.muted) continue;
      
      const trackGain = offlineCtx.createGain();
      const trackPanner = offlineCtx.createStereoPanner();
      trackGain.gain.value = track.volume;
      trackPanner.pan.value = track.pan;
      
      trackGain.connect(trackPanner);
      trackPanner.connect(masterGain);

      for (const clip of track.clips) {
        const buffer = this.buffers.get(clip.bufferId || clip.id);
        if (buffer) {
          const source = offlineCtx.createBufferSource();
          source.buffer = buffer;
          source.connect(trackGain);
          source.start(clip.start, clip.audioOffset || 0, clip.duration);
        }
      }
    }

    return await offlineCtx.startRendering();
  }

  async renderTrack(track: any, duration: number): Promise<AudioBuffer> {
    const offlineCtx = new OfflineAudioContext(2, Math.ceil(duration * 44100), 44100);
    const trackGain = offlineCtx.createGain();
    const trackPanner = offlineCtx.createStereoPanner();
    trackGain.gain.value = track.volume;
    trackPanner.pan.value = track.pan;
    
    trackGain.connect(trackPanner);
    trackPanner.connect(offlineCtx.destination);

    for (const clip of track.clips) {
      const buffer = this.buffers.get(clip.bufferId || clip.id);
      if (buffer) {
        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;
        source.connect(trackGain);
        source.start(clip.start, clip.audioOffset || 0, clip.duration);
      }
    }

    return await offlineCtx.startRendering();
  }
  async freezeTrack(track: any, allBuffers: Map<string, AudioBuffer>, sampleRate: number = 44100): Promise<AudioBuffer> {
    const totalDuration = Math.max(0, ...track.clips.map((c: any) => c.start + c.duration)) + 5; // padding
    
    // Extract raw data for worker transfer
    const clipBuffers: Record<string, Float32Array[]> = {};
    for (const clip of track.clips) {
      const bId = clip.bufferId || clip.id;
      if (allBuffers.has(bId) && !clipBuffers[bId]) {
        const buf = allBuffers.get(bId)!;
        const channels = [];
        for (let c = 0; c < buf.numberOfChannels; c++) {
          channels.push(buf.getChannelData(c));
        }
        clipBuffers[bId] = channels;
      }
    }

    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./renderer.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        const { channels } = e.data;
        const audioBuffer = this.context!.createBuffer(channels.length, channels[0].byteLength / 4, sampleRate);
        for (let c = 0; c < channels.length; c++) {
          audioBuffer.copyToChannel(new Float32Array(channels[c]), c);
        }
        worker.terminate();
        resolve(audioBuffer);
      };
      worker.onerror = reject;
      worker.postMessage({ track, clipBuffers, sampleRate, totalDuration });
    });
  }

  async saveBufferAsAsset(id: string, buffer: AudioBuffer) {
    const wavBlob = this.audioBufferToWav(buffer);
    await saveAsset(id, wavBlob);
  }

  audioBufferToWav(buffer: AudioBuffer): Blob {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const bufferArray = new ArrayBuffer(length);
    const view = new DataView(bufferArray);
    const channels = [];
    let i, sample, offset = 0, pos = 0;

    // write WAVE header
    const setUint16 = (data: number) => { view.setUint16(pos, data, true); pos += 2; };
    const setUint32 = (data: number) => { view.setUint32(pos, data, true); pos += 4; };

    setUint32(0x46464952); // "RIFF"
    setUint32(length - 8); // file length - 8
    setUint32(0x45564157); // "WAVE"

    setUint32(0x20746d66); // "fmt " chunk
    setUint32(16); // length = 16
    setUint16(1); // PCM (uncompressed)
    setUint16(numOfChan);
    setUint32(buffer.sampleRate);
    setUint32(buffer.sampleRate * 2 * numOfChan); // avg. bytes/sec
    setUint16(numOfChan * 2); // block-align
    setUint16(16); // 16-bit (hardcoded for simplicity)

    setUint32(0x61746164); // "data" - chunk
    setUint32(length - pos - 4); // chunk length

    // write interleaved data
    for (i = 0; i < buffer.numberOfChannels; i++)
      channels.push(buffer.getChannelData(i));

    while (pos < length) {
      for (i = 0; i < numOfChan; i++) {
        sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
        sample = (sample < 0 ? sample * 0x8000 : sample * 0x7FFF) | 0; // scale to 16-bit signed
        view.setInt16(pos, sample, true);
        pos += 2;
      }
      offset++;
    }

    return new Blob([bufferArray], { type: "audio/wav" });
  }
}

export const audioEngine = new AudioEngine();
