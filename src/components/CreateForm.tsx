import React, { useState } from "react";
import { Expand, ChevronDown, Wand2, Loader2 } from "lucide-react";
import { useApp } from "../lib/store";
import { GoogleGenAI } from "@google/genai";
import { audioEngine } from "../lib/audioEngine";

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

export function CreateForm() {
  const [instrument, setInstrument] = useState("Song");
  const [styles, setStyles] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const { state, dispatch } = useApp();

  const [isDragOver, setIsDragOver] = useState(false);

  const handleGenerate = async () => {
    try {
      if (window.aistudio) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey) {
          await window.aistudio.openSelectKey();
        }
      }

      setIsGenerating(true);

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `Generate a 30-second ${instrument} track. Style: ${styles || "any"}. Lyrics: ${lyrics || "none"}`;

      const response = await ai.models.generateContentStream({
        model: "lyria-3-clip-preview",
        contents: prompt,
      });

      let audioBase64 = "";
      let generatedLyrics = "";
      let mimeType = "audio/wav";

      for await (const chunk of response) {
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (!parts) continue;
        for (const part of parts) {
          if (part.inlineData?.data) {
            if (!audioBase64 && part.inlineData.mimeType) {
              mimeType = part.inlineData.mimeType;
            }
            audioBase64 += part.inlineData.data;
          }
          if (part.text && !generatedLyrics) {
            generatedLyrics = part.text;
          }
        }
      }

      if (!audioBase64) {
        throw new Error("No audio generated.");
      }

      const binary = atob(audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([bytes], { type: mimeType });
      const file = new File([blob], `Generated ${instrument}.wav`, {
        type: mimeType,
      });

      const clipId = "clip_" + Date.now();
      const duration = await audioEngine.loadAudio(clipId, file);

      if (state.timeSelection) {
        // Place it on the selected track at the selection start
        const trackId = state.timeSelection.trackId;
        const start = state.timeSelection.startOffset;

        // Rather than replacing, we'll just add it into the track there, or create a new track
        // to not destroy user data right now, let's just make a new track
        const trackName = `Generated ${instrument}`;
        const colors = [
          "#FF2A5F",
          "#00E871",
          "#6B44FF",
          "#FFBB00",
          "#00E5FF",
          "#FF00EA",
        ];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        dispatch({
          type: "ADD_TRACK",
          payload: {
            id: "track_" + Date.now(),
            name: trackName,
            volume: 0.8,
            pan: 0,
            muted: false,
            solo: false,
            color: randomColor,
            clips: [
              {
                id: clipId,
                start: start,
                duration,
                audioData: generatedLyrics || file.name,
              },
            ],
          },
        });
      } else {
        const trackName = `Generated ${instrument}`;
        const colors = [
          "#FF2A5F",
          "#00E871",
          "#6B44FF",
          "#FFBB00",
          "#00E5FF",
          "#FF00EA",
        ];
        const randomColor = colors[Math.floor(Math.random() * colors.length)];

        dispatch({
          type: "ADD_TRACK",
          payload: {
            id: "track_" + Date.now(),
            name: trackName,
            volume: 0.8,
            pan: 0,
            muted: false,
            solo: false,
            color: randomColor,
            clips: [
              {
                id: clipId,
                start: state.currentTime,
                duration,
                audioData: generatedLyrics || file.name,
              },
            ],
          },
        });
      }
    } catch (err) {
      console.error(err);
      alert("Error generating audio: " + (err as Error).message);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div
      className={`fixed bottom-24 left-[calc(50%+128px)] -translate-x-1/2 z-[100] flex items-center bg-[#1c1c1e]/90 backdrop-blur-xl border ${isDragOver ? "border-orange-500 shadow-[0_0_20px_#f9731680]" : "border-white/10"} rounded-full shadow-2xl p-1.5 space-x-2 transition-all`}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragOver(false);
        // Handle dropping logic if necessary
      }}
    >
      <button className="p-2.5 text-zinc-400 hover:text-white hover:bg-white/5 rounded-full transition-colors">
        <Expand size={16} />
      </button>

      <div className="relative group/menu">
        <button
          disabled={isGenerating}
          className="flex items-center space-x-2 bg-white/5 hover:bg-white/10 disabled:opacity-50 text-white px-4 py-2.5 rounded-full transition-colors"
        >
          <Wand2 size={16} />
          <span className="text-sm font-medium">{instrument}</span>
          <ChevronDown size={14} className="text-zinc-400" />
        </button>
        <div className="absolute bottom-full left-0 mb-2 w-48 bg-[#1c1c1e] border border-white/10 rounded-xl shadow-2xl hidden group-hover/menu:block overflow-hidden pointer-events-auto">
          {[
            "Song",
            "Drums",
            "Bass",
            "Guitar",
            "Keyboard",
            "Percussion",
            "Strings",
            "Synth",
            "FX",
            "Vocals",
            "Backing Vocals",
            "Custom",
          ].map((item) => (
            <button
              key={item}
              className="w-full text-left px-4 py-2 text-sm text-zinc-300 hover:text-white hover:bg-white/10 transition-colors"
              onClick={() => setInstrument(item)}
            >
              {item}
            </button>
          ))}
        </div>
      </div>

      <div className="h-6 w-px bg-white/10" />

      <input
        type="text"
        placeholder="Styles"
        value={styles}
        onChange={(e) => setStyles(e.target.value)}
        disabled={isGenerating}
        className="bg-transparent border-none outline-none text-sm text-white placeholder-zinc-500 w-32 px-2 focus:w-48 transition-all disabled:opacity-50"
      />

      <div className="h-6 w-px bg-white/10" />

      <input
        type="text"
        placeholder="Lyrics"
        value={lyrics}
        onChange={(e) => setLyrics(e.target.value)}
        disabled={isGenerating}
        className="bg-transparent border-none outline-none text-sm text-white placeholder-zinc-500 w-32 px-2 focus:w-48 transition-all disabled:opacity-50"
      />

      <div className="flex items-center overflow-hidden rounded-full font-medium bg-gradient-to-r from-pink-500 to-orange-500 text-white">
        <button
          disabled={isGenerating}
          className="hover:bg-black/10 disabled:opacity-80 text-sm px-6 py-2.5 transition-all flex items-center space-x-2"
          onClick={handleGenerate}
        >
          {isGenerating ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Wand2 size={16} />
          )}
          <span>
            {isGenerating
              ? "Generating..."
              : state.timeSelection
                ? "Replace"
                : "Create"}
          </span>
        </button>
        <div className="w-px self-stretch bg-white/20 pointer-events-none" />
        <button
          disabled={isGenerating}
          className="hover:bg-black/10 disabled:opacity-80 px-2 py-2.5 transition-all flex items-center justify-center min-w-[32px]"
        >
          <ChevronDown size={16} />
        </button>
      </div>
    </div>
  );
}
