import React from 'react';
import { useApp } from '../lib/store';
import { LiquidGlassPanel } from './LiquidGlass';
import { Cloud, Loader2 } from 'lucide-react';

export function SyncOverlay({ progress }: { progress: number }) {
  const { state } = useApp();

  if (!state.isSyncing) return null;

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/40 backdrop-blur-sm transition-all animate-in fade-in duration-300">
      <div className="w-full max-w-md px-6">
        <LiquidGlassPanel
          cornerRadius={24}
          blurAmount={40}
          backgroundOpacity={0.25}
          className="shadow-2xl border border-white/10"
          contentClassName="p-8 flex flex-col items-center text-center space-y-6"
        >
          <div className="relative">
             <div className="absolute inset-0 bg-primary/20 blur-2xl rounded-full animate-pulse" />
             <div className="relative bg-zinc-900/50 p-4 rounded-2xl border border-white/10">
                <Cloud size={48} className="text-primary animate-bounce" />
             </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold tracking-tight text-white">Syncing to Cloud</h2>
            <p className="text-zinc-400 text-sm">
              Please wait while we secure your project and assets.
              <br />
              Do not close the application.
            </p>
          </div>

          <div className="w-full space-y-3">
             <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                <span>Uploading Assets</span>
                <span className="text-primary">{state.isSyncing ? 'In Progress' : 'Complete'}</span>
             </div>

             <div className="h-2 w-full bg-white/5 rounded-full overflow-hidden border border-white/5 p-0.5">
                <div
                  className="h-full bg-gradient-to-r from-primary to-primary/60 rounded-full transition-all duration-500 ease-out shadow-[0_0_10px_rgba(255,45,85,0.4)]"
                  style={{ width: `${progress}%` }}
                />
             </div>
          </div>

          <div className="flex items-center gap-2 text-zinc-500 text-xs font-medium animate-pulse">
            <Loader2 size={14} className="animate-spin" />
            <span>Establishing secure connection...</span>
          </div>
        </LiquidGlassPanel>
      </div>
    </div>
  );
}
