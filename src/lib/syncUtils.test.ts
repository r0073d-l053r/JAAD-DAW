import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isGitHubPagesBuild,
  isDemoProject,
  deleteProjectCloud,
  uploadProjectBundleCloud,
  downloadProjectBundleCloud,
  uploadAssetCloud,
  downloadAssetCloud,
  listProjects,
  subscribeToProject,
  updateProjectCloud,
  getProjectCloud,
} from './syncUtils';
import { doc, setDoc, deleteDoc, getDoc, getDocs, onSnapshot } from 'firebase/firestore';
import { ref, deleteObject, uploadBytesResumable, getDownloadURL, uploadBytes, getBlob } from 'firebase/storage';

// Mock ./firebase local module
vi.mock('./firebase', () => ({
  db: { type: 'FirestoreDB' },
  storage: { type: 'FirebaseStorage' },
  isFirebaseAvailable: true,
  ensureSignedIn: vi.fn().mockResolvedValue({ uid: 'test-user' }),
}));

// Mock firebase/firestore
vi.mock('firebase/firestore', () => ({
  doc: vi.fn().mockImplementation((db, collection, id) => ({ type: 'DocumentReference', id })),
  onSnapshot: vi.fn().mockImplementation((ref, cb) => {
    cb({
      exists: () => true,
      metadata: { hasPendingWrites: false },
      data: () => ({ projectName: 'KAELO' }),
    });
    return () => {};
  }),
  setDoc: vi.fn().mockResolvedValue(undefined),
  getDocs: vi.fn().mockResolvedValue({
    docs: [
      { id: 'proj_1', data: () => ({ projectName: 'KAELO' }) },
    ]
  }),
  getDoc: vi.fn().mockResolvedValue({
    exists: () => true,
    id: 'proj_2',
    data: () => ({ projectName: 'FRACTURED PROTOCOL' }),
  }),
  collection: vi.fn().mockReturnValue({ type: 'CollectionReference' }),
  deleteDoc: vi.fn().mockResolvedValue(undefined),
  query: vi.fn().mockImplementation((ref, ...constraints) => ({ type: 'Query', ref, constraints })),
  where: vi.fn().mockImplementation((field, op, value) => ({ type: 'QueryConstraint', field, op, value })),
}));

// Mock firebase/storage
vi.mock('firebase/storage', () => ({
  ref: vi.fn().mockImplementation((storage, path) => ({ type: 'StorageReference', path })),
  uploadBytes: vi.fn().mockResolvedValue({ ref: { path: 'assets/abc' } }),
  getBlob: vi.fn().mockResolvedValue(new Blob(['asset'])),
  getMetadata: vi.fn().mockResolvedValue({ customMetadata: {} }),
  uploadBytesResumable: vi.fn().mockImplementation((ref, blob, metadata) => {
    const task = {
      on: vi.fn().mockImplementation((event, progressCb, errCb, successCb) => {
        // Trigger progress callback
        progressCb({ bytesTransferred: 50, totalBytes: 100 });
        // Trigger success callback
        setTimeout(successCb, 0);
      }),
      snapshot: { ref: { path: 'projects/123.jaad' } },
    };
    return task;
  }),
  getDownloadURL: vi.fn().mockResolvedValue('https://firebase.url/bundle.zip'),
  deleteObject: vi.fn().mockResolvedValue(undefined),
}));

describe('syncUtils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('alert', vi.fn());
    vi.stubGlobal('location', {
      hostname: 'localhost',
      pathname: '/',
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('correctly identifies GitHub pages and localhost build targets', () => {
    expect(isGitHubPagesBuild()).toBe(false); // starts on localhost

    // Change hostname to production
    vi.stubGlobal('location', {
      hostname: 'project-jaad.github.io',
      pathname: '/JAAD-DAW/',
    });
    expect(isGitHubPagesBuild()).toBe(true);
  });

  it('treats an explicit self-hosted build as NOT the Pages demo, even under /JAAD-DAW/ on a private IP', () => {
    // Reproduces the musebot case: Tailscale IP + /JAAD-DAW/ base path would
    // otherwise be misdetected as the public demo (welcome modal + demo lock).
    vi.stubGlobal('location', {
      hostname: '100.77.248.40',
      pathname: '/JAAD-DAW/',
    });
    expect(isGitHubPagesBuild()).toBe(true); // without the flag it looks like the demo

    vi.stubEnv('VITE_SELF_HOSTED', '1');
    expect(isGitHubPagesBuild()).toBe(false); // Docker/self-hosted build opts out
    vi.unstubAllEnvs();
  });

  it('correctly filters demo projects from user custom creations', () => {
    expect(isDemoProject('kaelo')).toBe(true);
    expect(isDemoProject('Fractured Protocol')).toBe(true);
    expect(isDemoProject('My Epic Beats')).toBe(false);
  });

  it('blocks deletion of demo projects in production builds', async () => {
    vi.stubGlobal('location', {
      hostname: 'project-jaad.github.io',
      pathname: '/JAAD-DAW/',
    });

    await expect(deleteProjectCloud('proj_1', 'Kaelo')).rejects.toThrow(
      'Deletion of the demo project is disabled'
    );
  });

  it('deletes project documents and storage bundle objects in development builds', async () => {
    await deleteProjectCloud('proj_user', 'My custom clip');

    expect(deleteDoc).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledTimes(1);
  });

  it('uploads project bundle ZIP streams triggering progress callbacks', async () => {
    const progressSpy = vi.fn();
    const blob = new Blob(['project_binary']);

    const downloadUrl = await uploadProjectBundleCloud('proj_user', blob, progressSpy, 'My project');

    expect(uploadBytesResumable).toHaveBeenCalledTimes(1);
    expect(progressSpy).toHaveBeenCalledWith(50); // mocked 50% bytesTransferred
    expect(downloadUrl).toBe('https://firebase.url/bundle.zip');
  });

  it('streams down progressive chunks in downloadProjectBundleCloud', async () => {
    const progressSpy = vi.fn();

    // Stub window fetch to return streaming reader
    const mockReader = {
      read: vi.fn()
        .mockResolvedValueOnce({ done: false, value: new Uint8Array([1, 2, 3]) })
        .mockResolvedValueOnce({ done: true, value: undefined }),
    };

    const mockResponse = {
      ok: true,
      headers: {
        get: vi.fn().mockReturnValue('6'),
      },
      body: {
        getReader: vi.fn().mockReturnValue(mockReader),
      },
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    const downloadedBlob = await downloadProjectBundleCloud('proj_user', progressSpy);

    expect(fetch).toHaveBeenCalledWith('https://firebase.url/bundle.zip');
    expect(progressSpy).toHaveBeenCalledWith(50); // 3 bytes out of 6
    expect(progressSpy).toHaveBeenCalledWith(100);
    expect(downloadedBlob).toBeInstanceOf(Blob);
  });

  it('falls back to getBlob if fetch response is not ok in downloadProjectBundleCloud', async () => {
    const progressSpy = vi.fn();
    const mockResponse = {
      ok: false,
      statusText: 'Not Found',
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    const downloadedBlob = await downloadProjectBundleCloud('proj_user', progressSpy);

    expect(progressSpy).toHaveBeenCalledWith(30);
    expect(progressSpy).toHaveBeenCalledWith(100);
    expect(getBlob).toHaveBeenCalledTimes(1);
    expect(downloadedBlob).toBeInstanceOf(Blob);
  });

  it('uploads and downloads individual raw asset blobs in cloud', async () => {
    const blob = new Blob(['sound']);
    await uploadAssetCloud('asset_abc', blob);

    expect(uploadBytes).toHaveBeenCalledTimes(1);

    const downloaded = await downloadAssetCloud('asset_abc');
    expect(getBlob).toHaveBeenCalledTimes(1);
    expect(downloaded).toBeInstanceOf(Blob);
  });

  it('lists projects and gets detailed project metadata', async () => {
    const list = await listProjects();
    // One query for public templates, one for the signed-in user's projects
    expect(getDocs).toHaveBeenCalledTimes(2);
    expect(list[0]).toEqual({ id: 'proj_1', projectName: 'KAELO' });

    const details = await getProjectCloud('proj_2');
    expect(getDoc).toHaveBeenCalledTimes(1);
    expect(details).toEqual({ id: 'proj_2', projectName: 'FRACTURED PROTOCOL' });
  });

  it('subscribes to realtime project metadata updates', () => {
    const updateSpy = vi.fn();
    const unsubscribe = subscribeToProject('proj_3', updateSpy);

    expect(onSnapshot).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith({ projectName: 'KAELO' });
    unsubscribe();
  });

  it('updates project cloud sanitizing clips notes and volume envelopes', async () => {
    const tracks: any[] = [
      {
        id: 'track_1',
        name: 'Bass',
        volume: 0.8,
        pan: 0,
        muted: false,
        solo: false,
        color: '#ff0000',
        clips: [
          {
            id: 'clip_1',
            start: 0,
            duration: 4,
            notes: [{ pitch: 60, time: 0, duration: 1 }],
          }
        ],
      }
    ];

    await updateProjectCloud('proj_3', 'Bass Solo', tracks, 120, 120, 1.0);

    expect(setDoc).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        projectName: 'Bass Solo',
        bpm: 120,
        masterVolume: 1.0,
      }),
      { merge: true }
    );
  });
});
