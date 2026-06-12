import { CloudVstBridge } from './cloudVstBridge';
import { applyDeHummerNode } from './audioUtils';
import {
  TrackAutomation,
  AUTOMATION_RANGES,
  sampleAutomation,
  combineAutomation,
  scheduleAutomationCurve,
} from './automationUtils';

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
  
  // Track currently playing sources (soundtouch = pitch-correction worklet
  // attached when playing at a non-1.0 rate)
  activeSources: Map<string, { node: AudioNode, soundtouch?: AudioWorkletNode }> = new Map();
  // Oscillators scheduled for MIDI-note clips. Kept separate from
  // activeSources so the transport's clip-sync logic never touches them.
  activeNoteSources: { osc: OscillatorNode; gain: GainNode }[] = [];
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
      this.masterAnalyser.smoothingTimeConstant = 0.85;
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
    const elapsed = (this.context.currentTime - this.playStartTime) * this.playbackRate;
    
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
        for (const input of this.midiAccess.inputs.values()) {
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

  /**
   * Schedules the MIDI notes of a clip as sawtooth oscillators (same voice as
   * playSynthNote). Note start/duration are in beats; they are converted to
   * project seconds via `bpm` and mapped onto the context clock honoring the
   * current playbackRate. Notes route through the track's gain/panner so
   * volume, pan, mute and solo all apply. Cancelled by stopAll().
   *
   * @param trackId         track whose routing the notes play through
   * @param notes           MIDI notes ({ note, start(beats), duration(beats) })
   * @param clipStart       clip start in project seconds
   * @param clipDuration    clip duration in project seconds (notes are clamped to it)
   * @param fromProjectTime project time playback begins at (transport position)
   * @param scheduleTime    context time corresponding to fromProjectTime
   * @param bpm             project tempo used for beats -> seconds
   */
  playClipNotes(
    trackId: string,
    notes: { note: number; start: number; duration: number }[],
    clipStart: number,
    clipDuration: number,
    fromProjectTime: number,
    scheduleTime: number,
    bpm: number,
  ) {
    if (!this.context || !this.masterGain) this.init();
    const ctx = this.context!;
    if (!this.trackNodes.has(trackId)) {
      this.setupTrackRouting(trackId);
    }
    const dest = this.trackNodes.get(trackId)?.gain || this.masterGain!;
    const rate = this.playbackRate > 0 ? this.playbackRate : 1.0;
    const secondsPerBeat = 60 / Math.max(1, bpm);
    const clipEnd = clipStart + clipDuration;

    for (const n of notes) {
      const noteStart = clipStart + n.start * secondsPerBeat;
      const noteEnd = Math.min(noteStart + Math.max(0.05, n.duration * secondsPerBeat), clipEnd);
      // Skip notes that fall outside the clip bounds or already finished
      if (noteStart >= clipEnd || noteEnd <= fromProjectTime) continue;

      // Project-time deltas land on the context clock divided by the rate
      const startCtx = scheduleTime + Math.max(0, noteStart - fromProjectTime) / rate;
      const endCtx = scheduleTime + (noteEnd - fromProjectTime) / rate;
      if (endCtx - startCtx < 0.01) continue;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.value = 440 * Math.pow(2, (n.note - 69) / 12);

      // playSynthNote-style envelope: short attack to avoid clicks, then an
      // exponential decay that reaches silence exactly at the note end.
      gain.gain.setValueAtTime(0.0001, startCtx);
      gain.gain.linearRampToValueAtTime(0.35, Math.min(startCtx + 0.01, endCtx));
      gain.gain.exponentialRampToValueAtTime(0.001, endCtx);

      osc.connect(gain);
      gain.connect(dest);
      osc.start(startCtx);
      osc.stop(endCtx + 0.05);

      const entry = { osc, gain };
      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch (e) { /* already gone */ }
        const idx = this.activeNoteSources.indexOf(entry);
        if (idx !== -1) this.activeNoteSources.splice(idx, 1);
      };
      this.activeNoteSources.push(entry);
    }
  }

  stopAllNotes() {
    this.activeNoteSources.forEach(({ osc, gain }) => {
      try {
        osc.onended = null;
        osc.stop();
      } catch (e) {
        // Not started yet or already stopped
      }
      try {
        osc.disconnect();
        gain.disconnect();
      } catch (e) {
        // Already disconnected
      }
    });
    this.activeNoteSources = [];
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

  /**
   * Synthesizes an exponentially-decaying noise impulse response. Avoids
   * shipping IR sample files while still producing dense, natural reverb tails.
   */
  private createImpulseResponse(durationSeconds: number, decay: number): AudioBuffer {
    const sampleRate = this.context!.sampleRate;
    const length = Math.max(1, Math.floor(sampleRate * durationSeconds));
    const impulse = this.context!.createBuffer(2, length, sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, decay);
      }
    }
    return impulse;
  }

  static readonly REVERB_PRESETS = {
    room:  { duration: 0.6, decay: 2.0, wet: 0.25 },
    hall:  { duration: 2.8, decay: 3.5, wet: 0.3 },
    plate: { duration: 1.4, decay: 5.0, wet: 0.3 },
  } as const;

  addTrackEffect(
    trackId: string,
    type: 'reverb' | 'delay' | 'eq' | 'compressor' | 'wasm-vst' | 'limiter',
    options?: { reverbPreset?: keyof typeof AudioEngine.REVERB_PRESETS }
  ) {
    if (!this.context || !this.trackNodes.has(trackId)) return;
    const nodes = this.trackNodes.get(trackId)!;

    if (type === 'reverb') {
      const preset = AudioEngine.REVERB_PRESETS[options?.reverbPreset || 'hall'];
      const convolver = this.context.createConvolver();
      convolver.buffer = this.createImpulseResponse(preset.duration, preset.decay);
      const wet = this.context.createGain();
      wet.gain.value = preset.wet;

      nodes.panner.disconnect();
      nodes.panner.connect(this.masterGain!); // dry signal
      nodes.panner.connect(convolver);
      convolver.connect(wet);
      wet.connect(this.masterGain!);
    } else if (type === 'wasm-vst') {
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

  /**
   * Applies fader volume/pan/mute to a track's nodes. When `automation`
   * curves are present they MULTIPLY with the volume fader (and offset the
   * pan knob) rather than replacing it:
   * - stopped: the static value is the curve sampled at the transport position
   * - playing: linearRampToValueAtTime segments are scheduled from the
   *   current position onward (callers re-invoke on seek/edit, which cancels
   *   and re-schedules the ramps)
   */
  updateTrackSettings(
    trackId: string,
    volume: number,
    pan: number,
    muted: boolean,
    automation?: TrackAutomation,
  ) {
    if (!this.trackNodes.has(trackId)) return;
    const nodes = this.trackNodes.get(trackId)!;
    const volPoints = automation?.volume ?? [];
    const panPoints = automation?.pan ?? [];

    // Clear any previously scheduled ramps before setting/scheduling values.
    if (this.context) {
      try {
        nodes.gain.gain.cancelScheduledValues(this.context.currentTime);
        nodes.panner.pan.cancelScheduledValues(this.context.currentTime);
      } catch {
        // Mocked/partial AudioParam in tests — static assignment still works.
      }
    }

    const playing = !!this.context && this.isPlaying && this.playStartTime > 0;
    if (playing && (volPoints.length > 0 || panPoints.length > 0)) {
      // Anchor at the later of "now" and the (possibly future) playback start.
      const rate = this.playbackRate > 0 ? this.playbackRate : 1.0;
      const anchorCtx = Math.max(this.context!.currentTime, this.playStartTime);
      const anchorProject =
        this.playPositionAtStart + (anchorCtx - this.playStartTime) * rate;

      if (muted) {
        nodes.gain.gain.value = 0;
      } else {
        scheduleAutomationCurve(
          nodes.gain.gain,
          volPoints,
          anchorProject,
          anchorCtx,
          rate,
          AUTOMATION_RANGES.volume.defaultValue,
          (v) => combineAutomation('volume', volume, v),
        );
      }
      scheduleAutomationCurve(
        nodes.panner.pan,
        panPoints,
        anchorProject,
        anchorCtx,
        rate,
        AUTOMATION_RANGES.pan.defaultValue,
        (v) => combineAutomation('pan', pan, v),
      );
      return;
    }

    // Stopped (or no curves): static values, sampled at the transport position.
    const position = this.getCurrentTime();
    nodes.gain.gain.value = muted
      ? 0
      : combineAutomation(
          'volume',
          volume,
          sampleAutomation(volPoints, position, AUTOMATION_RANGES.volume.defaultValue),
        );
    nodes.panner.pan.value = combineAutomation(
      'pan',
      pan,
      sampleAutomation(panPoints, position, AUTOMATION_RANGES.pan.defaultValue),
    );
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




  /**
   * Clamps fade lengths to the clip duration. When the clip is shorter than
   * the combined fades, both are scaled down proportionally so they meet
   * without overlapping.
   */
  static clampFades(fadeIn: number, fadeOut: number, clipDuration: number): { fadeIn: number; fadeOut: number } {
    let fIn = Math.max(0, Math.min(fadeIn || 0, clipDuration));
    let fOut = Math.max(0, Math.min(fadeOut || 0, clipDuration));
    if (fIn + fOut > clipDuration && fIn + fOut > 0) {
      const scale = clipDuration / (fIn + fOut);
      fIn *= scale;
      fOut *= scale;
    }
    return { fadeIn: fIn, fadeOut: fOut };
  }

  /**
   * Builds a gain node implementing linear fade-in/fade-out ramps for a clip,
   * or returns null when no audible fade applies.
   *
   * @param scheduleTime context (wall) time at which playback begins
   * @param posInClip    seconds into the clip (clip/buffer time) where playback begins
   * @param remaining    clip/buffer-time seconds left to play from posInClip
   * @param rate         playback rate; clip-time deltas are divided by it to land
   *                     on the context clock (mirrors the volumeEnvelope handling)
   */
  private createClipFadeGain(
    context: BaseAudioContext,
    scheduleTime: number,
    posInClip: number,
    remaining: number,
    fadeIn: number,
    fadeOut: number,
    rate: number,
  ): GainNode | null {
    if (remaining <= 0) return null;
    const clipDuration = posInClip + remaining;
    const { fadeIn: fIn, fadeOut: fOut } = AudioEngine.clampFades(fadeIn, fadeOut, clipDuration);
    if (fIn <= 0 && fOut <= 0) return null;

    const toContextTime = (t: number) => scheduleTime + (t - posInClip) / rate;
    const gainAt = (t: number) => {
      let g = 1;
      if (fIn > 0 && t < fIn) g *= Math.max(0, t) / fIn;
      if (fOut > 0 && t > clipDuration - fOut) g *= Math.max(0, clipDuration - t) / fOut;
      return Math.max(0.0001, g);
    };

    const fadeGain = context.createGain();
    // Pin the correct gain at the start point (handles mid-fade starts).
    fadeGain.gain.setValueAtTime(gainAt(posInClip), scheduleTime);
    if (posInClip < fIn) {
      fadeGain.gain.linearRampToValueAtTime(1, toContextTime(fIn));
    }
    if (fOut > 0) {
      const fadeOutStart = clipDuration - fOut;
      if (fadeOutStart > posInClip && fadeOutStart > fIn) {
        // Hold unity gain until the fade-out begins so the final ramp does
        // not start decaying right after the fade-in completes.
        fadeGain.gain.setValueAtTime(1, toContextTime(fadeOutStart));
      }
      fadeGain.gain.linearRampToValueAtTime(0.0001, toContextTime(clipDuration));
    }
    return fadeGain;
  }

  playClip(
    clipId: string,
    trackId: string,
    playAtTime: number,
    offset: number = 0,
    duration: number = 0,
    bufferId?: string,
    volumeEnvelope?: { time: number; value: number }[],
    deHummerEnabled?: boolean,
    fades?: { fadeIn?: number; fadeOut?: number; clipOffset?: number }
  ) {
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
      if (deHummerEnabled) {
        targetNode = applyDeHummerNode(this.context, targetNode);
      }

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
        envGain.connect(targetNode);
        targetNode = envGain;
      }

      if (fades && ((fades.fadeIn || 0) > 0 || (fades.fadeOut || 0) > 0)) {
        const posInClip = Math.max(0, (fades.clipOffset || 0) + timeDelta);
        const remaining = duration > 0 ? duration : buffer.duration - startOffset;
        const fadeGain = this.createClipFadeGain(
          this.context, targetTime, posInClip, remaining,
          fades.fadeIn || 0, fades.fadeOut || 0, 1.0
        );
        if (fadeGain) {
          fadeGain.connect(targetNode);
          targetNode = fadeGain;
        }
      }

      source.connect(targetNode);
      if (startOffset < buffer.duration) {
        source.start(targetTime, startOffset, duration > 0 ? duration : undefined);
        this.activeSources.set(clipId, { node: source });
      }
      return;
    }
    
    const sampleRate = this.context!.sampleRate;

    let targetNode: AudioNode = nodes.gain;
    if (deHummerEnabled) {
      targetNode = applyDeHummerNode(this.context, targetNode);
    }

    // Clip-time deltas are in project (buffer) time; the context clock runs
    // in wall time, which differs by the playback rate.
    const rate = this.playbackRate > 0 ? this.playbackRate : 1.0;

    if (volumeEnvelope && volumeEnvelope.length > 0) {
      const envGain = this.context.createGain();
      const clipStartContextTime = targetTime - startOffset / rate;
      envGain.gain.setValueAtTime(volumeEnvelope[0].value, targetTime);
      for (const pt of volumeEnvelope) {
        const pointTime = clipStartContextTime + pt.time / rate;
        if (pointTime >= targetTime) {
          envGain.gain.linearRampToValueAtTime(Math.max(0.0001, pt.value), pointTime);
        }
      }
      envGain.connect(targetNode);
      targetNode = envGain;
    }

    if (fades && ((fades.fadeIn || 0) > 0 || (fades.fadeOut || 0) > 0)) {
      const posInClip = Math.max(0, (fades.clipOffset || 0) + timeDelta);
      const remaining = duration > 0 ? duration : buffer.duration - startOffset;
      const fadeGain = this.createClipFadeGain(
        this.context, targetTime, posInClip, remaining,
        fades.fadeIn || 0, fades.fadeOut || 0, rate
      );
      if (fadeGain) {
        fadeGain.connect(targetNode);
        targetNode = fadeGain;
      }
    }

    // Nothing to play — bail before constructing nodes so no worklet leaks.
    if (startOffset >= buffer.duration) return;

    // Tempo-shifted playback: the source plays at `playbackRate` (correct
    // timeline speed, pitch shifted), and the soundtouch worklet corrects the
    // pitch back by 1/rate. Scheduling stays sample-accurate on the source.
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = this.playbackRate;

    let soundtouchNode: AudioWorkletNode | undefined;
    try {
      soundtouchNode = new AudioWorkletNode(this.context, 'soundtouch-processor', {
        outputChannelCount: [2]
      });
      soundtouchNode.port.postMessage({ type: 'INIT', tempo: this.playbackRate, sampleRate: sampleRate });
      source.connect(soundtouchNode);
      soundtouchNode.connect(targetNode);
    } catch (e) {
      // Worklet failed to load — play tempo-correct but pitch-shifted rather
      // than silently dropping the clip.
      console.error("SoundTouch AudioWorklet Error (falling back to pitched playback):", e);
      soundtouchNode = undefined;
      source.connect(targetNode);
    }

    source.start(targetTime, startOffset, duration > 0 ? duration : undefined);

    // Release the worklet when the source finishes naturally, otherwise the
    // processor keeps running on silence forever.
    source.onended = () => {
      if (this.activeSources.get(clipId)?.node === source) {
        this.activeSources.delete(clipId);
      }
      try {
        soundtouchNode?.port.postMessage({ type: 'STOP' });
        soundtouchNode?.disconnect();
      } catch (e) { /* already gone */ }
    };

    this.activeSources.set(clipId, { node: source, soundtouch: soundtouchNode });
  }

  setPlaybackRate(rate: number) {
    this.playbackRate = rate;
    this.activeSources.forEach((source) => {
      // Live-update playing sources: speed on the buffer source, matching
      // pitch correction on the worklet (when one is attached).
      if (source.node instanceof AudioBufferSourceNode) {
        source.node.playbackRate.value = rate;
      }
      if (source.soundtouch?.port) {
        source.soundtouch.port.postMessage({ type: 'SET_TEMPO', tempo: rate });
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

  private releaseSource(source: { node: AudioNode, soundtouch?: AudioWorkletNode }) {
    try {
      if (source.node instanceof AudioBufferSourceNode) {
        source.node.onended = null;
      }
      source.node.disconnect();
    } catch (e) {
      // Already stopped
    }
    try {
      source.soundtouch?.port.postMessage({ type: 'STOP' });
      source.soundtouch?.disconnect();
    } catch (e) {
      // Already gone
    }
  }

  stopAll() {
    this.activeSources.forEach((source) => {
      this.releaseSource(source);
    });
    this.activeSources.clear();
    this.stopAllNotes();
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
      this.releaseSource(source);
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
      AudioEngine.applyAutomationToOfflineNodes(track, trackGain, trackPanner);

      trackGain.connect(trackPanner);
      trackPanner.connect(masterGain);

      for (const clip of track.clips) {
        const buffer = this.buffers.get(clip.bufferId || clip.id);
        if (buffer) {
          const source = offlineCtx.createBufferSource();
          source.buffer = buffer;
          let dest: AudioNode = trackGain;
          const fadeGain = this.createClipFadeGain(
            offlineCtx, clip.start, 0, clip.duration,
            clip.fadeIn || 0, clip.fadeOut || 0, 1.0
          );
          if (fadeGain) {
            fadeGain.connect(trackGain);
            dest = fadeGain;
          }
          source.connect(dest);
          source.start(clip.start, clip.audioOffset || 0, clip.duration);
        }
      }
    }

    return await offlineCtx.startRendering();
  }

  /**
   * Schedules a track's automation curves onto offline gain/panner nodes so
   * WAV/stem exports render automation exactly like live playback (project
   * time 0 maps to context time 0, rate 1).
   */
  private static applyAutomationToOfflineNodes(
    track: any,
    trackGain: GainNode,
    trackPanner: StereoPannerNode,
  ) {
    const volPoints = track.automation?.volume ?? [];
    const panPoints = track.automation?.pan ?? [];
    if (volPoints.length > 0) {
      scheduleAutomationCurve(
        trackGain.gain, volPoints, 0, 0, 1.0,
        AUTOMATION_RANGES.volume.defaultValue,
        (v: number) => combineAutomation('volume', track.volume, v),
      );
    }
    if (panPoints.length > 0) {
      scheduleAutomationCurve(
        trackPanner.pan, panPoints, 0, 0, 1.0,
        AUTOMATION_RANGES.pan.defaultValue,
        (v: number) => combineAutomation('pan', track.pan, v),
      );
    }
  }

  async renderTrack(track: any, duration: number): Promise<AudioBuffer> {
    const offlineCtx = new OfflineAudioContext(2, Math.ceil(duration * 44100), 44100);
    const trackGain = offlineCtx.createGain();
    const trackPanner = offlineCtx.createStereoPanner();
    trackGain.gain.value = track.volume;
    trackPanner.pan.value = track.pan;
    AudioEngine.applyAutomationToOfflineNodes(track, trackGain, trackPanner);

    trackGain.connect(trackPanner);
    trackPanner.connect(offlineCtx.destination);

    for (const clip of track.clips) {
      const buffer = this.buffers.get(clip.bufferId || clip.id);
      if (buffer) {
        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;
        let dest: AudioNode = trackGain;
        const fadeGain = this.createClipFadeGain(
          offlineCtx, clip.start, 0, clip.duration,
          clip.fadeIn || 0, clip.fadeOut || 0, 1.0
        );
        if (fadeGain) {
          fadeGain.connect(trackGain);
          dest = fadeGain;
        }
        source.connect(dest);
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

  getMasterFrequencyData(dataArray: Uint8Array) {
    if (this.masterAnalyser) {
      this.masterAnalyser.getByteFrequencyData(dataArray);
    }
  }
}

export const audioEngine = new AudioEngine();
if (typeof window !== 'undefined') {
  (window as any).audioEngine = audioEngine;
}
