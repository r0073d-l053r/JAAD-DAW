import React, { createContext, useContext, useReducer, ReactNode } from "react";
import { audioEngine } from "./audioEngine";
import {
  findNearestZeroCrossing,
  reverseAudioBuffer,
  invertAudioBuffer,
  normalizeAudioBuffer,
  silenceAudioBufferRange,
} from "./audioUtils";
import {
  GlassEffectSettings,
  GlassThemeContext,
  DEFAULT_GLASS_SETTINGS,
} from "../components/LiquidGlass";
import {
  AutomationParam,
  TrackAutomation,
  clampAutomationValue,
  sortAutomationPoints,
} from "./automationUtils";

export type ThemeMode = "liquid-glass" | "performance";

export interface ThemeState {
  themeMode: ThemeMode;
  accentColor: string;
  glassSettings: GlassEffectSettings;
}

export const DEFAULT_ACCENT_COLOR = "#af52de"; // matches --color-primary in index.css

const THEME_STORAGE_KEY = "jaad_theme_v2";

function defaultThemeState(): ThemeState {
  return {
    themeMode: "liquid-glass",
    accentColor: DEFAULT_ACCENT_COLOR,
    glassSettings: { ...DEFAULT_GLASS_SETTINGS },
  };
}

/**
 * First run only (nothing persisted yet): default to the matte Performance
 * theme when the user prefers reduced motion or the machine looks weak —
 * heavy backdrop-filters and the animated background are the wrong default
 * there. The user can switch to Liquid Glass in Settings at any time.
 */
function firstRunThemeState(): ThemeState {
  const base = defaultThemeState();
  try {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
    const weakHardware = (navigator.hardwareConcurrency ?? 8) <= 4;
    if (reducedMotion || weakHardware) {
      return { ...base, themeMode: "performance" };
    }
  } catch {
    // matchMedia/navigator unavailable (tests, SSR) — keep the default.
  }
  return base;
}

/** Load persisted theme settings; tolerate missing/corrupt entries. */
function loadStoredTheme(): ThemeState {
  const fallback = defaultThemeState();
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return firstRunThemeState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return fallback;
    return {
      themeMode: parsed.themeMode === "performance" ? "performance" : "liquid-glass",
      accentColor:
        typeof parsed.accentColor === "string" && parsed.accentColor
          ? parsed.accentColor
          : fallback.accentColor,
      glassSettings: {
        ...DEFAULT_GLASS_SETTINGS,
        ...(parsed.glassSettings && typeof parsed.glassSettings === "object"
          ? parsed.glassSettings
          : {}),
      },
    };
  } catch {
    return fallback;
  }
}

export interface Lane {
  id: string;
  name: string;
  clips: Clip[];
}

export interface Track {
  id: string;
  name: string;
  volume: number;
  pan: number;
  muted: boolean;
  solo: boolean;
  armed?: boolean;
  color: string;
  clips: Clip[];
  lanes: Lane[];
  showLanes: boolean;
  /** Per-track automation curves (sorted by time). Serializable; synced via syncUtils. */
  automation?: TrackAutomation;
  /** UI-only flag: automation lanes expanded under the track (like showLanes). */
  showAutomation?: boolean;
  isFrozen?: boolean;
  frozenBufferId?: string;
  deHummerEnabled?: boolean;
}

export interface Clip {
  id: string;
  bufferId?: string;
  start: number; // in seconds
  duration: number; // in seconds
  audioOffset?: number; // seconds into the audio buffer
  audioData?: any; // placeholder for real audio
  volumeEnvelope?: { time: number; value: number }[]; // time relative to clip start
  fadeIn?: number; // fade-in length in seconds from the clip start (0/absent = no fade)
  fadeOut?: number; // fade-out length in seconds before the clip end (0/absent = no fade)
  groupId?: string; // ID linking this clip to others in a group
  notes?: { note: number; start: number; duration: number }[]; // MIDI notes
}

export interface TimeSelection {
  startTime: number; // in seconds
  endTime: number; // in seconds
  trackIds: string[];
}

export interface Marker {
  id: string;
  time: number;
  label: string;
  color: string;
}

interface AppState {
  tracks: Track[];
  markers: Marker[];
  isPlaying: boolean;
  currentTime: number;
  bpm: number; // static fallback/initial tempo
  originalBpm: number; // the detected/native tempo of imported audio
  tempoAutomation: { time: number; bpm: number }[];
  metronomeEnabled: boolean;
  isRecording: boolean;
  isOffline: boolean;
  aiPanelOpen: boolean;
  viewMode: "timeline" | "mixer";
  zoomLevel: number;
  settingsOpen: boolean;
  selectedClipIds: string[];
  timeSelection: TimeSelection | null;
  clipboard: Clip[];
  snapToGrid: boolean;
  looping: boolean;
  loopStart: number;
  loopEnd: number;
  playStartPosition: number;
  masterVolume: number;
  disableBackgroundAnimation: boolean;
  isProcessing: boolean;
  isDetectingBPM: boolean;
  showBPMSyncPopup: boolean;
  bpmSyncCancelRequested: boolean;
  projectId: string;
  projectName: string;
  isSyncing: boolean;
  isProjectBrowserOpen: boolean;
  buffersVersion: number;
  hasManuallySaved: boolean;
  isDefaultName: boolean;
  spectrogramEnabled: boolean;
  videoUrl: string | null;
  videoPanelOpen: boolean;
  videoOffset: number;
  videoVolume: number;
  videoMuted: boolean;
  vstEditorTrackId: string | null;
  sidechainEditorTrackId: string | null;
  authenticityProcessorClipId: string | null;
  stemSeparatorClipId: string | null;
  pianoRollClipId: string | null;
  showLiveAnalyzers: boolean;
  theme: ThemeState;
  /** Track selected via its header; targeted by the Track menu's Delete/Duplicate. */
  activeTrackId: string | null;
  activeContextMenu: {
    type: "clip" | "selection";
    clipId?: string;
    trackId?: string;
    x: number;
    y: number;
  } | null;
}

export type Action =
  | { type: "TOGGLE_PLAY" }
  | { type: "TOGGLE_RECORD" }
  | { type: "TOGGLE_METRONOME" }
  | { type: "SET_VST_EDITOR_TRACK"; payload: string | null }
  | { type: "SET_SIDECHAIN_EDITOR_TRACK"; payload: string | null }
  | { type: "SET_AUTHENTICITY_PROCESSOR_CLIP"; payload: string | null }
  | { type: "SET_BPM"; payload: number }
  | { type: "SET_ORIGINAL_BPM"; payload: number }
  | { type: "SET_TIME"; payload: number }
  | { type: "SET_MASTER_VOLUME"; payload: number }
  | { type: "SET_TEMPO_AUTOMATION"; payload: { time: number; bpm: number }[] }
  | { type: "ADD_TRACK"; payload: Track }
  | { type: "UPDATE_TRACK"; payload: { id: string; changes: Partial<Track> } }
  | { type: "FREEZE_TRACK"; payload: { trackId: string; bufferId: string } }
  | { type: "UNFREEZE_TRACK"; payload: string }
  | { type: "TOGGLE_AI_PANEL" }
  | { type: "TOGGLE_BACKGROUND_ANIMATION" }
  | { type: "SET_OFFLINE"; payload: boolean }
  | { type: "SET_VIEW_MODE"; payload: "timeline" | "mixer" }
  | { type: "TOGGLE_MIXER" }
  | { type: "SET_ZOOM"; payload: number }
  | { type: "TOGGLE_SETTINGS" }
  | { type: "ADD_CLIP"; payload: { trackId: string; clip: Clip } }
  | { type: "REORDER_TRACKS"; payload: { sourceId: string; targetId: string } }
  | {
      type: "MOVE_AND_OVERWRITE_CLIP";
      payload: {
        sourceTrackId: string;
        sourceLaneId?: string;
        clipId: string;
        targetTrackId: string;
        newStart: number;
      };
    }
  | {
      type: "UPDATE_CLIP";
      payload: { trackId: string; clipId: string; changes: Partial<Clip> };
    }
  | { type: "SELECT_CLIP"; payload: { clipId: string; multi: boolean } }
  | { type: "SELECT_MULTIPLE_CLIPS"; payload: string[] }
  | { type: "SET_TIME_SELECTION"; payload: TimeSelection | null }
  | { type: "GROUP_CLIPS" }
  | { type: "UNGROUP_CLIPS" }
  | { type: "MOVE_SELECTED_CLIPS"; payload: { timeDelta: number } }
  | { type: "COPY_CLIPS" }
  | { type: "PASTE_CLIPS"; payload: { trackId: string; time: number } }
  | { type: "DUPLICATE_CLIPS" }
  | { type: "DELETE_CLIPS" }
  | { type: "TOGGLE_SNAP" }
  | { type: "TOGGLE_LOOP" }
  | { type: "SET_LOOP_MARKERS"; payload: { start: number; end: number } }
  | { type: "SPLIT_CLIP" }
  | {
      type: "REVERT_CLIP_TO_ORIGINAL";
      payload: { trackId: string; laneId?: string; clipId: string };
    }
  | { type: "REVERT_TRACK_TO_ORIGINAL"; payload: { trackId: string } }
  | { type: "UNDO" }
  | { type: "CLEAN_UP_STEMS" }
  | { type: "REDO" }
  | { type: "RESET_PROJECT" }
  | { type: "LOAD_PROJECT"; payload: AppStateWithHistory }
  | {
      type: "FINALIZE_CLIP_OVERLAPS";
      payload: { trackId: string; laneId?: string; clipId: string };
    }
  | { type: "SELECT_ALL_CLIPS" }
  | { type: "CUT_CLIPS" }
  | { type: "RESTORE_SELECTION" }
  | { type: "DELETE_TRACK"; payload: string }
  | { type: "DUPLICATE_TRACK"; payload: string }
  | { type: "SET_ACTIVE_TRACK"; payload: string | null }
  | { type: "TOGGLE_ALL_AUTOMATION_LANES" }
  | { type: "ADD_LANE"; payload: { trackId: string } }
  | { type: "DELETE_LANE"; payload: { trackId: string; laneId: string } }
  | { type: "DELETE_LANES"; payload: { trackId: string; laneIds: string[] } }
  | { type: "TOGGLE_LANES"; payload: string }
  | { type: "PROMOTE_LANE"; payload: { trackId: string; laneId: string } }
  | { type: "PASTE_CLIP_TO_LANE"; payload: { trackId: string; laneId: string } }
  | {
      type: "MOVE_CLIP_TO_LANE";
      payload: {
        sourceTrackId: string;
        sourceLaneId?: string;
        clipId: string;
        targetTrackId: string;
        targetLaneId: string;
        newStart: number;
      };
    }
  | { type: "SET_IS_PROCESSING"; payload: boolean }
  | { type: "SET_IS_DETECTING_BPM"; payload: boolean }
  | { type: "SET_SHOW_BPM_SYNC_POPUP"; payload: boolean }
  | { type: "REQUEST_BPM_SYNC_CANCEL" }
  | { type: "REPLACE_TRACKS"; payload: Track[] }
  | { type: "SET_PROJECT_ID"; payload: string }
  | { type: "SET_PROJECT_NAME"; payload: string }
  | { type: "SET_SYNCING"; payload: boolean }
  | { type: "TOGGLE_PROJECT_BROWSER" }
  | { type: "SYNC_STATE"; payload: Partial<AppState> }
  | { type: "INCREMENT_BUFFERS_VERSION" }
  | { type: "SET_HAS_MANUALLY_SAVED"; payload: boolean }
  | {
      type: "ADD_CLIP_TO_NEW_LANE";
      payload: { trackId: string; clipId: string };
    }
  | { type: "TOGGLE_SPECTROGRAM" }
  | { type: "TOGGLE_VIDEO_PANEL" }
  | { type: "SET_VIDEO_URL"; payload: string | null }
  | { type: "SET_VIDEO_OFFSET"; payload: number }
  | { type: "SET_VIDEO_VOLUME"; payload: number }
  | { type: "SET_VIDEO_MUTED"; payload: boolean }
  | { type: "TOGGLE_LIVE_ANALYZERS" }
  | { type: "SET_STEM_SEPARATOR_CLIP"; payload: string | null }
  | { type: "SET_PIANO_ROLL_CLIP"; payload: string | null }
  | {
      type: "ADD_GENERATED_ALTERNATIVES";
      payload: {
        trackId: string;
        clipId1: string;
        clipId2: string;
        filename1: string;
        filename2: string;
        start: number;
        duration: number;
      };
    }
  | { type: "SET_ACTIVE_CONTEXT_MENU"; payload: AppState["activeContextMenu"] }
  | {
      type: "ADD_MARKER";
      payload: { time: number; label?: string; color?: string };
    }
  | { type: "REMOVE_MARKER"; payload: string }
  | { type: "UPDATE_MARKER"; payload: { id: string; changes: Partial<Marker> } }
  | { type: "GO_TO_NEXT_MARKER" }
  | { type: "GO_TO_PREV_MARKER" }
  | {
      type: "REVERSE_CLIP";
      payload: { trackId: string; laneId?: string; clipId: string };
    }
  | {
      type: "INVERT_CLIP";
      payload: { trackId: string; laneId?: string; clipId: string };
    }
  | {
      type: "NORMALIZE_CLIP";
      payload: { trackId: string; laneId?: string; clipId: string };
    }
  | {
      type: "SILENCE_CLIP_SELECTION";
      payload: {
        trackId: string;
        laneId?: string;
        clipId: string;
        start: number;
        duration: number;
      };
    }
  | { type: "TOGGLE_DEHUMMER"; payload: { trackId: string } }
  | { type: "TOGGLE_AUTOMATION_LANES"; payload: string }
  | {
      type: "ADD_AUTOMATION_POINT";
      payload: {
        trackId: string;
        param: AutomationParam;
        time: number;
        value: number;
      };
    }
  | {
      type: "MOVE_AUTOMATION_POINT";
      payload: {
        trackId: string;
        param: AutomationParam;
        index: number;
        time: number;
        value: number;
      };
    }
  | {
      type: "DELETE_AUTOMATION_POINT";
      payload: { trackId: string; param: AutomationParam; index: number };
    }
  | { type: "SET_THEME_MODE"; payload: ThemeMode }
  | { type: "SET_ACCENT_COLOR"; payload: string }
  | { type: "UPDATE_GLASS_SETTINGS"; payload: Partial<GlassEffectSettings> };

export interface AppStateWithHistory extends AppState {
  past: Track[][];
  future: Track[][];
}

const initialTracks: Track[] = [];

export const initialState: AppStateWithHistory = {
  tracks: initialTracks,
  markers: [],
  past: [],
  future: [],
  isPlaying: false,
  isRecording: false,
  currentTime: 0,
  bpm: 120,
  originalBpm: 120,
  tempoAutomation: [{ time: 0, bpm: 120 }],
  metronomeEnabled: false,
  isOffline: !navigator.onLine,
  aiPanelOpen: false,
  viewMode: "timeline",
  zoomLevel: 20, // Pixels per second
  settingsOpen: false,
  selectedClipIds: [],
  timeSelection: null,
  clipboard: [],
  snapToGrid: true,
  looping: false,
  loopStart: 0,
  loopEnd: 16, // 4 bars at 120bpm approx
  playStartPosition: 0,
  masterVolume: 0.8,
  disableBackgroundAnimation: false,
  isProcessing: false,
  isDetectingBPM: false,
  showBPMSyncPopup: false,
  bpmSyncCancelRequested: false,
  projectId: "",
  projectName: "Untitled Project",
  isSyncing: false,
  isProjectBrowserOpen: false,
  buffersVersion: 0,
  hasManuallySaved: false,
  isDefaultName: true,
  spectrogramEnabled: false,
  videoUrl: null,
  videoPanelOpen: false,
  videoOffset: 0,
  videoVolume: 0.8,
  videoMuted: false,
  vstEditorTrackId: null,
  sidechainEditorTrackId: null,
  authenticityProcessorClipId: null,
  stemSeparatorClipId: null,
  pianoRollClipId: null,
  showLiveAnalyzers: false,
  theme: loadStoredTheme(),
  activeTrackId: null,
  activeContextMenu: null,
};

// Each history entry is a full Track[] snapshot, so an unbounded stack grows
// without limit during long sessions. Oldest entries are dropped past this cap.
export const MAX_HISTORY_ENTRIES = 50;

function saveHistory(
  state: AppStateWithHistory,
  newTracks: Track[],
): AppStateWithHistory {
  const past = [...state.past, state.tracks];
  if (past.length > MAX_HISTORY_ENTRIES) {
    past.splice(0, past.length - MAX_HISTORY_ENTRIES);
  }
  return {
    ...state,
    past,
    future: [],
    tracks: newTracks,
  };
}

export function appReducer(
  state: AppStateWithHistory,
  action: Action,
): AppStateWithHistory {
  switch (action.type) {
    case "REVERSE_CLIP": {
      const { trackId, laneId, clipId } = action.payload;
      const newTracks = state.tracks.map((t) => {
        if (t.id !== trackId) return t;

        const mapClips = (clips: Clip[]) =>
          clips.map((clip) => {
            if (clip.id !== clipId) return clip;
            const origBufferId = clip.bufferId || clip.id;
            const buffer = audioEngine.buffers.get(origBufferId);
            if (!buffer) return clip;

            const newBuffer = reverseAudioBuffer(buffer);
            const newBufferId = `${clip.id}_rev_${Math.random().toString(36).substr(2, 5)}`;
            audioEngine.buffers.set(newBufferId, newBuffer);

            return { ...clip, bufferId: newBufferId };
          });

        if (laneId && t.lanes) {
          return {
            ...t,
            lanes: t.lanes.map((l) =>
              l.id === laneId ? { ...l, clips: mapClips(l.clips) } : l,
            ),
          };
        }
        return { ...t, clips: mapClips(t.clips) };
      });
      return {
        ...saveHistory(state, newTracks),
        buffersVersion: state.buffersVersion + 1,
      };
    }
    case "INVERT_CLIP": {
      const { trackId, laneId, clipId } = action.payload;
      const newTracks = state.tracks.map((t) => {
        if (t.id !== trackId) return t;

        const mapClips = (clips: Clip[]) =>
          clips.map((clip) => {
            if (clip.id !== clipId) return clip;
            const origBufferId = clip.bufferId || clip.id;
            const buffer = audioEngine.buffers.get(origBufferId);
            if (!buffer) return clip;

            const newBuffer = invertAudioBuffer(buffer);
            const newBufferId = `${clip.id}_inv_${Math.random().toString(36).substr(2, 5)}`;
            audioEngine.buffers.set(newBufferId, newBuffer);

            return { ...clip, bufferId: newBufferId };
          });

        if (laneId && t.lanes) {
          return {
            ...t,
            lanes: t.lanes.map((l) =>
              l.id === laneId ? { ...l, clips: mapClips(l.clips) } : l,
            ),
          };
        }
        return { ...t, clips: mapClips(t.clips) };
      });
      return {
        ...saveHistory(state, newTracks),
        buffersVersion: state.buffersVersion + 1,
      };
    }
    case "NORMALIZE_CLIP": {
      const { trackId, laneId, clipId } = action.payload;
      const newTracks = state.tracks.map((t) => {
        if (t.id !== trackId) return t;

        const mapClips = (clips: Clip[]) =>
          clips.map((clip) => {
            if (clip.id !== clipId) return clip;
            const origBufferId = clip.bufferId || clip.id;
            const buffer = audioEngine.buffers.get(origBufferId);
            if (!buffer) return clip;

            const newBuffer = normalizeAudioBuffer(buffer);
            const newBufferId = `${clip.id}_norm_${Math.random().toString(36).substr(2, 5)}`;
            audioEngine.buffers.set(newBufferId, newBuffer);

            return { ...clip, bufferId: newBufferId };
          });

        if (laneId && t.lanes) {
          return {
            ...t,
            lanes: t.lanes.map((l) =>
              l.id === laneId ? { ...l, clips: mapClips(l.clips) } : l,
            ),
          };
        }
        return { ...t, clips: mapClips(t.clips) };
      });
      return {
        ...saveHistory(state, newTracks),
        buffersVersion: state.buffersVersion + 1,
      };
    }
    case "SILENCE_CLIP_SELECTION": {
      const { trackId, laneId, clipId, start, duration } = action.payload;
      const newTracks = state.tracks.map((t) => {
        if (t.id !== trackId) return t;

        const mapClips = (clips: Clip[]) =>
          clips.map((clip) => {
            if (clip.id !== clipId) return clip;
            const origBufferId = clip.bufferId || clip.id;
            const buffer = audioEngine.buffers.get(origBufferId);
            if (!buffer) return clip;

            // Calculate offset relative to the raw audio buffer start
            const offsetStart = start - clip.start + (clip.audioOffset || 0);
            const newBuffer = silenceAudioBufferRange(
              buffer,
              offsetStart,
              duration,
            );
            const newBufferId = `${clip.id}_silence_${Math.random().toString(36).substr(2, 5)}`;
            audioEngine.buffers.set(newBufferId, newBuffer);

            return { ...clip, bufferId: newBufferId };
          });

        if (laneId && t.lanes) {
          return {
            ...t,
            lanes: t.lanes.map((l) =>
              l.id === laneId ? { ...l, clips: mapClips(l.clips) } : l,
            ),
          };
        }
        return { ...t, clips: mapClips(t.clips) };
      });
      return {
        ...saveHistory(state, newTracks),
        buffersVersion: state.buffersVersion + 1,
      };
    }
    case "TOGGLE_DEHUMMER": {
      const { trackId } = action.payload;
      const newTracks = state.tracks.map((t) => {
        if (t.id !== trackId) return t;
        return { ...t, deHummerEnabled: !t.deHummerEnabled };
      });
      return saveHistory(state, newTracks);
    }
    case "TOGGLE_AUTOMATION_LANES": {
      const newTracks = state.tracks.map((t) =>
        t.id === action.payload ? { ...t, showAutomation: !t.showAutomation } : t,
      );
      return { ...state, tracks: newTracks }; // UI toggle — no history (mirrors TOGGLE_LANES)
    }
    case "TOGGLE_ALL_AUTOMATION_LANES": {
      // Global View-menu toggle: if any track shows automation, hide all; else show all.
      const anyShown = state.tracks.some((t) => t.showAutomation);
      const newTracks = state.tracks.map((t) => ({ ...t, showAutomation: !anyShown }));
      return { ...state, tracks: newTracks }; // UI toggle — no history
    }
    case "SET_ACTIVE_TRACK": {
      return { ...state, activeTrackId: action.payload };
    }
    case "ADD_AUTOMATION_POINT": {
      const { trackId, param, time, value } = action.payload;
      if (!state.tracks.some((t) => t.id === trackId)) return state;
      const newTracks = state.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const automation: TrackAutomation = {
          volume: [...(t.automation?.volume ?? [])],
          pan: [...(t.automation?.pan ?? [])],
        };
        automation[param] = sortAutomationPoints([
          ...automation[param],
          {
            time: Math.max(0, time),
            value: clampAutomationValue(param, value),
          },
        ]);
        return { ...t, automation };
      });
      return saveHistory(state, newTracks);
    }
    case "MOVE_AUTOMATION_POINT": {
      const { trackId, param, index, time, value } = action.payload;
      let changed = false;
      const newTracks = state.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const points = t.automation?.[param] ?? [];
        if (index < 0 || index >= points.length) return t;
        changed = true;
        const updated = points.map((p, i) =>
          i === index
            ? {
                time: Math.max(0, time),
                value: clampAutomationValue(param, value),
              }
            : p,
        );
        return {
          ...t,
          automation: {
            volume: t.automation?.volume ?? [],
            pan: t.automation?.pan ?? [],
            [param]: sortAutomationPoints(updated),
          },
        };
      });
      if (!changed) return state;
      return saveHistory(state, newTracks);
    }
    case "DELETE_AUTOMATION_POINT": {
      const { trackId, param, index } = action.payload;
      let changed = false;
      const newTracks = state.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const points = t.automation?.[param] ?? [];
        if (index < 0 || index >= points.length) return t;
        changed = true;
        return {
          ...t,
          automation: {
            volume: t.automation?.volume ?? [],
            pan: t.automation?.pan ?? [],
            [param]: points.filter((_, i) => i !== index),
          },
        };
      });
      if (!changed) return state;
      return saveHistory(state, newTracks);
    }
    case "TOGGLE_PLAY":
      if (!state.isPlaying) {
        // Starting playback
        return {
          ...state,
          isPlaying: true,
          playStartPosition: state.currentTime,
        };
      } else {
        // Stopping playback - reset to start position
        return {
          ...state,
          isPlaying: false,
          currentTime: state.playStartPosition,
        };
      }
    case "TOGGLE_RECORD":
      return { ...state, isRecording: !state.isRecording };
    case "TOGGLE_METRONOME":
      return { ...state, metronomeEnabled: !state.metronomeEnabled };
    case "SET_TEMPO_AUTOMATION":
      return { ...state, tempoAutomation: action.payload };
    case "SET_TIME": {
      // Ensure we don't accidentally update time during transit states
      return {
        ...state,
        currentTime: action.payload,
        playStartPosition: action.payload,
      };
    }
    case "SET_MASTER_VOLUME": {
      audioEngine.setMasterVolume(action.payload);
      return { ...state, masterVolume: action.payload };
    }
    case "ADD_TRACK": {
      const trackWithLanes = {
        ...action.payload,
        lanes: action.payload.lanes || [],
        showLanes: action.payload.showLanes ?? false,
      };
      return {
        ...saveHistory(state, [...state.tracks, trackWithLanes]),
        activeTrackId: trackWithLanes.id,
      };
    }
    case "UPDATE_TRACK": {
      const { id, changes } = action.payload;
      return {
        ...state,
        tracks: state.tracks.map((t) => {
          if (t.id === id) {
            const updatedTrack = { ...t, ...changes };
            // If the name changed, propagate it to all clips (stems) on this track
            if (changes.name) {
              updatedTrack.clips = t.clips.map((c) => ({
                ...c,
                audioData: changes.name,
              }));
              if (updatedTrack.lanes) {
                updatedTrack.lanes = updatedTrack.lanes.map((l) => ({
                  ...l,
                  clips: l.clips.map((c) => ({
                    ...c,
                    audioData: changes.name,
                  })),
                }));
              }
            }
            return updatedTrack;
          }
          return t;
        }),
      };
    }
    case "FREEZE_TRACK":
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.payload.trackId
            ? { ...t, isFrozen: true, frozenBufferId: action.payload.bufferId }
            : t,
        ),
      };
    case "UNFREEZE_TRACK":
      return {
        ...state,
        tracks: state.tracks.map((t) =>
          t.id === action.payload
            ? { ...t, isFrozen: false, frozenBufferId: undefined }
            : t,
        ),
      };
    case "REORDER_TRACKS": {
      const { sourceId, targetId } = action.payload;
      if (sourceId === targetId) return state;
      const sourceIndex = state.tracks.findIndex((t) => t.id === sourceId);
      if (sourceIndex === -1) return state;

      const newTracks = [...state.tracks];
      const [movedTrack] = newTracks.splice(sourceIndex, 1);

      let insertIndex = state.tracks.length - 1; // Default to end
      if (targetId !== "BOTTOM") {
        const targetIndex = state.tracks.findIndex((t) => t.id === targetId);
        if (targetIndex === -1) return state;
        insertIndex = targetIndex;
        if (sourceIndex < targetIndex) {
          insertIndex = targetIndex - 1;
        }
      }

      newTracks.splice(insertIndex, 0, movedTrack);
      return saveHistory(state, newTracks);
    }
    case "TOGGLE_AI_PANEL":
      return { ...state, aiPanelOpen: !state.aiPanelOpen };
    case "TOGGLE_BACKGROUND_ANIMATION":
      return {
        ...state,
        disableBackgroundAnimation: !state.disableBackgroundAnimation,
      };
    case "SET_OFFLINE":
      return { ...state, isOffline: action.payload };
    case "SET_VIEW_MODE":
      return { ...state, viewMode: action.payload };
    case "TOGGLE_MIXER":
      return {
        ...state,
        viewMode: state.viewMode === "mixer" ? "timeline" : "mixer",
      };
    case "SET_ZOOM":
      return {
        ...state,
        zoomLevel: Math.max(5, Math.min(200, action.payload)),
      };
    case "TOGGLE_SETTINGS":
      return { ...state, settingsOpen: !state.settingsOpen };
    case "TOGGLE_LIVE_ANALYZERS":
      return { ...state, showLiveAnalyzers: !state.showLiveAnalyzers };
    case "TOGGLE_SPECTROGRAM":
      return { ...state, spectrogramEnabled: !state.spectrogramEnabled };
    case "TOGGLE_VIDEO_PANEL":
      return { ...state, videoPanelOpen: !state.videoPanelOpen };
    case "SET_VIDEO_URL":
      return { ...state, videoUrl: action.payload };
    case "SET_VIDEO_OFFSET":
      return { ...state, videoOffset: action.payload };
    case "SET_VIDEO_VOLUME":
      return { ...state, videoVolume: action.payload };
    case "SET_VIDEO_MUTED":
      return { ...state, videoMuted: action.payload };
    case "SET_VST_EDITOR_TRACK":
      return { ...state, vstEditorTrackId: action.payload };
    case "SET_SIDECHAIN_EDITOR_TRACK":
      return { ...state, sidechainEditorTrackId: action.payload };
    case "SET_AUTHENTICITY_PROCESSOR_CLIP":
      return { ...state, authenticityProcessorClipId: action.payload };
    case "SET_STEM_SEPARATOR_CLIP":
      return { ...state, stemSeparatorClipId: action.payload };
    case "SET_PIANO_ROLL_CLIP":
      return { ...state, pianoRollClipId: action.payload };
    case "ADD_GENERATED_ALTERNATIVES": {
      const {
        trackId,
        clipId1,
        clipId2,
        filename1,
        filename2,
        start,
        duration,
      } = action.payload;
      const newTracks = state.tracks.map((t) => {
        if (t.id === trackId) {
          const lane1: Lane = {
            id: `lane_${Date.now()}_a_${Math.random().toString(36).substring(2, 7)}`,
            name: `Option A (Alt)`,
            clips: [
              {
                id: clipId1,
                start,
                duration,
                audioData: filename1,
              },
            ],
          };
          const lane2: Lane = {
            id: `lane_${Date.now()}_b_${Math.random().toString(36).substring(2, 7)}`,
            name: `Option B (Alt)`,
            clips: [
              {
                id: clipId2,
                start,
                duration,
                audioData: filename2,
              },
            ],
          };
          const existingLanes = t.lanes || [];
          return {
            ...t,
            lanes: [lane1, lane2, ...existingLanes],
            showLanes: true,
          };
        }
        return t;
      });
      return saveHistory(state, newTracks);
    }
    case "SET_ACTIVE_CONTEXT_MENU":
      return { ...state, activeContextMenu: action.payload };
    case "ADD_MARKER": {
      const { time, label, color } = action.payload;
      const markerId =
        "marker_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);
      const newMarker: Marker = {
        id: markerId,
        time: Math.max(0, time),
        label: label || `Marker ${state.markers.length + 1}`,
        color: color || "#3b82f6", // Default premium blue
      };
      const updatedMarkers = [...state.markers, newMarker].sort(
        (a, b) => a.time - b.time,
      );
      return { ...state, markers: updatedMarkers };
    }
    case "REMOVE_MARKER": {
      return {
        ...state,
        markers: state.markers.filter((m) => m.id !== action.payload),
      };
    }
    case "UPDATE_MARKER": {
      const { id, changes } = action.payload;
      const updated = state.markers.map((m) =>
        m.id === id ? { ...m, ...changes } : m,
      );
      return { ...state, markers: updated.sort((a, b) => a.time - b.time) };
    }
    case "GO_TO_NEXT_MARKER": {
      const next = state.markers.find((m) => m.time > state.currentTime + 0.01);
      if (next) {
        return { ...state, currentTime: next.time };
      }
      return state;
    }
    case "GO_TO_PREV_MARKER": {
      const prev = [...state.markers]
        .reverse()
        .find((m) => m.time < state.currentTime - 0.01);
      if (prev) {
        return { ...state, currentTime: prev.time };
      }
      return state;
    }
    case "SET_TIME_SELECTION":
      return { ...state, timeSelection: action.payload };
    case "TOGGLE_SNAP":
      return { ...state, snapToGrid: !state.snapToGrid };
    case "TOGGLE_LOOP":
      return { ...state, looping: !state.looping };
    case "SET_LOOP_MARKERS":
      return {
        ...state,
        loopStart: action.payload.start,
        loopEnd: action.payload.end,
      };
    case "ADD_CLIP": {
      const newTracks = state.tracks.map((t) =>
        t.id === action.payload.trackId
          ? { ...t, clips: [...t.clips, action.payload.clip] }
          : t,
      );
      return saveHistory(state, newTracks);
    }
    case "MOVE_AND_OVERWRITE_CLIP": {
      const { sourceTrackId, sourceLaneId, clipId, targetTrackId, newStart } =
        action.payload;

      let movedClip: Clip | undefined;
      const tracksWithoutMoved = state.tracks.map((t) => {
        if (t.id === sourceTrackId) {
          if (sourceLaneId) {
            return {
              ...t,
              lanes: t.lanes.map((l) => {
                if (l.id === sourceLaneId) {
                  const c = l.clips.find((clip) => clip.id === clipId);
                  if (c) movedClip = { ...c, start: newStart };
                  return {
                    ...l,
                    clips: l.clips.filter((clip) => clip.id !== clipId),
                  };
                }
                return l;
              }),
            };
          } else {
            const c = t.clips.find((clip) => clip.id === clipId);
            if (c) movedClip = { ...c, start: newStart };
            return {
              ...t,
              clips: t.clips.filter((clip) => clip.id !== clipId),
            };
          }
        }
        return t;
      });

      if (!movedClip) return state;

      const newStartT = movedClip.start;
      const newEndT = movedClip.start + movedClip.duration;

      const newTracks = tracksWithoutMoved.map((t) => {
        if (t.id === targetTrackId) {
          const draggedBufferId = movedClip!.bufferId || movedClip!.id;
          let currentMovedClip = movedClip!;

          const sameBufferOverlaps = t.clips.filter((c) => {
            const hasSameBuffer = (c.bufferId || c.id) === draggedBufferId;
            const overlaps =
              c.start < currentMovedClip.start + currentMovedClip.duration &&
              c.start + c.duration > currentMovedClip.start;
            return hasSameBuffer && overlaps;
          });

          if (sameBufferOverlaps.length > 0) {
            const allToCombine = [...sameBufferOverlaps, currentMovedClip];
            const minStart = Math.min(...allToCombine.map((c) => c.start));
            const maxEnd = Math.max(
              ...allToCombine.map((c) => c.start + c.duration),
            );

            const refClip = sameBufferOverlaps[0];
            const originalStart = refClip.start - (refClip.audioOffset || 0);

            const actualStart = Math.max(minStart, originalStart);
            const actualDuration = maxEnd - actualStart;

            currentMovedClip = {
              ...currentMovedClip,
              id:
                "joined_drag_" +
                Date.now() +
                "_" +
                Math.random().toString(36).substr(2, 4),
              bufferId: refClip.bufferId || refClip.id,
              start: actualStart,
              duration: Math.max(0, actualDuration),
              audioOffset: actualStart - originalStart,
            };
          }

          const remainingClips = t.clips.filter(
            (c) => !sameBufferOverlaps.includes(c),
          );

          const newStartT = currentMovedClip.start;
          const newEndT = currentMovedClip.start + currentMovedClip.duration;

          const finalClips = remainingClips.flatMap((c) => {
            const startT = c.start;
            const endT = c.start + c.duration;

            if (endT <= newStartT || startT >= newEndT) {
              return [c];
            }

            if (startT >= newStartT && endT <= newEndT) {
              return [];
            }

            const res: Clip[] = [];
            if (startT < newStartT) {
              res.push({
                ...c,
                id: c.id + "_split_left_" + Date.now(),
                bufferId: c.bufferId || c.id,
                duration: newStartT - startT,
              });
            }
            if (endT > newEndT) {
              const rightOffset = newEndT - startT;
              res.push({
                ...c,
                id: c.id + "_split_right_" + Date.now(),
                bufferId: c.bufferId || c.id,
                start: newEndT,
                duration: endT - newEndT,
                audioOffset: (c.audioOffset || 0) + rightOffset,
              });
            }

            return res;
          });

          return { ...t, clips: [...finalClips, currentMovedClip] };
        }
        return t;
      });

      return saveHistory(state, newTracks);
    }
    case "UPDATE_CLIP": {
      const newTracks = state.tracks.map((t) =>
        t.id === action.payload.trackId
          ? {
              ...t,
              clips: t.clips.map((c) =>
                c.id === action.payload.clipId
                  ? { ...c, ...action.payload.changes }
                  : c,
              ),
            }
          : t,
      );
      return saveHistory(state, newTracks);
    }
    case "SELECT_CLIP": {
      const { clipId, multi } = action.payload;
      let newSelection = state.selectedClipIds;

      let targetGroupId: string | undefined;
      search_loop: for (const t of state.tracks) {
        for (const c of t.clips) {
          if (c.id === clipId) {
            targetGroupId = c.groupId;
            break search_loop;
          }
        }

        if (t.lanes) {
          for (const l of t.lanes) {
            for (const c of l.clips) {
              if (c.id === clipId) {
                targetGroupId = c.groupId;
                break search_loop;
              }
            }
          }
        }
      }

      let idsToToggle = [clipId];
      if (targetGroupId) {
        idsToToggle = [];
        for (const t of state.tracks) {
          for (const c of t.clips) {
            if (c.groupId === targetGroupId) idsToToggle.push(c.id);
          }
          if (t.lanes) {
            for (const l of t.lanes) {
              for (const c of l.clips) {
                if (c.groupId === targetGroupId) idsToToggle.push(c.id);
              }
            }
          }
        }
      }

      if (multi) {
        const selectedSet = new Set(newSelection);
        const isCurrentlySelected = selectedSet.has(clipId);
        if (isCurrentlySelected) {
          const idsToToggleSet = new Set(idsToToggle);
          newSelection = newSelection.filter((id) => !idsToToggleSet.has(id));
        } else {
          for (const id of idsToToggle) {
            selectedSet.add(id);
          }
          newSelection = Array.from(selectedSet);
        }
      } else {
        newSelection = idsToToggle;
      }
      return { ...state, selectedClipIds: newSelection };
    }
    case "GROUP_CLIPS": {
      if (state.selectedClipIds.length < 2) return state;
      const groupId =
        "group_" + Date.now() + Math.random().toString(36).substr(2, 5);
      const selectedSet = new Set(state.selectedClipIds);
      const newTracks = state.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) =>
          selectedSet.has(c.id) ? { ...c, groupId } : c,
        ),
        lanes: t.lanes?.map((l) => ({
          ...l,
          clips: l.clips.map((c) =>
            selectedSet.has(c.id) ? { ...c, groupId } : c,
          ),
        })),
      }));
      return saveHistory(state, newTracks);
    }
    case "UNGROUP_CLIPS": {
      if (state.selectedClipIds.length === 0) return state;
      const groupIdsToRemove = new Set<string>();
      const selectedSet = new Set(state.selectedClipIds);
      for (const t of state.tracks) {
        for (const c of t.clips) {
          if (selectedSet.has(c.id) && c.groupId)
            groupIdsToRemove.add(c.groupId);
        }
        if (t.lanes) {
          for (const l of t.lanes) {
            for (const c of l.clips) {
              if (selectedSet.has(c.id) && c.groupId)
                groupIdsToRemove.add(c.groupId);
            }
          }
        }
      }
      if (groupIdsToRemove.size === 0) return state;

      const newTracks = state.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) =>
          c.groupId && groupIdsToRemove.has(c.groupId)
            ? { ...c, groupId: undefined }
            : c,
        ),
        lanes: t.lanes?.map((l) => ({
          ...l,
          clips: l.clips.map((c) =>
            c.groupId && groupIdsToRemove.has(c.groupId)
              ? { ...c, groupId: undefined }
              : c,
          ),
        })),
      }));
      return saveHistory(state, newTracks);
    }
    case "MOVE_SELECTED_CLIPS": {
      const selectedSet = new Set(state.selectedClipIds);
      if (selectedSet.size === 0) return state;
      const { timeDelta } = action.payload as { timeDelta: number };

      const newTracks = state.tracks.map((t) => ({
        ...t,
        clips: t.clips.map((c) =>
          selectedSet.has(c.id)
            ? { ...c, start: Math.max(0, c.start + timeDelta) }
            : c,
        ),
        lanes: t.lanes?.map((l) => ({
          ...l,
          clips: l.clips.map((c) =>
            selectedSet.has(c.id)
              ? { ...c, start: Math.max(0, c.start + timeDelta) }
              : c,
          ),
        })),
      }));
      return saveHistory(state, newTracks);
    }
    case "SELECT_MULTIPLE_CLIPS": {
      return { ...state, selectedClipIds: action.payload };
    }
    case "REVERT_CLIP_TO_ORIGINAL": {
      const { trackId, laneId, clipId } = action.payload;
      const newTracks = state.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const revertClip = (c: Clip) => {
          if (c.id === clipId) {
            const buffer = audioEngine.buffers.get(c.bufferId || c.id);
            if (buffer) {
              return {
                ...c,
                // Keep the current timeline bounds (start, duration, audioOffset remain unchanged)
                volumeEnvelope: undefined,
                fadeIn: undefined,
                fadeOut: undefined,
                audioData: undefined, // Remove AI processing/tagging
                notes: undefined, // Remove MIDI if any
              };
            }
          }
          return c;
        };

        if (laneId) {
          return {
            ...t,
            lanes: t.lanes?.map((l) =>
              l.id === laneId ? { ...l, clips: l.clips.map(revertClip) } : l,
            ),
          };
        }
        return { ...t, clips: t.clips.map(revertClip) };
      });
      return saveHistory(state, newTracks);
    }
    case "REVERT_TRACK_TO_ORIGINAL": {
      const { trackId } = action.payload;
      const newTracks = state.tracks.map((t) => {
        if (t.id !== trackId) return t;

        // Find all unique underlying audio buffers on this track
        const uniqueBuffers = new Map<string, AudioBuffer>();

        t.clips.forEach((c) => {
          const bufId = c.bufferId || c.id;
          const buf = audioEngine.buffers.get(bufId);
          if (buf) uniqueBuffers.set(bufId, buf);
        });

        t.lanes?.forEach((l) => {
          l.clips.forEach((c) => {
            const bufId = c.bufferId || c.id;
            const buf = audioEngine.buffers.get(bufId);
            if (buf) uniqueBuffers.set(bufId, buf);
          });
        });

        // Restore them as full-length clips from the start
        const restoredClips: Clip[] = Array.from(uniqueBuffers.entries()).map(
          ([bufId, buf], i) => ({
            id: `${bufId}_restored_${Date.now()}_${i}`,
            bufferId: bufId,
            start: 0, // Assume they originally started at 0
            duration: buf.duration,
            audioOffset: 0,
          }),
        );

        return {
          ...t,
          volume: 0.8,
          pan: 0,
          muted: false,
          solo: false,
          clips: restoredClips,
          lanes: [], // Clear alternate lanes when restoring the track to original
        };
      });
      return saveHistory(state, newTracks);
    }
    case "DELETE_CLIPS": {
      if (state.timeSelection) {
        const { startTime, endTime, trackIds } = state.timeSelection;
        const newTracks = state.tracks.map((t) => {
          if (trackIds.length > 0 && !trackIds.includes(t.id)) return t;

          const newClips = t.clips.flatMap((c) => {
            const clipEnd = c.start + c.duration;

            // If clip is completely outside selection
            if (clipEnd <= startTime || c.start >= endTime) {
              return [c];
            }

            const results = [];

            // Part before selection
            if (c.start < startTime) {
              results.push({
                ...c,
                id: c.id + "_prefix_" + Math.random().toString(36).substr(2, 5),
                bufferId: c.bufferId || c.id,
                duration: startTime - c.start,
              });
            }

            // Part after selection
            if (clipEnd > endTime) {
              results.push({
                ...c,
                id: c.id + "_suffix_" + Math.random().toString(36).substr(2, 5),
                bufferId: c.bufferId || c.id,
                start: endTime,
                duration: clipEnd - endTime,
                audioOffset: (c.audioOffset || 0) + (endTime - c.start),
              });
            }

            return results;
          });

          return { ...t, clips: newClips };
        });
        return saveHistory(
          { ...state, timeSelection: null, selectedClipIds: [] },
          newTracks,
        );
      }

      if (state.selectedClipIds.length === 0) return state;
      const selectedClipIdsSet = new Set(state.selectedClipIds);
      const newTracks = state.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => !selectedClipIdsSet.has(c.id)),
        lanes: t.lanes?.map((l) => ({
          ...l,
          clips: l.clips.filter((c) => !selectedClipIdsSet.has(c.id)),
        })),
      }));
      return saveHistory({ ...state, selectedClipIds: [] }, newTracks);
    }
    case "COPY_CLIPS": {
      if (state.timeSelection) {
        const { startTime, endTime, trackIds } = state.timeSelection;
        const clipsToCopy: Clip[] = [];

        state.tracks.forEach((t) => {
          if (trackIds.length > 0 && !trackIds.includes(t.id)) return;

          t.clips.forEach((c) => {
            const clipEnd = c.start + c.duration;
            const intersectStart = Math.max(c.start, startTime);
            const intersectEnd = Math.min(clipEnd, endTime);

            if (intersectStart < intersectEnd) {
              const sectionClip: Clip = {
                ...c,
                id: c.id + "_copy_" + Math.random().toString(36).substr(2, 5),
                bufferId: c.bufferId || c.id,
                start: intersectStart,
                duration: intersectEnd - intersectStart,
                audioOffset: (c.audioOffset || 0) + (intersectStart - c.start),
              };
              clipsToCopy.push(sectionClip);
            }
          });
        });

        if (clipsToCopy.length > 0) {
          return { ...state, clipboard: clipsToCopy };
        }
      }
      const selectedClipIdsSet = new Set(state.selectedClipIds);
      const clipsToCopy = state.tracks.flatMap((t) =>
        t.clips.filter((c) => selectedClipIdsSet.has(c.id)),
      );
      return { ...state, clipboard: clipsToCopy };
    }
    case "PASTE_CLIPS": {
      if (state.clipboard.length === 0) return state;
      const minStart = Math.min(...state.clipboard.map((c) => c.start));
      const newClips = state.clipboard.map((c) => ({
        ...c,
        id: "clip_" + Date.now() + Math.random(),
        bufferId: c.bufferId || c.id, // Ensure buffer link is preserved
        start: action.payload.time + (c.start - minStart), // preserve relative timing
      }));
      const newTracks = state.tracks.map((t) =>
        t.id === action.payload.trackId
          ? { ...t, clips: [...t.clips, ...newClips] }
          : t,
      );
      return saveHistory(state, newTracks);
    }
    case "DUPLICATE_CLIPS": {
      if (state.timeSelection) {
        const { startTime, endTime, trackIds } = state.timeSelection;
        const duration = endTime - startTime;

        const newTracks = state.tracks.map((t) => {
          if (trackIds.length > 0 && !trackIds.includes(t.id)) return t;

          const duplicates: Clip[] = [];
          t.clips.forEach((c) => {
            const clipEnd = c.start + c.duration;
            const intersectStart = Math.max(c.start, startTime);
            const intersectEnd = Math.min(clipEnd, endTime);

            if (intersectStart < intersectEnd) {
              duplicates.push({
                ...c,
                id: c.id + "_dup_" + Math.random().toString(36).substr(2, 5),
                bufferId: c.bufferId || c.id,
                start: intersectStart + duration, // place immediately after the selection area
                duration: intersectEnd - intersectStart,
                audioOffset: (c.audioOffset || 0) + (intersectStart - c.start),
              });
            }
          });

          if (duplicates.length === 0) return t;
          return { ...t, clips: [...t.clips, ...duplicates] };
        });

        return saveHistory(state, newTracks);
      }

      if (state.selectedClipIds.length === 0) return state;
      const selectedClipIdsSet = new Set(state.selectedClipIds);
      const trackTracks = state.tracks.map((t) => {
        const trackSelectedClips = t.clips.filter((c) =>
          selectedClipIdsSet.has(c.id),
        );
        if (trackSelectedClips.length === 0) return t;
        const minStart = Math.min(...trackSelectedClips.map((c) => c.start));
        const maxEnd = Math.max(
          ...trackSelectedClips.map((c) => c.start + c.duration),
        );
        const offset = maxEnd - minStart;
        const duplicates = trackSelectedClips.map((c) => ({
          ...c,
          id: "clip_" + Date.now() + Math.random(),
          bufferId: c.bufferId || c.id,
          start: c.start + offset,
        }));
        return { ...t, clips: [...t.clips, ...duplicates] };
      });
      return saveHistory(state, trackTracks);
    }
    case "SPLIT_CLIP": {
      if (state.timeSelection) {
        const { startTime, endTime, trackIds } = state.timeSelection;
        const newTracks = state.tracks.map((t) => {
          if (trackIds.length > 0 && !trackIds.includes(t.id)) return t;

          const newClips = t.clips.flatMap((c) => {
            const clipEnd = c.start + c.duration;

            // If clip is completely outside selection
            if (clipEnd <= startTime || c.start >= endTime) {
              return [c];
            }

            // Snap selection boundaries to the nearest zero-crossing for this clip
            const buffer = audioEngine.buffers.get(c.bufferId || c.id);
            let snappedStart = startTime;
            let snappedEnd = endTime;

            if (buffer) {
              const relStart = startTime - c.start + (c.audioOffset || 0);
              const zeroCrossStart = findNearestZeroCrossing(buffer, relStart);
              snappedStart = Math.max(
                c.start,
                Math.min(
                  clipEnd,
                  c.start - (c.audioOffset || 0) + zeroCrossStart,
                ),
              );

              const relEnd = endTime - c.start + (c.audioOffset || 0);
              const zeroCrossEnd = findNearestZeroCrossing(buffer, relEnd);
              snappedEnd = Math.max(
                c.start,
                Math.min(
                  clipEnd,
                  c.start - (c.audioOffset || 0) + zeroCrossEnd,
                ),
              );
            }

            const results = [];

            // Part before selection
            if (c.start < snappedStart) {
              results.push({
                ...c,
                id: c.id + "_prefix_" + Math.random().toString(36).substr(2, 5),
                bufferId: c.bufferId || c.id,
                duration: snappedStart - c.start,
              });
            }

            // The selected part
            const midStart = Math.max(c.start, snappedStart);
            const midEnd = Math.min(clipEnd, snappedEnd);
            if (midEnd > midStart) {
              results.push({
                ...c,
                id:
                  c.id + "_isolate_" + Math.random().toString(36).substr(2, 5),
                bufferId: c.bufferId || c.id,
                start: midStart,
                duration: midEnd - midStart,
                audioOffset: (c.audioOffset || 0) + (midStart - c.start),
              });
            }

            // Part after selection
            if (clipEnd > snappedEnd) {
              results.push({
                ...c,
                id: c.id + "_suffix_" + Math.random().toString(36).substr(2, 5),
                bufferId: c.bufferId || c.id,
                start: snappedEnd,
                duration: clipEnd - snappedEnd,
                audioOffset: (c.audioOffset || 0) + (snappedEnd - c.start),
              });
            }

            return results;
          });

          return { ...t, clips: newClips };
        });

        // Collect IDs of isolated sections to select them
        const isolatedIds: string[] = [];
        newTracks.forEach((t) => {
          t.clips.forEach((c) => {
            if (c.id.includes("_isolate_")) {
              isolatedIds.push(c.id);
            }
          });
        });

        return saveHistory(
          {
            ...state,
            timeSelection: null,
            selectedClipIds: isolatedIds,
          },
          newTracks,
        );
      }

      // Default: split ONLY selected clips at current playhead
      if (state.selectedClipIds.length === 0) {
        return state; // Do nothing if no clips are selected
      }

      const selectedClipIdsSet = new Set(state.selectedClipIds);
      const splitClipsAtPlayhead = (clips: Clip[]): Clip[] =>
        clips.flatMap((clip) => {
          if (
            selectedClipIdsSet.has(clip.id) &&
            state.currentTime > clip.start &&
            state.currentTime < clip.start + clip.duration
          ) {
            // Retrieve buffer and shift cut time to nearest zero-crossing
            const buffer = audioEngine.buffers.get(clip.bufferId || clip.id);
            let splitTime = state.currentTime;

            if (buffer) {
              const relativeTime =
                splitTime - clip.start + (clip.audioOffset || 0);
              const zeroCrossRelative = findNearestZeroCrossing(
                buffer,
                relativeTime,
              );
              splitTime = Math.max(
                clip.start,
                Math.min(
                  clip.start + clip.duration,
                  clip.start - (clip.audioOffset || 0) + zeroCrossRelative,
                ),
              );
            }

            const duration1 = splitTime - clip.start;
            const duration2 = clip.duration - duration1;

            if (duration1 <= 0) return [clip]; // Shift aligned before the clip start, don't split
            if (duration2 <= 0) return [clip]; // Shift aligned past clip duration, don't split

            return [
              {
                ...clip,
                bufferId: clip.bufferId || clip.id,
                duration: duration1,
              },
              {
                ...clip,
                id: clip.id + "_split_" + Date.now(),
                bufferId: clip.bufferId || clip.id,
                start: splitTime,
                duration: duration2,
                audioOffset: (clip.audioOffset || 0) + duration1,
              },
            ];
          }
          return [clip];
        });
      const newTracks = state.tracks.map((track) => ({
        ...track,
        clips: splitClipsAtPlayhead(track.clips),
        // Lane clips are selectable and deletable, so they must split too
        lanes: track.lanes
          ? track.lanes.map((lane) => ({
              ...lane,
              clips: splitClipsAtPlayhead(lane.clips),
            }))
          : track.lanes,
      }));
      return saveHistory(state, newTracks);
    }
    case "SET_BPM": {
      const newBpm = Math.max(1, action.payload);
      console.log("Reducer: SET_BPM", newBpm);
      return {
        ...state,
        bpm: newBpm,
        tempoAutomation: [{ time: 0, bpm: newBpm }],
      };
    }
    case "SET_ORIGINAL_BPM": {
      return { ...state, originalBpm: action.payload };
    }
    case "SET_IS_PROCESSING": {
      return { ...state, isProcessing: action.payload };
    }
    case "SET_IS_DETECTING_BPM": {
      return { ...state, isDetectingBPM: action.payload };
    }
    case "SET_SHOW_BPM_SYNC_POPUP": {
      return {
        ...state,
        showBPMSyncPopup: action.payload,
        bpmSyncCancelRequested: false,
      };
    }
    case "REQUEST_BPM_SYNC_CANCEL": {
      return { ...state, bpmSyncCancelRequested: true };
    }
    case "REPLACE_TRACKS": {
      return saveHistory(state, action.payload);
    }
    case "SET_PROJECT_ID": {
      return { ...state, projectId: action.payload };
    }
    case "SET_PROJECT_NAME": {
      return { ...state, projectName: action.payload, isDefaultName: false };
    }
    case "SET_SYNCING": {
      return { ...state, isSyncing: action.payload };
    }
    case "TOGGLE_PROJECT_BROWSER": {
      return { ...state, isProjectBrowserOpen: !state.isProjectBrowserOpen };
    }
    case "SYNC_STATE": {
      if (!action.payload) return state;
      const rawTracks = action.payload.tracks || state.tracks || [];
      const sanitizedTracks = rawTracks.map((track: any) => ({
        ...track,
        clips: track.clips || [],
        lanes: track.lanes || [],
      }));
      return {
        ...state,
        ...action.payload,
        tracks: sanitizedTracks,
      };
    }
    case "INCREMENT_BUFFERS_VERSION": {
      return { ...state, buffersVersion: state.buffersVersion + 1 };
    }
    case "SET_HAS_MANUALLY_SAVED": {
      return { ...state, hasManuallySaved: action.payload };
    }

    case "UNDO": {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1];
      const newPast = state.past.slice(0, state.past.length - 1);
      return {
        ...state,
        past: newPast,
        future: [state.tracks, ...state.future],
        tracks: previous,
      };
    }
    case "REDO": {
      if (state.future.length === 0) return state;
      const next = state.future[0];
      const newFuture = state.future.slice(1);
      return {
        ...state,
        past: [...state.past, state.tracks],
        future: newFuture,
        tracks: next,
      };
    }
    case "RESET_PROJECT": {
      return {
        ...state,
        tracks: [],
        currentTime: 0,
        isPlaying: false,
        isRecording: false,
        selectedClipIds: [],
        clipboard: [],
        past: [],
        future: [],
        projectName: "Untitled Project",
        projectId: "",
        isDefaultName: true,
        hasManuallySaved: false,
        activeTrackId: null,
      };
    }
    case "LOAD_PROJECT":
      // Theme is device-local (persisted via localStorage), not part of a
      // project payload — keep the current theme when swapping projects.
      return { ...action.payload, theme: action.payload.theme ?? state.theme };
    // Theme actions deliberately do NOT snapshot undo history (saveHistory):
    // they are pure UI preferences, not project edits.
    case "SET_THEME_MODE":
      return { ...state, theme: { ...state.theme, themeMode: action.payload } };
    case "SET_ACCENT_COLOR":
      return {
        ...state,
        theme: { ...state.theme, accentColor: action.payload },
      };
    case "UPDATE_GLASS_SETTINGS":
      return {
        ...state,
        theme: {
          ...state.theme,
          glassSettings: { ...state.theme.glassSettings, ...action.payload },
        },
      };
    case "SELECT_ALL_CLIPS": {
      const allClips: string[] = [];
      for (const t of state.tracks) {
        for (const c of t.clips) {
          allClips.push(c.id);
        }
        if (t.lanes) {
          for (const l of t.lanes) {
            for (const c of l.clips) {
              allClips.push(c.id);
            }
          }
        }
      }
      return { ...state, selectedClipIds: allClips };
    }
    case "FINALIZE_CLIP_OVERLAPS": {
      const { trackId, laneId, clipId } = action.payload;
      let targetClip: Clip | undefined;

      const newTracks = state.tracks.map((t) => {
        if (t.id !== trackId) return t;

        if (laneId) {
          const newLanes = t.lanes?.map((l) => {
            if (l.id !== laneId) return l;

            const draggedClip = l.clips.find((c) => c.id === clipId);
            if (!draggedClip) return l;

            const draggedBufferId = draggedClip.bufferId || draggedClip.id;

            const sameBufferOverlaps = l.clips.filter((c) => {
              const hasSameBuffer = (c.bufferId || c.id) === draggedBufferId;
              const overlaps =
                c.start <= draggedClip.start + draggedClip.duration + 0.001 &&
                c.start + c.duration >= draggedClip.start - 0.001;
              return hasSameBuffer && overlaps;
            });

            if (sameBufferOverlaps.length <= 1) return l; // Just the dragged clip itself

            const minStart = Math.min(
              ...sameBufferOverlaps.map((c) => c.start),
            );
            const maxEnd = Math.max(
              ...sameBufferOverlaps.map((c) => c.start + c.duration),
            );

            const refClip = sameBufferOverlaps[0];
            const originalStart = refClip.start - (refClip.audioOffset || 0);

            const actualStart = Math.max(minStart, originalStart);
            const actualDuration = maxEnd - actualStart;

            const joinedClip: Clip = {
              id:
                "joined_drag_lane_" +
                Date.now() +
                "_" +
                Math.random().toString(36).substr(2, 4),
              bufferId: refClip.bufferId || refClip.id,
              start: actualStart,
              duration: Math.max(0, actualDuration),
              audioOffset: actualStart - originalStart,
            };

            const remainingClips = l.clips.filter(
              (c) => !sameBufferOverlaps.includes(c),
            );
            return { ...l, clips: [...remainingClips, joinedClip] };
          });
          return { ...t, lanes: newLanes };
        } else {
          const draggedClip = t.clips.find((c) => c.id === clipId);
          if (!draggedClip) return t;

          const draggedBufferId = draggedClip.bufferId || draggedClip.id;

          const sameBufferOverlaps = t.clips.filter((c) => {
            const hasSameBuffer = (c.bufferId || c.id) === draggedBufferId;
            const overlaps =
              c.start <= draggedClip.start + draggedClip.duration + 0.001 &&
              c.start + c.duration >= draggedClip.start - 0.001;
            return hasSameBuffer && overlaps;
          });

          if (sameBufferOverlaps.length <= 1) return t;

          const minStart = Math.min(...sameBufferOverlaps.map((c) => c.start));
          const maxEnd = Math.max(
            ...sameBufferOverlaps.map((c) => c.start + c.duration),
          );

          const refClip = sameBufferOverlaps[0];
          const originalStart = refClip.start - (refClip.audioOffset || 0);

          const actualStart = Math.max(minStart, originalStart);
          const actualDuration = maxEnd - actualStart;

          const joinedClip: Clip = {
            id:
              "joined_drag_" +
              Date.now() +
              "_" +
              Math.random().toString(36).substr(2, 4),
            bufferId: refClip.bufferId || refClip.id,
            start: actualStart,
            duration: Math.max(0, actualDuration),
            audioOffset: actualStart - originalStart,
          };

          const remainingClips = t.clips.filter(
            (c) => !sameBufferOverlaps.includes(c),
          );
          return { ...t, clips: [...remainingClips, joinedClip] };
        }
      });

      return saveHistory(state, newTracks);
    }
    case "RESTORE_SELECTION": {
      if (!state.timeSelection && state.selectedClipIds.length === 0)
        return state;

      let newTracks = state.tracks;

      if (state.timeSelection) {
        const { startTime, endTime, trackIds } = state.timeSelection;

        newTracks = state.tracks.map((t) => {
          if (trackIds.length > 0 && !trackIds.includes(t.id)) return t;

          const allClips = [
            ...t.clips,
            ...(t.lanes ? t.lanes.flatMap((l) => l.clips) : []),
          ];

          if (allClips.length === 0) return t;

          // Find clips intersecting the time selection
          const intersectingClips = allClips.filter(
            (c) => c.start < endTime && c.start + c.duration > startTime,
          );

          if (intersectingClips.length === 0) {
            // Find closest clip to infer buffer
            const closest = [...allClips].sort((a, b) => {
              const distA = Math.min(
                Math.abs(a.start - endTime),
                Math.abs(a.start + a.duration - startTime),
              );
              const distB = Math.min(
                Math.abs(b.start - endTime),
                Math.abs(b.start + b.duration - startTime),
              );
              return distA - distB;
            });
            if (closest.length === 0) return t;

            const ref = closest[0];
            const originalStart = ref.start - (ref.audioOffset || 0);

            const actualStart = Math.max(startTime, originalStart);
            const actualDuration = endTime - actualStart;
            if (actualDuration <= 0) return t;

            const restoredClip: Clip = {
              id: "restored_" + Math.random().toString(36).substr(2, 5),
              bufferId: ref.bufferId || ref.id,
              start: actualStart,
              duration: actualDuration,
              audioOffset: actualStart - originalStart,
            };

            return { ...t, clips: [...t.clips, restoredClip] };
          }

          // If there are intersecting clips, join them all into one clip that spans from
          // min start (or selection start) to max end (or selection end)
          const refClip = intersectingClips[0];
          const originalStart = refClip.start - (refClip.audioOffset || 0);

          const minStart = Math.min(
            startTime,
            ...intersectingClips.map((c) => c.start),
          );
          const maxEnd = Math.max(
            endTime,
            ...intersectingClips.map((c) => c.start + c.duration),
          );

          const actualStart = Math.max(minStart, originalStart);
          const actualDuration = maxEnd - actualStart;

          if (actualDuration <= 0) return t;

          const joinedClip: Clip = {
            id: "joined_" + Math.random().toString(36).substr(2, 5),
            bufferId: refClip.bufferId || refClip.id,
            start: actualStart,
            duration: actualDuration,
            audioOffset: actualStart - originalStart,
          };

          const intersectingClipIds = new Set(
            intersectingClips.map((ic) => ic.id),
          );

          const nonIntersectingMain = t.clips.filter(
            (c) => !intersectingClipIds.has(c.id),
          );

          let newLanes = t.lanes
            ? t.lanes.map((l) => ({
                ...l,
                clips: l.clips.filter((c) => !intersectingClipIds.has(c.id)),
              }))
            : undefined;

          // Remove empty lanes
          if (newLanes) {
            newLanes = newLanes.filter((l) => l.clips.length > 0);
          }

          return {
            ...t,
            clips: [...nonIntersectingMain, joinedClip],
            lanes: newLanes?.length ? newLanes : undefined,
          };
        });
      } else if (state.selectedClipIds.length > 0) {
        // Fallback: join selected clips
        const selectedClipIdsSet = new Set(state.selectedClipIds);
        newTracks = state.tracks.map((t) => {
          const allClips = [
            ...t.clips,
            ...(t.lanes ? t.lanes.flatMap((l) => l.clips) : []),
          ];

          const selectedInTrack = allClips.filter((c) =>
            selectedClipIdsSet.has(c.id),
          );
          if (selectedInTrack.length < 2) return t;

          const refClip = selectedInTrack[0];
          const originalStart = refClip.start - (refClip.audioOffset || 0);

          const minStart = Math.min(...selectedInTrack.map((c) => c.start));
          const maxEnd = Math.max(
            ...selectedInTrack.map((c) => c.start + c.duration),
          );

          const actualStart = Math.max(minStart, originalStart);
          const actualDuration = maxEnd - actualStart;

          if (actualDuration <= 0) return t;

          const joinedClip: Clip = {
            id: "joined_" + Math.random().toString(36).substr(2, 5),
            bufferId: refClip.bufferId || refClip.id,
            start: actualStart,
            duration: actualDuration,
            audioOffset: actualStart - originalStart,
          };

          const unselectedMain = t.clips.filter(
            (c) => !selectedClipIdsSet.has(c.id),
          );

          let newLanes = t.lanes
            ? t.lanes.map((l) => ({
                ...l,
                clips: l.clips.filter((c) => !selectedClipIdsSet.has(c.id)),
              }))
            : undefined;

          if (newLanes) {
            newLanes = newLanes.filter((l) => l.clips.length > 0);
          }

          return {
            ...t,
            clips: [...unselectedMain, joinedClip],
            lanes: newLanes?.length ? newLanes : undefined,
          };
        });
      }

      return saveHistory(
        { ...state, timeSelection: null, selectedClipIds: [] },
        newTracks,
      );
    }

    case "CUT_CLIPS": {
      let clipboard = [...state.clipboard];
      let newTracks: Track[];

      if (state.timeSelection) {
        const { startTime, endTime, trackIds } = state.timeSelection;
        const clipsToCopy: Clip[] = [];

        // 1. Copy the sections
        state.tracks.forEach((t) => {
          if (trackIds.length > 0 && !trackIds.includes(t.id)) return;
          t.clips.forEach((c) => {
            const clipEnd = c.start + c.duration;
            const intersectStart = Math.max(c.start, startTime);
            const intersectEnd = Math.min(clipEnd, endTime);

            if (intersectStart < intersectEnd) {
              clipsToCopy.push({
                ...c,
                id: c.id + "_copy_" + Math.random().toString(36).substr(2, 5),
                bufferId: c.bufferId || c.id,
                start: intersectStart,
                duration: intersectEnd - intersectStart,
                audioOffset: (c.audioOffset || 0) + (intersectStart - c.start),
              });
            }
          });
        });

        // 2. Delete the sections
        newTracks = state.tracks.map((t) => {
          if (trackIds.length > 0 && !trackIds.includes(t.id)) return t;
          const newClips = t.clips.flatMap((c) => {
            const clipEnd = c.start + c.duration;
            if (clipEnd <= startTime || c.start >= endTime) return [c];
            const results = [];
            if (c.start < startTime) {
              results.push({
                ...c,
                id: c.id + "_prefix_" + Math.random().toString(36).substr(2, 5),
                bufferId: c.bufferId || c.id,
                duration: startTime - c.start,
              });
            }
            if (clipEnd > endTime) {
              results.push({
                ...c,
                id: c.id + "_suffix_" + Math.random().toString(36).substr(2, 5),
                bufferId: c.bufferId || c.id,
                start: endTime,
                duration: clipEnd - endTime,
                audioOffset: (c.audioOffset || 0) + (endTime - c.start),
              });
            }
            return results;
          });
          return { ...t, clips: newClips };
        });

        return saveHistory(
          {
            ...state,
            clipboard: clipsToCopy.length > 0 ? clipsToCopy : clipboard,
            timeSelection: null,
            selectedClipIds: [],
          },
          newTracks,
        );
      }

      if (state.selectedClipIds.length === 0) return state;
      const selectedClipIdsSet = new Set(state.selectedClipIds);
      clipboard = state.tracks.flatMap((t) =>
        t.clips.filter((c) => selectedClipIdsSet.has(c.id)),
      );
      newTracks = state.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => !selectedClipIdsSet.has(c.id)),
      }));
      return saveHistory(
        { ...state, clipboard, selectedClipIds: [] },
        newTracks,
      );
    }
    case "DELETE_TRACK": {
      const newTracks = state.tracks.filter((t) => t.id !== action.payload);
      const activeTrackId =
        state.activeTrackId === action.payload
          ? newTracks[0]?.id ?? null
          : state.activeTrackId;
      return { ...saveHistory(state, newTracks), activeTrackId };
    }
    case "DUPLICATE_TRACK": {
      const trackToClone = state.tracks.find((t) => t.id === action.payload);
      if (!trackToClone) return state;
      const newTrack = {
        ...trackToClone,
        id: "track_" + Date.now() + Math.random(),
        name: trackToClone.name + " (Copy)",
        clips: trackToClone.clips.map((c) => ({
          ...c,
          id: "clip_" + Date.now() + Math.random(),
          bufferId: c.bufferId || c.id,
        })),
        lanes: trackToClone.lanes.map((l) => ({
          ...l,
          id: "lane_" + Date.now() + Math.random(),
          clips: l.clips.map((c) => ({
            ...c,
            id: "clip_" + Date.now() + Math.random(),
            bufferId: c.bufferId || c.id,
          })),
        })),
      };
      return {
        ...saveHistory(state, [...state.tracks, newTrack]),
        activeTrackId: newTrack.id,
      };
    }
    case "ADD_LANE": {
      const newTracks = state.tracks.map((t) => {
        if (t.id === action.payload.trackId) {
          const laneNumber = t.lanes.length + 1;
          const newLane: Lane = {
            id: "lane_" + Date.now(),
            name: `Version ${laneNumber}`,
            clips: [],
          };
          return { ...t, lanes: [newLane, ...t.lanes], showLanes: true };
        }
        return t;
      });
      return saveHistory(state, newTracks);
    }
    case "DELETE_LANE": {
      const newTracks = state.tracks.map((t) => {
        if (t.id === action.payload.trackId) {
          return {
            ...t,
            lanes: t.lanes.filter((l) => l.id !== action.payload.laneId),
          };
        }
        return t;
      });
      return saveHistory(state, newTracks);
    }
    case "DELETE_LANES": {
      const { trackId, laneIds } = action.payload;
      const newTracks = state.tracks.map((t) => {
        if (t.id === trackId) {
          return {
            ...t,
            lanes: t.lanes.filter((l) => !laneIds.includes(l.id)),
          };
        }
        return t;
      });
      return saveHistory(state, newTracks);
    }
    case "TOGGLE_LANES": {
      const newTracks = state.tracks.map((t) =>
        t.id === action.payload ? { ...t, showLanes: !t.showLanes } : t,
      );
      return { ...state, tracks: newTracks }; // Don't save history for UI toggle
    }
    case "PROMOTE_LANE": {
      const newTracks = state.tracks.map((t) => {
        if (t.id === action.payload.trackId) {
          const lane = t.lanes.find((l) => l.id === action.payload.laneId);
          if (!lane || lane.clips.length === 0) return t;

          let currentMainClips = [...t.clips];

          // For each clip in the lane, overwrite parts of the main track
          lane.clips.forEach((laneClip) => {
            const laneStart = laneClip.start;
            const laneEnd = laneClip.start + laneClip.duration;

            currentMainClips = currentMainClips.flatMap((c) => {
              const startT = c.start;
              const endT = c.start + c.duration;

              // Completely outside
              if (endT <= laneStart || startT >= laneEnd) return [c];

              // Completely covered
              if (startT >= laneStart && endT <= laneEnd) return [];

              const res: Clip[] = [];
              // Left part remains
              if (startT < laneStart) {
                res.push({
                  ...c,
                  id: c.id + "_p_l_" + Math.random().toString(36).substr(2, 5),
                  bufferId: c.bufferId || c.id,
                  duration: laneStart - startT,
                });
              }
              // Right part remains
              if (endT > laneEnd) {
                const rightOffset = laneEnd - startT;
                res.push({
                  ...c,
                  id: c.id + "_p_r_" + Math.random().toString(36).substr(2, 5),
                  bufferId: c.bufferId || c.id,
                  start: laneEnd,
                  duration: endT - laneEnd,
                  audioOffset: (c.audioOffset || 0) + rightOffset,
                });
              }
              return res;
            });
          });

          return {
            ...t,
            clips: [
              ...currentMainClips,
              ...lane.clips.map((c) => ({
                ...c,
                id: "clip_" + Date.now() + Math.random(),
                bufferId: c.bufferId || c.id,
              })),
            ],
          };
        }
        return t;
      });
      return saveHistory(state, newTracks);
    }
    case "PASTE_CLIP_TO_LANE": {
      const { trackId, laneId } = action.payload;
      if (state.clipboard.length === 0) return state;
      const newClips = state.clipboard.map((c) => ({
        ...c,
        id: "clip_" + Date.now() + Math.random(),
        bufferId: c.bufferId || c.id,
        start: c.start, // Paste at exact same absolute spot in timeline
      }));
      const newTracks = state.tracks.map((t) => {
        if (t.id === trackId) {
          return {
            ...t,
            lanes: t.lanes.map((l) => {
              if (l.id === laneId) {
                return { ...l, clips: [...l.clips, ...newClips] };
              }
              return l;
            }),
          };
        }
        return t;
      });
      return saveHistory(state, newTracks);
    }
    case "ADD_CLIP_TO_NEW_LANE": {
      const { trackId, clipId } = action.payload;
      const newTracks = state.tracks.map((t) => {
        if (t.id === trackId) {
          const clip = t.clips.find((c) => c.id === clipId);
          if (clip) {
            const laneNumber = t.lanes.length + 1;
            const newLane: Lane = {
              id: "lane_" + Date.now(),
              name: `Version ${laneNumber}`,
              clips: [{ ...clip, id: clip.id + "_copy_" + Date.now() }],
            };
            return {
              ...t,
              lanes: [newLane, ...t.lanes],
              showLanes: true,
            };
          }
        }
        return t;
      });
      return saveHistory(state, newTracks);
    }
    case "MOVE_CLIP_TO_LANE": {
      const {
        sourceTrackId,
        sourceLaneId,
        clipId,
        targetTrackId,
        targetLaneId,
        newStart,
      } = action.payload;

      let movedClip: Clip | undefined;

      const tracksAfterRemoval = state.tracks.map((t) => {
        if (t.id === sourceTrackId) {
          if (sourceLaneId) {
            return {
              ...t,
              lanes: t.lanes.map((l) => {
                if (l.id === sourceLaneId) {
                  const clip = l.clips.find((c) => c.id === clipId);
                  if (clip) movedClip = { ...clip, start: newStart };
                  return {
                    ...l,
                    clips: l.clips.filter((c) => c.id !== clipId),
                  };
                }
                return l;
              }),
            };
          } else {
            const clip = t.clips.find((c) => c.id === clipId);
            if (clip) movedClip = { ...clip, start: newStart };
            return { ...t, clips: t.clips.filter((c) => c.id !== clipId) };
          }
        }
        return t;
      });

      if (!movedClip) return state;

      const finishTracks = tracksAfterRemoval.map((t) => {
        if (t.id === targetTrackId) {
          return {
            ...t,
            lanes: t.lanes.map((l) => {
              if (l.id === targetLaneId) {
                const draggedBufferId = movedClip!.bufferId || movedClip!.id;
                let currentMovedClip = movedClip!;

                const sameBufferOverlaps = l.clips.filter((c) => {
                  const hasSameBuffer =
                    (c.bufferId || c.id) === draggedBufferId;
                  const overlaps =
                    c.start <
                      currentMovedClip.start + currentMovedClip.duration &&
                    c.start + c.duration > currentMovedClip.start;
                  return hasSameBuffer && overlaps;
                });

                if (sameBufferOverlaps.length > 0) {
                  const allToCombine = [
                    ...sameBufferOverlaps,
                    currentMovedClip,
                  ];
                  const minStart = Math.min(
                    ...allToCombine.map((c) => c.start),
                  );
                  const maxEnd = Math.max(
                    ...allToCombine.map((c) => c.start + c.duration),
                  );

                  const refClip = sameBufferOverlaps[0];
                  const originalStart =
                    refClip.start - (refClip.audioOffset || 0);

                  const actualStart = Math.max(minStart, originalStart);
                  const actualDuration = maxEnd - actualStart;

                  currentMovedClip = {
                    ...currentMovedClip,
                    id:
                      "joined_drag_lane_" +
                      Date.now() +
                      "_" +
                      Math.random().toString(36).substr(2, 4),
                    bufferId: refClip.bufferId || refClip.id,
                    start: actualStart,
                    duration: Math.max(0, actualDuration),
                    audioOffset: actualStart - originalStart,
                  };
                }

                const remainingClips = l.clips.filter(
                  (c) => !sameBufferOverlaps.includes(c),
                );

                return { ...l, clips: [...remainingClips, currentMovedClip] };
              }
              return l;
            }),
          };
        }
        return t;
      });

      return saveHistory(state, finishTracks);
    }
    default:
      return state;
  }
}

import { cleanUpStemsAsync } from "./audioUtils";

const AppContext = createContext<
  { state: AppStateWithHistory; dispatch: React.Dispatch<Action> } | undefined
>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);
  const stateRef = React.useRef(state);

  // Sync ref with state
  React.useEffect(() => {
    stateRef.current = state;
  }, [state]);

  // Persist theme settings. Theme actions replace state.theme by reference,
  // so this effect only fires on theme changes — unrelated dispatches never
  // touch localStorage.
  React.useEffect(() => {
    try {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(state.theme));
    } catch {
      // Quota/privacy-mode failures are non-fatal for a UI preference.
    }
  }, [state.theme]);

  // Apply the accent color as the --color-primary CSS variable on :root
  // immediately (covers both startup restore and SET_ACCENT_COLOR).
  React.useEffect(() => {
    document.documentElement.style.setProperty(
      "--color-primary",
      state.theme.accentColor,
    );
  }, [state.theme.accentColor]);

  // Store-driven defaults for LiquidGlassPanel. Memoized on the theme slice
  // so panels don't re-render from unrelated state changes.
  const glassThemeValue = React.useMemo(
    () => ({
      glassSettings: state.theme.glassSettings,
      performanceMode: state.theme.themeMode === "performance",
    }),
    [state.theme],
  );

  // Update online/offline status
  React.useEffect(() => {
    const handleOnline = () =>
      dispatch({ type: "SET_OFFLINE", payload: false });
    const handleOffline = () =>
      dispatch({ type: "SET_OFFLINE", payload: true });
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const currentState = stateRef.current;
      // Ignore if typing in input
      if (
        e.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA"].includes(e.target.tagName)
      )
        return;

      if (e.key.toLowerCase() === "y" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        dispatch({ type: "REDO" });
      } else if (e.key.toLowerCase() === "z" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        if (e.shiftKey) {
          dispatch({ type: "REDO" });
        } else {
          dispatch({ type: "UNDO" });
        }
      } else if (e.key.toLowerCase() === "x" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        dispatch({ type: "CUT_CLIPS" });
      } else if (e.key.toLowerCase() === "a" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        dispatch({ type: "SELECT_ALL_CLIPS" });
      } else if (e.key.toLowerCase() === "c" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        dispatch({ type: "COPY_CLIPS" });
      } else if (e.key.toLowerCase() === "v" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        // Use latest state from ref
        dispatch({
          type: "PASTE_CLIPS",
          payload: {
            trackId: currentState.tracks[0]?.id || "1",
            time: currentState.currentTime,
          },
        });
      } else if (e.key.toLowerCase() === "d" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        dispatch({ type: "DUPLICATE_CLIPS" });
      } else if (e.key === "Delete" || e.key === "Backspace") {
        dispatch({ type: "DELETE_CLIPS" });
      } else if (e.code === "Space") {
        e.preventDefault();
        dispatch({ type: "TOGGLE_PLAY" });
      } else if (
        e.key.toLowerCase() === "s" &&
        e.shiftKey &&
        (e.ctrlKey || e.metaKey)
      ) {
        e.preventDefault();
        cleanUpStemsAsync(currentState, dispatch);
      } else if (e.key.toLowerCase() === "s" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        dispatch({ type: "SPLIT_CLIP" });
      } else if (e.key.toLowerCase() === "r" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        dispatch({ type: "TOGGLE_RECORD" });
      } else if (e.key.toLowerCase() === "m" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        dispatch({
          type: "ADD_MARKER",
          payload: { time: currentState.currentTime },
        });
      } else if (e.key === "[" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        dispatch({ type: "GO_TO_PREV_MARKER" });
      } else if (e.key === "]" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        dispatch({ type: "GO_TO_NEXT_MARKER" });
      } else if (e.key === "F9") {
        e.preventDefault();
        dispatch({ type: "TOGGLE_MIXER" });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <AppContext.Provider value={{ state, dispatch }}>
      <GlassThemeContext.Provider value={glassThemeValue}>
        {children}
      </GlassThemeContext.Provider>
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error("useApp must be used within an AppProvider");
  }
  return context;
}
