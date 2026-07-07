import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useGemini } from './useGemini';

// Correctly declare spyers and classes inside Vitest's hoisted block to prevent initialization errors
const hoistedMocks = vi.hoisted(() => {
  const mockGenerateContent = vi.fn();
  const mockGenerateContentStream = vi.fn();
  class MockGoogleGenAI {
    models = {
      generateContent: mockGenerateContent,
      generateContentStream: mockGenerateContentStream,
    };
    config: { apiKey: string };
    constructor(config: { apiKey: string }) {
      this.config = config;
    }
    get apiKey() {
      return this.config.apiKey;
    }
  }
  return { MockGoogleGenAI, mockGenerateContent, mockGenerateContentStream };
});

vi.mock('@google/genai', () => ({
  GoogleGenAI: hoistedMocks.MockGoogleGenAI,
}));

// generateMusicClip calls audioEngine.loadAudio (which touches AudioContext);
// stub it so the hook test stays headless.
vi.mock('./audioEngine', () => ({
  audioEngine: { loadAudio: vi.fn().mockResolvedValue(8) },
}));

describe('useGemini', () => {
  let mockAudioBuffer: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Set environment variable
    import.meta.env.VITE_GEMINI_API_KEY = 'mocked_gemini_api_key_valid_long';

    // Mock AudioBuffer
    mockAudioBuffer = {
      numberOfChannels: 1,
      sampleRate: 44100,
      length: 44100,
      duration: 1,
      getChannelData: vi.fn().mockReturnValue(new Float32Array(44100)),
    };

    hoistedMocks.mockGenerateContent.mockResolvedValue({
      text: 'Response from model',
    });
  });

  it('initializes the hook with standard default states', () => {
    const { result } = renderHook(() => useGemini());

    expect(result.current.isGenerating).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('fails BPM detection if the Gemini API key is missing or invalid', async () => {
    import.meta.env.VITE_GEMINI_API_KEY = 'your_gemini_api_key'; // invalid placeholder

    const { result } = renderHook(() => useGemini());

    let bpm: number | null = null;
    await act(async () => {
      bpm = await result.current.detectBPM(mockAudioBuffer);
    });

    expect(bpm).toBeNull();
    expect(result.current.error).toContain('API key is not configured');
  });

  it('fails safely if API key is completely missing', async () => {
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = vi.fn().mockReturnValue(null);
    import.meta.env.VITE_GEMINI_API_KEY = '';

    const { result } = renderHook(() => useGemini());

    let bpm: number | null = null;
    await act(async () => {
      bpm = await result.current.detectBPM(mockAudioBuffer);
    });

    expect(bpm).toBeNull();
    expect(result.current.error).toContain('API key is not configured');

    Storage.prototype.getItem = originalGetItem;
  });

  it('handles exceptions during API key retrieval', async () => {
    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = vi.fn().mockImplementation(() => {
      throw new Error('localStorage error');
    });

    const { result } = renderHook(() => useGemini());

    let bpm: number | null = null;
    await act(async () => {
      bpm = await result.current.detectBPM(mockAudioBuffer);
    });

    expect(bpm).toBeNull();
    expect(result.current.error).toContain('API key is not configured');

    Storage.prototype.getItem = originalGetItem;
  });

  it('detects BPM by encoding audio buffers and calling models.generateContent', async () => {
    hoistedMocks.mockGenerateContent.mockResolvedValue({
      text: '135',
    });

    const { result } = renderHook(() => useGemini());

    let bpm: number | null = null;
    await act(async () => {
      bpm = await result.current.detectBPM(mockAudioBuffer);
    });

    expect(bpm).toBe(135);
    expect(hoistedMocks.mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.1-pro-preview',
        contents: expect.arrayContaining([
          expect.stringContaining('tempo in BPM'),
          expect.objectContaining({
            inlineData: expect.objectContaining({
              mimeType: 'audio/wav',
            }),
          }),
        ]),
      })
    );
  });

  it('generates mastering settings and mixing advice', async () => {
    hoistedMocks.mockGenerateContent.mockResolvedValue({
      text: 'Apply a 3dB boost at 60Hz and 1.5 ratio compression.',
    });

    const { result } = renderHook(() => useGemini());

    let advice: string | null = null;
    await act(async () => {
      advice = await result.current.requestMixingAdvice({ name: 'Kick' }, 'How to clean?');
    });

    expect(advice).toBe('Apply a 3dB boost at 60Hz and 1.5 ratio compression.');
    expect(hoistedMocks.mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.1-pro-preview',
        contents: expect.stringContaining('clean?'),
      })
    );
  });

  it('gets FixMyMix suggestions parsing JSON structures', async () => {
    hoistedMocks.mockGenerateContent.mockResolvedValue({
      text: '```json {"track_1": {"volume": 0.7, "pan": -0.1}, "masterVolume": 0.8} ```',
    });

    const { result } = renderHook(() => useGemini());

    let mix: any = null;
    await act(async () => {
      mix = await result.current.getFixMyMixSuggestions([{ id: 'track_1', name: 'Bass', volume: 0.5, pan: 0 }]);
    });

    expect(mix).toEqual({
      track_1: { volume: 0.7, pan: -0.1 },
      masterVolume: 0.8,
    });
  });

  it('tags audio clips returning category labels', async () => {
    hoistedMocks.mockGenerateContent.mockResolvedValue({
      text: '"Crispy Fuzz Guitar"',
    });

    const { result } = renderHook(() => useGemini());

    let tag: string | null = null;
    await act(async () => {
      tag = await result.current.tagClip(mockAudioBuffer);
    });

    expect(tag).toBe('Crispy Fuzz Guitar');
  });

  it('generates MIDI tracks parsing note coordinates', async () => {
    hoistedMocks.mockGenerateContent.mockResolvedValue({
      text: '[{"note": 60, "start": 0, "duration": 1}]',
    });

    const { result } = renderHook(() => useGemini());

    let midi: any[] = [];
    await act(async () => {
      midi = await result.current.generateMIDI('A major scale');
    });

    expect(midi).toEqual([{ note: 60, start: 0, duration: 1 }]);
  });

  it('generates a style sheet from a description using the flash model', async () => {
    hoistedMocks.mockGenerateContent.mockResolvedValue({
      text: 'synthwave, retro, 80s, analog pads, 100 bpm\nWarm sub-bass, wide plate reverb.',
    });

    const { result } = renderHook(() => useGemini());

    let sheet: string | null = null;
    await act(async () => {
      sheet = await result.current.generateStyleSheet('80s synthwave, driving');
    });

    expect(sheet).toContain('synthwave');
    expect(hoistedMocks.mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3-flash-preview',
        contents: expect.stringContaining('80s synthwave'),
      })
    );
  });

  it('generates structured lyrics containing section tags', async () => {
    hoistedMocks.mockGenerateContent.mockResolvedValue({
      text: '[Verse 1]\nPacking up the car at dawn\n[Chorus]\nI am gone, I am gone',
    });

    const { result } = renderHook(() => useGemini());

    let lyrics: string | null = null;
    await act(async () => {
      lyrics = await result.current.generateLyrics('leaving home at eighteen');
    });

    expect(lyrics).toContain('[Chorus]');
    expect(hoistedMocks.mockGenerateContent).toHaveBeenCalledWith(
      expect.objectContaining({ contents: expect.stringContaining('leaving home') })
    );
  });

  it('generates a real music clip from the Lyria stream into a WAV File', async () => {
    async function* fakeStream() {
      yield {
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: btoa('AUDIODATA') } }] } }],
      };
    }
    hoistedMocks.mockGenerateContentStream.mockReturnValue(fakeStream());

    const { result } = renderHook(() => useGemini());

    let out: any = null;
    await act(async () => {
      out = await result.current.generateMusicClip('lofi piano loop 90 bpm', 'test');
    });

    expect(out).not.toBeNull();
    expect(out.file).toBeInstanceOf(File);
    expect(out.duration).toBe(8);
    expect(hoistedMocks.mockGenerateContentStream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'lyria-3-clip-preview',
        contents: expect.stringContaining('lofi piano loop'),
      })
    );
  });

  it('returns null from generateMusicClip when the stream yields no audio', async () => {
    async function* emptyStream() {
      yield { candidates: [{ content: { parts: [{ text: 'no audio here' }] } }] };
    }
    hoistedMocks.mockGenerateContentStream.mockReturnValue(emptyStream());

    const { result } = renderHook(() => useGemini());

    let out: any = 'unset';
    await act(async () => {
      out = await result.current.generateMusicClip('a prompt that produces no audio');
    });

    expect(out).toBeNull();
    expect(result.current.error).toContain('No audio');
  });
});
