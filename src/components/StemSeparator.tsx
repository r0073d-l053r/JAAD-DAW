/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from "react";
import { motion, useDragControls } from "motion/react";
import { X, Sliders, Play, CheckSquare, Square, Drum, Music, Mic2, Mic, Piano, Sparkles, Wind, Guitar, Fan, Volume2, Settings2, ShieldCheck, Loader2 } from "lucide-react";
import { useApp } from "../lib/store";
import { audioEngine } from "../lib/audioEngine";
import { separateAudioStem } from "../lib/stemSeparation";
import { audioBufferToWav } from "../lib/exportUtils";
import { saveAsset } from "../lib/assetManager";
import { uploadAssetCloud } from "../lib/syncUtils";
import { LiquidGlassPanel } from "./LiquidGlass";

const STEM_INSTRUMENTS = [
  { name: "Vocals", icon: <Mic size={14} />, color: "#E91E63", defaultChecked: true },
  { name: "Drums", icon: <Drum size={14} />, color: "#FF2A5F", defaultChecked: true },
  { name: "Bass", icon: <Volume2 size={14} />, color: "#00E871", defaultChecked: true },
  { name: "Guitar", icon: <Guitar size={14} />, color: "#6B44FF", defaultChecked: true },
  { name: "Keyboard", icon: <Piano size={14} />, color: "#4B7BFF", defaultChecked: false },
  { name: "Percussion", icon: <Drum size={14} />, color: "#FFEB3B", defaultChecked: false },
  { name: "Strings", icon: <Music size={14} />, color: "#FF9800", defaultChecked: false },
  { name: "Synth", icon: <Fan size={14} />, color: "#00BCD4", defaultChecked: false },
  { name: "FX", icon: <Sparkles size={14} />, color: "#9C27B0", defaultChecked: false },
  { name: "Brass", icon: <Wind size={14} />, color: "#8BC34A", defaultChecked: false },
  { name: "Woodwinds", icon: <Wind size={14} />, color: "#FF5722", defaultChecked: false },
  { name: "Backing Vocals", icon: <Mic2 size={14} />, color: "#3F51B5", defaultChecked: false },
  { name: "Song", icon: <Music size={14} />, color: "#607D8B", defaultChecked: false },
  { name: "Custom", icon: <Settings2 size={14} />, color: "#795548", defaultChecked: false },
];

export const StemSeparator: React.FC = () => {
  const { state, dispatch } = useApp();
  const dragControls = useDragControls();

  const clipId = state.stemSeparatorClipId;

  // Locate clip and track in the project
  let targetClip: any = null;
  let targetTrack: any = null;

  if (clipId) {
    for (const track of state.tracks) {
      const c = track.clips.find((clip) => clip.id === clipId);
      if (c) {
        targetClip = c;
        targetTrack = track;
        break;
      }
    }
  }

  // Toggles for active selection
  const [selectedStems, setSelectedStems] = useState<string[]>(
    STEM_INSTRUMENTS.filter(s => s.defaultChecked).map(s => s.name)
  );

  // Custom filter sliders
  const [lowCut, setLowCut] = useState<number>(300);
  const [highCut, setHighCut] = useState<number>(5000);

  // Processing indicators
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [currentStep, setCurrentStep] = useState<string>("");
  const [progress, setProgress] = useState<number>(0);

  const handleToggleStem = (name: string) => {
    setSelectedStems((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  const handleSelectAll = () => {
    setSelectedStems(STEM_INSTRUMENTS.map((s) => s.name));
  };

  const handleSelectNone = () => {
    setSelectedStems([]);
  };

  const handleProcessSeparation = async () => {
    if (!targetClip || selectedStems.length === 0) return;

    setIsProcessing(true);
    setProgress(0);

    const originalBuffer = audioEngine.buffers.get(targetClip.bufferId || targetClip.id);
    if (!originalBuffer) {
      setCurrentStep("Error: Original clip audio data not found.");
      setIsProcessing(false);
      return;
    }

    try {
      const totalSteps = selectedStems.length;
      
      for (let i = 0; i < selectedStems.length; i++) {
        const stem = selectedStems[i];
        setCurrentStep(`Isolating ${stem}...`);
        
        // Let the event loop refresh the browser UI before rendering next heavy DSP array
        await new Promise((res) => setTimeout(res, 50));

        // Call our advanced DSP processor
        const separatedBuffer = await separateAudioStem(originalBuffer, stem, { lowCut, highCut });
        
        // Convert separated buffer to native audio Blob
        const wavBlob = audioBufferToWav(separatedBuffer);
        const newClipId = `clip_${Date.now()}_stem_${stem.toLowerCase().replace(/\s+/g, '_')}`;
        const stemFileName = `${targetClip.audioData?.replace(/\.[^/.]+$/, "") || 'Audio'}_[STEM_${stem.toUpperCase().replace(/\s+/g, '_')}].wav`;
        const stemFile = new File([wavBlob], stemFileName, { type: "audio/wav" });

        // Register new Audio Buffer into the engine
        audioEngine.buffers.set(newClipId, separatedBuffer);

        // Store into asset database & upload asynchronously
        await saveAsset(newClipId, stemFile);
        uploadAssetCloud(newClipId, stemFile).catch((err) =>
          console.error(`Failed to push stem ${stem} to cloud:`, err)
        );

        // Dispatch addition to state store
        const matchConfig = STEM_INSTRUMENTS.find(x => x.name === stem);
        const trackColor = matchConfig?.color || "#FFFFFF";
        const newTrackId = `track_${Date.now()}_stem_${stem.toLowerCase().replace(/\s+/g, '_')}`;

        dispatch({
          type: "ADD_TRACK",
          payload: {
            id: newTrackId,
            name: stem,
            volume: 0.8,
            pan: 0,
            muted: false,
            solo: false,
            color: trackColor,
            clips: [
              {
                id: newClipId,
                start: targetClip.start,
                duration: targetClip.duration,
                audioData: stemFileName,
              },
            ],
          },
        });

        dispatch({ type: "INCREMENT_BUFFERS_VERSION" });

        // Incremental progress step calculation
        setProgress(Math.round(((i + 1) / totalSteps) * 100));
      }

      setCurrentStep("Complete!");
      await new Promise((res) => setTimeout(res, 400));
      dispatch({ type: "SET_STEM_SEPARATOR_CLIP", payload: null });
    } catch (err) {
      console.error("DSP Audio Separation failed:", err);
      setCurrentStep("Error isolating audio clips.");
    } finally {
      setIsProcessing(false);
    }
  };

  if (!clipId || !targetClip) return null;

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center pointer-events-none">
      <motion.div
        drag
        dragListener={false}
        dragControls={dragControls}
        dragMomentum={false}
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-[480px] bg-[#0c0d10]/95 border border-white/10 rounded-2xl shadow-2xl flex flex-col pointer-events-auto select-none overflow-hidden"
        style={{
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 40px rgba(175, 82, 222, 0.15)",
        }}
      >
        {/* Drag header */}
        <div
          className="px-4 py-3 bg-zinc-900/50 border-b border-white/5 flex items-center justify-between cursor-grab active:cursor-grabbing"
          onPointerDown={(e) => dragControls.start(e)}
        >
          <div className="flex items-center space-x-2">
            <div className="w-2.5 h-2.5 rounded-full bg-primary animate-pulse" />
            <span className="text-xs font-bold text-white uppercase tracking-wider">
              AI Stem Separation Studio
            </span>
          </div>
          <button
            onClick={() => dispatch({ type: "SET_STEM_SEPARATOR_CLIP", payload: null })}
            className="p-1 hover:bg-white/5 text-zinc-400 hover:text-white rounded-md transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 flex-1 flex flex-col space-y-4">
          {/* Target Track Label */}
          <div className="bg-white/5 rounded-xl border border-white/5 p-3 flex flex-col">
            <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">
              Target Source Clip
            </span>
            <span className="text-sm font-medium text-white truncate mt-1">
              {targetClip.audioData || "Unnamed Audio"}
            </span>
            <span className="text-[10px] text-zinc-500 mt-0.5">
              Duration: {targetClip.duration.toFixed(2)} seconds | Track: {targetTrack?.name || "Audio Track"}
            </span>
          </div>

          {/* Draggable Instruments Toggle Matrix */}
          <div className="flex flex-col flex-1">
            <div className="flex justify-between items-center mb-2">
              <span className="text-xs font-semibold text-zinc-300">Select Stems to Extract:</span>
              <div className="flex space-x-2 text-[10px] text-zinc-400">
                <button onClick={handleSelectAll} className="hover:text-primary transition-colors font-medium">Select All</button>
                <span>|</span>
                <button onClick={handleSelectNone} className="hover:text-primary transition-colors font-medium">Clear All</button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 max-h-[220px] overflow-y-auto custom-scrollbar pr-1">
              {STEM_INSTRUMENTS.map((inst) => {
                const isSelected = selectedStems.includes(inst.name);
                return (
                  <button
                    key={inst.name}
                    disabled={isProcessing}
                    onClick={() => handleToggleStem(inst.name)}
                    className={`flex items-center space-x-3 px-3 py-2.5 rounded-lg border text-left transition-all ${
                      isSelected
                        ? "bg-primary/10 border-primary/45 shadow-[0_0_12px_rgba(175,82,222,0.1)] text-white"
                        : "bg-white/5 border-white/5 text-zinc-400 hover:bg-white/10 hover:border-white/10"
                    }`}
                  >
                    <div
                      className="p-1.5 rounded"
                      style={{
                        backgroundColor: isSelected ? `${inst.color}15` : "rgba(255,255,255,0.05)",
                        color: isSelected ? inst.color : "#999",
                      }}
                    >
                      {inst.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium truncate">{inst.name}</p>
                    </div>
                    <div>
                      {isSelected ? (
                        <CheckSquare size={14} className="text-primary" />
                      ) : (
                        <Square size={14} className="text-zinc-500" />
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Frequencies Panel */}
          {selectedStems.includes("Custom") && (
            <div className="bg-white/5 rounded-xl border border-white/5 p-3 flex flex-col space-y-2">
              <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider flex items-center space-x-1">
                <Sliders size={12} className="text-primary" />
                <span>Custom Bandpass Frequency Parameters</span>
              </span>
              
              <div className="flex items-center space-x-4">
                <div className="flex-1 flex flex-col">
                  <div className="flex justify-between text-[10px] text-zinc-400">
                    <span>Low Cut Filter</span>
                    <span>{lowCut} Hz</span>
                  </div>
                  <input
                    type="range"
                    min="20"
                    max="2000"
                    value={lowCut}
                    onChange={(e) => setLowCut(Number(e.target.value))}
                    disabled={isProcessing}
                    className="w-full mt-1 accent-primary h-1 bg-zinc-800 rounded-lg cursor-pointer"
                  />
                </div>

                <div className="flex-1 flex flex-col">
                  <div className="flex justify-between text-[10px] text-zinc-400">
                    <span>High Cut Filter</span>
                    <span>{highCut} Hz</span>
                  </div>
                  <input
                    type="range"
                    min="1000"
                    max="20000"
                    value={highCut}
                    onChange={(e) => setHighCut(Number(e.target.value))}
                    disabled={isProcessing}
                    className="w-full mt-1 accent-primary h-1 bg-zinc-800 rounded-lg cursor-pointer"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Processing overlay / Progress indicators */}
          {isProcessing && (
            <div className="p-3 bg-primary/5 rounded-xl border border-primary/20 flex flex-col space-y-2">
              <div className="flex items-center justify-between text-xs text-white">
                <div className="flex items-center space-x-2">
                  <Loader2 size={12} className="animate-spin text-primary" />
                  <span className="font-semibold text-zinc-200">{currentStep}</span>
                </div>
                <span className="font-bold">{progress}%</span>
              </div>
              
              <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-300 shadow-[0_0_10px_#af52de]"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
          )}

          {/* Action Trigger buttons */}
          <div className="flex space-x-3 pt-1">
            <button
              disabled={isProcessing}
              onClick={() => dispatch({ type: "SET_STEM_SEPARATOR_CLIP", payload: null })}
              className="flex-1 py-2.5 rounded-xl text-xs font-semibold border border-white/10 text-white hover:bg-white/5 hover:border-white/20 transition-all cursor-pointer"
            >
              Cancel
            </button>
            <button
              disabled={isProcessing || selectedStems.length === 0}
              onClick={handleProcessSeparation}
              className="flex-1.5 py-2.5 bg-gradient-to-r from-primary to-accent text-white rounded-xl text-xs font-bold shadow-lg hover:shadow-[0_0_20px_rgba(175,82,222,0.4)] disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 active:brightness-95 transition-all flex items-center justify-center space-x-2 cursor-pointer"
            >
              {isProcessing ? (
                <>
                  <Loader2 size={14} className="animate-spin" />
                  <span>Isolating...</span>
                </>
              ) : (
                <>
                  <Play size={12} fill="white" />
                  <span>Isolate & Extract Stems</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Security badge footer */}
        <div className="px-4 py-2.5 bg-zinc-950 flex items-center justify-center space-x-1.5 text-[10px] text-zinc-500 font-semibold">
          <ShieldCheck size={12} className="text-[#00E871]" />
          <span>OFFLINE LOCAL DSP ENVELOPE ISOLATION MODE ACTIVE</span>
        </div>
      </motion.div>
    </div>
  );
};
