import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useApp, Track, Clip } from '../lib/store';
import { Volume2, Sliders, Timer } from './Icons';
import { MoreHorizontal, Trash2, Download, Scissors, Layers, Wand2, ArrowUp, ChevronDown, ChevronRight, Snowflake } from 'lucide-react';
import { audioEngine } from '../lib/audioEngine';
import { saveAsset } from '../lib/assetManager';
import { uploadAssetCloud } from '../lib/syncUtils';
import { audioBufferToWav } from '../lib/exportUtils';

const EXPANDED_COLORS = [
  '#FF2A5F', '#FF3B30', '#FF9500', '#FFCC00', 
  '#4CD964', '#00E871', '#5AC8FA', '#007AFF', 
  '#5856D6', '#6B44FF', '#AF52DE', '#FF2D55',
  '#A2845E', '#8E8E93', '#1C1C1E', '#FFFFFF'
];

export function TrackList() {
  const { state, dispatch } = useApp();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [selectedLaneIds, setSelectedLaneIds] = useState<string[]>([]);
  const [lastSelectedLaneId, setLastSelectedLaneId] = useState<string | null>(null);

  const handleLaneClick = (trackId: string, laneId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const track = state.tracks.find(t => t.id === trackId);
    if (!track) return;

    if (e.shiftKey && lastSelectedLaneId) {
      // Find track and lanes for range
      const lane1Idx = track.lanes.findIndex(l => l.id === lastSelectedLaneId);
      const lane2Idx = track.lanes.findIndex(l => l.id === laneId);
      if (lane1Idx !== -1 && lane2Idx !== -1) {
        const start = Math.min(lane1Idx, lane2Idx);
        const end = Math.max(lane1Idx, lane2Idx);
        const rangeIds = track.lanes.slice(start, end + 1).map(l => l.id);
        setSelectedLaneIds(Array.from(new Set([...selectedLaneIds, ...rangeIds])));
      }
    } else if (e.metaKey || e.ctrlKey) {
      if (selectedLaneIds.includes(laneId)) {
        setSelectedLaneIds(selectedLaneIds.filter(id => id !== laneId));
      } else {
        setSelectedLaneIds([...selectedLaneIds, laneId]);
      }
      setLastSelectedLaneId(laneId);
    } else {
      setSelectedLaneIds([laneId]);
      setLastSelectedLaneId(laneId);
    }
  };

  const handleDownload = (track: Track) => {
    const clipNames = track.clips.map((c: Clip) => c.audioData || 'audio_clip').join('_');
    const filename = `${track.name}_${clipNames || 'empty'}.wav`;
    const blob = new Blob(['dummy audio data'], { type: 'audio/wav' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    setOpenMenuId(null);
  };

  return (
    <div 
      id="track-list"
      className="w-64 bg-[#0a0a0c] border-r border-white/5 flex flex-col shrink-0 backdrop-blur-xl sticky left-0 z-50 min-h-full" 
      onClick={() => {
        setOpenMenuId(null);
        setSelectedLaneIds([]);
        setLastSelectedLaneId(null);
      }}
    >
      {/* Hide webkit scrollbar via a standard inline hack, but it requires a class, we'll just ignore since thumb is transparent by default anyway */}
      <style>{`#track-list::-webkit-scrollbar { display: none; }`}</style>
      <div className="h-8 border-b border-white/5 flex-shrink-0 bg-[#0a0a0c] z-[60] sticky top-0 flex items-center px-4">
        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.1em]">Tracks</span>
      </div>

      {/* Master Tempo Track */}
      <div className="h-16 shrink-0 border-b border-white/5 flex flex-col p-3 bg-zinc-900/50 relative group transition-colors duration-300">
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary/50 shadow-[0_0_10px_rgba(var(--primary-color-rgb),0.2)]" />
        <div className="flex items-center justify-between pl-2 h-full">
           <span className="bg-transparent text-sm font-bold text-zinc-400 outline-none uppercase tracking-tight flex items-center gap-2">
             <Timer size={14} className="text-primary"/> 
             Master Tempo
           </span>
        </div>
      </div>
      {state.tracks.map((track, idx) => (
        <React.Fragment key={track.id}>
          <div 
            draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', track.id);
            e.dataTransfer.effectAllowed = 'move';
            // slight delay to not trigger end dragging immediately
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            e.currentTarget.classList.add('border-t-2', 'border-t-primary');
          }}
          onDragLeave={(e) => {
            e.currentTarget.classList.remove('border-t-2', 'border-t-primary');
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.currentTarget.classList.remove('border-t-2', 'border-t-primary');
            const sourceId = e.dataTransfer.getData('text/plain');
            if (sourceId && sourceId !== track.id) {
              dispatch({ type: 'REORDER_TRACKS', payload: { sourceId, targetId: track.id } });
            }
          }}
          className="h-28 shrink-0 border-b border-white/5 flex flex-col p-3 bg-white/5 hover:bg-white/10 relative group transition-colors duration-300 cursor-grab active:cursor-grabbing"
        >
          <div className="absolute left-0 top-0 bottom-0 w-1 shadow-[0_0_10px_rgba(255,255,255,0.1)]" style={{ backgroundColor: track.color }} />
          
          <div className="flex items-center justify-between pl-2 pr-2 relative">
            <input 
              type="text" 
              value={track.name} 
              onChange={(e) => dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, changes: { name: e.target.value } } })}
              onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
              draggable
              className="bg-transparent text-sm font-bold text-zinc-100 outline-none w-20 focus:border-b border-primary/50 transition-all uppercase tracking-tight"
            />
            <div className="flex space-x-1 items-center">
              <button 
                onClick={() => dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, changes: { muted: !track.muted } } })}
                className={`w-6 h-6 rounded text-[10px] font-black leading-none flex items-center justify-center transition-all ${track.muted ? "bg-secondary text-white shadow-lg" : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700"}`}
              >
                M
              </button>
              <button 
                onClick={() => dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, changes: { solo: !track.solo } } })}
                className={`w-6 h-6 rounded text-[10px] font-black leading-none flex items-center justify-center transition-all ${track.solo ? "bg-yellow-500 text-black shadow-lg" : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700"}`}
              >
                S
              </button>
              <button 
                onClick={() => dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, changes: { armed: !track.armed } } })}
                className={`w-6 h-6 rounded text-[10px] font-black leading-none flex items-center justify-center transition-all ${track.armed ? "bg-red-600 text-white shadow-lg" : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700"}`}
                title="Record Arm"
              >
                ●
              </button>
              <button 
                onClick={async () => {
                  if (track.isFrozen) {
                    dispatch({ type: 'UNFREEZE_TRACK', payload: track.id });
                  } else {
                    const frozenBuffer = await audioEngine.freezeTrack(track, audioEngine.buffers);
                    const bufferId = `frozen_${track.id}_${Date.now()}`;
                    audioEngine.buffers.set(bufferId, frozenBuffer);

                    // Persist the frozen track to IndexedDB and backup to cloud
                    const wavBlob = audioBufferToWav(frozenBuffer);
                    await saveAsset(bufferId, wavBlob);
                    uploadAssetCloud(bufferId, wavBlob).catch(err => console.error("Cloud upload for frozen track failed", err));

                    dispatch({ type: 'FREEZE_TRACK', payload: { trackId: track.id, bufferId } });
                  }
                }}
                className={`w-6 h-6 rounded flex items-center justify-center transition-all ${track.isFrozen ? "bg-blue-500 text-white shadow-lg" : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-blue-400"}`}
                title={track.isFrozen ? "Unfreeze Track" : "Freeze Track (Save CPU)"}
              >
                <Snowflake size={12} fill={track.isFrozen ? "currentColor" : "none"} />
              </button>
              <div className="relative">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenMenuId(openMenuId === track.id ? null : track.id);
                  }}
                  className="w-6 h-6 rounded flex items-center justify-center text-zinc-500 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <MoreHorizontal size={14} />
                </button>
                
                <AnimatePresence>
                  {openMenuId === track.id && (
                    <motion.div 
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="absolute right-0 top-full mt-1 w-40 bg-[#0a0a0c]/90 border border-white/10 rounded-lg shadow-2xl py-1 z-[120] overflow-hidden backdrop-blur-2xl"
                    >
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDownload(track);
                        }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-white/10 text-zinc-300 flex items-center space-x-2 transition-colors"
                      >
                        <Download size={12} />
                        <span>Download Stem</span>
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          dispatch({ type: 'ADD_LANE', payload: { trackId: track.id } });
                          setOpenMenuId(null);
                        }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-white/10 text-zinc-300 flex items-center space-x-2 transition-colors"
                      >
                        <Layers size={12} />
                        <span>Add Alternate Lane</span>
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          dispatch({ type: 'TOGGLE_LANES', payload: track.id });
                          setOpenMenuId(null);
                        }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-white/10 text-zinc-300 flex items-center space-x-2 transition-colors"
                      >
                        {track.showLanes ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                        <span>{track.showLanes ? "Hide Alternates" : "Show Alternates"}</span>
                      </button>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          alert("Removed background FX from track.");
                          setOpenMenuId(null);
                        }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-white/10 text-zinc-300 flex items-center space-x-2 transition-colors"
                      >
                        <Wand2 size={12} />
                        <span>Remove FX</span>
                      </button>
                      <div className="h-px bg-white/10 my-1" />
                      <div className="px-3 py-2">
                        <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mb-2">Track Color</div>
                        <div className="grid grid-cols-4 gap-1.5">
                          {EXPANDED_COLORS.map(color => (
                            <button
                              key={color}
                              onClick={(e) => {
                                e.stopPropagation();
                                dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, changes: { color } } });
                              }}
                              className={`w-6 h-6 rounded-full border-2 ${track.color === color ? 'border-white scale-110' : 'border-transparent'} hover:scale-110 hover:border-white/50 transition-all shadow-sm`}
                              style={{ backgroundColor: color }}
                              title={color}
                            />
                          ))}
                        </div>
                      </div>
                      <div className="h-px bg-white/10 my-1" />
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          dispatch({ type: 'DELETE_TRACK', payload: track.id });
                          setOpenMenuId(null);
                        }}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-red-500/20 text-red-400 flex items-center space-x-2 transition-colors"
                      >
                        <Trash2 size={12} />
                        <span>Delete Track</span>
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between mt-4 pl-2 pr-1">
            <div className="flex items-center space-x-2 flex-grow mr-2" title="Volume">
              <Volume2 size={12} className="text-zinc-600" />
              <input 
                type="range" 
                min="0" max="1" step="0.01" 
                value={track.volume} 
                onChange={(e) => dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, changes: { volume: parseFloat(e.target.value) } } })}
                onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                draggable
                className="w-full h-1 bg-white/10 rounded-full appearance-none outline-none accent-primary/70" 
              />
            </div>
            <div className="flex items-center" title="Pan">
              <input
                type="range"
                min="-1" max="1" step="0.01"
                value={track.pan}
                onChange={(e) => dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, changes: { pan: parseFloat(e.target.value) } } })}
                onDragStart={(e) => { e.preventDefault(); e.stopPropagation(); }}
                draggable
                className="w-12 h-1 bg-white/10 rounded-full appearance-none outline-none accent-zinc-400 mr-2"
              />
              <div className="w-7 h-7 rounded-full border border-white/10 bg-black/50 shadow-lg relative flex items-center justify-center pointer-events-none" style={{ transform: `rotate(${track.pan * 90}deg)` }}>
                <div className="w-1 h-3 bg-zinc-400 absolute top-0 rounded-full" />
              </div>
            </div>
          </div>
          
          {/* Technical Metadata Labels */}
          <div className="flex space-x-1 mt-3 pl-2">
            <button className="text-[8px] bg-zinc-950 border border-zinc-800 text-zinc-600 font-mono font-bold tracking-tighter hover:text-primary px-1.5 py-0.5 rounded transition">AUTO</button>
            <button className="text-[8px] bg-zinc-950 border border-zinc-800 text-zinc-600 font-mono font-bold tracking-tighter hover:text-primary px-1.5 py-0.5 rounded transition">VST3</button>
            <button className="text-[8px] bg-primary/10 border border-primary/20 text-primary/70 font-mono font-bold tracking-tighter hover:text-primary px-1.5 py-0.5 rounded transition">SYNC</button>
          </div>
        </div>

        {/* Alternate Lanes */}
        <AnimatePresence>
          {track.showLanes && track.lanes?.map((lane, lIdx) => {
            const isSelected = selectedLaneIds.includes(lane.id);
            return (
              <motion.div
                key={lane.id}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 40, opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                onClick={(e) => handleLaneClick(track.id, lane.id, e)}
                className={`flex items-center border-b border-white/5 group/lane relative overflow-hidden shrink-0 transition-colors ${isSelected ? 'bg-primary/20' : 'bg-[#0e0e11] hover:bg-white/5'}`}
              >
                <div className="w-1 self-stretch opacity-50" style={{ backgroundColor: track.color }} />
                <div className="flex-1 flex items-center justify-between px-3 h-full">
                  <span className={`text-[10px] font-medium truncate uppercase tracking-tighter w-32 ${isSelected ? 'text-white' : 'text-zinc-500'}`}>{lane.name}</span>
                  <div className="flex items-center space-x-1 opacity-0 group-hover/lane:opacity-100 transition-opacity">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        dispatch({ type: 'PROMOTE_LANE', payload: { trackId: track.id, laneId: lane.id } });
                      }}
                      className="w-6 h-6 flex items-center justify-center rounded hover:bg-white/10 text-zinc-500 hover:text-white transition-all"
                      title="Promote to Main Track"
                    >
                      <ArrowUp size={12} />
                    </button>
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        if (isSelected && selectedLaneIds.length > 1) {
                          dispatch({ type: 'DELETE_LANES', payload: { trackId: track.id, laneIds: selectedLaneIds } });
                          setSelectedLaneIds([]);
                        } else {
                          dispatch({ type: 'DELETE_LANE', payload: { trackId: track.id, laneId: lane.id } });
                          setSelectedLaneIds(prev => prev.filter(id => id !== lane.id));
                        }
                      }}
                      className="w-6 h-6 flex items-center justify-center rounded hover:bg-red-500/20 text-zinc-500 hover:text-red-400 transition-all"
                      title={isSelected && selectedLaneIds.length > 1 ? "Delete Selected Lanes" : "Delete Lane"}
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </React.Fragment>
      ))}
      <div 
        className="p-6 flex justify-center pb-20 flex-1"
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          e.currentTarget.classList.add('bg-white/5');
        }}
        onDragLeave={(e) => {
          e.currentTarget.classList.remove('bg-white/5');
        }}
        onDrop={(e) => {
          e.preventDefault();
          e.currentTarget.classList.remove('bg-white/5');
          const sourceId = e.dataTransfer.getData('text/plain');
          if (sourceId) {
            dispatch({ type: 'REORDER_TRACKS', payload: { sourceId, targetId: 'BOTTOM' } });
          }
        }}
      >
        <button 
          onClick={() => dispatch({ type: 'ADD_TRACK', payload: { id: Date.now().toString(), name: 'NEW LAYER', volume: 0.8, pan: 0, muted: false, solo: false, color: '#333', clips: [] } })}
          className="text-[10px] text-zinc-500 font-bold uppercase tracking-[0.2em] hover:text-white flex items-center space-x-2 py-2 px-4 border border-dashed border-zinc-800 rounded-lg hover:bg-zinc-900 transition-all duration-300"
        >
          <span>+ Add Audio Track</span>
        </button>
      </div>
    </div>
  );
}
