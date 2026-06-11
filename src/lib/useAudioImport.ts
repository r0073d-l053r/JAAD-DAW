import { useRef } from 'react';
import { useApp, Clip } from './store';
import { audioEngine } from './audioEngine';
import { saveAsset } from './assetManager';
import { uploadAssetCloud } from './syncUtils';
import { detectBPMOffline } from './essentiaBPM';
import { pickTrackColor } from './trackColors';

export interface AudioImportOptions {
  /** Add the imported clips to an existing track instead of creating a new track per file */
  targetTrackId?: string;
  /** Start time (in seconds) for the imported clips. Defaults to 0 */
  dropTime?: number;
  /** Await the cloud upload of each asset before continuing (App drop behavior). Defaults to fire-and-forget */
  awaitCloudUpload?: boolean;
  /** 'compact': volume 1, 15-char track name and a separate ADD_CLIP dispatch (Mixer / Timeline file-select behavior).
   *  'full' (default): volume 0.8, extension-stripped track name with the clip inlined in ADD_TRACK (App / Timeline drop behavior) */
  trackStyle?: 'full' | 'compact';
  /** Only show the BPM-detecting indicator when importing a single file (Mixer behavior). Defaults to always showing it */
  detectingIndicatorOnlyForSingle?: boolean;
  /** Label used in console messages to identify the call site */
  logLabel?: string;
}

const AUDIO_FILE_REGEX = /\.(mp3|wav|ogg|flac|aac|m4a|weba|webm)$/i;

export function useAudioImport() {
  const { state, dispatch } = useApp();

  // Ref to access latest state in async callbacks
  const stateRef = useRef(state);
  stateRef.current = state;

  const importAudioFiles = async (files: File[], options: AudioImportOptions = {}) => {
    const {
      targetTrackId,
      dropTime,
      awaitCloudUpload = false,
      trackStyle = 'full',
      detectingIndicatorOnlyForSingle = false,
      logLabel = 'Audio import'
    } = options;

    const audioFiles = files.filter(f => f.type.startsWith('audio/') || f.name.match(AUDIO_FILE_REGEX));
    if (audioFiles.length === 0) return;

    const isMultiple = audioFiles.length > 1;
    if (isMultiple) {
      dispatch({ type: 'SET_SHOW_BPM_SYNC_POPUP', payload: true });
    }
    if (!detectingIndicatorOnlyForSingle || !isMultiple) {
      dispatch({ type: 'SET_IS_DETECTING_BPM', payload: true });
    }

    try {
      const loadedClipIds: string[] = [];
      const baseTrackCount = state.tracks.length;

      // Step 1: Load ALL files first
      for (let i = 0; i < audioFiles.length; i++) {
        const file = audioFiles[i];
        const clipId = 'clip_' + Date.now() + '_' + i;

        const duration = await audioEngine.loadAudio(clipId, file);
        loadedClipIds.push(clipId);

        await saveAsset(clipId, file);
        // Also sync to cloud storage for cross-device persistence
        const upload = uploadAssetCloud(clipId, file).catch(err => console.error(`${logLabel}: Cloud upload failed`, err));
        if (awaitCloudUpload) {
          await upload;
        }
        dispatch({ type: 'INCREMENT_BUFFERS_VERSION' });

        const clip: Clip = {
          id: clipId,
          start: dropTime ?? 0,
          duration,
          audioData: file.name
        };

        if (targetTrackId) {
          dispatch({ type: 'ADD_CLIP', payload: { trackId: targetTrackId, clip } });
        } else {
          const newTrackId = 'track_' + Date.now() + '_' + i;
          const newTrackColor = pickTrackColor(baseTrackCount + i);

          if (trackStyle === 'compact') {
            dispatch({
              type: 'ADD_TRACK',
              payload: {
                id: newTrackId,
                name: file.name.substring(0, 15) || 'Audio',
                volume: 1,
                pan: 0,
                muted: false,
                solo: false,
                color: newTrackColor,
                clips: [],
                lanes: [],
                showLanes: false
              }
            });

            dispatch({ type: 'ADD_CLIP', payload: { trackId: newTrackId, clip } });
          } else {
            dispatch({
              type: 'ADD_TRACK',
              payload: {
                id: newTrackId,
                name: file.name.replace(/\.[^/.]+$/, "") || 'Audio Track',
                volume: 0.8,
                pan: 0,
                muted: false,
                solo: false,
                color: newTrackColor,
                clips: [clip],
                lanes: [],
                showLanes: false
              }
            });
          }
        }
      }

      // Step 2: After ALL files loaded, detect BPM from the first one
      // Check if user cancelled (for multi-file popup)
      if (isMultiple && stateRef.current.bpmSyncCancelRequested) {
        console.log(`${logLabel}: BPM Sync cancelled by user.`);
      } else {
        console.log(`${logLabel}: All files loaded. Starting BPM detection...`);
        const buffer = audioEngine.buffers.get(loadedClipIds[0]);
        if (buffer) {
          const bpm = await detectBPMOffline(buffer);
          if (bpm) {
            dispatch({ type: 'SET_ORIGINAL_BPM', payload: bpm });
            dispatch({ type: 'SET_BPM', payload: bpm });
            console.log(`${logLabel}: Auto-detected BPM:`, bpm);
          }
        }
      }
    } catch (err) {
      console.error(`${logLabel}: import error:`, err);
    } finally {
      dispatch({ type: 'SET_IS_DETECTING_BPM', payload: false });
      dispatch({ type: 'SET_SHOW_BPM_SYNC_POPUP', payload: false });
    }
  };

  return { importAudioFiles };
}
