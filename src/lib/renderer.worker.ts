
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
    
    if (bufferData.length === 1) {
      const channelData = bufferData[0];
      for (let i = 0; i < clipLength; i++) {
        const outIdx = startSample + i;
        const inIdx = clipOffset + i;
        if (outIdx < length && inIdx < channelData.length) {
          const val = channelData[inIdx];
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
            output[c][outIdx] += channelData[inIdx];
          }
        }
      }
    }
  }
  
  // Apply track volume and pan
  const vol = track.volume ?? 1;
  const pan = track.pan ?? 0;
  const leftGain = vol * (1 - Math.max(0, pan));
  const rightGain = vol * (1 - Math.max(0, -pan));
  
  for (let i = 0; i < length; i++) {
    output[0][i] *= leftGain;
    output[1][i] *= rightGain;
  }
  
  // Transfer the buffers back
  self.postMessage({ 
    trackId: track.id, 
    channels: output.map(a => a.buffer) 
  }, output.map(a => a.buffer) as any);
};
