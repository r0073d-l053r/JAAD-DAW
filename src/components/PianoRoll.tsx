/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useDragControls } from "motion/react";
import { X, Magnet, Music2 } from "lucide-react";
import { useApp, Clip, Track } from "../lib/store";
import { audioEngine } from "../lib/audioEngine";

interface LocalNote {
  id: string;
  note: number; // MIDI number
  start: number; // beats
  duration: number; // beats
}

const NOTE_MAX = 96; // C7
const NOTE_MIN = 36; // C2
const ROWS = NOTE_MAX - NOTE_MIN + 1;
const ROW_HEIGHT = 16;
const KEY_WIDTH = 60;
const BEAT_WIDTH = 80;
const RULER_HEIGHT = 22;

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

const noteName = (n: number) => `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
const isBlackKey = (n: number) => BLACK_KEYS.has(n % 12);
const rowForNote = (n: number) => NOTE_MAX - n;

// Rows rendered top (C7) to bottom (C2)
const KEY_ROWS = Array.from({ length: ROWS }, (_, i) => NOTE_MAX - i);

const SNAP_OPTIONS = [
  { label: "1/4", beats: 1 },
  { label: "1/8", beats: 0.5 },
  { label: "1/16", beats: 0.25 },
];

let noteIdCounter = 0;
const nextNoteId = () => `prn_${++noteIdCounter}`;

interface DragState {
  mode: "move" | "resize";
  originX: number;
  originY: number;
  noteId: string;
  originals: Map<string, { note: number; start: number; duration: number }>;
  dBeats: number;
  dPitch: number;
  moved: boolean;
}

export const PianoRoll: React.FC = () => {
  const { state, dispatch } = useApp();
  const dragControls = useDragControls();
  const clipId = state.pianoRollClipId;

  // Locate the clip on a main track lane (UPDATE_CLIP commits to main clips)
  let targetClip: Clip | null = null;
  let targetTrack: Track | null = null;
  if (clipId) {
    for (const track of state.tracks) {
      const c = track.clips.find((cl) => cl.id === clipId);
      if (c) {
        targetClip = c;
        targetTrack = track;
        break;
      }
    }
  }
  const trackId = targetTrack ? targetTrack.id : null;

  const [notes, setNotes] = useState<LocalNote[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapBeats, setSnapBeats] = useState(0.25); // default 1/16
  const [drag, setDrag] = useState<DragState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrolledForClip = useRef<string | null>(null);

  const secondsPerBeat = 60 / Math.max(1, state.bpm);
  const clipBeats = targetClip ? targetClip.duration / secondsPerBeat : 1;
  const notesMaxBeat = notes.reduce((m, n) => Math.max(m, n.start + n.duration), 0);
  const totalBeats = Math.max(1, Math.ceil(Math.max(clipBeats, notesMaxBeat) - 1e-6));
  const gridWidth = totalBeats * BEAT_WIDTH;
  const gridHeight = ROWS * ROW_HEIGHT;

  // Initialize local working copy when the edited clip changes. Local state is
  // authoritative while the editor is open; each completed gesture commits a
  // single UPDATE_CLIP (one undo history entry per gesture).
  useEffect(() => {
    setNotes(
      (targetClip?.notes || []).map((n) => ({
        id: nextNoteId(),
        note: n.note,
        start: n.start,
        duration: n.duration,
      })),
    );
    setSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId]);

  // Center the viewport vertically around the existing notes (or middle C)
  useEffect(() => {
    if (!clipId || scrolledForClip.current === clipId) return;
    // Wait until the init effect has populated notes for clips that have them
    if (notes.length === 0 && (targetClip?.notes?.length || 0) > 0) return;
    const el = scrollRef.current;
    if (!el) return;
    const avg = notes.length ? notes.reduce((s, n) => s + n.note, 0) / notes.length : 60;
    el.scrollTop = Math.max(0, rowForNote(Math.round(avg)) * ROW_HEIGHT - el.clientHeight / 2);
    scrolledForClip.current = clipId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clipId, notes]);

  const snap = useCallback(
    (v: number) => (snapEnabled ? Math.round(v / snapBeats) * snapBeats : v),
    [snapEnabled, snapBeats],
  );

  const commitNotes = useCallback(
    (newNotes: LocalNote[]) => {
      if (!trackId || !clipId) return;
      dispatch({
        type: "UPDATE_CLIP",
        payload: {
          trackId,
          clipId,
          changes: {
            notes: newNotes.map(({ note, start, duration }) => ({ note, start, duration })),
          },
        },
      });
    },
    [dispatch, trackId, clipId],
  );

  // Notes with the in-progress gesture applied (preview only; committed on release)
  const displayNotes = useMemo(() => {
    if (!drag) return notes;
    return notes.map((n) => {
      const orig = drag.originals.get(n.id);
      if (!orig) return n;
      if (drag.mode === "move") {
        const start = Math.min(
          Math.max(0, snap(orig.start + drag.dBeats)),
          Math.max(0, totalBeats - orig.duration),
        );
        const pitch = Math.min(NOTE_MAX, Math.max(NOTE_MIN, orig.note + drag.dPitch));
        return { ...n, start, note: pitch };
      }
      const minDur = snapEnabled ? snapBeats : 0.125;
      const duration = Math.max(
        minDur,
        Math.min(snap(orig.duration + drag.dBeats), totalBeats - orig.start),
      );
      return { ...n, duration };
    });
  }, [notes, drag, snap, totalBeats, snapEnabled, snapBeats]);

  const previewNote = (noteNum: number) => {
    audioEngine.resume();
    audioEngine.playSynthNote(noteNum, 100);
  };

  const beginGesture = (e: React.PointerEvent, n: LocalNote, mode: "move" | "resize") => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);

    let sel = new Set(selected);
    if (mode === "move" && (e.ctrlKey || e.metaKey)) {
      // Ctrl-click toggles membership without starting a drag
      if (sel.has(n.id)) sel.delete(n.id);
      else sel.add(n.id);
      setSelected(sel);
      return;
    }
    if (!sel.has(n.id)) {
      sel = new Set([n.id]);
      setSelected(sel);
    }

    const affected = mode === "move" ? sel : new Set([n.id]);
    const originals = new Map<string, { note: number; start: number; duration: number }>();
    notes.forEach((note) => {
      if (affected.has(note.id)) {
        originals.set(note.id, { note: note.note, start: note.start, duration: note.duration });
      }
    });
    setDrag({
      mode,
      originX: e.clientX,
      originY: e.clientY,
      noteId: n.id,
      originals,
      dBeats: 0,
      dPitch: 0,
      moved: false,
    });
  };

  const onGestureMove = (e: React.PointerEvent) => {
    if (!drag) return;
    e.stopPropagation();
    const dBeats = (e.clientX - drag.originX) / BEAT_WIDTH;
    const dPitch = Math.round((drag.originY - e.clientY) / ROW_HEIGHT);
    const moved =
      drag.moved ||
      Math.abs(e.clientX - drag.originX) > 2 ||
      Math.abs(e.clientY - drag.originY) > 2;
    setDrag({ ...drag, dBeats, dPitch, moved });
  };

  const onGestureEnd = (e: React.PointerEvent) => {
    if (!drag) return;
    e.stopPropagation();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (err) {
      // Pointer capture already released
    }
    const finalNotes = displayNotes;
    const changed = drag.moved && notes.some((n, i) => n !== finalNotes[i]);
    setDrag(null);
    if (changed) {
      setNotes(finalNotes);
      commitNotes(finalNotes);
    }
  };

  const handleGridDoubleClick = (e: React.MouseEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const xBeats = (e.clientX - rect.left) / BEAT_WIDTH;
    const row = Math.floor((e.clientY - rect.top) / ROW_HEIGHT);
    const pitch = Math.min(NOTE_MAX, Math.max(NOTE_MIN, NOTE_MAX - row));
    const res = snapEnabled ? snapBeats : 0.25;
    const start = Math.max(0, Math.min(Math.floor(xBeats / res) * res, totalBeats - res));
    const duration = Math.min(1, totalBeats - start); // default 1 beat
    const newNote: LocalNote = { id: nextNoteId(), note: pitch, start, duration };
    const newNotes = [...notes, newNote];
    setNotes(newNotes);
    setSelected(new Set([newNote.id]));
    commitNotes(newNotes);
    previewNote(pitch);
  };

  const removeNote = (id: string) => {
    const newNotes = notes.filter((n) => n.id !== id);
    setNotes(newNotes);
    setSelected((prev) => {
      const s = new Set(prev);
      s.delete(id);
      return s;
    });
    commitNotes(newNotes);
  };

  const deleteSelected = useCallback(() => {
    if (selected.size === 0) return;
    const newNotes = notes.filter((n) => !selected.has(n.id));
    setNotes(newNotes);
    setSelected(new Set());
    commitNotes(newNotes);
  }, [notes, selected, commitNotes]);

  const close = useCallback(() => {
    dispatch({ type: "SET_PIANO_ROLL_CLIP", payload: null });
  }, [dispatch]);

  // Capture-phase listener so the global DAW shortcuts (Delete = delete clips,
  // Space = play, etc.) never fire for keys the piano roll handles.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        close();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.stopPropagation();
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [close, deleteSelected]);

  if (!clipId || !targetClip || !targetTrack) return null;

  const noteColor = targetTrack.color || "#10b981";
  const lineCount = Math.floor(totalBeats / snapBeats) + 1;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center pointer-events-none">
      <motion.div
        drag
        dragListener={false}
        dragControls={dragControls}
        dragMomentum={false}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-[920px] max-w-[95vw] h-[620px] max-h-[85vh] bg-[#0c0d10]/95 border border-white/10 rounded-2xl shadow-2xl flex flex-col pointer-events-auto select-none overflow-hidden"
        style={{
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 40px rgba(16, 185, 129, 0.12)",
        }}
      >
        {/* Drag header */}
        <div
          className="px-4 py-3 bg-zinc-900/50 border-b border-white/5 flex items-center justify-between cursor-grab active:cursor-grabbing flex-shrink-0"
          onPointerDown={(e) => dragControls.start(e)}
        >
          <div className="flex items-center space-x-2 min-w-0">
            <Music2 size={14} className="text-[#10b981] flex-shrink-0" />
            <span className="text-xs font-bold text-white uppercase tracking-wider truncate">
              Piano Roll — {targetClip.audioData || "MIDI Clip"}
            </span>
          </div>
          <button
            aria-label="Close piano roll"
            onClick={close}
            className="p-1 hover:bg-white/5 text-zinc-400 hover:text-white rounded-md transition-colors flex-shrink-0"
          >
            <X size={16} />
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-4 py-2 bg-zinc-900/30 border-b border-white/5 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center space-x-2">
            <button
              aria-label="Toggle snap to grid"
              aria-pressed={snapEnabled}
              onClick={() => setSnapEnabled((v) => !v)}
              className={`flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-semibold transition-all ${
                snapEnabled
                  ? "bg-primary/10 border-primary/40 text-primary"
                  : "bg-white/5 border-white/10 text-zinc-400 hover:bg-white/10"
              }`}
            >
              <Magnet size={12} />
              <span>SNAP</span>
            </button>
            <div className="flex items-center bg-white/5 border border-white/10 rounded-lg overflow-hidden">
              {SNAP_OPTIONS.map((opt) => (
                <button
                  key={opt.label}
                  aria-label={`Set snap resolution to ${opt.label} note`}
                  aria-pressed={snapBeats === opt.beats}
                  disabled={!snapEnabled}
                  onClick={() => setSnapBeats(opt.beats)}
                  className={`px-2.5 py-1.5 text-[10px] font-mono font-semibold transition-colors disabled:opacity-40 ${
                    snapBeats === opt.beats && snapEnabled
                      ? "bg-primary/20 text-primary"
                      : "text-zinc-400 hover:bg-white/10"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="text-[10px] text-zinc-500 font-mono">
            {notes.length} note{notes.length !== 1 ? "s" : ""} · {state.bpm} BPM ·{" "}
            {totalBeats} beats
          </div>
        </div>

        {/* Scrollable grid area */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-auto custom-scrollbar bg-black/40 relative"
        >
          <div
            className="relative"
            style={{ width: KEY_WIDTH + gridWidth, height: RULER_HEIGHT + gridHeight }}
          >
            {/* Ruler */}
            <div
              className="sticky top-0 z-30 flex"
              style={{ height: RULER_HEIGHT, width: KEY_WIDTH + gridWidth }}
            >
              <div
                className="sticky left-0 z-40 bg-zinc-900 border-b border-r border-white/10 flex-shrink-0"
                style={{ width: KEY_WIDTH, height: RULER_HEIGHT }}
              />
              <div
                className="relative bg-zinc-900/95 border-b border-white/10"
                style={{ width: gridWidth, height: RULER_HEIGHT }}
              >
                {Array.from({ length: totalBeats }, (_, b) => (
                  <div
                    key={b}
                    className={`absolute top-0 bottom-0 border-l ${
                      b % 4 === 0 ? "border-white/25" : "border-white/10"
                    }`}
                    style={{ left: b * BEAT_WIDTH }}
                  >
                    {b % 4 === 0 && (
                      <span className="absolute top-0.5 left-1 text-[9px] font-mono text-zinc-400">
                        {b / 4 + 1}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex">
              {/* Piano keys */}
              <div
                className="sticky left-0 z-20 flex-shrink-0 border-r border-white/10"
                style={{ width: KEY_WIDTH }}
              >
                {KEY_ROWS.map((noteNum) => {
                  const black = isBlackKey(noteNum);
                  const isC = noteNum % 12 === 0;
                  return (
                    <button
                      key={noteNum}
                      aria-label={`Preview note ${noteName(noteNum)}`}
                      onClick={() => previewNote(noteNum)}
                      className={`w-full flex items-center justify-end pr-1.5 transition-colors ${
                        black
                          ? "bg-zinc-900 hover:bg-zinc-800 border-b border-white/[0.04]"
                          : isC
                            ? "bg-primary/30 hover:bg-primary/40 border-b border-zinc-600"
                            : "bg-zinc-300 hover:bg-zinc-200 border-b border-zinc-400/60"
                      }`}
                      style={{ height: ROW_HEIGHT }}
                    >
                      {isC && (
                        <span className="text-[9px] font-mono font-bold text-white leading-none">
                          {noteName(noteNum)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Note grid */}
              <div
                className="relative"
                style={{ width: gridWidth, height: gridHeight }}
                onDoubleClick={handleGridDoubleClick}
                onPointerDown={(e) => {
                  if (e.button === 0) setSelected(new Set());
                }}
              >
                {/* Row striping */}
                <div className="absolute inset-0 pointer-events-none">
                  {KEY_ROWS.map((noteNum) => (
                    <div
                      key={noteNum}
                      className={`${isBlackKey(noteNum) ? "bg-white/[0.03]" : ""} ${
                        noteNum % 12 === 0
                          ? "border-b border-white/10"
                          : "border-b border-white/[0.03]"
                      }`}
                      style={{ height: ROW_HEIGHT }}
                    />
                  ))}
                </div>

                {/* Vertical grid lines at the current snap resolution */}
                <div className="absolute inset-0 pointer-events-none">
                  {Array.from({ length: lineCount }, (_, i) => {
                    const beat = i * snapBeats;
                    const isBar = Math.abs(beat % 4) < 1e-6;
                    const isBeat = Math.abs(beat % 1) < 1e-6;
                    return (
                      <div
                        key={i}
                        className={`absolute top-0 bottom-0 w-px ${
                          isBar ? "bg-white/20" : isBeat ? "bg-white/10" : "bg-white/[0.04]"
                        }`}
                        style={{ left: beat * BEAT_WIDTH }}
                      />
                    );
                  })}
                </div>

                {/* Notes */}
                {displayNotes.map((n) => {
                  const sel = selected.has(n.id);
                  const width = Math.max(6, n.duration * BEAT_WIDTH - 1);
                  return (
                    <div
                      key={n.id}
                      role="button"
                      aria-label={`MIDI note ${noteName(n.note)} at beat ${(Math.round(n.start * 100) / 100).toString()}`}
                      className={`absolute rounded-[3px] cursor-grab active:cursor-grabbing ${
                        sel ? "z-20" : "z-10"
                      }`}
                      style={{
                        left: n.start * BEAT_WIDTH,
                        top: rowForNote(n.note) * ROW_HEIGHT + 1,
                        width,
                        height: ROW_HEIGHT - 2,
                        backgroundColor: noteColor,
                        boxShadow: sel
                          ? "inset 0 0 0 1.5px rgba(255,255,255,0.95), 0 2px 8px rgba(0,0,0,0.6)"
                          : "inset 0 0 0 1px rgba(0,0,0,0.35), 0 1px 4px rgba(0,0,0,0.4)",
                        opacity: sel ? 1 : 0.88,
                      }}
                      onPointerDown={(e) => {
                        if (e.button === 0) beginGesture(e, n, "move");
                      }}
                      onPointerMove={onGestureMove}
                      onPointerUp={onGestureEnd}
                      onPointerCancel={onGestureEnd}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        removeNote(n.id);
                      }}
                      onDoubleClick={(e) => e.stopPropagation()}
                    >
                      {width > 30 && (
                        <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[8px] font-mono font-bold text-black/70 pointer-events-none leading-none">
                          {noteName(n.note)}
                        </span>
                      )}
                      {/* Right-edge resize handle */}
                      <div
                        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize hover:bg-white/40 rounded-r-[3px]"
                        onPointerDown={(e) => {
                          if (e.button === 0) beginGesture(e, n, "resize");
                        }}
                        onPointerMove={onGestureMove}
                        onPointerUp={onGestureEnd}
                        onPointerCancel={onGestureEnd}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Footer hint bar */}
        <div className="px-4 py-2 bg-zinc-950 flex items-center justify-center space-x-1.5 text-[9px] text-zinc-500 font-semibold flex-shrink-0 tracking-wide">
          <span>
            DOUBLE-CLICK: ADD · DRAG: MOVE · RIGHT EDGE: RESIZE · RIGHT-CLICK: DELETE · CTRL-CLICK:
            MULTI-SELECT · DEL: REMOVE · ESC: CLOSE
          </span>
        </div>
      </motion.div>
    </div>
  );
};
