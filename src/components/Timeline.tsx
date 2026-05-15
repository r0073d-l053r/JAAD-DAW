import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useApp, Clip } from '../lib/store';
import { audioEngine } from '../lib/audioEngine';
import { Waveform } from './Waveform';
import { detectBPMOffline } from '../lib/essentiaBPM';

import { ClipItem } from './ClipItem';

function Playhead({ PIXELS_PER_SECOND, startDraggingPlayhead, mode = 'both' }: { PIXELS_PER_SECOND: number, startDraggingPlayhead: (e: React.MouseEvent | React.TouchEvent) => void, mode?: 'both' | 'handle' | 'line' }) {
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

export function Timeline() {
  const { state, dispatch } = useApp();
  const timelineRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const PIXELS_PER_SECOND = state.zoomLevel;
  const [isDraggingOver, setIsDraggingOver] = useState(false);

  // Ref to access latest state in async callbacks
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!state.isPlaying || !timelineRef.current) return;

    let rafId: number;
    const checkScroll = () => {
      const timeline = timelineRef.current;
      if (!timeline) return;

      const currentTime = audioEngine.getCurrentTime();
      const PIXELS_PER_SECOND = state.zoomLevel;
      const currentPos = currentTime * PIXELS_PER_SECOND;
      
      // Auto-scroll when playhead leaves 85% of view
      const scrollThreshold = timeline.clientWidth * 0.85;
      
      if (currentPos > timeline.scrollLeft + scrollThreshold) {
        // Jump the timeline forward so the playhead is back at 25% of the view
        const targetScroll = Math.round(currentPos - timeline.clientWidth / 4);
        timeline.scrollTo({ left: targetScroll, behavior: 'auto' });
      }

      rafId = requestAnimationFrame(checkScroll);
    };

    rafId = requestAnimationFrame(checkScroll);
    return () => cancelAnimationFrame(rafId);
  }, [state.isPlaying, state.zoomLevel]);

  useEffect(() => {
    const handleWheel = (e: WheelEvent) => {
      const isModifier = e.ctrlKey || e.metaKey;
      if (!isModifier) return;

      e.preventDefault();

      if (e.shiftKey) {
        // Ctrl + Shift + Scroll -> Zoom in and out
        const delta = e.deltaY > 0 ? -4 : 4;
        dispatch({ type: 'SET_ZOOM', payload: state.zoomLevel + delta });
      } else {
        // Ctrl + Scroll -> Horizontal skimming (side to side)
        if (timelineRef.current) {
          timelineRef.current.scrollLeft += e.deltaY * 2;
        }
      }
    };
    const currentRef = timelineRef.current;
    if (currentRef) {
      currentRef.addEventListener('wheel', handleWheel, { passive: false });
    }
    return () => {
      if (currentRef) {
        currentRef.removeEventListener('wheel', handleWheel);
      }
    };
  }, [state.zoomLevel, dispatch]);

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files as FileList);
      const audioFiles = files.filter(f => f.type.startsWith('audio/') || f.name.match(/\.(mp3|wav|ogg|flac|aac|m4a|weba|webm)$/i));
      
      if (audioFiles.length === 0) return;
      const timeline = timelineRef.current;
      if (!timeline) return;

      const isMultiple = audioFiles.length > 1;
      if (isMultiple) {
        dispatch({ type: 'SET_SHOW_BPM_SYNC_POPUP', payload: true });
      }
      dispatch({ type: 'SET_IS_DETECTING_BPM', payload: true });

      try {
        const loadedClipIds: string[] = [];

        for (let i = 0; i < audioFiles.length; i++) {
          const file = audioFiles[i];
          const clipId = 'clip_' + Date.now() + '_' + i;
          const targetTrackId = 'track_' + Date.now() + '_' + i;
          
          const duration = await audioEngine.loadAudio(clipId, file);
          loadedClipIds.push(clipId);
          
          const TRACK_COLORS = ['#FF2A5F', '#00E871', '#6B44FF', '#4B7BFF', '#FFEB3B', '#FF9800', '#00BCD4', '#E91E63', '#9C27B0', '#8BC34A'];
          const newTrackColor = TRACK_COLORS[(state.tracks.length + i) % TRACK_COLORS.length];
          
          dispatch({ 
            type: 'ADD_TRACK', 
            payload: { 
              id: targetTrackId, 
              name: file.name.replace(/\.[^/.]+$/, "") || 'Audio Track', 
              volume: 0.8, 
              pan: 0, 
              muted: false, 
              solo: false, 
              color: newTrackColor, 
              clips: [{
                id: clipId,
                start: 0,
                duration,
                audioData: file.name
              }] 
            } 
          });
        }

        // After ALL files loaded, detect BPM
        if (isMultiple && stateRef.current.bpmSyncCancelRequested) {
          console.log("Timeline: BPM Sync cancelled by user.");
        } else {
          console.log("Timeline: All files loaded. Starting BPM detection...");
          const buffer = audioEngine.buffers.get(loadedClipIds[0]);
          if (buffer) {
            const bpm = await detectBPMOffline(buffer);
            if (bpm) {
              dispatch({ type: 'SET_ORIGINAL_BPM', payload: bpm });
              dispatch({ type: 'SET_BPM', payload: bpm });
              console.log("Timeline: Auto-detected BPM:", bpm);
            }
          }
        }
      } catch (err) {
        console.error("Timeline drop handler error:", err);
      } finally {
        dispatch({ type: 'SET_IS_DETECTING_BPM', payload: false });
        dispatch({ type: 'SET_SHOW_BPM_SYNC_POPUP', payload: false });
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files as FileList);
      const audioFiles = files.filter(f => f.type.startsWith('audio/') || f.name.match(/\.(mp3|wav|ogg|flac|aac|m4a|weba|webm)$/i));

      if (audioFiles.length === 0) return;

      const isMultiple = audioFiles.length > 1;
      if (isMultiple) {
        dispatch({ type: 'SET_SHOW_BPM_SYNC_POPUP', payload: true });
      }
      dispatch({ type: 'SET_IS_DETECTING_BPM', payload: true });

      try {
        const loadedClipIds: string[] = [];

        for (let i = 0; i < audioFiles.length; i++) {
          const file = audioFiles[i];
          const id = 'clip_' + Date.now() + '_' + i;
          const duration = await audioEngine.loadAudio(id, file);
          loadedClipIds.push(id);
          
          const clip: Clip = {
            id,
            start: 0,
            duration,
            audioData: file.name
          };

          const TRACK_COLORS = ['#FF2A5F', '#00E871', '#6B44FF', '#4B7BFF', '#FFEB3B', '#FF9800', '#00BCD4', '#E91E63', '#9C27B0', '#8BC34A'];
          const newTrackColor = TRACK_COLORS[(state.tracks.length + i) % TRACK_COLORS.length];
          const targetTrackId = 'track_' + Date.now() + '_' + i;
          dispatch({ 
            type: 'ADD_TRACK', 
            payload: { 
              id: targetTrackId, 
              name: file.name.substring(0, 15) || 'Audio', 
              volume: 1, 
              pan: 0, 
              muted: false, 
              solo: false, 
              color: newTrackColor, 
              clips: [] 
            } 
          });

          dispatch({ type: 'ADD_CLIP', payload: { trackId: targetTrackId, clip } });
        }

        // After ALL files loaded, detect BPM
        if (isMultiple && stateRef.current.bpmSyncCancelRequested) {
          console.log("Timeline file select: BPM Sync cancelled.");
        } else {
          console.log("Timeline file select: Starting BPM detection...");
          const buffer = audioEngine.buffers.get(loadedClipIds[0]);
          if (buffer) {
            const bpm = await detectBPMOffline(buffer);
            if (bpm) {
              dispatch({ type: 'SET_ORIGINAL_BPM', payload: bpm });
              dispatch({ type: 'SET_BPM', payload: bpm });
              console.log("Timeline file select: Auto-detected BPM:", bpm);
            }
          }
        }
      } catch (err) {
        console.error("Timeline file select error:", err);
      } finally {
        dispatch({ type: 'SET_IS_DETECTING_BPM', payload: false });
        dispatch({ type: 'SET_SHOW_BPM_SYNC_POPUP', payload: false });
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const [lasso, setLasso] = useState<{ start: { x: number, y: number }, end: { x: number, y: number } } | null>(null);
  const [isLassoing, setIsLassoing] = useState(false);
  const wasLassoingRef = useRef(false);
  const wasDraggingRef = useRef(false);
  const lastClickTime = useRef(0);

  const isDoubleClickRef = useRef(false);

  const handlePointerDownCapture = (e: React.PointerEvent) => {
    // Only handle left click
    if (e.button !== 0) return;
    
    // Don't start lasso if clicking on ruler, playhead, or other control elements
    if ((e.target as HTMLElement).closest('.ruler-zone') || 
        (e.target as HTMLElement).closest('.playhead-handle') ||
        (e.target as HTMLElement).closest('.selection-action')) return;

    // Check for double click manually
    const now = Date.now();
    const isDoubleClick = now - lastClickTime.current < 400;
    lastClickTime.current = now;

    if (isDoubleClick) {
      isDoubleClickRef.current = true;
      wasLassoingRef.current = false;

      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
        clickTimeoutRef.current = null;
      }
      
      const timeline = timelineRef.current;
      if (!timeline) return;

      const rect = timeline.getBoundingClientRect();
      const x = e.clientX - rect.left + timeline.scrollLeft;
      const y = e.clientY - rect.top + timeline.scrollTop;

      setLasso({ start: { x, y }, end: { x, y } });
      setIsLassoing(true);
      
      // Capture pointer to receive move/up events even outside the element
      (e.target as HTMLElement).setPointerCapture(e.pointerId);

      // STOP PROPAGATION during capture to prevent child (ClipItem) from starting its own drag
      e.stopPropagation();
      e.preventDefault();
    } else {
      isDoubleClickRef.current = false;
      wasLassoingRef.current = false;
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isLassoing || !lasso) return;

    const timeline = timelineRef.current;
    if (!timeline) return;

    const rect = timeline.getBoundingClientRect();
    const x = e.clientX - rect.left + timeline.scrollLeft;
    const y = e.clientY - rect.top + timeline.scrollTop;

    setLasso(prev => prev ? { ...prev, end: { x, y } } : null);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (!isLassoing || !lasso) {
      setIsLassoing(false);
      return;
    }

    const box = {
      left: Math.min(lasso.start.x, lasso.end.x),
      right: Math.max(lasso.start.x, lasso.end.x),
      top: Math.min(lasso.start.y, lasso.end.y),
      bottom: Math.max(lasso.start.y, lasso.end.y)
    };

    // Small box click shouldn't trigger lasso
    if (Math.abs(lasso.start.x - lasso.end.x) < 5 && Math.abs(lasso.start.y - lasso.end.y) < 5) {
      setIsLassoing(false);
      setLasso(null);
      return;
    }

    // Calculate time range
    const startTime = box.left / PIXELS_PER_SECOND;
    const endTime = box.right / PIXELS_PER_SECOND;
    
    const trackIds: string[] = [];
    const timelineRect = timelineRef.current?.getBoundingClientRect();
    if (!timelineRect) return;

    const trackElements = document.querySelectorAll('[data-track-id]');
    trackElements.forEach(trackEl => {
      const trackId = trackEl.getAttribute('data-track-id');
      if (!trackId) return;

      const trackRect = (trackEl as HTMLElement).getBoundingClientRect();
      
      // Calculate relative coordinates in the timeline scrollable area
      const relTrackTop = trackRect.top - timelineRect.top + timelineRef.current!.scrollTop;
      const relTrackBottom = trackRect.bottom - timelineRect.top + timelineRef.current!.scrollTop;

      // Check vertical overlap with precise relative coordinates
      if (box.bottom >= relTrackTop && box.top <= relTrackBottom) {
        trackIds.push(trackId);
      }
    });

    if (trackIds.length > 0) {
      dispatch({ 
        type: 'SET_TIME_SELECTION', 
        payload: { startTime, endTime, trackIds } 
      });
      wasLassoingRef.current = true;
      wasDraggingRef.current = true;
      setTimeout(() => wasDraggingRef.current = false, 100);
    } else if (Math.abs(lasso.start.x - lasso.end.x) > 10) {
      dispatch({ type: 'SET_TIME_SELECTION', payload: null });
      dispatch({ type: 'SELECT_MULTIPLE_CLIPS', payload: [] });
      wasLassoingRef.current = true;
      wasDraggingRef.current = true;
      setTimeout(() => wasDraggingRef.current = false, 100);
    }

    setIsLassoing(false);
    setLasso(null);
    
    // Release pointer capture
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    // This is now mainly for clicks that didn't get intercepted by capture
    // such as the first click of a potential double click
    if (e.button !== 0) return;
    
    // If we click on a clip, let the clip handle its own selection / range drag
    // unless it was a double-click (which is handled by capture phase)
    if ((e.target as HTMLElement).closest('.clip-item')) return;
  };

  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const [laneContextMenu, setLaneContextMenu] = useState<{ x: number, y: number, trackId: string, laneId: string, time: number } | null>(null);

  const handleTimelineClick = (e: React.MouseEvent) => {
    if (laneContextMenu) {
      setLaneContextMenu(null);
      return;
    }
    // If we were just lassoing or in a double-click gesture, don't move the playhead
    if (wasLassoingRef.current || isDoubleClickRef.current || wasDraggingRef.current) {
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
        clickTimeoutRef.current = null;
      }
      return;
    }
    
    // Clear time selection on normal click in empty space
    if (state.timeSelection && !(e.target as HTMLElement).closest('.clip-item') && !(e.target as HTMLElement).closest('.selection-action')) {
      dispatch({ type: 'SET_TIME_SELECTION', payload: null });
    }

    // If we click directly on a clip, let the clip handle it
    if ((e.target as HTMLElement).closest('.clip-item')) {
      if (clickTimeoutRef.current) {
        clearTimeout(clickTimeoutRef.current);
        clickTimeoutRef.current = null;
      }
      return;
    }

    const { clientX } = e;
    
    // Delay playhead movement to see if this is the start of a double-click
    if (clickTimeoutRef.current) {
      clearTimeout(clickTimeoutRef.current);
      clickTimeoutRef.current = null;
      return; // Second click of a double click
    }

    clickTimeoutRef.current = setTimeout(() => {
      const timeline = timelineRef.current;
      if (!timeline) return;

      const rect = timeline.getBoundingClientRect();
      const clickX = clientX - rect.left + timeline.scrollLeft;
      let newTime = clickX / PIXELS_PER_SECOND;

      if (state.snapToGrid) {
        const beatDuration = 60 / state.bpm;
        newTime = Math.round(newTime / beatDuration) * beatDuration;
      }

      dispatch({ type: 'SET_TIME', payload: Math.max(0, newTime) });
      clickTimeoutRef.current = null;
    }, 250);
  };

  const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);

  const startDraggingPlayhead = (e: React.MouseEvent | React.TouchEvent) => {
    e.stopPropagation();
    setIsDraggingPlayhead(true);
  };

  useEffect(() => {
    if (!isDraggingPlayhead) return;

    const handleMouseMove = (e: MouseEvent | TouchEvent) => {
      const timeline = timelineRef.current;
      if (!timeline) return;

      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const rect = timeline.getBoundingClientRect();
      const clickX = clientX - rect.left + timeline.scrollLeft;
      let newTime = clickX / PIXELS_PER_SECOND;

      if (state.snapToGrid) {
        const beatDuration = 60 / state.bpm;
        newTime = Math.round(newTime / beatDuration) * beatDuration;
      }

      dispatch({ type: 'SET_TIME', payload: Math.max(0, newTime) });
    };

    const handleMouseUp = () => {
      setIsDraggingPlayhead(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('touchmove', handleMouseMove);
    window.addEventListener('touchend', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('touchmove', handleMouseMove);
      window.removeEventListener('touchend', handleMouseUp);
    };
  }, [isDraggingPlayhead, state.zoomLevel, state.bpm, state.snapToGrid, dispatch]);

  return (
    <div 
      id="timeline"
      className="flex-1 timeline-grid bg-transparent relative custom-scrollbar select-none overflow-x-auto overflow-y-hidden gpu-layer" 
      ref={timelineRef}
      onDragOver={(e) => { 
        e.preventDefault(); 
        if (e.dataTransfer.types.includes('Files')) {
          setIsDraggingOver(true); 
        }
      }}
      onDragLeave={() => setIsDraggingOver(false)}
      onDrop={(e) => handleDrop(e)}
      onClick={handleTimelineClick}
      onMouseDown={handleMouseDown}
      onPointerDownCapture={handlePointerDownCapture}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      {lasso && (
        <div 
          className="absolute border-2 border-primary bg-primary/20 z-[100] pointer-events-none rounded-sm shadow-[0_0_15px_rgba(var(--primary),0.3)]"
          style={{
            left: Math.min(lasso.start.x, lasso.end.x),
            top: Math.min(lasso.start.y, lasso.end.y),
            width: Math.abs(lasso.start.x - lasso.end.x),
            height: Math.abs(lasso.start.y - lasso.end.y),
          }}
        />
      )}
      {state.timeSelection && (
        <div 
          className="absolute border-x-2 border-primary/50 bg-primary/5 z-[45] pointer-events-none h-full"
          style={{
            left: state.timeSelection.startTime * PIXELS_PER_SECOND,
            width: (state.timeSelection.endTime - state.timeSelection.startTime) * PIXELS_PER_SECOND,
            top: 0
          }}
        >
          {state.timeSelection.endTime - state.timeSelection.startTime > 0 && (
            <div className="sticky top-12 mt-12 w-full flex justify-center pointer-events-none z-[100]">
              <div className="flex items-center bg-zinc-800/90 backdrop-blur border border-white/20 rounded-md overflow-hidden shadow-2xl pointer-events-auto selection-action">
                <button 
                  onClick={(e) => { e.stopPropagation(); dispatch({ type: "RESTORE_SELECTION" }) }}
                  className="px-4 py-2 text-xs font-semibold text-white hover:bg-white/10"
                >
                  Heal Edits
                </button>
              </div>
            </div>
          )}
          {/* Subtle vertical indicator line across tracks */}
          <div className="absolute inset-0 bg-gradient-to-b from-primary/10 via-transparent to-primary/10 opacity-30" />
        </div>
      )}
      {isDraggingOver && (
        <div className="absolute inset-0 z-[100] bg-primary/10 border-2 border-primary border-dashed pointer-events-none" />
      )}
      
      {state.tracks.length === 0 && (
        <div 
          onClick={(e) => {
            e.stopPropagation();
            fileInputRef.current?.click();
          }}
          className="absolute inset-0 flex flex-col items-center justify-center text-white/60 pointer-events-auto cursor-pointer hover:text-white transition-colors z-40 w-full h-full -translate-x-32"
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            multiple 
            accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a"
            onChange={handleFileSelect} 
          />
          <div className="w-16 h-16 mb-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center backdrop-blur-md shadow-2xl hover:bg-white/10 transition-colors cursor-pointer text-white">
             <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </div>
          <p className="text-sm font-medium tracking-wide" style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.9)) drop-shadow(0 4px 12px rgba(0,0,0,0.6))' }}>Please drag and drop or click to add files.</p>
        </div>
      )}

      <div className="min-w-max min-h-full relative flex flex-col">
        {/* Time ruler */}
        <div className="h-8 border-b border-white/5 sticky top-0 bg-[#0a0a0c] z-[70] flex cursor-pointer ruler-zone"
             onClick={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const clickX = e.clientX - rect.left + timelineRef.current!.scrollLeft;
                let newTime = clickX / PIXELS_PER_SECOND;
                if (state.snapToGrid) {
                  const beatDuration = 60 / state.bpm;
                  newTime = Math.round(newTime / beatDuration) * beatDuration;
                }
                dispatch({ type: 'SET_TIME', payload: Math.max(0, newTime) });
             }}
        >
          {Array.from({ length: 60 }).map((_, i) => (
            <div key={i} className="flex-shrink-0 border-l border-[#333] h-full relative" style={{ width: PIXELS_PER_SECOND * 5 }}>
              <span className="absolute left-1 flex text-[10px] text-gray-500 top-1">{i * 5}s</span>
            </div>
          ))}
          {/* Loop Region Indicator */}
          {state.looping && (
             <div className="absolute top-0 h-full bg-primary/20 border-l-2 border-r-2 border-primary pointer-events-none"
                  style={{ left: state.loopStart * PIXELS_PER_SECOND, width: (state.loopEnd - state.loopStart) * PIXELS_PER_SECOND }}
             />
          )}
          <Playhead PIXELS_PER_SECOND={PIXELS_PER_SECOND} startDraggingPlayhead={startDraggingPlayhead} mode="handle" />
        </div>
        <Playhead PIXELS_PER_SECOND={PIXELS_PER_SECOND} startDraggingPlayhead={startDraggingPlayhead} mode="line" />


        {/* Tracks */}
        <div 
          className="relative flex-1 flex flex-col"
          style={state.snapToGrid ? {
            backgroundImage: `linear-gradient(to right, rgba(255, 255, 255, 0.05) 1px, transparent 1px)`,
            backgroundSize: `${(60 / state.bpm) * PIXELS_PER_SECOND}px 100%`
          } : {}}
        >
          {/* Master Tempo Lane */}
          <div 
            className="h-16 shrink-0 border-b border-[#2a2b30]/50 relative group transition bg-zinc-900/30"
            data-track-id="master-tempo"
          >
            <div className="absolute inset-0 pointer-events-none">
               <svg width="100%" height="100%" className="overflow-visible">
                  <line x1="0" y1="50%" x2="100%" y2="50%" stroke="rgba(175, 82, 222, 0.5)" strokeWidth="2" strokeDasharray="4 4" />
                  {state.tempoAutomation?.map((pt, i) => (
                    <circle key={i} cx={pt.time * PIXELS_PER_SECOND} cy="50%" r="4" fill="#af52de" />
                  ))}
               </svg>
            </div>
          </div>

          {state.tracks.map((track, idx) => (
            <React.Fragment key={track.id}>
              <div 
                className={`h-28 shrink-0 border-b border-[#2a2b30]/50 relative group transition`}
                data-track-id={track.id}

                onDragOver={(e) => { 
                  e.preventDefault(); 
                  if (e.dataTransfer.types.includes('Files')) {
                    e.currentTarget.classList.add('bg-primary/5');
                  }
                }}
                onDragLeave={(e) => {
                  e.currentTarget.classList.remove('bg-primary/5');
                }}
                onDrop={(e) => { 
                  e.stopPropagation(); 
                  e.currentTarget.classList.remove('bg-primary/5');
                  handleDrop(e); 
                }}
              >
                {track.clips.map(clip => (
                  <ClipItem key={clip.id} clip={clip} track={track} trackId={track.id} />
                ))}
              </div>

              {/* Alternate Lanes */}
              <AnimatePresence>
                {track.showLanes && track.lanes?.map((lane) => (
                  <motion.div
                    key={lane.id}
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 40, opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="shrink-0 border-b border-[#2a2b30]/30 relative bg-[#0e0e11]/40 transition"
                    data-track-id={track.id}
                    data-lane-id={lane.id}
                    onDragOver={(e) => { e.preventDefault(); }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setLaneContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        trackId: track.id,
                        laneId: lane.id,
                        time: (e.clientX - e.currentTarget.getBoundingClientRect().left + timelineRef.current!.scrollLeft) / PIXELS_PER_SECOND
                      });
                    }}
                  >
                    {lane.clips.map(clip => (
                      <ClipItem 
                        key={clip.id} 
                        clip={clip} 
                        track={track} 
                        trackId={track.id} 
                        laneId={lane.id} 
                      />
                    ))}
                  </motion.div>
                ))}
              </AnimatePresence>
            </React.Fragment>
          ))}
          {/* Dummy element to sync grid height perfectly with TrackList */}
          <div className="p-6 flex justify-center pb-20 flex-1 pointer-events-none opacity-0">
             <button className="text-[10px] font-bold tracking-[0.2em] flex items-center space-x-2 py-2 px-4 border border-dashed rounded-lg">
                <span>+ Add Audio Track</span>
             </button>
          </div>
        </div>
      </div>
      {laneContextMenu && (
        <div 
          className="fixed z-[1000] bg-[#1a1a1e] border border-white/10 rounded shadow-2xl py-1 min-w-[140px] flex flex-col backdrop-blur-xl"
          style={{ left: laneContextMenu.x, top: laneContextMenu.y }}
          onMouseLeave={() => setLaneContextMenu(null)}
        >
          <button 
            onClick={() => {
              dispatch({ 
                type: 'PASTE_CLIP_TO_LANE', 
                payload: { 
                  trackId: laneContextMenu.trackId, 
                  laneId: laneContextMenu.laneId, 
                } 
              });
              setLaneContextMenu(null);
            }}
            disabled={state.clipboard.length === 0}
            className="px-3 py-2 text-xs text-left hover:bg-white/10 text-zinc-300 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            Paste
          </button>
        </div>
      )}
    </div>
  );
}
