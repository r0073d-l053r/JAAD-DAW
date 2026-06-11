import React, { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, useDragControls, useMotionValue } from "motion/react";
import { Music2, Scissors, Trash2, Wand2 } from "lucide-react";
import { useApp, Clip } from "../lib/store";
import { Waveform } from "./Waveform";
import { Spectrogram } from "./Spectrogram";
import { audioEngine } from "../lib/audioEngine";
import { useGemini } from "../lib/useGemini";

// Memoized: timelines render one ClipItem per clip, so parent re-renders
// (lasso drags, zoom hovers, marker edits) would otherwise re-render every
// clip even when its props and store state are unchanged.
export const ClipItem = React.memo(function ClipItem({
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

  const [isDragging, setIsDragging] = useState(false);
  const isSelected = state.selectedClipIds.includes(clip.id);

  // MIDI clips carry notes and have no decoded audio buffer; they render a
  // note-pattern preview instead of a waveform and open the piano roll editor.
  const hasNotes = !!clip.notes && clip.notes.length > 0;
  const isMidiClip =
    hasNotes && !audioEngine.buffers.has(clip.bufferId || clip.id);

  // selection state coordinates relative to the clip
  const [dragStartOffset, setDragStartOffset] = useState<number | null>(null);
  const [currentDragOffset, setCurrentDragOffset] = useState<number | null>(null);

  // Envelope state
  const [draggingEnvNode, setDraggingEnvNode] = useState<number | null>(null);

  // Fade handle state. UPDATE_CLIP saves an undo snapshot on every dispatch,
  // so the fade length is kept in local state while dragging and committed
  // with a single UPDATE_CLIP on pointer release.
  const [draggingFade, setDraggingFade] = useState<"in" | "out" | null>(null);
  const fadeDragStart = useRef<{ x: number; initial: number }>({ x: 0, initial: 0 });
  const [fadePreview, setFadePreview] = useState<{ fadeIn: number; fadeOut: number } | null>(null);

  // Resize State
  const [resizing, setResizing] = useState<"left" | "right" | null>(null);
  const [resizeStart, setResizeStart] = useState(0);
  const [initialClipSnap, setInitialClipSnap] = useState<{
    start: number;
    duration: number;
    audioOffset: number;
  } | null>(null);

  // Context Menu State (Now handled globally in store.tsx)
  const { tagClip } = useGemini();
  const [isTagging, setIsTagging] = useState(false);

  const handleTagClip = async () => {
    setIsTagging(true);
    const buffer = audioEngine.buffers.get(clip.bufferId || clip.id);
    if (buffer) {
      const tag = await tagClip(buffer);
      if (tag) {
        dispatch({
          type: "UPDATE_CLIP",
          payload: { trackId, clipId: clip.id, changes: { audioData: tag } }
        });
      }
    }
    setIsTagging(false);
    dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
  };

  const colorInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const handleClick = () => {
      dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
    };
    
    const isThisClipMenu = state.activeContextMenu?.type === "clip" && state.activeContextMenu?.clipId === clip.id;
    const isThisSelectionMenu = state.activeContextMenu?.type === "selection" && state.activeContextMenu?.trackId === trackId;
    
    if (isThisClipMenu || isThisSelectionMenu) {
      window.addEventListener("click", handleClick);
      window.addEventListener("contextmenu", handleClick);
    }
    return () => {
      window.removeEventListener("click", handleClick);
      window.removeEventListener("contextmenu", handleClick);
    };
  }, [state.activeContextMenu?.clipId, state.activeContextMenu?.trackId, clip.id, trackId]);

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
    
    // Safe width and height estimates to prevent overflow/clipping
    const menuWidth = 192; // w-48 is 192px
    const menuHeight = 520; // safe max height for the clip context menu with all actions (including optional buttons)
    
    let x = e.clientX;
    if (x + menuWidth > window.innerWidth) {
      x = Math.max(10, window.innerWidth - menuWidth - 10);
    }
    
    let y = e.clientY;
    if (y + menuHeight > window.innerHeight) {
      y = Math.max(20, window.innerHeight - menuHeight - 20); // Keep in bounds with 20px padding
    }
    
    dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: { type: "clip", clipId: clip.id, x, y } });
  };

  const handleSelectionContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const menuWidth = 180; // min-w-[180px] -> 180px width
    const menuHeight = 440; // Approximate height of selection context menu
    
    let x = e.clientX;
    if (x + menuWidth > window.innerWidth) {
      x = Math.max(10, window.innerWidth - menuWidth - 10);
    }
    
    let y = e.clientY;
    if (y + menuHeight > window.innerHeight) {
      y = Math.max(20, window.innerHeight - menuHeight - 20);
    }
    
    dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: { type: "selection", trackId, x, y } });
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

  const handleFadePointerDown = (e: React.PointerEvent, side: "in" | "out") => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggingFade(side);
    fadeDragStart.current = {
      x: e.clientX,
      initial: side === "in" ? clip.fadeIn || 0 : clip.fadeOut || 0,
    };
    setFadePreview({ fadeIn: clip.fadeIn || 0, fadeOut: clip.fadeOut || 0 });
  };

  const computeFadeValue = (e: React.PointerEvent, side: "in" | "out") => {
    const deltaTime = (e.clientX - fadeDragStart.current.x) / PIXELS_PER_SECOND;
    if (side === "in") {
      // Dragging right lengthens the fade-in; never cross the fade-out.
      const max = Math.max(0, clip.duration - (clip.fadeOut || 0));
      return Math.min(max, Math.max(0, fadeDragStart.current.initial + deltaTime));
    }
    // Dragging left lengthens the fade-out; never cross the fade-in.
    const max = Math.max(0, clip.duration - (clip.fadeIn || 0));
    return Math.min(max, Math.max(0, fadeDragStart.current.initial - deltaTime));
  };

  const handleFadePointerMove = (e: React.PointerEvent) => {
    if (!draggingFade) return;
    e.stopPropagation();
    const value = computeFadeValue(e, draggingFade);
    setFadePreview({
      fadeIn: draggingFade === "in" ? value : clip.fadeIn || 0,
      fadeOut: draggingFade === "out" ? value : clip.fadeOut || 0,
    });
  };

  const handleFadePointerUp = (e: React.PointerEvent) => {
    if (!draggingFade) return;
    e.stopPropagation();
    e.currentTarget.releasePointerCapture(e.pointerId);
    const value = computeFadeValue(e, draggingFade);
    // Single commit on release so one drag equals one undo step.
    dispatch({
      type: "UPDATE_CLIP",
      payload: {
        trackId,
        clipId: clip.id,
        changes:
          draggingFade === "in"
            ? { fadeIn: value > 0.01 ? value : undefined }
            : { fadeOut: value > 0.01 ? value : undefined },
      },
    });
    setDraggingFade(null);
    setFadePreview(null);
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
    let start: number, end: number;
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
          (state.activeContextMenu?.type === "selection" && state.activeContextMenu?.trackId === trackId) &&
          createPortal(
            <div
              className="fixed z-[99999] bg-[#1c1c1e] border border-white/10 rounded-lg shadow-2xl py-1 min-w-[180px]"
              style={{
                top: state.activeContextMenu.y,
                left: state.activeContextMenu.x,
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
                  dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
                }}
              >
                Split
              </button>
              <button
                className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-white/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: "DELETE_CLIPS" });
                  dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
                }}
              >
                Delete section
              </button>
              <button
                className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: "CUT_CLIPS" });
                  dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
                }}
              >
                Cut
              </button>
              <button
                className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: "COPY_CLIPS" });
                  dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
                }}
              >
                Copy
              </button>
              <button
                className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  dispatch({ type: "DUPLICATE_CLIPS" });
                  dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
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
                  dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
                }}
              >
                Remix section
              </button>
              <button
                className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  alert("Healing edits on section");
                  dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
                }}
              >
                Heal Edits
              </button>
              <button
                className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  alert("Removing FX from section");
                  dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
                }}
              >
                Remove FX
              </button>
              <button
                className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  alert("Downloading section as .WAV");
                  dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
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
      onDragStart={() => setIsDragging(true)}
      onDrag={(e: any) => {
        if (e.shiftKey) {
          x.set(0);
        }
      }}
      onDragEnd={(e: any, info) => {
        setIsDragging(false);
        let newStart = clip.start + (e.shiftKey ? 0 : info.offset.x / PIXELS_PER_SECOND);
        
        // MAGNETIC SNAPPING LOGIC
        const SNAP_THRESHOLD_TIME = 0.15; // 150ms window for snapping
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

        const targetTrack = state.tracks.find(t => t.id === targetTrackId);
        let snapped = false;

        if (targetTrack) {
          // Collect all possible snap points on this track (clips, lanes, and playhead)
          const snapPoints = new Set<number>();
          snapPoints.add(state.currentTime); // Always snap to playhead
          
          targetTrack.clips.forEach(c => {
            if (c.id !== clip.id) {
              snapPoints.add(c.start);
              snapPoints.add(c.start + c.duration);
            }
          });
          targetTrack.lanes?.forEach(l => {
            l.clips.forEach(c => {
              if (c.id !== clip.id) {
                snapPoints.add(c.start);
                snapPoints.add(c.start + c.duration);
              }
            });
          });

          // Check for snapping (Left edge of clip)
          for (const point of snapPoints) {
            if (Math.abs(newStart - point) < SNAP_THRESHOLD_TIME) {
              newStart = point;
              snapped = true;
              break;
            }
          }

          // Check for snapping (Right edge of clip)
          if (!snapped) {
            const currentEnd = newStart + clip.duration;
            for (const point of snapPoints) {
              if (Math.abs(currentEnd - point) < SNAP_THRESHOLD_TIME) {
                newStart = point - clip.duration;
                snapped = true;
                break;
              }
            }
          }
        }

        // Fallback to Grid Snapping if no clip/playhead snap occurred
        if (!snapped && state.snapToGrid) {
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
      className={`clip-item absolute rounded-lg overflow-hidden group/clip transition-[background-color,box-shadow,opacity,transform] duration-300 ${laneId ? "top-1 bottom-1 h-auto" : "top-2 bottom-2 max-h-24"} ${isDragging ? "z-[1000] opacity-90 scale-[1.02] shadow-2xl" : isSelected ? "z-10 shadow-xl" : "hover:z-20 shadow-md"}`}
      style={{
        x,
        y,
        left: `${clip.start * PIXELS_PER_SECOND}px`,
        width: `${clip.duration * PIXELS_PER_SECOND}px`,
        backgroundColor: isDragging ? `${track.color}90` : isSelected ? `${track.color}60` : `${track.color}30`,
        boxShadow: isDragging 
          ? `0 25px 50px -12px rgba(0, 0, 0, 0.7), inset 0 0 15px rgba(255,255,255,0.5), 0 0 0 2px ${track.color}`
          : isSelected
          ? `0 12px 40px rgba(0,0,0,0.6), inset 0 0 10px rgba(255,255,255,0.4), inset 0 0 0 1.5px rgba(255,255,255,1)`
          : `0 4px 12px rgba(0,0,0,0.4), inset 0 0 8px rgba(0,0,0,0.3), inset 0 0 0 1.5px ${track.color}90`,
        willChange: "left, transform",
      }}
    >
      {/* Clip Context Menu */}
      {(state.activeContextMenu?.type === "clip" && state.activeContextMenu?.clipId === clip.id) &&
        createPortal(
          <div
            className="fixed z-[99999] bg-[#1c1c1e] border border-white/10 rounded-lg shadow-2xl py-1 w-48"
            style={{ top: state.activeContextMenu.y, left: state.activeContextMenu.x }}
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
                dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
              }}
            >
              Delete Stem
            </button>
            <button
              className="w-full text-left px-4 py-2 text-sm text-orange-400 hover:bg-white/10 transition-colors"
              onClick={() => {
                dispatch({ 
                  type: "REVERT_CLIP_TO_ORIGINAL", 
                  payload: { trackId, laneId, clipId: clip.id } 
                });
                dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
              }}
            >
              Revert to Original
            </button>
            {hasNotes && !laneId && (
              <button
                aria-label="Edit MIDI notes in piano roll"
                className="w-full text-left px-4 py-2 text-sm text-[#10b981] hover:bg-white/10 transition-colors flex items-center gap-2"
                onClick={() => {
                  dispatch({ type: "SET_PIANO_ROLL_CLIP", payload: clip.id });
                  dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
                }}
              >
                <Music2 size={14} />
                <span>Edit MIDI</span>
              </button>
            )}
            {state.selectedClipIds.length > 1 && (
              <button
                className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
                onClick={() => {
                  dispatch({ type: "GROUP_CLIPS" });
                  dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
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
                  dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
                }}
              >
                Ungroup Clips
              </button>
            )}
            <div className="h-px bg-white/10 my-1 w-full" />
            {!laneId && (
              <button
                className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
                onClick={() => {
                  dispatch({ 
                    type: "ADD_CLIP_TO_NEW_LANE", 
                    payload: { trackId, clipId: clip.id } 
                  });
                  dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
                }}
              >
                Add to Alternate Lane
              </button>
            )}
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
                dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
              }}
            >
              {clip.volumeEnvelope ? "Remove Volume Envelope" : "Add Volume Envelope"}
            </button>
            <button
              className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
              onClick={() => {
                dispatch({ type: "SET_STEM_SEPARATOR_CLIP", payload: clip.id });
                dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
              }}
            >
              Extract Stems
            </button>
            <button
              className="w-full text-left px-4 py-2 text-sm text-[#a882fa] hover:bg-white/10 transition-colors"
              onClick={() => {
                dispatch({ type: "SET_AUTHENTICITY_PROCESSOR_CLIP", payload: clip.id });
                dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
              }}
            >
              AI Authenticity
            </button>
            <div className="h-px bg-white/10 my-1 w-full" />
            <button
              className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
              onClick={() => {
                dispatch({ type: "REVERSE_CLIP", payload: { trackId, laneId, clipId: clip.id } });
                dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
              }}
            >
              Reverse Audio
            </button>
            <button
              className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
              onClick={() => {
                dispatch({ type: "INVERT_CLIP", payload: { trackId, laneId, clipId: clip.id } });
                dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
              }}
            >
              Invert Polarity
            </button>
            <button
              className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
              onClick={() => {
                dispatch({ type: "NORMALIZE_CLIP", payload: { trackId, laneId, clipId: clip.id } });
                dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
              }}
            >
              Normalize (-0.1dB)
            </button>
            {(() => {
              const hasOverlap = state.timeSelection && 
                (state.timeSelection.startTime < clip.start + clip.duration) &&
                (state.timeSelection.endTime > clip.start);
              if (!hasOverlap) return null;
              
              return (
                <button
                  className="w-full text-left px-4 py-2 text-sm text-white hover:bg-white/10 transition-colors"
                  onClick={() => {
                    const selStart = Math.max(clip.start, state.timeSelection!.startTime);
                    const selEnd = Math.min(clip.start + clip.duration, state.timeSelection!.endTime);
                    dispatch({
                      type: "SILENCE_CLIP_SELECTION",
                      payload: {
                        trackId,
                        laneId,
                        clipId: clip.id,
                        start: selStart,
                        duration: selEnd - selStart
                      }
                    });
                    dispatch({ type: "SET_ACTIVE_CONTEXT_MENU", payload: null });
                  }}
                >
                  Silence Selection
                </button>
              );
            })()}
            <div className="h-px bg-white/10 my-1 w-full" />
            <button
              className="w-full text-left px-4 py-2 text-sm text-primary hover:bg-white/10 transition-colors flex items-center gap-2"
              disabled={isTagging}
              onClick={handleTagClip}
            >
              <Wand2 size={14} className={isTagging ? 'animate-spin' : ''} />
              <span>{isTagging ? 'Tagging...' : 'AI Auto-Tag'}</span>
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

      {/* Real Waveform / Spectrogram / MIDI note preview */}
      <div className="absolute inset-0 pointer-events-none">
        {isMidiClip ? (
          (() => {
            const notes = clip.notes!;
            const secondsPerBeat = 60 / Math.max(1, state.bpm);
            const previewWidth = Math.max(1, clip.duration * PIXELS_PER_SECOND);
            const minNote = Math.min(...notes.map((n) => n.note));
            const maxNote = Math.max(...notes.map((n) => n.note));
            const range = Math.max(1, maxNote - minNote + 1);
            const noteHeight = Math.max(2.5, Math.min(8, 88 / range));
            return (
              <svg
                className="w-full h-full"
                viewBox={`0 0 ${previewWidth} 100`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {notes.map((n, i) => {
                  const x = n.start * secondsPerBeat * PIXELS_PER_SECOND;
                  const w = Math.max(
                    2,
                    n.duration * secondsPerBeat * PIXELS_PER_SECOND - 1,
                  );
                  const y = 6 + ((maxNote - n.note) / range) * 88;
                  return (
                    <rect
                      key={i}
                      x={x}
                      y={y}
                      width={w}
                      height={noteHeight}
                      rx="1"
                      fill="white"
                      fillOpacity="0.85"
                    />
                  );
                })}
              </svg>
            );
          })()
        ) : state.spectrogramEnabled ? (
          <Spectrogram
            clipId={clip.id}
            bufferId={clip.bufferId}
            duration={clip.duration}
            width={clip.duration * PIXELS_PER_SECOND}
            height={laneId ? 32 : 94}
            audioOffset={clip.audioOffset || 0}
          />
        ) : (
          <Waveform
            clipId={clip.id}
            bufferId={clip.bufferId}
            color={track.color}
            duration={clip.duration}
            width={clip.duration * PIXELS_PER_SECOND}
            height={laneId ? 32 : 94}
            audioOffset={clip.audioOffset || 0}
          />
        )}
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
          // Clips with MIDI notes open the piano roll editor on double-click
          if (hasNotes && !laneId) {
            e.stopPropagation();
            dispatch({ type: "SET_PIANO_ROLL_CLIP", payload: clip.id });
            return;
          }
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

      {/* Fade overlays: shaded triangles over the faded-out regions */}
      {(() => {
        const clipWidth = clip.duration * PIXELS_PER_SECOND;
        const rawFadeIn = fadePreview ? fadePreview.fadeIn : clip.fadeIn || 0;
        const rawFadeOut = fadePreview ? fadePreview.fadeOut : clip.fadeOut || 0;
        // Clamp for display in case the clip was trimmed shorter than its fades
        let dFadeIn = Math.max(0, Math.min(rawFadeIn, clip.duration));
        let dFadeOut = Math.max(0, Math.min(rawFadeOut, clip.duration));
        if (dFadeIn + dFadeOut > clip.duration && dFadeIn + dFadeOut > 0) {
          const scale = clip.duration / (dFadeIn + dFadeOut);
          dFadeIn *= scale;
          dFadeOut *= scale;
        }
        const fadeInX = dFadeIn * PIXELS_PER_SECOND;
        const fadeOutX = dFadeOut * PIXELS_PER_SECOND;

        return (
          <>
            {(dFadeIn > 0 || dFadeOut > 0) && (
              <svg
                className="absolute inset-0 z-20 pointer-events-none"
                width="100%"
                height="100%"
                viewBox={`0 0 ${Math.max(1, clipWidth)} 100`}
                preserveAspectRatio="none"
              >
                {dFadeIn > 0 && (
                  <>
                    <polygon points={`0,0 ${fadeInX},0 0,100`} fill="black" fillOpacity="0.45" />
                    <line x1="0" y1="100" x2={fadeInX} y2="0" stroke="white" strokeWidth="1.5" strokeOpacity="0.85" vectorEffect="non-scaling-stroke" />
                  </>
                )}
                {dFadeOut > 0 && (
                  <>
                    <polygon points={`${clipWidth - fadeOutX},0 ${clipWidth},0 ${clipWidth},100`} fill="black" fillOpacity="0.45" />
                    <line x1={clipWidth - fadeOutX} y1="0" x2={clipWidth} y2="100" stroke="white" strokeWidth="1.5" strokeOpacity="0.85" vectorEffect="non-scaling-stroke" />
                  </>
                )}
              </svg>
            )}

            {/* Fade handles: drag horizontally from the clip's top corners */}
            <div
              className={`absolute top-0 z-40 w-3.5 h-3.5 cursor-ew-resize transition-opacity ${
                draggingFade === "in" || dFadeIn > 0 ? "opacity-90" : "opacity-0 group-hover/clip:opacity-70"
              }`}
              style={{ left: Math.max(0, fadeInX - 7) }}
              title="Drag to set fade in"
              onPointerDown={(e) => handleFadePointerDown(e, "in")}
              onPointerMove={draggingFade === "in" ? handleFadePointerMove : undefined}
              onPointerUp={handleFadePointerUp}
              onPointerCancel={handleFadePointerUp}
            >
              <svg width="14" height="14" viewBox="0 0 14 14">
                <polygon points="1,1 13,1 7,11" fill="white" stroke="rgba(0,0,0,0.6)" strokeWidth="1" />
              </svg>
            </div>
            <div
              className={`absolute top-0 z-40 w-3.5 h-3.5 cursor-ew-resize transition-opacity ${
                draggingFade === "out" || dFadeOut > 0 ? "opacity-90" : "opacity-0 group-hover/clip:opacity-70"
              }`}
              style={{ right: Math.max(0, fadeOutX - 7) }}
              title="Drag to set fade out"
              onPointerDown={(e) => handleFadePointerDown(e, "out")}
              onPointerMove={draggingFade === "out" ? handleFadePointerMove : undefined}
              onPointerUp={handleFadePointerUp}
              onPointerCancel={handleFadePointerUp}
            >
              <svg width="14" height="14" viewBox="0 0 14 14">
                <polygon points="1,1 13,1 7,11" fill="white" stroke="rgba(0,0,0,0.6)" strokeWidth="1" />
              </svg>
            </div>
          </>
        );
      })()}

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
});
