import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isOpfsSupported,
  saveAsset,
  getAsset,
  clearAssets,
  saveLocalProjectState,
  getLocalProjectState,
  deleteLocalProjectState,
} from './assetManager';
import { get, set, del, keys } from 'idb-keyval';

// Mock idb-keyval database functions in-memory
vi.mock('idb-keyval', () => {
  const mockDb = new Map();
  return {
    get: vi.fn().mockImplementation((key) => Promise.resolve(mockDb.get(key))),
    set: vi.fn().mockImplementation((key, val) => {
      mockDb.set(key, val);
      return Promise.resolve();
    }),
    del: vi.fn().mockImplementation((key) => {
      mockDb.delete(key);
      return Promise.resolve();
    }),
    keys: vi.fn().mockImplementation(() => Promise.resolve(Array.from(mockDb.keys()))),
  };
});

describe('assetManager', () => {
  let mockWritable: any;
  let mockFileHandle: any;
  let mockDirectoryHandle: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockWritable = {
      write: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
    };

    mockFileHandle = {
      createWritable: vi.fn().mockResolvedValue(mockWritable),
      getFile: vi.fn().mockResolvedValue(new Blob(['opfsfile'])),
    };

    mockDirectoryHandle = {
      getFileHandle: vi.fn().mockResolvedValue(mockFileHandle),
      removeEntry: vi.fn().mockResolvedValue(undefined),
      values: vi.fn().mockImplementation(async function* () {
        yield { kind: 'file', name: 'asset_123' };
        yield { kind: 'file', name: 'asset_456' };
        yield { kind: 'directory', name: 'config' };
      }),
    };

    // Default global navigator mocks
    vi.stubGlobal('navigator', {
      storage: {
        getDirectory: vi.fn().mockResolvedValue(mockDirectoryHandle),
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('detects browser support for OPFS properly', () => {
    expect(isOpfsSupported()).toBe(true);

    // Disable OPFS in environment
    vi.stubGlobal('navigator', {});
    expect(isOpfsSupported()).toBe(false);
  });

  it('saves assets directly to OPFS when root directory handle is open', async () => {
    const mockFile = new Blob(['music'], { type: 'audio/wav' });
    await saveAsset('music_clip', mockFile);

    expect(mockDirectoryHandle.getFileHandle).toHaveBeenCalledWith('asset_music_clip', { create: true });
    expect(mockFileHandle.createWritable).toHaveBeenCalledTimes(1);
    expect(mockWritable.write).toHaveBeenCalledWith(mockFile);
    expect(mockWritable.close).toHaveBeenCalledTimes(1);
  });

  it('falls back to IndexedDB database when OPFS access crashes or throws', async () => {
    mockDirectoryHandle.getFileHandle.mockRejectedValue(new Error('Drive Full'));

    const mockFile = new Blob(['music'], { type: 'audio/wav' });
    await saveAsset('backup_clip', mockFile);

    // Check IndexedDB fallback call
    expect(set).toHaveBeenCalledWith('asset_backup_clip', mockFile);
  });

  it('gets assets from OPFS when file is registered', async () => {
    const asset = await getAsset('existing_clip');

    expect(mockDirectoryHandle.getFileHandle).toHaveBeenCalledWith('asset_existing_clip');
    expect(mockFileHandle.getFile).toHaveBeenCalledTimes(1);
    expect(asset).not.toBeNull();
  });

  it('falls back to retrieve assets from IndexedDB when OPFS throws', async () => {
    // Force OPFS failure
    mockDirectoryHandle.getFileHandle.mockRejectedValue(new Error('Not Found'));
    
    // Setup value in IndexedDB mock
    const mockSavedFile = new Blob(['sound']);
    vi.mocked(get).mockResolvedValue(mockSavedFile);

    const asset = await getAsset('db_only_clip');

    expect(get).toHaveBeenCalledWith('asset_db_only_clip');
    expect(asset).toBe(mockSavedFile);
  });

  it('saves, retrieves, and deletes project metadata from local database', async () => {
    const projectState = { tracks: [], bpm: 120 };
    
    await saveLocalProjectState('project_abc', projectState);
    expect(set).toHaveBeenCalledWith('project_state_project_abc', projectState);

    // Stub retrieve
    vi.mocked(get).mockResolvedValue(projectState);
    const retrievedState = await getLocalProjectState('project_abc');
    expect(retrievedState).toEqual(projectState);

    await deleteLocalProjectState('project_abc');
    expect(del).toHaveBeenCalledWith('project_state_project_abc');
  });

  it('clears all cached assets from both storage engines', async () => {
    vi.mocked(keys).mockResolvedValue(['asset_temp1', 'project_state_xyz', 'asset_temp2']);

    await clearAssets();

    // 1. Purged OPFS assets using names iterated from values() generator
    expect(mockDirectoryHandle.removeEntry).toHaveBeenCalledWith('asset_123');
    expect(mockDirectoryHandle.removeEntry).toHaveBeenCalledWith('asset_456');
    expect(mockDirectoryHandle.removeEntry).not.toHaveBeenCalledWith('config');

    // 2. Purged IndexedDB assets starting with asset_ prefix
    expect(del).toHaveBeenCalledWith('asset_temp1');
    expect(del).toHaveBeenCalledWith('asset_temp2');
    expect(del).not.toHaveBeenCalledWith('project_state_xyz');
  });
});
