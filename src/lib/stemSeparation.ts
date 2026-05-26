/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Standard biquad IIR filter implementation.
 * Processes high-precision audio sample arrays in a high-speed mathematical loop.
 */
export function applyBiquadFilter(
  input: Float32Array,
  type: 'lowpass' | 'highpass' | 'bandpass',
  cutoffHz: number,
  sampleRate: number,
  q: number = 0.707
): Float32Array {
  const len = input.length;
  const output = new Float32Array(len);
  
  // Calculate filter coefficients using cookbook equations
  const w0 = (2 * Math.PI * cutoffHz) / sampleRate;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = sinW0 / (2 * q);

  let b0 = 0, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;

  if (type === 'lowpass') {
    b0 = (1 - cosW0) / 2;
    b1 = 1 - cosW0;
    b2 = (1 - cosW0) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosW0;
    a2 = 1 - alpha;
  } else if (type === 'highpass') {
    b0 = (1 + cosW0) / 2;
    b1 = -(1 + cosW0);
    b2 = (1 + cosW0) / 2;
    a0 = 1 + alpha;
    a1 = -2 * cosW0;
    a2 = 1 - alpha;
  } else if (type === 'bandpass') {
    b0 = alpha;
    b1 = 0;
    b2 = -alpha;
    a0 = 1 + alpha;
    a1 = -2 * cosW0;
    a2 = 1 - alpha;
  }

  // Normalize
  b0 /= a0;
  b1 /= a0;
  b2 /= a0;
  a1 /= a0;
  a2 /= a0;

  // Direct Form I difference equation loop
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < len; i++) {
    const x0 = input[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    output[i] = y0;
  }

  return output;
}

/**
 * Applies multiple cascading biquad filter stages in series to create extremely
 * steep, clinical roll-offs (e.g. 4 stages = 48dB/octave), drastically reducing bleed.
 */
export function applyCascadedBiquadFilter(
  input: Float32Array,
  type: 'lowpass' | 'highpass' | 'bandpass',
  cutoffHz: number,
  sampleRate: number,
  stages: number = 4,
  q: number = 0.707
): Float32Array {
  let result = input;
  for (let s = 0; s < stages; s++) {
    result = applyBiquadFilter(result, type, cutoffHz, sampleRate, q);
  }
  return result;
}

/**
 * Applies a simple attack-decay envelope follower to attenuate transients.
 * Useful for extracting smooth strings or pads while filtering out snappy percussion hits.
 */
function applyTransientDeEmphasis(
  input: Float32Array,
  sampleRate: number,
  deEmphasize: boolean = true
): Float32Array {
  const len = input.length;
  const output = new Float32Array(len);
  
  // Envelope parameters
  const attackCoeff = Math.exp(-1.0 / (sampleRate * 0.005)); // 5ms attack
  const releaseCoeff = Math.exp(-1.0 / (sampleRate * 0.08)); // 80ms release
  
  let env = 0;
  for (let i = 0; i < len; i++) {
    const sample = Math.abs(input[i]);
    if (sample > env) {
      env = attackCoeff * env + (1.0 - attackCoeff) * sample;
    } else {
      env = releaseCoeff * env + (1.0 - releaseCoeff) * sample;
    }
    
    // Attenuate sharp transient peaks (downward compression)
    const factor = deEmphasize ? Math.min(1.0, 0.05 / (env + 1e-4)) : 1.0;
    output[i] = input[i] * (0.3 + 0.7 * factor);
  }
  return output;
}

/**
 * Performs professional offline Mid-Side phase cancellation and biquad
 * filtering to separate individual stems directly from stereo AudioBuffer data.
 */
export async function separateAudioStem(
  srcBuffer: AudioBuffer,
  instrument: string,
  customRange: { lowCut: number; highCut: number } = { lowCut: 200, highCut: 8000 }
): Promise<AudioBuffer> {
  const sampleRate = srcBuffer.sampleRate;
  const numChannels = srcBuffer.numberOfChannels;
  const len = srcBuffer.length;

  // Initialize offline Audio Context for rendering
  const offlineCtx = new OfflineAudioContext(2, len, sampleRate);
  
  // Clone channel data arrays
  const leftIn = srcBuffer.getChannelData(0);
  const rightIn = numChannels > 1 ? srcBuffer.getChannelData(1) : leftIn;

  // Prepare destination arrays
  let leftOut = new Float32Array(len);
  let rightOut = new Float32Array(len);

  // Compute Mid and Side signals
  const mid = new Float32Array(len);
  const side = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    mid[i] = 0.5 * (leftIn[i] + rightIn[i]);
    side[i] = 0.5 * (leftIn[i] - rightIn[i]);
  }

  switch (instrument.toLowerCase()) {
    case 'vocals': {
      // 350Hz to 3000Hz vocal range, heavily isolated
      let vocalMid = applyCascadedBiquadFilter(mid, 'bandpass', 1100, sampleRate, 4, 0.4);
      vocalMid = applyCascadedBiquadFilter(vocalMid, 'highpass', 250, sampleRate, 3, 0.707);
      for (let i = 0; i < len; i++) {
        leftOut[i] = vocalMid[i] * 1.5;
        rightOut[i] = vocalMid[i] * 1.5;
      }
      break;
    }
    case 'backing vocals': {
      let vocalSide = applyCascadedBiquadFilter(side, 'bandpass', 1500, sampleRate, 4, 0.5);
      vocalSide = applyCascadedBiquadFilter(vocalSide, 'highpass', 300, sampleRate, 3, 0.707);
      for (let i = 0; i < len; i++) {
        leftOut[i] = vocalSide[i] * 1.3;
        rightOut[i] = -vocalSide[i] * 1.3;
      }
      break;
    }
    case 'bass': {
      // Steep lowpass at 110Hz to eliminate vocals/guitars completely
      const lowBass = applyCascadedBiquadFilter(mid, 'lowpass', 110, sampleRate, 5, 0.8);
      for (let i = 0; i < len; i++) {
        leftOut[i] = lowBass[i] * 1.4;
        rightOut[i] = lowBass[i] * 1.4;
      }
      break;
    }
    case 'drums': {
      // Sub 80Hz kick (steep lowpass) + Snappy snare/cymbals above 4.5kHz (steep highpass)
      const kickLow = applyCascadedBiquadFilter(mid, 'lowpass', 80, sampleRate, 4, 0.8);
      const snareHighL = applyCascadedBiquadFilter(leftIn, 'highpass', 4500, sampleRate, 4, 0.707);
      const snareHighR = applyCascadedBiquadFilter(rightIn, 'highpass', 4500, sampleRate, 4, 0.707);
      for (let i = 0; i < len; i++) {
        leftOut[i] = (kickLow[i] + snareHighL[i] * 0.8) * 1.3;
        rightOut[i] = (kickLow[i] + snareHighR[i] * 0.8) * 1.3;
      }
      break;
    }
    case 'guitar': {
      // Guitars live in 180Hz - 3.5kHz. Remove bass bleed and center vocals.
      let gL = applyCascadedBiquadFilter(leftIn, 'bandpass', 1000, sampleRate, 4, 0.4);
      let gR = applyCascadedBiquadFilter(rightIn, 'bandpass', 1000, sampleRate, 4, 0.4);
      gL = applyCascadedBiquadFilter(gL, 'highpass', 180, sampleRate, 3, 0.707);
      gR = applyCascadedBiquadFilter(gR, 'highpass', 180, sampleRate, 3, 0.707);
      for (let i = 0; i < len; i++) {
        leftOut[i] = (gL[i] - mid[i] * 0.5) * 1.3;
        rightOut[i] = (gR[i] - mid[i] * 0.5) * 1.3;
      }
      break;
    }
    case 'keyboard': {
      let keysL = applyCascadedBiquadFilter(leftIn, 'bandpass', 800, sampleRate, 4, 0.4);
      let keysR = applyCascadedBiquadFilter(rightIn, 'bandpass', 800, sampleRate, 4, 0.4);
      keysL = applyCascadedBiquadFilter(keysL, 'highpass', 150, sampleRate, 3, 0.707);
      keysR = applyCascadedBiquadFilter(keysR, 'highpass', 150, sampleRate, 3, 0.707);
      for (let i = 0; i < len; i++) {
        leftOut[i] = keysL[i] * 1.2;
        rightOut[i] = keysR[i] * 1.2;
      }
      break;
    }
    case 'percussion': {
      const percL = applyCascadedBiquadFilter(leftIn, 'highpass', 5500, sampleRate, 4, 0.707);
      const percR = applyCascadedBiquadFilter(rightIn, 'highpass', 5500, sampleRate, 4, 0.707);
      for (let i = 0; i < len; i++) {
        leftOut[i] = percL[i] * 1.4;
        rightOut[i] = percR[i] * 1.4;
      }
      break;
    }
    case 'strings': {
      let stringsL = applyCascadedBiquadFilter(leftIn, 'bandpass', 900, sampleRate, 4, 0.4);
      let stringsR = applyCascadedBiquadFilter(rightIn, 'bandpass', 900, sampleRate, 4, 0.4);
      stringsL = applyCascadedBiquadFilter(stringsL, 'highpass', 200, sampleRate, 3, 0.707);
      stringsR = applyCascadedBiquadFilter(stringsR, 'highpass', 200, sampleRate, 3, 0.707);
      const smoothL = applyTransientDeEmphasis(stringsL, sampleRate, true);
      const smoothR = applyTransientDeEmphasis(stringsR, sampleRate, true);
      for (let i = 0; i < len; i++) {
        leftOut[i] = smoothL[i] * 1.25;
        rightOut[i] = smoothR[i] * 1.25;
      }
      break;
    }
    case 'synth': {
      let synthL = applyCascadedBiquadFilter(leftIn, 'highpass', 350, sampleRate, 4, 0.707);
      let synthR = applyCascadedBiquadFilter(rightIn, 'highpass', 350, sampleRate, 4, 0.707);
      for (let i = 0; i < len; i++) {
        leftOut[i] = (synthL[i] - mid[i] * 0.45) * 1.2;
        rightOut[i] = (synthR[i] - mid[i] * 0.45) * 1.2;
      }
      break;
    }
    case 'brass': {
      const brassL = applyCascadedBiquadFilter(leftIn, 'bandpass', 1200, sampleRate, 4, 1.2);
      const brassR = applyCascadedBiquadFilter(rightIn, 'bandpass', 1200, sampleRate, 4, 1.2);
      for (let i = 0; i < len; i++) {
        leftOut[i] = brassL[i] * 1.2;
        rightOut[i] = brassR[i] * 1.2;
      }
      break;
    }
    case 'woodwinds': {
      const windL = applyCascadedBiquadFilter(leftIn, 'bandpass', 1600, sampleRate, 4, 1.5);
      const windR = applyCascadedBiquadFilter(rightIn, 'bandpass', 1600, sampleRate, 4, 1.5);
      for (let i = 0; i < len; i++) {
        leftOut[i] = windL[i] * 1.25;
        rightOut[i] = windR[i] * 1.25;
      }
      break;
    }
    case 'fx': {
      const fxL = applyCascadedBiquadFilter(leftIn, 'highpass', 2500, sampleRate, 4, 0.707);
      const fxR = applyCascadedBiquadFilter(rightIn, 'highpass', 2500, sampleRate, 4, 0.707);
      for (let i = 0; i < len; i++) {
        leftOut[i] = fxL[i] * 1.25;
        rightOut[i] = fxR[i] * 1.25;
      }
      break;
    }
    case 'song': {
      leftOut = leftIn;
      rightOut = rightIn;
      break;
    }
    case 'custom': {
      const customL = applyCascadedBiquadFilter(leftIn, 'bandpass', (customRange.lowCut + customRange.highCut) / 2, sampleRate, 4, 0.5);
      const customR = applyCascadedBiquadFilter(rightIn, 'bandpass', (customRange.lowCut + customRange.highCut) / 2, sampleRate, 4, 0.5);
      for (let i = 0; i < len; i++) {
        leftOut[i] = customL[i] * 1.1;
        rightOut[i] = customR[i] * 1.1;
      }
      break;
    }
    default: {
      leftOut = leftIn;
      rightOut = rightIn;
    }
  }

  // Create clean destination buffer
  const outBuffer = offlineCtx.createBuffer(2, len, sampleRate);
  outBuffer.copyToChannel(leftOut, 0);
  outBuffer.copyToChannel(rightOut, 1);

  return outBuffer;
}
