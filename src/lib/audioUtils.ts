import { Track, Clip } from './store';
import { audioEngine } from './audioEngine';

export async function cleanUpStemsAsync(state: any, dispatch: any) {
  dispatch({ type: "SET_IS_PROCESSING", payload: true });
  
  // Refined thresholds for "musical" cleanup rather than clinical silence removal
  const threshold = 0.008; // Slightly higher threshold to ignore noise floor (~ -42dB)
  const blockSizeSeconds = 0.1; // Larger blocks (100ms) to ignore micro-transients
  const minSilenceDuration = 0.3; // Minimum 300ms of silence required to trigger a split
  const paddingSeconds = 0.05; // 50ms padding at start/end of clips for natural fades
  
  // Give UI a chance to show loading state
  await new Promise(r => setTimeout(r, 50));

  const newTracks = await Promise.all(state.tracks.map(async (track: Track) => {
    // Clean up main track clips
    const newClips = [];
    for (const clip of track.clips) {
      const chunks = await processClipAsync(clip, threshold, blockSizeSeconds, minSilenceDuration, paddingSeconds);
      newClips.push(...chunks);
      await new Promise(r => setTimeout(r, 0));
    }
    
    // Clean up lane clips
    const newLanes = [];
    if (track.lanes) {
      for (const lane of track.lanes) {
        const laneClips = [];
        for (const clip of lane.clips) {
          const chunks = await processClipAsync(clip, threshold, blockSizeSeconds, minSilenceDuration, paddingSeconds);
          laneClips.push(...chunks);
          await new Promise(r => setTimeout(r, 0));
        }
        newLanes.push({ ...lane, clips: laneClips });
      }
    }
    
    return { ...track, clips: newClips, lanes: newLanes };
  }));

  dispatch({ type: "REPLACE_TRACKS", payload: newTracks });
  dispatch({ type: "SET_IS_PROCESSING", payload: false });
}

async function processClipAsync(
  clip: Clip, 
  threshold: number, 
  blockSizeSeconds: number,
  minSilenceDuration: number,
  paddingSeconds: number
): Promise<Clip[]> {
  const buffer = audioEngine.buffers.get(clip.bufferId || clip.id);
  if (!buffer) return [clip];
  
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const blockSize = Math.floor(sampleRate * blockSizeSeconds);
  const minSilenceBlocks = Math.ceil(minSilenceDuration / blockSizeSeconds);
  const len = channelData.length;
  
  const startSample = Math.floor((clip.audioOffset || 0) * sampleRate);
  const endSample = Math.min(len, Math.ceil(((clip.audioOffset || 0) + clip.duration) * sampleRate));
  
  let isSound = false;
  let soundStart = startSample;
  let silenceBlockCount = 0;
  const chunks: {start: number, end: number}[] = [];
  
  for (let i = startSample; i < endSample; i += blockSize) {
    let maxVal = 0;
    const end = Math.min(i + blockSize, endSample);
    
    for (let j = i; j < end; j++) {
      const val = Math.abs(channelData[j]);
      if (val > maxVal) maxVal = val;
    }
    
    if (maxVal > threshold) {
      if (!isSound) {
        isSound = true;
        soundStart = i;
      }
      silenceBlockCount = 0;
    } else {
      if (isSound) {
        silenceBlockCount++;
        if (silenceBlockCount >= minSilenceBlocks) {
          isSound = false;
          // Substract the silence we just counted from the end of the sound
          const soundEnd = i - (silenceBlockCount - 1) * blockSize;
          chunks.push({ start: soundStart, end: soundEnd });
        }
      }
    }
    
    if (i % (sampleRate * 5) < blockSize) {
        await new Promise(r => setTimeout(r, 0));
    }
  }
  
  if (isSound) {
    chunks.push({ start: soundStart, end: endSample });
  }

  // Convert chunks to Clips with padding
  const result: Clip[] = [];
  const paddingSamples = Math.floor(paddingSeconds * sampleRate);

  if (chunks.length === 0) return [clip];

  chunks.forEach((c, idx) => {
    // Apply padding but constrain to original clip boundaries
    const paddedStart = Math.max(startSample, c.start - paddingSamples);
    const paddedEnd = Math.min(endSample, c.end + paddingSamples);
    
    const chunkStartSec = paddedStart / sampleRate;
    const chunkEndSec = paddedEnd / sampleRate;
    const visibleAudioStart = clip.audioOffset || 0;
    
    result.push({
      ...clip,
      id: clip.id + "_cleanup_" + idx + "_" + Math.random().toString(36).substr(2, 5),
      bufferId: clip.id, // Keep original buffer
      start: clip.start + (chunkStartSec - visibleAudioStart),
      duration: chunkEndSec - chunkStartSec,
      audioOffset: chunkStartSec
    });
  });
  
  return result;
}
