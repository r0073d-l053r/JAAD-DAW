/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface VstParameter {
  name: string;
  value: number; // 0.0 to 1.0
  min: number;
  max: number;
  unit: string;
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

  public connect(url: string = 'ws://localhost:8080') {
    if (this.socket) {
      this.socket.close();
    }

    this.setStatus('connecting');

    try {
      this.socket = new WebSocket(url);
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
      this.syncParameters();

      // Sync local fallback controls
      if (name === 'cutoff') {
        const p = this.parameters[name];
        const hz = p.min + value * (p.max - p.min);
        this.fallbackFilter.frequency.setValueAtTime(hz, this.ctx.currentTime);
      }
    }
  }

  private syncParameters() {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      const payload = {
        type: 'parameters',
        trackId: this.trackId,
        params: Object.keys(this.parameters).reduce((acc, key) => {
          acc[key] = this.parameters[key].value;
          return acc;
        }, {} as Record<string, number>)
      };
      this.socket.send(JSON.stringify(payload));
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
