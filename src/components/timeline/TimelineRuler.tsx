import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useApp } from '../../lib/store';
import type { Marker } from '../../lib/store';
import { Playhead } from './Playhead';

export interface TimelineRulerProps {
  timelineRef: React.RefObject<HTMLDivElement | null>;
  startDraggingPlayhead: (e: React.MouseEvent | React.TouchEvent) => void;
  onEditMarker: (marker: Marker) => void;
}

export function TimelineRuler({ timelineRef, startDraggingPlayhead, onEditMarker }: TimelineRulerProps) {
  const { state, dispatch } = useApp();
  const PIXELS_PER_SECOND = state.zoomLevel;
  const [draggingMarkerId, setDraggingMarkerId] = useState<string | null>(null);

  useEffect(() => {
    if (!draggingMarkerId) return;

    const handleMouseMove = (e: MouseEvent) => {
      const timeline = timelineRef.current;
      if (!timeline) return;

      const rect = timeline.getBoundingClientRect();
      const clickX = e.clientX - rect.left + timeline.scrollLeft;
      let newTime = clickX / PIXELS_PER_SECOND;

      if (state.snapToGrid) {
        const beatDuration = 60 / state.bpm;
        newTime = Math.round(newTime / beatDuration) * beatDuration;
      }

      dispatch({
        type: 'UPDATE_MARKER',
        payload: { id: draggingMarkerId, changes: { time: Math.max(0, newTime) } }
      });
    };

    const handleMouseUp = () => {
      setDraggingMarkerId(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingMarkerId, PIXELS_PER_SECOND, state.bpm, state.snapToGrid, dispatch]);

  return (
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

      {/* Interactive Marker Flags */}
      {state.markers?.map((marker) => {
        const x = marker.time * PIXELS_PER_SECOND;
        return (
          <div
            key={marker.id}
            className="absolute top-0 bottom-0 z-[80] group/marker cursor-ew-resize select-none"
            style={{ left: `${x}px`, width: '14px', transform: 'translateX(-50%)' }}
            onMouseDown={(e) => {
              e.stopPropagation();
              if (e.button === 0) {
                setDraggingMarkerId(marker.id);
              }
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onEditMarker(marker);
            }}
          >
            {/* Visual marker flag */}
            <div
              className="w-3.5 h-3.5 absolute top-1 rounded-sm shadow-md transition-all group-hover/marker:scale-110 active:scale-95 cursor-ew-resize"
              style={{
                backgroundColor: marker.color,
                clipPath: 'polygon(0 0, 100% 0, 100% 70%, 50% 100%, 0 70%)'
              }}
              title="Drag to reposition, Double click to edit"
            />
            {/* Visual marker label */}
            <span className="absolute left-4 top-1 text-[9px] font-bold text-white whitespace-nowrap bg-zinc-950/85 px-1 py-0.5 rounded border border-white/10 backdrop-blur-xs select-none pointer-events-none opacity-80 group-hover/marker:opacity-100 transition-opacity">
              {marker.label}
            </span>
          </div>
        );
      })}

      <Playhead PIXELS_PER_SECOND={PIXELS_PER_SECOND} startDraggingPlayhead={startDraggingPlayhead} mode="handle" />
    </div>
  );
}

/** Dashed vertical guideline rendered under each marker across the track area. */
export function MarkerGuidelines() {
  const { state } = useApp();
  const PIXELS_PER_SECOND = state.zoomLevel;

  return (
    <>
      {state.markers?.map((marker) => {
        const x = marker.time * PIXELS_PER_SECOND;
        return (
          <div
            key={`line-${marker.id}`}
            className="absolute top-0 bottom-0 pointer-events-none z-[40]"
            style={{
              left: `${x}px`,
              width: '1px',
              borderLeft: `1px dashed ${marker.color}`,
              opacity: 0.25
            }}
          />
        );
      })}
    </>
  );
}

/** Master tempo lane visualizing the tempo automation points. */
export function TempoAutomationLane() {
  const { state } = useApp();
  const PIXELS_PER_SECOND = state.zoomLevel;

  return (
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
  );
}

export interface MarkerEditModalProps {
  marker: Marker | null;
  onChange: (marker: Marker) => void;
  onClose: () => void;
}

export function MarkerEditModal({ marker, onChange, onClose }: MarkerEditModalProps) {
  const { dispatch } = useApp();

  return (
    <AnimatePresence>
      {marker && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.95, y: 10 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 10 }}
            className="w-80 p-6 rounded-2xl bg-zinc-950/85 border border-white/10 shadow-2xl backdrop-blur-xl relative overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Decorative Liquid Glass light skew */}
            <div className="absolute inset-0 bg-gradient-to-tr from-white/[0.02] to-transparent pointer-events-none" />

            <h3 className="text-sm font-bold text-white tracking-wider mb-4 uppercase">Edit Cue Marker</h3>

            <div className="space-y-4 relative z-10">
              <div>
                <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest block mb-1">Label</label>
                <input
                  type="text"
                  value={marker.label}
                  onChange={(e) => onChange({ ...marker, label: e.target.value })}
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-primary transition"
                  placeholder="e.g., Chorus, Drop"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-[10px] font-semibold text-zinc-400 uppercase tracking-widest block mb-1.5">Color</label>
                <div className="flex gap-2.5">
                  {['#3b82f6', '#10b981', '#8b5cf6', '#ef4444', '#f59e0b', '#ec4899'].map((c) => (
                    <button
                      key={c}
                      onClick={() => onChange({ ...marker, color: c })}
                      className={`w-6 h-6 rounded-full border-2 transition-all hover:scale-110 ${marker.color === c ? 'border-white scale-110 shadow-[0_0_8px_rgba(255,255,255,0.5)]' : 'border-transparent'}`}
                      style={{ backgroundColor: c }}
                    />
                  ))}
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={() => {
                    dispatch({ type: 'REMOVE_MARKER', payload: marker.id });
                    onClose();
                  }}
                  className="flex-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs font-semibold py-2 px-4 rounded-lg transition-colors duration-200"
                >
                  Delete
                </button>
                <button
                  onClick={() => {
                    dispatch({ type: 'UPDATE_MARKER', payload: { id: marker.id, changes: { label: marker.label, color: marker.color } } });
                    onClose();
                  }}
                  className="flex-1 bg-primary hover:bg-primary-hover text-white text-xs font-semibold py-2 px-4 rounded-lg shadow-lg hover:shadow-primary/30 transition-all duration-200"
                >
                  Save
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
