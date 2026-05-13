import { describe, it, expect, vi } from 'vitest';
import { formatFileSize, estimateWavSize, audioBufferToWav, createStemZip, downloadBlob } from './exportUtils';
import JSZip from 'jszip';

describe('exportUtils', () => {
  describe('formatFileSize', () => {
    it('returns "0 B" for 0 bytes', () => {
      expect(formatFileSize(0)).toBe('0 B');
    });

    it('formats bytes correctly', () => {
      expect(formatFileSize(500)).toBe('500 B');
    });

    it('formats kilobytes correctly', () => {
      expect(formatFileSize(1024)).toBe('1 KB');
      expect(formatFileSize(1536)).toBe('1.5 KB');
    });

    it('formats megabytes correctly', () => {
      expect(formatFileSize(1048576)).toBe('1 MB');
      expect(formatFileSize(1572864)).toBe('1.5 MB');
    });

    it('formats gigabytes correctly', () => {
      expect(formatFileSize(1073741824)).toBe('1 GB');
    });
  });

  describe('estimateWavSize', () => {
    it('calculates wav size based on duration', () => {
      // duration * 44100 * 2 * 2
      expect(estimateWavSize(1)).toBe(1 * 44100 * 2 * 2);
      expect(estimateWavSize(10)).toBe(10 * 44100 * 2 * 2);
      expect(estimateWavSize(0)).toBe(0);
    });
  });

  describe('audioBufferToWav', () => {
    it('creates a Blob from an AudioBuffer', () => {
      // Mock AudioBuffer
      const mockAudioBuffer = {
        numberOfChannels: 2,
        length: 100,
        sampleRate: 44100,
        getChannelData: vi.fn((channel) => new Float32Array(100)),
      } as unknown as AudioBuffer;

      const blob = audioBufferToWav(mockAudioBuffer);

      expect(blob).toBeInstanceOf(Blob);
      expect(blob.type).toBe('audio/wav');
      // 100 samples * 2 channels * 2 bytes/sample + 44 bytes header
      expect(blob.size).toBe(100 * 2 * 2 + 44);
    });
  });

  describe('createStemZip', () => {
    it('creates a zip containing wav files', async () => {
      const mockAudioBuffer = {
        numberOfChannels: 1,
        length: 50,
        sampleRate: 44100,
        getChannelData: vi.fn((channel) => new Float32Array(50)),
      } as unknown as AudioBuffer;

      const tracks = [
        { name: 'Track 1', buffer: mockAudioBuffer },
        { name: 'Track @2!', buffer: mockAudioBuffer },
      ];

      const zipBlob = await createStemZip(tracks);

      expect(zipBlob).toBeInstanceOf(Blob);
    });
  });

  describe('downloadBlob', () => {
    it('creates an object URL and triggers a download', () => {
      const mockBlob = new Blob(['test data']);

      const createObjectURLMock = vi.fn(() => 'blob:test-url');
      const revokeObjectURLMock = vi.fn();

      global.URL.createObjectURL = createObjectURLMock;
      global.URL.revokeObjectURL = revokeObjectURLMock;

      const mockAnchor = {
        href: '',
        download: '',
        click: vi.fn(),
      } as unknown as HTMLAnchorElement;

      const createElementMock = vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor);

      downloadBlob(mockBlob, 'test.wav');

      expect(createObjectURLMock).toHaveBeenCalledWith(mockBlob);
      expect(createElementMock).toHaveBeenCalledWith('a');
      expect(mockAnchor.href).toBe('blob:test-url');
      expect(mockAnchor.download).toBe('test.wav');
      expect(mockAnchor.click).toHaveBeenCalled();
      expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:test-url');

      createElementMock.mockRestore();
    });
  });
});
