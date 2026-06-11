import React, { useEffect, useRef } from 'react';
import { useApp } from '../../lib/store';
import { audioEngine } from '../../lib/audioEngine';

export interface PlayheadProps {
  PIXELS_PER_SECOND: number;
  startDraggingPlayhead: (e: React.MouseEvent | React.TouchEvent) => void;
  mode?: 'both' | 'handle' | 'line';
}

export function Playhead({ PIXELS_PER_SECOND, startDraggingPlayhead, mode = 'both' }: PlayheadProps) {
  const { state } = useApp();
  const lineRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<HTMLDivElement>(null);
  const rafId = useRef<number>(0);

  useEffect(() => {
    const update = () => {
      const time = audioEngine.getCurrentTime();
      const pos = time * PIXELS_PER_SECOND;
      if (lineRef.current) lineRef.current.style.transform = `translateX(${pos}px) translateX(-50%)`;
      if (handleRef.current) handleRef.current.style.transform = `translateX(${pos}px) translateX(-50%)`;
      rafId.current = requestAnimationFrame(update);
    };

    if (state.isPlaying) {
      rafId.current = requestAnimationFrame(update);
    } else {
      const pos = state.currentTime * PIXELS_PER_SECOND;
      if (lineRef.current) lineRef.current.style.transform = `translateX(${pos}px) translateX(-50%)`;
      if (handleRef.current) handleRef.current.style.transform = `translateX(${pos}px) translateX(-50%)`;
    }

    return () => cancelAnimationFrame(rafId.current);
  }, [state.isPlaying, state.currentTime, PIXELS_PER_SECOND]);

  return (
    <>
      {/* Playhead Handle - Sticky to the ruler bar */}
      {(mode === 'both' || mode === 'handle') && (
        <div
          ref={handleRef}
          className="absolute top-0 bottom-0 z-[110] group/playhead playhead-handle pointer-events-none"
          style={{
            left: 0,
            width: '24px',
            willChange: 'transform'
          }}
        >
          <div
            className="w-4 h-3 bg-primary absolute left-1/2 -translate-x-1/2 top-0 cursor-ew-resize pointer-events-auto"
            style={{ clipPath: 'polygon(0 0, 100% 0, 50% 100%)', filter: 'drop-shadow(0 0 5px #af52de)' }}
            onMouseDown={startDraggingPlayhead}
            onTouchStart={startDraggingPlayhead}
          />
          <div className="absolute inset-0 opacity-0 bg-white/10" />
        </div>
      )}

      {/* Playhead Line - Spans full height of the relative container */}
      {(mode === 'both' || mode === 'line') && (
        <div
          ref={lineRef}
          className="absolute top-0 bottom-0 z-[100] cursor-ew-resize group/line pointer-events-auto"
          style={{
            left: 0,
            width: '24px',
            transform: 'translateX(0)',
            willChange: 'transform'
          }}
          onMouseDown={startDraggingPlayhead}
          onTouchStart={startDraggingPlayhead}
        >
           <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-6 bg-primary opacity-0 group-[.is-dragging]:opacity-20 group-hover/line:opacity-20 blur-sm transition-opacity pointer-events-none" />
           <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-[1px] bg-primary shadow-[0_0_10px_rgba(175,82,222,0.5)] pointer-events-none" />
        </div>
      )}
    </>
  );
}
