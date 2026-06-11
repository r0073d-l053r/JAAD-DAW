import React, { useRef, useState } from 'react';
import { useApp } from '../../lib/store';

export interface LassoRect {
  start: { x: number; y: number };
  end: { x: number; y: number };
}

export interface UseLassoSelectionOptions {
  timelineRef: React.RefObject<HTMLDivElement | null>;
  /** Pending click-to-seek timeout owned by Timeline; cleared when a double-click starts a lasso. */
  clickTimeoutRef: React.RefObject<NodeJS.Timeout | null>;
}

/**
 * Rubber-band (lasso) selection: double-click + drag draws a box, hit-tests
 * track lanes, and dispatches a time selection for the overlapped tracks.
 */
export function useLassoSelection({ timelineRef, clickTimeoutRef }: UseLassoSelectionOptions) {
  const { state, dispatch } = useApp();
  const PIXELS_PER_SECOND = state.zoomLevel;

  const [lasso, setLasso] = useState<LassoRect | null>(null);
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

  return {
    lasso,
    handlePointerDownCapture,
    handlePointerMove,
    handlePointerUp,
    wasLassoingRef,
    wasDraggingRef,
    isDoubleClickRef
  };
}

export interface LassoOverlayProps {
  lasso: LassoRect | null;
}

/** Rubber-band rectangle drawn while the user is lassoing. */
export function LassoOverlay({ lasso }: LassoOverlayProps) {
  if (!lasso) return null;

  return (
    <div
      className="absolute border-2 border-primary bg-primary/20 z-[100] pointer-events-none rounded-sm shadow-[0_0_15px_rgba(var(--primary),0.3)]"
      style={{
        left: Math.min(lasso.start.x, lasso.end.x),
        top: Math.min(lasso.start.y, lasso.end.y),
        width: Math.abs(lasso.start.x - lasso.end.x),
        height: Math.abs(lasso.start.y - lasso.end.y),
      }}
    />
  );
}

/** Highlighted time-selection region (the result of a lasso), with the Heal Edits action. */
export function TimeSelectionOverlay() {
  const { state, dispatch } = useApp();
  const PIXELS_PER_SECOND = state.zoomLevel;

  if (!state.timeSelection) return null;

  return (
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
  );
}
