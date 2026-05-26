import { useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import { audioEngine } from './audioEngine';

let aiInstance: GoogleGenAI | null = null;
let lastUsedKey: string | null = null;

function getAI() {
  try {
    let apiKey = localStorage.getItem("user_gemini_api_key");
    if (!apiKey) {
      apiKey = (import.meta.env.VITE_GEMINI_API_KEY || "").trim();
    }

    const isInvalid = !apiKey || 
                      apiKey.length < 10 || 
                      apiKey === "your_gemini_api_key" || 
                      apiKey === "undefined" || 
                      apiKey === "null";
                       
    if (!isInvalid) {
      if (aiInstance && lastUsedKey === apiKey) {
        return aiInstance;
      }
      console.log(`Gemini AI: Initializing with key (length: ${apiKey.length})`);
      lastUsedKey = apiKey;
      aiInstance = new GoogleGenAI({ apiKey });
      return aiInstance;
    } else {
      console.log("Gemini AI: No valid API key found. AI features disabled.");
    }
  } catch (e) {
    console.error("Gemini AI: Failed to initialize:", e);
  }
  return null;
}

function audioBufferToWavBase64(buffer: AudioBuffer, durationSeconds: number = 10): string {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = Math.min(buffer.length, sampleRate * durationSeconds);
  const wavBuffer = new ArrayBuffer(44 + length * numChannels * 2);
  const view = new DataView(wavBuffer);
  
  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + length * numChannels * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, length * numChannels * 2, true);
  
  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let channel = 0; channel < numChannels; channel++) {
      const sample = buffer.getChannelData(channel)[i];
      let maxStr = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, maxStr < 0 ? maxStr * 0x8000 : maxStr * 0x7FFF, true);
      offset += 2;
    }
  }
  
  let binary = '';
  const bytes = new Uint8Array(wavBuffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i += 1024) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 1024)));
  }
  return btoa(binary);
}

export function useGemini() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detectBPM = async (buffer: AudioBuffer): Promise<number | null> => {
    setIsGenerating(true);
    setError(null);
    try {
      const ai = getAI();
      if (!ai) throw new Error("Gemini API key is not configured in .env file.");
      const base64Audio = audioBufferToWavBase64(buffer, 15); // Up to 15 seconds
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: [
          'Listen to this audio track and automatically detect its tempo in BPM (Beats Per Minute). Respond with JUST the number, e.g. "120". If you cannot tell, respond with "120".',
          {
            inlineData: {
              data: base64Audio,
              mimeType: 'audio/wav'
            }
          }
        ],
      });
      const text = response.text.trim();
      const match = text.match(/(\d+)/);
      if (match) {
        let bpm = parseInt(match[1]);
        if (bpm > 50 && bpm < 250) {
           return bpm;
        }
      }
      return null;
    } catch (err: unknown) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Error detecting BPM');
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  const requestMixingAdvice = async (trackData: any, prompt: string) => {
    setIsGenerating(true);
    setError(null);
    try {
      const ai = getAI();
      if (!ai) throw new Error("Gemini API key is not configured in .env file.");
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: `You are an expert audio engineer and mastering assistant. 
Current Track Data: ${JSON.stringify(trackData, null, 2)}
User Request: ${prompt}
Provide professional actionable mixing or mastering advice. Make your advice technical but accessible. Suggest specific EQ, compression, or panning changes.`,
      });
      return response.text;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error generating advice');
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  const getMasteringSettings = async (genre: string) => {
    setIsGenerating(true);
    try {
      const ai = getAI();
      if (!ai) throw new Error("Gemini API key is not configured in .env file.");
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Provide mastering chain suggestions (EQ, Compression, Limiter thresholds) for a ${genre} track. Format as a short technical list.`,
      });
      return response.text;
    } finally {
      setIsGenerating(false);
    }
  };

  const getFixMyMixSuggestions = async (tracks: any[]): Promise<any> => {
    setIsGenerating(true);
    setError(null);
    try {
      const ai = getAI();
      if (!ai) throw new Error("Gemini API key is not configured.");
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: [
          `You are an expert mixing engineer. I will give you a list of tracks with their current volume and pan settings. 
          Suggest a balanced mix for a professional sound. 
          Return ONLY a JSON object where keys are track IDs and values are objects with "volume" (0 to 1) and "pan" (-1 to 1). 
          Also include a "masterVolume" suggestion (0 to 1).
          Example: {"track_1": {"volume": 0.8, "pan": -0.2}, "masterVolume": 0.9}
          
          Current Tracks: ${JSON.stringify(tracks.map(t => ({ id: t.id, name: t.name, volume: t.volume, pan: t.pan })))}`
        ],
      });
      const text = response.text.trim();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return null;
    } catch (err) {
      console.error(err);
      setError("Failed to get mix suggestions");
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  const tagClip = async (buffer: AudioBuffer): Promise<string | null> => {
    setIsGenerating(true);
    setError(null);
    try {
      const ai = getAI();
      if (!ai) throw new Error("Gemini API key is not configured.");
      const base64Audio = audioBufferToWavBase64(buffer, 10);
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: [
          'Listen to this audio clip and provide a short, 2-3 word descriptive title/tag for it (e.g. "Fat Synth Bass", "Crispy Hi-Hat"). Respond with JUST the title.',
          {
            inlineData: {
              data: base64Audio,
              mimeType: 'audio/wav'
            }
          }
        ],
      });
      return response.text.trim().replace(/"/g, '');
    } catch (err) {
      console.error(err);
      setError("Failed to tag clip");
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  const generateMIDI = async (prompt: string): Promise<any[]> => {
    setIsGenerating(true);
    setError(null);
    try {
      const ai = getAI();
      if (!ai) throw new Error("Gemini API key is not configured.");
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: [
          `Generate a MIDI sequence based on this prompt: "${prompt}". 
          Return ONLY a JSON array of note objects with "note" (MIDI number 0-127), "start" (beats), and "duration" (beats).
          Example: [{"note": 60, "start": 0, "duration": 0.5}, {"note": 62, "start": 0.5, "duration": 0.5}]`
        ],
      });
      const text = response.text.trim();
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return [];
    } catch (err) {
      console.error(err);
      setError("Failed to generate MIDI");
      return [];
    } finally {
      setIsGenerating(false);
    }
  };

  return { requestMixingAdvice, getMasteringSettings, detectBPM, getFixMyMixSuggestions, tagClip, generateMIDI, isGenerating, error };
}
