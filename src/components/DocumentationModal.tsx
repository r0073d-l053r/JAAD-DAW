import React, { useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { LiquidGlassPanel } from './LiquidGlass';
import { X, BookOpen, ExternalLink, HelpCircle } from 'lucide-react';
import docContentImport from '../../docs/doc.md?raw';

// Fallback content in case the file doesn't load
const FALLBACK_DOC = `
# JAAD Documentation (Emergency Backup)

It looks like the external documentation file failed to load, but don't worry! Here is a quick start guide.

## 🚀 Quick Start
1. **Drag and Drop** audio files into the timeline to get started.
2. **Press Space** to toggle playback.
3. **Double Click** a clip to edit volume envelopes.

## 🎹 Shortcuts
- **Space**: Play/Pause
- **Ctrl+S**: Save
- **Ctrl+Z**: Undo
- **Shift+Drag**: Lock Vertical Timing
`;

interface DocumentationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DocumentationModal({ isOpen, onClose }: DocumentationModalProps) {
  const contentRef = React.useRef<HTMLDivElement>(null);
  const docContent = (typeof docContentImport === 'string' && docContentImport.length > 10) ? docContentImport : FALLBACK_DOC;

  useEffect(() => {
    if (isOpen) {
      console.log("DocumentationModal: Open. Content type:", typeof docContentImport, "Length:", docContent.length);
    }
  }, [isOpen]);

  // Extract sections for the Wiki Sidebar
  const sections = useMemo(() => {
    return docContent
      .split('\n')
      .filter(line => line.startsWith('## '))
      .map(line => line.replace('## ', '').trim());
  }, [docContent]);

  const scrollToSection = (sectionName: string) => {
    const sectionElements = contentRef.current?.querySelectorAll('h2');
    sectionElements?.forEach((el) => {
      if (el.textContent?.includes(sectionName)) {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  };

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
            <pre key={index} className="bg-black/60 p-5 rounded-xl border border-white/10 my-6 overflow-x-auto font-mono text-sm text-primary/90 shadow-inner">
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
        return <h1 key={index} className="text-4xl font-black text-white mt-4 mb-8 tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60">{line.replace('# ', '')}</h1>;
      }
      if (line.startsWith('## ')) {
        return <h2 key={index} className="text-xl font-bold text-primary mt-14 mb-4 uppercase tracking-[0.2em] flex items-center gap-3 pt-10 border-t border-white/5">
          <div className="w-1.5 h-6 bg-primary rounded-full shadow-[0_0_15px_rgba(255,45,85,0.5)]" />
          {line.replace('## ', '')}
        </h2>;
      }
      if (line.startsWith('### ')) {
        return <h3 key={index} className="text-lg font-bold text-white mt-8 mb-3">{line.replace('### ', '')}</h3>;
      }

      // Handle HR
      if (line.trim() === '---') {
        return <div key={index} className="h-px bg-gradient-to-r from-transparent via-white/10 to-transparent my-10" />;
      }

      // Handle Lists
      if (line.trim().startsWith('- ')) {
        const content = line.trim().replace('- ', '');
        const parts = content.split('**');
        return (
          <li key={index} className="ml-4 mb-3 text-zinc-300 list-none flex gap-3 items-start">
            <div className="mt-2 w-1 h-1 rounded-full bg-primary shrink-0" />
            <span className="leading-relaxed">
              {parts.map((part, i) => i % 2 === 1 ? <strong key={i} className="text-white font-black">{part}</strong> : part)}
            </span>
          </li>
        );
      }

      // Handle Tables
      if (line.includes('|') && line.includes('---')) return null;
      if (line.startsWith('|')) {
        const cells = line.split('|').filter(c => c.trim().length > 0);
        return (
          <div key={index} className="grid grid-cols-[160px_1fr] gap-6 py-3 border-b border-white/5 text-sm hover:bg-white/[0.02] transition-colors rounded-lg px-2">
            <span className="font-mono text-primary/80 font-black">{cells[0]?.trim()}</span>
            <span className="text-zinc-400">{cells[1]?.trim()}</span>
          </div>
        );
      }

      // Handle Paragraphs
      if (line.trim().length === 0) return <div key={index} className="h-4" />;

      const parts = line.split('**');
      return (
        <p key={index} className="text-zinc-400 leading-relaxed mb-4 text-base">
          {parts.map((part, i) => i % 2 === 1 ? <strong key={i} className="text-white font-black">{part}</strong> : part)}
        </p>
      );
    }).filter(Boolean);
  }, [docContent]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100000] flex items-center justify-center animate-in fade-in duration-500">
      <div className="absolute inset-0 bg-[#050507]/90 backdrop-blur-2xl" onClick={onClose} />

      <div className="w-screen h-screen relative flex flex-col p-4 md:p-8 lg:p-12 overflow-hidden">
        <LiquidGlassPanel
          cornerRadius={32}
          blurAmount={50}
          backgroundOpacity={0.12}
          displacementScale={30}
          className="w-full h-full border border-white/10 shadow-[0_0_100px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col"
          contentClassName="h-full flex flex-col"
        >
          {/* Main Content Layout */}
          <div className="flex-1 flex overflow-hidden">
            {/* Wiki Sidebar */}
            <div className="w-72 border-r border-white/5 bg-black/40 flex flex-col p-8 hidden lg:flex">
              <div className="flex items-center gap-4 mb-10">
                <div className="w-12 h-12 rounded-2xl bg-primary/20 flex items-center justify-center text-primary border border-primary/30 shadow-[0_0_20px_rgba(255,45,85,0.2)]">
                  <HelpCircle size={24} />
                </div>
                <div>
                  <h2 className="text-xl font-black text-white tracking-tighter uppercase">JAAD Wiki</h2>
                  <p className="text-[9px] text-zinc-500 font-bold tracking-[0.2em] uppercase">User Manual v1.1</p>
                </div>
              </div>

              <h4 className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-6 px-3">Documentation Sections</h4>
              <nav className="space-y-1.5 flex-1 overflow-y-auto custom-scrollbar pr-2">
                {sections.map((section, idx) => (
                  <button
                    key={idx}
                    onClick={() => scrollToSection(section)}
                    className="w-full text-left px-4 py-3 rounded-xl text-sm font-bold text-zinc-500 hover:bg-white/5 hover:text-primary transition-all duration-300 group flex items-center gap-3 border border-transparent hover:border-white/5"
                  >
                    <div className="w-1.5 h-1.5 rounded-full bg-zinc-800 group-hover:bg-primary group-hover:scale-125 transition-all shadow-[0_0_8px_rgba(255,45,85,0)] group-hover:shadow-[0_0_8px_rgba(255,45,85,0.5)]" />
                    {section}
                  </button>
                ))}
              </nav>

              <div className="mt-8 pt-6 border-t border-white/5">
                <a
                  href="https://github.com/r0073d-l053r/JAAD-DAW"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-xs text-zinc-400 hover:text-white transition-all border border-white/5 group"
                >
                  <div className="flex items-center gap-2">
                    <ExternalLink size={14} className="group-hover:scale-110 transition-transform" />
                    <span>View Repository</span>
                  </div>
                </a>
              </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 flex flex-col min-w-0">
              {/* Floating Header Actions (for mobile/tablet mostly, but good for X button) */}
              <div className="absolute top-8 right-8 z-[100001]">
                <button
                  onClick={onClose}
                  className="w-14 h-14 rounded-2xl bg-white/5 hover:bg-red-500/80 backdrop-blur-xl flex items-center justify-center text-white transition-all duration-300 border border-white/10 shadow-2xl hover:scale-110 hover:rotate-90 active:scale-95"
                  title="Close Wiki"
                >
                  <X size={28} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-12 lg:p-20 custom-scrollbar scroll-smooth" ref={contentRef}>
                <div className="max-w-4xl mx-auto pb-24">
                  {renderedContent}

                  <div className="mt-20 pt-10 border-t border-white/5 flex flex-col items-center gap-4">
                    <div className="w-12 h-1 bg-gradient-to-r from-transparent via-primary to-transparent rounded-full opacity-50" />
                    <p className="text-[10px] text-zinc-600 font-bold uppercase tracking-[0.4em]">End of Documentation</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </LiquidGlassPanel>
      </div>
    </div>,
    document.body
  );
}
