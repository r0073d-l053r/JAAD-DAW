
self.onmessage = async (e) => {
  const { track, clipBuffers, sampleRate, totalDuration } = e.data;
  
  // OfflineAudioContext can be used in workers in modern browsers
  // but if not, we would need to manually mix the buffers.
  // For a "Microservice" approach, we'll implement a manual mixer here
  // to ensure it works in any worker environment.
  
  const numChannels = 2;
  const length = Math.ceil(totalDuration * sampleRate);
  const output = [new Float32Array(length), new Float32Array(length)];
  
  for (const clip of track.clips) {
    const bufferData = clipBuffers[clip.bufferId || clip.id];
    if (!bufferData) continue;
    
    const startSample = Math.floor(clip.start * sampleRate);
    const clipOffset = Math.floor((clip.audioOffset || 0) * sampleRate);
    const clipLength = Math.floor(clip.duration * sampleRate);

    // Linear fade-in/fade-out gains, clamped so the fades never overlap when
    // the clip is shorter than their combined length (matches playback).
    let fadeInSec = Math.max(0, Math.min(clip.fadeIn || 0, clip.duration));
    let fadeOutSec = Math.max(0, Math.min(clip.fadeOut || 0, clip.duration));
    if (fadeInSec + fadeOutSec > clip.duration && fadeInSec + fadeOutSec > 0) {
      const scale = clip.duration / (fadeInSec + fadeOutSec);
      fadeInSec *= scale;
      fadeOutSec *= scale;
    }
    const fadeInSamples = Math.floor(fadeInSec * sampleRate);
    const fadeOutSamples = Math.floor(fadeOutSec * sampleRate);
    const hasFades = fadeInSamples > 0 || fadeOutSamples > 0;
    const fadeGainAt = (i: number) => {
      let g = 1;
      if (fadeInSamples > 0 && i < fadeInSamples) g *= i / fadeInSamples;
      if (fadeOutSamples > 0 && i >= clipLength - fadeOutSamples) {
        g *= Math.max(0, clipLength - i) / fadeOutSamples;
      }
      return g;
    };

    if (bufferData.length === 1) {
      const channelData = bufferData[0];
      for (let i = 0; i < clipLength; i++) {
        const outIdx = startSample + i;
        const inIdx = clipOffset + i;
        if (outIdx < length && inIdx < channelData.length) {
          const val = hasFades ? channelData[inIdx] * fadeGainAt(i) : channelData[inIdx];
          output[0][outIdx] += val;
          output[1][outIdx] += val;
        }
      }
    } else {
      for (let c = 0; c < Math.min(numChannels, bufferData.length); c++) {
        const channelData = bufferData[c];
        for (let i = 0; i < clipLength; i++) {
          const outIdx = startSample + i;
          const inIdx = clipOffset + i;
          if (outIdx < length && inIdx < channelData.length) {
            output[c][outIdx] += hasFades ? channelData[inIdx] * fadeGainAt(i) : channelData[inIdx];
          }
        }
      }
    }
  }
  
  // Deliberately NOT applying track.volume/track.pan here: frozen buffers
  // play back through the track's live gain/panner nodes (playClip →
  // updateTrackSettings), which already apply fader, pan, mute/solo and
  // automation. Baking them in too would apply them twice.

  // Transfer the buffers back
  self.postMessage({ 
    trackId: track.id, 
    channels: output.map(a => a.buffer) 
  }, output.map(a => a.buffer) as any);
};
