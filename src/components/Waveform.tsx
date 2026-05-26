import React, { useEffect, useRef, useState, memo } from 'react';
import { audioEngine } from '../lib/audioEngine';
import { useApp } from '../lib/store';

export const Waveform = memo(function Waveform({ clipId, bufferId, color, duration, width, height = 100, audioOffset = 0 }: { clipId: string, bufferId?: string, color: string, duration: number, width: number, height?: number, audioOffset?: number }) {
  const { state } = useApp();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState(false);
  const effectiveBufferId = bufferId || clipId;

  // Use integer dimensions to prevent sub-pixel jitter
  const displayWidth = Math.round(width);
  const displayHeight = Math.round(height);

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || displayWidth <= 0 || displayHeight <= 0) return;
    
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = displayWidth * dpr;
    canvas.height = displayHeight * dpr;
    
    const buffer = audioEngine.buffers.get(effectiveBufferId);

    if (buffer && loaded) {
      const data = buffer.getChannelData(0);
      const amp = (displayHeight * dpr) / 2;
      const bufferDuration = buffer.duration;
      const totalSamples = data.length;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = Math.max(1, dpr);
      
      const normalPath = new Path2D();
      const clippingPath = new Path2D();

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
        
        if (max > 0.99 || min < -0.99) {
          clippingPath.moveTo(x, y1);
          clippingPath.lineTo(x, y2 === y1 ? y1 + 1 : y2);
        } else {
          normalPath.moveTo(x, y1);
          normalPath.lineTo(x, y2 === y1 ? y1 + 1 : y2);
        }
      }

      ctx.strokeStyle = color;
      ctx.stroke(normalPath);
      
      ctx.strokeStyle = '#ef4444'; // Red warning color for clipping peaks
      ctx.stroke(clippingPath);
    } else {
      // Draw placeholder line
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.moveTo(0, (displayHeight * dpr) / 2);
      ctx.lineTo(displayWidth * dpr, (displayHeight * dpr) / 2);
      ctx.stroke();
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
