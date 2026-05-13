import { get, set, keys, del } from 'idb-keyval';

/**
 * Saves an audio file (Blob/File) to local IndexedDB storage.
 */
export const saveAsset = async (id: string, file: Blob | File) => {
  try {
    await set(`asset_${id}`, file);
  } catch (err) {
    console.error('Failed to save asset to IndexedDB:', err);
  }
};

/**
 * Retrieves an audio file from local IndexedDB storage.
 */
export const getAsset = async (id: string): Promise<Blob | File | null> => {
  try {
    const asset = await get(`asset_${id}`);
    return (asset as Blob | File) || null;
  } catch (err) {
    console.error('Failed to get asset from IndexedDB:', err);
    return null;
  }
};

/**
 * Clears all cached assets.
 */
export const clearAssets = async () => {
  const allKeys = await keys();
  for (const key of allKeys) {
    if (typeof key === 'string' && key.startsWith('asset_')) {
      await del(key);
    }
  }
};
