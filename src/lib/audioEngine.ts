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

  init() {
    if (!this.context) {
      this.context = new window.AudioContext();
      this.masterGain = this.context.createGain();
      this.masterGain.connect(this.context.destination);
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

  async loadAudio(id: string, file: File): Promise<number> {
    if (!this.context) this.init();
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

  addTrackEffect(trackId: string, type: 'reverb' | 'delay' | 'eq' | 'compressor') {
    if (!this.context || !this.trackNodes.has(trackId)) return;
    const nodes = this.trackNodes.get(trackId)!;
    
    if (type === 'delay') {
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
    } else if (type === 'compressor') {
      const comp = this.context.createDynamicsCompressor();
      comp.threshold.value = -24;
      comp.knee.value = 30;
      comp.ratio.value = 12;
      comp.attack.value = 0.003;
      comp.release.value = 0.25;
      
      nodes.panner.disconnect();
      nodes.panner.connect(comp);
      comp.connect(this.masterGain!);
    }
  }

  updateTrackSettings(trackId: string, volume: number, pan: number, muted: boolean) {
    if (!this.trackNodes.has(trackId)) return;
    const nodes = this.trackNodes.get(trackId)!;
    nodes.gain.gain.value = muted ? 0 : volume;
    nodes.panner.pan.value = pan;
  }

  playClip(clipId: string, trackId: string, playAtTime: number, offset: number = 0, duration: number = 0, bufferId?: string) {
    const effectiveBufferId = bufferId || clipId;
    if (!this.context || !this.buffers.has(effectiveBufferId)) return;
    
    // playAtTime is the context time we want it to START at.
    // if playAtTime < currentTime, we adjust the offset to start mid-clip.
    
    const buffer = this.buffers.get(effectiveBufferId)!;
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    
    if (!this.trackNodes.has(trackId)) {
      this.setupTrackRouting(trackId);
    }
    const nodes = this.trackNodes.get(trackId)!;
    
    source.connect(nodes.gain);
    
    const targetTime = Math.max(this.context.currentTime, playAtTime);
    const timeDelta = targetTime - playAtTime;
    const startOffset = offset + timeDelta;
    const remainingDuration = Math.max(0, duration - timeDelta);
    
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
}

export const audioEngine = new AudioEngine();
