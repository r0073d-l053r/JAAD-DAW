import React, { useEffect, useRef, useState, memo } from 'react';
import { audioEngine } from '../lib/audioEngine';
import { useApp } from '../lib/store';
import { WebGLWaveformRenderer } from '../lib/WebGLWaveformRenderer';

export const Waveform = memo(function Waveform({ clipId, bufferId, color, duration, width, height = 100, audioOffset = 0 }: { clipId: string, bufferId?: string, color: string, duration: number, width: number, height?: number, audioOffset?: number }) {
  const { state } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WebGLWaveformRenderer | null>(null);
  const [loaded, setLoaded] = useState(false);
  const effectiveBufferId = bufferId || clipId;

  // Use integer dimensions to prevent sub-pixel jitter
  const displayWidth = Math.round(width);
  const displayHeight = Math.round(height);

  useEffect(() => {
    // Check if buffer is loaded, if not we will just render placeholder and wait
    const checkBuffer = () => {
      if (audioEngine.buffers.has(effectiveBufferId)) {
        setLoaded(true);
      } else {
        setTimeout(checkBuffer, 500);
      }
    };
    checkBuffer();
  }, [effectiveBufferId]);

  // Helper to parse hex/css color to [r,g,b,a]
  const parseColor = (colorStr: string): [number, number, number, number] => {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (!ctx) return [1, 1, 1, 1];
    ctx.fillStyle = colorStr;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r / 255, g / 255, b / 255, a / 255];
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || displayWidth <= 0 || displayHeight <= 0) return;
    
    if (!rendererRef.current) {
      try {
        rendererRef.current = new WebGLWaveformRenderer(canvas);
      } catch (e) {
        console.error('WebGL failed', e);
        return;
      }
    }

    const dpr = window.devicePixelRatio || 1;
    canvas.width = displayWidth * dpr;
    canvas.height = displayHeight * dpr;
    
    const buffer = audioEngine.buffers.get(effectiveBufferId);
    const rgba = parseColor(color);

    if (buffer && loaded) {
      const data = buffer.getChannelData(0);
      const amp = (displayHeight * dpr) / 2;
      const bufferDuration = buffer.duration;
      const totalSamples = data.length;

      // Each pixel column i needs 2 points (4 floats: x, y1, x, y2)
      const peaks = new Float32Array(displayWidth * 4);
      let pIdx = 0;

      for (let i = 0; i < displayWidth; i++) {
        let min = 1.0;
        let max = -1.0;
        
        const startIdx = Math.floor(((audioOffset + (i / displayWidth) * duration) / bufferDuration) * totalSamples);
        const endIdx = Math.max(startIdx + 1, Math.floor(((audioOffset + ((i + 1) / displayWidth) * duration) / bufferDuration) * totalSamples));
        
        const effectiveStart = Math.max(0, Math.min(totalSamples - 1, startIdx));
        const effectiveEnd = Math.max(effectiveStart + 1, Math.min(totalSamples, endIdx));

        for (let j = effectiveStart; j < effectiveEnd; j++) {
          const datum = data[j]; 
          if (datum < min) min = datum;
          if (datum > max) max = datum;
        }

        const x = i * dpr;
        const y1 = amp * (1 + min);
        const y2 = amp * (1 + max);
        
        peaks[pIdx++] = x;
        peaks[pIdx++] = y1;
        peaks[pIdx++] = x;
        peaks[pIdx++] = y2 === y1 ? y1 + 1 : y2; // Ensure at least 1px height
      }

      rendererRef.current.render(peaks, rgba);
    } else {
      // Draw a simple center line if not loaded
      const x = 0;
      const y = (displayHeight * dpr) / 2;
      const peaks = new Float32Array([0, y, displayWidth * dpr, y]);
      rendererRef.current.render(peaks, [rgba[0], rgba[1], rgba[2], 0.25]);
    }
  }, [effectiveBufferId, color, displayWidth, displayHeight, loaded, duration, audioOffset, state.buffersVersion]);

  return (
    <canvas 
      ref={canvasRef} 
      style={{ 
        width: `${displayWidth}px`, 
        height: `${displayHeight}px`,
        filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.9))',
        display: 'block'
      }}
      className="mix-blend-screen pointer-events-none gpu-layer"
    />
  );
});
