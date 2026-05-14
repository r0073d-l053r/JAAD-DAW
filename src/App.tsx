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
import { useApp } from './lib/store';
import React, { useState, useEffect } from 'react';
import { audioEngine } from './lib/audioEngine';
import { useGemini } from './lib/useGemini';
import { subscribeToProject, updateProjectCloud, uploadAssetCloud, downloadAssetCloud } from './lib/syncUtils';
import { saveAsset, getAsset } from './lib/assetManager';

import { StudioBackground } from './components/StudioBackground';

// We extract the inner content to use the useApp hook
function AppContent() {
  const { state, dispatch } = useApp();
  const { detectBPM } = useGemini();
  const [detectingBPM, setDetectingBPM] = useState(false);

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
    if (!state.projectId || state.isOffline || !state.hasManuallySaved) return;

    const timer = setTimeout(() => {
      dispatch({ type: 'SET_SYNCING', payload: true });
      updateProjectCloud(state.projectId, state.projectName, state.tracks, state.bpm, state.masterVolume)
        .finally(() => dispatch({ type: 'SET_SYNCING', payload: false }));
    }, 3000);

    return () => clearTimeout(timer);
  }, [state.tracks, state.bpm, state.masterVolume, state.projectId, state.isOffline, state.hasManuallySaved, state.projectName, dispatch]);

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
      
      for (let i = 0; i < audioFiles.length; i++) {
        const file = audioFiles[i];
        const clipId = `clip_${Date.now()}_${i}`;
        const trackId = `track_${Date.now()}_${i}`;
        const trackName = file.name.replace(/\.[^/.]+$/, "") || 'Audio Track';
        
        const colors = ['#FF2A5F', '#00E871', '#6B44FF', '#FFBB00', '#00E5FF', '#FF00EA'];
        const randomColor = colors[(state.tracks.length + i) % colors.length];
        
        const duration = await audioEngine.loadAudio(clipId, file);
        await saveAsset(clipId, file);
        // Also sync to cloud storage for cross-device persistence
        uploadAssetCloud(clipId, file).catch(err => console.error("Cloud upload failed", err));
        
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

        // Automatically detect BPM on the very first imported audio track
        if (state.tracks.length === 0 && i === 0) {
          const buffer = audioEngine.buffers.get(clipId);
          if (buffer) {
            setDetectingBPM(true);
            try {
               const bpm = await detectBPM(buffer);
               if (bpm) {
                 dispatch({ type: 'SET_BPM', payload: bpm });
                 console.log(`Detected BPM: ${bpm}`);
               }
            } catch (err) {
               console.error("AI BPM Detection failed", err);
            } finally {
               setDetectingBPM(false);
            }
          }
        }
      }
    }
  };

  return (
    <div 
      className="h-screen w-screen flex flex-col text-white overflow-hidden relative selection:bg-primary/30 bg-transparent transition-colors duration-300"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <StudioBackground isDimmed={state.tracks.length > 0} disableAnimation={state.disableBackgroundAnimation} />
      
      <div className="relative z-10 flex flex-col h-full w-full bg-transparent shadow-2xl">
        <Navbar />
        {detectingBPM && (
          <div className="absolute top-16 left-1/2 transform -translate-x-1/2 z-50 bg-primary text-black px-4 py-2 rounded-full text-xs font-bold animate-pulse shadow-xl">
             AI Detecting Tempo...
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

