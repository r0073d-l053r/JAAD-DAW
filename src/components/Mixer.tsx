import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useApp, Clip, Track } from '../lib/store';
import { audioEngine } from '../lib/audioEngine';
import { Volume2 } from './Icons';
import { MoreHorizontal, Trash2, Download, Wand2 } from 'lucide-react';
import { useGemini } from '../lib/useGemini';
import { audioBufferToWav } from '../lib/exportUtils';

import { LiquidGlassPanel } from './LiquidGlass';
import { useAudioImport } from '../lib/useAudioImport';

export function Mixer() {
  const { state, dispatch } = useApp();
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const { getFixMyMixSuggestions, isGenerating, detectBPM } = useGemini();

  const { importAudioFiles } = useAudioImport();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // High-performance, GPU-friendly visualizer loop
  useEffect(() => {
    let animId: number;

    const tick = () => {
      // 1. Process track stem meters
      const trackMeters = document.querySelectorAll('[data-track-meter]');
      trackMeters.forEach((el) => {
        const trackId = el.getAttribute('data-track-meter');
        if (!trackId) return;

        const rms = audioEngine.getTrackLevel(trackId);
        // Apply power scale to boost low/mid levels visually
        const scaled = Math.min(100, Math.pow(rms, 0.6) * 100);

        // Professional peak decay fallback
        const currentVal = parseFloat((el as any).dataset.currentHeight || '0');
        let nextVal = scaled;
        if (scaled < currentVal) {
          nextVal = currentVal - 2.5; // Smooth decay
          if (nextVal < scaled) nextVal = scaled;
        }
        if (nextVal < 0) nextVal = 0;

        // Peak distortion signaling
        if (rms > 0.95) {
          (el as HTMLElement).style.backgroundColor = '#ef4444'; // Red clipping
          (el as HTMLElement).style.boxShadow = '0 0 12px #ef4444';
        } else {
          (el as HTMLElement).style.backgroundColor = '';
          (el as HTMLElement).style.boxShadow = '';
        }

        (el as any).dataset.currentHeight = nextVal.toString();
        (el as HTMLElement).style.height = `${nextVal}%`;
      });

      // 2. Process master stereo meters
      const masterMeters = document.querySelectorAll('[data-master-meter]');
      if (masterMeters.length > 0) {
        const { left, right } = audioEngine.getMasterLevels();
        
        masterMeters.forEach((el) => {
          const channel = el.getAttribute('data-master-meter');
          const rms = channel === 'left' ? left : right;
          const scaled = Math.min(100, Math.pow(rms, 0.6) * 100);

          const currentVal = parseFloat((el as any).dataset.currentHeight || '0');
          let nextVal = scaled;
          if (scaled < currentVal) {
            nextVal = currentVal - 2.5; // Smooth decay
            if (nextVal < scaled) nextVal = scaled;
          }
          if (nextVal < 0) nextVal = 0;

          // Peak distortion signaling
          if (rms > 0.95) {
            (el as HTMLElement).style.backgroundColor = '#ef4444'; // Red clipping
            (el as HTMLElement).style.boxShadow = '0 0 12px #ef4444';
          } else {
            (el as HTMLElement).style.backgroundColor = '';
            (el as HTMLElement).style.boxShadow = '';
          }

          (el as any).dataset.currentHeight = nextVal.toString();
          (el as HTMLElement).style.height = `${nextVal}%`;
        });
      }

      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animId);
  }, []);

  const handleFixMyMix = async () => {
    const suggestions = await getFixMyMixSuggestions(state.tracks);
    if (suggestions) {
      Object.keys(suggestions).forEach(trackId => {
        if (trackId === 'masterVolume') {
           dispatch({ type: 'SET_MASTER_VOLUME', payload: suggestions.masterVolume });
        } else {
           const trackChanges = suggestions[trackId];
           if (typeof trackChanges === 'object') {
             dispatch({ type: 'UPDATE_TRACK', payload: { id: trackId, changes: trackChanges } });
           }
        }
      });
      // Add a master limiter
      audioEngine.addTrackEffect('master', 'limiter');
    }
    // Balanced the levels (best-effort, needs a Gemini key) — now open the
    // per-stem analog restoration panel to fix tone/fidelity.
    dispatch({ type: 'SET_MASTER_MIX_OPEN', payload: true });
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files as FileList);
      await importAudioFiles(files, { trackStyle: 'compact', detectingIndicatorOnlyForSingle: true, logLabel: 'Mixer' });
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDownload = async (track: Track) => {
    if (!track.clips || track.clips.length === 0) {
      alert("This track has no audio clips to download.");
      setOpenMenuId(null);
      return;
    }

    try {
      const clipNames = track.clips.map((c: Clip) => c.audioData || 'audio_clip').join('_');
      const cleanTrackName = track.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const filename = `${cleanTrackName}_${clipNames || 'empty'}.wav`;

      // Find max duration of track clips
      const duration = Math.max(1, ...track.clips.map((c: Clip) => c.start + c.duration));

      // Render track audio using offline context
      const renderedBuffer = await audioEngine.renderTrack(track, duration);

      // Convert buffer to real WAV file
      const wavBlob = audioBufferToWav(renderedBuffer);

      const url = URL.createObjectURL(wavBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      console.error("Failed to render and download track:", err);
      alert("An error occurred while rendering the track audio.");
    } finally {
      setOpenMenuId(null);
    }
  };

  return (
    <div className="flex-1 bg-transparent flex overflow-x-auto p-4 space-x-2 relative" onClick={() => setOpenMenuId(null)}>
      {state.isDetectingBPM && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-50 bg-primary text-black px-4 py-2 rounded-full text-xs font-bold animate-pulse shadow-xl">
           Analyzing Project Tempo...
        </div>
      )}
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
                    className="absolute left-full top-0 ml-1 w-36 z-[120] pointer-events-auto"
                  >
                    <LiquidGlassPanel cornerRadius={8} blurAmount={32} backgroundOpacity={0.35} contentClassName="py-1">
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
                    </LiquidGlassPanel>
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
            {/* Volume meter reactive LED */}
            <div className="absolute top-0 bottom-0 left-full ml-2 w-2.5 bg-[#09090e] rounded-full overflow-hidden border border-white/5 shadow-inner flex flex-col justify-between pointer-events-none">
               <div 
                    data-track-meter={track.id}
                    className="absolute bottom-0 w-full bg-gradient-to-t from-emerald-500 via-yellow-400 to-rose-500 filter drop-shadow-[0_0_3px_rgba(16,185,129,0.5)] transition-shadow duration-300" 
                    style={{ height: '0%' }} 
               />
               {/* Tick Marks for professional dB scale */}
               <div className="absolute inset-0 flex flex-col justify-between opacity-15 pointer-events-none px-0.5">
                 <div className="h-[1px] w-full bg-white" />
                 <div className="h-[1px] w-full bg-white" />
                 <div className="h-[1px] w-full bg-white" />
                 <div className="h-[1px] w-full bg-white" />
                 <div className="h-[1px] w-full bg-white" />
               </div>
            </div>
          </div>
          
          <div className="flex items-center space-x-2 text-xs mb-4">
            <Volume2 size={14} className="text-gray-500" />
            <span className="font-mono text-gray-400">{(track.volume * 100).toFixed(0)}</span>
          </div>

          <div className="w-full px-2 space-y-1">
             <div className="text-[10px] text-gray-500 font-bold mb-1">FX SLOTS</div>
             <div onClick={() => {
                dispatch({ type: 'TOGGLE_DEHUMMER', payload: { trackId: track.id } });
             }} className={`w-full text-[10px] p-1 rounded text-center cursor-pointer border transition ${track.deHummerEnabled ? 'bg-amber-950/40 text-amber-300 border-amber-500/30 hover:bg-amber-900/20' : 'bg-[#111] border-[#333] text-gray-400 hover:bg-[#222]'}`}>
               🧹 De-Hummer (60Hz)
             </div>
             <div onClick={() => {
                audioEngine.addTrackEffect(track.id, 'eq');
             }} className="w-full bg-[#111] border border-[#333] text-[10px] text-gray-400 p-1 rounded text-center cursor-pointer hover:bg-[#222]">
               + WebEQ
             </div>
             <div onClick={() => {
                audioEngine.addTrackEffect(track.id, 'compressor');
             }} className="w-full bg-[#111] border border-[#333] text-[10px] text-gray-400 p-1 rounded text-center cursor-pointer hover:bg-[#222]">
               + WebCompressor
             </div>
             <div onClick={() => {
                audioEngine.addTrackEffect(track.id, 'delay');
             }} className="w-full bg-[#111] border border-[#333] text-[10px] text-gray-400 p-1 rounded text-center cursor-pointer hover:bg-[#222]">
               + WebDelay
             </div>
             <div onClick={() => {
                audioEngine.addTrackEffect(track.id, 'reverb', { reverbPreset: 'hall' });
             }} className="w-full bg-[#111] border border-[#333] text-[10px] text-gray-400 p-1 rounded text-center cursor-pointer hover:bg-[#222]">
               + WebReverb (Hall)
             </div>
             <div onClick={() => {
                if (!audioEngine.cloudVstBridges.has(track.id)) {
                  audioEngine.addCloudVstBridge(track.id);
                }
                dispatch({ type: 'SET_VST_EDITOR_TRACK', payload: track.id });
             }} className={`w-full text-[10px] p-1 rounded text-center cursor-pointer border transition ${audioEngine.cloudVstBridges.has(track.id) ? 'bg-purple-950/40 text-purple-300 border-purple-500/30 hover:bg-purple-900/20' : 'bg-[#111] border-[#333] text-gray-400 hover:bg-[#222]'}`}>
               ⚡ Cloud VST
             </div>
             <div onClick={() => {
                if (!audioEngine.sidechainNodes.has(track.id)) {
                  audioEngine.addTrackSidechain(track.id);
                }
                dispatch({ type: 'SET_SIDECHAIN_EDITOR_TRACK', payload: track.id });
             }} className={`w-full text-[10px] p-1 rounded text-center cursor-pointer border transition ${audioEngine.sidechainNodes.has(track.id) ? 'bg-cyan-950/40 text-cyan-300 border-cyan-500/30 hover:bg-cyan-900/20' : 'bg-[#111] border-[#333] text-gray-400 hover:bg-[#222]'}`}>
               🔗 Sidechain Duck
             </div>
          </div>
        </div>
      ))}
      
      {/* Master Channel */}
      <div className="w-32 bg-red-900/10 backdrop-blur-2xl rounded-xl flex flex-col items-center py-4 border border-red-500/20 ml-4 flex-shrink-0 shadow-[0_0_30px_rgba(255,45,85,0.15)]">
        <div className="text-xs font-bold font-mono text-red-400 mb-2 uppercase tracking-tighter">Master Bus</div>
        
        <button 
          onClick={handleFixMyMix}
          disabled={isGenerating || state.tracks.length === 0}
          className={`px-3 py-1 text-[10px] font-bold uppercase tracking-widest rounded-full border transition-all mb-4 ${isGenerating ? 'bg-zinc-800 text-zinc-500 border-zinc-700 cursor-wait' : 'bg-red-500/20 text-red-400 border-red-500/50 hover:bg-red-500/30 hover:scale-105 active:scale-95 shadow-[0_0_15px_rgba(239,68,68,0.2)]'}`}
        >
          <div className="flex items-center gap-1">
            <Wand2 size={10} className={isGenerating ? 'animate-spin' : ''} />
            <span>{isGenerating ? 'Analyzing...' : 'Fix My Mix'}</span>
          </div>
        </button>
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
            {/* Left Master Meter */}
            <div className="absolute top-1 bottom-1 left-1.5 w-2 bg-[#09090e] rounded-full overflow-hidden border border-white/5 shadow-inner flex flex-col justify-between pointer-events-none">
               <div 
                    data-master-meter="left"
                    className="absolute bottom-0 w-full bg-gradient-to-t from-emerald-500 via-yellow-400 to-rose-500 filter drop-shadow-[0_0_3px_rgba(244,63,94,0.5)]" 
                    style={{ height: '0%' }} 
               />
               <div className="absolute inset-0 flex flex-col justify-between opacity-15 pointer-events-none px-0.5">
                 <div className="h-[1px] w-full bg-white" />
                 <div className="h-[1px] w-full bg-white" />
                 <div className="h-[1px] w-full bg-white" />
                 <div className="h-[1px] w-full bg-white" />
                 <div className="h-[1px] w-full bg-white" />
               </div>
            </div>
            {/* Right Master Meter */}
            <div className="absolute top-1 bottom-1 right-1.5 w-2 bg-[#09090e] rounded-full overflow-hidden border border-white/5 shadow-inner flex flex-col justify-between pointer-events-none">
               <div 
                    data-master-meter="right"
                    className="absolute bottom-0 w-full bg-gradient-to-t from-emerald-500 via-yellow-400 to-rose-500 filter drop-shadow-[0_0_3px_rgba(244,63,94,0.5)]" 
                    style={{ height: '0%' }} 
               />
               <div className="absolute inset-0 flex flex-col justify-between opacity-15 pointer-events-none px-0.5">
                 <div className="h-[1px] w-full bg-white" />
                 <div className="h-[1px] w-full bg-white" />
                 <div className="h-[1px] w-full bg-white" />
                 <div className="h-[1px] w-full bg-white" />
                 <div className="h-[1px] w-full bg-white" />
               </div>
            </div>
          </div>
      </div>
    </div>
  );
}
