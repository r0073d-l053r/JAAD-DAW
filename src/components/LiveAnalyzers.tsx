import React, { useEffect, useRef, useState, memo } from 'react';
import { audioEngine } from '../lib/audioEngine';
import { LiquidGlassPanel } from './LiquidGlass';
import { useApp } from '../lib/store';
import { X, Maximize2, Minimize2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Magma Color Palette from Spectrogram
const MAGMA_PALETTE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  const val = i / 255;
  let r = 0, g = 0, b = 0;
  
  const c0 = [10, 5, 30];
  const c1 = [61, 20, 120];
  const c2 = [183, 35, 117];
  const c3 = [244, 130, 38];
  const c4 = [255, 242, 178];

  if (val < 0.25) {
    const t = val * 4.0;
    r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
    g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
    b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
  } else if (val < 0.50) {
    const t = (val - 0.25) * 4.0;
    r = Math.round(c1[0] + (c2[0] - c1[0]) * t);
    g = Math.round(c1[1] + (c2[1] - c1[1]) * t);
    b = Math.round(c1[2] + (c2[2] - c1[2]) * t);
  } else if (val < 0.75) {
    const t = (val - 0.50) * 4.0;
    r = Math.round(c2[0] + (c3[0] - c2[0]) * t);
    g = Math.round(c2[1] + (c3[1] - c2[1]) * t);
    b = Math.round(c2[2] + (c3[2] - c2[2]) * t);
  } else {
    const t = (val - 0.75) * 4.0;
    r = Math.round(c3[0] + (c4[0] - c3[0]) * t);
    g = Math.round(c3[1] + (c4[1] - c3[1]) * t);
    b = Math.round(c3[2] + (c4[2] - c3[2]) * t);
  }
  
  MAGMA_PALETTE[i] = (255 << 24) | (b << 16) | (g << 8) | r;
}

const getFullColorStr = (value: number) => {
    const col32 = MAGMA_PALETTE[value];
    const r = col32 & 0xFF;
    const g = (col32 >> 8) & 0xFF;
    const b = (col32 >> 16) & 0xFF;
    return `rgb(${r}, ${g}, ${b})`;
};

const SpectrumCanvas = memo(() => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const tempCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
    const requestRef = useRef<number>();

    useEffect(() => {
        const canvas = canvasRef.current;
        const tempCanvas = tempCanvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        const tempCtx = tempCanvas.getContext('2d');
        if (!ctx || !tempCtx) return;

        let width = canvas.offsetWidth;
        let height = canvas.offsetHeight;
        canvas.width = width;
        canvas.height = height;
        tempCanvas.width = width;
        tempCanvas.height = height;

        const dataArray = new Uint8Array(audioEngine.masterAnalyser?.frequencyBinCount || 512);
        const speed = 3;

        const draw = () => {
            if (!audioEngine.isPlaying) {
                requestRef.current = requestAnimationFrame(draw);
                return;
            }

            // Handle Resize
            if (canvas.offsetWidth !== width || canvas.offsetHeight !== height) {
                width = canvas.offsetWidth;
                height = canvas.offsetHeight;
                canvas.width = width;
                canvas.height = height;
                tempCanvas.width = width;
                tempCanvas.height = height;
            }

            audioEngine.getMasterFrequencyData(dataArray);

            tempCtx.drawImage(canvas, 0, 0, width, height);

            ctx.fillStyle = '#070411';
            ctx.fillRect(0, 0, width, height);

            // Draw current frequency slice on the right edge
            for (let i = 0; i < dataArray.length; i++) {
                const value = dataArray[i];
                if (value > 0) {
                    ctx.fillStyle = getFullColorStr(value);
                    const percent = i / dataArray.length;
                    const y = Math.round(percent * height);
                    ctx.fillRect(width - speed, height - y, speed, speed);
                }
            }

            ctx.translate(-speed, 0);
            ctx.drawImage(tempCanvas, 0, 0, width, height, 0, 0, width, height);
            ctx.setTransform(1, 0, 0, 1, 0, 0);

            requestRef.current = requestAnimationFrame(draw);
        };

        requestRef.current = requestAnimationFrame(draw);

        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, []);

    return <canvas ref={canvasRef} className="w-full h-full block rounded bg-[#070411]" />;
});

const FrequencyCanvas = memo(() => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const requestRef = useRef<number>();

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let width = canvas.offsetWidth;
        let height = canvas.offsetHeight;
        canvas.width = width;
        canvas.height = height;

        const dataArray = new Uint8Array(audioEngine.masterAnalyser?.frequencyBinCount || 512);

        const draw = () => {
            if (canvas.offsetWidth !== width || canvas.offsetHeight !== height) {
                width = canvas.offsetWidth;
                height = canvas.offsetHeight;
                canvas.width = width;
                canvas.height = height;
            }

            audioEngine.getMasterFrequencyData(dataArray);

            ctx.clearRect(0, 0, width, height);

            // Use logarithmic scaling for X axis roughly
            const barWidth = width / dataArray.length;
            
            for (let i = 0; i < dataArray.length; i++) {
                const value = dataArray[i];
                const percent = value / 255;
                const barHeight = height * percent;
                const x = i * barWidth;
                
                // Draw bar using the magma palette
                if (value > 0) {
                   ctx.fillStyle = getFullColorStr(value);
                   ctx.fillRect(x, height - barHeight, Math.max(1, barWidth - 0.5), barHeight);
                }
            }

            requestRef.current = requestAnimationFrame(draw);
        };

        requestRef.current = requestAnimationFrame(draw);

        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, []);

    return <canvas ref={canvasRef} className="w-full h-full block rounded bg-[#070411]" />;
});

export function LiveAnalyzers() {
    const { state, dispatch } = useApp();
    const [expanded, setExpanded] = useState(false);

    if (!state.showLiveAnalyzers) return null;

    return (
        <AnimatePresence>
            <motion.div
                initial={{ y: 300, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 300, opacity: 0 }}
                transition={{ type: "spring", stiffness: 300, damping: 30 }}
                className={`fixed left-1/2 transform -translate-x-1/2 bottom-20 z-50 transition-all duration-300 ${expanded ? 'w-[95vw] h-[40vh]' : 'w-[800px] h-48'}`}
            >
                <LiquidGlassPanel
                    cornerRadius={16}
                    blurAmount={40}
                    backgroundOpacity={0.4}
                    className="w-full h-full shadow-2xl border border-white/10 flex flex-col overflow-hidden"
                    contentClassName="w-full h-full flex flex-col"
                >
                    {/* Header */}
                    <div className="flex justify-between items-center px-4 py-2 border-b border-white/5 bg-black/20 shrink-0">
                        <div className="flex gap-4">
                            <h3 className="text-xs font-bold text-white tracking-widest uppercase">Spectrum</h3>
                            <h3 className="text-xs font-bold text-white/50 tracking-widest uppercase">Frequency</h3>
                        </div>
                        <div className="flex items-center gap-2">
                            <button 
                                onClick={() => setExpanded(!expanded)}
                                className="text-white/50 hover:text-white transition-colors"
                            >
                                {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
                            </button>
                            <button 
                                onClick={() => dispatch({ type: 'TOGGLE_LIVE_ANALYZERS' })}
                                className="text-white/50 hover:text-white transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex flex-1 p-3 gap-3 min-h-0">
                        <div className="flex-1 relative rounded border border-white/10 overflow-hidden bg-[#070411] shadow-inner">
                            <SpectrumCanvas />
                            <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 backdrop-blur rounded text-[9px] text-white/70 uppercase tracking-widest font-mono">
                                Waterfall
                            </div>
                        </div>
                        <div className="flex-1 relative rounded border border-white/10 overflow-hidden bg-[#070411] shadow-inner">
                            <FrequencyCanvas />
                            <div className="absolute top-2 left-2 px-2 py-1 bg-black/60 backdrop-blur rounded text-[9px] text-white/70 uppercase tracking-widest font-mono">
                                Bars
                            </div>
                        </div>
                    </div>
                </LiquidGlassPanel>
            </motion.div>
        </AnimatePresence>
    );
}
