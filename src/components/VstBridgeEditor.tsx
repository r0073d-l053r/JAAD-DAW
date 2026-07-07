import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, useDragControls } from 'motion/react';
import { X, Cpu, Wifi, WifiOff, RefreshCw, Layers, Monitor, UploadCloud } from 'lucide-react';
import { useApp } from '../lib/store';
import { audioEngine } from '../lib/audioEngine';
import { LiquidGlassPanel } from './LiquidGlass';
import { VstParameter, getDefaultDspUrl } from '../lib/cloudVstBridge';

export const VstBridgeEditor: React.FC = () => {
  const { state, dispatch } = useApp();
  const dragControls = useDragControls();
  // Saved URL first, then the origin-aware default (wss://host/dsp on proxied
  // https deployments; ws://localhost:8080 in local dev).
  const [wsUrl, setWsUrl] = useState<string>(
    () =>
      (typeof localStorage !== 'undefined' && localStorage.getItem('jaad_dsp_url')) ||
      getDefaultDspUrl(),
  );
  const [status, setStatus] = useState<string>('disconnected');
  const [latency, setLatency] = useState<number>(0);
  const [params, setParams] = useState<Record<string, VstParameter>>({});
  const [pluginPath, setPluginPath] = useState<string>('');
  const [showGui, setShowGui] = useState<boolean>(false);

  // Drag-and-drop plugin upload
  const [isUploading, setIsUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileRef = useRef<File | null>(null);

  const trackId = state.vstEditorTrackId;
  const track = state.tracks.find(t => t.id === trackId);
  const bridgeRef = useRef<any>(null);

  // Upload a plugin over the (connected) bridge, then load it by name.
  const runUpload = useCallback(async (file: File) => {
    if (!trackId) return;
    const bridge = audioEngine.cloudVstBridges.get(trackId);
    if (!bridge) { setUploadMsg('Not connected to the bridge.'); return; }
    setIsUploading(true);
    setUploadMsg(`Uploading ${file.name}…`);
    try {
      const name = await bridge.uploadPlugin(file);
      setPluginPath(name);
      setUploadMsg(`Uploaded — loading ${name}…`);
      bridge.loadPlugin(name);
      setTimeout(() => setUploadMsg(`Loaded ${name}`), 500);
    } catch (e) {
      setUploadMsg(`Upload failed: ${(e as Error).message}`);
    } finally {
      setIsUploading(false);
    }
  }, [trackId]);

  // If a file was dropped before the bridge was connected, upload once it is.
  useEffect(() => {
    if (status === 'connected' && pendingFileRef.current) {
      const f = pendingFileRef.current;
      pendingFileRef.current = null;
      runUpload(f);
    }
  }, [status, runUpload]);

  // Poll VST status, latency metrics, and parameters
  useEffect(() => {
    if (!trackId) return;

    const interval = setInterval(() => {
      const bridge = audioEngine.cloudVstBridges.get(trackId);
      if (bridge) {
        bridgeRef.current = bridge;
        setStatus(bridge.status);
        setLatency(bridge.latencyMs);
        setParams({ ...bridge.parameters });
      } else {
        setStatus('disconnected');
        setLatency(0);
      }
    }, 150);

    return () => clearInterval(interval);
  }, [trackId]);

  if (!trackId || !track) return null;

  const handleConnect = () => {
    // Persist so future sessions (and other tracks' bridges) reuse what worked.
    try {
      localStorage.setItem('jaad_dsp_url', wsUrl.trim());
    } catch {
      // Storage unavailable (private mode) — connection still proceeds.
    }
    let bridge = audioEngine.cloudVstBridges.get(trackId);
    if (!bridge) {
      bridge = audioEngine.addCloudVstBridge(trackId);
    }
    if (bridge) {
      bridge.connect(wsUrl.trim());
    }
  };

  const handleDisconnect = () => {
    audioEngine.removeCloudVstBridge(trackId);
    setStatus('disconnected');
    setLatency(0);
    setShowGui(false);
  };

  // Drag-drop / file-picker entry point: validate, then upload — connecting
  // first (and deferring the upload to the effect above) if needed.
  const startUpload = (file: File) => {
    if (!/\.(dll|vst3|so)$/i.test(file.name)) {
      setUploadMsg('Only .dll, .vst3, or .so plugin files are supported.');
      return;
    }
    const bridge = audioEngine.cloudVstBridges.get(trackId);
    if (!bridge || status !== 'connected') {
      pendingFileRef.current = file;
      setUploadMsg(`Connecting to upload ${file.name}…`);
      handleConnect();
      return;
    }
    runUpload(file);
  };

  const handleLoadPlugin = () => {
    const bridge = bridgeRef.current;
    if (bridge && pluginPath.trim()) bridge.loadPlugin(pluginPath.trim());
  };

  // Virtual control knob component
  const Knobby: React.FC<{
    name: string;
    paramKey: string;
    param: VstParameter;
  }> = ({ name, paramKey, param }) => {
    const [isDragging, setIsDragging] = useState(false);
    const startYRef = useRef(0);
    const startValRef = useRef(0);

    const handlePointerDown = (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
      startYRef.current = e.clientY;
      startValRef.current = param.value;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaY = startYRef.current - moveEvent.clientY; // up is positive
        const sensitivity = 0.005;
        const newValue = Math.max(0, Math.min(1, startValRef.current + deltaY * sensitivity));
        
        if (bridgeRef.current) {
          bridgeRef.current.setParameter(paramKey, newValue);
        }
      };

      const handlePointerUp = () => {
        setIsDragging(false);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    };

    // Calculate angle: 0..1 mapped to -135deg to +135deg
    const angle = -135 + param.value * 270;
    
    // Circular gauge properties
    const radius = 22;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (param.value * 0.75) * circumference; // 3/4 circle filled

    return (
      <div className="flex flex-col items-center select-none space-y-1.5 p-2 bg-zinc-950/40 rounded-xl border border-white/5 shadow-inner">
        <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider font-mono">{name}</span>
        
        <div
          onPointerDown={handlePointerDown}
          className={`relative w-14 h-14 cursor-ns-resize flex items-center justify-center rounded-full transition-transform active:scale-95 ${isDragging ? 'text-pink-400' : 'text-[#a882fa]'}`}
        >
          {/* Circular Track */}
          <svg className="absolute w-full h-full transform -rotate-90">
            <circle
              cx="28"
              cy="28"
              r={radius}
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="3"
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * 0.25} // blank bottom gap
              className="transform rotate-45 origin-center"
            />
            {/* Active Gauge */}
            <circle
              cx="28"
              cy="28"
              r={radius}
              stroke="currentColor"
              strokeWidth="3.5"
              fill="none"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              className="transform rotate-135 origin-center transition-all duration-75 filter drop-shadow-[0_0_4px_rgba(168,130,250,0.5)]"
            />
          </svg>

          {/* Inner Cap & Needle */}
          <div className="w-9 h-9 bg-zinc-900 rounded-full border border-zinc-800 flex items-center justify-center shadow-lg relative">
            <div
              className="absolute top-1.5 w-0.5 h-3 bg-pink-500 rounded-full origin-bottom"
              style={{ transform: `rotate(${angle}deg)`, transformOrigin: '50% 100%' }}
            />
            {/* Inner Center Dot */}
            <div className="w-1.5 h-1.5 bg-zinc-950 rounded-full border border-zinc-700/80" />
          </div>
        </div>

        {/* Display value */}
        <span className="text-[9px] font-mono font-bold text-zinc-300 tracking-tight">
          {param.unit && param.unit !== '%'
            ? `${Math.round(param.min + param.value * (param.max - param.min))} ${param.unit}`
            : `${Math.round(param.value * 100)} %`}
        </span>
      </div>
    );
  };

  return (
    <motion.div
      drag
      dragMomentum={false}
      dragListener={false}
      dragControls={dragControls}
      initial={{ x: window.innerWidth - 450, y: 150 }}
      className="fixed z-50 w-[380px] shadow-3xl select-none"
    >
      <LiquidGlassPanel
        cornerRadius={16}
        blurAmount={36}
        backgroundOpacity={0.3}
        className="border border-[#3c1e7a]/60 overflow-hidden"
        contentClassName="flex flex-col"
      >
        {/* Title Bar */}
        <div 
          onPointerDown={(e) => dragControls.start(e)}
          className="vst-editor-titlebar flex justify-between items-center bg-[#080415]/90 border-b border-[#231242] px-3.5 py-2.5 cursor-move"
        >
          <div className="flex items-center gap-2">
            <Cpu size={14} className="text-[#a882fa] animate-pulse" />
            <span className="text-[11px] font-bold tracking-widest text-[#cda4ff] uppercase font-mono">
              VST Cloud Bridge: {track.name.toUpperCase()}
            </span>
          </div>
          <button
            onClick={() => dispatch({ type: 'SET_VST_EDITOR_TRACK', payload: null })}
            className="text-zinc-500 hover:text-white transition"
          >
            <X size={14} />
          </button>
        </div>

        {/* WebSocket Connection Details */}
        <div 
          onPointerDown={(e) => e.stopPropagation()}
          className="bg-[#05030e]/80 p-4 space-y-3.5 border-b border-[#231242]/50"
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={wsUrl}
              onChange={(e) => setWsUrl(e.target.value)}
              className="flex-1 bg-[#100a23] border border-[#30165a] rounded-lg px-3 py-1.5 text-xs text-purple-200 focus:outline-none focus:border-[#a882fa] font-mono"
              placeholder="ws://localhost:8080"
            />
            {status === 'connected' ? (
              <button
                onClick={handleDisconnect}
                className="bg-red-500/20 hover:bg-red-500/30 text-red-300 border border-red-500/40 text-xs px-3 py-1.5 rounded-lg font-bold transition font-mono uppercase"
              >
                Disconnect
              </button>
            ) : (
              <button
                onClick={handleConnect}
                className="bg-[#a882fa]/20 hover:bg-[#a882fa]/30 text-purple-300 border border-[#a882fa]/40 text-xs px-3 py-1.5 rounded-lg font-bold transition font-mono uppercase"
              >
                Connect
              </button>
            )}
          </div>

          {/* Connection Status Metrics */}
          <div className="flex justify-between items-center bg-[#070411]/90 rounded-lg p-2.5 border border-zinc-800/40 text-[10px] font-mono">
            <div className="flex items-center gap-1.5">
              {status === 'connected' ? (
                <>
                  <Wifi size={12} className="text-green-400" />
                  <span className="text-green-400 font-bold uppercase">Cloud Synced</span>
                </>
              ) : status === 'connecting' ? (
                <>
                  <RefreshCw size={12} className="text-yellow-400 animate-spin" />
                  <span className="text-yellow-400 font-bold uppercase">Connecting...</span>
                </>
              ) : status === 'fallback' ? (
                <>
                  <Layers size={12} className="text-orange-400" />
                  <span className="text-orange-400 font-bold uppercase">Local Fallback</span>
                </>
              ) : (
                <>
                  <WifiOff size={12} className="text-zinc-500" />
                  <span className="text-zinc-500 font-bold uppercase">Disconnected</span>
                </>
              )}
            </div>

            <div className="text-right flex items-center gap-2">
              <span className="text-zinc-500">Latency:</span>
              <span className={`font-bold ${latency > 80 ? 'text-red-400 animate-pulse' : latency > 30 ? 'text-yellow-400' : 'text-green-400'}`}>
                {latency.toFixed(1)} ms
              </span>
            </div>
          </div>
        </div>

        {/* Plugin load (type a name, or drag-and-drop / browse to upload) + GUI */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          onDragOver={(e) => { e.preventDefault(); if (!dragOver) setDragOver(true); }}
          onDragLeave={(e) => { e.preventDefault(); setDragOver(false); }}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files?.[0];
            if (f) startUpload(f);
          }}
          className={`bg-[#05030e]/80 p-4 space-y-2.5 border-b border-[#231242]/50 transition-all ${
            dragOver ? 'ring-2 ring-inset ring-[#a882fa] bg-[#a882fa]/10' : ''
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".dll,.vst3,.so"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) startUpload(f);
              e.target.value = '';
            }}
          />
          <div className="flex gap-2">
            <input
              type="text"
              value={pluginPath}
              onChange={(e) => setPluginPath(e.target.value)}
              className="flex-1 bg-[#100a23] border border-[#30165a] rounded-lg px-3 py-1.5 text-xs text-purple-200 focus:outline-none focus:border-[#a882fa] font-mono"
              placeholder="MyPlugin.dll  (in /vst)"
            />
            <button
              onClick={handleLoadPlugin}
              disabled={status !== 'connected' || !pluginPath.trim()}
              className="bg-[#a882fa]/20 hover:bg-[#a882fa]/30 disabled:opacity-40 text-purple-300 border border-[#a882fa]/40 text-xs px-3 py-1.5 rounded-lg font-bold transition font-mono uppercase"
            >
              Load
            </button>
          </div>

          {/* Drag-and-drop upload zone */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className={`w-full flex items-center justify-center gap-2 border border-dashed rounded-lg px-3 py-2 text-[11px] font-mono transition ${
              dragOver
                ? 'border-[#a882fa] text-purple-200'
                : 'border-[#30165a] hover:border-[#a882fa]/60 text-purple-300/70'
            } disabled:opacity-50`}
          >
            <UploadCloud size={13} className={isUploading ? 'animate-pulse' : ''} />
            {isUploading
              ? (uploadMsg || 'Uploading…')
              : dragOver
                ? 'Drop plugin to upload to the server'
                : 'Drag & drop a .dll / .vst3 — or click to browse'}
          </button>
          {uploadMsg && !isUploading && (
            <p className="text-[10px] text-purple-300/70 text-center font-mono truncate">{uploadMsg}</p>
          )}
          <button
            onClick={() => setShowGui((v) => !v)}
            disabled={status !== 'connected'}
            className="w-full flex items-center justify-center gap-2 bg-[#100a23]/60 hover:bg-[#160c30] disabled:opacity-40 border border-[#30165a] text-purple-300 text-xs px-3 py-1.5 rounded-lg font-bold transition font-mono uppercase"
          >
            <Monitor size={12} />
            {showGui ? 'Hide Plugin GUI' : 'Show Plugin GUI'}
          </button>
          {showGui && (
            <div className="rounded-lg overflow-hidden border border-[#30165a] bg-black">
              <iframe
                title="VST Plugin GUI (noVNC)"
                src={bridgeRef.current ? bridgeRef.current.getVncUrl() : ''}
                className="w-full h-64 border-0"
              />
              <div className="text-[9px] text-zinc-500 font-mono px-2 py-1.5 border-t border-[#231242]/60 leading-relaxed">
                Live plugin GUI streamed from the Wine sidecar — use the plugin's own
                controls when the auto-generated knobs don't cover everything.
              </div>
            </div>
          )}
        </div>

        {/* DSP Knobs Area */}
        <div
          onPointerDown={(e) => e.stopPropagation()}
          className="bg-[#070411]/95 p-4 flex justify-between items-center gap-2.5 flex-wrap"
        >
          {Object.keys(params).length > 0 ? (
            Object.keys(params).map(key => (
              <Knobby
                key={key}
                name={params[key].name}
                paramKey={key}
                param={params[key]}
              />
            ))
          ) : (
            <div className="w-full text-center py-6 text-zinc-500 text-xs font-mono">
              Connect to sidecar or active fallback to view dials
            </div>
          )}
        </div>
      </LiquidGlassPanel>
    </motion.div>
  );
};
export default VstBridgeEditor;
