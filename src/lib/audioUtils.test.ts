import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanUpStemsAsync } from './audioUtils';
import { audioEngine } from './audioEngine';

// Mock audioEngine buffers
vi.mock('./audioEngine', () => ({
  audioEngine: {
    buffers: new Map(),
  },
}));

describe('audioUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    audioEngine.buffers.clear();
  });

  describe('cleanUpStemsAsync', () => {
    it('should process clips and call appropriate dispatch actions', async () => {
      // 1. Create a mock AudioBuffer (44100Hz, 1 second duration = 44100 samples)
      // Alternates sound, silence, and sound
      const sampleRate = 44100;
      const channelData = new Float32Array(sampleRate);
      
      // Sound: 0s to 0.2s (volume 0.5)
      for (let i = 0; i < Math.floor(sampleRate * 0.2); i++) {
        channelData[i] = 0.5;
      }
      // Silence: 0.2s to 0.8s (volume 0.0) -> duration 0.6s (exceeds minSilenceDuration of 0.3s)
      for (let i = Math.floor(sampleRate * 0.2); i < Math.floor(sampleRate * 0.8); i++) {
        channelData[i] = 0.001; // inside noise floor
      }
      // Sound: 0.8s to 1.0s (volume 0.5)
      for (let i = Math.floor(sampleRate * 0.8); i < sampleRate; i++) {
        channelData[i] = 0.5;
      }

      const mockBuffer = {
        sampleRate,
        numberOfChannels: 1,
        length: sampleRate,
        duration: 1.0,
        getChannelData: vi.fn().mockReturnValue(channelData),
      } as unknown as AudioBuffer;

      // Register buffer in audioEngine.buffers map
      audioEngine.buffers.set('clip_1', mockBuffer);

      // 2. Create mock state with tracks and clips
      const mockState = {
        tracks: [
          {
            id: 'track_1',
            name: 'Vocal Track',
            clips: [
              {
                id: 'clip_1',
                bufferId: 'clip_1',
                start: 0,
                duration: 1.0,
                audioOffset: 0,
                notes: [],
                volumeEnvelope: [],
              }
            ],
            lanes: [
              {
                id: 'lane_1',
                name: 'Alternate Lane',
                clips: [
                  {
                    id: 'clip_1', // Reuses the vocal clip
                    bufferId: 'clip_1',
                    start: 0,
                    duration: 1.0,
                    audioOffset: 0,
                    notes: [],
                    volumeEnvelope: [],
                  }
                ]
              }
            ]
          }
        ]
      };

      const mockDispatch = vi.fn();

      // 3. Run cleaner
      await cleanUpStemsAsync(mockState, mockDispatch);

      // 4. Verify dispatcher lifecycle
      expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_IS_PROCESSING', payload: true });
      expect(mockDispatch).toHaveBeenCalledWith({ type: 'SET_IS_PROCESSING', payload: false });

      // Find REPLACE_TRACKS call
      const replaceTracksCall = mockDispatch.mock.calls.find(call => call[0].type === 'REPLACE_TRACKS');
      expect(replaceTracksCall).toBeDefined();

      const newTracks = replaceTracksCall[0].payload;
      expect(newTracks).toHaveLength(1);
      
      const vocalTrack = newTracks[0];
      // Assert that the clip is successfully split into two chunks because of the silence in the middle
      expect(vocalTrack.clips.length).toBe(2);
      expect(vocalTrack.lanes[0].clips.length).toBe(2);

      // Verify that the split parts have padded adjustments but remain within timeline limits
      const firstChunk = vocalTrack.clips[0];
      const secondChunk = vocalTrack.clips[1];

      expect(firstChunk.id).toContain('clip_1_cleanup_0_');
      expect(secondChunk.id).toContain('clip_1_cleanup_1_');

      // Padded starting margins
      expect(firstChunk.start).toBeGreaterThanOrEqual(0);
      expect(secondChunk.duration).toBeGreaterThan(0);
    });

    it('returns original clip unmodified if buffer does not exist', async () => {
      // Mock clip without registered buffer
      const mockState = {
        tracks: [
          {
            id: 'track_1',
            name: 'Synth',
            clips: [
              {
                id: 'clip_unregistered',
                start: 0,
                duration: 2.0,
              }
            ],
            lanes: []
          }
        ]
      };

      const mockDispatch = vi.fn();

      await cleanUpStemsAsync(mockState, mockDispatch);

      const replaceTracksCall = mockDispatch.mock.calls.find(call => call[0].type === 'REPLACE_TRACKS');
      const newTracks = replaceTracksCall[0].payload;
      expect(newTracks[0].clips[0].id).toBe('clip_unregistered');
    });
  });
});
