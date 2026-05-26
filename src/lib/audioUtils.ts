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
