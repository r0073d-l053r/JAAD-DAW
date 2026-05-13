import React, { createContext, useContext, useReducer, ReactNode } from "react";
import { audioEngine } from "./audioEngine";

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
}

export interface Clip {
  id: string;
  bufferId?: string;
  start: number; // in seconds
  duration: number; // in seconds
  audioOffset?: number; // seconds into the audio buffer
  audioData?: any; // placeholder for real audio
}

export interface TimeSelection {
  startTime: number; // in seconds
  endTime: number; // in seconds
  trackIds: string[];
}

interface AppState {
  tracks: Track[];
  isPlaying: boolean;
  currentTime: number;
  bpm: number;
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
}

type Action =
  | { type: "TOGGLE_PLAY" }
  | { type: "TOGGLE_RECORD" }
  | { type: "SET_TIME"; payload: number }
  | { type: "SET_MASTER_VOLUME"; payload: number }
  | { type: "ADD_TRACK"; payload: Track }
  | { type: "UPDATE_TRACK"; payload: { id: string; changes: Partial<Track> } }
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
  | { type: "COPY_CLIPS" }
  | { type: "PASTE_CLIPS"; payload: { trackId: string; time: number } }
  | { type: "DUPLICATE_CLIPS" }
  | { type: "DELETE_CLIPS" }
  | { type: "TOGGLE_SNAP" }
  | { type: "TOGGLE_LOOP" }
  | { type: "SET_LOOP_MARKERS"; payload: { start: number; end: number } }
  | { type: "SPLIT_CLIP" }
  | { type: "UNDO" }
  | { type: "CLEAN_UP_STEMS" }
  | { type: "REDO" }
  | { type: "RESET_PROJECT" }
  | { type: "LOAD_PROJECT"; payload: AppStateWithHistory }
  | { type: "FINALIZE_CLIP_OVERLAPS"; payload: { trackId: string; laneId?: string; clipId: string } }
  | { type: "SELECT_ALL_CLIPS" }
  | { type: "CUT_CLIPS" }
  | { type: "RESTORE_SELECTION" }
  | { type: "SET_TIME_SELECTION"; payload: TimeSelection | null }
  | { type: "DELETE_TRACK"; payload: string }
  | { type: "DUPLICATE_TRACK"; payload: string }
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
    };

interface AppStateWithHistory extends AppState {
  past: Track[][];
  future: Track[][];
}

const initialTracks: Track[] = [];

const initialState: AppStateWithHistory = {
  tracks: initialTracks,
  past: [],
  future: [],
  isPlaying: false,
  isRecording: false,
  currentTime: 0,
  bpm: 120,
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
};

function saveHistory(
  state: AppStateWithHistory,
  newTracks: Track[],
): AppStateWithHistory {
  return {
    ...state,
    past: [...state.past, state.tracks],
    future: [],
    tracks: newTracks,
  };
}

function appReducer(
  state: AppStateWithHistory,
  action: Action,
): AppStateWithHistory {
  switch (action.type) {
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
    case "SET_TIME": {
      // Ensure we don't accidentally update time during transit states
      return { ...state, currentTime: action.payload };
    }
    case "SET_MASTER_VOLUME": {
      audioEngine.setMasterVolume(action.payload);
      return { ...state, masterVolume: action.payload };
    }
    case "ADD_TRACK":
      const trackWithLanes = {
        ...action.payload,
        lanes: action.payload.lanes || [],
        showLanes: action.payload.showLanes ?? false,
      };
      return saveHistory(state, [...state.tracks, trackWithLanes]);
    case "UPDATE_TRACK": {
      const newTracks = state.tracks.map((t) =>
        t.id === action.payload.id ? { ...t, ...action.payload.changes } : t,
      );
      return saveHistory(state, newTracks);
    }
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
      return { ...state, disableBackgroundAnimation: !state.disableBackgroundAnimation };
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
      const { sourceTrackId, sourceLaneId, clipId, targetTrackId, newStart } = action.payload;

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
                  return { ...l, clips: l.clips.filter((clip) => clip.id !== clipId) };
                }
                return l;
              }),
            };
          } else {
            const c = t.clips.find((clip) => clip.id === clipId);
            if (c) movedClip = { ...c, start: newStart };
            return { ...t, clips: t.clips.filter((clip) => clip.id !== clipId) };
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
            const overlaps = c.start < currentMovedClip.start + currentMovedClip.duration && c.start + c.duration > currentMovedClip.start;
            return hasSameBuffer && overlaps;
          });

          if (sameBufferOverlaps.length > 0) {
            const allToCombine = [...sameBufferOverlaps, currentMovedClip];
            const minStart = Math.min(...allToCombine.map(c => c.start));
            const maxEnd = Math.max(...allToCombine.map(c => c.start + c.duration));
            
            const refClip = sameBufferOverlaps[0];
            const originalStart = refClip.start - (refClip.audioOffset || 0);
            
            const actualStart = Math.max(minStart, originalStart);
            const actualDuration = maxEnd - actualStart;

            currentMovedClip = {
               ...currentMovedClip,
               id: "joined_drag_" + Date.now() + "_" + Math.random().toString(36).substr(2,4),
               bufferId: refClip.bufferId || refClip.id,
               start: actualStart,
               duration: Math.max(0, actualDuration),
               audioOffset: actualStart - originalStart,
            };
          }

          const remainingClips = t.clips.filter((c) => !sameBufferOverlaps.includes(c));

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
      let newSelection = state.selectedClipIds;
      if (action.payload.multi) {
        if (newSelection.includes(action.payload.clipId)) {
          newSelection = newSelection.filter(
            (id) => id !== action.payload.clipId,
          );
        } else {
          newSelection = [...newSelection, action.payload.clipId];
        }
      } else {
        newSelection = [action.payload.clipId];
      }
      return { ...state, selectedClipIds: newSelection };
    }
    case "SELECT_MULTIPLE_CLIPS": {
      return { ...state, selectedClipIds: action.payload };
    }
    case "SET_TIME_SELECTION": {
      return { ...state, timeSelection: action.payload };
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
                duration: startTime - c.start
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
                audioOffset: (c.audioOffset || 0) + (endTime - c.start)
              });
            }
            
            return results;
          });
          
          return { ...t, clips: newClips };
        });
        return saveHistory({ ...state, timeSelection: null, selectedClipIds: [] }, newTracks);
      }

      if (state.selectedClipIds.length === 0) return state;
      const newTracks = state.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => !state.selectedClipIds.includes(c.id)),
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
                audioOffset: (c.audioOffset || 0) + (intersectStart - c.start)
              };
              clipsToCopy.push(sectionClip);
            }
          });
        });
        
        if (clipsToCopy.length > 0) {
          return { ...state, clipboard: clipsToCopy };
        }
      }
      const clipsToCopy = state.tracks.flatMap((t) =>
        t.clips.filter((c) => state.selectedClipIds.includes(c.id)),
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
                 audioOffset: (c.audioOffset || 0) + (intersectStart - c.start)
               });
             }
          });
          
          if (duplicates.length === 0) return t;
          return { ...t, clips: [...t.clips, ...duplicates] };
        });
        
        return saveHistory(state, newTracks);
      }

      if (state.selectedClipIds.length === 0) return state;
      const trackTracks = state.tracks.map((t) => {
        const trackSelectedClips = t.clips.filter((c) =>
          state.selectedClipIds.includes(c.id),
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

            const results = [];
            
            // Part before selection
            if (c.start < startTime) {
              results.push({
                ...c,
                id: c.id + "_prefix_" + Math.random().toString(36).substr(2, 5),
                bufferId: c.bufferId || c.id,
                duration: startTime - c.start
              });
            }
            
            // The selected part
            const midStart = Math.max(c.start, startTime);
            const midEnd = Math.min(clipEnd, endTime);
            results.push({
              ...c,
              id: c.id + "_isolate_" + Math.random().toString(36).substr(2, 5),
              bufferId: c.bufferId || c.id,
              start: midStart,
              duration: midEnd - midStart,
              audioOffset: (c.audioOffset || 0) + (midStart - c.start),
            });
            
            // Part after selection
            if (clipEnd > endTime) {
              results.push({
                ...c,
                id: c.id + "_suffix_" + Math.random().toString(36).substr(2, 5),
                bufferId: c.bufferId || c.id,
                start: endTime,
                duration: clipEnd - endTime,
                audioOffset: (c.audioOffset || 0) + (endTime - c.start)
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

      const newTracks = state.tracks.map((track) => {
        const newClips = track.clips.flatMap((clip) => {
          if (
            state.selectedClipIds.includes(clip.id) &&
            state.currentTime > clip.start &&
            state.currentTime < clip.start + clip.duration
          ) {
            const duration1 = state.currentTime - clip.start;
            const duration2 = clip.duration - duration1;
            return [
              { ...clip, bufferId: clip.bufferId || clip.id, duration: duration1 },
              {
                ...clip,
                id: clip.id + "_split_" + Date.now(),
                bufferId: clip.bufferId || clip.id,
                start: state.currentTime,
                duration: duration2,
                audioOffset: (clip.audioOffset || 0) + duration1,
              },
            ];
          }
          return [clip];
        });
        return { ...track, clips: newClips };
      });
      return saveHistory(state, newTracks);
    }
    case "CLEAN_UP_STEMS": {
      const threshold = 0.005; // ~ -46dB threshold for silence
      
      const newTracks = state.tracks.map((track) => {
        // Clean up main track clips
        const newClips = track.clips.flatMap((clip) => {
          const buffer = audioEngine.buffers.get(clip.bufferId || clip.id);
          if (!buffer) return [clip];
          
          const channelData = buffer.getChannelData(0);
          const sampleRate = buffer.sampleRate;
          const blockSize = Math.floor(sampleRate * 0.05); // 50ms chunks
          const len = channelData.length;
          
          let isSound = false;
          let soundStart = 0;
          const chunks: Clip[] = [];
          
          for (let i = 0; i < len; i += blockSize) {
            let maxVal = 0;
            const end = Math.min(i + blockSize, len);
            for (let j = i; j < end; j++) {
              const val = Math.abs(channelData[j]);
              if (val > maxVal) maxVal = val;
            }
            
            if (maxVal > threshold) {
              if (!isSound) {
                isSound = true;
                soundStart = i;
              }
            } else {
              if (isSound) {
                isSound = false;
                const chunkStartSec = soundStart / sampleRate;
                const chunkEndSec = i / sampleRate;
                
                const visibleAudioStart = clip.audioOffset || 0;
                const visibleAudioEnd = visibleAudioStart + clip.duration;
                
                const maxStart = Math.max(chunkStartSec, visibleAudioStart);
                const minEnd = Math.min(chunkEndSec, visibleAudioEnd);
                
                if (minEnd > maxStart) {
                  chunks.push({
                    ...clip,
                    id: clip.id + "_cleanup_" + Math.random().toString(36).substr(2, 5),
                    bufferId: clip.bufferId || clip.id,
                    start: clip.start + (maxStart - visibleAudioStart),
                    duration: minEnd - maxStart,
                    audioOffset: maxStart
                  });
                }
              }
            }
          }
          
          if (isSound) {
             const chunkStartSec = soundStart / sampleRate;
             const chunkEndSec = len / sampleRate;
             const visibleAudioStart = clip.audioOffset || 0;
             const visibleAudioEnd = visibleAudioStart + clip.duration;
             
             const maxStart = Math.max(chunkStartSec, visibleAudioStart);
             const minEnd = Math.min(chunkEndSec, visibleAudioEnd);
             
             if (minEnd > maxStart) {
               chunks.push({
                 ...clip,
                 id: clip.id + "_cleanup_" + Math.random().toString(36).substr(2, 5),
                 bufferId: clip.bufferId || clip.id,
                 start: clip.start + (maxStart - visibleAudioStart),
                 duration: minEnd - maxStart,
                 audioOffset: maxStart
               });
             }
          }
          
          return chunks;
        });
        
        // Clean up lane clips
        const newLanes = track.lanes?.map(lane => {
          const laneClips = lane.clips.flatMap((clip) => {
            const buffer = audioEngine.buffers.get(clip.bufferId || clip.id);
            if (!buffer) return [clip];
            
            const channelData = buffer.getChannelData(0);
            const sampleRate = buffer.sampleRate;
            const blockSize = Math.floor(sampleRate * 0.05); // 50ms chunks
            const len = channelData.length;
            
            let isSound = false;
            let soundStart = 0;
            const chunks: Clip[] = [];
            
            for (let i = 0; i < len; i += blockSize) {
              let maxVal = 0;
              const end = Math.min(i + blockSize, len);
              for (let j = i; j < end; j++) {
                const val = Math.abs(channelData[j]);
                if (val > maxVal) maxVal = val;
              }
              
              if (maxVal > threshold) {
                if (!isSound) {
                  isSound = true;
                  soundStart = i;
                }
              } else {
                if (isSound) {
                  isSound = false;
                  const chunkStartSec = soundStart / sampleRate;
                  const chunkEndSec = i / sampleRate;
                  
                  const visibleAudioStart = clip.audioOffset || 0;
                  const visibleAudioEnd = visibleAudioStart + clip.duration;
                  
                  const maxStart = Math.max(chunkStartSec, visibleAudioStart);
                  const minEnd = Math.min(chunkEndSec, visibleAudioEnd);
                  
                  if (minEnd > maxStart) {
                    chunks.push({
                      ...clip,
                      id: clip.id + "_cleanup_" + Math.random().toString(36).substr(2, 5),
                      bufferId: clip.bufferId || clip.id,
                      start: clip.start + (maxStart - visibleAudioStart),
                      duration: minEnd - maxStart,
                      audioOffset: maxStart
                    });
                  }
                }
              }
            }
            
            if (isSound) {
               const chunkStartSec = soundStart / sampleRate;
               const chunkEndSec = len / sampleRate;
               const visibleAudioStart = clip.audioOffset || 0;
               const visibleAudioEnd = visibleAudioStart + clip.duration;
               
               const maxStart = Math.max(chunkStartSec, visibleAudioStart);
               const minEnd = Math.min(chunkEndSec, visibleAudioEnd);
               
               if (minEnd > maxStart) {
                 chunks.push({
                   ...clip,
                   id: clip.id + "_cleanup_" + Math.random().toString(36).substr(2, 5),
                   bufferId: clip.bufferId || clip.id,
                   start: clip.start + (maxStart - visibleAudioStart),
                   duration: minEnd - maxStart,
                   audioOffset: maxStart
                 });
               }
            }
            
            return chunks;
          });
          return { ...lane, clips: laneClips };
        }) || [];
        
        return { ...track, clips: newClips, lanes: newLanes };
      });
      return saveHistory(state, newTracks);
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
      };
    }
    case "LOAD_PROJECT":
      return action.payload;
    case "SELECT_ALL_CLIPS": {
      const allClips = state.tracks.flatMap((t) => t.clips.map((c) => c.id));
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
              const overlaps = c.start <= draggedClip.start + draggedClip.duration + 0.001 && c.start + c.duration >= draggedClip.start - 0.001;
              return hasSameBuffer && overlaps;
            });

            if (sameBufferOverlaps.length <= 1) return l; // Just the dragged clip itself

            const minStart = Math.min(...sameBufferOverlaps.map(c => c.start));
            const maxEnd = Math.max(...sameBufferOverlaps.map(c => c.start + c.duration));
            
            const refClip = sameBufferOverlaps[0];
            const originalStart = refClip.start - (refClip.audioOffset || 0);
            
            const actualStart = Math.max(minStart, originalStart);
            const actualDuration = maxEnd - actualStart;

            const joinedClip: Clip = {
              id: "joined_drag_lane_" + Date.now() + "_" + Math.random().toString(36).substr(2,4),
              bufferId: refClip.bufferId || refClip.id,
              start: actualStart,
              duration: Math.max(0, actualDuration),
              audioOffset: actualStart - originalStart,
            };

            const remainingClips = l.clips.filter((c) => !sameBufferOverlaps.includes(c));
            return { ...l, clips: [...remainingClips, joinedClip] };
          });
          return { ...t, lanes: newLanes };
        } else {
          const draggedClip = t.clips.find((c) => c.id === clipId);
          if (!draggedClip) return t;

          const draggedBufferId = draggedClip.bufferId || draggedClip.id;

          const sameBufferOverlaps = t.clips.filter((c) => {
            const hasSameBuffer = (c.bufferId || c.id) === draggedBufferId;
            const overlaps = c.start <= draggedClip.start + draggedClip.duration + 0.001 && c.start + c.duration >= draggedClip.start - 0.001;
            return hasSameBuffer && overlaps;
          });

          if (sameBufferOverlaps.length <= 1) return t;

          const minStart = Math.min(...sameBufferOverlaps.map(c => c.start));
          const maxEnd = Math.max(...sameBufferOverlaps.map(c => c.start + c.duration));
          
          const refClip = sameBufferOverlaps[0];
          const originalStart = refClip.start - (refClip.audioOffset || 0);
          
          const actualStart = Math.max(minStart, originalStart);
          const actualDuration = maxEnd - actualStart;

          const joinedClip: Clip = {
            id: "joined_drag_" + Date.now() + "_" + Math.random().toString(36).substr(2,4),
            bufferId: refClip.bufferId || refClip.id,
            start: actualStart,
            duration: Math.max(0, actualDuration),
            audioOffset: actualStart - originalStart,
          };

          const remainingClips = t.clips.filter((c) => !sameBufferOverlaps.includes(c));
          return { ...t, clips: [...remainingClips, joinedClip] };
        }
      });

      return saveHistory(state, newTracks);
    }
    case "RESTORE_SELECTION": {
      if (!state.timeSelection && state.selectedClipIds.length === 0) return state;

      let newTracks = state.tracks;

      if (state.timeSelection) {
        const { startTime, endTime, trackIds } = state.timeSelection;

        newTracks = state.tracks.map((t) => {
          if (trackIds.length > 0 && !trackIds.includes(t.id)) return t;

          const allClips = [...t.clips, ...(t.lanes ? t.lanes.flatMap(l => l.clips) : [])];
          
          if (allClips.length === 0) return t;

          // Find clips intersecting the time selection
          const intersectingClips = allClips.filter(
            (c) => c.start < endTime && c.start + c.duration > startTime
          );

          if (intersectingClips.length === 0) {
            // Find closest clip to infer buffer
            const closest = [...allClips].sort((a, b) => {
              const distA = Math.min(Math.abs(a.start - endTime), Math.abs(a.start + a.duration - startTime));
              const distB = Math.min(Math.abs(b.start - endTime), Math.abs(b.start + b.duration - startTime));
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

          const minStart = Math.min(startTime, ...intersectingClips.map((c) => c.start));
          const maxEnd = Math.max(endTime, ...intersectingClips.map((c) => c.start + c.duration));

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

          const nonIntersectingMain = t.clips.filter((c) => !intersectingClips.find(ic => ic.id === c.id));
          
          let newLanes = t.lanes ? t.lanes.map(l => ({
            ...l,
            clips: l.clips.filter((c) => !intersectingClips.find(ic => ic.id === c.id))
          })) : undefined;

          // Remove empty lanes
          if (newLanes) {
            newLanes = newLanes.filter(l => l.clips.length > 0);
          }

          return { ...t, clips: [...nonIntersectingMain, joinedClip], lanes: newLanes?.length ? newLanes : undefined };
        });
      } else if (state.selectedClipIds.length > 0) {
        // Fallback: join selected clips
        newTracks = state.tracks.map((t) => {
          const allClips = [...t.clips, ...(t.lanes ? t.lanes.flatMap(l => l.clips) : [])];
          
          const selectedInTrack = allClips.filter((c) => state.selectedClipIds.includes(c.id));
          if (selectedInTrack.length < 2) return t;

          const refClip = selectedInTrack[0];
          const originalStart = refClip.start - (refClip.audioOffset || 0);

          const minStart = Math.min(...selectedInTrack.map((c) => c.start));
          const maxEnd = Math.max(...selectedInTrack.map((c) => c.start + c.duration));

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

          const unselectedMain = t.clips.filter((c) => !state.selectedClipIds.includes(c.id));
          
          let newLanes = t.lanes ? t.lanes.map(l => ({
            ...l,
            clips: l.clips.filter((c) => !state.selectedClipIds.includes(c.id))
          })) : undefined;

          if (newLanes) {
            newLanes = newLanes.filter(l => l.clips.length > 0);
          }

          return { ...t, clips: [...unselectedMain, joinedClip], lanes: newLanes?.length ? newLanes : undefined };
        });
      }

      return saveHistory(
        { ...state, timeSelection: null, selectedClipIds: [] },
        newTracks
      );
    }

    case "CUT_CLIPS": {
      let clipboard = [...state.clipboard];
      let newTracks = state.tracks;

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
      clipboard = state.tracks.flatMap((t) =>
        t.clips.filter((c) => state.selectedClipIds.includes(c.id)),
      );
      newTracks = state.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => !state.selectedClipIds.includes(c.id)),
      }));
      return saveHistory(
        { ...state, clipboard, selectedClipIds: [] },
        newTracks,
      );
    }
    case "DELETE_TRACK": {
      const newTracks = state.tracks.filter((t) => t.id !== action.payload);
      return saveHistory(state, newTracks);
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
      return saveHistory(state, [...state.tracks, newTrack]);
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
          lane.clips.forEach(laneClip => {
            const laneStart = laneClip.start;
            const laneEnd = laneClip.start + laneClip.duration;

            currentMainClips = currentMainClips.flatMap(c => {
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
                  duration: laneStart - startT
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
                  audioOffset: (c.audioOffset || 0) + rightOffset
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
                  return { ...l, clips: l.clips.filter((c) => c.id !== clipId) };
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
                  const hasSameBuffer = (c.bufferId || c.id) === draggedBufferId;
                  const overlaps = c.start < currentMovedClip.start + currentMovedClip.duration && c.start + c.duration > currentMovedClip.start;
                  return hasSameBuffer && overlaps;
                });

                if (sameBufferOverlaps.length > 0) {
                  const allToCombine = [...sameBufferOverlaps, currentMovedClip];
                  const minStart = Math.min(...allToCombine.map(c => c.start));
                  const maxEnd = Math.max(...allToCombine.map(c => c.start + c.duration));
                  
                  const refClip = sameBufferOverlaps[0];
                  const originalStart = refClip.start - (refClip.audioOffset || 0);
                  
                  const actualStart = Math.max(minStart, originalStart);
                  const actualDuration = maxEnd - actualStart;

                  currentMovedClip = {
                     ...currentMovedClip,
                     id: "joined_drag_lane_" + Date.now() + "_" + Math.random().toString(36).substr(2,4),
                     bufferId: refClip.bufferId || refClip.id,
                     start: actualStart,
                     duration: Math.max(0, actualDuration),
                     audioOffset: actualStart - originalStart,
                  };
                }

                const remainingClips = l.clips.filter((c) => !sameBufferOverlaps.includes(c));

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

const AppContext = createContext<
  { state: AppStateWithHistory; dispatch: React.Dispatch<Action> } | undefined
>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(appReducer, initialState);

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
        // Since we don't have track context directly mapped to cursor yet, assume first track or selected track
        // For now hardcoding pasting to track 1
        dispatch({
          type: "PASTE_CLIPS",
          payload: {
            trackId: state.tracks[0]?.id || "1",
            time: state.currentTime,
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
      } else if (e.key.toLowerCase() === "s" && e.shiftKey && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        dispatch({ type: "CLEAN_UP_STEMS" });
      } else if (e.key.toLowerCase() === "s" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        dispatch({ type: "SPLIT_CLIP" });
      } else if (e.key.toLowerCase() === "r" && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        dispatch({ type: "TOGGLE_RECORD" });
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
      {children}
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
