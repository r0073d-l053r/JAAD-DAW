/**
 * Authenticity Processor Orchestrator Worker
 * 
 * Manages the full processing pipeline:
 *   1. Computes initial AI score and evasion scale
 *   2. Dispatches L/R channels to parallel dspChannel workers
 *   3. Merges channels for stereo-dependent processing (Stereo Humanize)
 *   4. Normalizes output to prevent clipping
 *   5. Computes final AI score
 *   6. Returns result with performance telemetry
 */

import {
  AuthenticitySettings,
  computeAIScore,
  detectCutoffFrequency,
  applyStereoHumanize,
} from '../lib/aiAuthenticityProcessor';
import { isWebGPUSupported } from '../lib/gpuFFT';
import type { ChannelWorkerOutput } from './dspChannel.worker';

interface OrchestratorInput {
  channels: Float32Array[];
  sampleRate: number;
  settings: AuthenticitySettings;
}

interface OrchestratorOutput {
  channels: Float32Array[];
  detectedCutoff: number;
  aiScore: number;
  perf?: {
    totalMs: number;
    parallelChannelMs: number;
    stereoMs: number;
    normalizeMs: number;
    gpuAccelerated: boolean;
    channelTimings?: { left: Record<string, number>; right: Record<string, number> };
  };
}

self.onmessage = async (e: MessageEvent<OrchestratorInput>) => {
  const { channels, sampleRate, settings } = e.data;
  const totalStart = performance.now();

  if (!channels || channels.length === 0) {
    self.postMessage({ error: 'No channel data provided' });
    return;
  }

  try {
    const left = new Float32Array(channels[0]);
    const right = channels.length > 1 ? new Float32Array(channels[1]) : new Float32Array(left);

    const detectedCutoff = detectCutoffFrequency(left, sampleRate);
    const initialScore = computeAIScore(left, sampleRate, channels.length > 1 ? right : undefined);

    // Adaptive evasion scaling
    const evasionScale = Math.min(1.0, Math.max(0.0, (initialScore - 15) / 35));

    if (evasionScale === 0) {
      const result: OrchestratorOutput = {
        channels: channels.map(c => new Float32Array(c)),
        detectedCutoff,
        aiScore: initialScore,
        perf: {
          totalMs: performance.now() - totalStart,
          parallelChannelMs: 0,
          stereoMs: 0,
          normalizeMs: 0,
          gpuAccelerated: false,
        },
      };
      const transferable = result.channels.map(ch => ch.buffer);
      self.postMessage(result, transferable as any);
      return;
    }

    const quality = settings.quality || 'balanced';
    let frameSize = 2048;
    let hopSize = 1024;
    if (quality === 'fast') { frameSize = 1024; hopSize = 512; }
    else if (quality === 'maximum') { frameSize = 2048; hopSize = 512; }

    const gpuAvailable = isWebGPUSupported();

    // ── Parallel Channel Processing ──────────────────────────────────
    const parallelStart = performance.now();

    const channelWorkerInput = {
      sampleRate,
      settings,
      evasionScale,
      detectedCutoff,
      frameSize,
      hopSize,
    };

    // Spawn two parallel workers for L and R channels
    const processChannel = (channelData: Float32Array): Promise<ChannelWorkerOutput> => {
      return new Promise((resolve, reject) => {
        const worker = new Worker(
          new URL('./dspChannel.worker.ts', import.meta.url),
          { type: 'module' }
        );
        worker.onmessage = (ev: MessageEvent) => {
          if (ev.data.error) {
            reject(new Error(ev.data.error));
          } else {
            resolve(ev.data as ChannelWorkerOutput);
          }
          worker.terminate();
        };
        worker.onerror = (err) => {
          reject(err);
          worker.terminate();
        };
        // Transfer the buffer for zero-copy send
        const copy = new Float32Array(channelData);
        worker.postMessage(
          { ...channelWorkerInput, channelData: copy },
          [copy.buffer] as any
        );
      });
    };

    // Run L and R in parallel
    const [resultL, resultR] = await Promise.all([
      processChannel(left),
      processChannel(right),
    ]);

    const parallelMs = performance.now() - parallelStart;

    let processedL = resultL.channelData;
    let processedR = resultR.channelData;

    // ── Stereo-Dependent Stage: Stereo Humanize ──────────────────────
    const stereoStart = performance.now();
    if (settings.stereoHumanize.enabled && settings.stereoHumanize.width * evasionScale > 0) {
      const stereoResult = applyStereoHumanize(
        processedL, processedR, sampleRate,
        settings.stereoHumanize.width * evasionScale
      );
      processedL = stereoResult.left;
      processedR = stereoResult.right;
    }
    const stereoMs = performance.now() - stereoStart;

    // ── Normalize ────────────────────────────────────────────────────
    const normStart = performance.now();
    let peak = 0;
    for (let i = 0; i < processedL.length; i++) {
      const a = Math.abs(processedL[i]);
      if (a > peak) peak = a;
    }
    for (let i = 0; i < processedR.length; i++) {
      const a = Math.abs(processedR[i]);
      if (a > peak) peak = a;
    }
    if (peak > 0.99) {
      const norm = 0.98 / peak;
      for (let i = 0; i < processedL.length; i++) processedL[i] *= norm;
      for (let i = 0; i < processedR.length; i++) processedR[i] *= norm;
    }
    const normMs = performance.now() - normStart;

    // ── Final Score ──────────────────────────────────────────────────
    const finalScore = computeAIScore(processedL, sampleRate, channels.length > 1 ? processedR : undefined);

    const outChannels = channels.length > 1 ? [processedL, processedR] : [processedL];

    const result: OrchestratorOutput = {
      channels: outChannels,
      detectedCutoff,
      aiScore: finalScore,
      perf: {
        totalMs: performance.now() - totalStart,
        parallelChannelMs: parallelMs,
        stereoMs,
        normalizeMs: normMs,
        gpuAccelerated: gpuAvailable,
        channelTimings: {
          left: resultL.stageTimings || {},
          right: resultR.stageTimings || {},
        },
      },
    };

    const transferable = result.channels.map(ch => ch.buffer);
    self.postMessage(result, transferable as any);
  } catch (err: any) {
    self.postMessage({ error: err.message || 'Processing failed' });
  }
};
