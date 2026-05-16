import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Book, Wand2, Sliders, LayoutDashboard,
  Cloud, Zap, MousePointer2,
  Sparkles, Magnet, Scissors, Music, HelpCircle,
  ChevronRight, Info, BookOpen, Search, Command,
  Share2, Save, FileAudio, ExternalLink
} from 'lucide-react';
import { LiquidGlassPanel } from './LiquidGlass';

interface LearnSection {
  id: string;
  title: string;
  icon: React.ReactNode;
  content: React.ReactNode;
}

export function LearnModal({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) {
  const [activeSection, setActiveSection] = useState('welcome');

  if (!isOpen) return null;

  const sections: LearnSection[] = [
    {
      id: 'welcome',
      title: 'Welcome',
      icon: <HelpCircle size={14} />,
      content: (
        <div className="space-y-6">
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-primary">
              <BookOpen size={18} />
              <h4 className="text-[10px] font-black uppercase tracking-[0.3em]">Project Overview</h4>
            </div>
            <p className="text-zinc-300 leading-relaxed text-sm">
              Welcome to J.A.A.D. (Just Another AI DAW). This is a professional-grade music production environment built entirely for the web. Whether you are a seasoned engineer or a first-time creator, this guide will help you master every tool in our ecosystem.
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 space-y-4">
            <h5 className="text-[10px] font-black text-white uppercase tracking-widest flex items-center gap-2">
              <Zap size={14} className="text-yellow-500" />
              Quick Start
            </h5>
            <ol className="space-y-3 text-[11px] text-zinc-400">
              <li className="flex gap-3"><span className="text-primary font-bold">01.</span> Drag audio files from your computer anywhere onto the center grid to start.</li>
              <li className="flex gap-3"><span className="text-primary font-bold">02.</span> Use the <span className="text-zinc-200">Timeline</span> to arrange your song and the <span className="text-zinc-200">Mixer</span> to adjust levels.</li>
              <li className="flex gap-3"><span className="text-primary font-bold">03.</span> Click the <span className="text-zinc-200">Create</span> button (bottom right) to generate AI vocals or stems.</li>
            </ol>
          </div>
        </div>
      )
    },
    {
      id: 'timeline',
      title: 'The Timeline',
      icon: <LayoutDashboard size={14} />,
      content: (
        <div className="space-y-8">
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-primary">
              <LayoutDashboard size={18} />
              <h4 className="text-[10px] font-black uppercase tracking-[0.3em]">Arrangement Grid</h4>
            </div>
            <p className="text-zinc-400 text-sm leading-relaxed">
              The Timeline is where you arrange, slice, and time-align your audio clips.
            </p>
          </div>

          <div className="space-y-6">
            <div className="flex gap-4">
              <div className="w-10 h-10 shrink-0 rounded-xl bg-white/5 flex items-center justify-center text-primary">
                <Magnet size={20} />
              </div>
              <div>
                <h5 className="text-white font-bold text-sm">Magnet Mode (Snap)</h5>
                <p className="text-xs text-zinc-500 mt-1">When enabled, clips will snap perfectly to the beat grid (BPM-synced). Disable it for "Free-flow" editing, allowing you to move clips to any millisecond.</p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="w-10 h-10 shrink-0 rounded-xl bg-white/5 flex items-center justify-center text-secondary">
                <Scissors size={20} />
              </div>
              <div>
                <h5 className="text-white font-bold text-sm">Splicing & Cutting</h5>
                <p className="text-xs text-zinc-500 mt-1">Select a clip and press the <kbd className="text-[10px] font-mono bg-zinc-800 px-1 rounded text-white">S</kbd> key to split it at the playhead position. You can then move or delete the segments independently.</p>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="w-10 h-10 shrink-0 rounded-xl bg-white/5 flex items-center justify-center text-emerald-500">
                <MousePointer2 size={20} />
              </div>
              <div>
                <h5 className="text-white font-bold text-sm">Clip Selection</h5>
                <p className="text-xs text-zinc-500 mt-1">Click a clip to select it. Hold <kbd className="text-[10px] font-mono bg-zinc-800 px-1 rounded text-white">Shift</kbd> to select multiple clips. Selected clips can be moved as a group.</p>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'mixer',
      title: 'Mixer & FX',
      icon: <Sliders size={14} />,
      content: (
        <div className="space-y-8">
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-secondary">
              <Sliders size={18} />
              <h4 className="text-[10px] font-black uppercase tracking-[0.3em]">Channel Strips</h4>
            </div>
            <p className="text-zinc-400 text-sm leading-relaxed">
              The Mixer (press <kbd className="text-[10px] font-mono bg-zinc-800 px-1 rounded text-white">Tab</kbd>) provides professional control over every track in your project.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/5">
              <h5 className="text-white font-bold text-sm mb-2">Basic Controls</h5>
              <ul className="grid grid-cols-2 gap-4">
                <li className="text-[11px] text-zinc-500"><span className="text-zinc-200 font-bold uppercase">Mute (M):</span> Silences the track.</li>
                <li className="text-[11px] text-zinc-500"><span className="text-zinc-200 font-bold uppercase">Solo (S):</span> Mutes all OTHER tracks.</li>
                <li className="text-[11px] text-zinc-500"><span className="text-zinc-200 font-bold uppercase">Pan:</span> Moves audio left or right in the stereo field.</li>
                <li className="text-[11px] text-zinc-500"><span className="text-zinc-200 font-bold uppercase">Fader:</span> Adjusts the volume from -inf to +6dB.</li>
              </ul>
            </div>

            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 space-y-4">
              <h5 className="text-white font-bold text-sm">Effect Slots</h5>
              <p className="text-xs text-zinc-500">Each track has 3 primary FX slots. Click a slot to load a processor:</p>
              <div className="space-y-2">
                <div className="flex items-center gap-3 text-[11px]">
                  <div className="px-2 py-0.5 rounded bg-blue-500/20 text-blue-400 font-bold">WebEQ</div>
                  <span className="text-zinc-500">Sculpt frequencies (Low, Mid, High).</span>
                </div>
                <div className="flex items-center gap-3 text-[11px]">
                  <div className="px-2 py-0.5 rounded bg-pink-500/20 text-pink-400 font-bold">Compressor</div>
                  <span className="text-zinc-500">Control dynamics and add punch.</span>
                </div>
                <div className="flex items-center gap-3 text-[11px]">
                  <div className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-bold">Delay</div>
                  <span className="text-zinc-500">Create depth with tempo-synced echoes.</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )
    },
    {
      id: 'ai',
      title: 'AI Studio',
      icon: <Sparkles size={14} />,
      content: (
        <div className="space-y-8">
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-primary">
              <Sparkles size={18} />
              <h4 className="text-[10px] font-black uppercase tracking-[0.3em]">Generative AI</h4>
            </div>
            <p className="text-zinc-400 text-sm leading-relaxed">
              JAAD integrates the Gemini 2.0 Flash model directly into the mixing engine.
            </p>
          </div>

          <div className="space-y-6">
            <section className="space-y-2">
              <h5 className="text-white font-bold text-sm flex items-center gap-2">
                <Wand2 size={14} />
                AI Copilot
              </h5>
              <p className="text-xs text-zinc-500 leading-relaxed">
                The Sidebar panel is your technical assistant. You can ask it to <span className="text-zinc-200 italic">"Fix my mix"</span>, <span className="text-zinc-200 italic">"Make the drums louder"</span>, or <span className="text-zinc-200 italic">"Add a delay to the vocals"</span>. It understands the context of your tracks and applies real changes to your mixer.
              </p>
            </section>

            <section className="space-y-2">
              <h5 className="text-white font-bold text-sm flex items-center gap-2">
                <Music size={14} />
                Creation Tool
              </h5>
              <p className="text-xs text-zinc-500 leading-relaxed">
                Use the <span className="text-primary font-bold">Liquid Rainbow</span> button to generate new stems.
              </p>
              <ul className="text-[11px] text-zinc-500 space-y-1 pl-4 list-disc">
                <li><strong className="text-zinc-200">Vocals:</strong> Generate clear vocal lines based on your lyrics.</li>
                <li><strong className="text-zinc-200">Styles:</strong> Describe the genre (e.g., "80s Synthwave" or "Deep House").</li>
                <li><strong className="text-zinc-200">Weirdness:</strong> Crank this up for experimental, glitchy textures.</li>
              </ul>
            </section>
          </div>
        </div>
      )
    },
    {
      id: 'cloud',
      title: 'Cloud & Export',
      icon: <Cloud size={14} />,
      content: (
        <div className="space-y-8">
          <div className="space-y-4">
            <div className="flex items-center gap-3 text-primary">
              <Cloud size={18} />
              <h4 className="text-[10px] font-black uppercase tracking-[0.3em]">Project Safety</h4>
            </div>
            <p className="text-zinc-400 text-sm leading-relaxed">
              JAAD ensures your creative work is never lost with a dual-backup system.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4">
            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 flex gap-4">
              <Cloud className="text-primary shrink-0" size={24} />
              <div>
                <h5 className="text-white font-bold text-sm">Cloud Sync</h5>
                <p className="text-xs text-zinc-500 mt-1">Metadata and effects are synced automatically to our secure cloud. Large audio files are stored in your browser's persistent database (IndexedDB).</p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 flex gap-4">
              <Save className="text-emerald-500 shrink-0" size={24} />
              <div>
                <h5 className="text-white font-bold text-sm">.jaad Bundle</h5>
                <p className="text-xs text-zinc-500 mt-1">Export a <span className="text-white font-bold">.jaad</span> file to your desktop. This is a "Portable Studio" containing every single audio clip and setting, ready to be imported into any other computer.</p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-white/[0.03] border border-white/5 flex gap-4">
              <FileAudio className="text-secondary shrink-0" size={24} />
              <div>
                <h5 className="text-white font-bold text-sm">Mastering & Stems</h5>
                <p className="text-xs text-zinc-500 mt-1">Use <span className="text-white font-bold">WAV Mixdown</span> for a finished song, or <span className="text-white font-bold">Export Stems</span> to get a ZIP archive for professional mastering in traditional DAWs like Ableton or Logic.</p>
              </div>
            </div>
          </div>
        </div>
      )
    }
  ];

  return createPortal(
    <div className="fixed inset-0 z-[110000] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-[#050507]/90 backdrop-blur-3xl"
        onClick={onClose}
      />

      <div className="w-full max-w-4xl h-[700px] relative">
        <LiquidGlassPanel
          cornerRadius={32}
          blurAmount={50}
          backgroundOpacity={0.15}
          displacementScale={30}
          overLight={true}
          className="border border-white/10 shadow-[0_0_100px_rgba(0,0,0,0.8)] overflow-hidden h-full"
          contentClassName="flex flex-col h-full"
        >
          {/* Header */}
          <div className="relative h-40 overflow-hidden bg-gradient-to-br from-primary/20 via-black to-black border-b border-white/5 shrink-0">
            <div className="absolute inset-0 opacity-30"
              style={{ backgroundImage: `radial-gradient(circle at 20% 50%, rgba(255,45,85,0.4) 0%, transparent 50%), radial-gradient(circle at 80% 50%, rgba(107,68,255,0.4) 0%, transparent 50%)` }}
            />
            <div className="absolute inset-0 flex items-center px-10 gap-6">
              <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl flex items-center justify-center shadow-2xl relative group overflow-hidden">
                <BookOpen size={32} className="text-white group-hover:scale-110 transition-transform duration-500" />
              </div>
              <div className="text-left">
                <h2 className="text-3xl font-black text-white tracking-tighter uppercase leading-none">LEARN</h2>
                <p className="text-[10px] text-primary font-bold tracking-[0.4em] uppercase mt-2">QUICKSTART J.A.A.D. USER GUIDE • v2.4.0</p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="absolute top-8 right-8 w-10 h-10 rounded-xl bg-black/40 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-all border border-white/10 backdrop-blur-md"
            >
              <X size={20} />
            </button>
          </div>

          {/* Wiki Layout Body */}
          <div className="flex-1 flex overflow-hidden">
            {/* Wiki Sidebar */}
            <div className="w-64 border-r border-white/5 bg-black/20 flex flex-col p-4 shrink-0">
              <div className="px-3 mb-6 flex items-center gap-2 text-zinc-600">
                <Search size={12} />
                <span className="text-[9px] font-black uppercase tracking-[0.2em]">Quick Start Guide</span>
              </div>
              <nav className="space-y-1">
                {sections.map(section => (
                  <button
                    key={section.id}
                    onClick={() => setActiveSection(section.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-300 group ${activeSection === section.id ? 'bg-primary/10 text-primary border border-primary/20 shadow-lg shadow-primary/5' : 'text-zinc-500 hover:text-zinc-300 hover:bg-white/5'}`}
                  >
                    <div className={`${activeSection === section.id ? 'text-primary' : 'text-zinc-600 group-hover:text-zinc-400'} transition-colors`}>
                      {section.icon}
                    </div>
                    <span className="text-xs font-bold">{section.title}</span>
                    {activeSection === section.id && <div className="ml-auto w-1 h-1 rounded-full bg-primary" />}
                  </button>
                ))}
              </nav>

              <div className="mt-auto p-4 rounded-2xl bg-white/[0.03] border border-white/5">
                <div className="flex items-center gap-2 mb-2 text-primary">
                  <Command size={14} />
                  <span className="text-[9px] font-black uppercase tracking-widest">Global Keys</span>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-[10px] text-zinc-500">
                    <span>Play/Pause</span>
                    <kbd className="bg-zinc-800 px-1 rounded text-[8px]">Space</kbd>
                  </div>
                  <div className="flex justify-between text-[10px] text-zinc-500">
                    <span>Mixer View</span>
                    <kbd className="bg-zinc-800 px-1 rounded text-[8px]">Tab</kbd>
                  </div>
                  <div className="flex justify-between text-[10px] text-zinc-500">
                    <span>Split Clip</span>
                    <kbd className="bg-zinc-800 px-1 rounded text-[8px]">S</kbd>
                  </div>
                </div>
              </div>
            </div>

            {/* Wiki Content Area */}
            <div className="flex-1 overflow-y-auto bg-black/10 p-12 custom-scrollbar">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activeSection}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -20 }}
                  transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                >
                  {sections.find(s => s.id === activeSection)?.content}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* Footer (About Style) */}
          <div className="p-4 bg-black/40 border-t border-white/5 flex items-center justify-between px-8 shrink-0">
            <div className="flex items-center gap-2">
              <Heart size={10} className="text-primary animate-pulse" />
              <p className="text-[8px] text-zinc-600 font-bold uppercase tracking-[0.3em]">
                Crafted with Soul in 2026
              </p>
            </div>
            <div className="flex gap-4">
              <a 
                href="https://github.com/r0073d-l053r/JAAD-DAW/discussions" 
                target="_blank" 
                rel="noopener noreferrer" 
                className="text-[8px] text-zinc-500 hover:text-white font-black uppercase tracking-widest transition-colors flex items-center gap-1"
              >
                Community <ExternalLink size={8} />
              </a>
              <a href="#" className="text-[8px] text-zinc-500 hover:text-white font-black uppercase tracking-widest transition-colors flex items-center gap-1">API Docs <ExternalLink size={8} /></a>
            </div>
          </div>
        </LiquidGlassPanel>
      </div>
    </div>,
    document.body
  );
}

const Heart = ({ size, className }: { size: number, className: string }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
  >
    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
  </svg>
);
