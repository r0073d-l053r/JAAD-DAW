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
import {
  checkStemServer,
  separateViaServer,
  getStemServerUrl,
  setStemServerUrl,
  DEMUCS_STEM_MAP,
} from "../lib/stemServer";
import {
  detectBrowserStemsSupport,
  isBrowserModelCached,
  downloadBrowserModel,
  separateInBrowser,
  BROWSER_STEM_MAP,
  BROWSER_MODEL_SIZE_MB,
} from "../lib/browserStems";

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

  // Self-hosted Demucs server (AI mode). null = probing, false = filter fallback.
  const [serverAvailable, setServerAvailable] = useState<boolean | null>(null);
  const [serverUrl, setServerUrlState] = useState<string>(getStemServerUrl());

  // On-device tier (WebGPU / threaded-WASM Demucs) — used when no server.
  const browserSupport = detectBrowserStemsSupport();
  const [modelCached, setModelCached] = useState<boolean | null>(null);
  const [modelDownloadPct, setModelDownloadPct] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    setServerAvailable(null);
    checkStemServer().then((ok) => {
      if (!cancelled) setServerAvailable(ok);
    });
    isBrowserModelCached().then((ok) => {
      if (!cancelled) setModelCached(ok);
    });
    return () => {
      cancelled = true;
    };
    // Re-probe when the panel opens or the server URL changes.
  }, [clipId, serverUrl]);

  const handleDownloadModel = async () => {
    setModelDownloadPct(0);
    try {
      await downloadBrowserModel((pct) => setModelDownloadPct(pct));
      setModelCached(true);
    } catch (err) {
      console.error("On-device model download failed:", err);
      setCurrentStep(err instanceof Error ? `Error: ${err.message}` : "Model download failed.");
    } finally {
      setModelDownloadPct(null);
    }
  };

  // Which tier will actually run for AI-capable stems?
  const useServer = serverAvailable === true;
  const useBrowser = !useServer && browserSupport.supported && modelCached === true;
  const browserReady = !useServer && browserSupport.supported;

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

  /** Register a finished stem (buffer + file) as a new colored track. */
  const placeStemOnTrack = async (
    stem: string,
    separatedBuffer: AudioBuffer,
    wavBlob: Blob,
    aiGenerated: boolean,
  ) => {
    const slug = stem.toLowerCase().replace(/\s+/g, "_");
    const newClipId = `clip_${Date.now()}_stem_${slug}_${Math.random().toString(36).substring(2, 6)}`;
    const suffix = aiGenerated ? "AI_STEM" : "STEM";
    const stemFileName = `${targetClip.audioData?.replace(/\.[^/.]+$/, "") || "Audio"}_[${suffix}_${stem.toUpperCase().replace(/\s+/g, "_")}].wav`;
    const stemFile = new File([wavBlob], stemFileName, { type: "audio/wav" });

    audioEngine.buffers.set(newClipId, separatedBuffer);
    await saveAsset(newClipId, stemFile);
    uploadAssetCloud(newClipId, stemFile).catch((err) =>
      console.error(`Failed to push stem ${stem} to cloud:`, err)
    );

    const matchConfig = STEM_INSTRUMENTS.find((x) => x.name === stem);
    dispatch({
      type: "ADD_TRACK",
      payload: {
        id: `track_${Date.now()}_stem_${slug}`,
        name: aiGenerated ? stem : `${stem} (approx)`,
        volume: 0.8,
        pan: 0,
        muted: false,
        solo: false,
        color: matchConfig?.color || "#FFFFFF",
        clips: [
          {
            id: newClipId,
            start: targetClip.start,
            duration: Math.min(targetClip.duration, separatedBuffer.duration),
            audioData: stemFileName,
          },
        ],
      },
    });
    dispatch({ type: "INCREMENT_BUFFERS_VERSION" });
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

    // Tier split (ADR-0010): server Demucs first; else on-device WebGPU/WASM
    // Demucs; everything else falls to the local filter approximation.
    const aiStems = useServer
      ? selectedStems.filter((s) => DEMUCS_STEM_MAP[s])
      : useBrowser
        ? selectedStems.filter((s) => BROWSER_STEM_MAP[s])
        : [];
    const filterStems = selectedStems.filter((s) => !aiStems.includes(s));
    const aiShare = aiStems.length > 0 ? (filterStems.length > 0 ? 80 : 100) : 0;

    try {
      // --- Tier 1: self-hosted Demucs server --------------------------------
      if (useServer && aiStems.length > 0) {
        setCurrentStep("Encoding source audio...");
        const sourceWav = audioBufferToWav(originalBuffer);

        const remoteStems = await separateViaServer(sourceWav, aiStems, (pct, step) => {
          setCurrentStep(step);
          setProgress(Math.round((pct / 100) * aiShare));
        });

        const decodeCtx = new OfflineAudioContext(2, 1, originalBuffer.sampleRate);
        for (const { instrument, blob } of remoteStems) {
          setCurrentStep(`Placing ${instrument} on the timeline...`);
          const decoded = await decodeCtx.decodeAudioData(await blob.arrayBuffer());
          await placeStemOnTrack(instrument, decoded, blob, true);
        }
      }

      // --- Tier 2: on-device Demucs (WebGPU / threaded WASM) -----------------
      if (useBrowser && aiStems.length > 0) {
        const deviceStems = await separateInBrowser(originalBuffer, aiStems, (pct, step) => {
          setCurrentStep(step);
          setProgress(Math.round((pct / 100) * aiShare));
        });
        for (const { instrument, buffer } of deviceStems) {
          setCurrentStep(`Placing ${instrument} on the timeline...`);
          const wavBlob = audioBufferToWav(buffer);
          await placeStemOnTrack(instrument, buffer, wavBlob, true);
        }
      }

      // --- Filter path: local approximation for non-Demucs selections -------
      for (let i = 0; i < filterStems.length; i++) {
        const stem = filterStems[i];
        setCurrentStep(
          aiStems.length > 0 ? `Isolating ${stem} (filter approximation)...` : `Isolating ${stem}...`
        );
        // Let the event loop refresh the browser UI before the next heavy DSP pass
        await new Promise((res) => setTimeout(res, 50));

        const separatedBuffer = await separateAudioStem(originalBuffer, stem, { lowCut, highCut });
        const wavBlob = audioBufferToWav(separatedBuffer);
        await placeStemOnTrack(stem, separatedBuffer, wavBlob, false);

        setProgress(aiShare + Math.round(((i + 1) / filterStems.length) * (100 - aiShare)));
      }

      setProgress(100);
      setCurrentStep("Complete!");
      await new Promise((res) => setTimeout(res, 400));
      dispatch({ type: "SET_STEM_SEPARATOR_CLIP", payload: null });
    } catch (err) {
      console.error("Stem separation failed:", err);
      setCurrentStep(
        err instanceof Error ? `Error: ${err.message}` : "Error isolating audio clips."
      );
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

          {/* Self-hosted Demucs server (AI mode) */}
          <div className="bg-white/5 rounded-xl border border-white/5 p-3 flex flex-col space-y-2">
            <span className="text-[10px] text-zinc-400 font-semibold uppercase tracking-wider">
              Stem Server (self-hosted Demucs)
            </span>
            <div className="flex items-center space-x-2">
              <div
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  serverAvailable === null
                    ? "bg-yellow-400 animate-pulse"
                    : serverAvailable
                      ? "bg-[#00E871] shadow-[0_0_6px_#00E871]"
                      : "bg-zinc-600"
                }`}
              />
              <input
                type="text"
                value={serverUrl}
                disabled={isProcessing}
                onChange={(e) => setServerUrlState(e.target.value)}
                onBlur={() => setStemServerUrl(serverUrl.trim().replace(/\/+$/, ""))}
                placeholder="http://localhost:8000"
                className="flex-1 bg-zinc-900/80 border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] text-zinc-200 font-mono focus:outline-none focus:border-primary/50"
              />
              <span className={`text-[9px] font-bold uppercase ${serverAvailable ? "text-[#00E871]" : "text-zinc-500"}`}>
                {serverAvailable === null ? "Probing" : serverAvailable ? "AI Ready" : "Offline"}
              </span>
            </div>
            {/* On-device tier (WebGPU / threaded-WASM Demucs) when no server */}
            {browserReady && (
              <div className="flex items-center space-x-2 pt-1 border-t border-white/5">
                <div
                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                    modelDownloadPct !== null
                      ? "bg-yellow-400 animate-pulse"
                      : useBrowser
                        ? "bg-[#00C2FF] shadow-[0_0_6px_#00C2FF]"
                        : "bg-zinc-600"
                  }`}
                />
                <span className="flex-1 text-[10px] text-zinc-400">
                  {modelDownloadPct !== null
                    ? `Downloading on-device AI model... ${modelDownloadPct}%`
                    : useBrowser
                      ? `On-device AI ready (${browserSupport.webgpu ? "WebGPU" : "WASM threads"}) — Vocals/Drums/Bass run on this machine`
                      : `This device can run Demucs locally via ${browserSupport.webgpu ? "WebGPU" : "WASM threads"}`}
                </span>
                {!useBrowser && modelDownloadPct === null && modelCached !== null && (
                  <button
                    disabled={isProcessing}
                    onClick={handleDownloadModel}
                    className="text-[9px] font-bold uppercase px-2 py-1 rounded-md bg-[#00C2FF]/10 border border-[#00C2FF]/30 text-[#00C2FF] hover:bg-[#00C2FF]/20 transition-colors"
                  >
                    Get model ({BROWSER_MODEL_SIZE_MB}MB, one-time)
                  </button>
                )}
              </div>
            )}
            {serverAvailable === false && !browserReady && (
              <p className="text-[9px] text-zinc-500 leading-relaxed">
                No Demucs server found and this browser lacks WebGPU/threads — AI-capable stems
                will use the local filter approximation. Start a server with{" "}
                <code className="text-zinc-400">docker compose -f docker-compose.stems.yml up -d</code>
              </p>
            )}
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
                    <div className="flex-1 min-w-0 flex items-center gap-1.5">
                      <p className="text-xs font-medium truncate">{inst.name}</p>
                      {useServer && DEMUCS_STEM_MAP[inst.name] && (
                        <span className="text-[8px] font-black text-[#00E871] bg-[#00E871]/10 border border-[#00E871]/30 rounded px-1 py-px flex-shrink-0" title="Separated by the self-hosted Demucs server">
                          AI
                        </span>
                      )}
                      {useBrowser && BROWSER_STEM_MAP[inst.name] && (
                        <span className="text-[8px] font-black text-[#00C2FF] bg-[#00C2FF]/10 border border-[#00C2FF]/30 rounded px-1 py-px flex-shrink-0" title={`Separated on this device via ${browserSupport.webgpu ? "WebGPU" : "WASM threads"}`}>
                          AI·GPU
                        </span>
                      )}
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

        {/* Mode badge footer — honest about which tier is active */}
        <div className="px-4 py-2.5 bg-zinc-950 flex items-center justify-center space-x-1.5 text-[10px] text-zinc-500 font-semibold">
          <ShieldCheck
            size={12}
            className={useServer ? "text-[#00E871]" : useBrowser ? "text-[#00C2FF]" : "text-zinc-500"}
          />
          <span>
            {useServer
              ? "DEMUCS AI SOURCE SEPARATION · SELF-HOSTED SERVER"
              : useBrowser
                ? `DEMUCS AI ON THIS DEVICE · ${browserSupport.webgpu ? "WEBGPU" : "WASM THREADS"}`
                : "LOCAL FILTER APPROXIMATION MODE (no AI tier available)"}
          </span>
        </div>
      </motion.div>
    </div>
  );
};
