import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Cpu, Zap, Play, Square, Wand2, Loader2 } from 'lucide-react';
import { useApp } from '../lib/store';
import { audioEngine } from '../lib/audioEngine';
import {
  type AnalogMasterSettings,
  ANALOG_MASTER_DEFAULTS,
  ANALOG_MASTER_PRESETS,
} from '../lib/analogMaster';
import { saveAsset } from '../lib/assetManager';
import { uploadAssetCloud } from '../lib/syncUtils';
import { audioBufferToWav } from '../lib/exportUtils';

// Probe WebGPU + adapter identity (browsers may mask the exact device name).
async function probeGPU(): Promise<{ available: boolean; name: string }> {
  const gpu = (navigator as unknown as { gpu?: any }).gpu;
  if (!gpu) return { available: false, name: 'Multi-core CPU' };
  try {
    const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    if (!adapter) return { available: false, name: 'Multi-core CPU' };
    let name = 'WebGPU';
    try {
      const info = adapter.info || (adapter.requestAdapterInfo ? await adapter.requestAdapterInfo() : null);
      if (info) {
        const parts = [info.description, info.device, info.architecture, info.vendor].filter(Boolean);
        if (parts.length) name = `WebGPU · ${parts[0]}`;
      }
    } catch { /* adapter info not exposed */ }
    return { available: true, name };
  } catch {
    return { available: false, name: 'Multi-core CPU' };
  }
}

function Slider({ label, value, min, max, step, unit, display, onChange }: {
  label: string; value: number; min: number; max: number; step: number;
  unit?: string; display?: string; onChange: (v: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between items-center">
        <span className="text-[11px] text-zinc-400 font-medium">{label}</span>
        <span className="text-[11px] font-mono text-zinc-500">{display ?? `${value}${unit ?? ''}`}</span>
      </div>
      <input
        type="range" aria-label={label} min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 accent-[#a882fa] cursor-pointer"
      />
    </div>
  );
}

export function AnalogMaster() {
  const { state, dispatch } = useApp();
  const clipId = state.analogMasterClipId;

  const [settings, setSettings] = useState<AnalogMasterSettings>({ ...ANALOG_MASTER_DEFAULTS });
  const [activePreset, setActivePreset] = useState<string | null>('Air & Sheen');
  const [processing, setProcessing] = useState(false);
  const [previewBuffer, setPreviewBuffer] = useState<AudioBuffer | null>(null);
  const [playing, setPlaying] = useState<'off' | 'original' | 'processed'>('off');
  const [gpu, setGpu] = useState<{ available: boolean; name: string }>({ available: false, name: '…' });
  const [lastRunGpu, setLastRunGpu] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const srcRef = useRef<AudioBufferSourceNode | null>(null);

  // Locate the target clip + its buffer.
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
  const bufferId = clip?.bufferId || clipId || '';

  useEffect(() => { probeGPU().then(setGpu); }, []);
  useEffect(() => () => stop(), []); // stop preview on unmount

  const set = <K extends keyof AnalogMasterSettings>(key: K, v: AnalogMasterSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: v }));
    setActivePreset(null);
    setPreviewBuffer(null); // settings changed → preview is stale
  };

  const applyPreset = (name: string) => {
    setSettings({ ...ANALOG_MASTER_PRESETS[name] });
    setActivePreset(name);
    setPreviewBuffer(null);
  };

  function stop() {
    if (srcRef.current) {
      try { srcRef.current.stop(); } catch { /* already stopped */ }
      try { srcRef.current.disconnect(); } catch { /* noop */ }
      srcRef.current = null;
    }
    setPlaying('off');
  }

  const play = (buf: AudioBuffer, which: 'original' | 'processed') => {
    stop();
    const ctx = audioEngine.context;
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.connect(ctx.destination);
    s.start();
    s.onended = () => setPlaying('off');
    srcRef.current = s;
    setPlaying(which);
  };

  // Run one clip through the worker → new buffer id (persisted to OPFS + cloud).
  const processClip = (targetClip: any): Promise<{ newBufferId: string; buffer: AudioBuffer; gpu: boolean }> =>
    new Promise((resolve, reject) => {
      const oldBufId = targetClip.bufferId || targetClip.id;
      const b = audioEngine.buffers.get(oldBufId);
      if (!b || !audioEngine.context) { reject(new Error('No audio buffer for this clip')); return; }

      const channels: Float32Array[] = [];
      for (let c = 0; c < b.numberOfChannels; c++) channels.push(new Float32Array(b.getChannelData(c)));

      const worker = new Worker(new URL('../workers/analogMaster.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => {
        if (e.data.error) { worker.terminate(); reject(new Error(e.data.error)); return; }
        const { channels: out, gpu: usedGpu } = e.data as { channels: Float32Array[]; gpu: boolean };
        const nb = audioEngine.context!.createBuffer(out.length, out[0].length, b.sampleRate);
        for (let c = 0; c < out.length; c++) nb.copyToChannel(new Float32Array(out[c]), c);
        const newBufferId = `amaster_${targetClip.id}_${Date.now()}`;
        audioEngine.buffers.set(newBufferId, nb);
        worker.terminate();
        try {
          const wav = audioBufferToWav(nb);
          saveAsset(newBufferId, wav).catch(() => {});
          uploadAssetCloud(newBufferId, wav).catch(() => {});
        } catch { /* persistence is best-effort */ }
        resolve({ newBufferId, buffer: nb, gpu: usedGpu });
      };
      worker.onerror = (err) => { worker.terminate(); reject(new Error(err.message || 'worker error')); };
      worker.postMessage({ channels, sampleRate: b.sampleRate, settings }, channels.map((c) => c.buffer));
    });

  const doPreview = async () => {
    if (!clip) return;
    setProcessing(true); setError(null);
    try {
      const res = await processClip(clip);
      setPreviewBuffer(res.buffer);
      setLastRunGpu(res.gpu);
      play(res.buffer, 'processed');
    } catch (e) { setError((e as Error).message); }
    finally { setProcessing(false); }
  };

  const doApply = async (scope: 'clip' | 'track') => {
    if (!clip) return;
    stop();
    let targets: any[] = [clip];
    if (scope === 'track') {
      const t = state.tracks.find((tr) => tr.id === trackId);
      if (t) { targets = [...t.clips]; (t.lanes || []).forEach((l) => targets.push(...l.clips)); }
    }
    setProcessing(true); setError(null);
    try {
      for (const tc of targets) {
        const res = await processClip(tc);
        setLastRunGpu(res.gpu);
        dispatch({ type: 'UPDATE_CLIP', payload: { trackId, clipId: tc.id, changes: { bufferId: res.newBufferId } } });
      }
      close();
    } catch (e) { setError((e as Error).message); }
    finally { setProcessing(false); }
  };

  const close = () => { stop(); dispatch({ type: 'SET_ANALOG_MASTER_CLIP', payload: null }); };

  if (!clipId) return null;

  const hasBuffer = !!audioEngine.buffers.get(bufferId);

  return createPortal(
    <div className="fixed inset-0 z-[100000] flex items-center justify-center animate-in fade-in duration-300">
      <div className="absolute inset-0 bg-[#050507]/85 backdrop-blur-xl" onClick={close} />
      <div className="relative w-full max-w-md rounded-3xl bg-gradient-to-b from-[#14121c] to-[#0b0a10] border border-white/10 shadow-[0_0_80px_rgba(0,0,0,0.7)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#a882fa]/15 border border-[#a882fa]/30 flex items-center justify-center text-[#a882fa]">
              <Wand2 size={18} />
            </div>
            <div>
              <h2 className="text-sm font-black text-white tracking-tight uppercase">Analog Master</h2>
              <p className="text-[9px] text-zinc-500 uppercase tracking-widest">Character · Exciter · Width</p>
            </div>
          </div>
          <button onClick={close} className="text-zinc-500 hover:text-white p-2 rounded-lg hover:bg-white/10 transition">
            <X size={18} />
          </button>
        </div>

        {/* GPU status badge */}
        <div className="px-6 pt-4">
          <div className={`flex items-center gap-2 text-[10px] font-mono px-3 py-2 rounded-lg border ${
            gpu.available ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400' : 'bg-white/5 border-white/10 text-zinc-400'
          }`}>
            {gpu.available ? <Zap size={12} /> : <Cpu size={12} />}
            <span className="truncate">
              FFT: {gpu.available ? gpu.name : 'Multi-core CPU'}
              {lastRunGpu !== null && ` · last run ${lastRunGpu ? 'GPU' : 'CPU'}`}
            </span>
          </div>
        </div>

        {/* Presets */}
        <div className="px-6 pt-4 flex flex-wrap gap-2">
          {Object.keys(ANALOG_MASTER_PRESETS).map((name) => (
            <button key={name} onClick={() => applyPreset(name)}
              className={`text-[10px] px-3 py-1.5 rounded-full border transition ${
                activePreset === name ? 'bg-[#a882fa]/20 border-[#a882fa]/40 text-[#a882fa]' : 'bg-white/[0.03] border-white/10 text-zinc-400 hover:text-white'
              }`}>{name}</button>
          ))}
        </div>

        {/* Sliders */}
        <div className="px-6 py-5 grid grid-cols-2 gap-x-5 gap-y-4">
          <Slider label="Exciter" value={settings.exciter} min={0} max={1} step={0.01}
            display={`${Math.round(settings.exciter * 100)}%`} onChange={(v) => set('exciter', v)} />
          <Slider label="Exciter Freq" value={settings.exciterFreq} min={3000} max={14000} step={100}
            display={`${(settings.exciterFreq / 1000).toFixed(1)}k`} onChange={(v) => set('exciterFreq', v)} />
          <Slider label="Saturation" value={settings.saturation} min={0} max={1} step={0.01}
            display={`${Math.round(settings.saturation * 100)}%`} onChange={(v) => set('saturation', v)} />
          <Slider label="Width" value={settings.width} min={0} max={2} step={0.01}
            display={`${settings.width.toFixed(2)}×`} onChange={(v) => set('width', v)} />
          <Slider label="Air" value={settings.air} min={0} max={1} step={0.01}
            display={`${Math.round(settings.air * 100)}%`} onChange={(v) => set('air', v)} />
          <Slider label="Warmth" value={settings.warmth} min={0} max={1} step={0.01}
            display={`${Math.round(settings.warmth * 100)}%`} onChange={(v) => set('warmth', v)} />
          <div className="col-span-2">
            <Slider label="Dry / Wet Mix" value={settings.mix} min={0} max={1} step={0.01}
              display={`${Math.round(settings.mix * 100)}%`} onChange={(v) => set('mix', v)} />
          </div>
        </div>

        {/* A/B preview */}
        <div className="px-6 flex items-center gap-2">
          <button
            disabled={!hasBuffer}
            onClick={() => { const b = audioEngine.buffers.get(bufferId); if (!b) return; if (playing === 'original') stop(); else play(b, 'original'); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-bold border transition disabled:opacity-40 ${
              playing === 'original' ? 'bg-white/15 border-white/20 text-white' : 'bg-white/[0.03] border-white/10 text-zinc-300 hover:bg-white/10'
            }`}>
            {playing === 'original' ? <Square size={12} /> : <Play size={12} />} Original
          </button>
          <button
            disabled={!previewBuffer}
            onClick={() => { if (!previewBuffer) return; if (playing === 'processed') stop(); else play(previewBuffer, 'processed'); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-[11px] font-bold border transition disabled:opacity-40 ${
              playing === 'processed' ? 'bg-[#a882fa]/25 border-[#a882fa]/40 text-[#a882fa]' : 'bg-white/[0.03] border-white/10 text-zinc-300 hover:bg-white/10'
            }`}>
            {playing === 'processed' ? <Square size={12} /> : <Play size={12} />} Processed
          </button>
        </div>

        {error && <p className="px-6 pt-3 text-[11px] text-red-400">{error}</p>}

        {/* Actions */}
        <div className="p-6 flex gap-2">
          <button disabled={processing || !hasBuffer} onClick={doPreview}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-xs font-bold bg-white/[0.04] border border-white/10 text-white hover:bg-white/10 transition disabled:opacity-40">
            {processing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Preview
          </button>
          <button disabled={processing || !hasBuffer} onClick={() => doApply('clip')}
            className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-[#a882fa]/20 border border-[#a882fa]/40 text-[#a882fa] hover:bg-[#a882fa]/30 transition disabled:opacity-40">
            Apply to Clip
          </button>
          <button disabled={processing || !hasBuffer} onClick={() => doApply('track')}
            className="flex-1 py-2.5 rounded-xl text-xs font-bold bg-white/[0.04] border border-white/10 text-zinc-300 hover:bg-white/10 transition disabled:opacity-40">
            Apply to Track
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
