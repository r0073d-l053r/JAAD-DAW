import React, { useState, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { X, Zap, Cpu, Wand2, Loader2, Sparkles, CheckCircle2 } from 'lucide-react';
import { useApp } from '../lib/store';
import { audioEngine } from '../lib/audioEngine';
import { type AnalogMasterSettings, ANALOG_MASTER_PRESETS } from '../lib/analogMaster';
import { autoMaster } from '../lib/stemAnalysis';
import { runAnalogMasterWorker } from '../lib/runAnalogMaster';
import { loadCustomPresets } from '../lib/analogPresets';
import { getGPUFFTAccelerator } from '../lib/gpuFFT';
import { saveAsset } from '../lib/assetManager';
import { uploadAssetCloud } from '../lib/syncUtils';
import { audioBufferToWav } from '../lib/exportUtils';

interface TrackResult { track: string; archetype: string; notes: string; gpu: boolean; }

export function MasterMix() {
  const { state, dispatch } = useApp();
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [manualPreset, setManualPreset] = useState('Air & Sheen');
  const [customPresets] = useState<Record<string, AnalogMasterSettings>>(() => loadCustomPresets());
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; label: string }>({ done: 0, total: 0, label: '' });
  const [results, setResults] = useState<TrackResult[]>([]);
  const [gpu, setGpu] = useState<{ available: boolean; name: string }>({ available: false, name: '…' });
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  const allPresets = useMemo(() => ({ ...ANALOG_MASTER_PRESETS, ...customPresets }), [customPresets]);

  // Every track that has at least one clip with a resident audio buffer.
  const targets = useMemo(() => {
    return state.tracks.map((t) => {
      const clips = [...t.clips, ...((t.lanes || []).flatMap((l) => l.clips))]
        .filter((c: any) => audioEngine.buffers.get(c.bufferId || c.id));
      return { track: t, clips };
    }).filter((x) => x.clips.length > 0);
  }, [state.tracks]);

  const totalClips = targets.reduce((n, x) => n + x.clips.length, 0);

  useEffect(() => {
    let cancelled = false;
    getGPUFFTAccelerator().then((acc) => {
      if (!cancelled) setGpu({ available: acc.available, name: acc.available ? 'WebGPU' : 'Multi-core CPU' });
    });
    return () => { cancelled = true; };
  }, []);

  const close = () => { if (!processing) dispatch({ type: 'SET_MASTER_MIX_OPEN', payload: false }); };

  const run = async () => {
    if (!audioEngine.context || targets.length === 0) return;
    setProcessing(true); setError(null); setResults([]); setFinished(false);
    const res: TrackResult[] = [];
    let done = 0;
    try {
      for (const { track, clips } of targets) {
        // Decide this stem's settings.
        let settings: AnalogMasterSettings;
        let archetype = 'manual';
        let notes = manualPreset;
        if (mode === 'auto') {
          // Analyze the longest clip as the stem's representative.
          const rep = clips.reduce((a, b) => {
            const la = audioEngine.buffers.get(a.bufferId || a.id)!.length;
            const lb = audioEngine.buffers.get(b.bufferId || b.id)!.length;
            return lb > la ? b : a;
          });
          const rbuf = audioEngine.buffers.get(rep.bufferId || rep.id)!;
          const rchans: Float32Array[] = [];
          for (let c = 0; c < rbuf.numberOfChannels; c++) rchans.push(rbuf.getChannelData(c));
          const decision = autoMaster(rchans, rbuf.sampleRate);
          settings = decision.settings; archetype = decision.archetype; notes = decision.notes || 'balanced';
        } else {
          settings = allPresets[manualPreset] ?? ANALOG_MASTER_PRESETS['Air & Sheen'];
        }

        let usedGpu = false;
        for (const clip of clips) {
          const buf = audioEngine.buffers.get(clip.bufferId || clip.id)!;
          const chans: Float32Array[] = [];
          for (let c = 0; c < buf.numberOfChannels; c++) chans.push(buf.getChannelData(c));
          setProgress({ done, total: totalClips, label: `${track.name} — ${archetype}` });
          const out = await runAnalogMasterWorker(chans, buf.sampleRate, settings);
          usedGpu = usedGpu || out.gpu;
          const nb = audioEngine.context.createBuffer(out.channels.length, out.channels[0].length, buf.sampleRate);
          for (let c = 0; c < out.channels.length; c++) nb.copyToChannel(new Float32Array(out.channels[c]), c);
          const newId = `amaster_${clip.id}_${Date.now()}`;
          audioEngine.buffers.set(newId, nb);
          try {
            const wav = audioBufferToWav(nb);
            saveAsset(newId, wav).catch(() => {});
            uploadAssetCloud(newId, wav).catch(() => {});
          } catch { /* best-effort persistence */ }
          dispatch({ type: 'UPDATE_CLIP', payload: { trackId: track.id, clipId: clip.id, changes: { bufferId: newId } } });
          done++;
          setProgress({ done, total: totalClips, label: `${track.name} — ${archetype}` });
        }
        res.push({ track: track.name, archetype, notes, gpu: usedGpu });
        setResults([...res]);
      }
      dispatch({ type: 'INCREMENT_BUFFERS_VERSION' });
      setFinished(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProcessing(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100000] flex items-center justify-center animate-in fade-in duration-300">
      <div className="absolute inset-0 bg-[#050507]/85 backdrop-blur-xl" onClick={close} />
      <div className="relative w-full max-w-lg rounded-3xl bg-gradient-to-b from-[#14121c] to-[#0b0a10] border border-white/10 shadow-[0_0_80px_rgba(0,0,0,0.7)] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#a882fa]/15 border border-[#a882fa]/30 flex items-center justify-center text-[#a882fa]">
              <Sparkles size={18} />
            </div>
            <div>
              <h2 className="text-sm font-black text-white tracking-tight uppercase">Restore My Mix</h2>
              <p className="text-[9px] text-zinc-500 uppercase tracking-widest">Per-stem analog restoration</p>
            </div>
          </div>
          <button onClick={close} disabled={processing} className="text-zinc-500 hover:text-white p-2 rounded-lg hover:bg-white/10 transition disabled:opacity-40">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {/* GPU + scope summary */}
          <div className="flex items-center justify-between text-[10px] font-mono">
            <span className="text-zinc-400">{targets.length} stems · {totalClips} clips</span>
            <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md border ${gpu.available ? 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400' : 'bg-white/5 border-white/10 text-zinc-400'}`}>
              {gpu.available ? <Zap size={11} /> : <Cpu size={11} />}{gpu.name}
            </span>
          </div>

          {/* Mode */}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => setMode('auto')} disabled={processing}
              className={`p-3 rounded-xl border text-left transition disabled:opacity-50 ${mode === 'auto' ? 'bg-[#a882fa]/15 border-[#a882fa]/40' : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06]'}`}>
              <div className="flex items-center gap-2 text-xs font-bold text-white"><Wand2 size={14} className="text-[#a882fa]" /> Auto (per stem)</div>
              <p className="text-[10px] text-zinc-500 mt-1 leading-snug">Analyzes each stem and picks its own restoration.</p>
            </button>
            <button onClick={() => setMode('manual')} disabled={processing}
              className={`p-3 rounded-xl border text-left transition disabled:opacity-50 ${mode === 'manual' ? 'bg-[#a882fa]/15 border-[#a882fa]/40' : 'bg-white/[0.03] border-white/10 hover:bg-white/[0.06]'}`}>
              <div className="text-xs font-bold text-white">Manual</div>
              <p className="text-[10px] text-zinc-500 mt-1 leading-snug">One preset applied to every stem.</p>
            </button>
          </div>

          {mode === 'manual' && (
            <div className="flex flex-wrap gap-2">
              {Object.keys(allPresets).map((name) => (
                <button key={name} onClick={() => setManualPreset(name)} disabled={processing}
                  className={`text-[10px] px-3 py-1.5 rounded-full border transition ${manualPreset === name ? 'bg-[#a882fa]/20 border-[#a882fa]/40 text-[#a882fa]' : 'bg-white/[0.03] border-white/10 text-zinc-400 hover:text-white'}`}>
                  {name}{customPresets[name] ? ' ★' : ''}
                </button>
              ))}
            </div>
          )}

          {/* Progress */}
          {processing && (
            <div className="space-y-1.5">
              <div className="flex justify-between text-[10px] text-zinc-400 font-mono">
                <span className="truncate">{progress.label}</span><span>{progress.done}/{progress.total}</span>
              </div>
              <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className="h-full bg-[#a882fa] transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
              </div>
            </div>
          )}

          {/* Per-stem results */}
          {results.length > 0 && (
            <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar pr-1">
              {results.map((r, i) => (
                <div key={i} className="flex items-center justify-between text-[11px] px-3 py-1.5 rounded-lg bg-white/[0.03] border border-white/5">
                  <span className="text-zinc-300 truncate mr-2">{r.track}</span>
                  <span className="text-[10px] text-[#a882fa] font-mono shrink-0">{r.archetype}{r.notes ? ` · ${r.notes}` : ''}</span>
                </div>
              ))}
            </div>
          )}

          {error && <p className="text-[11px] text-red-400">{error}</p>}
          {finished && !error && (
            <p className="flex items-center gap-2 text-[11px] text-emerald-400"><CheckCircle2 size={14} /> Restored {results.length} stems. Play it back and A/B with undo (Ctrl+Z).</p>
          )}
        </div>

        {/* Action */}
        <div className="p-6 pt-0">
          <button onClick={run} disabled={processing || targets.length === 0}
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-black bg-[#a882fa]/20 border border-[#a882fa]/40 text-[#a882fa] hover:bg-[#a882fa]/30 transition disabled:opacity-40">
            {processing ? <><Loader2 size={16} className="animate-spin" /> Restoring…</> : <><Sparkles size={16} /> {mode === 'auto' ? 'Analyze & Restore All Stems' : 'Master All Stems'}</>}
          </button>
          {targets.length === 0 && <p className="text-[10px] text-zinc-500 text-center mt-2">No stems with loaded audio to process.</p>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
