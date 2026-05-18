/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppProvider } from './lib/store';
import { Navbar } from './components/Navbar';
import { Transport } from './components/Transport';
import { TrackList } from './components/TrackList';
import { Timeline } from './components/Timeline';
import { Mixer } from './components/Mixer';
import { AICopilot } from './components/AICopilot';
import { SettingsModal } from './components/SettingsModal';
import { CreateForm } from './components/CreateForm';
import { ProjectBrowser } from './components/ProjectBrowser';
import { SyncOverlay } from './components/SyncOverlay';
import { BPMSyncPopup } from './components/BPMSyncPopup';
import { WelcomeModal } from './components/WelcomeModal';
import { useApp } from './lib/store';
import React, { useState, useEffect, useRef } from 'react';
import { audioEngine } from './lib/audioEngine';
import { useGemini } from './lib/useGemini';
import { subscribeToProject, updateProjectCloud, uploadAssetCloud, downloadAssetCloud, isGitHubPagesBuild, isDemoProject } from './lib/syncUtils';
import { saveAsset, getAsset, saveLocalProjectState, getLocalProjectState } from './lib/assetManager';

import { WebGLBackground } from './components/WebGLBackground';
import { detectBPMOffline } from './lib/essentiaBPM';

// We extract the inner content to use the useApp hook
function AppContent() {
  const { state, dispatch } = useApp();
  const { detectBPM } = useGemini();
  const [syncProgress, setSyncProgress] = useState(0);

  // Ref to access latest state in async callbacks
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    (window as any).dispatchForTesting = dispatch;
    (window as any).stateForTesting = state;
  }, [state, dispatch]);

  // 1. Startup Restoration Effect (Local-First Caching)
  useEffect(() => {
    const restoreLastProject = async () => {
      try {
        const lastActiveProjectId = localStorage.getItem('jaad_last_active_project_id');
        if (lastActiveProjectId && !state.projectId) {
          console.log(`Local-First Startup: Found last active project ID ${lastActiveProjectId}`);
          const localState = await getLocalProjectState(lastActiveProjectId);
          if (localState) {
            console.log('Local-First Startup: Successfully retrieved cached project state. Restoring...', localState);
            dispatch({ type: 'SET_PROJECT_ID', payload: lastActiveProjectId });
            dispatch({ type: 'SYNC_STATE', payload: localState });
            dispatch({ type: 'SET_HAS_MANUALLY_SAVED', payload: localState.hasManuallySaved ?? true });
            dispatch({ type: 'INCREMENT_BUFFERS_VERSION' });
          }
        }
      } catch (err) {
        console.error('Failed to restore last active project from local cache:', err);
      }
    };
    restoreLastProject();
  }, [dispatch]);

  // 2. Continuous Auto-Caching Effect (Local-First Caching)
  useEffect(() => {
    if (!state.projectId) return;

    const saveCache = async () => {
      try {
        const stateToCache = {
          projectName: state.projectName,
          tracks: state.tracks,
          bpm: state.bpm,
          originalBpm: state.originalBpm,
          masterVolume: state.masterVolume,
          hasManuallySaved: state.hasManuallySaved
        };
        await saveLocalProjectState(state.projectId, stateToCache);
        localStorage.setItem('jaad_last_active_project_id', state.projectId);
      } catch (err) {
        console.error('Failed to save continuous local cache:', err);
      }
    };

    const timer = setTimeout(() => {
      saveCache();
    }, 1000); // 1-second debounce to optimize performance

    return () => clearTimeout(timer);
  }, [state.tracks, state.bpm, state.originalBpm, state.masterVolume, state.projectId, state.projectName, state.hasManuallySaved]);

  useEffect(() => {
    // Determine if any track is soloed
    const anySolo = state.tracks.some(t => t.solo);

    state.tracks.forEach(track => {
      const isActuallyMuted = track.muted || (anySolo && !track.solo);
      
      // We also ensure track routing is set up in case it was created before the engine initialized
      if (!audioEngine.trackNodes.has(track.id) && audioEngine.context) {
        audioEngine.setupTrackRouting(track.id, track.volume, track.pan);
      }
      
      audioEngine.updateTrackSettings(track.id, track.volume, track.pan, isActuallyMuted);
    });
  }, [state.tracks]);



  useEffect(() => {
    if (!state.projectId) return;

    const unsubscribe = subscribeToProject(state.projectId, (cloudState) => {
      dispatch({ type: 'SYNC_STATE', payload: cloudState });
    });

    return () => unsubscribe();
  }, [state.projectId, dispatch]);

  useEffect(() => {
    // Only autosave if we have a project ID, we're online, we've saved manually once,
    // AND we're not currently in the middle of a manual blocking sync.
    if (!state.projectId || state.isOffline || !state.hasManuallySaved || state.isSyncing) return;

    // Bypass background cloud auto-save for the demo project on GitHub Pages
    if (isGitHubPagesBuild() && isDemoProject(state.projectName)) return;

    const timer = setTimeout(() => {
      // Background sync (not blocking)
      updateProjectCloud(state.projectId, state.projectName, state.tracks, state.bpm, state.originalBpm, state.masterVolume);
    }, 10000); // Increase to 10s to reduce network congestion

    return () => clearTimeout(timer);
  }, [state.tracks, state.bpm, state.originalBpm, state.masterVolume, state.projectId, state.isOffline, state.hasManuallySaved, state.projectName, state.isSyncing]);

  useEffect(() => {
    const recoverAssets = async () => {
      for (const track of state.tracks) {
        // Collect all possible asset IDs for this track
        const assetIds = new Set<string>();
        
        // 1. Clips in main list
        track.clips.forEach(c => assetIds.add(c.bufferId || c.id));
        
        // 2. Clips in lanes (recordings)
        track.lanes?.forEach(lane => {
          lane.clips.forEach(c => assetIds.add(c.bufferId || c.id));
        });
        
        // 3. Frozen buffer
        if (track.isFrozen && track.frozenBufferId) {
          assetIds.add(track.frozenBufferId);
        }

        for (const id of assetIds) {
          if (!audioEngine.buffers.has(id)) {
            let asset = await getAsset(id);
            if (!asset) {
              // Try cloud recovery if local is missing
              asset = await downloadAssetCloud(id);
              if (asset) {
                await saveAsset(id, asset); // Cache locally for next time
              }
            }
            if (asset) {
              await audioEngine.loadAudio(id, asset as File);
              dispatch({ type: 'INCREMENT_BUFFERS_VERSION' });
            }
          }
        }
      }
    };
    recoverAssets();
  }, [state.tracks]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files as FileList);
      const audioFiles = files.filter(f => f.type.startsWith('audio/') || f.name.match(/\.(mp3|wav|ogg|flac|aac|m4a|weba|webm)$/i));
      
      if (audioFiles.length === 0) return;

      const isMultiple = audioFiles.length > 1;
      if (isMultiple) {
        dispatch({ type: 'SET_SHOW_BPM_SYNC_POPUP', payload: true });
      }
      dispatch({ type: 'SET_IS_DETECTING_BPM', payload: true });

      try {
        const loadedClipIds: string[] = [];

        // Step 1: Load ALL files first
        for (let i = 0; i < audioFiles.length; i++) {
          const file = audioFiles[i];
          const clipId = `clip_${Date.now()}_${i}`;
          const trackId = `track_${Date.now()}_${i}`;
          const trackName = file.name.replace(/\.[^/.]+$/, "") || 'Audio Track';
          
          const colors = ['#FF2A5F', '#00E871', '#6B44FF', '#FFBB00', '#00E5FF', '#FF00EA'];
          const randomColor = colors[(state.tracks.length + i) % colors.length];
          
          const duration = await audioEngine.loadAudio(clipId, file);
          loadedClipIds.push(clipId);

          await saveAsset(clipId, file);
          // Also sync to cloud storage for cross-device persistence
          await uploadAssetCloud(clipId, file).catch(err => console.error("Cloud upload failed", err));
          
          dispatch({ type: 'INCREMENT_BUFFERS_VERSION' });
          
          dispatch({
            type: 'ADD_TRACK',
            payload: {
              id: trackId,
              name: trackName,
              volume: 0.8,
              pan: 0,
              muted: false,
              solo: false,
              color: randomColor,
              clips: [{
                id: clipId,
                start: 0,
                duration,
                audioData: file.name
              }],
              lanes: [],
              showLanes: false
            }
          });
        }

        // Step 2: After ALL files loaded, detect BPM from the first track
        // Check if user cancelled (for multi-file popup)
        if (isMultiple && stateRef.current.bpmSyncCancelRequested) {
          console.log("App: BPM Sync cancelled by user.");
        } else {
          console.log("App: All files loaded. Starting BPM detection...");
          const firstBufferId = loadedClipIds[0];
          const buffer = audioEngine.buffers.get(firstBufferId);
          if (buffer) {
            const bpm = await detectBPMOffline(buffer);
            if (bpm) {
              dispatch({ type: 'SET_ORIGINAL_BPM', payload: bpm });
              dispatch({ type: 'SET_BPM', payload: bpm });
              console.log("App: Auto-detected BPM:", bpm);
            }
          }
        }
      } catch (err) {
        console.error("App drop handler error:", err);
      } finally {
        dispatch({ type: 'SET_IS_DETECTING_BPM', payload: false });
        dispatch({ type: 'SET_SHOW_BPM_SYNC_POPUP', payload: false });
      }
    }
  };

  useEffect(() => {
    // Sync project BPM to AudioEngine's tempo automation
    audioEngine.tempoAutomation = [{ time: 0, bpm: state.bpm }];
    
    // Adjust playback rate so audio matches the new tempo
    if (state.originalBpm > 0) {
      const rate = state.bpm / state.originalBpm;
      audioEngine.setPlaybackRate(rate);
      console.log(`BPM sync: ${state.bpm}/${state.originalBpm} = ${rate.toFixed(3)}x playback rate`);
    }
  }, [state.bpm, state.originalBpm]);

  return (
    <div 
      className="h-screen w-screen flex flex-col text-white overflow-hidden relative selection:bg-primary/30 bg-transparent transition-colors duration-300"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <WebGLBackground isDimmed={state.tracks.length > 0} />
      
      <div className="relative z-10 flex flex-col h-full w-full bg-transparent shadow-2xl">
        <Navbar setSyncProgress={setSyncProgress} />
        {state.isDetectingBPM && (
          <div className="absolute top-16 left-1/2 transform -translate-x-1/2 z-50 bg-primary text-black px-4 py-2 rounded-full text-xs font-bold animate-pulse shadow-xl">
             Analyzing Project Tempo...
          </div>
        )}
        
        <div className="flex-1 flex overflow-hidden relative">
          <div className="flex-1 relative">
            {state.viewMode === 'timeline' ? (
              <div className="absolute inset-0 block overflow-y-auto overflow-x-hidden" id="main-scroll-container">
                <div className="flex min-w-full min-h-full items-stretch">
                  <TrackList />
                  <Timeline />
                </div>
              </div>
            ) : (
              <Mixer />
            )}
          </div>
          <AICopilot />
        </div>
        
        <Transport />
        <CreateForm />
        <SettingsModal />
        <ProjectBrowser />
        <BPMSyncPopup />
        <SyncOverlay progress={syncProgress} />
        <WelcomeModal />
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <AppContent />
    </AppProvider>
  );
}

