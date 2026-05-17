import { db, storage, isFirebaseAvailable } from './firebase';
import { doc, onSnapshot, setDoc, getDocs, collection, deleteDoc } from 'firebase/firestore';
import { ref, uploadBytes, getBlob, getMetadata, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { Track } from './store';

export const deleteProjectCloud = async (projectId: string) => {
  if (!isFirebaseAvailable) return;
  
  // 1. Delete Firestore metadata document
  const docRef = doc(db, 'projects', projectId);
  await deleteDoc(docRef);
  console.log(`Cloud Sync: Deleted Firestore metadata for project ${projectId}`);

  // 2. Delete Storage bundle if it exists
  const fileRef = ref(storage, `projects/${projectId}.jaad`);
  try {
    await deleteObject(fileRef);
    console.log(`Cloud Sync: Deleted Storage bundle for project ${projectId}`);
  } catch (e) {
    console.warn(`Cloud Sync: Project bundle for ${projectId} could not be deleted (might not exist):`, e);
  }
};

export const uploadProjectBundleCloud = async (
  projectId: string,
  blob: Blob,
  onProgress?: (progress: number) => void
): Promise<string> => {
  if (!isFirebaseAvailable) throw new Error("Firebase is not initialized");
  const fileRef = ref(storage, `projects/${projectId}.jaad`);
  console.log(`Cloud Sync: Starting upload of project bundle ${projectId}...`);

  return new Promise((resolve, reject) => {
    const uploadTask = uploadBytesResumable(fileRef, blob, {
      contentType: 'application/zip',
      customMetadata: {
        projectId,
        uploadedAt: new Date().toISOString()
      }
    });

    uploadTask.on(
      'state_changed',
      (snapshot) => {
        const progress = (snapshot.bytesTransferred / snapshot.totalBytes) * 100;
        if (onProgress) onProgress(progress);
        console.log(`Cloud Sync: Upload progress for ${projectId}: ${progress.toFixed(2)}%`);
      },
      (error) => {
        console.error(`Cloud Sync: Upload failed for ${projectId}:`, error);
        reject(error);
      },
      async () => {
        try {
          const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
          console.log(`Cloud Sync: Successfully uploaded project bundle ${projectId}`);
          resolve(downloadUrl);
        } catch (err) {
          reject(err);
        }
      }
    );
  });
};

export const downloadProjectBundleCloud = async (
  projectId: string,
  onProgress?: (progress: number) => void
): Promise<Blob> => {
  if (!isFirebaseAvailable) throw new Error("Firebase is not initialized");
  const fileRef = ref(storage, `projects/${projectId}.jaad`);
  const downloadUrl = await getDownloadURL(fileRef);

  console.log(`Cloud Sync: Downloading project bundle ${projectId}...`);
  const response = await fetch(downloadUrl);
  if (!response.ok) {
    throw new Error(`Failed to download project bundle: ${response.statusText}`);
  }

  const contentLength = response.headers.get('content-length');
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
  
  if (!response.body) {
    throw new Error("Response body is not readable");
  }

  const reader = response.body.getReader();
  let receivedBytes = 0;
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    chunks.push(value);
    receivedBytes += value.length;
    
    if (totalBytes > 0 && onProgress) {
      const progress = (receivedBytes / totalBytes) * 100;
      onProgress(progress);
    }
  }

  const blob = new Blob(chunks, { type: 'application/zip' });
  console.log(`Cloud Sync: Finished downloading bundle ${projectId}. Total size: ${(receivedBytes / 1024 / 1024).toFixed(2)} MB`);
  if (onProgress) onProgress(100);
  return blob;
};

export const uploadAssetCloud = async (assetId: string, blob: Blob, onProgress?: (progress: number) => void) => {
  if (!isFirebaseAvailable) return;
  const assetRef = ref(storage, `assets/${assetId}`);
  console.log(`Cloud Sync: Uploading asset ${assetId}...`);
  await uploadBytes(assetRef, blob, {
    customMetadata: {
      assetId,
      uploadedAt: new Date().toISOString()
    }
  });
  console.log(`Cloud Sync: Successfully uploaded ${assetId}`);
  if (onProgress) onProgress(100);
};

export const downloadAssetCloud = async (assetId: string) => {
  if (!isFirebaseAvailable) return;
  const assetRef = ref(storage, `assets/${assetId}`);
  try {
    const blob = await getBlob(assetRef);
    console.log(`Cloud Sync: Successfully downloaded ${assetId}`);
    return blob;
  } catch (e) {
    console.warn(`Cloud Sync: Failed to download ${assetId} (Likely not in cloud yet)`);
    return null;
  }
};

export const listProjects = async () => {
  if (!isFirebaseAvailable) return [];
  const querySnapshot = await getDocs(collection(db, 'projects'));
  return querySnapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
};

export const subscribeToProject = (projectId: string, onUpdate: (data: any) => void) => {
  if (!isFirebaseAvailable) return () => {};
  const docRef = doc(db, 'projects', projectId);
  return onSnapshot(docRef, (snapshot) => {
    if (snapshot.exists() && !snapshot.metadata.hasPendingWrites) {
      onUpdate(snapshot.data());
    }
  });
};

export const updateProjectCloud = async (projectId: string, projectName: string, tracks: Track[], bpm: number, masterVolume: number, hasBundle?: boolean) => {
  if (!isFirebaseAvailable) return;
  const docRef = doc(db, 'projects', projectId);

  // Estimate payload size for Firestore (1MB limit)
  const estimatedSize = JSON.stringify({ tracks, bpm, masterVolume, projectName }).length;
  if (estimatedSize > 1000000) {
    console.error("Project metadata exceeds Firestore 1MB limit. Optimization required.");
    alert("Project is too large to sync to cloud metadata. Try reducing the number of clips or volume points.");
    return;
  }

  // We sanitize the state to ensure it's serializable for Firestore
  const sanitizedTracks = tracks.map(track => ({
    id: track.id,
    name: track.name,
    volume: track.volume,
    pan: track.pan,
    muted: track.muted,
    solo: track.solo,
    color: track.color,
    isFrozen: track.isFrozen || false,
    frozenBufferId: track.frozenBufferId || null,
    showLanes: track.showLanes || false,
    clips: track.clips.map(clip => ({
      id: clip.id,
      bufferId: clip.bufferId || clip.id,
      start: clip.start,
      duration: clip.duration,
      audioOffset: clip.audioOffset || 0,
      audioData: clip.audioData,
      notes: clip.notes || [],
      volumeEnvelope: clip.volumeEnvelope || []
    })),
    lanes: (track.lanes || []).map(lane => ({
      id: lane.id,
      name: lane.name,
      clips: lane.clips.map(clip => ({
        id: clip.id,
        bufferId: clip.bufferId || clip.id,
        start: clip.start,
        duration: clip.duration,
        audioOffset: clip.audioOffset || 0,
        audioData: clip.audioData,
        notes: clip.notes || [],
        volumeEnvelope: clip.volumeEnvelope || []
      }))
    }))
  }));

  const payload: any = { 
    projectName,
    tracks: sanitizedTracks, 
    bpm, 
    masterVolume,
    lastUpdated: Date.now() 
  };

  if (hasBundle !== undefined) {
    payload.hasBundle = hasBundle;
  }

  await setDoc(docRef, payload, { merge: true });
};
