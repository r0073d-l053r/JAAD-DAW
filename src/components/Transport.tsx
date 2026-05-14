import { Play, Pause, StopCircle, Mic, FastForward, Rewind, Volume2, Timer } from './Icons';
import { useApp } from '../lib/store';
import { audioEngine } from '../lib/audioEngine';
import { useEffect, useCallback, useRef, useState } from 'react';
import { LiquidGlassPanel } from './LiquidGlass';

function TimeDisplay() {
  const { state } = useApp();
  const [displayTime, setDisplayTime] = useState({ mins: '00', secs: '00', ms: '00' });
  const rafId = useRef<number>(0);

  useEffect(() => {
    const update = () => {
      const time = audioEngine.getCurrentTime();
      const mins = Math.floor(time / 60).toString().padStart(2, '0');
      const secs = Math.floor(time % 60).toString().padStart(2, '0');
      const ms = Math.floor((time % 1) * 100).toString().padStart(2, '0');
      setDisplayTime({ mins, secs, ms });

      rafId.current = requestAnimationFrame(update);
    };

    if (state.isPlaying) {
      rafId.current = requestAnimationFrame(update);
    } else {
      // Sync to current state time when stopped
      const time = state.currentTime;
      const mins = Math.floor(time / 60).toString().padStart(2, '0');
      const secs = Math.floor(time % 60).toString().padStart(2, '0');
      const ms = Math.floor((time % 1) * 100).toString().padStart(2, '0');
      setDisplayTime({ mins, secs, ms });
    }

    return () => cancelAnimationFrame(rafId.current);
  }, [state.isPlaying, state.currentTime]);

  return (
    <div 
      className="font-mono text-xl text-primary font-bold tracking-widest min-w-[120px] text-center bg-black/40 px-3 py-1.5 rounded-lg border border-primary/10 shadow-inner"
    >
      {displayTime.mins}:{displayTime.secs}.<span className="text-primary/60">{displayTime.ms}</span>
    </div>
  );
}

export function Transport() {
  const { state, dispatch } = useApp();

  const togglePlay = useCallback(() => {
    dispatch({ type: 'TOGGLE_PLAY' });
  }, [dispatch]);

  const prevIsPlaying = useRef(state.isPlaying);

  useEffect(() => {
    // Only trigger when isPlaying changes
    if (state.isPlaying && !prevIsPlaying.current) {
      // START PLAYBACK
      audioEngine.init();
      audioEngine.setMasterVolume(state.masterVolume);
      audioEngine.setLoop(state.looping, state.loopStart, state.loopEnd);
      
      const scheduleTime = audioEngine.context!.currentTime + 0.05; // 50ms scheduling buffer
      audioEngine.startPlayback(state.currentTime, scheduleTime);

      // Trigger play on all clips that overlap with current time or are in the future
      state.tracks.forEach(track => {
        if (track.muted) return;
        
        // SUPPORT FOR TRACK FREEZING: If frozen, play the pre-rendered buffer instead of individual clips
        if (track.isFrozen && track.frozenBufferId) {
          const buffer = audioEngine.buffers.get(track.frozenBufferId);
          if (buffer) {
             const trackDuration = buffer.duration;
             if (trackDuration > state.currentTime) {
               let startContextTime = scheduleTime;
               let offset = state.currentTime;
               let remaining = trackDuration - state.currentTime;
               
               audioEngine.playClip(
                 `frozen_${track.id}`,
                 track.id,
                 startContextTime,
                 offset,
                 remaining,
                 track.frozenBufferId
               );
               return; // Skip individual clips
             }
          }
        }

        const allClips = [...track.clips, ...(track.lanes?.flatMap(l => l.clips) || [])];
        allClips.forEach(clip => {
          if (clip.start + clip.duration > state.currentTime) {
            let clipStartContextTime = scheduleTime;
            let offset = clip.audioOffset || 0;
            let remainingDuration = clip.duration;
            
            if (clip.start > state.currentTime) {
              // Clip starts in the future relative to current playhead
              clipStartContextTime = scheduleTime + (clip.start - state.currentTime);
            } else {
              // Clip is already playing at current playhead
              const overlap = state.currentTime - clip.start;
              offset += overlap;
              remainingDuration -= overlap;
            }
            
            audioEngine.playClip(
              clip.id, 
              track.id, 
              clipStartContextTime, 
              offset, 
              remainingDuration,
              clip.bufferId,
              clip.volumeEnvelope
            );
          }
        });
      });
    } else if (!state.isPlaying && prevIsPlaying.current) {
      // STOP PLAYBACK
      audioEngine.stopAll();
    }
    prevIsPlaying.current = state.isPlaying;
  }, [state.isPlaying, state.currentTime, state.tracks, state.looping, state.loopStart, state.loopEnd, state.masterVolume]);

  useEffect(() => {
    audioEngine.setMetronomeState(state.metronomeEnabled, state.tempoAutomation);
  }, [state.metronomeEnabled, state.tempoAutomation]);

  useEffect(() => {
    // Synchronization effect: Ensure audio engine reflects current track state during playback
    if (state.isPlaying) {
      const allCurrentClipIds = new Set(
        state.tracks.flatMap(t => [...t.clips, ...(t.lanes?.flatMap(l => l.clips) || [])].map(c => c.id))
      );
      
      // Stop clips that were removed from the project
      const activeIds = Array.from(audioEngine.activeSources.keys());
      activeIds.forEach(id => {
        if (!id.startsWith('compiled_') && !allCurrentClipIds.has(id)) {
          audioEngine.stopClip(id);
        }
      });

      // Optionally: start missing clips? For now, stopping removed clips is the critical fix.
    }
  }, [state.isPlaying, state.tracks]);

  // Remove the redundant handleKeyDown as it's now in store.tsx

  return (
    <LiquidGlassPanel
      cornerRadius={0}
      blurAmount={32}
      backgroundOpacity={0.15}
      displacementScale={15}
      mode="prominent"
      className="h-16 flex-shrink-0 z-[100] relative border-t border-white/10"
      contentClassName="h-full flex items-center justify-between px-6"
    >
      
      <div className="flex items-center space-x-4">
        <TimeDisplay />
      </div>

      <div className="absolute left-1/2 -translate-x-1/2 flex items-center space-x-6">
        <button 
          className={`flex items-center justify-center transition-colors duration-200 ${state.tracks.some(t => t.armed) ? 'text-red-500 hover:text-red-400' : 'text-zinc-600 hover:text-red-500/50'}`}
          title="Record"
          onClick={() => {
            if (state.tracks.some(t => t.armed)) {
              alert("Recording not fully implemented yet in the audio engine.");
            } else {
              alert("Arm a track to record.");
            }
          }}
        >
          <div className="w-4 h-4 rounded-full bg-current" />
        </button>
        <button className="text-zinc-500 hover:text-white transition-colors duration-200">
          <Rewind size={20} />
        </button>
        <button 
          onClick={togglePlay}
          className={`w-12 h-12 flex items-center justify-center rounded-full transition-all duration-300 shadow-lg ${state.isPlaying ? 'studio-gradient text-white scale-105' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'}`}
        >
          {state.isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-1" />}
        </button>
        <button 
          onClick={() => {
            if (state.isPlaying) dispatch({ type: 'TOGGLE_PLAY' });
            dispatch({ type: 'SET_TIME', payload: 0 });
            audioEngine.stopAll();
          }}
          className="text-zinc-500 hover:text-white transition-colors duration-200"
        >
          <StopCircle size={20} />
        </button>
        <button className="text-zinc-500 hover:text-white transition-colors duration-200">
          <FastForward size={20} />
        </button>
        <div className="w-px h-8 bg-zinc-800 mx-2" />
        <button 
          onClick={() => dispatch({ type: 'TOGGLE_RECORD' })}
          className={`w-10 h-10 flex items-center justify-center rounded-full transition-all duration-300 ${state.isRecording ? 'bg-red-600 text-white animate-pulse shadow-[0_0_20px_rgba(220,38,38,0.5)]' : 'bg-zinc-800/50 text-red-500/70 hover:bg-zinc-800 hover:text-red-500 border border-zinc-800'}`}
          title="Record"
        >
          <Mic size={18} />
        </button>
        <button 
          onClick={() => dispatch({ type: 'TOGGLE_METRONOME' })}
          className={`w-10 h-10 flex items-center justify-center rounded-full transition-all duration-300 ${state.metronomeEnabled ? 'bg-primary/20 text-primary border border-primary/50 shadow-[0_0_10px_rgba(var(--primary-color-rgb),0.3)]' : 'bg-zinc-800/50 text-zinc-500 hover:bg-zinc-800 hover:text-primary border border-zinc-800'}`}
          title="Metronome"
        >
          <Timer size={18} />
        </button>
      </div>

      <div className="flex items-center space-x-4">
        <div className="flex items-center space-x-2 bg-black/40 px-3 py-1.5 rounded-lg border border-zinc-800">
          <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider font-bold">BPM</span>
          <span className="text-sm font-mono text-white font-medium">{state.bpm}</span>
        </div>
        <div className="flex items-center space-x-2">
          <Volume2 size={16} className="text-zinc-500" />
          <input 
            type="range" 
            className="w-24 accent-primary" 
            min="0" 
            max="1.5" 
            step="0.01"
            value={state.masterVolume} 
            onChange={(e) => dispatch({ type: 'SET_MASTER_VOLUME', payload: parseFloat(e.target.value) })}
          />
        </div>
      </div>

    </LiquidGlassPanel>
  );
}
