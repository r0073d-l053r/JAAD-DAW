import { Track, Clip } from './store';
import { audioEngine } from './audioEngine';

export async function cleanUpStemsAsync(state: any, dispatch: any) {
  dispatch({ type: "SET_IS_PROCESSING", payload: true });
  
  const threshold = 0.005; // ~ -46dB threshold for silence
  const blockSizeSeconds = 0.05; // 50ms chunks
  
  // Give UI a chance to show loading state
  await new Promise(r => setTimeout(r, 50));

  const newTracks = await Promise.all(state.tracks.map(async (track: Track) => {
    // Clean up main track clips
    const newClips = [];
    for (const clip of track.clips) {
      const chunks = await processClipAsync(clip, threshold, blockSizeSeconds);
      newClips.push(...chunks);
      // Yield to main thread after each clip
      await new Promise(r => setTimeout(r, 0));
    }
    
    // Clean up lane clips
    const newLanes = [];
    if (track.lanes) {
      for (const lane of track.lanes) {
        const laneClips = [];
        for (const clip of lane.clips) {
          const chunks = await processClipAsync(clip, threshold, blockSizeSeconds);
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

async function processClipAsync(clip: Clip, threshold: number, blockSizeSeconds: number): Promise<Clip[]> {
  const buffer = audioEngine.buffers.get(clip.bufferId || clip.id);
  if (!buffer) return [clip];
  
  const channelData = buffer.getChannelData(0);
  const sampleRate = buffer.sampleRate;
  const blockSize = Math.floor(sampleRate * blockSizeSeconds);
  const len = channelData.length;
  
  // Algorithmic optimization: Only scan the audible part of the buffer
  const startSample = Math.floor((clip.audioOffset || 0) * sampleRate);
  const endSample = Math.min(len, Math.ceil(((clip.audioOffset || 0) + clip.duration) * sampleRate));
  
  let isSound = false;
  let soundStart = startSample;
  const chunks: Clip[] = [];
  
  for (let i = startSample; i < endSample; i += blockSize) {
    let maxVal = 0;
    const end = Math.min(i + blockSize, endSample);
    
    // Check block for sound
    for (let j = i; j < end; j++) {
      const val = Math.abs(channelData[j]);
      if (val > maxVal) maxVal = val;
    }
    
    if (maxVal > threshold) {
      if (!isSound) {
        isSound = true;
        soundStart = i;
      }
    } else {
      if (isSound) {
        isSound = false;
        addChunk(chunks, clip, soundStart, i, sampleRate);
      }
    }
    
    // Yield occasionally if a single clip is very long
    if (i % (sampleRate * 5) < blockSize) {
        await new Promise(r => setTimeout(r, 0));
    }
  }
  
  if (isSound) {
    addChunk(chunks, clip, soundStart, endSample, sampleRate);
  }
  
  return chunks.length > 0 ? chunks : [clip];
}

function addChunk(chunks: Clip[], originalClip: Clip, startSample: number, endSample: number, sampleRate: number) {
  const chunkStartSec = startSample / sampleRate;
  const chunkEndSec = endSample / sampleRate;
  
  const visibleAudioStart = originalClip.audioOffset || 0;
  
  chunks.push({
    ...originalClip,
    id: originalClip.id + "_cleanup_" + Math.random().toString(36).substr(2, 5),
    bufferId: originalClip.bufferId || originalClip.id,
    start: originalClip.start + (chunkStartSec - visibleAudioStart),
    duration: chunkEndSec - chunkStartSec,
    audioOffset: chunkStartSec
  });
}
