/**
 * DSP Channel Worker
 * 
 * Processes a single audio channel through the channel-independent DSP stages.
 * Designed to be spawned in parallel (one for L, one for R) by the orchestrator
 * worker for ~2× throughput on stereo audio.
 * 
 * Stages handled here (all channel-independent):
 *   1. Spectral Smoothing
 *   2. Spectral Extension
 *   3. Spectral Masking
 *   4. Harmonic Saturation
 *   5. Phase Entropy
 *   6. Micro-Variation
 *   7. Dynamic Envelope
 *   8. Noise Floor
 *   9. MFCC Shaping
 *  10. UAP Filter
 * 
 * Stage NOT handled here (needs both channels):
 *   - Stereo Humanize (handled by orchestrator after merge)
 */

import {
  AuthenticitySettings,
  applySpectralSmoothing,
  applySpectralExtension,
  applySpectralMasking,
  applyHarmonicSaturation,
  applyPhaseEntropy,
  applyMicroVariation,
  applyDynamicEnvelope,
  applyNoiseFloor,
  applyMFCCShaping,
  applyUAPFilter,
} from '../lib/aiAuthenticityProcessor';

export interface ChannelWorkerInput {
  channelData: Float32Array;
  sampleRate: number;
  settings: AuthenticitySettings;
  evasionScale: number;
  detectedCutoff: number;
  frameSize: number;
  hopSize: number;
}

export interface ChannelWorkerOutput {
  channelData: Float32Array;
  stageTimings?: Record<string, number>;
}

self.onmessage = (e: MessageEvent<ChannelWorkerInput>) => {
  const { channelData, sampleRate, settings, evasionScale, detectedCutoff, frameSize, hopSize } = e.data;

  if (!channelData || channelData.length === 0) {
    self.postMessage({ error: 'No channel data provided' });
    return;
  }

  try {
    let data = channelData;
    const timings: Record<string, number> = {};
    const quality = settings.quality || 'balanced';

    // Stage 1: Spectral Smoothing
    if (settings.spectralSmoothing.enabled && settings.spectralSmoothing.slope * evasionScale > 0) {
      const t0 = performance.now();
      data = applySpectralSmoothing(data, sampleRate, settings.spectralSmoothing.slope * evasionScale, detectedCutoff, frameSize, hopSize);
      timings['spectralSmoothing'] = performance.now() - t0;
    }

    // Stage 2: Spectral Extension
    if (settings.spectralExtension.enabled && settings.spectralExtension.intensity * evasionScale > 0) {
      const t0 = performance.now();
      data = applySpectralExtension(data, sampleRate, settings.spectralExtension.intensity * evasionScale, detectedCutoff, frameSize, hopSize);
      timings['spectralExtension'] = performance.now() - t0;
    }

    // Stage 3: Spectral Masking
    if (settings.spectralMasking.enabled && settings.spectralMasking.intensity * evasionScale > 0) {
      const t0 = performance.now();
      data = applySpectralMasking(data, sampleRate, settings.spectralMasking.intensity * evasionScale, frameSize, hopSize);
      timings['spectralMasking'] = performance.now() - t0;
    }

    // Stage 4: Harmonic Saturation
    if (settings.harmonicSaturation.enabled && settings.harmonicSaturation.drive * evasionScale > 0) {
      const t0 = performance.now();
      const s = settings.harmonicSaturation;
      data = applyHarmonicSaturation(data, s.drive * evasionScale, s.even, s.odd);
      timings['harmonicSaturation'] = performance.now() - t0;
    }

    // Stage 5: Phase Entropy
    if (settings.phaseEntropy.enabled && settings.phaseEntropy.intensity * evasionScale > 0) {
      const t0 = performance.now();
      data = applyPhaseEntropy(data, sampleRate, settings.phaseEntropy.intensity * evasionScale, frameSize, hopSize);
      timings['phaseEntropy'] = performance.now() - t0;
    }

    // Stage 6: Micro-Variation
    if (settings.microVariation.enabled && settings.microVariation.amount * evasionScale > 0) {
      const t0 = performance.now();
      data = applyMicroVariation(data, sampleRate, settings.microVariation.amount * evasionScale);
      timings['microVariation'] = performance.now() - t0;
    }

    // Stage 7: Dynamic Envelope
    if (settings.dynamicEnvelope.enabled && settings.dynamicEnvelope.depth * evasionScale > 0) {
      const t0 = performance.now();
      data = applyDynamicEnvelope(data, sampleRate, settings.dynamicEnvelope.depth * evasionScale);
      timings['dynamicEnvelope'] = performance.now() - t0;
    }

    // Stage 8: Noise Floor
    if (settings.noiseFloor.enabled && settings.noiseFloor.level * evasionScale > 0) {
      const t0 = performance.now();
      data = applyNoiseFloor(data, sampleRate, settings.noiseFloor.level * evasionScale, settings.noiseFloor.profile);
      timings['noiseFloor'] = performance.now() - t0;
    }

    // Stage 9: MFCC Shaping (skipped in fast quality)
    if (settings.mfccShaping.enabled && settings.mfccShaping.strength * evasionScale > 0 && quality !== 'fast') {
      const t0 = performance.now();
      data = applyMFCCShaping(data, sampleRate, settings.mfccShaping.strength * evasionScale, frameSize, hopSize);
      timings['mfccShaping'] = performance.now() - t0;
    }

    // Stage 10: UAP Filter
    if (settings.uapFilter?.enabled && settings.uapFilter.intensity * evasionScale > 0) {
      const t0 = performance.now();
      data = applyUAPFilter(data, sampleRate, settings.uapFilter.intensity * evasionScale);
      timings['uapFilter'] = performance.now() - t0;
    }

    // Transfer the processed buffer back (zero-copy)
    const output: ChannelWorkerOutput = { channelData: data, stageTimings: timings };
    self.postMessage(output, [data.buffer] as any);
  } catch (err: any) {
    self.postMessage({ error: err.message || 'DSP channel processing failed' });
  }
};
