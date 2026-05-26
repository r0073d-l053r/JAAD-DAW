import { Track, Clip } from './store';
import { audioEngine } from './audioEngine';

/**
 * Utility to find the nearest zero-crossing index in an AudioBuffer.
 * Zero-crossing reduces audio clicks/pops by ensuring cuts are made where the wave's amplitude is 0.
 * 
 * @param buffer - The AudioBuffer to search inside.
 * @param relativeTime - Target playhead position relative to the start of the audio source (in seconds).
 * @param searchWindowMs - Search range size in milliseconds (defaults to 50ms).
 * @returns Adjusted time in seconds that aligns exactly with the closest zero-crossing.
 */
export function findNearestZeroCrossing(
  buffer: AudioBuffer,
  relativeTime: number,
  searchWindowMs: number = 50
): number {
  const sampleRate = buffer.sampleRate;
  const targetSample = Math.max(0, Math.min(buffer.length - 1, Math.round(relativeTime * sampleRate)));
  const data = buffer.getChannelData(0); // Analyze the primary channel

  const searchRadius = Math.round(sampleRate * (searchWindowMs / 1000));
  let nearestIdx = targetSample;
  let minDistance = Infinity;

  // Linear search outwards from the target sample
  for (let i = 0; i < searchRadius; i++) {
    // 1. Check forward sample index
    const fIdx = targetSample + i;
    if (fIdx < data.length - 1) {
      const currentVal = data[fIdx];
      const nextVal = data[fIdx + 1];
      
      // True zero or positive/negative sign crossing
      if (currentVal === 0 || (currentVal > 0 && nextVal < 0) || (currentVal < 0 && nextVal > 0)) {
        if (i < minDistance) {
          nearestIdx = fIdx;
          minDistance = i;
        }
      }
    }

    // 2. Check backward sample index
    const bIdx = targetSample - i;
    if (bIdx > 0) {
      const currentVal = data[bIdx];
      const prevVal = data[bIdx - 1];

      if (currentVal === 0 || (currentVal > 0 && prevVal < 0) || (currentVal < 0 && prevVal > 0)) {
        if (i < minDistance) {
          nearestIdx = bIdx;
          minDistance = i;
        }
      }
    }

    // Stop searching early if we found a crossing extremely close (optimization)
    if (minDistance <= 2) {
      break;
    }
  }

  // Return the adjusted time in seconds
  return nearestIdx / sampleRate;
}

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
