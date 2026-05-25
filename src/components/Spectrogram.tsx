import React, { useEffect, useRef, useState, memo } from 'react';
import { audioEngine } from '../lib/audioEngine';

interface SpectrogramProps {
  clipId: string;
  bufferId?: string;
  duration: number;
  width: number;
  height?: number;
  audioOffset?: number;
}

// Precompute Studio grade Magma colormap lookup table (256 colors)
// Maps index 0..255 to little-endian ABGR 32-bit values
const MAGMA_PALETTE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  const val = i / 255;
  let r = 0, g = 0, b = 0;
  
  // Custom Magma keypoints
  const c0 = [10, 5, 30];      // Quiet (Deep Space)
  const c1 = [61, 20, 120];    // Cosmic Purple
  const c2 = [183, 35, 117];   // Electric Pink
  const c3 = [244, 130, 38];    // Sun Flare Orange
  const c4 = [255, 242, 178];   // Peak White Gold

  if (val < 0.25) {
    const t = val * 4.0;
    r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
    g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
    b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
  } else if (val < 0.50) {
    const t = (val - 0.25) * 4.0;
    r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
    g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
    b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
  } else if (val < 0.75) {
    const t = (val - 0.50) * 4.0;
    r = Math.round(c2[0] + (c3[0] - c2[0]) * t);
    g = Math.round(c2[1] + (c3[1] - c2[1]) * t);
    b = Math.round(c2[2] + (c3[2] - c2[2]) * t);
  } else {
    const t = (val - 0.75) * 4.0;
    r = Math.round(c3[0] + (c4[0] - c3[0]) * t);
    g = Math.round(c3[1] + (c4[1] - c3[1]) * t);
    b = Math.round(c3[2] + (c4[2] - c3[2]) * t);
  }
  
  // ABGR pixel layout: alpha in highest byte, red in lowest byte
  MAGMA_PALETTE[i] = (255 << 24) | (b << 16) | (g << 8) | r;
}

export const Spectrogram = memo(function Spectrogram({
  clipId,
  bufferId,
  duration,
  width,
  height = 94,
  audioOffset = 0,
}: SpectrogramProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const [loaded, setLoaded] = useState<boolean>(false);
  const [analyzing, setAnalyzing] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const effectiveBufferId = bufferId || clipId;
  const displayWidth = Math.round(width);
  const displayHeight = Math.round(height);

  const magnitudeDataRef = useRef<{
    matrix: Uint8Array;
    frames: number;
    bins: number;
  } | null>(null);

  // Poll for audio buffer load state
  useEffect(() => {
    const checkBuffer = () => {
      if (audioEngine.buffers.has(effectiveBufferId)) {
        setLoaded(true);
      } else {
        const timeout = setTimeout(checkBuffer, 500);
        return () => clearTimeout(timeout);
      }
    };
    return checkBuffer();
  }, [effectiveBufferId]);

  // High performance Canvas 2D render loop
  const drawSpectrogram = () => {
    const canvas = canvasRef.current;
    const magData = magnitudeDataRef.current;
    if (!canvas || !magData || magData.frames <= 0 || magData.bins <= 0) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const { matrix, frames, bins } = magData;

    // Create an offscreen buffer canvas of size [frames, bins]
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = frames;
    offscreenCanvas.height = bins;
    const offscreenCtx = offscreenCanvas.getContext('2d');
    if (!offscreenCtx) return;

    // Build the raw image data array
    const imgData = offscreenCtx.createImageData(frames, bins);
    const data32 = new Uint32Array(imgData.data.buffer);

    for (let f = 0; f < frames; f++) {
      for (let b = 0; b < bins; b++) {
        // High frequencies at top, low frequencies at bottom
        const y = bins - 1 - b;
        const x = f;
        
        const targetIdx = y * frames + x;
        const matrixIdx = f * bins + b;
        
        const val = matrix[matrixIdx];
        data32[targetIdx] = MAGMA_PALETTE[val];
      }
    }

    // Write image data and draw onto main canvas with hardware scaling interpolation
    offscreenCtx.putImageData(imgData, 0, 0);
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Standard drawing stretches image to match track segment size
    ctx.drawImage(offscreenCanvas, 0, 0, canvas.width, canvas.height);
  };

  // Run offline FFT worker when audio buffer loaded
  useEffect(() => {
    if (!loaded) return;

    const buffer = audioEngine.buffers.get(effectiveBufferId);
    if (!buffer) return;

    setAnalyzing(true);
    setError(null);

    const workerUrl = new URL('../workers/spectrogram.worker.ts', import.meta.url).href;
    const worker = new Worker(workerUrl, { type: 'module' });
    workerRef.current = worker;

    // Slice buffer according to audioOffset and clip duration
    const channelData = buffer.getChannelData(0);
    const sampleRate = buffer.sampleRate;
    const startSample = Math.max(0, Math.floor(audioOffset * sampleRate));
    const endSample = Math.min(channelData.length, Math.floor((audioOffset + duration) * sampleRate));
    const slicedData = channelData.slice(startSample, endSample);

    worker.postMessage({
      channelData: slicedData,
      fftSize: 512,
      hopSize: 256,
    });

    worker.onmessage = (e: MessageEvent) => {
      const { magnitudeMatrix, numFrames, numBins, error: err } = e.data;

      if (err) {
        setError(err);
        setAnalyzing(false);
        return;
      }

      magnitudeDataRef.current = {
        matrix: magnitudeMatrix,
        frames: numFrames,
        bins: numBins,
      };

      setAnalyzing(false);
      drawSpectrogram();
    };

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
    };
  }, [loaded, effectiveBufferId, audioOffset, duration]);

  // Handle canvas resize & resolution alignment
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || displayWidth <= 0 || displayHeight <= 0) return;

    canvas.width = displayWidth;
    canvas.height = displayHeight;

    drawSpectrogram();
  }, [displayWidth, displayHeight]);

  useEffect(() => {
    drawSpectrogram();
  }, [canvasRef.current]);

  return (
    <div
      style={{
        width: `${displayWidth}px`,
        height: `${displayHeight}px`,
        display: 'block',
      }}
      className="relative rounded overflow-hidden bg-[#070411] border border-[#23133f]"
    >
      {analyzing && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/70 backdrop-blur-[2px] z-10">
          <div className="flex flex-col items-center gap-1.5">
            <div className="w-5 h-5 rounded-full border border-t-[#a882fa] border-r-pink-500 animate-spin" />
            <span className="text-[9px] font-medium tracking-wider text-[#a882fa]/90 uppercase font-mono">
              FFT...
            </span>
          </div>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center text-red-400 text-[9px] font-mono p-2 text-center z-10">
          {error}
        </div>
      )}

      <canvas ref={canvasRef} className="w-full h-full block gpu-layer" />

      {/* Grid overlay for professional score display */}
      <div className="absolute inset-0 pointer-events-none grid grid-cols-4 grid-rows-3 opacity-25">
        {[...Array(12)].map((_, i) => (
          <div key={i} className="border-r border-b border-[#a882fa]/10" />
        ))}
      </div>

      {/* Dynamic Frequency Indicators */}
      <div className="absolute left-1 top-0 bottom-0 flex flex-col justify-between py-1 text-[8px] font-semibold text-[#a882fa]/50 font-mono tracking-tighter pointer-events-none select-none">
        <span>20k</span>
        <span>5k</span>
        <span>1k</span>
        <span>200</span>
      </div>
    </div>
  );
});

export default Spectrogram;
