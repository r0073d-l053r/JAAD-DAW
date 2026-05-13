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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || displayWidth <= 0 || displayHeight <= 0) return;
    
    const dpr = Math.round(window.devicePixelRatio || 1);
    canvas.width = displayWidth * dpr;
    canvas.height = displayHeight * dpr;
    
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, displayWidth, displayHeight);

    const buffer = audioEngine.buffers.get(effectiveBufferId);

    if (buffer && loaded) {
      const data = buffer.getChannelData(0);
      const amp = displayHeight / 2;

      ctx.fillStyle = color;
      
      const bufferDuration = buffer.duration;
      const totalSamples = data.length;
      const samplesPerPixel = (duration / displayWidth / bufferDuration) * totalSamples;

      for (let i = 0; i < displayWidth; i++) {
        let min = 1.0;
        let max = -1.0;
        
        // precise mapping
        const startIdx = Math.floor(((audioOffset + (i / displayWidth) * duration) / bufferDuration) * totalSamples);
        const endIdx = Math.max(startIdx + 1, Math.floor(((audioOffset + ((i + 1) / displayWidth) * duration) / bufferDuration) * totalSamples));
        
        const effectiveStart = Math.max(0, Math.min(totalSamples - 1, startIdx));
        const effectiveEnd = Math.max(effectiveStart + 1, Math.min(totalSamples, endIdx));

        // check all samples in the range for accurate peak finding
        for (let j = effectiveStart; j < effectiveEnd; j++) {
          const datum = data[j]; 
          if (datum < min) min = datum;
          if (datum > max) max = datum;
        }

        const y = amp * (1 + min);
        const h = Math.max(1, amp * (max - min));
        ctx.fillRect(i, y, 1, h);
      }
    } else {
      ctx.fillStyle = color + '40';
      ctx.fillRect(0, displayHeight/2 - 0.5, displayWidth, 1);
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
      className="mix-blend-screen pointer-events-none"
    />
  );
});
