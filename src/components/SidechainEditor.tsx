import React, { useState, useEffect, useRef } from 'react';
import { motion, useDragControls } from 'motion/react';
import { X, Sliders, VolumeX, Eye } from 'lucide-react';
import { useApp } from '../lib/store';
import { audioEngine } from '../lib/audioEngine';
import { LiquidGlassPanel } from './LiquidGlass';

export const SidechainEditor: React.FC = () => {
  const { state, dispatch } = useApp();
  const dragControls = useDragControls();
  const trackId = state.sidechainEditorTrackId;
  const track = state.tracks.find(t => t.id === trackId);

  const [threshold, setThreshold] = useState<number>(-24);
  const [ratio, setRatio] = useState<number>(4);
  const [attack, setAttack] = useState<number>(0.005);
  const [release, setRelease] = useState<number>(0.12);
  const [bypass, setBypass] = useState<boolean>(false);
  const [selectedSource, setSelectedSource] = useState<string>('');

  const meterRef = useRef<HTMLDivElement>(null);
  const textMeterRef = useRef<HTMLSpanElement>(null);

  // Synchronize state from audioEngine on mount/track change
  useEffect(() => {
    if (!trackId) return;

    const isConnected = audioEngine.sidechainNodes.has(trackId);
    if (!isConnected) {
      audioEngine.addTrackSidechain(trackId);
    }

    const node = audioEngine.sidechainNodes.get(trackId);
    if (node) {
      try {
        setThreshold(node.parameters.get('threshold')?.value ?? -24);
        setRatio(node.parameters.get('ratio')?.value ?? 4);
        setAttack(node.parameters.get('attack')?.value ?? 0.005);
        setRelease(node.parameters.get('release')?.value ?? 0.12);
        setBypass((node.parameters.get('bypass')?.value ?? 0) > 0.5);
      } catch (e) {
        console.warn('Failed to read parameters from node', e);
      }
    }

    const currentSource = audioEngine.sidechainSources.get(trackId) || '';
    setSelectedSource(currentSource);
  }, [trackId]);

  // Real-time animation loop for the Gain Reduction meter (60fps)
  useEffect(() => {
    if (!trackId) return;

    let animId: number;

    const updateMeter = () => {
      const db = audioEngine.sidechainReduction.get(trackId) ?? 0.0;
      // Map dB to percentage. Typically 0dB = 0% reduction, -30dB = 100% reduction
      const minDb = -30;
      const pct = Math.max(0, Math.min(100, (db / minDb) * 100));

      if (meterRef.current) {
        meterRef.current.style.width = `${pct}%`;
      }
      if (textMeterRef.current) {
        textMeterRef.current.innerText = db < -0.1 ? `${db.toFixed(1)} dB` : '0.0 dB';
      }

      animId = requestAnimationFrame(updateMeter);
    };

    animId = requestAnimationFrame(updateMeter);
    return () => cancelAnimationFrame(animId);
  }, [trackId]);

  if (!trackId || !track) return null;

  // Filter other tracks as potential sidechain triggers
  const potentialSources = state.tracks.filter(t => t.id !== trackId);

  const updateParam = (name: 'threshold' | 'ratio' | 'attack' | 'release', value: number) => {
    audioEngine.setSidechainParam(trackId, name, value);
    if (name === 'threshold') setThreshold(value);
    if (name === 'ratio') setRatio(value);
    if (name === 'attack') setAttack(value);
    if (name === 'release') setRelease(value);
  };

  const toggleBypass = () => {
    const nextBypass = !bypass;
    setBypass(nextBypass);
    const node = audioEngine.sidechainNodes.get(trackId);
    if (node && audioEngine.context) {
      node.parameters.get('bypass')?.setValueAtTime(nextBypass ? 1 : 0, audioEngine.context.currentTime);
    }
  };

  const handleSourceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const srcId = e.target.value;
    setSelectedSource(srcId);
    if (srcId) {
      audioEngine.connectSidechainTrigger(trackId, srcId);
    }
  };

  // Custom Knobby component specifically for standard sidechain sliders
  const SidechainKnob: React.FC<{
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    unit: string;
    onChange: (val: number) => void;
  }> = ({ label, value, min, max, step, unit, onChange }) => {
    const [isDragging, setIsDragging] = useState(false);
    const startYRef = useRef(0);
    const startValRef = useRef(0);

    const handlePointerDown = (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
      startYRef.current = e.clientY;
      startValRef.current = value;

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const deltaY = startYRef.current - moveEvent.clientY; // Up is positive increase
        const range = max - min;
        const sensitivity = range / 250; // Dragging 250px sweeps full range
        const newVal = Math.max(min, Math.min(max, startValRef.current + deltaY * sensitivity));
        onChange(Number(newVal.toFixed(3)));
      };

      const handlePointerUp = () => {
        setIsDragging(false);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    };

    // Calculate circular arc percentage
    const normalized = (value - min) / (max - min);
    const angle = -135 + normalized * 270;
    
    // Circular gauge properties
    const radius = 22;
    const circumference = 2 * Math.PI * radius;
    const strokeDashoffset = circumference - (normalized * 0.75) * circumference;

    return (
      <div className="flex flex-col items-center select-none space-y-1.5 p-2 bg-zinc-950/40 rounded-xl border border-white/5 shadow-inner">
        <span className="text-[9px] font-bold text-zinc-400 uppercase tracking-wider font-mono">{label}</span>
        
        <div
          onPointerDown={handlePointerDown}
          className={`relative w-14 h-14 cursor-ns-resize flex items-center justify-center rounded-full transition-transform active:scale-95 ${isDragging ? 'text-pink-400' : 'text-cyan-400'}`}
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
              className="transform rotate-135 origin-center transition-all duration-75 filter drop-shadow-[0_0_5px_rgba(34,211,238,0.4)]"
            />
          </svg>

          <div className="w-9 h-9 bg-zinc-900 rounded-full border border-zinc-800 flex items-center justify-center shadow-lg relative">
            <div
              className="absolute top-1.5 w-0.5 h-3 bg-pink-500 rounded-full origin-bottom"
              style={{ transform: `rotate(${angle}deg)`, transformOrigin: '50% 100%' }}
            />
            <div className="w-1.5 h-1.5 bg-zinc-950 rounded-full border border-zinc-700/80" />
          </div>
        </div>

        <span className="text-[10px] font-mono font-bold text-zinc-300">
          {label === 'Attack' || label === 'Release' 
            ? `${Math.round(value * 1000)}${unit}` 
            : `${value}${unit}`
          }
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
      initial={{ x: window.innerWidth - 450, y: 350 }}
      className="fixed z-50 w-[420px] shadow-3xl select-none"
    >
      <LiquidGlassPanel
        cornerRadius={20}
        blurAmount={40}
        backgroundOpacity={0.35}
        className="border border-cyan-500/20 overflow-hidden"
        contentClassName="flex flex-col"
      >
        {/* Title Bar */}
        <div 
          onPointerDown={(e) => dragControls.start(e)}
          className="sidechain-editor-titlebar flex justify-between items-center bg-[#050b16]/95 border-b border-cyan-950/50 px-4.5 py-3 cursor-move"
        >
          <div className="flex items-center gap-2">
            <Sliders size={15} className="text-cyan-400 animate-pulse" />
            <span className="text-[11px] font-bold tracking-widest text-cyan-300 uppercase font-mono">
              Sidechain Ducking: {track.name.toUpperCase()}
            </span>
          </div>
          <button
            onClick={() => dispatch({ type: 'SET_SIDECHAIN_EDITOR_TRACK', payload: null })}
            className="text-zinc-500 hover:text-white transition"
          >
            <X size={15} />
          </button>
        </div>

        {/* Configuration Area */}
        <div 
          onPointerDown={(e) => e.stopPropagation()}
          className="bg-[#03070f]/90 p-4 space-y-4 border-b border-cyan-950/30"
        >
          {/* Patch Bay Routing Row */}
          <div className="flex flex-col gap-1.5">
            <label className="text-[10px] font-bold text-cyan-400/80 uppercase font-mono tracking-wider">
              Trigger Source Track (Matrix Input)
            </label>
            <div className="flex gap-2">
              <select
                value={selectedSource}
                onChange={handleSourceChange}
                className="flex-1 bg-[#060d1b] border border-cyan-950/80 rounded-xl px-3 py-2 text-xs text-cyan-100 focus:outline-none focus:border-cyan-500 font-mono cursor-pointer"
              >
                <option value="">-- Select Sidechain Trigger Track --</option>
                {potentialSources.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name.toUpperCase()}
                  </option>
                ))}
              </select>

              <button
                onClick={toggleBypass}
                className={`flex items-center gap-1.5 border text-xs px-3.5 py-2 rounded-xl font-bold transition font-mono uppercase ${
                  bypass
                    ? 'bg-red-500/20 text-red-400 border-red-500/40 hover:bg-red-500/30'
                    : 'bg-zinc-800/40 text-zinc-300 border-zinc-700/40 hover:bg-zinc-700/30'
                }`}
              >
                <VolumeX size={13} />
                <span>{bypass ? 'Bypassed' : 'Active'}</span>
              </button>
            </div>
          </div>

          {/* Real-time Attenuation Gauge */}
          <div className="flex flex-col gap-1 bg-[#03060c] border border-white/5 rounded-xl p-3.5">
            <div className="flex justify-between items-center text-[10px] font-mono text-zinc-400 uppercase font-bold tracking-wide">
              <span className="flex items-center gap-1">
                <Eye size={12} className="text-pink-400" />
                Gain Reduction (Ducking)
              </span>
              <span ref={textMeterRef} className="text-pink-400 font-bold">0.0 dB</span>
            </div>
            
            <div className="relative h-3.5 bg-zinc-950 border border-zinc-900 rounded-full overflow-hidden mt-1.5">
              {/* Reference Grid lines */}
              <div className="absolute inset-0 flex justify-between px-2 text-[7px] font-mono text-zinc-700/80 pointer-events-none items-center">
                <span>0dB</span>
                <span>-6</span>
                <span>-12</span>
                <span>-18</span>
                <span>-24</span>
                <span>-30dB</span>
              </div>
              {/* Dynamic bar */}
              <div
                ref={meterRef}
                className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-cyan-400 via-pink-400 to-pink-500 transition-all duration-75 shadow-[0_0_12px_rgba(236,72,153,0.6)]"
                style={{ width: '0%' }}
              />
            </div>
          </div>
        </div>

        {/* Compression Control Area */}
        <div 
          onPointerDown={(e) => e.stopPropagation()}
          className="bg-[#02050b]/95 p-4 grid grid-cols-4 gap-3"
        >
          <SidechainKnob
            label="Threshold"
            value={threshold}
            min={-60}
            max={0}
            step={1}
            unit="dB"
            onChange={(val) => updateParam('threshold', val)}
          />
          <SidechainKnob
            label="Ratio"
            value={ratio}
            min={1}
            max={20}
            step={0.5}
            unit=":1"
            onChange={(val) => updateParam('ratio', val)}
          />
          <SidechainKnob
            label="Attack"
            value={attack}
            min={0.001}
            max={0.1}
            step={0.001}
            unit="s"
            onChange={(val) => updateParam('attack', val)}
          />
          <SidechainKnob
            label="Release"
            value={release}
            min={0.01}
            max={1.0}
            step={0.01}
            unit="s"
            onChange={(val) => updateParam('release', val)}
          />
        </div>
      </LiquidGlassPanel>
    </motion.div>
  );
};

export default SidechainEditor;
