/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { AppProvider } from './lib/store';
import { Navbar } from './components/Navbar';
import { Transport } from './components/Transport';
import { AnimatePresence, motion } from 'motion/react';
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
import { subscribeToProject, updateProjectCloud, uploadAssetCloud, downloadAssetCloud, isGitHubPagesBuild, isDemoProject, getProjectCloud } from './lib/syncUtils';
import { saveAsset, getAsset, saveLocalProjectState, getLocalProjectState } from './lib/assetManager';

import { WebGLBackground } from './components/WebGLBackground';
import { LiquidGlassPanel } from './components/LiquidGlass';
import { detectBPMOffline } from './lib/essentiaBPM';
import { Cloud, Loader2 } from 'lucide-react';
import { VideoSyncPanel } from './components/VideoSyncPanel';
import { VstBridgeEditor } from './components/VstBridgeEditor';
import { SidechainEditor } from './components/SidechainEditor';



// We extract the inner content to use the useApp hook
function AppContent() {
  const { state, dispatch } = useApp();
  const { detectBPM } = useGemini();
  const [syncProgress, setSyncProgress] = useState(0);
  const [deepLinkLoading, setDeepLinkLoading] = useState(false);
  const [deepLinkStatus, setDeepLinkStatus] = useState('');
  const [deepLinkProgress, setDeepLinkProgress] = useState(0);

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
        // Intercept deep link first (e.g. ?project=PROJECT_ID)
        const params = new URLSearchParams(window.location.search);
        const urlProjectId = params.get('project');
        
        if (urlProjectId) {
          console.log(`Deep Link Startup: Found project ID ${urlProjectId} in URL`);
          
          // Clear query parameters from URL so they don't stay on refresh or contaminate the history
          const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
          window.history.replaceState({ path: cleanUrl }, '', cleanUrl);

          try {
            // Show loading overlay
            setDeepLinkLoading(true);
            setDeepLinkStatus('Fetching shared project...');
            setDeepLinkProgress(5);

            // Attempt to load project metadata from the cloud
            const projectData = await getProjectCloud(urlProjectId);
            if (projectData) {
              console.log('Deep Link Startup: Successfully retrieved project from cloud. Restoring...', projectData);
              setDeepLinkProgress(15);
              setDeepLinkStatus('Analyzing required assets...');

              // Identify all required asset IDs from the project data
              const assetIds = new Set<string>();
              const tracks = (projectData as any).tracks || [];
              for (const track of tracks) {
                track.clips?.forEach((c: any) => {
                  if (c) assetIds.add(c.bufferId || c.id);
                });
                track.lanes?.forEach((l: any) => l.clips?.forEach((c: any) => {
                  if (c) assetIds.add(c.bufferId || c.id);
                }));
                if (track.isFrozen && track.frozenBufferId) {
                  assetIds.add(track.frozenBufferId);
                }
              }
              const assetIdsArray = Array.from(assetIds);

              // Identify missing assets
              const missingAssetIds: string[] = [];
              for (const id of assetIdsArray) {
                const cached = await getAsset(id);
                if (!cached) {
                  missingAssetIds.push(id);
                }
              }

              console.log(`Deep Link: Required assets = ${assetIdsArray.length}, Missing locally = ${missingAssetIds.length}`);

              if (missingAssetIds.length === 0) {
                setDeepLinkStatus('All assets cached locally. Decoding audio...');
                setDeepLinkProgress(15);
              } else {
                setDeepLinkStatus(`Downloading ${missingAssetIds.length} asset${missingAssetIds.length > 1 ? 's' : ''} from cloud...`);
                setDeepLinkProgress(20);

                let downloadedCount = 0;
                for (const id of missingAssetIds) {
                  try {
                    const asset = await downloadAssetCloud(id);
                    if (asset) {
                      await saveAsset(id, asset);
                      downloadedCount++;
                      const progress = 20 + Math.round((downloadedCount / missingAssetIds.length) * 45);
                      setDeepLinkProgress(progress);
                      setDeepLinkStatus(`Downloaded ${downloadedCount} of ${missingAssetIds.length} assets...`);
                    } else {
                      console.warn(`Deep Link: Asset ${id} not found in cloud storage`);
                    }
                  } catch (assetErr) {
                    console.error(`Deep Link: Error downloading asset ${id}`, assetErr);
                  }
                }
              }

              // Phase 2: Decode ALL assets into the audio engine before loading the project
              // This ensures waveforms are fully rendered the moment the overlay dismisses.
              if (assetIdsArray.length > 0) {
                setDeepLinkStatus(`Decoding ${assetIdsArray.length} audio file${assetIdsArray.length !== 1 ? 's' : ''}...`);
                let decodedCount = 0;
                for (const id of assetIdsArray) {
                  if (!audioEngine.buffers.has(id)) {
                    try {
                      const asset = await getAsset(id);
                      if (asset) {
                        await audioEngine.loadAudio(id, asset as File);
                      }
                    } catch (decodeErr) {
                      console.error(`Deep Link: Error decoding asset ${id}`, decodeErr);
                    }
                  }
                  decodedCount++;
                  const decodeProgress = 65 + Math.round((decodedCount / assetIdsArray.length) * 30);
                  setDeepLinkProgress(decodeProgress);
                }
              }

              setDeepLinkStatus('Opening project...');
              setDeepLinkProgress(100);
              await new Promise(r => setTimeout(r, 500));

              dispatch({ type: 'SET_PROJECT_ID', payload: urlProjectId });
              dispatch({ type: 'SYNC_STATE', payload: projectData });
              dispatch({ type: 'SET_HAS_MANUALLY_SAVED', payload: true });
              dispatch({ type: 'INCREMENT_BUFFERS_VERSION' });
              localStorage.setItem('jaad_last_active_project_id', urlProjectId);

              setDeepLinkLoading(false);
              setDeepLinkProgress(0);
              return; // Successfully loaded shared project, skip restoring last local project!
            } else {
              console.warn(`Deep Link Startup: Shared project ID ${urlProjectId} was not found in Firestore.`);
              alert("The shared project you tried to open was not found or is no longer available.");
            }
          } catch (cloudErr) {
            console.error('Deep Link Startup: Error fetching shared project from cloud:', cloudErr);
            alert("An error occurred while loading the shared project. Check your internet connection.");
          } finally {
            setDeepLinkLoading(false);
            setDeepLinkProgress(0);
          }
        }

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
        track.clips?.forEach(c => {
          if (c) assetIds.add(c.bufferId || c.id);
        });
        
        // 2. Clips in lanes (recordings)
        track.lanes?.forEach(lane => {
          lane.clips?.forEach(c => {
            if (c) assetIds.add(c.bufferId || c.id);
          });
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
        {state.videoPanelOpen && <VideoSyncPanel />}
        {state.vstEditorTrackId && <VstBridgeEditor />}
        {state.sidechainEditorTrackId && <SidechainEditor />}

        {/* Deep link loading overlay */}
        <AnimatePresence>
          {deepLinkLoading && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[20000] flex items-center justify-center bg-black/60 backdrop-blur-md"
            >
              <div className="w-full max-w-md px-6">
                <LiquidGlassPanel
                  cornerRadius={24}
                  blurAmount={40}
                  backgroundOpacity={0.2}
                  className="shadow-2xl border border-white/10"
                  contentClassName="p-8 flex flex-col items-center text-center space-y-6"
                >
                  <div className="relative">
                    <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full animate-pulse" />
                    <div className="relative bg-zinc-900/50 p-4 rounded-2xl border border-white/10">
                      <Cloud size={48} className="text-primary animate-bounce" />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <h2 className="text-2xl font-bold tracking-tight text-white">Loading Shared Project</h2>
                    <p className="text-zinc-400 text-sm">{deepLinkStatus}</p>
                  </div>

                  <div className="w-full space-y-3">
                    <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                      <span>{deepLinkProgress < 75 ? 'Downloading' : 'Preparing Project'}</span>
                      <span className="text-primary">{deepLinkProgress}%</span>
                    </div>

                    <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden border border-white/5 p-0.5">
                      <div
                        className="h-full bg-gradient-to-r from-primary to-primary/60 rounded-full transition-all duration-300 ease-out shadow-[0_0_10px_rgba(255,45,85,0.4)]"
                        style={{ width: `${deepLinkProgress}%` }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-zinc-500 text-xs font-medium">
                    <Loader2 size={14} className="animate-spin text-primary" />
                    <span>Please do not close this tab...</span>
                  </div>
                </LiquidGlassPanel>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
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

