import React, { useState } from "react";
import { 
  Expand, 
  ChevronDown, 
  Wand2, 
  Loader2, 
  Shrink, 
  Music, 
  Drum, 
  Mic2, 
  Mic, 
  Piano, 
  Settings2, 
  Sparkles,
  Info,
  Guitar,
  Wind,
  Fan,
  Volume2,
  Type,
  ChevronUp
} from "lucide-react";
import { useApp } from "../lib/store";
import { GoogleGenAI } from "@google/genai";
import { audioEngine } from "../lib/audioEngine";
import { motion, AnimatePresence } from "motion/react";

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

import { LiquidGlassPanel } from "./LiquidGlass";

const ScrollIndicatorMenu = ({ children, maxHeight, contentClassName }: { children: React.ReactNode, maxHeight: string, contentClassName?: string }) => {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const [showTop, setShowTop] = React.useState(false);
  const [showBottom, setShowBottom] = React.useState(false);

  const checkScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setShowTop(scrollTop > 5);
    setShowBottom(scrollTop + clientHeight < scrollHeight - 5);
  };

  React.useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      const resizeObserver = new ResizeObserver(checkScroll);
      resizeObserver.observe(el);
      checkScroll();
      return () => resizeObserver.disconnect();
    }
  }, [children]);

  return (
    <div className="relative w-full group/scroll">
      <AnimatePresence>
        {showTop && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute top-1 left-1/2 -translate-x-1/2 z-[60] pointer-events-none text-primary/80"
          >
            <ChevronUp size={14} className="animate-bounce" />
          </motion.div>
        )}
      </AnimatePresence>
      <div 
        ref={scrollRef}
        onScroll={checkScroll}
        className={`overflow-y-auto custom-scrollbar ${contentClassName}`}
        style={{ maxHeight }}
      >
        {children}
      </div>
      <AnimatePresence>
        {showBottom && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute bottom-1 left-1/2 -translate-x-1/2 z-[60] pointer-events-none text-primary/80"
          >
            <ChevronDown size={14} className="animate-bounce" />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const INSTRUMENTS = [
  { name: "Drums", icon: <Drum size={14} /> },
  { name: "Bass", icon: <Volume2 size={14} /> },
  { name: "Guitar", icon: <Guitar size={14} /> },
  { name: "Keyboard", icon: <Piano size={14} /> },
  { name: "Percussion", icon: <Drum size={14} /> },
  { name: "Strings", icon: <Music size={14} /> },
  { name: "Synth", icon: <Fan size={14} /> },
  { name: "FX", icon: <Sparkles size={14} /> },
  { name: "Brass", icon: <Wind size={14} /> },
  { name: "Woodwinds", icon: <Wind size={14} /> },
  { name: "Vocals", icon: <Mic size={14} /> },
  { name: "Backing Vocals", icon: <Mic2 size={14} /> },
  { name: "Song", icon: <Music size={14} /> },
  { name: "Custom", icon: <Settings2 size={14} /> },
];

const MODELS = ["V1", "V2", "V3", "V4", "V5"];

export function CreateForm() {
  const [instrument, setInstrument] = useState("Vocals");
  const [styles, setStyles] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"lyrics" | "advanced">("lyrics");
  const [model, setModel] = useState("V5");
  
  // Advanced Settings State
  const [weirdness, setWeirdness] = useState(50);
  const [styleInfluence, setStyleInfluence] = useState(50);
  const [audioInfluence, setAudioInfluence] = useState(25);

  const { state, dispatch } = useApp();
  const [isDragOver, setIsDragOver] = useState(false);

  const handleGenerate = async () => {
    try {
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
          await window.aistudio.openSelectKey();
        }
      }

      setIsGenerating(true);

      const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
      const isValidKey = apiKey && 
                         apiKey.length > 10 && 
                         apiKey !== "your_gemini_api_key" && 
                         apiKey !== "undefined" && 
                         apiKey !== "null";

      if (!isValidKey) {
        throw new Error("Gemini API key is not configured or invalid. Please set VITE_GEMINI_API_KEY in your GitHub Secrets.");
      }
      const ai = new GoogleGenAI(apiKey);
      const prompt = `Generate a 30-second ${instrument} track. Style: ${styles || "any"}. Lyrics: ${lyrics || "none"}`;

      const response = await ai.models.generateContentStream({
        model: "lyria-3-clip-preview",
        contents: prompt,
      });

      let audioBase64 = "";
      let generatedLyrics = "";
      let mimeType = "audio/wav";

      for await (const chunk of response) {
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (!parts) continue;
        for (const part of parts) {
          if (part.inlineData?.data) {
            if (!audioBase64 && part.inlineData.mimeType) {
              mimeType = part.inlineData.mimeType;
            }
            audioBase64 += part.inlineData.data;
          }
          if (part.text && !generatedLyrics) {
            generatedLyrics = part.text;
          }
        }
      }

      if (!audioBase64) {
        throw new Error("No audio generated.");
      }

      const binary = atob(audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mimeType });
      const file = new File([blob], `Generated ${instrument}.wav`, {
        type: mimeType,
      });

      const clipId = "clip_" + Date.now();
      const duration = await audioEngine.loadAudio(clipId, file);

      if (state.timeSelection) {
        const start = state.timeSelection.startOffset;
        const trackName = `Generated ${instrument}`;
        const colors = ["#FF2A5F", "#00E871", "#6B44FF", "#FFBB00", "#00E5FF", "#FF00EA"];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        dispatch({
          type: "ADD_TRACK",
          payload: {
            id: "track_" + Date.now(),
            name: trackName,
            volume: 0.8,
            pan: 0,
            muted: false,
            solo: false,
            color: randomColor,
            clips: [
              {
                id: clipId,
                start: start,
                duration,
                audioData: generatedLyrics || file.name,
              },
            ],
          },
        });
      } else {
        const trackName = `Generated ${instrument}`;
        const colors = ["#FF2A5F", "#00E871", "#6B44FF", "#FFBB00", "#00E5FF", "#FF00EA"];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        dispatch({
          type: "ADD_TRACK",
          payload: {
            id: "track_" + Date.now(),
            name: trackName,
            volume: 0.8,
            pan: 0,
            muted: false,
            solo: false,
            color: randomColor,
            clips: [
              {
                id: clipId,
                start: state.currentTime,
                duration,
                audioData: generatedLyrics || file.name,
              },
            ],
          },
        });
      }
    } catch (err) {
      console.error(err);
      alert("Error generating audio: " + (err as Error).message);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <motion.div
      layout
      className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-[150] transition-all duration-500`}
    >
      <LiquidGlassPanel
        cornerRadius={isExpanded ? 32 : 9999}
        overLight={true}
        mode="prominent"
        className={`border transition-all duration-500 ${isDragOver ? "border-orange-500 shadow-[0_0_30px_rgba(249,115,22,0.4)]" : "border-white/10 shadow-[0_0_60px_rgba(0,0,0,0.6)]"}`}
        contentClassName={`flex flex-col transition-all duration-500 ${isExpanded ? 'w-[900px]' : 'w-auto'}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setIsDragOver(false); }}
      >
        {/* Header Section */}
        <div className={`flex items-center space-x-4 p-2 transition-all ${isExpanded ? 'px-6 pt-6' : 'px-6 py-2'}`}>
          <button 
            onClick={() => setIsExpanded(!isExpanded)}
            className="w-10 h-10 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-white/5 rounded-full transition-all group"
          >
            {isExpanded ? <Shrink size={18} /> : <Expand size={18} className="group-hover:scale-110" />}
          </button>

          <div className="relative group/menu">
            <button
              disabled={isGenerating}
              className="flex items-center space-x-3 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white px-5 py-2.5 rounded-full transition-all border border-white/5"
            >
              <div className="text-primary">{INSTRUMENTS.find(i => i.name === instrument)?.icon}</div>
              <span className="text-sm font-black tracking-tight">{instrument}</span>
              <ChevronDown size={14} className="text-zinc-500" />
            </button>
            <div className="absolute bottom-full left-0 w-64 hidden group-hover/menu:block pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-300 z-[1000] pb-2">
              <LiquidGlassPanel cornerRadius={20} blurAmount={48} backgroundOpacity={0.35} contentClassName="p-1">
                <ScrollIndicatorMenu maxHeight="280px" contentClassName="py-2">
                  {INSTRUMENTS.map((item) => (
                    <button
                      key={item.name}
                      className="w-full text-left px-4 py-3 text-sm font-bold text-zinc-300 hover:text-white hover:bg-white/10 transition-all rounded-xl flex items-center gap-4"
                      onClick={() => setInstrument(item.name)}
                    >
                      <span className="text-primary/70">{item.icon}</span>
                      {item.name}
                    </button>
                  ))}
                </ScrollIndicatorMenu>
              </LiquidGlassPanel>
            </div>
          </div>

          {isExpanded && (
            <div className="relative group/model">
              <button className="flex items-center space-x-3 bg-white/5 hover:bg-white/10 text-white px-5 py-2.5 rounded-full transition-all border border-white/5">
                <Music size={14} className="text-primary" />
                <span className="text-sm font-black">{model}</span>
                <ChevronDown size={14} className="text-zinc-500" />
              </button>
              <div className="absolute bottom-full left-0 w-32 hidden group-hover/model:block pointer-events-auto animate-in fade-in slide-in-from-bottom-2 duration-300 z-[1000] pb-2">
                <LiquidGlassPanel cornerRadius={16} blurAmount={32} backgroundOpacity={0.3} contentClassName="p-1">
                  <ScrollIndicatorMenu maxHeight="200px" contentClassName="py-1">
                  {MODELS.map(m => (
                    <button 
                      key={m}
                      onClick={() => setModel(m)}
                      className="w-full text-left px-4 py-2.5 text-sm font-bold text-zinc-300 hover:text-white hover:bg-white/10 rounded-xl transition-all"
                    >
                      {m}
                    </button>
                  ))}
                  </ScrollIndicatorMenu>
                </LiquidGlassPanel>
              </div>
            </div>
          )}

          {!isExpanded && <div className="h-6 w-px bg-white/10" />}

          {!isExpanded && (
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 text-zinc-500 hover:text-zinc-300 transition-colors">
                <Music size={14} />
                <input
                  type="text"
                  placeholder="Styles"
                  value={styles}
                  onChange={(e) => setStyles(e.target.value)}
                  disabled={isGenerating}
                  className="bg-transparent border-none outline-none text-sm text-white placeholder-zinc-700 w-32 px-2 focus:w-48 transition-all disabled:opacity-50 font-bold"
                />
              </div>
              <div className="h-6 w-px bg-white/10" />
              <div className="flex items-center space-x-2 text-zinc-500 hover:text-zinc-300 transition-colors">
                <Type size={14} />
                <input
                  type="text"
                  placeholder="Lyrics"
                  value={lyrics}
                  onChange={(e) => setLyrics(e.target.value)}
                  disabled={isGenerating}
                  className="bg-transparent border-none outline-none text-sm text-white placeholder-zinc-700 w-32 px-2 focus:w-48 transition-all disabled:opacity-50 font-bold"
                />
              </div>
            </div>
          )}

          {isExpanded && (
            <div className="flex bg-black/40 p-1.5 rounded-full border border-white/5 backdrop-blur-xl">
              <button 
                onClick={() => setActiveTab("lyrics")}
                className={`px-6 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'lyrics' ? 'bg-white/15 text-white shadow-xl' : 'text-zinc-600 hover:text-zinc-400'}`}
              >
                Lyrics
              </button>
              <button 
                onClick={() => setActiveTab("advanced")}
                className={`px-6 py-2 rounded-full text-xs font-black uppercase tracking-widest transition-all ${activeTab === 'advanced' ? 'bg-white/15 text-white shadow-xl' : 'text-zinc-600 hover:text-zinc-400'}`}
              >
                Advanced Options
              </button>
            </div>
          )}

          <div className="flex-1" />

          {/* Rainbow Create Button Section */}
          <div className="relative group/create flex items-stretch h-12">
            <LiquidGlassPanel
              cornerRadius={9999}
              blurAmount={8}
              backgroundOpacity={0.15}
              displacementScale={45}
              aberrationIntensity={3}
              mode="prominent"
              className="h-12 border border-white/20 shadow-[0_0_15px_rgba(175,82,222,0.15)] overflow-hidden hover:shadow-[0_0_40px_rgba(175,82,222,0.5)] transition-shadow duration-500"
              contentClassName="h-full flex items-stretch px-1"
            >
              {/* Animated Liquid Mixing Blobs */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-70 mix-blend-screen">
                <motion.div
                  animate={{
                    x: [0, 40, -40, 0],
                    y: [0, -20, 20, 0],
                    scale: [1, 1.2, 0.8, 1],
                  }}
                  transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
                  className="absolute -top-10 -left-10 w-40 h-40 rounded-full bg-violet-600/60 blur-[40px]"
                />
                <motion.div
                  animate={{
                    x: [0, -50, 50, 0],
                    y: [0, 30, -30, 0],
                    scale: [1, 0.9, 1.3, 1],
                  }}
                  transition={{ duration: 15, repeat: Infinity, ease: "linear" }}
                  className="absolute -bottom-10 -right-10 w-48 h-48 rounded-full bg-blue-500/60 blur-[45px]"
                />
                <motion.div
                  animate={{
                    x: [0, 60, -30, 0],
                    y: [0, 40, -20, 0],
                  }}
                  transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
                  className="absolute top-0 left-1/4 w-32 h-32 rounded-full bg-cyan-400/50 blur-[35px]"
                />
                <motion.div
                  animate={{
                    x: [0, -30, 60, 0],
                    y: [0, -40, 30, 0],
                  }}
                  transition={{ duration: 14, repeat: Infinity, ease: "linear" }}
                  className="absolute bottom-0 left-1/3 w-36 h-36 rounded-full bg-green-500/50 blur-[40px]"
                />
                <motion.div
                  animate={{
                    x: [0, 20, -50, 0],
                    y: [0, -30, 40, 0],
                    scale: [1, 1.5, 0.7, 1],
                  }}
                  transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
                  className="absolute top-1/4 right-1/4 w-44 h-44 rounded-full bg-orange-500/40 blur-[50px]"
                />
                <motion.div
                  animate={{
                    opacity: [0.3, 0.6, 0.3],
                  }}
                  transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
                  className="absolute inset-0 bg-red-500/10 blur-2xl"
                />
              </div>

              <div className="absolute inset-0 bg-white/5 group-hover/create:bg-white/15 transition-colors pointer-events-none" />
              <button
                disabled={isGenerating}
                className="hover:bg-white/10 disabled:opacity-80 text-sm px-8 py-2.5 transition-all flex items-center space-x-3 text-white font-black uppercase tracking-tighter relative z-10"
                onClick={handleGenerate}
              >
                {isGenerating ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Sparkles size={16} className="text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.8)] animate-pulse" />
                )}
                <span className="drop-shadow-md">{isGenerating ? "Generating..." : state.timeSelection ? "Replace" : "Create"}</span>
              </button>
              <div className="w-px self-stretch bg-white/20 pointer-events-none relative z-10" />
              <button
                disabled={isGenerating}
                className="hover:bg-white/10 disabled:opacity-80 px-4 py-2.5 transition-all flex items-center justify-center min-w-[48px] text-white relative z-10"
              >
                <ChevronDown size={20} className="drop-shadow-[0_0_5px_rgba(255,255,255,0.4)]" />
              </button>
            </LiquidGlassPanel>
          </div>
        </div>

        {/* Expansion Content */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden px-8 pb-10 pt-6 flex gap-8"
            >
              {/* Styles Pane */}
              <div className="flex-1 flex flex-col space-y-4">
                <div className="flex items-center gap-2 px-1">
                  <h4 className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em]">Styles</h4>
                </div>
                <div className="flex-1 bg-black/50 rounded-[28px] border border-white/5 p-6 min-h-[300px] shadow-inner relative group/styles">
                  <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover/styles:opacity-100 transition-opacity pointer-events-none" />
                  <textarea 
                    value={styles}
                    onChange={(e) => setStyles(e.target.value)}
                    placeholder="Describe the genre, mood, instruments, tempo..."
                    className="w-full h-full bg-transparent border-none outline-none text-zinc-200 placeholder-zinc-800 resize-none text-sm font-bold leading-relaxed relative z-10"
                  />
                </div>
              </div>

              {/* Dynamic Right Pane */}
              <div className="flex-1 flex flex-col space-y-4">
                <div className="flex items-center justify-between px-1">
                  <h4 className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.3em]">
                    {activeTab === 'lyrics' ? 'Lyrics' : 'Advanced Settings'}
                  </h4>
                  {activeTab === 'lyrics' && <Wand2 size={12} className="text-zinc-700 hover:text-primary cursor-pointer transition-colors" />}
                </div>
                
                <div className="flex-1 bg-black/50 rounded-[28px] border border-white/5 p-8 min-h-[300px] shadow-inner relative group/right">
                  <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover/right:opacity-100 transition-opacity pointer-events-none" />
                  
                  {activeTab === 'lyrics' ? (
                    <textarea 
                      value={lyrics}
                      onChange={(e) => setLyrics(e.target.value)}
                      placeholder="Write your lyrics here or leave empty for an instrumental masterpiece..."
                      className="w-full h-full bg-transparent border-none outline-none text-zinc-200 placeholder-zinc-800 resize-none text-sm font-bold leading-relaxed relative z-10"
                    />
                  ) : (
                    <div className="space-y-8 relative z-10">
                       <div className="relative">
                          <input 
                            type="text" 
                            placeholder="Exclude styles..." 
                            className="w-full bg-black/40 border border-white/10 rounded-2xl px-12 py-4 text-sm font-bold outline-none focus:border-primary/50 transition-all placeholder-zinc-800" 
                          />
                          <Settings2 size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-700" />
                       </div>

                       <div className="space-y-8 pt-4">
                          {[
                            { label: 'Weirdness', val: weirdness, set: setWeirdness, info: 'Control the AI creativity level' },
                            { label: 'Style Influence', val: styleInfluence, set: setStyleInfluence, info: 'How strictly to follow the style tags' },
                            { label: 'Audio Influence', val: audioInfluence, set: setAudioInfluence, info: 'Impact of the reference audio input' },
                          ].map((s, idx) => (
                            <div key={idx} className="space-y-4">
                               <div className="flex justify-between items-center">
                                  <div className="flex items-center gap-2 text-[11px] font-black uppercase tracking-widest text-zinc-500">
                                     {s.label}
                                     <div className="group/info relative">
                                        <Info size={12} className="text-zinc-700 cursor-help" />
                                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-3 bg-black/90 border border-white/10 rounded-xl text-[9px] text-zinc-400 opacity-0 group-hover/info:opacity-100 transition-opacity pointer-events-none backdrop-blur-xl z-[2000]">
                                           {s.info}
                                        </div>
                                     </div>
                                  </div>
                                  <span className="text-white font-mono font-black text-sm">{s.val}%</span>
                               </div>
                               <div className="flex items-center gap-6">
                                  <div className="flex gap-1.5">
                                     {Array.from({ length: 12 }).map((_, i) => (
                                       <div 
                                         key={i} 
                                         className={`w-1 h-5 rounded-full transition-all duration-500 ${i/12 * 100 < s.val ? 'bg-primary' : 'bg-white/5'}`} 
                                       />
                                     ))}
                                  </div>
                                  <input 
                                    type="range" 
                                    min="0" max="100" 
                                    value={s.val} 
                                    onChange={(e) => s.set(parseInt(e.target.value))}
                                    className="flex-1 accent-primary h-1.5 bg-white/5 rounded-full cursor-pointer appearance-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(255,255,255,0.5)]" 
                                  />
                               </div>
                            </div>
                          ))}
                       </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </LiquidGlassPanel>
    </motion.div>
  );
}
