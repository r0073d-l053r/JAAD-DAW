import { useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import { audioEngine } from './audioEngine';

let ai: any = null;
try {
  if (process.env.GEMINI_API_KEY) {
    ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
} catch (e) {
  console.warn("Gemini API not initialized:", e);
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
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Error detecting BPM');
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  const requestMixingAdvice = async (trackData: any, prompt: string) => {
    setIsGenerating(true);
    setError(null);
    try {
      if (!ai) throw new Error("Gemini API key is not configured in .env file.");
      const response = await ai.models.generateContent({
        model: 'gemini-3.1-pro-preview',
        contents: `You are an expert audio engineer and mastering assistant. 
Current Track Data: ${JSON.stringify(trackData, null, 2)}
User Request: ${prompt}
Provide professional actionable mixing or mastering advice. Make your advice technical but accessible. Suggest specific EQ, compression, or panning changes.`,
      });
      return response.text;
    } catch (err: any) {
      setError(err.message || 'Error generating advice');
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  const getMasteringSettings = async (genre: string) => {
    setIsGenerating(true);
    try {
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

  return { requestMixingAdvice, getMasteringSettings, detectBPM, isGenerating, error };
}
