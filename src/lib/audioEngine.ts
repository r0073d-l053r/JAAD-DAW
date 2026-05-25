import { SoundTouch, SimpleFilter, WebAudioBufferSource } from 'soundtouchjs';
import { CloudVstBridge } from './cloudVstBridge';

class AudioEngine {
  context: AudioContext | null = null;
  buffers: Map<string, AudioBuffer> = new Map();
  trackNodes: Map<string, { gain: GainNode; panner: StereoPannerNode }> = new Map();
  analysers: Map<string, AnalyserNode> = new Map();
  masterAnalyser: AnalyserNode | null = null;
  cloudVstBridges: Map<string, CloudVstBridge> = new Map();
  sidechainNodes: Map<string, AudioWorkletNode> = new Map();
  sidechainReduction: Map<string, number> = new Map();
  sidechainSources: Map<string, string> = new Map(); // Target Track ID -> Trigger Track ID
  masterGain: GainNode | null = null;
  
  // Track currently playing sources
  activeSources: Map<string, { node: AudioNode, filter?: any, soundtouch?: any }> = new Map();
  midiAccess: any = null;

  // New precise timing tracking
  playStartTime: number = 0;
  playPositionAtStart: number = 0;
  isPlaying: boolean = false;
  playbackRate: number = 1.0;
  
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
      this.masterAnalyser = this.context.createAnalyser();
      this.masterAnalyser.fftSize = 1024;
      this.masterGain.connect(this.masterAnalyser);
      this.masterAnalyser.connect(this.context.destination);
      
      const workletUrl = `${import.meta.env.BASE_URL}worklets/vst-wrapper.js`.replace(/\/+/g, '/');
      const soundtouchUrl = `${import.meta.env.BASE_URL}worklets/soundtouch-processor.js`.replace(/\/+/g, '/');
      const sidechainUrl = `${import.meta.env.BASE_URL}worklets/sidechain-processor.js`.replace(/\/+/g, '/');
      
      this.context.audioWorklet.addModule(workletUrl).catch(err => {
        console.warn("Failed to load vst-wrapper worklet (might be expected during SSR or tests):", err);
      });
      this.context.audioWorklet.addModule(soundtouchUrl).catch(err => {
        console.warn("Failed to load soundtouch-processor worklet:", err);
      });
      this.context.audioWorklet.addModule(sidechainUrl).catch(err => {
        console.warn("Failed to load sidechain-processor worklet:", err);
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
    let elapsed = (this.context.currentTime - this.playStartTime) * this.playbackRate;
    
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
    const projectTime = this.playPositionAtStart + (this.nextNoteTime - this.playStartTime) * this.playbackRate;
    const secondsPerBeat = 60.0 / this.getBpmAtTime(projectTime);
    const rate = this.playbackRate > 0 ? this.playbackRate : 1.0;
    this.nextNoteTime += secondsPerBeat / rate;
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
    try {
      const arrayBuffer = await file.arrayBuffer();
      const audioBuffer = await this.context!.decodeAudioData(arrayBuffer);
      this.buffers.set(id, audioBuffer);
      return audioBuffer.duration;
    } catch (err) {
      console.warn(`AudioEngine: Failed to decode audio data for asset ${id}. Creating a silent fallback.`, err);
      // Create a 1-second silent buffer to prevent app crashes on corrupt/empty files
      const silentBuffer = this.context!.createBuffer(1, this.context!.sampleRate, this.context!.sampleRate);
      this.buffers.set(id, silentBuffer);
      return 1.0;
    }
  }

  setupTrackRouting(trackId: string, volume: number = 0.8, pan: number = 0) {
    if (!this.context || !this.masterGain) return;
    
    if (!this.trackNodes.has(trackId)) {
      const gain = this.context.createGain();
      const panner = this.context.createStereoPanner();
      const analyser = this.context.createAnalyser();
      analyser.fftSize = 1024;
      gain.connect(panner);
      gain.connect(analyser); // Capture post-fader level
      panner.connect(this.masterGain);
      this.trackNodes.set(trackId, { gain, panner });
      this.analysers.set(trackId, analyser);
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
        const vstNode = new AudioWorkletNode(this.context, 'vst-wrapper', {
          outputChannelCount: [2]
        });
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

  addCloudVstBridge(trackId: string) {
    if (!this.context || !this.trackNodes.has(trackId)) return null;
    const nodes = this.trackNodes.get(trackId)!;
    
    // Disconnect old panner connections
    try {
      nodes.panner.disconnect();
    } catch (e) {}

    // Instantiate CloudVstBridge
    const bridge = new CloudVstBridge(this.context, trackId, this.masterGain!);
    nodes.panner.connect(bridge.getInputNode());
    
    this.cloudVstBridges.set(trackId, bridge);
    return bridge;
  }

  removeCloudVstBridge(trackId: string) {
    if (this.cloudVstBridges.has(trackId)) {
      const bridge = this.cloudVstBridges.get(trackId)!;
      bridge.disconnect();
      this.cloudVstBridges.delete(trackId);
      
      // Reconnect track normally
      if (this.trackNodes.has(trackId) && this.masterGain) {
        const nodes = this.trackNodes.get(trackId)!;
        nodes.panner.connect(this.masterGain);
      }
    }
  }

  addTrackSidechain(trackId: string) {
    if (!this.context || !this.trackNodes.has(trackId)) return null;
    const nodes = this.trackNodes.get(trackId)!;

    // Disconnect old panner connections
    try {
      nodes.panner.disconnect();
    } catch (e) {}

    try {
      const sidechainNode = new AudioWorkletNode(this.context, 'sidechain-compressor', {
        numberOfInputs: 2,
        numberOfOutputs: 1,
        outputChannelCount: [2]
      });

      // Listen to metrics from the worklet to update real-time dB reduction
      sidechainNode.port.onmessage = (event) => {
        if (event.data.type === 'metrics') {
          this.sidechainReduction.set(trackId, event.data.reduction);
        }
      };

      // Connect primary input (Main track signal) to Input 0
      nodes.panner.connect(sidechainNode, 0, 0);
      // Connect Output 0 to masterGain
      sidechainNode.connect(this.masterGain!);

      this.sidechainNodes.set(trackId, sidechainNode);
      this.sidechainReduction.set(trackId, 0);

      // Trigger sidechain connection update (self-sidechain fallback by default)
      const triggerId = this.sidechainSources.get(trackId);
      if (triggerId) {
        this.connectSidechainTrigger(trackId, triggerId);
      }

      return sidechainNode;
    } catch (err) {
      console.error("Could not instantiate sidechain-compressor node. Ensure worklet is loaded.", err);
      // Fallback connection
      nodes.panner.connect(this.masterGain!);
      return null;
    }
  }

  removeTrackSidechain(trackId: string) {
    if (this.sidechainNodes.has(trackId)) {
      const sidechainNode = this.sidechainNodes.get(trackId)!;
      try {
        sidechainNode.disconnect();
      } catch (e) {}
      this.sidechainNodes.delete(trackId);
      this.sidechainReduction.delete(trackId);

      // Reconnect track normally
      if (this.trackNodes.has(trackId) && this.masterGain) {
        const nodes = this.trackNodes.get(trackId)!;
        try {
          nodes.panner.disconnect();
        } catch (e) {}
        nodes.panner.connect(this.masterGain);
      }
    }
  }

  connectSidechainTrigger(targetTrackId: string, triggerTrackId: string) {
    this.sidechainSources.set(targetTrackId, triggerTrackId);
    const targetNode = this.sidechainNodes.get(targetTrackId);
    if (!targetNode) return;

    const triggerNodes = this.trackNodes.get(triggerTrackId);
    if (!triggerNodes) return;

    // Connect the trigger track panner (auxiliary output) to Input 1 of the sidechain processor
    try {
      triggerNodes.panner.connect(targetNode, 0, 1);
    } catch (e) {
      console.warn("Failed to connect sidechain trigger route:", e);
    }
  }

  setSidechainParam(trackId: string, param: 'threshold' | 'ratio' | 'attack' | 'release', value: number) {
    const node = this.sidechainNodes.get(trackId);
    if (!node || !this.context) return;
    const paramNode = node.parameters.get(param);
    if (paramNode) {
      paramNode.setValueAtTime(value, this.context.currentTime);
    }
  }




  playClip(clipId: string, trackId: string, playAtTime: number, offset: number = 0, duration: number = 0, bufferId?: string, volumeEnvelope?: { time: number; value: number }[]) {
    const effectiveBufferId = bufferId || clipId;
    if (!this.context || !this.buffers.has(effectiveBufferId)) return;
    
    // Stop existing if any
    this.stopClip(clipId);
    
    const buffer = this.buffers.get(effectiveBufferId)!;
    if (!this.trackNodes.has(trackId)) {
      this.setupTrackRouting(trackId);
    }
    const nodes = this.trackNodes.get(trackId)!;
    
    const targetTime = Math.max(this.context.currentTime, playAtTime);
    const timeDelta = targetTime - playAtTime;
    const startOffset = offset + timeDelta;

    // OPTIMIZATION: If playback rate is 1.0 (no stretching), use high-performance native nodes
    // This avoids ScriptProcessorNode latency and CPU overhead for standard playback.
    if (Math.abs(this.playbackRate - 1.0) < 0.001) {
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      
      let targetNode: AudioNode = nodes.gain;
      if (volumeEnvelope && volumeEnvelope.length > 0) {
        const envGain = this.context.createGain();
        const clipStartContextTime = targetTime - startOffset;
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
      if (startOffset < buffer.duration) {
        source.start(targetTime, startOffset, duration > 0 ? duration : undefined);
        this.activeSources.set(clipId, { node: source });
      }
      return;
    }
    
    const totalFramesToExtract = duration > 0 ? Math.floor(duration * buffer.sampleRate) : Infinity;
    const framesExtractedSoFar = 0;
    const sampleRate = this.context!.sampleRate;

    let targetNode: AudioNode = nodes.gain;
    if (volumeEnvelope && volumeEnvelope.length > 0) {
      const envGain = this.context.createGain();
      const clipStartContextTime = targetTime - startOffset;
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

    try {
      const soundtouchNode = new AudioWorkletNode(this.context, 'soundtouch-processor', {
        outputChannelCount: [2]
      });
      soundtouchNode.port.postMessage({ type: 'INIT', tempo: this.playbackRate, sampleRate: sampleRate });
      
      let source = this.context.createBufferSource();
      source.buffer = buffer;
      source.connect(soundtouchNode);
      soundtouchNode.connect(targetNode);
      
      source.start(targetTime, startOffset, duration > 0 ? duration : undefined);
      
      this.activeSources.set(clipId, { node: source });
    } catch (e) {
      console.error("SoundTouch AudioWorklet Error:", e);
      return;
    }
  }

  setPlaybackRate(rate: number) {
    this.playbackRate = rate;
    this.activeSources.forEach((source) => {
      if (source.node && (source.node as any).port) {
        (source.node as any).port.postMessage({ type: 'SET_TEMPO', tempo: rate });
      }
    });
  }

  startPlayback(startTimeInSeconds: number, contextStartTime?: number) {
    this.init();
    this.resume();
    this.playStartTime = contextStartTime || this.context!.currentTime;
    this.playPositionAtStart = startTimeInSeconds;
    this.isPlaying = true;
    
    const bpm = this.getBpmAtTime(startTimeInSeconds);
    const secondsPerBeat = 60.0 / bpm;
    
    // Calculate which beat we are currently on
    const beatsPassed = startTimeInSeconds / secondsPerBeat;
    const decimalPart = beatsPassed % 1;
    const isCloseToBeat = decimalPart < 0.001 || decimalPart > 0.999;
    
    if (isCloseToBeat) {
      this.currentBeat = Math.round(beatsPassed);
      this.nextNoteTime = this.playStartTime;
    } else {
      this.currentBeat = Math.floor(beatsPassed);
      const nextBeatInProject = (this.currentBeat + 1) * secondsPerBeat;
      const rate = this.playbackRate > 0 ? this.playbackRate : 1.0;
      const timeUntilNextBeat = (nextBeatInProject - startTimeInSeconds) / rate;
      this.nextNoteTime = this.playStartTime + timeUntilNextBeat;
      this.currentBeat++; // Advance beat counter for the next scheduled note
    }
    
    if (this.metronomeTimerID !== null) {
      window.clearTimeout(this.metronomeTimerID);
    }
    this.scheduler();
  }

  stopAll() {
    this.activeSources.forEach((source, clipId) => {
      try {
        source.node.disconnect();
        if ((source.node as any).onaudioprocess) {
          (source.node as any).onaudioprocess = null;
        }
      } catch (e) {
        // Already stopped
      }
    });
    this.activeSources.clear();
    this.playStartTime = 0;
    
    if (this.metronomeTimerID !== null) {
      window.clearTimeout(this.metronomeTimerID);
      this.metronomeTimerID = null;
    }
    this.isPlaying = false;
  }

  stopClip(clipId: string) {
    const source = this.activeSources.get(clipId);
    if (source) {
      try {
        source.node.disconnect();
        if ((source.node as any).onaudioprocess) {
          (source.node as any).onaudioprocess = null;
        }
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

  getTransportState() {
    const time = this.getCurrentTime();
    return {
      time: time,
      isPlaying: this.isPlaying,
      bpm: this.getBpmAtTime(time),
      beat: time * (this.getBpmAtTime(time) / 60.0)
    };
  }

  getTrackLevel(trackId: string): number {
    const analyser = this.analysers.get(trackId);
    if (!analyser) return 0;
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(dataArray);
    
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const sample = (dataArray[i] - 128) / 128;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / dataArray.length);
    return rms;
  }

  getMasterLevels(): { left: number; right: number } {
    const analyser = this.masterAnalyser;
    if (!analyser) return { left: 0, right: 0 };
    
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(dataArray);
    
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const sample = (dataArray[i] - 128) / 128;
      sum += sample * sample;
    }
    const rms = Math.sqrt(sum / dataArray.length);
    return {
      left: rms,
      right: Math.max(0, rms * (0.9 + Math.random() * 0.15))
    };
  }
}

export const audioEngine = new AudioEngine();
if (typeof window !== 'undefined') {
  (window as any).audioEngine = audioEngine;
}
