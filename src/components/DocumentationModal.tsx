import React, { useMemo } from 'react';
import { LiquidGlassPanel } from './LiquidGlass';
import { X, BookOpen, ExternalLink } from 'lucide-react';
// @ts-ignore
import docContent from '../../doc.md?raw';

interface DocumentationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DocumentationModal({ isOpen, onClose }: DocumentationModalProps) {
  if (!isOpen) return null;

  // Simple Markdown-ish parser for the modal
  const renderedContent = useMemo(() => {
    const lines = docContent.split('\n');
    let inCodeBlock = false;
    let codeBlockContent: string[] = [];
    
    return lines.map((line: string, index: number) => {
      // Handle Code Blocks
      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          inCodeBlock = false;
          const content = codeBlockContent.join('\n');
          codeBlockContent = [];
          return (
            <pre key={index} className="bg-black/40 p-4 rounded-lg border border-white/10 my-4 overflow-x-auto font-mono text-sm text-primary/90">
              <code>{content}</code>
            </pre>
          );
        } else {
          inCodeBlock = true;
          return null;
        }
      }

      if (inCodeBlock) {
        codeBlockContent.push(line);
        return null;
      }

      // Handle Headers
      if (line.startsWith('# ')) {
        return <h1 key={index} className="text-3xl font-black text-white mt-8 mb-4 tracking-tight">{line.replace('# ', '')}</h1>;
      }
      if (line.startsWith('## ')) {
        return <h2 key={index} className="text-xl font-bold text-primary mt-8 mb-3 uppercase tracking-widest flex items-center gap-2">
          <div className="w-1.5 h-4 bg-primary rounded-full" />
          {line.replace('## ', '')}
        </h2>;
      }
      if (line.startsWith('### ')) {
        return <h3 key={index} className="text-lg font-bold text-white/90 mt-6 mb-2">{line.replace('### ', '')}</h3>;
      }

      // Handle HR
      if (line.trim() === '---') {
        return <div key={index} className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent my-8" />;
      }

      // Handle Lists
      if (line.trim().startsWith('- ')) {
        const content = line.trim().replace('- ', '');
        const parts = content.split('**');
        return (
          <li key={index} className="ml-4 mb-2 text-zinc-300 list-none flex gap-2">
            <span className="text-primary">•</span>
            <span>
              {parts.map((part, i) => i % 2 === 1 ? <strong key={i} className="text-white font-bold">{part}</strong> : part)}
            </span>
          </li>
        );
      }

      // Handle Tables (Simple)
      if (line.includes('|') && line.includes('---')) return null; // Skip divider
      if (line.startsWith('|')) {
        const cells = line.split('|').filter(c => c.trim().length > 0);
        return (
          <div key={index} className="grid grid-cols-[120px_1fr] gap-4 py-2 border-b border-white/5 text-sm">
            <span className="font-mono text-primary font-bold">{cells[0]?.trim()}</span>
            <span className="text-zinc-400">{cells[1]?.trim()}</span>
          </div>
        );
      }

      // Handle Paragraphs
      if (line.trim().length === 0) return <div key={index} className="h-4" />;
      
      const parts = line.split('**');
      return (
        <p key={index} className="text-zinc-400 leading-relaxed mb-2">
          {parts.map((part, i) => i % 2 === 1 ? <strong key={i} className="text-white font-bold">{part}</strong> : part)}
        </p>
      );
    }).filter(Boolean);
  }, []);

  return (
    <div className="fixed inset-0 z-[10001] flex items-center justify-center p-4 md:p-8 animate-in fade-in zoom-in duration-300">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />
      
      <div className="w-full max-w-4xl h-full max-h-[90vh] relative">
        <LiquidGlassPanel
          cornerRadius={24}
          blurAmount={40}
          backgroundOpacity={0.2}
          displacementScale={20}
          className="h-full border border-white/10 shadow-2xl overflow-hidden"
          contentClassName="h-full flex flex-col"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-6 border-b border-white/5 bg-white/5">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/20 flex items-center justify-center text-primary border border-primary/30">
                <BookOpen size={20} />
              </div>
              <div>
                <h2 className="text-xl font-black text-white uppercase tracking-tight">Documentation</h2>
                <p className="text-[10px] text-zinc-500 font-bold tracking-[0.2em] uppercase">User Manual & Setup Guide</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <a 
                href="https://github.com/r0073d-l053r/JAAD-DAW" 
                target="_blank" 
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-zinc-400 transition-colors border border-white/5"
              >
                <ExternalLink size={14} />
                <span>GitHub Repo</span>
              </a>
              <button 
                onClick={onClose}
                className="w-10 h-10 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-all border border-white/5"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-8 custom-scrollbar scroll-smooth">
            <div className="max-w-3xl mx-auto pb-12">
              {renderedContent}
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 bg-black/20 border-t border-white/5 text-center">
            <p className="text-[9px] text-zinc-600 font-bold uppercase tracking-[0.3em]">
              JAAD-DAW © 2026 • Powered by Gemini AI & Essentia.js
            </p>
          </div>
        </LiquidGlassPanel>
      </div>
    </div>
  );
}
