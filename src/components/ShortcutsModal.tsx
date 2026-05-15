import React from 'react';
import { createPortal } from 'react-dom';
import { LiquidGlassPanel } from './LiquidGlass';
import { X, Keyboard, Command } from 'lucide-react';

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { key: 'Space', action: 'Toggle Play/Pause', category: 'Transport' },
  { key: 'R', action: 'Toggle Record', category: 'Transport' },
  { key: 'S', action: 'Split Clip at playhead', category: 'Editing' },
  { key: 'Backspace / Del', action: 'Delete selected clips', category: 'Editing' },
  { key: 'Ctrl + S', action: 'Save Project to Cloud', category: 'File' },
  { key: 'Ctrl + Z', action: 'Undo', category: 'History' },
  { key: 'Ctrl + Y', action: 'Redo', category: 'History' },
  { key: 'Ctrl + A', action: 'Select All Clips', category: 'Editing' },
  { key: 'Ctrl + C', action: 'Copy Clips', category: 'Editing' },
  { key: 'Ctrl + X', action: 'Cut Clips', category: 'Editing' },
  { key: 'Ctrl + V', action: 'Paste Clips', category: 'Editing' },
  { key: 'Ctrl + D', action: 'Duplicate Selection', category: 'Editing' },
  { key: 'Ctrl + Shift + S', action: 'AI Cleanup Stems', category: 'AI / Process' },
  { key: 'Shift + Drag', action: 'Vertical Movement Lock', category: 'Editing' },
  { key: 'F9 / Tab', action: 'Toggle Timeline/Mixer', category: 'View' },
  { key: 'Ctrl + + / -', action: 'Zoom In / Out', category: 'View' },
];

export function ShortcutsModal({ isOpen, onClose }: ShortcutsModalProps) {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100000] flex items-center justify-center animate-in fade-in duration-500 p-4">
      <div className="absolute inset-0 bg-[#050507]/80 backdrop-blur-2xl" onClick={onClose} />
      
      <div className="w-full max-w-2xl relative">
        <LiquidGlassPanel
          cornerRadius={24}
          blurAmount={40}
          backgroundOpacity={0.15}
          displacementScale={20}
          className="border border-white/10 shadow-[0_0_100px_rgba(0,0,0,0.8)] overflow-hidden"
          contentClassName="flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-white/5 bg-white/5">
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center text-primary border border-primary/30 shadow-[0_0_15px_rgba(255,45,85,0.2)]">
                <Keyboard size={22} />
              </div>
              <div>
                <h2 className="text-xl font-black text-white uppercase tracking-tight">Keyboard Shortcuts</h2>
                <p className="text-[10px] text-zinc-500 font-bold tracking-[0.2em] uppercase">Power User Commands</p>
              </div>
            </div>
            
            <button 
              onClick={onClose}
              className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-all border border-white/5"
            >
              <X size={20} />
            </button>
          </div>

          {/* Shortcuts Grid */}
          <div className="p-8 max-h-[70vh] overflow-y-auto custom-scrollbar">
            <div className="grid gap-2">
              {SHORTCUTS.map((shortcut, idx) => (
                <div 
                  key={idx} 
                  className="group flex items-center justify-between p-3 rounded-xl bg-white/[0.02] border border-white/[0.05] hover:bg-white/[0.05] hover:border-white/10 transition-all duration-300"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-white group-hover:text-primary transition-colors">{shortcut.action}</span>
                      <span className="text-[9px] text-zinc-600 font-bold uppercase tracking-widest">{shortcut.category}</span>
                    </div>
                  </div>
                  
                  <div className="flex gap-1">
                    {shortcut.key.split(' ').map((part, pIdx) => {
                      if (part === '+' || part === '/') {
                        return <span key={pIdx} className="text-zinc-600 px-1 flex items-center text-xs">{part}</span>;
                      }
                      return (
                        <div 
                          key={pIdx} 
                          className="min-w-[40px] px-2 py-1 rounded-md bg-zinc-800 border border-zinc-700 shadow-lg text-[10px] font-mono font-bold text-zinc-300 flex items-center justify-center border-b-2 border-b-black/50"
                        >
                          {part}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer Tip */}
          <div className="p-6 bg-black/20 border-t border-white/5 flex items-center justify-center gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
              Pro Tip: Hold <span className="text-white">Shift</span> while dragging to lock movement vertically
            </p>
          </div>
        </LiquidGlassPanel>
      </div>
    </div>,
    document.body
  );
}
