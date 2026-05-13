import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useDragControls, useMotionValue } from "motion/react";
import { Scissors, Trash2 } from "lucide-react";
import { useApp, Clip } from "../lib/store";
import { Waveform } from "./Waveform";

export function ClipItem({
  clip,
  track,
  trackId,
  laneId,
}: {
  key?: React.Key;
  clip: Clip;
  track: any;
  trackId: string;
  laneId?: string;
}) {
  const { state, dispatch } = useApp();
  const dragControls = useDragControls();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const PIXELS_PER_SECOND = state.zoomLevel;

  const isSelected = state.selectedClipIds.includes(clip.id);

  // selection state coordinates relative to the clip
  const [dragStartOffset, setDragStartOffset] = useState<number | null>(null);
  const [currentDragOffset, setCurrentDragOffset] = useState<number | null>(null);

  // Envelope state
  const [draggingEnvNode, setDraggingEnvNode] = useState<number | null>(null);

  // Resize State
  const [resizing, setResizing] = useState<"left" | "right" | null>(null);
  const [resizeStart, setResizeStart] = useState(0);
  const [initialClipSnap, setInitialClipSnap] = useState<{
    start: number;
    duration: number;
    audioOffset: number;
  } | null>(null);

  // Context Menu State
  const [clipContextMenu, setClipContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [selectionContextMenu, setSelectionContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const colorInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const handleClick = () => {
      setClipContextMenu(null);
      setSelectionContextMenu(null);
    };
    if (clipContextMenu || selectionContextMenu) {
      window.addEventListener("click", handleClick);
      window.addEventListener("contextmenu", handleClick);
    }
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("contextmenu", handleClick);
    };
  }, [clipContextMenu, selectionContextMenu]);

  const handleClipContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    // Select clip on right-click if not selected
    if (!isSelected) {
      if (state.timeSelection) {
        dispatch({ type: "SET_TIME_SELECTION", payload: null });
      }
      dispatch({
        type: "SELECT_CLIP",
        payload: {
          clipId: clip.id,
          multi: e.ctrlKey || e.shiftKey || e.metaKey,
        },
      });
    }
    
    setClipContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleSelectionContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setSelectionContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleResizeStart = (e: React.PointerEvent, edge: "left" | "right") => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setResizing(edge);
    setResizeStart(e.clientX);
    setInitialClipSnap({
      start: clip.start,
      duration: clip.duration,
      audioOffset: clip.audioOffset || 0,
    });
  };

  const handleResizeMove = (e: React.PointerEvent) => {
    if (!resizing || !initialClipSnap) return;
    e.stopPropagation();

    const deltaX = e.clientX - resizeStart;
    const deltaTime = deltaX / PIXELS_PER_SECOND;

    if (resizing === "right") {
      let newDuration = initialClipSnap.duration + deltaTime;
      if (state.snapToGrid) {
        const beat = 60 / state.bpm;
        newDuration = Math.round(newDuration / beat) * beat;
      }
      newDuration = Math.max(0.1, newDuration);
      dispatch({
        type: "UPDATE_CLIP",
        payload: {
          trackId,
          clipId: clip.id,
          changes: { duration: newDuration },
        },
      });
    } else if (resizing === "left") {
      let newStart = initialClipSnap.start + deltaTime;
      if (state.snapToGrid) {
        const beat = 60 / state.bpm;
        newStart = Math.round(newStart / beat) * beat;
      }
      if (newStart >= initialClipSnap.start + initialClipSnap.duration - 0.1) {
        newStart = initialClipSnap.start + initialClipSnap.duration - 0.1;
      }
      newStart = Math.max(0, newStart);

      const timeDiff = newStart - initialClipSnap.start;
      dispatch({
        type: "UPDATE_CLIP",
        payload: {
          trackId,
          clipId: clip.id,
          changes: {
            start: newStart,
            duration: initialClipSnap.duration - timeDiff,
            audioOffset: initialClipSnap.audioOffset + timeDiff,
          },
        },
      });
    }
  };

  const handleResizeEnd = (e: React.PointerEvent) => {
    if (resizing) {
      e.stopPropagation();
      e.currentTarget.releasePointerCapture(e.pointerId);
      setResizing(null);
      setInitialClipSnap(null);

      dispatch({
        type: "FINALIZE_CLIP_OVERLAPS",
        payload: {
          trackId,
          laneId,
          clipId: clip.id,
        },
      });
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    // Only handle left click for starting selection
    if (e.button !== 0) return;

    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!isSelected) {
      dispatch({
        type: "SELECT_CLIP",
        payload: {
          clipId: clip.id,
          multi: e.ctrlKey || e.shiftKey || e.metaKey,
        },
      });
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const timeOffset = x / PIXELS_PER_SECOND;
    setDragStartOffset(timeOffset);
    setCurrentDragOffset(timeOffset);
    
    if (state.timeSelection && !(e.ctrlKey || e.shiftKey || e.metaKey)) {
      // If we are clicking inside an existing selection, don't clear it
      const clickTime = (clip.start + timeOffset);
      const isInsideSelection = state.timeSelection.startTime <= clickTime && state.timeSelection.endTime >= clickTime && state.timeSelection.trackIds.includes(trackId);
      
      if (!isInsideSelection) {
        dispatch({ type: "SET_TIME_SELECTION", payload: null });
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (dragStartOffset !== null) {
      const rect = e.currentTarget.getBoundingClientRect();
      let x = e.clientX - rect.left;
      x = Math.max(0, Math.min(rect.width, x));
      setCurrentDragOffset(x / PIXELS_PER_SECOND);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragStartOffset !== null && currentDragOffset !== null) {
      const startSec = Math.min(dragStartOffset, currentDragOffset);
      const endSec = Math.max(dragStartOffset, currentDragOffset);
      const rect = e.currentTarget.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const clickTime = clip.start + (clickX / PIXELS_PER_SECOND);

      if (endSec - startSec > 0.05) {
        // Create global time selection starting from this clip's time
        dispatch({
          type: "SET_TIME_SELECTION",
          payload: {
            startTime: clip.start + startSec,
            endTime: clip.start + endSec,
            trackIds: [trackId], // Standard click-drag on one track selects just that track
          },
        });
      } else {
        // Just a click. 
        // 1. Move playhead
        dispatch({ type: 'SET_TIME', payload: Math.max(0, clickTime) });

        // 2. Clear selection if not inside
        const isInsideSelection = state.timeSelection && 
                                  state.timeSelection.trackIds.includes(trackId) && 
                                  clickTime >= state.timeSelection.startTime && 
                                  clickTime <= state.timeSelection.endTime;

        if (!isInsideSelection && state.timeSelection) {
          dispatch({ type: "SET_TIME_SELECTION", payload: null });
        }
      }
    }
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragStartOffset(null);
    setCurrentDragOffset(null);
  };

  const handleEnvNodePointerDown = (e: React.PointerEvent, index: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggingEnvNode(index);
  };

  const handleEnvNodePointerMove = (e: React.PointerEvent) => {
    if (draggingEnvNode === null || !clip.volumeEnvelope) return;
    e.stopPropagation();
    
    const rect = e.currentTarget.closest('.clip-item')?.getBoundingClientRect();
    if (!rect) return;

    let x = e.clientX - rect.left;
    let y = e.clientY - rect.top;
    
    const minX = draggingEnvNode > 0 ? clip.volumeEnvelope[draggingEnvNode - 1].time * PIXELS_PER_SECOND : 0;
    const maxX = draggingEnvNode < clip.volumeEnvelope.length - 1 ? clip.volumeEnvelope[draggingEnvNode + 1].time * PIXELS_PER_SECOND : clip.duration * PIXELS_PER_SECOND;
    
    x = Math.max(minX, Math.min(maxX, x));
    y = Math.max(0, Math.min(rect.height, y));

    const time = x / PIXELS_PER_SECOND;
    const value = 1 - (y / rect.height);

    const newEnv = [...clip.volumeEnvelope];
    newEnv[draggingEnvNode] = { time, value };
    
    dispatch({
      type: "UPDATE_CLIP",
      payload: { trackId, clipId: clip.id, changes: { volumeEnvelope: newEnv } }
    });
  };

  const handleEnvNodePointerUp = (e: React.PointerEvent) => {
    if (draggingEnvNode !== null) {
      e.stopPropagation();
      e.currentTarget.releasePointerCapture(e.pointerId);
      setDraggingEnvNode(null);
    }
  };

  const drawSelection = () => {
    let start = 0,
      end = 0;
    let isGlobal = false;
    
    if (dragStartOffset !== null && currentDragOffset !== null) {
      start = Math.min(dragStartOffset, currentDragOffset);
      end = Math.max(dragStartOffset, currentDragOffset);
    } else if (state.timeSelection && state.timeSelection.trackIds.includes(trackId)) {
      const clipEnd = clip.start + clip.duration;
      const selStart = state.timeSelection.startTime;
      const selEnd = state.timeSelection.endTime;
      
      const intersectStart = Math.max(clip.start, selStart);
      const intersectEnd = Math.min(clipEnd, selEnd);
      
      if (intersectStart < intersectEnd) {
        start = intersectStart - clip.start;
        end = intersectEnd - clip.start;
        isGlobal = true;
      } else {
        return null;
      }
    } else {
      return null;
    }

    const left = start * PIXELS_PER_SECOND;
    const width = (end - start) * PIXELS_PER_SECOND;
    const isFinishedSelection = dragStartOffset === null && state.timeSelection !== null;
    const showSelection = isGlobal || dragStartOffset !== null || (state.timeSelection && state.timeSelection.trackIds.includes(trackId));

    if (!showSelection) return null;

    return (
      <div
        className={`absolute top-0 bottom-0 bg-primary/30 border-l-2 border-r-2 border-primary z-40 ${isFinishedSelection ? "pointer-events-auto cursor-pointer" : "pointer-events-none"}`}
        style={{ left, width }}
        onContextMenu={handleSelectionContextMenu}
      >
        {/* Visual indicator that this is an active selection zone */}
        {isFinishedSelection && (
          <div className="absolute inset-0 bg-white/5 hover:bg-white/10 transition-colors" />
        )}
        {isFinishedSelection &&
          selectionContextMenu &&
          createPortal(
            <div
              className="fixed z-[99999] bg-[#1c1c1e] border border-white/10 rounded-lg shadow-2xl py-1 min-w-[160px]"
              style={{
                top: selectionContextMenu.y,
                left: selectionContextMenu.x,
              }}
              onClick={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
            >
              <button
                className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: "SPLIT_CLIP" });
                  setSelectionContextMenu(null);
                }}
              >
                Split
              </button>
              <button
                className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-white/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: "DELETE_CLIPS" });
                  setSelectionContextMenu(null);
                }}
              >
                Delete section
              </button>
              <button
                className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: "CUT_CLIPS" });
                  setSelectionContextMenu(null);
                }}
              >
                Cut
              </button>
              <button
                className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: "COPY_CLIPS" });
                  setSelectionContextMenu(null);
                }}
              >
                Copy
              </button>
              <button
                className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: "DUPLICATE_CLIPS" });
                  setSelectionContextMenu(null);
                }}
              >
                Duplicate
              </button>
              <div className="h-px bg-white/10 my-1 w-full" />
              <button
                className="w-full text-left px-4 py-2 text-sm text-[#FF9800] hover:bg-white/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  alert("Remixing section (drag to create form)");
                  setSelectionContextMenu(null);
                }}
              >
                Remix section
              </button>
              <button
                className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  alert("Healing edits on section");
                  setSelectionContextMenu(null);
                }}
              >
                Heal Edits
              </button>
              <button
                className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  alert("Removing FX from section");
                  setSelectionContextMenu(null);
                }}
              >
                Remove FX
              </button>
              <button
                className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  alert("Downloading section as .WAV");
                  setSelectionContextMenu(null);
                }}
              >
                Download .WAV
              </button>
            </div>,
            document.body,
          )}
      </div>
    );
  };

  return (
    <motion.div
      drag
      dragMomentum={false}
      dragElastic={0}
      dragListener={false}
      dragControls={dragControls}
      dragConstraints={{ left: -clip.start * PIXELS_PER_SECOND }}
      onDragEnd={(e, info) => {
        let newStart = clip.start + info.offset.x / PIXELS_PER_SECOND;
        if (state.snapToGrid) {
          const beatDuration = 60 / state.bpm;
          newStart = Math.round(newStart / beatDuration) * beatDuration;
        }
        newStart = Math.max(0, newStart);

        if (isSelected && state.selectedClipIds.length > 1) {
          const timeDelta = newStart - clip.start;
          dispatch({ type: "MOVE_SELECTED_CLIPS", payload: { timeDelta } });
          x.set(0);
          y.set(0);
          return;
        }

        let targetTrackId = trackId;
        let targetLaneId: string | undefined = undefined;

        const elements = document.elementsFromPoint(info.point.x, info.point.y);
        for (const el of elements) {
          const tId = el.getAttribute("data-track-id");
          const lId = el.getAttribute("data-lane-id");
          if (tId) targetTrackId = tId;
          if (lId) targetLaneId = lId;
          if (tId || lId) break;
        }

        if (targetLaneId) {
          dispatch({
            type: "MOVE_CLIP_TO_LANE",
            payload: {
              sourceTrackId: trackId,
              sourceLaneId: laneId,
              clipId: clip.id,
              targetTrackId,
              targetLaneId,
              newStart,
            },
          });
        } else {
          dispatch({
            type: "MOVE_AND_OVERWRITE_CLIP",
            payload: {
              sourceTrackId: trackId,
              sourceLaneId: laneId,
              clipId: clip.id,
              targetTrackId,
              newStart,
            },
          });
        }
        
        x.set(0);
        y.set(0);
      }}
      onContextMenu={handleClipContextMenu}
      className={`clip-item absolute rounded-lg overflow-hidden group/clip transition-all duration-300 ${laneId ? "top-1 bottom-1 h-auto" : "top-2 bottom-2 max-h-24"} ${isSelected ? "z-10 shadow-xl" : "hover:z-20 shadow-md"}`}
      style={{
        x,
        y,
        left: `${clip.start * PIXELS_PER_SECOND}px`,
        width: `${clip.duration * PIXELS_PER_SECOND}px`,
        backgroundColor: isSelected ? `${track.color}60` : `${track.color}30`,
        boxShadow: isSelected
          ? `0 12px 40px rgba(0,0,0,0.6), inset 0 0 10px rgba(255,255,255,0.4), inset 0 0 0 1.5px rgba(255,255,255,1)`
          : `0 4px 12px rgba(0,0,0,0.4), inset 0 0 8px rgba(0,0,0,0.3), inset 0 0 0 1.5px ${track.color}90`,
        willChange: "left, transform",
      }}
    >
      {/* Clip Context Menu */}
      {clipContextMenu &&
        createPortal(
          <div
            className="fixed z-[99999] bg-[#1c1c1e] border border-white/10 rounded-lg shadow-2xl py-1 w-32"
            style={{ top: clipContextMenu.y, left: clipContextMenu.x }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
          >
            <button
              className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-white/10 transition-colors"
              onClick={() => {
                dispatch({ type: "SET_TIME_SELECTION", payload: null });
                dispatch({
                  type: "SELECT_CLIP",
                  payload: { clipId: clip.id, multi: false },
                });
                dispatch({ type: "DELETE_CLIPS" });
                setClipContextMenu(null);
              }}
            >
              Delete Stem
            </button>
            {state.selectedClipIds.length > 1 && (
              <button
                className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
                onClick={() => {
                  dispatch({ type: "GROUP_CLIPS" });
                  setClipContextMenu(null);
                }}
              >
                Group Clips
              </button>
            )}
            {clip.groupId && (
              <button
                className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
                onClick={() => {
                  dispatch({ type: "UNGROUP_CLIPS" });
                  setClipContextMenu(null);
                }}
              >
                Ungroup Clips
              </button>
            )}
            <div className="h-px bg-white/10 my-1 w-full" />
            <button
              className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
              onClick={() => {
                if (clip.volumeEnvelope) {
                  dispatch({
                    type: "UPDATE_CLIP",
                    payload: { trackId, clipId: clip.id, changes: { volumeEnvelope: undefined } }
                  });
                } else {
                  dispatch({
                    type: "UPDATE_CLIP",
                    payload: { trackId, clipId: clip.id, changes: { volumeEnvelope: [{ time: 0, value: 1 }, { time: clip.duration, value: 1 }] } }
                  });
                }
                setClipContextMenu(null);
              }}
            >
              {clip.volumeEnvelope ? "Remove Volume Envelope" : "Add Volume Envelope"}
            </button>
            <button
              className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
              onClick={() => {
                alert("Extracting stems... (AI process would run here)");
                setClipContextMenu(null);
              }}
            >
              Extract Stems
            </button>
          </div>,
          document.body,
        )}



      {/* Drag Handle Top Bar */}
      <div
        className="absolute top-0 left-0 right-0 h-4 bg-black/20 hover:bg-white/20 cursor-grab active:cursor-grabbing z-30 transition-colors"
        onPointerDown={(e) => {
          e.stopPropagation();
          dragControls.start(e);
        }}
        onContextMenu={handleClipContextMenu}
        title="Drag to move clip"
      />

      {clip.groupId && (
        <div className="absolute top-1 right-2 text-white/50 pointer-events-none z-10" title="Grouped">
           <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
        </div>
      )}

      {/* Real Waveform */}
      <div className="absolute inset-0 pointer-events-none">
        <Waveform
          clipId={clip.id}
          bufferId={clip.bufferId}
          color={track.color}
          duration={clip.duration}
          width={clip.duration * PIXELS_PER_SECOND}
          height={laneId ? 32 : 94}
          audioOffset={clip.audioOffset || 0}
        />
      </div>

      <div className="absolute top-5 left-2 text-[10px] text-white/70 font-mono hidden group-hover/clip:block truncate max-w-full mix-blend-difference z-10 pointer-events-none">
        {clip.audioData || "Audio Clip"}
      </div>

      {/* Selection zone (the rest of the clip body) */}
      <div
        className="absolute top-4 bottom-0 left-0 right-0 z-10 cursor-text"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={(e) => {
          if (!clip.volumeEnvelope) return;
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const time = x / PIXELS_PER_SECOND;
          const value = 1 - (y / rect.height);
          
          const newEnv = [...clip.volumeEnvelope];
          // Insert sorted
          newEnv.push({ time, value });
          newEnv.sort((a, b) => a.time - b.time);
          
          dispatch({
            type: "UPDATE_CLIP",
            payload: { trackId, clipId: clip.id, changes: { volumeEnvelope: newEnv } }
          });
        }}
      />

      {/* Envelope Overlay */}
      {clip.volumeEnvelope && (
         <svg className="absolute inset-0 z-20 pointer-events-none" width="100%" height="100%">
            <polyline 
               points={clip.volumeEnvelope.map(pt => `${pt.time * PIXELS_PER_SECOND},${(1 - pt.value) * 100}%`).join(' ')}
               fill="none" 
               stroke="white" 
               strokeWidth="2" 
               opacity="0.8"
            />
            {clip.volumeEnvelope.map((pt, i) => (
               <circle 
                  key={i} 
                  cx={pt.time * PIXELS_PER_SECOND} 
                  cy={`${(1 - pt.value) * 100}%`} 
                  r="5" 
                  fill="white" 
                  className="pointer-events-auto cursor-ns-resize"
                  onPointerDown={(e) => handleEnvNodePointerDown(e, i)}
                  onPointerMove={draggingEnvNode === i ? handleEnvNodePointerMove : undefined}
                  onPointerUp={handleEnvNodePointerUp}
                  onPointerCancel={handleEnvNodePointerUp}
               />
            ))}
         </svg>
      )}

      {drawSelection()}

      {/* Resize handles */}
      <div
        className="absolute left-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-white/40 z-30 flex items-center justify-center group/resize"
        onPointerDown={(e) => handleResizeStart(e, "left")}
        onPointerMove={resizing === "left" ? handleResizeMove : undefined}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
      >
        <div className="w-0.5 h-4 bg-white/50 group-hover/resize:bg-white rounded-full" />
      </div>
      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-white/40 z-30 flex items-center justify-center group/resize"
        onPointerDown={(e) => handleResizeStart(e, "right")}
        onPointerMove={resizing === "right" ? handleResizeMove : undefined}
        onPointerUp={handleResizeEnd}
        onPointerCancel={handleResizeEnd}
      >
        <div className="w-0.5 h-4 bg-white/50 group-hover/resize:bg-white rounded-full" />
      </div>
    </motion.div>
  );
}
