import { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Wand2, Users, FileAudio, Settings, Cloud, WifiOff, LayoutDashboard, Sliders } from './Icons';
import { Magnet, Github, Linkedin, Globe } from 'lucide-react';
import { useApp } from '../lib/store';
import { audioEngine } from '../lib/audioEngine';
import { audioBufferToWav, createStemZip, downloadBlob, estimateWavSize, formatFileSize } from '../lib/exportUtils';
import { cleanUpStemsAsync } from '../lib/audioUtils';
import { updateProjectCloud, uploadAssetCloud, uploadProjectBundleCloud } from '../lib/syncUtils';
import { saveAsset, getAsset } from '../lib/assetManager';
import JSZip from 'jszip';
import { LiquidGlassPanel } from './LiquidGlass';
import { DocumentationModal } from './DocumentationModal';
import { ShortcutsModal } from './ShortcutsModal';
import { AboutModal } from './AboutModal';
import { LearnModal } from './LearnModal';

export function Navbar({ setSyncProgress }: { setSyncProgress: (p: number) => void }) {
  const { state, dispatch } = useApp();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [syncError, setSyncError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [menuPos, setMenuPos] = useState<{left: number; top: number} | null>(null);
  const [isDocOpen, setIsDocOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [isLearnOpen, setIsLearnOpen] = useState(false);

  // Recalculate dropdown position when menu opens
  useEffect(() => {
    if (openMenu && buttonRefs.current[openMenu]) {
      const rect = buttonRefs.current[openMenu]!.getBoundingClientRect();
      setMenuPos({ left: rect.left, top: rect.bottom + 4 });
    } else {
      setMenuPos(null);
    }
  }, [openMenu]);

  const getProjectDuration = () => {
    let maxEnd = 30; // Min 30 seconds
    state.tracks.forEach(t => {
      t.clips.forEach(c => {
        maxEnd = Math.max(maxEnd, c.start + c.duration);
      });
    });
    return maxEnd + 2; // Extra 2 seconds tail
  };

  const handleExportWav = async () => {
    setIsExporting(true);
    try {
      const duration = getProjectDuration();
      const buffer = await audioEngine.renderMixdown(state.tracks, duration);
      const blob = audioBufferToWav(buffer);
      downloadBlob(blob, 'project_mixdown.wav');
    } catch (error) {
      console.error('Export failed:', error);
      alert('Export failed. Check console for details.');
    } finally {
      setIsExporting(false);
    }
  };

  const handleSaveToCloud = async (isNew: boolean = false) => {
    let targetId = state.projectId;
    let targetName = state.projectName;

    // Prompt for name if it's the first save and name is default
    if ((!state.hasManuallySaved || isNew) && state.isDefaultName) {
       const newName = prompt('Enter a name for your project:', state.projectName);
       if (newName === null) return; // User cancelled
       if (newName) {
          targetName = newName;
          dispatch({ type: 'SET_PROJECT_NAME', payload: newName });
       }
    }

    if (isNew || targetId === '') {
      targetId = 'p_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
      dispatch({ type: 'SET_PROJECT_ID', payload: targetId });
    }

    dispatch({ type: 'SET_HAS_MANUALLY_SAVED', payload: true });
    dispatch({ type: 'SET_SYNCING', payload: true });
    setSyncError(null);

    // Reset progress for the new blocking UI
    setUploadProgress(1);
    setSyncProgress(1);

    const MAX_RETRIES = 3;

    try {
      // 1. Pack project state and audio assets into a JSZip bundle
      const zip = new JSZip();
      
      const projectState = {
        projectName: targetName,
        tracks: state.tracks,
        bpm: state.bpm,
        originalBpm: state.originalBpm,
        masterVolume: state.masterVolume,
        exportVersion: "2.0 (Bundle)"
      };
      zip.file("project.json", JSON.stringify(projectState, null, 2));
      
      const assetsFolder = zip.folder("assets");
      if (assetsFolder) {
        const savedAssetIds = new Set<string>();
        let missingAssets = 0;
        
        for (const track of state.tracks) {
          const assetIds = new Set<string>();
          track.clips.forEach(c => assetIds.add(c.bufferId || c.id));
          track.lanes?.forEach(l => l.clips.forEach(c => assetIds.add(c.bufferId || c.id)));
          if (track.isFrozen && track.frozenBufferId) {
            assetIds.add(track.frozenBufferId);
          }

          for (const id of assetIds) {
            if (savedAssetIds.has(id)) continue;
            const asset = await getAsset(id);
            if (asset) {
              assetsFolder.file(`${id}.audio`, asset);
              savedAssetIds.add(id);
            } else {
              missingAssets++;
              console.warn(`Missing asset during cloud save zip packing: ${id}`);
            }
          }
        }
      }

      console.log("Generating unified .jaad zip bundle for Cloud Save...");
      const zipBlob = await zip.generateAsync({ type: "blob" });

      // 2. Upload zip bundle with exponential backoff and progress callbacks
      let success = false;
      let attempts = 0;
      
      while (!success && attempts < MAX_RETRIES) {
        try {
          await uploadProjectBundleCloud(targetId, zipBlob, (progress) => {
            // Keep progress between 1 and 98 to reserve space for final metadata save
            const mappedProgress = Math.max(1, Math.min(98, Math.round(progress)));
            setUploadProgress(mappedProgress);
            setSyncProgress(mappedProgress);
          });
          success = true;
        } catch (e) {
          attempts++;
          console.error(`Failed to upload project bundle ${targetId} (Attempt ${attempts}):`, e);
          if (attempts >= MAX_RETRIES) {
            throw new Error(`Cannot upload project bundle at this time after ${MAX_RETRIES} attempts.`);
          }
          await new Promise(r => setTimeout(r, 1000 * attempts));
        }
      }

      // 3. Final metadata update in Firestore with hasBundle: true
      setUploadProgress(99);
      setSyncProgress(99); 
      await updateProjectCloud(targetId, targetName, state.tracks, state.bpm, state.originalBpm, state.masterVolume, true);

      setUploadProgress(100);
      setSyncProgress(100); 

      // Artificial delay to let the user see the "Complete" state
      await new Promise(r => setTimeout(r, 800));

    } catch (err: any) {
      console.error('Cloud Save Failed:', err);
      setSyncError(err.message || 'Failed to save project to cloud. Check your connection.');
      return; 
    } finally {
      if (!syncError) {
        dispatch({ type: 'SET_SYNCING', payload: false });
        setUploadProgress(0);
      }
    }
  };

  useEffect(() => {
    if (!state.isSyncing) {
      setUploadProgress(0);
    }
  }, [state.isSyncing]);

  const handleSaveToDesktop = async () => {
    const zip = new JSZip();
    
    // 1. Project State
    const projectState = {
      projectName: state.projectName,
      tracks: state.tracks,
      bpm: state.bpm,
      originalBpm: state.originalBpm,
      masterVolume: state.masterVolume,
      exportVersion: "2.0 (Bundle)"
    };
    zip.file("project.json", JSON.stringify(projectState, null, 2));
    
    // 2. Audio Assets
    const assetsFolder = zip.folder("assets");
    if (assetsFolder) {
      const savedAssetIds = new Set<string>();
      let missingAssets = 0;
      
      for (const track of state.tracks) {
        // Collect all clip IDs (main list + lanes)
        const assetIds = new Set<string>();
        track.clips.forEach(c => assetIds.add(c.bufferId || c.id));
        track.lanes?.forEach(l => l.clips.forEach(c => assetIds.add(c.bufferId || c.id)));
        
        // Add frozen buffer if applicable
        if (track.isFrozen && track.frozenBufferId) {
          assetIds.add(track.frozenBufferId);
        }

        for (const id of assetIds) {
          if (savedAssetIds.has(id)) continue;
          const asset = await getAsset(id);
          if (asset) {
            assetsFolder.file(`${id}.audio`, asset);
            savedAssetIds.add(id);
          } else {
            missingAssets++;
            console.warn(`Missing asset: ${id}`);
          }
        }
      }

      if (missingAssets > 0) {
        console.warn(`Saving .jaad bundle with ${missingAssets} missing audio files.`);
      }
    }
    
    console.log("Generating .jaad bundle...");
    const content = await zip.generateAsync({ type: "blob" });
    downloadBlob(content, `${state.projectName.replace(/\s+/g, '_')}.jaad`);
    console.log("Download triggered.");
  };

  const handleImportProject = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.jaad';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (!file) return;

      const zip = await JSZip.loadAsync(file);
      const projectJson = await zip.file("project.json")?.async("string");
      if (!projectJson) {
        alert("Invalid .jaad file: project.json missing");
        return;
      }
      
      const parsed = JSON.parse(projectJson);
      
      // Extract assets
      const assetsFolder = zip.folder("assets");
      if (assetsFolder) {
        const promises: Promise<void>[] = [];
        assetsFolder.forEach((relativePath, file) => {
          if (relativePath.endsWith(".audio")) {
            const id = relativePath.replace(".audio", "");
            promises.push((async () => {
              const blob = await file.async("blob");
              await saveAsset(id, blob);
            })());
          }
        });
        await Promise.all(promises);
      }
      
      dispatch({ type: 'SYNC_STATE', payload: parsed });
      dispatch({ type: 'SET_HAS_MANUALLY_SAVED', payload: true });
      dispatch({ type: 'INCREMENT_BUFFERS_VERSION' });
      alert("Project imported successfully!");
    };
    input.click();
  };

  const handleExportStems = async () => {
    setIsExporting(true);
    try {
      const duration = getProjectDuration();
      const trackBuffers = await Promise.all(
        state.tracks.map(async (t) => ({
          name: t.name || 'Track',
          buffer: await audioEngine.renderTrack(t, duration)
        }))
      );
      const zipBlob = await createStemZip(trackBuffers);
      downloadBlob(zipBlob, 'project_stems.zip');
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsExporting(false);
    }
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      // Don't close if clicking inside the navbar menu buttons
      if (menuRef.current && menuRef.current.contains(target)) return;
      // Don't close if clicking inside a portaled dropdown (z-[9999])
      const portalEl = document.querySelector('.fixed.z-\\[9999\\]');
      if (portalEl && portalEl.contains(target)) return;
      // Don't close if clicking the export button
      if (buttonRefs.current['__export__'] && buttonRefs.current['__export__']!.contains(target)) return;
      setOpenMenu(null);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const menus: Record<string, { 
    label: string, 
    shortcut?: string, 
    action?: () => void, 
    divider?: boolean, 
    disabled?: boolean,
    title?: string,
    sub?: {label: string, action: () => void}[] 
  }[]> = {
    'File': [
      { label: 'New Project', action: () => { localStorage.removeItem('jaad_last_active_project_id'); dispatch({ type: 'RESET_PROJECT' }); setOpenMenu(null); } },
      { label: 'Manage Projects...', action: () => { dispatch({ type: 'TOGGLE_PROJECT_BROWSER' }); setOpenMenu(null); } },
      { label: 'Save Project', shortcut: 'Ctrl+S', action: () => { 
        handleSaveToCloud(false);
        setOpenMenu(null);
      }},
      { label: 'Save to Cloud (Copy)', action: () => { 
        handleSaveToCloud(true);
        setOpenMenu(null);
      }},
      { label: 'Save to Desktop (.jaad)', action: () => { 
        handleSaveToDesktop();
        setOpenMenu(null);
      }},
      { divider: true, label: '' },
      { label: 'Import Project (.jaad)...', action: () => handleImportProject() },
      { divider: true, label: '' },
      { label: 'Export .WAV Mixdown...', action: () => handleExportWav() },
      { label: 'Export Multitrack (ZIP)...', action: () => handleExportStems() },
      { label: 'Export to Media Library', action: () => alert('Coming soon to J.A.A.S.!') },
      { divider: true, label: '' },
      { label: 'Exit', action: () => alert('Close app warning') },
    ],
    'Edit': [
      { label: 'Undo', shortcut: 'Ctrl+Z', action: () => { dispatch({ type: 'UNDO' }); setOpenMenu(null); } },
      { label: 'Redo', shortcut: 'Ctrl+Y', action: () => { dispatch({ type: 'REDO' }); setOpenMenu(null); } },
      { divider: true, label: '' },
      { label: 'Cut', shortcut: 'Ctrl+X', action: () => { dispatch({ type: 'CUT_CLIPS' }); setOpenMenu(null); } },
      { label: 'Copy', shortcut: 'Ctrl+C', action: () => { dispatch({ type: 'COPY_CLIPS' }); setOpenMenu(null); } },
      { label: 'Paste', shortcut: 'Ctrl+V', action: () => { dispatch({ type: 'PASTE_CLIPS', payload: { trackId: state.tracks[0]?.id || '1', time: state.currentTime } }); setOpenMenu(null); } },
      { label: 'Delete', shortcut: 'Del', action: () => { dispatch({ type: 'DELETE_CLIPS' }); setOpenMenu(null); } },
      { divider: true, label: '' },
      { label: 'Select All', shortcut: 'Ctrl+A', action: () => { dispatch({ type: 'SELECT_ALL_CLIPS' }); setOpenMenu(null); } },
      { label: 'Split Clip', shortcut: 'S', action: () => { dispatch({ type: 'SPLIT_CLIP' }); setOpenMenu(null); } },
      { label: 'Heal Edits', action: () => { alert("Healing edits..."); setOpenMenu(null); } },
      { label: 'Cleanup Stems', shortcut: 'Ctrl+Shift+S', action: () => { cleanUpStemsAsync(state, dispatch); setOpenMenu(null); } },
      { divider: true, label: '' },
      { label: 'Toggle Snap', action: () => { dispatch({ type: 'TOGGLE_SNAP' }); setOpenMenu(null); } },
      { label: 'Toggle Warp Mode', action: () => { alert("Warp mode enabled (adjust timing visually)."); setOpenMenu(null); } },
    ],
    'Track': [
      { label: 'Add Audio Track', action: () => { 
        dispatch({ type: 'ADD_TRACK', payload: { id: Date.now().toString(), name: 'Audio Track', volume: 0.8, pan: 0, muted: false, solo: false, color: '#3b82f6', clips: [] } }); 
        setOpenMenu(null); 
      }},
      { label: 'Add MIDI Track', action: () => { 
        dispatch({ type: 'ADD_TRACK', payload: { id: Date.now().toString(), name: 'MIDI Track', volume: 0.8, pan: 0, muted: false, solo: false, color: '#10b981', clips: [] } }); 
        setOpenMenu(null); 
      }},
      { divider: true, label: '' },
      { label: 'Duplicate Selected Track', action: () => { 
        alert('Select track feature needed to delete/duplicate');
        setOpenMenu(null); 
      }},
      { label: 'Delete Selected Track', action: () => { 
        alert('Select track feature needed to delete/duplicate');
        setOpenMenu(null); 
      }},
      { divider: true, label: '' },
      { label: 'Rename Track', action: () => alert('Select a track to rename via its header') },
      { label: 'Track Color', action: () => alert('Select a track to change color via its header') },
    ],
    'View': [
      { label: 'Toggle Mixer', shortcut: 'Tab', action: () => { dispatch({ type: 'SET_VIEW_MODE', payload: state.viewMode === 'timeline' ? 'mixer' : 'timeline' }); setOpenMenu(null); } },
      { label: 'Toggle Copilot', action: () => { dispatch({ type: 'TOGGLE_AI_PANEL' }); setOpenMenu(null); } },
      { divider: true, label: '' },
      { label: 'Zoom In', shortcut: 'Ctrl++', action: () => { dispatch({ type: 'SET_ZOOM', payload: state.zoomLevel * 1.2 }); setOpenMenu(null); } },
      { label: 'Zoom Out', shortcut: 'Ctrl+-', action: () => { dispatch({ type: 'SET_ZOOM', payload: state.zoomLevel / 1.2 }); setOpenMenu(null); } },
      { label: 'Fit to Screen', action: () => { dispatch({ type: 'SET_ZOOM', payload: 20 }); setOpenMenu(null); } },
      { divider: true, label: '' },
      { label: 'Show/Hide Automation Lanes', action: () => alert('Automation lanes visibility toggled') },
      { label: 'Toggle Fullscreen', shortcut: 'F11', action: () => {
         if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
         } else if (document.exitFullscreen) {
            document.exitFullscreen();
         }
         setOpenMenu(null);
      } },
    ],
    'Help': [
      { label: 'Learn J.A.A.D. (Wiki)', action: () => { setIsLearnOpen(true); setOpenMenu(null); } },
      { label: 'Documentation', action: () => { setIsDocOpen(true); setOpenMenu(null); } },
      { label: 'Keyboard Shortcuts', action: () => { setIsShortcutsOpen(true); setOpenMenu(null); } },
      { divider: true, label: '' },
      { label: 'About', action: () => { setIsAboutOpen(true); setOpenMenu(null); } },
    ]
  };

  return (
    <header className="h-14 flex items-center justify-between px-4 border-b border-zinc-800 flex-shrink-0 z-[100] relative glass">
      <div className="flex items-center space-x-6">
        <div className="flex items-center gap-2">
        <div className="flex flex-col">
          <div className="flex items-center gap-3">
            <input 
              type="text" 
              value={state.projectName} 
              onChange={(e) => dispatch({ type: 'SET_PROJECT_NAME', payload: e.target.value })}
              className="bg-transparent border-none text-white font-bold text-lg focus:ring-0 p-0 hover:bg-white/5 transition-colors rounded px-1 -ml-1 outline-none"
              placeholder="Untitled Project"
            />
            {state.isProcessing && (
              <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-primary/20 border border-primary/30 text-[10px] text-primary animate-pulse font-bold tracking-widest uppercase">
                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-ping" />
                Processing
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2 text-[10px] text-zinc-500 uppercase tracking-widest font-bold">
            <span className="text-primary/80">JAAD - JUST ANOTHER AI DAW</span>
            <span>•</span>
            <span className="font-mono opacity-60">{state.projectId}</span>
          </div>
        </div>
        </div>

        <nav className="hidden md:flex space-x-1" ref={menuRef}>
          {Object.keys(menus).map(item => (
            <div key={item} className="relative">
              <button 
                ref={el => { buttonRefs.current[item] = el; }}
                onClick={() => setOpenMenu(openMenu === item ? null : item)}
                className={`px-3 py-1 text-sm rounded transition ${openMenu === item ? 'bg-white/10 text-white' : 'text-text-muted hover:text-white hover:bg-white/5'}`}
              >
                {item}
              </button>
            </div>
          ))}
        </nav>

        {/* Portal-rendered dropdown menus — rendered outside navbar so backdrop-filter sees real page content */}
        {openMenu && menus[openMenu] && menuPos && createPortal(
          <div
            className="fixed z-[9999] w-56"
            style={{ left: menuPos.left, top: menuPos.top }}
          >
            <LiquidGlassPanel cornerRadius={12} blurAmount={32} backgroundOpacity={0.18} contentClassName="py-1">
              {menus[openMenu].map((menuItem, idx) => {
                if (menuItem.divider) return <div key={idx} className="h-px bg-white/10 my-1" />;
                if (menuItem.sub && menuItem.sub.length > 0) {
                  return (
                    <div key={idx} className="relative group/submenu w-full">
                      <button 
                        className="w-full text-left px-4 py-1.5 text-sm hover:bg-white/10 hover:text-white text-zinc-300 flex justify-between items-center transition-colors cursor-default"
                      >
                        <span>{menuItem.label}</span>
                        <span className="text-xs text-zinc-500">▶</span>
                      </button>
                      <div className="absolute top-0 left-full -mt-2 -ml-2 pl-2 pt-2 hidden group-hover/submenu:block z-[10000]">
                        <div className="w-56 pointer-events-auto">
                          <LiquidGlassPanel cornerRadius={12} blurAmount={32} backgroundOpacity={0.18} contentClassName="py-1">
                            {menuItem.sub.map((subItem, sIdx) => (
                              <button 
                                key={sIdx}
                                onClick={() => {
                                  subItem.action();
                                  setOpenMenu(null);
                                }}
                                className="w-full text-left px-4 py-1.5 text-sm hover:bg-white/10 hover:text-white text-zinc-300 flex justify-between items-center transition-colors"
                              >
                                <span>{subItem.label}</span>
                              </button>
                            ))}
                          </LiquidGlassPanel>
                        </div>
                      </div>
                    </div>
                  );
                }
                return (
                  <button 
                    key={idx}
                    onClick={menuItem.disabled ? undefined : menuItem.action}
                    disabled={menuItem.disabled}
                    title={menuItem.title}
                    className={`w-full text-left px-4 py-1.5 text-sm transition-colors flex justify-between items-center group ${menuItem.disabled ? 'text-zinc-600 cursor-not-allowed' : 'hover:bg-white/10 hover:text-white text-zinc-300'}`}
                  >
                    <span>{menuItem.label}</span>
                    {menuItem.shortcut && (
                      <span className={`text-xs group-hover:text-zinc-400 ${menuItem.disabled ? 'text-zinc-700' : 'text-zinc-500'}`}>{menuItem.shortcut}</span>
                    )}
                  </button>
                );
              })}
            </LiquidGlassPanel>
          </div>,
          document.body
        )}
      </div>
      
      {/* View Mode Toggle and Snap */}
      <div className="absolute left-1/2 -translate-x-1/2 flex items-center space-x-3">
        <button
          onClick={() => dispatch({ type: 'TOGGLE_SNAP' })}
          className={`flex items-center justify-center p-2 rounded-lg transition-all border ${state.snapToGrid ? 'bg-primary/20 text-primary border-primary/50 shadow-[0_0_15px_rgba(255,45,85,0.3)]' : 'bg-white/5 text-zinc-400 border-white/10 hover:text-white/80 hover:bg-white/10'}`}
          title="Snap to Grid"
        >
          <Magnet size={16} />
        </button>

        <LiquidGlassPanel cornerRadius={8} blurAmount={28} backgroundOpacity={0.25} contentClassName="flex p-1">
          <button 
            onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: 'timeline' })}
            className={`flex items-center space-x-1 px-3 py-1.5 text-sm rounded-md transition-all ${state.viewMode === 'timeline' ? 'bg-white/15 text-white shadow-lg' : 'text-zinc-400 hover:text-white/80'}`}
          >
            <LayoutDashboard size={14} />
            <span>Timeline</span>
          </button>
          <button 
            onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: 'mixer' })}
            className={`flex items-center space-x-1 px-3 py-1.5 text-sm rounded-md transition-all ${state.viewMode === 'mixer' ? 'bg-white/15 text-white shadow-lg' : 'text-zinc-400 hover:text-white/80'}`}
          >
            <Sliders size={14} />
            <span>Mixer</span>
          </button>
        </LiquidGlassPanel>
      </div>

      <div className="flex items-center space-x-3">
        {state.isOffline && (
          <div className="flex items-center space-x-1 text-yellow-500 bg-yellow-500/10 px-2 py-1 rounded text-xs font-mono border border-yellow-500/30">
            <WifiOff size={14} />
            <span>OFFLINE</span>
          </div>
        )}
        <button 
          onClick={() => {
            navigator.clipboard.writeText(state.projectId);
            alert(`Project ID copied: ${state.projectId}. Share this with collaborators!`);
          }}
          className="flex items-center space-x-2 px-3 py-1.5 text-sm bg-[#222] hover:bg-[#333] border border-gray-700 rounded transition text-text-muted hover:text-white"
        >
          <Users size={16} />
          <span>Share</span>
        </button>
        <div className="flex items-center space-x-2">
          <button 
              onClick={async () => {
                if (!state.projectId || !state.hasManuallySaved) {
                  await handleSaveToCloud(false);
                } else {
                  dispatch({ type: 'SET_SYNCING', payload: true });
                  try {
                    await updateProjectCloud(state.projectId, state.projectName, state.tracks, state.bpm, state.originalBpm, state.masterVolume);
                  } catch (e) {
                    console.error("Silent background sync failed:", e);
                  } finally {
                    dispatch({ type: 'SET_SYNCING', payload: false });
                  }
                }
              }}
              className={`flex items-center space-x-2 px-3 py-1.5 text-sm border rounded transition ${state.isSyncing ? 'bg-primary/20 text-primary border-primary/50' : 'bg-[#222] hover:bg-[#333] border-gray-700 text-text-muted hover:text-white'}`}>
            <Cloud size={16} className={state.isSyncing ? 'animate-pulse' : ''} />
            <span>{state.isSyncing ? 'Syncing...' : 'Save'}</span>
          </button>
          {uploadProgress > 0 && uploadProgress < 100 && (
            <div className="relative flex items-center justify-center w-32 h-8">
              <div className="absolute w-full h-full bg-gray-800 rounded overflow-hidden">
                <div 
                  className="h-full bg-primary transition-all duration-200 ease-out"
                  style={{ width: `${uploadProgress}%` }}
                />
              </div>
              <span className="relative text-[10px] font-bold text-white">
                {uploadProgress}%
              </span>
            </div>
          )}
        </div>

        <div className="relative">
          <button 
            ref={el => { buttonRefs.current['__export__'] = el; }}
            disabled={isExporting}
            onClick={() => setOpenMenu(openMenu === '__export__' ? null : '__export__')}
            className={`flex items-center space-x-2 px-3 py-1.5 text-sm rounded transition ${isExporting ? 'bg-zinc-800 text-zinc-500 cursor-wait' : 'bg-primary/20 text-primary border border-primary/50 hover:bg-primary/30'}`}
          >
            <FileAudio size={16} className={isExporting ? 'animate-pulse' : ''} />
            <span>{isExporting ? 'Exporting...' : 'Export'}</span>
          </button>
          
          {(!isExporting && openMenu === '__export__' && buttonRefs.current['__export__']) && createPortal(
            <div
              className="fixed z-[9999] w-64"
              style={{
                left: buttonRefs.current['__export__']!.getBoundingClientRect().right - 256,
                top: buttonRefs.current['__export__']!.getBoundingClientRect().bottom + 8,
              }}
            >
              <LiquidGlassPanel cornerRadius={12} blurAmount={32} backgroundOpacity={0.18} contentClassName="py-2">
                  <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500 border-b border-white/5 mb-1">
                Export Options
              </div>
              
              <button 
                onClick={handleExportWav}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 hover:text-white text-zinc-300 transition-colors flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  <div className="flex flex-col">
                    <span>.WAV Mixdown</span>
                    <span className="text-[9px] text-zinc-500 uppercase tracking-tighter">Lossless High Fidelity</span>
                  </div>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[10px] text-blue-400 font-mono">{formatFileSize(estimateWavSize(getProjectDuration()))}</span>
                  <span className="text-[9px] text-zinc-600 font-mono">.wav</span>
                </div>
              </button>

              <button 
                onClick={handleExportStems}
                className="w-full text-left px-4 py-2.5 text-sm hover:bg-white/10 hover:text-white text-zinc-300 transition-colors flex items-center justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500" />
                  <div className="flex flex-col">
                    <span>Stem Package</span>
                    <span className="text-[9px] text-zinc-500 uppercase tracking-tighter">Individual tracks in archives</span>
                  </div>
                </div>
                <div className="flex flex-col items-end">
                  <span className="text-[10px] text-green-400 font-mono">~{formatFileSize(estimateWavSize(getProjectDuration()) * state.tracks.length * 0.7)}</span>
                  <span className="text-[9px] text-zinc-600 font-mono">.zip</span>
                </div>
              </button>

              <div className="h-px bg-white/5 my-2" />
              
              <button 
                disabled
                className="w-full text-left px-4 py-2.5 text-sm text-zinc-600 cursor-not-allowed group/jaas relative"
              >
                <div className="flex items-center gap-3 grayscale">
                  <div className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
                  <span>Export to J.A.A.S. Library</span>
                </div>
                <div className="absolute right-4 top-1/2 -translate-y-1/2 opacity-0 group-hover/jaas:opacity-100 transition-opacity">
                   <span className="text-[8px] bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded border border-white/5">COMING SOON</span>
                </div>
              </button>
              </LiquidGlassPanel>
            </div>,
            document.body
          )}
        </div>
        <div className="flex items-center space-x-1">
          <a href="https://github.com/r0073d-l053r" target="_blank" rel="noopener noreferrer" className="p-2 text-text-muted hover:text-white hover:bg-white/5 rounded transition" title="GitHub">
            <Github size={18} />
          </a>
          <a href="https://www.linkedin.com/in/r0073d-l053r/" target="_blank" rel="noopener noreferrer" className="p-2 text-text-muted hover:text-white hover:bg-white/5 rounded transition" title="LinkedIn">
            <Linkedin size={18} />
          </a>
          <a href="https://www.r0073dl053r.com" target="_blank" rel="noopener noreferrer" className="p-2 text-text-muted hover:text-white hover:bg-white/5 rounded transition" title="Website / Blog">
            <Globe size={18} />
          </a>
        </div>
        <div className="w-px h-6 bg-gray-700 mx-2" />
        <button 
          onClick={() => dispatch({ type: 'TOGGLE_SETTINGS' })}
          className={`p-2 rounded transition ${state.settingsOpen ? 'bg-primary text-black' : 'text-text-muted hover:text-white hover:bg-white/5'}`}
        >
          <Settings size={18} />
        </button>
        <button 
          onClick={() => dispatch({ type: 'TOGGLE_AI_PANEL' })}
          className={`p-2 rounded transition ${state.aiPanelOpen ? 'bg-primary text-black' : 'text-text-muted hover:text-white hover:bg-white/5'}`}
        >
          <Wand2 size={18} />
        </button>
      </div>
      {/* Forced Cloud Sync Progress Popup */}
      {(state.isSyncing || syncError) && createPortal(
        <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-sm animate-in fade-in duration-300">
          <div className="w-[450px]">
            <LiquidGlassPanel 
              cornerRadius={24} 
              blurAmount={40} 
              backgroundOpacity={0.25} 
              contentClassName="p-8 flex flex-col items-center text-center"
              displacementScale={40}
            >
              <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 shadow-2xl ${syncError ? 'bg-red-500/20 text-red-500 border border-red-500/50' : 'bg-primary/20 text-primary border border-primary/50'}`}>
                <Cloud size={32} className={!syncError ? 'animate-pulse' : ''} />
              </div>
              
              <h2 className="text-xl font-black text-white mb-2 uppercase tracking-tight">
                {syncError ? 'Upload Interrupted' : (uploadProgress === 100 ? 'Syncing Metadata...' : 'Cloud Synchronization')}
              </h2>
              
              <p className="text-zinc-400 text-sm mb-8 max-w-[300px]">
                {syncError 
                  ? "We encountered a persistent error while trying to upload your assets." 
                  : "Please wait while we securely upload your project assets to the cloud storage."}
              </p>

              {!syncError ? (
                <div className="w-full space-y-4">
                  <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden border border-white/5 p-[1px]">
                    <div 
                      className="h-full bg-gradient-to-r from-primary/60 to-primary rounded-full transition-all duration-500 ease-out shadow-[0_0_15px_rgba(255,45,85,0.4)]"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  <div className="flex justify-between items-center px-1">
                    <span className="text-[10px] font-bold text-zinc-500 tracking-widest uppercase">Progress</span>
                    <span className="text-lg font-black text-primary font-mono">{uploadProgress}%</span>
                  </div>
                </div>
              ) : (
                <div className="w-full space-y-4">
                  <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-medium leading-relaxed">
                    {syncError}
                  </div>
                  <button 
                    onClick={() => {
                      setSyncError(null);
                      dispatch({ type: 'SET_SYNCING', payload: false });
                    }}
                    className="w-full py-3 rounded-xl bg-white/5 hover:bg-white/10 text-white text-sm font-bold transition-all border border-white/10"
                  >
                    Dismiss & Continue
                  </button>
                </div>
              )}

              {!syncError && (
                 <div className="mt-8 pt-6 border-t border-white/5 w-full">
                    <div className="flex items-center justify-center gap-2 text-[10px] text-zinc-500 font-bold uppercase tracking-[0.2em]">
                       <div className="w-1 h-1 rounded-full bg-green-500 animate-ping" />
                       Encryption Active
                    </div>
                 </div>
              )}
            </LiquidGlassPanel>
          </div>
        </div>,
        document.body
      )}
      <DocumentationModal isOpen={isDocOpen} onClose={() => setIsDocOpen(false)} />
      <ShortcutsModal isOpen={isShortcutsOpen} onClose={() => setIsShortcutsOpen(false)} />
      <AboutModal isOpen={isAboutOpen} onClose={() => setIsAboutOpen(false)} />
      <LearnModal isOpen={isLearnOpen} onClose={() => setIsLearnOpen(false)} />
    </header>
  );
}
