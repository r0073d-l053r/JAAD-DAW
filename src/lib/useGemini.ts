import { useState } from 'react';
import { GoogleGenAI } from '@google/genai';
import { audioEngine } from './audioEngine';

// Single source of truth for model IDs. If Google renames or retires a model,
// update it here (or override per-browser via localStorage without a rebuild).
const DEFAULT_PRO_MODEL = 'gemini-3.1-pro-preview';
const DEFAULT_FLASH_MODEL = 'gemini-3-flash-preview';
// Music-generation model (Lyria). Swappable per-browser without a rebuild, and the
// single place to point at a self-hosted endpoint later (ComfyUI/ACE-Step roadmap).
const DEFAULT_MUSIC_MODEL = 'lyria-3-clip-preview';

export const getProModel = () =>
  localStorage.getItem('user_gemini_pro_model') || DEFAULT_PRO_MODEL;
export const getFlashModel = () =>
  localStorage.getItem('user_gemini_flash_model') || DEFAULT_FLASH_MODEL;
export const getMusicModel = () =>
  localStorage.getItem('user_gemini_music_model') || DEFAULT_MUSIC_MODEL;

const MAX_ATTEMPTS = 3;
const isRetryableError = (err: unknown): boolean => {
  const anyErr = err as any;
  const status: number | undefined =
    typeof anyErr?.status === 'number' ? anyErr.status :
    typeof anyErr?.code === 'number' ? anyErr.code : undefined;
  if (status !== undefined) {
    return status === 429 || (status >= 500 && status < 600);
  }
  const message = anyErr?.message ? String(anyErr.message) : '';
  return /\b(429|500|502|503|504)\b/.test(message) || /fetch|network/i.test(message);
};

/**
 * Calls generateContent with exponential backoff on rate limits (429),
 * server errors (5xx), and transient network failures.
 */
/**
 * Safely extract a JSON value from a model response. Tries a direct parse first
 * (works when responseMimeType: 'application/json' is honored), then falls back
 * to extracting the first {...} or [...] block. Returns `fallback` instead of
 * throwing on any malformed/empty output.
 */
function safeJsonFromModel<T>(text: string | undefined, fallback: T): T {
  if (!text) return fallback;
  const trimmed = text.trim();
  const candidates = [trimmed];
  const block = trimmed.match(/\{[\s\S]*\}/) ?? trimmed.match(/\[[\s\S]*\]/);
  if (block) candidates.push(block[0]);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      /* try next candidate */
    }
  }
  console.warn('Gemini AI: could not parse JSON from model response.');
  return fallback;
}

async function generateWithRetry(
  ai: GoogleGenAI,
  params: { model: string; contents: any; config?: any }
) {
  let delay = 1000;
  for (let attempt = 1; ; attempt++) {
    try {
      return await ai.models.generateContent(params);
    } catch (err) {
      if (attempt >= MAX_ATTEMPTS || !isRetryableError(err)) throw err;
      console.warn(`Gemini AI: attempt ${attempt} failed for ${params.model}, retrying in ${delay}ms...`, err);
      await new Promise((resolve) => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
}

const describeError = (err: unknown, fallback: string): string => {
  if (err instanceof Error && err.message) {
    // Surface the real API message (e.g. invalid model, quota exceeded)
    // instead of a generic label so users can act on it.
    return `${fallback}: ${err.message}`;
  }
  return fallback;
};

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
      const maxStr = Math.max(-1, Math.min(1, sample));
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
      const response = await generateWithRetry(ai, {
        model: getProModel(),
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
        const bpm = parseInt(match[1]);
        if (bpm > 50 && bpm < 250) {
           return bpm;
        }
      }
      return null;
    } catch (err: unknown) {
      console.error(err);
      setError(describeError(err, 'Error detecting BPM'));
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
      const response = await generateWithRetry(ai, {
        model: getProModel(),
        contents: `You are an expert audio engineer and mastering assistant.
Current Track Data: ${JSON.stringify(trackData, null, 2)}
User Request: ${prompt}
Provide professional actionable mixing or mastering advice. Make your advice technical but accessible. Suggest specific EQ, compression, or panning changes.`,
      });
      return response.text;
    } catch (err: unknown) {
      setError(describeError(err, 'Error generating advice'));
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
      const response = await generateWithRetry(ai, {
        model: getFlashModel(),
        contents: `Provide mastering chain suggestions (EQ, Compression, Limiter thresholds) for a ${genre} track. Format as a short technical list.`,
      });
      return response.text;
    } catch (err: unknown) {
      setError(describeError(err, 'Error getting mastering settings'));
      throw err;
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
      const response = await generateWithRetry(ai, {
        model: getProModel(),
        contents: [
          `You are an expert mixing engineer. I will give you a list of tracks with their current volume and pan settings.
          Suggest a balanced mix for a professional sound. 
          Return ONLY a JSON object where keys are track IDs and values are objects with "volume" (0 to 1) and "pan" (-1 to 1). 
          Also include a "masterVolume" suggestion (0 to 1).
          Example: {"track_1": {"volume": 0.8, "pan": -0.2}, "masterVolume": 0.9}
          
          Current Tracks: ${JSON.stringify(tracks.map(t => ({ id: t.id, name: t.name, volume: t.volume, pan: t.pan })))}`
        ],
        config: { responseMimeType: 'application/json' },
      });
      return safeJsonFromModel<any>(response.text, null);
    } catch (err) {
      console.error(err);
      setError(describeError(err, 'Failed to get mix suggestions'));
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
      const response = await generateWithRetry(ai, {
        model: getProModel(),
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
      setError(describeError(err, 'Failed to tag clip'));
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
      const response = await generateWithRetry(ai, {
        model: getProModel(),
        contents: [
          `Generate a MIDI sequence based on this prompt: "${prompt}".
          Return ONLY a JSON array of note objects with "note" (MIDI number 0-127), "start" (beats), and "duration" (beats).
          Example: [{"note": 60, "start": 0, "duration": 0.5}, {"note": 62, "start": 0.5, "duration": 0.5}]`
        ],
        config: { responseMimeType: 'application/json' },
      });
      const parsed = safeJsonFromModel<any[]>(response.text, []);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      console.error(err);
      setError(describeError(err, 'Failed to generate MIDI'));
      return [];
    } finally {
      setIsGenerating(false);
    }
  };

  /**
   * Generate a Suno-style "style sheet": one line of comma-separated
   * genre/mood/instrument/tempo tags plus a couple of production notes.
   * Pure text (flash model). Feeds the Create Form's Style field.
   */
  const generateStyleSheet = async (description: string): Promise<string | null> => {
    setIsGenerating(true);
    setError(null);
    try {
      const ai = getAI();
      if (!ai) throw new Error("Gemini API key is not configured.");
      const response = await generateWithRetry(ai, {
        model: getFlashModel(),
        contents: `You are a music-production assistant that writes "style sheets" for an AI
music generator (think Suno). From the idea below, produce:
Line 1: a single line of comma-separated tags — genre, sub-genre, mood, key instruments,
tempo feel, vocal style. No sentences, just tags.
Line 2-3: one or two short production notes (mix, arrangement, references).
Keep it tight and usable as a generation prompt. Idea: "${description}"`,
      });
      return response.text.trim();
    } catch (err) {
      console.error(err);
      setError(describeError(err, 'Failed to generate style sheet'));
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  /**
   * Generate structured, singable song lyrics with section tags
   * ([Verse]/[Chorus]/[Bridge]). Pure text. Feeds the Create Form's Lyrics field.
   */
  const generateLyrics = async (theme: string): Promise<string | null> => {
    setIsGenerating(true);
    setError(null);
    try {
      const ai = getAI();
      if (!ai) throw new Error("Gemini API key is not configured.");
      const response = await generateWithRetry(ai, {
        model: getProModel(),
        contents: `Write original, singable song lyrics based on: "${theme}".
Use clear section tags on their own lines: [Verse 1], [Chorus], [Verse 2], [Bridge], [Outro].
Keep lines rhythmic and not too long. Return ONLY the lyrics — no commentary.`,
      });
      return response.text.trim();
    } catch (err) {
      console.error(err);
      setError(describeError(err, 'Failed to generate lyrics'));
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  /**
   * The real music-generation path (Lyria): streams audio back and returns a
   * playable WAV File. This is what makes the Copilot "Generate Track" real
   * instead of a mock. Returns null (and sets `error`) on failure.
   */
  const generateMusicClip = async (
    prompt: string,
    idHint = 'gen'
  ): Promise<{ file: File; clipId: string; duration: number } | null> => {
    setIsGenerating(true);
    setError(null);
    try {
      const ai = getAI();
      if (!ai) throw new Error("Gemini API key is not configured.");
      const response = await ai.models.generateContentStream({
        model: getMusicModel(),
        contents: prompt,
      });

      let audioBase64 = '';
      let mimeType = 'audio/wav';
      for await (const chunk of response) {
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (!parts) continue;
        for (const part of parts) {
          if (part.inlineData?.data) {
            if (!audioBase64 && part.inlineData.mimeType) mimeType = part.inlineData.mimeType;
            audioBase64 += part.inlineData.data;
          }
        }
      }
      if (!audioBase64) throw new Error("No audio was generated for that prompt.");

      const binary = atob(audioBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([new Blob([bytes], { type: mimeType })], `${idHint}.wav`, { type: mimeType });

      const clipId = `clip_${Date.now()}_${idHint}_${Math.random().toString(36).substring(2, 6)}`;
      const duration = await audioEngine.loadAudio(clipId, file);
      return { file, clipId, duration };
    } catch (err) {
      console.error(err);
      setError(describeError(err, 'Failed to generate audio'));
      return null;
    } finally {
      setIsGenerating(false);
    }
  };

  return { requestMixingAdvice, getMasteringSettings, detectBPM, getFixMyMixSuggestions, tagClip, generateMIDI, generateStyleSheet, generateLyrics, generateMusicClip, isGenerating, error };
}
