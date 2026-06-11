import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from '../lib/store';
import { audioEngine } from '../lib/audioEngine';
import { Spectrogram } from './Spectrogram';
import {
  AuthenticitySettings,
  DEFAULT_SETTINGS,
  PRESETS,
  NoiseProfile,
  computeAIScore,
  detectCutoffFrequency,
} from '../lib/aiAuthenticityProcessor';
import { collection, getDocs, setDoc, doc, deleteDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { saveAsset } from '../lib/assetManager';
import { uploadAssetCloud } from '../lib/syncUtils';
import { audioBufferToWav } from '../lib/exportUtils';

// ── Dial Component ─────────────────────────────────────────────────────

function Dial({ value, onChange, label, unit, min = 0, max = 1, color = '#a882fa' }: {
  value: number; onChange: (v: number) => void; label: string;
  unit?: string; min?: number; max?: number; color?: string;
}) {
  const [dragging, setDragging] = useState(false);
  const startY = useRef(0);
  const startVal = useRef(0);

  const handlePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    startY.current = e.clientY;
    startVal.current = value;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragging) return;
    e.stopPropagation();
    const dy = startY.current - e.clientY;
    const newVal = Math.max(min, Math.min(max, startVal.current + (dy / 120) * (max - min)));
    onChange(newVal);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (dragging) {
      e.currentTarget.releasePointerCapture(e.pointerId);
      setDragging(false);
    }
  };

  const pct = ((value - min) / (max - min));
  const angle = -135 + pct * 270;
  const displayVal = max <= 1 ? Math.round(pct * 100) : Math.round(min + pct * (max - min));

  return (
    <div className="flex flex-col items-center gap-1 select-none">
      <div
        className="relative w-10 h-10 rounded-full cursor-ns-resize"
        style={{ background: `conic-gradient(${color} ${pct * 100}%, #333 0%)` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="absolute inset-1 rounded-full bg-[#1a1a2e] flex items-center justify-center">
          <div
            className="w-0.5 h-3 rounded-full origin-bottom"
            style={{
              backgroundColor: color,
              transform: `rotate(${angle}deg) translateY(-2px)`,
            }}
          />
        </div>
      </div>
      <span className="text-[9px] text-zinc-400 font-mono tracking-tight">{label}</span>
      <span className="text-[8px] font-bold font-mono" style={{ color }}>
        {displayVal}{unit || '%'}
      </span>
    </div>
  );
}

// ── Toggle Switch ──────────────────────────────────────────────────────

function Toggle({ enabled, onChange, label }: {
  enabled: boolean; onChange: (v: boolean) => void; label: string;
}) {
  return (
    <button
      className={`flex items-center gap-2 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider transition-all ${enabled ? 'bg-[#a882fa]/20 text-[#a882fa]' : 'bg-zinc-900 text-zinc-600'}`}
      onClick={() => onChange(!enabled)}
    >
      <div className={`w-2 h-2 rounded-full transition-colors ${enabled ? 'bg-[#a882fa]' : 'bg-zinc-700'}`} />
      {label}
    </button>
  );
}

// ── Score Gauge ─────────────────────────────────────────────────────────

function AIScoreGauge({ score, label }: { score: number; label: string }) {
  const color = score > 60 ? '#ef4444' : score > 30 ? '#f59e0b' : '#22c55e';
  const circumference = 2 * Math.PI * 36;
  const dashOffset = circumference - (score / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-20 h-20">
        <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
          <circle cx="40" cy="40" r="36" fill="none" stroke="#222" strokeWidth="5" />
          <circle
            cx="40" cy="40" r="36" fill="none"
            stroke={color} strokeWidth="5" strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={dashOffset}
            className="transition-all duration-700"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-lg font-black font-mono" style={{ color }}>{score}</span>
        </div>
      </div>
      <span className="text-[9px] text-zinc-500 font-mono uppercase tracking-wider">{label}</span>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────

export const AuthenticityProcessor: React.FC = () => {
  const { state, dispatch } = useApp();
  const clipId = state.authenticityProcessorClipId;

  const [settings, setSettings] = useState<AuthenticitySettings>({ ...DEFAULT_SETTINGS });
  const [processing, setProcessing] = useState(false);
  const [aiScoreBefore, setAiScoreBefore] = useState(0);
  const [aiScoreAfter, setAiScoreAfter] = useState<number | null>(null);
  const [detectedCutoff, setDetectedCutoff] = useState(0);
  const [previewBufferId, setPreviewBufferId] = useState<string | null>(null);
  const [activePreset, setActivePreset] = useState<string | null>('Studio Master');
  const [showBefore, setShowBefore] = useState(true);
  const [telemetry, setTelemetry] = useState<{
    totalMs: number;
    parallelChannelMs: number;
    stereoMs: number;
    normalizeMs: number;
    gpuAccelerated: boolean;
    channelTimings?: { left: Record<string, number>; right: Record<string, number> };
  } | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // Firestore Presets
  const [customPresets, setCustomPresets] = useState<Record<string, AuthenticitySettings>>({});
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');

  // Onboarding
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return localStorage.getItem('jaad_ai_auth_onboarding_seen') !== 'true';
  });

  // Gapless Preview
  const [isPlaying, setIsPlaying] = useState(false);
  const loopTimerRef = useRef<number | null>(null);
  const playStartRef = useRef<number>(0);
  const playOffsetRef = useRef<number>(0);

  // Find clip info
  let clip: any = null;
  let trackId = '';
  if (clipId) {
    for (const t of state.tracks) {
      const found = t.clips.find((c: any) => c.id === clipId);
      if (found) { clip = found; trackId = t.id; break; }
      for (const l of (t.lanes || [])) {
        const lf = l.clips.find((c: any) => c.id === clipId);
        if (lf) { clip = lf; trackId = t.id; break; }
      }
      if (clip) break;
    }
  }

  const effectiveBufferId = clip?.bufferId || clipId || '';

  // Analyze on open
  useEffect(() => {
    if (!clipId || !effectiveBufferId) return;
    const buffer = audioEngine.buffers.get(effectiveBufferId);
    if (!buffer) return;

    const data = buffer.getChannelData(0);
    setAiScoreBefore(computeAIScore(data, buffer.sampleRate));
    setDetectedCutoff(Math.round(detectCutoffFrequency(data, buffer.sampleRate)));
    setAiScoreAfter(null);
    setPreviewBufferId(null);
  }, [clipId, effectiveBufferId]);

  // Fetch Custom Presets
  useEffect(() => {
    if (!db) return;
    getDocs(collection(db, 'authenticityPresets')).then(snap => {
      const loaded: Record<string, AuthenticitySettings> = {};
      snap.forEach(doc => {
        loaded[doc.id] = doc.data() as AuthenticitySettings;
      });
      setCustomPresets(loaded);
    }).catch(err => console.warn("Failed to load presets:", err));
  }, []);

  const close = () => {
    stopPlayback();
    // Clean up preview buffer
    if (previewBufferId && audioEngine.buffers.has(previewBufferId)) {
      audioEngine.buffers.delete(previewBufferId);
    }
    dispatch({ type: 'SET_AUTHENTICITY_PROCESSOR_CLIP', payload: null });
  };

  const updateModule = useCallback(<K extends keyof AuthenticitySettings>(
    key: K, changes: Partial<AuthenticitySettings[K]>
  ) => {
    setSettings(prev => ({
      ...prev,
      [key]: { ...prev[key], ...changes },
    }));
    setActivePreset(null);
  }, []);

  const applyPreset = (name: string, isCustom: boolean = false) => {
    const preset = isCustom ? customPresets[name] : PRESETS[name];
    if (preset) {
      setSettings(JSON.parse(JSON.stringify(preset)));
      setActivePreset(name);
    }
  };

  const handleSavePreset = async () => {
    if (!newPresetName.trim() || !db) return;
    try {
      await setDoc(doc(collection(db, 'authenticityPresets'), newPresetName.trim()), settings);
      setCustomPresets(prev => ({ ...prev, [newPresetName.trim()]: settings }));
      setActivePreset(newPresetName.trim());
      setIsSavingPreset(false);
      setNewPresetName('');
    } catch (e) {
      console.error("Error saving preset", e);
    }
  };

  const handleDeletePreset = async (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!db) return;
    try {
      await deleteDoc(doc(collection(db, 'authenticityPresets'), name));
      setCustomPresets(prev => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      if (activePreset === name) setActivePreset(null);
    } catch (e) {
      console.error("Error deleting preset", e);
    }
  };

  const startPlayback = (targetBufferId: string, startOffset: number = 0) => {
    if (!audioEngine.context || !clipId) return;
    const ctx = audioEngine.context;
    
    if (ctx.state === 'suspended') {
      ctx.resume();
    }
    
    // playClip(clipId, trackId, playAtTime, offset, duration, bufferId)
    audioEngine.playClip(clipId, trackId, ctx.currentTime, startOffset, clipDuration, targetBufferId);
    
    playStartRef.current = ctx.currentTime;
    playOffsetRef.current = startOffset;
    setIsPlaying(true);

    if (loopTimerRef.current) window.clearTimeout(loopTimerRef.current);
    
    // Schedule the next loop
    const timeRemaining = clipDuration - startOffset;
    loopTimerRef.current = window.setTimeout(() => {
      startPlayback(targetBufferId, 0); // Loop from beginning
    }, timeRemaining * 1000);
  };

  const stopPlayback = () => {
    if (clipId) audioEngine.stopClip(clipId);
    if (loopTimerRef.current) window.clearTimeout(loopTimerRef.current);
    setIsPlaying(false);
  };

  const togglePlayback = () => {
    if (isPlaying) {
      stopPlayback();
    } else {
      startPlayback(showBefore ? effectiveBufferId : (previewBufferId || effectiveBufferId), 0);
    }
  };

  const handleViewToggle = (isBefore: boolean) => {
    setShowBefore(isBefore);
    if (isPlaying && audioEngine.context) {
      const elapsed = audioEngine.context.currentTime - playStartRef.current;
      const currentOffset = (playOffsetRef.current + elapsed) % clipDuration;
      startPlayback(isBefore ? effectiveBufferId : (previewBufferId || effectiveBufferId), currentOffset);
    }
  };

  const handleProcess = async (targetScope: 'preview' | 'clip' | 'track') => {
    if (!clipId || !effectiveBufferId) return;
    
    // Determine which clips to process
    let clipsToProcess: any[] = [];
    if (targetScope === 'track') {
      const t = state.tracks.find(tr => tr.id === trackId);
      if (t) {
        clipsToProcess = [...t.clips];
        (t.lanes || []).forEach(l => clipsToProcess.push(...l.clips));
      }
    } else {
      clipsToProcess = [clip];
    }

    if (clipsToProcess.length === 0) return;
    setProcessing(true);

    const processSingleClip = (targetClip: any): Promise<{ newBufferId: string, aiScore: number, oldBufferId: string }> => {
      return new Promise((resolve, reject) => {
        const oldBufId = targetClip.bufferId || targetClip.id;
        const b = audioEngine.buffers.get(oldBufId);
        if (!b) return reject('No buffer');

        const channels: Float32Array[] = [];
        for (let c = 0; c < b.numberOfChannels; c++) {
          channels.push(new Float32Array(b.getChannelData(c)));
        }

        const worker = new Worker(
          new URL('../workers/authenticityProcessor.worker.ts', import.meta.url),
          { type: 'module' }
        );

        worker.onmessage = (e) => {
          if (e.data.error) {
            reject(e.data.error);
            return;
          }
          const { channels: outChannels, aiScore, perf } = e.data;
          if (perf) {
            setTelemetry(perf);
          }
          const newBuffer = audioEngine.context!.createBuffer(
            outChannels.length, outChannels[0].length, b.sampleRate
          );
          for (let c = 0; c < outChannels.length; c++) {
            newBuffer.copyToChannel(new Float32Array(outChannels[c]), c);
          }
          
          const newBufferId = `auth_${targetClip.id}_${Date.now()}`;
          audioEngine.buffers.set(newBufferId, newBuffer);
          worker.terminate();
          
          // Save buffer to local OPFS and cloud
          try {
            const wavBlob = audioBufferToWav(newBuffer);
            saveAsset(newBufferId, wavBlob).catch(console.error);
            uploadAssetCloud(newBufferId, wavBlob).catch(console.error);
          } catch (e) {
            console.error("Failed to save processed asset", e);
          }
          
          resolve({ newBufferId, aiScore, oldBufferId: oldBufId });
        };
        worker.onerror = reject;
        worker.postMessage({ channels, sampleRate: b.sampleRate, settings }, channels.map(c => c.buffer));
      });
    };

    try {
      if (targetScope === 'preview') {
        const res = await processSingleClip(clip);
        // Clean old preview
        if (previewBufferId && audioEngine.buffers.has(previewBufferId)) {
          audioEngine.buffers.delete(previewBufferId);
        }
        // It saves to auth_clipId_timestamp, we rename or just use it as preview
        setPreviewBufferId(res.newBufferId);
        setAiScoreAfter(res.aiScore);
        
        // Auto hot-swap playback if playing
        if (isPlaying && !showBefore) {
          const elapsed = audioEngine.context!.currentTime - playStartRef.current;
          const currentOffset = (playOffsetRef.current + elapsed) % clipDuration;
          startPlayback(res.newBufferId, currentOffset);
        }
      } else {
        // Apply to Clip or Track
        for (const targetClip of clipsToProcess) {
          const res = await processSingleClip(targetClip);
          
          dispatch({
            type: 'UPDATE_CLIP',
            payload: {
              trackId,
              clipId: targetClip.id,
              changes: { bufferId: res.newBufferId },
            },
          });
          
          if (targetClip.id === clipId) {
            setAiScoreAfter(res.aiScore);
          }
        }
        dispatch({ type: 'INCREMENT_BUFFERS_VERSION' });
        close();
      }
    } catch (err) {
      console.error("Processing failed", err);
    } finally {
      setProcessing(false);
    }
  };

  if (!clipId || !clip) return null;

  const buffer = audioEngine.buffers.get(effectiveBufferId);
  const clipDuration = clip?.duration || 1;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-md">
      <div
        className="relative w-[900px] max-w-[95vw] max-h-[90vh] overflow-y-auto bg-[#0d0d1a] border border-[#a882fa]/20 rounded-2xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#a882fa] to-[#f472b6] flex items-center justify-center">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold text-white tracking-tight">AI Authenticity Processor</h2>
                {telemetry && (
                  <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider font-mono ${telemetry.gpuAccelerated ? 'bg-[#38bdf8]/20 text-[#38bdf8] border border-[#38bdf8]/30' : 'bg-amber-500/20 text-amber-500 border border-amber-500/30'}`}>
                    {telemetry.gpuAccelerated ? '⚡ WebGPU Active' : '💻 Multi-Core CPU'}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-zinc-500 font-mono">
                Detected cutoff: <span className="text-[#a882fa]">{detectedCutoff > 20000 ? 'None' : `${detectedCutoff} Hz`}</span>
                {' · '}Clip: <span className="text-zinc-400">{clip.audioData || clipId}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 border-r border-white/10 pr-4">
              <button
                className="text-[11px] px-4 py-1.5 rounded-lg bg-white/5 text-zinc-300 hover:bg-white/10 font-bold transition-all disabled:opacity-30"
                disabled={processing}
                onClick={() => handleProcess('preview')}
              >
                {processing ? 'Processing…' : 'Update Preview'}
              </button>
              <button
                className="text-[11px] px-4 py-1.5 rounded-lg border border-[#a882fa]/30 text-[#a882fa] font-bold hover:bg-[#a882fa]/10 transition-all disabled:opacity-30"
                disabled={processing}
                onClick={() => handleProcess('track')}
              >
                Apply to Track
              </button>
              <button
                className="text-[11px] px-5 py-1.5 rounded-lg bg-gradient-to-r from-[#a882fa] to-[#f472b6] text-black font-bold hover:opacity-90 transition-all disabled:opacity-30"
                disabled={processing}
                onClick={() => handleProcess('clip')}
              >
                {processing ? 'Applying…' : 'Apply to Clip'}
              </button>
            </div>
            <button
              onClick={togglePlayback}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${isPlaying ? 'bg-[#ef4444]/20 text-[#ef4444]' : 'bg-[#22c55e]/20 text-[#22c55e]'}`}
            >
              {isPlaying ? (
                <><div className="w-2 h-2 bg-[#ef4444] rounded-sm" /> Stop Loop</>
              ) : (
                <><div className="w-0 h-0 border-t-4 border-t-transparent border-l-6 border-l-[#22c55e] border-b-4 border-b-transparent" /> Play Loop</>
              )}
            </button>
            <button
              onClick={close}
              className="w-7 h-7 rounded-full bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-colors"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Spectrogram Comparison */}
        <div className="px-6 pt-4 pb-2">
          <div className="flex items-center gap-2 mb-2">
            <button
              className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full transition-all ${showBefore ? 'bg-[#a882fa]/20 text-[#a882fa]' : 'text-zinc-500 hover:text-zinc-300'}`}
              onClick={() => handleViewToggle(true)}
            >
              Original
            </button>
            <button
              className={`text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full transition-all ${!showBefore ? 'bg-[#22c55e]/20 text-[#22c55e]' : 'text-zinc-500 hover:text-zinc-300'} ${!previewBufferId ? 'opacity-30 pointer-events-none' : ''}`}
              onClick={() => previewBufferId && handleViewToggle(false)}
            >
              Processed
            </button>
          </div>
          <div className="rounded-lg overflow-hidden border border-white/5 bg-[#070411]">
            <Spectrogram
              clipId={showBefore ? effectiveBufferId : (previewBufferId || effectiveBufferId)}
              bufferId={showBefore ? effectiveBufferId : (previewBufferId || effectiveBufferId)}
              duration={clipDuration}
              width={840}
              height={120}
              audioOffset={clip.audioOffset || 0}
            />
          </div>
        </div>

        {/* AI Score Gauges */}
        <div className="flex items-center justify-center gap-8 py-3 border-b border-white/5">
          <AIScoreGauge score={aiScoreBefore} label="AI Score (Before)" />
          {aiScoreAfter !== null && (
            <>
              <div className="text-zinc-600 text-lg">→</div>
              <AIScoreGauge score={aiScoreAfter} label="AI Score (After)" />
            </>
          )}
        </div>

        {/* Presets */}
        <div className="flex items-center gap-2 px-6 py-3 border-b border-white/5 overflow-x-auto">
          <span className="text-[9px] text-zinc-600 uppercase tracking-widest font-bold mr-1">Presets</span>
          {Object.keys(PRESETS).map(name => (
            <button
              key={name}
              className={`text-[10px] px-3 py-1.5 rounded-full font-bold tracking-tight transition-all whitespace-nowrap ${activePreset === name ? 'bg-[#a882fa] text-black' : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-white'}`}
              onClick={() => applyPreset(name, false)}
            >
              {name}
            </button>
          ))}
          {Object.keys(customPresets).length > 0 && <div className="w-px h-4 bg-white/10 mx-1" />}
          {Object.keys(customPresets).map(name => (
            <div key={`custom-${name}`} className="relative group">
              <button
                className={`text-[10px] pl-3 pr-6 py-1.5 rounded-full font-bold tracking-tight transition-all whitespace-nowrap ${activePreset === name ? 'bg-[#f472b6] text-black' : 'bg-[#f472b6]/10 text-[#f472b6] hover:bg-[#f472b6]/20'}`}
                onClick={() => applyPreset(name, true)}
              >
                {name}
              </button>
              <button
                className="absolute right-1.5 top-1/2 -translate-y-1/2 w-4 h-4 rounded-full flex items-center justify-center text-[#f472b6] hover:bg-[#f472b6] hover:text-black opacity-0 group-hover:opacity-100 transition-all"
                onClick={(e) => handleDeletePreset(name, e)}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6L6 18M6 6l12 12"/>
                </svg>
              </button>
            </div>
          ))}
          
          <div className="flex-1" />
          
          {isSavingPreset ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                className="bg-black/40 border border-zinc-700 text-white text-xs px-2 py-1 rounded outline-none focus:border-[#f472b6]"
                value={newPresetName}
                onChange={e => setNewPresetName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSavePreset()}
                placeholder="Preset name..."
              />
              <button className="text-xs bg-[#f472b6] text-black px-2 py-1 rounded font-bold" onClick={handleSavePreset}>Save</button>
              <button className="text-xs text-zinc-500 hover:text-white px-2 py-1" onClick={() => setIsSavingPreset(false)}>Cancel</button>
            </div>
          ) : (
            <button
              className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 hover:text-white flex items-center gap-1 bg-white/5 hover:bg-white/10 px-2 py-1.5 rounded transition-all"
              onClick={() => setIsSavingPreset(true)}
            >
              <span>+ Save</span>
            </button>
          )}
        </div>

        {/* Processing Modules */}
        <div className="grid grid-cols-2 gap-3 px-6 py-4">
          {/* Spectral Extension */}
          <div className="bg-white/[0.02] rounded-xl border border-white/5 p-3">
            <Toggle enabled={settings.spectralExtension.enabled} onChange={(v) => updateModule('spectralExtension', { enabled: v })} label="Spectral Extension" />
            <p className="text-[9px] text-zinc-600 mt-1 mb-2">Fills frequencies above AI cutoff with natural harmonics</p>
            <div className="flex gap-4">
              <Dial value={settings.spectralExtension.intensity} onChange={(v) => updateModule('spectralExtension', { intensity: v })} label="Intensity" color="#a882fa" />
            </div>
          </div>

          {/* Noise Floor */}
          <div className="bg-white/[0.02] rounded-xl border border-white/5 p-3">
            <Toggle enabled={settings.noiseFloor.enabled} onChange={(v) => updateModule('noiseFloor', { enabled: v })} label="Noise Floor" />
            <p className="text-[9px] text-zinc-600 mt-1 mb-2">Injects realistic analog noise to fill dead silence</p>
            <div className="flex gap-4 items-end">
              <Dial value={settings.noiseFloor.level} onChange={(v) => updateModule('noiseFloor', { level: v })} label="Level" color="#f472b6" />
              <div className="flex flex-col gap-1">
                <span className="text-[8px] text-zinc-600 uppercase tracking-wider">Profile</span>
                <select
                  className="bg-zinc-900 border border-zinc-800 text-zinc-300 text-[10px] rounded px-2 py-1 outline-none focus:border-[#a882fa]"
                  value={settings.noiseFloor.profile}
                  onChange={(e) => { updateModule('noiseFloor', { profile: e.target.value as NoiseProfile }); }}
                >
                  <option value="studio">Studio</option>
                  <option value="tape">Tape</option>
                  <option value="vinyl">Vinyl</option>
                  <option value="room">Room Tone</option>
                </select>
              </div>
            </div>
          </div>

          {/* Micro-Variation */}
          <div className="bg-white/[0.02] rounded-xl border border-white/5 p-3">
            <Toggle enabled={settings.microVariation.enabled} onChange={(v) => updateModule('microVariation', { enabled: v })} label="Micro-Variation" />
            <p className="text-[9px] text-zinc-600 mt-1 mb-2">Subtle wow & flutter to simulate analog imperfections</p>
            <div className="flex gap-4">
              <Dial value={settings.microVariation.amount} onChange={(v) => updateModule('microVariation', { amount: v })} label="Amount" color="#38bdf8" />
            </div>
          </div>

          {/* Spectral Smoothing */}
          <div className="bg-white/[0.02] rounded-xl border border-white/5 p-3">
            <Toggle enabled={settings.spectralSmoothing.enabled} onChange={(v) => updateModule('spectralSmoothing', { enabled: v })} label="Spectral Smoothing" />
            <p className="text-[9px] text-zinc-600 mt-1 mb-2">Softens the hard brick-wall frequency cutoff</p>
            <div className="flex gap-4">
              <Dial value={settings.spectralSmoothing.slope} onChange={(v) => updateModule('spectralSmoothing', { slope: v })} label="Slope" color="#fb923c" />
            </div>
          </div>

          {/* Harmonic Saturation */}
          <div className="bg-white/[0.02] rounded-xl border border-white/5 p-3">
            <Toggle enabled={settings.harmonicSaturation.enabled} onChange={(v) => updateModule('harmonicSaturation', { enabled: v })} label="Harmonic Saturation" />
            <p className="text-[9px] text-zinc-600 mt-1 mb-2">Adds tube/transistor warmth to sterile AI audio</p>
            <div className="flex gap-4">
              <Dial value={settings.harmonicSaturation.drive} onChange={(v) => updateModule('harmonicSaturation', { drive: v })} label="Drive" color="#ef4444" />
              <Dial value={settings.harmonicSaturation.even} onChange={(v) => updateModule('harmonicSaturation', { even: v })} label="Even" color="#f97316" />
              <Dial value={settings.harmonicSaturation.odd} onChange={(v) => updateModule('harmonicSaturation', { odd: v })} label="Odd" color="#eab308" />
            </div>
          </div>

          {/* Stereo Humanize */}
          <div className="bg-white/[0.02] rounded-xl border border-white/5 p-3">
            <Toggle enabled={settings.stereoHumanize.enabled} onChange={(v) => updateModule('stereoHumanize', { enabled: v })} label="Stereo Humanize" />
            <p className="text-[9px] text-zinc-600 mt-1 mb-2">Breaks up identical L/R channels with micro-delays & noise</p>
            <div className="flex gap-4">
              <Dial value={settings.stereoHumanize.width} onChange={(v) => updateModule('stereoHumanize', { width: v })} label="Width" color="#22c55e" />
            </div>
          </div>
        </div>

        {/* Telemetry and Hardware Diagnostics */}
        {telemetry && (
          <div className="mx-6 mb-2 p-3 bg-black/40 border border-white/5 rounded-xl flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest font-mono">⚡ Hardware & Pipeline Telemetry</span>
              <span className="text-[9px] text-[#38bdf8] font-mono">
                Total Latency: <strong>{telemetry.totalMs.toFixed(1)}ms</strong>
              </span>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <div className="bg-white/[0.02] p-2 rounded border border-white/5 flex flex-col">
                <span className="text-[8px] text-zinc-500 font-mono">Channel Processing</span>
                <span className="text-xs font-bold text-zinc-300 font-mono">{telemetry.parallelChannelMs.toFixed(1)}ms</span>
                <span className="text-[7px] text-[#38bdf8] font-mono">Parallel Workers</span>
              </div>
              <div className="bg-white/[0.02] p-2 rounded border border-white/5 flex flex-col">
                <span className="text-[8px] text-zinc-500 font-mono">Stereo Processing</span>
                <span className="text-xs font-bold text-zinc-300 font-mono">{telemetry.stereoMs.toFixed(1)}ms</span>
                <span className="text-[7px] text-[#22c55e] font-mono">Width & Correlation</span>
              </div>
              <div className="bg-white/[0.02] p-2 rounded border border-white/5 flex flex-col">
                <span className="text-[8px] text-zinc-500 font-mono">Auto-Gain Norm</span>
                <span className="text-xs font-bold text-zinc-300 font-mono">{telemetry.normalizeMs.toFixed(1)}ms</span>
                <span className="text-[7px] text-pink-500 font-mono">Anti-Clipping Gating</span>
              </div>
              <div className="bg-white/[0.02] p-2 rounded border border-white/5 flex flex-col">
                <span className="text-[8px] text-zinc-500 font-mono">FFT Acceleration</span>
                <span className="text-xs font-bold text-[#38bdf8] font-mono">
                  {telemetry.gpuAccelerated ? 'WebGPU Shader' : 'Optimized CPU'}
                </span>
                <span className="text-[7px] text-zinc-500 font-mono">Radix-2 Cooley-Tukey</span>
              </div>
            </div>
          </div>
        )}

        {/* Processing overlay */}
        {processing && (
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm rounded-2xl flex items-center justify-center z-50">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 rounded-full border-2 border-t-[#a882fa] border-r-[#f472b6] border-b-transparent border-l-transparent animate-spin" />
              <span className="text-sm text-[#a882fa] font-bold tracking-wider">Processing audio…</span>
              <span className="text-[10px] text-zinc-500 font-mono">Running 6-stage DSP pipeline</span>
            </div>
          </div>
        )}

        {/* Onboarding overlay */}
        {showOnboarding && (
          <div className="absolute inset-0 bg-black/80 backdrop-blur-md rounded-2xl flex items-center justify-center z-50 p-12">
            <div className="bg-[#1a1a2e] border border-[#a882fa]/30 rounded-xl p-8 max-w-[600px] shadow-2xl relative">
              <h3 className="text-2xl font-bold text-white mb-2 tracking-tight">Welcome to the Authenticity Processor</h3>
              <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
                This tool is designed to clean up telltale artifacts left behind by AI audio generation, giving your tracks a high-fidelity, analog sound.
              </p>
              
              <div className="space-y-4 mb-8">
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded bg-[#a882fa]/20 text-[#a882fa] flex items-center justify-center font-bold flex-shrink-0">1</div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Understanding the AI Score</h4>
                    <p className="text-xs text-zinc-500 mt-1">The AI Score analyzes the spectrogram for unnatural signs of generation, such as sudden "brick-wall" frequency cutoffs (e.g. dead silence above 16kHz) and digital phase correlations. A high score means it's likely AI.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded bg-[#f472b6]/20 text-[#f472b6] flex items-center justify-center font-bold flex-shrink-0">2</div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Previewing Changes</h4>
                    <p className="text-xs text-zinc-500 mt-1">Adjust the DSP modules below, then click <strong className="text-zinc-300">Update Preview</strong>. While the audio is looping, you can hot-swap between the <strong className="text-zinc-300">Original</strong> and <strong className="text-zinc-300">Processed</strong> views to instantly hear and see the difference.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded bg-[#38bdf8]/20 text-[#38bdf8] flex items-center justify-center font-bold flex-shrink-0">3</div>
                  <div>
                    <h4 className="text-sm font-bold text-white">Saving Presets</h4>
                    <p className="text-xs text-zinc-500 mt-1">Once you dial in the perfect analog warmth or tape noise, use the <strong className="text-zinc-300">+ Save</strong> button. Your custom presets are backed by the cloud and will load automatically when you return.</p>
                  </div>
                </div>
              </div>

              <button
                className="w-full py-3 rounded-lg bg-gradient-to-r from-[#a882fa] to-[#f472b6] text-black font-bold text-sm hover:opacity-90 transition-all"
                onClick={() => {
                  localStorage.setItem('jaad_ai_auth_onboarding_seen', 'true');
                  setShowOnboarding(false);
                }}
              >
                Let's get started
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
