import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { useApp } from '../lib/store';
import { LiquidGlassPanel } from './LiquidGlass';
import { X } from 'lucide-react';

export function BPMSyncPopup() {
  const { state, dispatch } = useApp();

  if (!state.showBPMSyncPopup) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={() => dispatch({ type: 'REQUEST_BPM_SYNC_CANCEL' })}
        />
        
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative w-full max-w-md overflow-hidden"
        >
          <LiquidGlassPanel
            cornerRadius={24}
            blurAmount={40}
            backgroundOpacity={0.2}
            mode="standard"
            className="border border-white/20 shadow-2xl"
            contentClassName="p-8 flex flex-col items-center text-center"
          >
            <div className="w-16 h-16 mb-6 rounded-full studio-gradient flex items-center justify-center shadow-lg shadow-primary/20">
               <div className="text-white animate-studio-spin">
                 <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                   <path d="M12 2v4"/><path d="M12 18v4"/><path d="m4.93 4.93 2.83 2.83"/><path d="m16.24 16.24 2.83 2.83"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="m4.93 19.07 2.83-2.83"/><path d="m16.24 7.76 2.83-2.83"/>
                 </svg>
               </div>
            </div>

            <h3 className="text-xl font-bold text-white mb-2">Syncing Project BPM</h3>
            <p className="text-zinc-400 text-sm mb-8 leading-relaxed">
              Please wait while your project BPM is Auto-Detected.<br/>
              This may take a few moments.
            </p>

            <div className="w-full h-2 bg-white/10 rounded-full overflow-hidden mb-8 relative">
              <motion.div
                initial={{ width: "0%" }}
                animate={{ width: "100%" }}
                transition={{ duration: 5, ease: "easeInOut" }}
                className="h-full studio-gradient shadow-[0_0_15px_rgba(255,42,95,0.5)]"
              />
            </div>

            <button
              onClick={() => dispatch({ type: 'REQUEST_BPM_SYNC_CANCEL' })}
              className="px-6 py-2.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-zinc-300 text-sm font-medium transition-all hover:scale-105 active:scale-95 flex items-center space-x-2"
            >
              <X size={14} />
              <span>Cancel Auto-Detection</span>
            </button>
            <p className="text-zinc-600 text-[10px] mt-3 leading-relaxed">
              If you cancel this, you will need to manually enter the BPM<br/>or you can run Auto-Detect later.
            </p>
          </LiquidGlassPanel>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
