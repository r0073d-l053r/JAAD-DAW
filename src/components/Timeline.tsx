import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useApp } from '../lib/store';
import type { Marker } from '../lib/store';
import { audioEngine } from '../lib/audioEngine';
import { useAudioImport } from '../lib/useAudioImport';

import { ClipItem } from './ClipItem';
import { Playhead } from './timeline/Playhead';
import { TimelineRuler, MarkerGuidelines, TempoAutomationLane, MarkerEditModal } from './timeline/TimelineRuler';
import { AutomationLane } from './timeline/AutomationLane';
import { useLassoSelection, LassoOverlay, TimeSelectionOverlay } from './timeline/LassoSelection';

export function Timeline() {
  const { state, dispatch } = useApp();
  const timelineRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const PIXELS_PER_SECOND = state.zoomLevel;
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [editingMarker, setEditingMarker] = useState<Marker | null>(null);

  const { importAudioFiles } = useAudioImport();

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
      const timeline = timelineRef.current;
      if (!timeline) return;

      await importAudioFiles(files, { logLabel: 'Timeline' });
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files as FileList);
      await importAudioFiles(files, { trackStyle: 'compact', logLabel: 'Timeline file select' });
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const clickTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const {
    lasso,
    handlePointerDownCapture,
    handlePointerMove,
    handlePointerUp,
    wasLassoingRef,
    wasDraggingRef,
    isDoubleClickRef
  } = useLassoSelection({ timelineRef, clickTimeoutRef });

  const handleMouseDown = (e: React.MouseEvent) => {
    // This is now mainly for clicks that didn't get intercepted by capture
    // such as the first click of a potential double click
    if (e.button !== 0) return;

    // If we click on a clip, let the clip handle its own selection / range drag
    // unless it was a double-click (which is handled by capture phase)
    if ((e.target as HTMLElement).closest('.clip-item')) return;
  };

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
      <LassoOverlay lasso={lasso} />
      <TimeSelectionOverlay />
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
        <TimelineRuler
          timelineRef={timelineRef}
          startDraggingPlayhead={startDraggingPlayhead}
          onEditMarker={setEditingMarker}
        />
        <Playhead PIXELS_PER_SECOND={PIXELS_PER_SECOND} startDraggingPlayhead={startDraggingPlayhead} mode="line" />


        {/* Tracks */}
        <div
          className="relative flex-1 flex flex-col"
          style={state.snapToGrid ? {
            backgroundImage: `linear-gradient(to right, rgba(255, 255, 255, 0.05) 1px, transparent 1px)`,
            backgroundSize: `${(60 / state.bpm) * PIXELS_PER_SECOND}px 100%`
          } : {}}
        >
          {/* Visual marker guidelines */}
          <MarkerGuidelines />

          {/* Master Tempo Lane */}
          <TempoAutomationLane />

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

              {/* Automation Lanes (volume + pan), expanded via the AUTO badge */}
              <AnimatePresence>
                {track.showAutomation && (['volume', 'pan'] as const).map((param) => (
                  <AutomationLane
                    key={`${track.id}-auto-${param}`}
                    track={track}
                    param={param}
                  />
                ))}
              </AnimatePresence>

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

      {/* Marker Edit Modal */}
      <MarkerEditModal
        marker={editingMarker}
        onChange={setEditingMarker}
        onClose={() => setEditingMarker(null)}
      />
    </div>
  );
}
