// Web Worker for offline AI Authenticity Processing
import { processAudio, AuthenticitySettings } from '../lib/aiAuthenticityProcessor';

self.onmessage = (e: MessageEvent) => {
  const { channels, sampleRate, settings } = e.data as {
    channels: Float32Array[];
    sampleRate: number;
    settings: AuthenticitySettings;
  };

  if (!channels || channels.length === 0) {
    self.postMessage({ error: 'No channel data provided' });
    return;
  }

  try {
    const result = processAudio(channels, sampleRate, settings);

    // Transfer buffers for zero-copy performance
    const transferable = result.channels.map(ch => ch.buffer);
    self.postMessage({
      channels: result.channels,
      detectedCutoff: result.detectedCutoff,
      aiScore: result.aiScore,
    }, transferable as any);
  } catch (err: any) {
    self.postMessage({ error: err.message || 'Processing failed' });
  }
};
