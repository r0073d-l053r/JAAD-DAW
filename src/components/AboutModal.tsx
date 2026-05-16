import React from 'react';
import { createPortal } from 'react-dom';
import { LiquidGlassPanel } from './LiquidGlass';
import { X, Github, Linkedin, Globe, Heart, Music, Sparkles, Code } from 'lucide-react';

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AboutModal({ isOpen, onClose }: AboutModalProps) {
  if (!isOpen) return null;

  const socialLinks = [
    { icon: <Github size={20} />, label: 'GitHub', url: 'https://github.com/r0073d-l053r', color: 'hover:text-white' },
    { icon: <Linkedin size={20} />, label: 'LinkedIn', url: 'https://www.linkedin.com/in/r0073d-l053r/', color: 'hover:text-[#0077B5]' },
    { icon: <Globe size={20} />, label: 'Website', url: 'https://www.r0073dl053r.com', color: 'hover:text-primary' },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[100000] flex items-center justify-center animate-in fade-in duration-500 p-4">
      <div className="absolute inset-0 bg-[#050507]/80 backdrop-blur-2xl" onClick={onClose} />
      
      <div className="w-full max-w-2xl relative">
        <LiquidGlassPanel
          cornerRadius={32}
          blurAmount={50}
          backgroundOpacity={0.12}
          displacementScale={30}
          className="border border-white/10 shadow-[0_0_100px_rgba(0,0,0,0.8)] overflow-hidden"
          contentClassName="flex flex-col"
        >
          {/* Hero Section */}
          <div className="relative h-48 overflow-hidden bg-gradient-to-br from-primary/20 via-black to-black border-b border-white/5">
             <div className="absolute inset-0 opacity-30" 
                  style={{ backgroundImage: `radial-gradient(circle at 20% 50%, rgba(255,45,85,0.4) 0%, transparent 50%), radial-gradient(circle at 80% 50%, rgba(107,68,255,0.4) 0%, transparent 50%)` }} 
             />
                 <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
                 <div className="w-20 h-20 rounded-3xl bg-white/5 border border-white/10 backdrop-blur-xl flex items-center justify-center mb-4 shadow-2xl relative group overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-tr from-primary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                    <Sparkles size={40} className="text-white group-hover:scale-110 transition-transform duration-500" />
                 </div>
                 <h2 className="text-3xl font-black text-white tracking-tighter uppercase">JAAD</h2>
                 <p className="text-[10px] text-primary font-bold tracking-[0.4em] uppercase mt-1">v1.1.0 • Built with Passion</p>
              </div>

             <button 
                onClick={onClose}
                className="absolute top-6 right-6 w-10 h-10 rounded-xl bg-black/40 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-all border border-white/10 backdrop-blur-md"
              >
                <X size={20} />
              </button>
          </div>

          {/* Bio Content */}
          <div className="p-10 space-y-8">
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-primary">
                 <Music size={18} />
                 <h4 className="text-[10px] font-black uppercase tracking-[0.3em]">The Vision</h4>
              </div>
                 <p className="text-zinc-300 leading-relaxed text-base italic">
                   "JAAD started as a personal quest. After years spent in smoky basements with vintage synths and late nights debugging neural networks, I realized the world didn't need 'Just Another' tool—it needed a workspace that felt alive. I built this because I wanted a DAW that understands the rhythm of my thoughts as much as the frequency of my kicks."
                 </p>
            </div>

            <div className="space-y-4">
               <div className="flex items-center gap-3 text-primary">
                  <Code size={18} />
                  <h4 className="text-[10px] font-black uppercase tracking-[0.3em]">The Tech</h4>
               </div>
               <p className="text-zinc-400 leading-relaxed text-sm">
                  Leveraging modern Web Audio APIs, Essentia.js for algorithmic rhythm analysis, and Gemini-powered creative assistance, this project represents the intersection of high-fidelity DSP and next-gen AI. It is designed for creators who demand zero friction between inspiration and implementation.
               </p>
            </div>

            {/* Social Links */}
            <div className="pt-8 border-t border-white/5 flex flex-col items-center gap-6">
               <h4 className="text-[9px] font-black text-zinc-600 uppercase tracking-[0.4em]">Connect with the Creator</h4>
               <div className="flex gap-4">
                  {socialLinks.map((link, idx) => (
                    <a 
                      key={idx}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`w-14 h-14 rounded-2xl bg-white/[0.03] border border-white/5 flex items-center justify-center text-zinc-500 ${link.color} hover:bg-white/5 hover:border-white/10 hover:scale-110 active:scale-95 transition-all duration-300 shadow-xl group`}
                      title={link.label}
                    >
                      {link.icon}
                    </a>
                  ))}
               </div>
            </div>
          </div>

          {/* Footer Footer */}
          <div className="p-6 bg-black/40 border-t border-white/5 flex items-center justify-center gap-2">
            <Heart size={12} className="text-primary animate-pulse" />
            <p className="text-[9px] text-zinc-600 font-bold uppercase tracking-[0.3em]">
              Crafted with soul in 2026
            </p>
          </div>
        </LiquidGlassPanel>
      </div>
    </div>,
    document.body
  );
}
