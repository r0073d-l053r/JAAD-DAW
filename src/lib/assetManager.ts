import { get, set, keys, del } from 'idb-keyval';

/**
 * Checks if the Origin Private File System (OPFS) is supported by the current browser environment.
 */
export const isOpfsSupported = (): boolean => {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.storage &&
    typeof navigator.storage.getDirectory === 'function'
  );
};

/**
 * Helper to retrieve the OPFS root directory handle.
 */
const getOpfsRoot = async (): Promise<FileSystemDirectoryHandle | null> => {
  if (!isOpfsSupported()) return null;
  try {
    return await navigator.storage.getDirectory();
  } catch (err) {
    console.warn('Failed to access OPFS directory handle:', err);
    return null;
  }
};

/**
 * Saves an audio file (Blob/File) using OPFS with a fallback to local IndexedDB.
 */
export const saveAsset = async (id: string, file: Blob | File) => {
  const root = await getOpfsRoot();
  if (root) {
    try {
      const fileHandle = await root.getFileHandle(`asset_${id}`, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(file);
      await writable.close();
      console.log(`Asset Storage (OPFS): Saved asset ${id}`);
      return;
    } catch (err) {
      console.warn(`OPFS write failed for asset ${id}, falling back to IndexedDB:`, err);
    }
  }

  // Fallback to IndexedDB
  try {
    await set(`asset_${id}`, file);
    console.log(`Asset Storage (IndexedDB Fallback): Saved asset ${id}`);
  } catch (err) {
    console.error('Failed to save asset to IndexedDB:', err);
  }
};

/**
 * Retrieves an audio file from OPFS if available, falling back to IndexedDB.
 */
export const getAsset = async (id: string): Promise<Blob | File | null> => {
  const root = await getOpfsRoot();
  if (root) {
    try {
      const fileHandle = await root.getFileHandle(`asset_${id}`);
      const file = await fileHandle.getFile();
      console.log(`Asset Storage (OPFS): Retrieved asset ${id}`);
      return file;
    } catch (err) {
      // File not found in OPFS or failed to read, try falling back to IndexedDB
    }
  }

  // Fallback to IndexedDB
  try {
    const asset = await get(`asset_${id}`);
    if (asset) {
      console.log(`Asset Storage (IndexedDB Fallback): Retrieved asset ${id}`);
      return asset as Blob | File;
    }
    return null;
  } catch (err) {
    console.error('Failed to get asset from IndexedDB:', err);
    return null;
  }
};

/**
 * Clears all cached asset files from both OPFS and IndexedDB.
 */
export const clearAssets = async () => {
  // 1. Purge OPFS assets
  const root = await getOpfsRoot();
  if (root) {
    try {
      // Cast root to any to support keys()/values() iterators if TypeScript definitions are restrictive
      const dirHandle = root as any;
      if (typeof dirHandle.values === 'function') {
        for await (const entry of dirHandle.values()) {
          if (entry.kind === 'file' && entry.name.startsWith('asset_')) {
            await root.removeEntry(entry.name);
          }
        }
      }
      console.log('Asset Storage (OPFS): Cleared assets');
    } catch (err) {
      console.warn('Failed to clear assets in OPFS:', err);
    }
  }

  // 2. Purge IndexedDB assets
  try {
    const allKeys = await keys();
    for (const key of allKeys) {
      if (typeof key === 'string' && key.startsWith('asset_')) {
        await del(key);
      }
    }
    console.log('Asset Storage (IndexedDB): Cleared assets');
  } catch (err) {
    console.error('Failed to clear assets in IndexedDB:', err);
  }
};

/**
 * Saves the project metadata JSON structure to local IndexedDB.
 */
export const saveLocalProjectState = async (projectId: string, state: any) => {
  try {
    await set(`project_state_${projectId}`, state);
    console.log(`Local-First: Saved local project state for ${projectId}`);
  } catch (err) {
    console.error(`Failed to save local project state for ${projectId}:`, err);
  }
};

/**
 * Retrieves the project metadata JSON structure from local IndexedDB.
 */
export const getLocalProjectState = async (projectId: string): Promise<any | null> => {
  try {
    const state = await get(`project_state_${projectId}`);
    return state || null;
  } catch (err) {
    console.error(`Failed to retrieve local project state for ${projectId}:`, err);
    return null;
  }
};

/**
 * Deletes the project metadata JSON structure from local IndexedDB.
 */
export const deleteLocalProjectState = async (projectId: string) => {
  try {
    await del(`project_state_${projectId}`);
    console.log(`Local-First: Deleted local project state for ${projectId}`);
  } catch (err) {
    console.error(`Failed to delete local project state for ${projectId}:`, err);
  }
};

