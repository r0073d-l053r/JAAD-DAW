// Web Worker for offline Spectrogram FFT generation

function bitReverse(n: number, bits: number): number {
  let reversed = 0;
  for (let i = 0; i < bits; i++) {
    if ((n & (1 << i)) !== 0) {
      reversed |= (1 << (bits - 1 - i));
    }
  }
  return reversed;
}

function fft(real: Float32Array, imag: Float32Array) {
  const n = real.length;
  const bits = Math.round(Math.log2(n));

  // Bit-reversal permutation
  for (let i = 0; i < n; i++) {
    const j = bitReverse(i, bits);
    if (i < j) {
      const tempR = real[i];
      real[i] = real[j];
      real[j] = tempR;

      const tempI = imag[i];
      imag[i] = imag[j];
      imag[j] = tempI;
    }
  }

  // Cooley-Tukey iterative Radix-2 FFT
  for (let len = 2; len <= n; len <<= 1) {
    const angle = -2 * Math.PI / len;
    const wlen_r = Math.cos(angle);
    const wlen_i = Math.sin(angle);

    for (let i = 0; i < n; i += len) {
      let w_r = 1.0;
      let w_i = 0.0;
      const halfLen = len >> 1;

      for (let j = 0; j < halfLen; j++) {
        const u_r = real[i + j];
        const u_i = imag[i + j];
        const v_r = real[i + j + halfLen] * w_r - imag[i + j + halfLen] * w_i;
        const v_i = real[i + j + halfLen] * w_i + imag[i + j + halfLen] * w_r;

        real[i + j] = u_r + v_r;
        imag[i + j] = u_i + v_i;
        real[i + j + halfLen] = u_r - v_r;
        imag[i + j + halfLen] = u_i - v_i;

        const next_w_r = w_r * wlen_r - w_i * wlen_i;
        w_i = w_r * wlen_i + w_i * wlen_r;
        w_r = next_w_r;
      }
    }
  }
}

self.onmessage = (e: MessageEvent) => {
  const { channelData, fftSize = 512, hopSize = 256 } = e.data;
  if (!channelData) {
    self.postMessage({ error: 'No channel data provided' });
    return;
  }

  const numSamples = channelData.length;
  const numFrames = Math.floor((numSamples - fftSize) / hopSize) + 1;
  const numBins = fftSize / 2; // Symmetric real inputs

  if (numFrames <= 0) {
    self.postMessage({ error: 'Audio data too short for selected FFT size' });
    return;
  }

  // Precompute Hann Window
  const hannWindow = new Float32Array(fftSize);
  for (let i = 0; i < fftSize; i++) {
    hannWindow[i] = 0.5 * (1.0 - Math.cos((2.0 * Math.PI * i) / (fftSize - 1)));
  }

  // Allocate a single contiguous Uint8Array flat buffer for transmission
  const magnitudeMatrix = new Uint8Array(numFrames * numBins);

  const realBuffer = new Float32Array(fftSize);
  const imagBuffer = new Float32Array(fftSize);

  for (let f = 0; f < numFrames; f++) {
    const startIdx = f * hopSize;

    // 1. Populate real/imag frame buffers and apply window
    for (let i = 0; i < fftSize; i++) {
      realBuffer[i] = channelData[startIdx + i] * hannWindow[i];
      imagBuffer[i] = 0.0;
    }

    // 2. Perform Radix-2 FFT
    fft(realBuffer, imagBuffer);

    // 3. Compute dB magnitude and map to 0..255 range
    for (let b = 0; b < numBins; b++) {
      const r = realBuffer[b];
      const im = imagBuffer[b];
      const mag = Math.sqrt(r * r + im * im);
      
      // Scale logarithmically (dB)
      const db = 20 * Math.log10(mag + 1e-5);
      // Map range -70dB..0dB to 0..255
      const mapped = Math.max(0, Math.min(255, Math.round((db + 70) * (255 / 70))));
      
      magnitudeMatrix[f * numBins + b] = mapped;
    }
  }

  // Send the flat buffer back using transferable object to avoid garbage collection overhead
  self.postMessage(
    {
      magnitudeMatrix,
      numFrames,
      numBins,
    },
    [magnitudeMatrix.buffer] as any
  );
};
