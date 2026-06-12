import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { useApp, Track } from '../../lib/store';
import {
  AutomationParam,
  AUTOMATION_RANGES,
  sortAutomationPoints,
} from '../../lib/automationUtils';

export const AUTOMATION_LANE_HEIGHT = 40; // must match the TrackList header rows
const PAD_Y = 6; // keeps breakpoints inside the lane at min/max values

export interface AutomationLaneProps {
  track: Track;
  param: AutomationParam;
  /**
   * React list key. Declared explicitly because this project has no
   * @types/react — React itself consumes the key and never passes it down,
   * but without LibraryManagedAttributes TS checks it against these props.
   */
  key?: string;
}

/**
 * Editable automation lane rendered under a track in the Timeline (expanded
 * via the AUTO badge in TrackList, mirroring the showLanes affordance).
 *
 * - double-click empty space: add a breakpoint (time snaps to the beat grid)
 * - drag a breakpoint: move it (committed as one undoable action on release)
 * - double-click a breakpoint: delete it
 */
export function AutomationLane({ track, param }: AutomationLaneProps) {
  const { state, dispatch } = useApp();
  const PIXELS_PER_SECOND = state.zoomLevel;
  const laneRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{
    index: number;
    time: number;
    value: number;
  } | null>(null);
  // Latest drag values for the mouseup commit (same pattern as stateRef in store.tsx)
  const dragRef = useRef(drag);
  useEffect(() => {
    dragRef.current = drag;
  }, [drag]);

  const points = track.automation?.[param] ?? [];
  const range = AUTOMATION_RANGES[param];

  const valueToY = (v: number) =>
    PAD_Y +
    (1 - (v - range.min) / (range.max - range.min)) *
      (AUTOMATION_LANE_HEIGHT - 2 * PAD_Y);

  const yToValue = (y: number) => {
    const norm =
      1 - (y - PAD_Y) / (AUTOMATION_LANE_HEIGHT - 2 * PAD_Y);
    const v = range.min + norm * (range.max - range.min);
    return Math.max(range.min, Math.min(range.max, v));
  };

  const snapTime = (time: number) => {
    if (!state.snapToGrid) return Math.max(0, time);
    const beatDuration = 60 / state.bpm;
    return Math.max(0, Math.round(time / beatDuration) * beatDuration);
  };

  const eventToTimeValue = (clientX: number, clientY: number) => {
    const rect = laneRef.current!.getBoundingClientRect();
    return {
      time: snapTime((clientX - rect.left) / PIXELS_PER_SECOND),
      value: yToValue(clientY - rect.top),
    };
  };

  // Window-level drag handling (same pattern as marker dragging in TimelineRuler)
  useEffect(() => {
    if (!drag) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!laneRef.current) return;
      const { time, value } = eventToTimeValue(e.clientX, e.clientY);
      setDrag((prev) => (prev ? { ...prev, time, value } : prev));
    };

    const handleMouseUp = () => {
      const finalDrag = dragRef.current;
      if (finalDrag) {
        // Single dispatch on release: one undo entry per drag gesture.
        dispatch({
          type: 'MOVE_AUTOMATION_POINT',
          payload: {
            trackId: track.id,
            param,
            index: finalDrag.index,
            time: finalDrag.time,
            value: finalDrag.value,
          },
        });
      }
      setDrag(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null, PIXELS_PER_SECOND, state.snapToGrid, state.bpm, track.id, param, dispatch]);

  // Preview the dragged point locally; commit happens on mouseup.
  const renderPoints = sortAutomationPoints(
    drag
      ? points.map((p, i) =>
          i === drag.index ? { time: drag.time, value: drag.value } : p,
        )
      : points,
  );

  const defaultY = valueToY(range.defaultValue);
  const polylinePoints = renderPoints
    .map((p) => `${p.time * PIXELS_PER_SECOND},${valueToY(p.value)}`)
    .join(' ');

  const laneColor = track.color || '#af52de';
  const label = param === 'volume' ? 'VOLUME' : 'PAN';

  return (
    <motion.div
      ref={laneRef}
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: AUTOMATION_LANE_HEIGHT, opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      className="automation-lane shrink-0 border-b border-[#2a2b30]/30 relative bg-[#0e0e11]/60 cursor-crosshair"
      data-track-id={track.id}
      data-automation-param={param}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onDoubleClick={(e) => {
        e.stopPropagation();
        if (!laneRef.current) return;
        const { time, value } = eventToTimeValue(e.clientX, e.clientY);
        dispatch({
          type: 'ADD_AUTOMATION_POINT',
          payload: { trackId: track.id, param, time, value },
        });
      }}
    >
      <span className="absolute left-1 top-0.5 text-[8px] font-mono font-bold tracking-widest text-zinc-600 pointer-events-none select-none z-10">
        {label}
      </span>
      <svg
        width="100%"
        height="100%"
        className="absolute inset-0 overflow-visible pointer-events-none"
      >
        {/* Reference line at the neutral value (unity volume / centered pan) */}
        <line
          x1="0"
          y1={defaultY}
          x2="100%"
          y2={defaultY}
          stroke="rgba(255,255,255,0.12)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
        {renderPoints.length > 0 && (
          <>
            {/* Flat extensions before the first and after the last breakpoint */}
            <line
              x1="0"
              y1={valueToY(renderPoints[0].value)}
              x2={renderPoints[0].time * PIXELS_PER_SECOND}
              y2={valueToY(renderPoints[0].value)}
              stroke={laneColor}
              strokeWidth="1.5"
              opacity="0.7"
            />
            <line
              x1={renderPoints[renderPoints.length - 1].time * PIXELS_PER_SECOND}
              y1={valueToY(renderPoints[renderPoints.length - 1].value)}
              x2="100%"
              y2={valueToY(renderPoints[renderPoints.length - 1].value)}
              stroke={laneColor}
              strokeWidth="1.5"
              opacity="0.7"
            />
            {renderPoints.length > 1 && (
              <polyline
                points={polylinePoints}
                fill="none"
                stroke={laneColor}
                strokeWidth="1.5"
              />
            )}
            {renderPoints.map((p, i) => (
              <circle
                key={i}
                cx={p.time * PIXELS_PER_SECOND}
                cy={valueToY(p.value)}
                r={drag && drag.index === i ? 5 : 4}
                fill={laneColor}
                stroke="rgba(255,255,255,0.85)"
                strokeWidth="1"
                className="pointer-events-auto cursor-grab active:cursor-grabbing"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  if (e.button !== 0) return;
                  setDrag({ index: i, time: p.time, value: p.value });
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  dispatch({
                    type: 'DELETE_AUTOMATION_POINT',
                    payload: { trackId: track.id, param, index: i },
                  });
                }}
              >
                <title>
                  {`${label.toLowerCase()} ${p.value.toFixed(2)} @ ${p.time.toFixed(2)}s — drag to move, double-click to delete`}
                </title>
              </circle>
            ))}
          </>
        )}
      </svg>
    </motion.div>
  );
}
