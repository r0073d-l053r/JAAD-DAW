import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as exportUtils from './exportUtils';
import JSZip from 'jszip';

const fileMock = vi.fn();
const generateAsyncMock = vi.fn().mockResolvedValue(new Blob(['mock blob']));

vi.mock('jszip', () => {
  return {
    default: class MockJSZip {
      file = fileMock;
      generateAsync = generateAsyncMock;
    }
  };
});

describe('createStemZip', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createMockBuffer = () => ({
    length: 10,
    numberOfChannels: 1,
    sampleRate: 44100,
    getChannelData: () => new Float32Array(10)
  } as unknown as AudioBuffer);

  it('sanitizes track names correctly', async () => {
    const mockBuffer = createMockBuffer();

    await exportUtils.createStemZip([
      { name: 'Track 1', buffer: mockBuffer },
      { name: 'Track@2#Special', buffer: mockBuffer },
      { name: 'UPPERCASE', buffer: mockBuffer },
      { name: '  spaces  ', buffer: mockBuffer },
      { name: 'dots.in.name', buffer: mockBuffer }
    ]);

    expect(fileMock).toHaveBeenCalledWith('track_1.wav', expect.any(Blob));
    expect(fileMock).toHaveBeenCalledWith('track_2_special.wav', expect.any(Blob));
    expect(fileMock).toHaveBeenCalledWith('uppercase.wav', expect.any(Blob));
    expect(fileMock).toHaveBeenCalledWith('__spaces__.wav', expect.any(Blob));
    expect(fileMock).toHaveBeenCalledWith('dots_in_name.wav', expect.any(Blob));
  });

  it('handles empty names and names that become empty after sanitization', async () => {
    const mockBuffer = createMockBuffer();

    await exportUtils.createStemZip([
      { name: '', buffer: mockBuffer },
      { name: '!@#$', buffer: mockBuffer }
    ]);

    expect(fileMock).toHaveBeenCalledWith('unnamed_track.wav', expect.any(Blob));
    expect(fileMock).toHaveBeenCalledWith('____.wav', expect.any(Blob));
  });

  it('handles duplicate track names', async () => {
    const mockBuffer = createMockBuffer();

    await exportUtils.createStemZip([
      { name: 'Track', buffer: mockBuffer },
      { name: 'Track', buffer: mockBuffer },
      { name: 'Track', buffer: mockBuffer }
    ]);

    expect(fileMock).toHaveBeenCalledWith('track.wav', expect.any(Blob));
    expect(fileMock).toHaveBeenCalledWith('track_1.wav', expect.any(Blob));
    expect(fileMock).toHaveBeenCalledWith('track_2.wav', expect.any(Blob));
  });
});

describe('formatFileSize', () => {
  it('formats bytes correctly', () => {
    expect(exportUtils.formatFileSize(0)).toBe('0 B');
    expect(exportUtils.formatFileSize(100)).toBe('100 B');
    expect(exportUtils.formatFileSize(1024)).toBe('1 KB');
    expect(exportUtils.formatFileSize(1024 * 1024)).toBe('1 MB');
    expect(exportUtils.formatFileSize(1024 * 1024 * 1024)).toBe('1 GB');
  });
});

describe('estimateWavSize', () => {
  it('estimates size correctly based on duration', () => {
    expect(exportUtils.estimateWavSize(1)).toBe(176400);
    expect(exportUtils.estimateWavSize(0)).toBe(0);
    expect(exportUtils.estimateWavSize(10)).toBe(1764000);
  });
});
