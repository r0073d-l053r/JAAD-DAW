import React, { useState, useEffect } from 'react';
import { APP_VERSION } from '../version';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Sparkles, BookOpen, Music, HelpCircle, ArrowRight,
  Github, MessageSquare, Terminal, AlertTriangle, ShieldCheck
} from 'lucide-react';
import { LiquidGlassPanel } from './LiquidGlass';
import { isGitHubPagesBuild } from '../lib/syncUtils';

interface WelcomeModalProps {
  isOpen?: boolean; // Optional: if omitted, will manage its own open state via localStorage + URL checks
}

export function WelcomeModal({ isOpen: manualIsOpen }: WelcomeModalProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    // Only automatically show on GitHub Pages builds (or if manually forced via prop)
    if (manualIsOpen !== undefined) {
      setIsOpen(manualIsOpen);
      return;
    }

    if (isGitHubPagesBuild()) {
      const dismissed = localStorage.getItem('jaad_welcome_modal_dismissed');
      if (!dismissed) {
        // Show after a brief delay so the main UI animations complete
        const timer = setTimeout(() => {
          setIsOpen(true);
        }, 1200);
        return () => clearTimeout(timer);
      }
    }
  }, [manualIsOpen]);

  const handleDismiss = () => {
    localStorage.setItem('jaad_welcome_modal_dismissed', 'true');
    setIsOpen(false);
  };

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[30000] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md"
        >
          <motion.div
            initial={{ scale: 0.92, y: 30 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.92, y: 30 }}
            transition={{ type: "spring", damping: 25, stiffness: 220 }}
            className="w-full max-w-3xl"
          >
            <LiquidGlassPanel
              cornerRadius={28}
              blurAmount={32}
              saturation={190}
              backgroundOpacity={0.12}
              className="w-full border border-white/10 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.7)]"
            >
              <div className="flex flex-col max-h-[85vh] overflow-hidden rounded-[28px]">
                {/* Header Section */}
                <div className="p-6 md:p-8 border-b border-white/5 flex items-start justify-between bg-white/[0.02] relative">
                  <div className="absolute top-0 left-1/4 right-1/4 h-[2px] bg-gradient-to-r from-transparent via-primary to-transparent opacity-80" />
                  
                  <div className="space-y-3">
                    {/* Alpha Build Badge */}
                    <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-wider bg-primary/20 border border-primary/40 text-primary shadow-[0_0_12px_rgba(255,45,85,0.25)] animate-pulse">
                      <AlertTriangle size={10} className="text-primary" />
                      Alpha Build v{APP_VERSION}
                    </div>

                    <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight text-white flex items-center gap-2">
                      <span className="bg-clip-text text-transparent bg-gradient-to-r from-white via-white to-zinc-400">
                        Welcome to
                      </span>
                      <span className="bg-clip-text text-transparent bg-gradient-to-r from-primary via-secondary to-purple-400 font-black shadow-sm">
                        J.A.A.D.
                      </span>
                    </h1>
                    
                    <p className="text-zinc-400 text-xs md:text-sm max-w-xl leading-relaxed">
                      Just Another AI DAW — A next-generation, professional-grade music production suite powered by AI and running entirely in your web browser.
                    </p>
                  </div>

                  <button
                    onClick={handleDismiss}
                    className="p-2 hover:bg-white/10 rounded-full transition-all text-zinc-400 hover:text-white"
                  >
                    <X size={20} />
                  </button>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-6 custom-scrollbar">
                  
                  {/* Grid Layout for Quick Info */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    
                    {/* Card 1: Load the Demo Project */}
                    <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/5 space-y-3 hover:bg-white/[0.05] hover:border-primary/20 transition-all group">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary group-hover:scale-110 transition-transform duration-300">
                        <Music size={20} />
                      </div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        Try the Shared Template Project
                        <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-green-500/20 text-green-400 border border-green-500/30">
                          Highly Recommended
                        </span>
                      </h3>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        Skip setup and test a fully loaded project bundle. Go to 
                        <span className="text-white font-medium"> File &rarr; Manage Projects </span> 
                        and select <span className="text-primary font-bold">"Fractured Protocol - Kaelo"</span> to load it. 
                        Feel free to edit and mix!
                      </p>
                      <div className="pt-2 flex items-center gap-2 text-[10px] text-amber-400 font-bold uppercase tracking-wider">
                        <ShieldCheck size={12} />
                        Read-Only Protected
                      </div>
                    </div>

                    {/* Card 2: Quick Start Guide */}
                    <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/5 space-y-3 hover:bg-white/[0.05] hover:border-secondary/20 transition-all group">
                      <div className="w-10 h-10 rounded-xl bg-secondary/10 border border-secondary/20 flex items-center justify-center text-secondary group-hover:scale-110 transition-transform duration-300">
                        <BookOpen size={20} />
                      </div>
                      <h3 className="text-sm font-bold text-white">Interactive Quickstart Guide</h3>
                      <ul className="space-y-1.5 text-xs text-zinc-400 list-disc list-inside">
                        <li>Drag & drop audio files anywhere onto the grid.</li>
                        <li>Click <span className="text-secondary font-medium">Create</span> to generate AI stems and MIDI patterns.</li>
                        <li>Toggle Metronome & Auto-BPM sync to lock your timeline beats.</li>
                        <li>Export `.jaad` bundles or generate <span className="text-secondary font-medium">Share Links</span>.</li>
                      </ul>
                    </div>

                    {/* Card 3: Help & Documentation */}
                    <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/5 space-y-3 hover:bg-white/[0.05] hover:border-purple-500/20 transition-all group">
                      <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 group-hover:scale-110 transition-transform duration-300">
                        <HelpCircle size={20} />
                      </div>
                      <h3 className="text-sm font-bold text-white">Need Assistance?</h3>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        Detailed user manuals, keyboard shortcuts, and guides can be found inside the 
                        <span className="text-white font-medium"> Help folder</span> or by clicking 
                        <span className="text-purple-400 font-medium"> "Help & Documentation" </span> 
                        in the navigation header at the top of the screen.
                      </p>
                    </div>

                    {/* Card 4: Community & Contribution */}
                    <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/5 space-y-3 hover:bg-white/[0.05] hover:border-emerald-500/20 transition-all group">
                      <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 group-hover:scale-110 transition-transform duration-300">
                        <Github size={20} />
                      </div>
                      <h3 className="text-sm font-bold text-white">Join & Contribute!</h3>
                      <p className="text-xs text-zinc-400 leading-relaxed">
                        JAAD is fully open-source. Report bugs, join our developer discussions, request new AI features, and contribute code directly on the Github repository!
                      </p>
                      <a 
                        href="https://github.com/r0073d-l053r/JAAD/discussions" 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 hover:text-emerald-300 hover:underline transition-all mt-1"
                      >
                        <MessageSquare size={12} />
                        Join Discussion Board
                        <ArrowRight size={10} />
                      </a>
                    </div>

                  </div>

                  {/* Sandbox Note */}
                  <div className="p-4 rounded-xl bg-amber-500/5 border border-amber-500/10 text-amber-400/90 text-[11px] leading-relaxed flex gap-3">
                    <Terminal size={18} className="shrink-0 text-amber-400" />
                    <div>
                      <span className="font-bold text-white">Offline/Local Persistence Mode:</span> While cloud saving the shared template is disabled to prevent database clutter, <span className="font-bold text-white">auto-save is active locally!</span> Any edits you make are stored automatically in your browser's Cache/LocalStorage, so they will survive refreshing the browser tab.
                    </div>
                  </div>

                </div>

                {/* Footer Section */}
                <div className="p-6 border-t border-white/5 flex flex-col sm:flex-row items-center justify-between gap-4 bg-white/[0.02]">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-widest font-black flex items-center gap-1.5">
                    <Sparkles size={12} className="text-primary animate-pulse" />
                    Designed for Creators everywhere
                  </span>

                  <button
                    onClick={handleDismiss}
                    className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-gradient-to-r from-primary to-secondary hover:from-primary/95 hover:to-secondary/95 text-black font-black text-xs uppercase tracking-widest hover:scale-[1.02] active:scale-[0.98] transition-all shadow-[0_5px_20px_rgba(255,45,85,0.3)] flex items-center justify-center gap-2 cursor-pointer"
                  >
                    Let's Make Music
                    <ArrowRight size={14} />
                  </button>
                </div>
              </div>
            </LiquidGlassPanel>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}
