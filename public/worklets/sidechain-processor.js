/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

class SidechainCompressorProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -24, minValue: -60, maxValue: 0 },
      { name: 'ratio', defaultValue: 4, minValue: 1, maxValue: 20 },
      { name: 'attack', defaultValue: 0.005, minValue: 0.001, maxValue: 0.1 },
      { name: 'release', defaultValue: 0.12, minValue: 0.01, maxValue: 1.0 },
      { name: 'bypass', defaultValue: 0, minValue: 0, maxValue: 1 }
    ];
  }

  constructor() {
    super();
    this.envelope = 0.0; // Running envelope detector state
    this.reduction = 0.0; // Current reduction in dB
    this.updateCounter = 0;
  }

  process(inputs, outputs, parameters) {
    const mainInput = inputs[0]; // Channel arrays for main signal
    const sidechainInput = inputs[1]; // Channel arrays for auxiliary sidechain trigger
    const output = outputs[0];

    const bypass = parameters.bypass[0];
    if (bypass > 0.5 || !mainInput || mainInput.length === 0 || mainInput[0].length === 0) {
      // Direct pass-through
      if (mainInput && mainInput.length > 0) {
        for (let channel = 0; channel < output.length; channel++) {
          const inChannel = mainInput[channel] || mainInput[0];
          output[channel].set(inChannel);
        }
      }
      return true;
    }

    const threshold = parameters.threshold[0];
    const ratio = parameters.ratio[0];
    const attack = parameters.attack[0];
    const release = parameters.release[0];

    // Attack and release coefficients
    const sampleRate = globalThis.sampleRate || 44100;
    const gAttack = Math.exp(-1.0 / (sampleRate * attack));
    const gRelease = Math.exp(-1.0 / (sampleRate * release));

    const numChannels = mainInput.length;
    const numSamples = mainInput[0].length;

    // Detect sidechain trigger levels (RMS/Peak)
    // If no auxiliary sidechain is connected, we fallback to self-compression
    const hasSidechain = sidechainInput && sidechainInput.length > 0 && sidechainInput[0].length > 0;
    const triggerChannel = hasSidechain ? sidechainInput[0] : mainInput[0];

    for (let i = 0; i < numSamples; i++) {
      // 1. Level Detection
      const triggerSample = triggerChannel[i];
      const rectified = Math.abs(triggerSample);

      // 2. Ballistics (Attack/Release envelope smoothing)
      if (rectified > this.envelope) {
        this.envelope = rectified + gAttack * (this.envelope - rectified);
      } else {
        this.envelope = rectified + gRelease * (this.envelope - rectified);
      }

      // 3. Gain Calculation
      const envelopeDb = 20 * Math.log10(Math.max(this.envelope, 0.00001));
      let targetGainDb = 0.0;

      if (envelopeDb > threshold) {
        // We exceed threshold, compress!
        targetGainDb = (threshold - envelopeDb) * (1.0 - 1.0 / ratio);
      }

      // Smooth gain reduction (instant attack, slow release)
      const currentReductionDb = targetGainDb;
      const targetGain = Math.pow(10, currentReductionDb / 20.0);

      // Save for UI updates
      this.reduction = currentReductionDb;

      // 4. Apply compression gain
      for (let channel = 0; channel < numChannels; channel++) {
        output[channel][i] = mainInput[channel][i] * targetGain;
      }
    }

    // Throttle UI update messages to main thread (every ~1500 samples)
    this.updateCounter += numSamples;
    if (this.updateCounter > 1500) {
      this.port.postMessage({
        type: 'metrics',
        envelope: this.envelope,
        reduction: this.reduction // in dB (e.g. -6dB)
      });
      this.updateCounter = 0;
    }

    return true;
  }
}

registerProcessor('sidechain-compressor', SidechainCompressorProcessor);
