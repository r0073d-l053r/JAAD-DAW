/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Default DSP bridge URL for this origin. On an https page the browser blocks
 * insecure ws:// (mixed content) and "localhost" points at the viewer's own
 * machine — so proxied deployments (Tailscale Serve / nginx expose the sidecar
 * at /dsp) get a same-host wss:// default instead of the local-dev one.
 */
export function getDefaultDspUrl(): string {
  if (typeof location !== 'undefined' && location.protocol === 'https:') {
    return `wss://${location.host}/dsp`;
  }
  return 'ws://localhost:8080';
}

export interface VstParameter {
  name: string;
  value: number; // 0.0 to 1.0 (normalized)
  min: number;
  max: number;
  unit: string;
  index?: number; // real plugin parameter index, used for param_change over the wire
}

export class CloudVstBridge {
  private ctx: AudioContext;
  private trackId: string;
  private socket: WebSocket | null = null;
  private inputNode: GainNode;
  private outputNode: GainNode;
  
  // Local native fallbacks
  private fallbackFilter: BiquadFilterNode;
  private dryGain: GainNode;
  private wetGain: GainNode;
  private processorNode: ScriptProcessorNode | null = null;

  // Real-time metrics
  public status: 'disconnected' | 'connecting' | 'connected' | 'fallback' = 'disconnected';
  public latencyMs: number = 0;
  public onStatusChange: ((status: string) => void) | null = null;
  public onLatencyUpdate: ((latency: number) => void) | null = null;
  public onParametersChange: (() => void) | null = null;

  /** Set once a real plugin is loaded and enumerated by the sidecar. */
  public pluginLoaded = false;

  // Latency ring buffer / queuing
  private inputBufferQueue: Float32Array[] = [];
  private outputBufferQueue: Float32Array[] = [];
  private maxQueueSize = 8;
  private pingTimestamp = 0;

  // Trackable parameters
  public parameters: Record<string, VstParameter> = {
    cutoff: { name: 'Cutoff', value: 0.8, min: 20, max: 20000, unit: 'Hz' },
    drive: { name: 'Drive Saturation', value: 0.3, min: 0, max: 100, unit: '%' },
    feedback: { name: 'Feedback Delay', value: 0.4, min: 0, max: 95, unit: '%' },
    mix: { name: 'Dry/Wet Mix', value: 0.5, min: 0, max: 100, unit: '%' }
  };

  constructor(ctx: AudioContext, trackId: string, destination: AudioNode) {
    this.ctx = ctx;
    this.trackId = trackId;

    // Create Routing nodes
    this.inputNode = this.ctx.createGain();
    this.outputNode = this.ctx.createGain();

    // Create native zero-latency fallbacks
    this.fallbackFilter = this.ctx.createBiquadFilter();
    this.fallbackFilter.type = 'lowpass';
    this.fallbackFilter.frequency.value = 1200; // pleasant warm lowpass

    this.dryGain = this.ctx.createGain();
    this.wetGain = this.ctx.createGain();

    // Default Mix configuration (Dry/Wet)
    this.dryGain.gain.value = 0.5;
    this.wetGain.gain.value = 0.5;

    // Connect local bypass path
    this.inputNode.connect(this.fallbackFilter);
    this.fallbackFilter.connect(this.dryGain);
    this.dryGain.connect(this.outputNode);

    // Final connection
    this.outputNode.connect(destination);

    // Setup scripting node for live streaming
    this.setupAudioProcessor();
    
    // Connect to backend sidecar
    this.connect();
  }

  public connect(url?: string) {
    if (this.socket) {
      this.socket.close();
    }

    this.setStatus('connecting');

    // Resolve the sidecar URL and optional shared token from local settings so
    // hardened deployments (JAAD_DSP_TOKEN set on the server) can authenticate.
    // Default is origin-aware: ws://localhost:8080 in local dev, wss://host/dsp
    // on proxied https deployments (see getDefaultDspUrl).
    const storedUrl =
      typeof localStorage !== 'undefined' ? localStorage.getItem('jaad_dsp_url') : null;
    let target = url ?? storedUrl ?? getDefaultDspUrl();
    const token =
      typeof localStorage !== 'undefined' ? localStorage.getItem('jaad_dsp_token') : null;
    if (token) {
      target += (target.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
    }

    try {
      this.socket = new WebSocket(target);
      this.socket.binaryType = 'arraybuffer';

      this.socket.onopen = () => {
        this.setStatus('connected');
        // Send initial parameter packet
        this.syncParameters();
      };

      this.socket.onmessage = (event) => {
        if (event.data instanceof ArrayBuffer) {
          // Processed binary audio data returned from Docker sidecar
          const processedData = new Float32Array(event.data);
          this.outputBufferQueue.push(processedData);
          if (this.outputBufferQueue.length > this.maxQueueSize) {
            this.outputBufferQueue.shift(); // discard stale buffers
          }

          // Measure round-trip ping latency
          if (this.pingTimestamp > 0) {
            this.latencyMs = performance.now() - this.pingTimestamp;
            if (this.onLatencyUpdate) this.onLatencyUpdate(this.latencyMs);
            this.pingTimestamp = 0; // reset
          }
        } else if (typeof event.data === 'string') {
          // JSON control messages: param_list (real knobs), param_change echoes, pong.
          this.handleControlMessage(event.data);
        }
      };

      this.socket.onerror = (err) => {
        this.setStatus('fallback');
      };

      this.socket.onclose = () => {
        this.setStatus('disconnected');
      };
    } catch (e) {
      this.setStatus('fallback');
    }
  }

  private setStatus(newStatus: typeof this.status) {
    this.status = newStatus;
    if (this.onStatusChange) this.onStatusChange(newStatus);
    
    // Dynamically cross-fade dry/wet bypass based on connection health
    if (newStatus === 'connected') {
      this.dryGain.gain.setValueAtTime(0.0, this.ctx.currentTime);
      this.wetGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
    } else {
      // Local fallback activated
      this.dryGain.gain.setValueAtTime(1.0, this.ctx.currentTime);
      this.wetGain.gain.setValueAtTime(0.0, this.ctx.currentTime);
    }
  }

  public setParameter(name: string, value: number) {
    if (this.parameters[name]) {
      this.parameters[name].value = value;
      this.sendParamChange(name, value);

      // Keep the native fallback filter in step with a cutoff-like control so
      // the sound still moves when the sidecar is offline.
      if (name === 'cutoff') {
        const p = this.parameters[name];
        const hz = p.min + value * (p.max - p.min);
        this.fallbackFilter.frequency.setValueAtTime(hz, this.ctx.currentTime);
      }
    }
  }

  /**
   * Send a single parameter change to the sidecar. `key` is the real plugin
   * parameter index when known (what Carla's OSC/host API expects), else the name.
   */
  private sendParamChange(name: string, value: number) {
    if (!(this.socket && this.socket.readyState === WebSocket.OPEN)) return;
    const p = this.parameters[name];
    const key = p && p.index !== undefined ? p.index : name;
    this.socket.send(JSON.stringify({ type: 'param_change', key, value }));
  }

  private syncParameters() {
    if (!(this.socket && this.socket.readyState === WebSocket.OPEN)) return;
    for (const name of Object.keys(this.parameters)) {
      this.sendParamChange(name, this.parameters[name].value);
    }
  }

  /**
   * Ask the sidecar to load a native VST/DLL plugin. `path` is relative to the
   * container's mounted /vst directory. The sidecar responds with a `param_list`
   * that repopulates the knobs with the plugin's real parameters.
   */
  public loadPlugin(path: string) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'load_plugin', path }));
    }
  }

  private handleControlMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === 'param_list' && Array.isArray(msg.parameters)) {
      // Replace the generic fallback knobs with the plugin's real parameters.
      const next: Record<string, VstParameter> = {};
      for (const p of msg.parameters) {
        const key = String(p.name ?? p.index);
        next[key] = {
          name: p.name ?? `Param ${p.index}`,
          value: typeof p.value === 'number' ? p.value : 0,
          min: typeof p.min === 'number' ? p.min : 0,
          max: typeof p.max === 'number' ? p.max : 1,
          unit: p.unit ?? '',
          index: p.index,
        };
      }
      if (Object.keys(next).length > 0) {
        this.parameters = next;
        this.pluginLoaded = true;
        if (this.onParametersChange) this.onParametersChange();
      }
    } else if (msg.type === 'param_change' && msg.key !== undefined && typeof msg.value === 'number') {
      // A change echoed from the server or another connected client.
      const entry =
        Object.values(this.parameters).find((p) => p.index === Number(msg.key)) ??
        this.parameters[String(msg.key)];
      if (entry) entry.value = msg.value;
    }
    // 'pong' and anything else: ignored (latency is measured on the binary path).
  }

  /**
   * Derive the noVNC viewer URL from the DSP websocket URL so the editor can embed
   * the real plugin GUI running under the sidecar's virtual display.
   * - explicit override:      localStorage 'jaad_dsp_novnc_url'
   * - proxied (path) bridge:  wss://host/dsp   -> https://host/vnc/vnc.html
   * - direct (port) bridge:   ws://host:8080   -> http://host:6080/vnc.html
   */
  public getVncUrl(): string {
    const explicit =
      typeof localStorage !== 'undefined' ? localStorage.getItem('jaad_dsp_novnc_url') : null;
    if (explicit) return explicit;

    const base = (this.socket && this.socket.url) || getDefaultDspUrl();
    try {
      const u = new URL(base);
      const proto = u.protocol === 'wss:' ? 'https:' : 'http:';
      // A path-based bridge URL means a reverse proxy fronts the sidecar; the
      // GUI is proxied alongside it at /vnc (Tailscale Serve / nginx routing).
      if (u.pathname && u.pathname !== '/') {
        return `${proto}//${u.host}/vnc/vnc.html?autoconnect=true&resize=scale`;
      }
      return `${proto}//${u.hostname}:6080/vnc.html?autoconnect=true&resize=scale`;
    } catch {
      return 'http://localhost:6080/vnc.html?autoconnect=true&resize=scale';
    }
  }

  private setupAudioProcessor() {
    // 512 sample size matches professional high-speed dynamic buffers
    this.processorNode = this.ctx.createScriptProcessor(512, 1, 1);
    
    this.processorNode.onaudioprocess = (e) => {
      const inputBuffer = e.inputBuffer.getChannelData(0);
      const outputBuffer = e.outputBuffer.getChannelData(0);

      // Stream frame block to Docker sidecar
      if (this.status === 'connected' && this.socket && this.socket.readyState === WebSocket.OPEN) {
        // Send raw Audio bytes
        this.socket.send(inputBuffer.buffer);
        this.pingTimestamp = performance.now(); // stamp ping time
      }

      // Dequeue incoming processed buffer or play silent buffer (dry crossfade already active)
      if (this.outputBufferQueue.length > 0) {
        const nextFrame = this.outputBufferQueue.shift()!;
        for (let i = 0; i < outputBuffer.length; i++) {
          outputBuffer[i] = nextFrame[i] || 0;
        }
      } else {
        // Feed silence if buffer underruns
        for (let i = 0; i < outputBuffer.length; i++) {
          outputBuffer[i] = 0;
        }
      }
    };

    // Connections for live loop
    this.inputNode.connect(this.processorNode);
    this.processorNode.connect(this.wetGain);
    this.wetGain.connect(this.outputNode);
  }

  public getInputNode(): AudioNode {
    return this.inputNode;
  }

  public disconnect() {
    if (this.socket) {
      this.socket.close();
    }
    this.inputNode.disconnect();
    this.outputNode.disconnect();
    this.fallbackFilter.disconnect();
    this.dryGain.disconnect();
    this.wetGain.disconnect();
    if (this.processorNode) {
      this.processorNode.disconnect();
    }
  }
}
