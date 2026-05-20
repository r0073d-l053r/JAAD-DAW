import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { LiquidGlassPanel } from './LiquidGlass';
import { useApp } from '../lib/store';
import { X, Link, Check, Twitter, Mail, Share2, Lock, CloudUpload, AlertTriangle } from 'lucide-react';

// Discord brand icon SVG component
function DiscordIcon({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
    </svg>
  );
}

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaveToCloud: () => Promise<void>;
}

export function ShareModal({ isOpen, onClose, onSaveToCloud }: ShareModalProps) {
  const { state } = useApp();
  const [copiedLink, setCopiedLink] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  const isCloudSaved = state.hasManuallySaved;
  const shareUrl = `${window.location.origin}${window.location.pathname}?project=${state.projectId}`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 2000);
    } catch (err) {
      console.error("Failed to copy link:", err);
    }
  };

  const discordShareUrl = `https://discord.com/channels/@me`;
  const handleShareToDiscord = () => {
    // Copy the share message to clipboard, then open Discord
    const discordText = `🎵 Check out my project on JAAD DAW! 🎵\n👉 ${shareUrl}`;
    navigator.clipboard.writeText(discordText).catch(() => {});
    window.open(discordShareUrl, '_blank', 'noopener,noreferrer');
  };

  const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent("Check out the track I'm working on inside JAAD DAW! 🎵🔥")}&url=${encodeURIComponent(shareUrl)}`;
  const emailUrl = `mailto:?subject=${encodeURIComponent(`Check out my track: ${state.projectName || "Unnamed Project"}`)}&body=${encodeURIComponent(`Hey!\n\nI'm collaborating on a new track using JAAD DAW. Listen to my project, edit the timeline, and remix it in real-time here:\n\n${shareUrl}\n\nLet me know what you think!`)}`;

  const handleSaveAndShare = async () => {
    setIsSaving(true);
    try {
      await onSaveToCloud();
    } catch (err) {
      console.error("Save to cloud failed:", err);
    } finally {
      setIsSaving(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[100000] flex items-center justify-center animate-in fade-in duration-500 p-4">
      {/* Semi-transparent backdrop blur */}
      <div className="absolute inset-0 bg-[#050507]/80 backdrop-blur-2xl" onClick={onClose} />
      
      {/* Animated Modal Container */}
      <div className="w-full max-w-lg relative animate-in zoom-in-95 duration-300">
        <LiquidGlassPanel
          cornerRadius={32}
          blurAmount={50}
          backgroundOpacity={0.12}
          displacementScale={30}
          className="border border-white/10 shadow-[0_0_100px_rgba(0,0,0,0.8)] overflow-hidden"
          contentClassName="flex flex-col"
        >
          {/* Header Banner with Premium Ambient Glow */}
          <div className="relative h-40 overflow-hidden bg-gradient-to-br from-primary/10 via-black to-black border-b border-white/5">
             <div className="absolute inset-0 opacity-35" 
                  style={{ backgroundImage: `radial-gradient(circle at 10% 30%, rgba(255,45,85,0.4) 0%, transparent 60%), radial-gradient(circle at 90% 70%, rgba(107,68,255,0.4) 0%, transparent 60%)` }} 
             />
             <div className="absolute inset-0 flex flex-col items-center justify-center text-center p-6">
                <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl flex items-center justify-center mb-3 shadow-2xl relative group overflow-hidden">
                   <div className="absolute inset-0 bg-gradient-to-tr from-primary/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                   <Share2 size={24} className="text-white group-hover:scale-110 transition-transform duration-500" />
                </div>
                <h2 className="text-2xl font-black text-white tracking-tight uppercase">Share Project</h2>
                <p className="text-[9px] text-primary font-black tracking-[0.4em] uppercase mt-1">Collab & Remix in Real-Time</p>
             </div>

             <button 
                onClick={onClose}
                className="absolute top-5 right-5 w-8 h-8 rounded-lg bg-black/40 hover:bg-white/10 flex items-center justify-center text-zinc-400 hover:text-white transition-all border border-white/10 backdrop-blur-md"
              >
                <X size={16} />
             </button>
          </div>

          {/* Main Body */}
          <div className="p-8 space-y-6">
            {!isCloudSaved ? (
              /* ─── Unsaved State: Cloud Save Required ─── */
              <div className="flex flex-col items-center text-center space-y-6">
                <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center shadow-lg">
                  <AlertTriangle size={28} className="text-amber-400" />
                </div>
                
                <div className="space-y-2 max-w-sm">
                  <h3 className="text-white font-bold text-base">Cloud Save Required</h3>
                  <p className="text-zinc-400 text-xs leading-relaxed">
                    Your project must be saved to the cloud before sharing. This ensures collaborators receive all tracks, audio assets, and project settings when they open your link.
                  </p>
                </div>

                <button
                  onClick={handleSaveAndShare}
                  disabled={isSaving}
                  className={`w-full max-w-xs h-12 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-3 border shadow-lg ${
                    isSaving
                      ? 'bg-primary/10 text-primary/60 border-primary/20 cursor-wait'
                      : 'bg-primary/20 text-primary border-primary/40 hover:bg-primary/30 hover:border-primary/60 hover:scale-[1.02] active:scale-[0.98] hover:shadow-[0_0_30px_rgba(255,45,85,0.2)]'
                  }`}
                >
                  <CloudUpload size={18} className={isSaving ? 'animate-pulse' : ''} />
                  <span>{isSaving ? 'Saving to Cloud...' : 'Save to Cloud & Share'}</span>
                </button>

                <p className="text-[10px] text-zinc-600 leading-relaxed max-w-xs">
                  This will upload your project state and all audio assets to secure cloud storage. The share link will become available once the save is complete.
                </p>
              </div>
            ) : (
              /* ─── Saved State: Full Share UI ─── */
              <>
                <p className="text-zinc-400 text-xs leading-relaxed text-center">
                  Generate a secure deep-link to this project. Collaborators can load it instantly, listen, download assets, and contribute edits to the cloud.
                </p>

                {/* Input URL Container */}
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block">Project Share Link</label>
                  <div className="flex gap-2">
                    <div className="flex-1 h-11 rounded-xl bg-black/40 border border-white/5 flex items-center px-4 overflow-hidden text-zinc-300 text-xs font-mono select-all">
                      {shareUrl}
                    </div>
                    <button
                      onClick={handleCopyLink}
                      className={`h-11 px-5 rounded-xl text-xs font-bold transition-all flex items-center gap-2 border shadow-lg ${
                        copiedLink 
                          ? 'bg-green-500/20 text-green-400 border-green-500/30' 
                          : 'bg-white/5 text-white border-white/10 hover:bg-white/10 hover:border-white/20 hover:scale-[1.02] active:scale-[0.98]'
                      }`}
                    >
                      {copiedLink ? <Check size={14} className="animate-bounce" /> : <Link size={14} />}
                      <span>{copiedLink ? 'Copied!' : 'Copy Link'}</span>
                    </button>
                  </div>
                </div>

                {/* Share Grid Section */}
                <div className="space-y-3 pt-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest block text-center">Quick Share</label>
                  
                  <div className="grid grid-cols-3 gap-3">
                    {/* Twitter Share */}
                    <a
                      href={tweetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="h-20 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-white/15 hover:bg-white/[0.05] hover:scale-[1.03] active:scale-[0.97] transition-all flex flex-col items-center justify-center gap-2 text-zinc-400 hover:text-white"
                    >
                      <Twitter size={20} className="text-sky-400" />
                      <span className="text-[10px] font-bold uppercase tracking-wider">Twitter / X</span>
                    </a>

                    {/* Discord Share */}
                    <button
                      onClick={handleShareToDiscord}
                      className="h-20 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-white/15 hover:bg-white/[0.05] hover:scale-[1.03] active:scale-[0.97] transition-all flex flex-col items-center justify-center gap-2 text-zinc-400 hover:text-white"
                    >
                      <DiscordIcon size={20} className="text-[#5865F2]" />
                      <span className="text-[10px] font-bold uppercase tracking-wider">Share to Discord</span>
                    </button>

                    {/* Email Share */}
                    <a
                      href={emailUrl}
                      className="h-20 rounded-2xl bg-white/[0.02] border border-white/5 hover:border-white/15 hover:bg-white/[0.05] hover:scale-[1.03] active:scale-[0.97] transition-all flex flex-col items-center justify-center gap-2 text-zinc-400 hover:text-white"
                    >
                      <Mail size={20} className="text-primary" />
                      <span className="text-[10px] font-bold uppercase tracking-wider">Email</span>
                    </a>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Animated Footer */}
          <div className="p-5 bg-black/40 border-t border-white/5 flex items-center justify-center gap-3">
             <div className="relative flex items-center justify-center">
                {isCloudSaved ? (
                  <>
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-ping absolute opacity-75" />
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500 relative" />
                  </>
                ) : (
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500 relative" />
                )}
             </div>
             <p className="text-[9px] text-zinc-500 font-bold uppercase tracking-[0.25em] flex items-center gap-1.5">
                {isCloudSaved ? (
                  <>
                    <Lock size={10} className="text-green-500" />
                    Cloud Sync Active & Encrypted
                  </>
                ) : (
                  <>
                    <CloudUpload size={10} className="text-amber-500" />
                    Project Not Yet Synced to Cloud
                  </>
                )}
             </p>
          </div>
        </LiquidGlassPanel>
      </div>
    </div>,
    document.body
  );
}
