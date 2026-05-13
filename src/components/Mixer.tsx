import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useApp, Clip } from '../lib/store';
import { audioEngine } from '../lib/audioEngine';
import { Volume2 } from './Icons';
import { MoreHorizontal, Trash2, Download } from 'lucide-react';

export function Mixer() {
  const { state, dispatch } = useApp();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files as FileList);
      const audioFiles = files.filter(f => f.type.startsWith('audio/') || f.name.match(/\.(mp3|wav|ogg|flac|aac|m4a|weba|webm)$/i));
      
      for (let i = 0; i < audioFiles.length; i++) {
        const file = audioFiles[i];
        const id = 'clip_' + Date.now() + '_' + i;
        const duration = await audioEngine.loadAudio(id, file);
        
        const clip: Clip = {
          id,
          start: 0,
          duration,
          audioData: file.name
        };

        const TRACK_COLORS = ['#FF2A5F', '#00E871', '#6B44FF', '#4B7BFF', '#FFEB3B', '#FF9800', '#00BCD4', '#E91E63', '#9C27B0', '#8BC34A'];
        const newTrackColor = TRACK_COLORS[(state.tracks.length + i) % TRACK_COLORS.length];
        const targetTrackId = 'track_' + Date.now() + '_' + i;
        dispatch({ 
          type: 'ADD_TRACK', 
          payload: { 
            id: targetTrackId, 
            name: file.name.substring(0, 15) || 'Audio', 
            volume: 1, 
            pan: 0, 
            muted: false, 
            solo: false, 
            color: newTrackColor, 
            clips: [] 
          } 
        });

        dispatch({ type: 'ADD_CLIP', payload: { trackId: targetTrackId, clip } });
      }
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDownload = (track: any) => {
    const clipNames = track.clips.map((c: any) => c.audioData || 'audio_clip').join('_');
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
    <div className="flex-1 bg-transparent flex overflow-x-auto p-4 space-x-2 relative" onClick={() => setOpenMenuId(null)}>
      {state.tracks.length === 0 && (
        <div 
          onClick={() => fileInputRef.current?.click()}
          className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500 pointer-events-auto cursor-pointer hover:text-zinc-300 transition-colors z-40 sticky left-0 w-full h-[80vh]"
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            multiple 
            accept="audio/*,.mp3,.wav,.ogg,.flac,.m4a"
            onChange={handleFileSelect} 
          />
          <div className="w-16 h-16 mb-4 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center backdrop-blur-md shadow-2xl hover:bg-white/10 transition-colors cursor-pointer text-white">
             <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </div>
          <p className="text-sm font-medium tracking-wide">Please drag and drop or click to add files.</p>
        </div>
      )}
      {state.tracks.map(track => (
        <div key={track.id} className="w-32 bg-white/5 backdrop-blur-2xl rounded-xl flex flex-col items-center py-4 border border-white/10 flex-shrink-0 shadow-xl relative">
          <div className="flex justify-between w-full px-3 mb-2">
            <div className="w-4" /> {/* Spacer */}
            <div className="text-xs font-bold font-mono truncate text-center flex-1" style={{ color: track.color }}>
              {track.name.toUpperCase()}
            </div>
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setOpenMenuId(openMenuId === track.id ? null : track.id);
                }}
                className="w-4 h-4 rounded-full flex items-center justify-center text-zinc-500 hover:text-white transition-colors"
              >
                <MoreHorizontal size={14} />
              </button>

              <AnimatePresence>
                {openMenuId === track.id && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.95 }}
                    className="absolute left-full top-0 ml-1 w-36 bg-[#0a0a0c]/90 border border-white/10 rounded-lg shadow-2xl py-1 z-[120] overflow-hidden backdrop-blur-2xl"
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
          
          <div className="flex space-x-2 mb-6">
            <button 
              onClick={() => dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, changes: { muted: !track.muted } } })}
              className={`w-8 h-8 rounded text-sm font-bold transition-colors ${track.muted ? 'bg-orange-500/20 text-orange-500 border border-orange-500' : 'bg-[#222] text-gray-500 hover:bg-[#333]'}`}
            >
              M
            </button>
            <button 
              onClick={() => dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, changes: { solo: !track.solo } } })}
              className={`w-8 h-8 rounded text-sm font-bold transition-colors ${track.solo ? 'bg-yellow-500/20 text-yellow-500 border border-yellow-500' : 'bg-[#222] text-gray-500 hover:bg-[#333]'}`}
            >
              S
            </button>
            <button 
              onClick={() => dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, changes: { armed: !track.armed } } })}
              className={`w-8 h-8 rounded text-[10px] font-bold transition-colors flex items-center justify-center ${track.armed ? 'bg-red-600/20 text-red-500 border border-red-500' : 'bg-[#222] text-gray-500 hover:bg-[#333]'}`}
              title="Record Arm"
            >
              ●
            </button>
          </div>

          <div className="flex flex-col items-center mb-6 w-full px-4">
            <input
              type="range"
              min="-1" max="1" step="0.01"
              value={track.pan}
              onChange={(e) => dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, changes: { pan: parseFloat(e.target.value) } } })}
              className="w-full h-1 bg-white/10 rounded-full appearance-none outline-none accent-zinc-400 mb-2"
            />
            <div className="knob" style={{ transform: `rotate(${track.pan * 90}deg)` }} />
          </div>
          <div className="text-[10px] text-gray-500 font-mono mb-4 -mt-4">PAN</div>

          <div className="relative h-48 w-8 bg-[#111] rounded-full border border-[#333] flex justify-center mb-4">
            <input 
              type="range" 
              min="0" max="1" step="0.01" 
              value={track.volume} 
              onChange={(e) => dispatch({ type: 'UPDATE_TRACK', payload: { id: track.id, changes: { volume: parseFloat(e.target.value) } } })}
              className="absolute w-48 h-8 -rotate-90 top-20 appearance-none bg-transparent outline-none accent-gray-300"
              style={{
                 /* custom slider thumb style could be applied here */
              }}
            />
            {/* Volume meter mock */}
            <div className="absolute top-0 bottom-0 left-full ml-1 w-1 bg-[#222] rounded overflow-hidden">
               <div className="absolute bottom-0 w-full bg-gradient-to-t from-green-500 via-yellow-500 to-red-500 opacity-80" 
                    style={{ height: state.isPlaying && !track.muted ? `${Math.random() * 40 + track.volume * 60}%` : '0%' }} />
            </div>
          </div>
          
          <div className="flex items-center space-x-2 text-xs mb-4">
            <Volume2 size={14} className="text-gray-500" />
            <span className="font-mono text-gray-400">{(track.volume * 100).toFixed(0)}</span>
          </div>

          <div className="w-full px-2 space-y-1">
             <div className="text-[10px] text-gray-500 font-bold mb-1">FX SLOTS</div>
             <div onClick={() => {
                import('../lib/audioEngine').then(({audioEngine}) => {
                   audioEngine.addTrackEffect(track.id, 'eq');
                });
             }} className="w-full bg-[#111] border border-[#333] text-[10px] text-gray-400 p-1 rounded text-center cursor-pointer hover:bg-[#222]">
               + WebEQ
             </div>
             <div onClick={() => {
                import('../lib/audioEngine').then(({audioEngine}) => {
                   audioEngine.addTrackEffect(track.id, 'compressor');
                });
             }} className="w-full bg-[#111] border border-[#333] text-[10px] text-gray-400 p-1 rounded text-center cursor-pointer hover:bg-[#222]">
               + WebCompressor
             </div>
             <div onClick={() => {
                import('../lib/audioEngine').then(({audioEngine}) => {
                   audioEngine.addTrackEffect(track.id, 'delay');
                });
             }} className="w-full bg-[#111] border border-[#333] text-[10px] text-gray-400 p-1 rounded text-center cursor-pointer hover:bg-[#222]">
               + WebDelay
             </div>
          </div>
        </div>
      ))}
      
      {/* Master Channel */}
      <div className="w-32 bg-red-900/10 backdrop-blur-2xl rounded-xl flex flex-col items-center py-4 border border-red-500/20 ml-4 flex-shrink-0 shadow-[0_0_30px_rgba(255,45,85,0.15)]">
        <div className="text-xs font-bold font-mono text-red-400 mb-4">MASTER</div>
        <div className="flex space-x-2 mb-6">
            <div className="w-8 h-8"/> {/* spacer */}
            <div className="w-8 h-8"/>
        </div>
        <div className="knob mb-6" style={{ transform: `rotate(0deg)` }} />
          <div className="text-[10px] text-gray-500 font-mono mb-4 -mt-4">BAL</div>

          <div className="relative h-48 w-12 bg-[#111] rounded border border-[#333] flex justify-center mb-4">
            <input 
              type="range" 
              min="0" max="1.5" step="0.01" 
              value={state.masterVolume}
              onChange={(e) => dispatch({ type: 'SET_MASTER_VOLUME', payload: parseFloat(e.target.value) })}
              className="absolute w-48 h-12 -rotate-90 top-20 appearance-none bg-transparent outline-none accent-red-400"
            />
            <div className="absolute top-1 bottom-1 right-1 w-2 bg-[#111] rounded overflow-hidden">
               <div className="absolute bottom-0 w-full bg-gradient-to-t from-green-500 via-yellow-500 to-red-500 opacity-80" 
                    style={{ height: state.isPlaying ? `${Math.random() * 20 + 70}%` : '0%' }} />
            </div>
            <div className="absolute top-1 bottom-1 left-1 w-2 bg-[#111] rounded overflow-hidden">
               <div className="absolute bottom-0 w-full bg-gradient-to-t from-green-500 via-yellow-500 to-red-500 opacity-80" 
                    style={{ height: state.isPlaying ? `${Math.random() * 20 + 70}%` : '0%' }} />
            </div>
          </div>
      </div>
    </div>
  );
}
