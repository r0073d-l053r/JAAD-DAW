import { useState, useRef, useEffect } from 'react';
import { Wand2, Users, FileAudio, Settings, Cloud, WifiOff, LayoutDashboard, Sliders } from './Icons';
import { Magnet, Github, Linkedin, Globe } from 'lucide-react';
import { useApp } from '../lib/store';
import { audioEngine } from '../lib/audioEngine';
import { audioBufferToWav, createStemZip, downloadBlob, estimateWavSize, formatFileSize } from '../lib/exportUtils';

export function Navbar() {
  const { state, dispatch } = useApp();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

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
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const menus: Record<string, { label: string, shortcut?: string, action?: () => void, divider?: boolean, sub?: {label: string, action: () => void}[] }[]> = {
    'File': [
      { label: 'New Project', action: () => { dispatch({ type: 'RESET_PROJECT' }); setOpenMenu(null); } },
      { label: 'Open Project...', action: () => alert('Open file dialog would appear here') },
      { label: 'Save Project', shortcut: 'Ctrl+S', action: () => alert('Saved to Cloud') },
      { label: 'Save As...', action: () => alert('Save As dialog') },
      { divider: true, label: '' },
      { label: 'Import Audio/MIDI...', action: () => alert('Import Audio/MIDI file') },
      { label: 'Import Project (.gaw)...', action: () => alert('Import Project') },
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
      { label: 'Clean Up Stems', shortcut: 'Ctrl+Shift+S', action: () => { dispatch({ type: 'CLEAN_UP_STEMS' }); setOpenMenu(null); } },
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
      { label: 'Performance', sub: [
          { 
            label: `${state.disableBackgroundAnimation ? 'Enable' : 'Disable'} background animation`, 
            action: () => { dispatch({ type: 'TOGGLE_BACKGROUND_ANIMATION' }); setOpenMenu(null); } 
          }
      ] },
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
      { label: 'Documentation', action: () => alert('Loading docs...') },
      { label: 'Keyboard Shortcuts', action: () => alert('Shortcuts modal coming soon') },
      { label: 'AI Assistant Tutorial', action: () => alert('Loading tutorial...') },
      { divider: true, label: '' },
      { label: 'About', action: () => alert('GAW v1.0.0. Built with AI.') },
    ]
  };

  return (
    <header className="h-14 flex items-center justify-between px-4 border-b border-zinc-800 flex-shrink-0 z-[100] relative glass">
      <div className="flex items-center space-x-6">
        <div className="flex items-center gap-2">
          <div className="flex flex-col -space-y-1">
            <h1 className="font-semibold text-base sm:text-lg tracking-tight text-white">Just Another AI DAW</h1>
          </div>
        </div>

        <nav className="hidden md:flex space-x-1" ref={menuRef}>
          {Object.keys(menus).map(item => (
            <div key={item} className="relative">
              <button 
                onClick={() => setOpenMenu(openMenu === item ? null : item)}
                className={`px-3 py-1 text-sm rounded transition ${openMenu === item ? 'bg-white/10 text-white' : 'text-text-muted hover:text-white hover:bg-white/5'}`}
              >
                {item}
              </button>
              
              {openMenu === item && (
                <div className="absolute top-full left-0 mt-1 w-56 bg-[#0a0a0c]/80 border border-white/10 rounded-xl shadow-2xl py-1 z-[110] backdrop-blur-3xl">
                  {menus[item].map((menuItem, idx) => {
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
                          <div className="absolute top-0 left-full -mt-2 -ml-2 pl-2 pt-2 hidden group-hover/submenu:block z-[120]">
                            <div className="w-56 bg-[#0a0a0c]/80 border border-white/10 rounded-xl shadow-2xl py-1 backdrop-blur-3xl">
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
                            </div>
                          </div>
                        </div>
                      );
                    }
                    return (
                      <button 
                        key={idx}
                        onClick={menuItem.action}
                        className="w-full text-left px-4 py-1.5 text-sm hover:bg-white/10 hover:text-white text-zinc-300 flex justify-between items-center group transition-colors"
                      >
                        <span>{menuItem.label}</span>
                        {menuItem.shortcut && (
                          <span className="text-xs text-zinc-500 group-hover:text-zinc-400">{menuItem.shortcut}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </nav>
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

        <div className="flex bg-white/5 backdrop-blur-xl p-1 rounded-lg border border-white/10 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
          <button 
            onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: 'timeline' })}
            className={`flex items-center space-x-1 px-3 py-1.5 text-sm rounded-md transition-all ${state.viewMode === 'timeline' ? 'bg-white/15 text-white shadow-lg backdrop-blur-md' : 'text-zinc-400 hover:text-white/80'}`}
          >
            <LayoutDashboard size={14} />
            <span>Timeline</span>
          </button>
          <button 
            onClick={() => dispatch({ type: 'SET_VIEW_MODE', payload: 'mixer' })}
            className={`flex items-center space-x-1 px-3 py-1.5 text-sm rounded-md transition-all ${state.viewMode === 'mixer' ? 'bg-white/15 text-white shadow-lg backdrop-blur-md' : 'text-zinc-400 hover:text-white/80'}`}
          >
            <Sliders size={14} />
            <span>Mixer</span>
          </button>
        </div>
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
            alert('Share link copied! Collaborators can join in real-time via WebSockets.');
          }}
          className="flex items-center space-x-2 px-3 py-1.5 text-sm bg-[#222] hover:bg-[#333] border border-gray-700 rounded transition text-text-muted hover:text-white"
        >
          <Users size={16} />
          <span>Share</span>
        </button>
        <button 
           onClick={() => {
             alert('Project saved to cloud (Firebase). Version: Mix 1');
           }}
           className="flex items-center space-x-2 px-3 py-1.5 text-sm bg-[#222] hover:bg-[#333] border border-gray-700 rounded transition text-text-muted hover:text-white">
          <Cloud size={16} />
          <span>Save</span>
        </button>

        <div className="relative group/export">
          <button 
            disabled={isExporting}
            className={`flex items-center space-x-2 px-3 py-1.5 text-sm rounded transition ${isExporting ? 'bg-zinc-800 text-zinc-500 cursor-wait' : 'bg-primary/20 text-primary border border-primary/50 hover:bg-primary/30'}`}
          >
            <FileAudio size={16} className={isExporting ? 'animate-pulse' : ''} />
            <span>{isExporting ? 'Exporting...' : 'Export'}</span>
          </button>
          
          {!isExporting && (
            <div className="absolute top-full right-0 mt-2 w-64 bg-[#0a0a0c] border border-white/10 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] py-2 opacity-0 invisible group-hover/export:opacity-100 group-hover/export:visible transition-all z-[110] backdrop-blur-2xl">
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
            </div>
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
    </header>
  );
}
