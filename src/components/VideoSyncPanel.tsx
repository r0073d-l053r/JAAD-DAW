import React, { useRef, useEffect, useState } from 'react';
import { motion, useDragControls } from 'motion/react';
import { X, Play, Pause, Video, Volume2, VolumeX, RefreshCw, Layers } from 'lucide-react';
import { useApp } from '../lib/store';
import { audioEngine } from '../lib/audioEngine';
import { LiquidGlassPanel } from './LiquidGlass';

export const VideoSyncPanel: React.FC = () => {
  const { state, dispatch } = useApp();
  const dragControls = useDragControls();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [videoInfo, setVideoInfo] = useState<{ name: string; resolution: string; duration: number } | null>(null);

  // Synchronize playback states and playhead via high-precision RAF
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !state.videoUrl) return;

    let rafId: number;

    const syncVideoToAudio = () => {
      const audioTime = audioEngine.getCurrentTime ? audioEngine.getCurrentTime() : state.currentTime;
      const targetTime = Math.max(0, audioTime + state.videoOffset);

      // Check drift
      const drift = Math.abs(video.currentTime - targetTime);

      if (state.isPlaying) {
        if (video.paused) {
          video.play().catch(e => console.warn('Video play blocked', e));
        }

        // Adjust if out of sync by more than 80ms (standard professional threshold)
        if (drift > 0.08) {
          video.currentTime = targetTime;
        }
      } else {
        if (!video.paused) {
          video.pause();
        }
        
        // Match exact frame when scrubbing while paused
        if (drift > 0.01) {
          video.currentTime = targetTime;
        }
      }

      rafId = requestAnimationFrame(syncVideoToAudio);
    };

    rafId = requestAnimationFrame(syncVideoToAudio);

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [state.isPlaying, state.videoUrl, state.videoOffset, state.currentTime]);

  // Adjust video audio level based on volume fader
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.volume = state.videoMuted ? 0 : state.videoVolume;
  }, [state.videoVolume, state.videoMuted]);

  const handleVideoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      const videoUrl = URL.createObjectURL(file);
      
      // Determine file metadata
      dispatch({ type: 'SET_VIDEO_URL', payload: videoUrl });
      setVideoInfo({
        name: file.name,
        resolution: 'Detecting...',
        duration: 0
      });
    }
  };

  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;

    setVideoInfo(prev => prev ? {
      ...prev,
      resolution: `${video.videoWidth}x${video.videoHeight}`,
      duration: video.duration
    } : null);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('video/')) {
        const videoUrl = URL.createObjectURL(file);
        dispatch({ type: 'SET_VIDEO_URL', payload: videoUrl });
        setVideoInfo({
          name: file.name,
          resolution: 'Detecting...',
          duration: 0
        });
      }
    }
  };

  return (
    <motion.div
      drag
      dragMomentum={false}
      dragListener={false}
      dragControls={dragControls}
      initial={{ x: 100, y: 150 }}
      className="fixed z-50 w-[420px] shadow-3xl select-none"
      ref={containerRef}
    >
      <LiquidGlassPanel
        cornerRadius={16}
        blurAmount={32}
        backgroundOpacity={0.3}
        className="border border-[#2d1b4e]/70 overflow-hidden"
        contentClassName="flex flex-col"
      >
        {/* Header (Drag Bar) */}
        <div 
          onPointerDown={(e) => dragControls.start(e)}
          className="video-sync-titlebar flex justify-between items-center bg-[#070411]/90 border-b border-[#23133f] px-3.5 py-2.5 cursor-move"
        >
          <div className="flex items-center gap-2">
            <Video size={14} className="text-pink-400" />
            <span className="text-[11px] font-bold tracking-widest text-[#a882fa] uppercase font-mono">
              Video Scoring Monitor
            </span>
          </div>
          <button
            onClick={() => dispatch({ type: 'TOGGLE_VIDEO_PANEL' })}
            className="text-zinc-500 hover:text-white transition"
          >
            <X size={14} />
          </button>
        </div>

        {/* Video Viewport / DND Area */}
        <div 
          onPointerDown={(e) => e.stopPropagation()}
          className="relative aspect-video bg-[#05030d] flex items-center justify-center p-0.5 overflow-hidden"
        >
          {state.videoUrl ? (
            <video
              ref={videoRef}
              src={state.videoUrl}
              onLoadedMetadata={handleLoadedMetadata}
              className="w-full h-full object-contain pointer-events-none"
              muted={state.videoMuted}
            />
          ) : (
            <div
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className="w-full h-full flex flex-col items-center justify-center border-2 border-dashed border-[#a882fa]/25 hover:border-pink-500/50 m-2 rounded-lg p-4 transition-all duration-300 group cursor-pointer text-center bg-[#080516]/40"
              onClick={() => document.getElementById('video-selector')?.click()}
            >
              <div className="bg-gradient-to-tr from-pink-500/10 to-[#a882fa]/10 p-4 rounded-full border border-[#a882fa]/20 group-hover:scale-110 transition duration-300">
                <Video size={28} className="text-[#a882fa]/70 group-hover:text-pink-400 transition" />
              </div>
              <p className="text-[11px] font-bold text-[#a882fa] tracking-widest uppercase mt-3">
                Drop Scoring Video
              </p>
              <p className="text-[9px] text-zinc-500 font-mono mt-1">
                Supports MP4, WebM, MOV / Click to Browse
              </p>
              <input
                id="video-selector"
                type="file"
                accept="video/*"
                className="hidden"
                onChange={handleVideoUpload}
              />
            </div>
          )}
        </div>

        {/* Control Center & Synchronization Panel */}
        {state.videoUrl && (
          <div 
            onPointerDown={(e) => e.stopPropagation()}
            className="bg-[#070411]/95 px-4 py-3 space-y-3.5 border-t border-[#23133f]"
          >
            {/* Metadata information */}
            <div className="flex justify-between items-center text-[9px] font-mono text-zinc-500 tracking-tight">
              <span className="truncate max-w-[200px] text-zinc-400 font-medium" title={videoInfo?.name}>
                {videoInfo?.name}
              </span>
              <span className="flex items-center gap-2">
                <span>{videoInfo?.resolution}</span>
                <span className="text-[#a882fa]">|</span>
                <span>{videoInfo?.duration.toFixed(2)}s</span>
              </span>
            </div>

            {/* Sync Delay Offset Offset */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center text-[10px] font-bold uppercase tracking-widest text-[#a882fa] font-mono">
                <span>Audio-Video Sync Delay</span>
                <span className="flex items-center gap-1.5 text-pink-400 font-medium">
                  {state.videoOffset >= 0 ? '+' : ''}{(state.videoOffset * 1000).toFixed(0)} ms
                  <button
                    onClick={() => dispatch({ type: 'SET_VIDEO_OFFSET', payload: 0 })}
                    className="text-zinc-500 hover:text-white transition p-0.5"
                    title="Reset Sync Delay"
                  >
                    <RefreshCw size={10} />
                  </button>
                </span>
              </div>
              <input
                type="range"
                min="-1"
                max="1"
                step="0.01"
                value={state.videoOffset}
                onChange={(e) => dispatch({ type: 'SET_VIDEO_OFFSET', payload: parseFloat(e.target.value) })}
                className="w-full accent-pink-500 bg-[#160e29] h-1.5 rounded-lg appearance-none cursor-pointer"
              />
            </div>

            {/* Sound controls */}
            <div className="flex items-center justify-between border-t border-[#23133f]/50 pt-2.5">
              <button
                onClick={() => dispatch({ type: 'SET_VIDEO_MUTED', payload: !state.videoMuted })}
                className={`p-1.5 rounded hover:bg-white/5 transition ${state.videoMuted ? 'text-red-400' : 'text-[#a882fa]'}`}
              >
                {state.videoMuted ? <VolumeX size={14} /> : <Volume2 size={14} />}
              </button>
              <div className="flex-1 px-3">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={state.videoVolume}
                  onChange={(e) => dispatch({ type: 'SET_VIDEO_VOLUME', payload: parseFloat(e.target.value) })}
                  className="w-full accent-[#a882fa] bg-[#160e29] h-1 rounded-lg appearance-none cursor-pointer"
                />
              </div>
              <button
                onClick={() => dispatch({ type: 'SET_VIDEO_URL', payload: null })}
                className="text-[9px] font-bold text-zinc-500 hover:text-red-400 border border-zinc-800 hover:border-red-500/30 px-2 py-1 rounded transition uppercase font-mono"
              >
                Eject
              </button>
            </div>
          </div>
        )}
      </LiquidGlassPanel>
    </motion.div>
  );
};
export default VideoSyncPanel;
