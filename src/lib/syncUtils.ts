import { db, storage, isFirebaseAvailable } from './firebase';
import { doc, onSnapshot, setDoc, getDocs, collection, deleteDoc } from 'firebase/firestore';

export const deleteProjectCloud = async (projectId: string) => {
  if (!isFirebaseAvailable) return;
  const docRef = doc(db, 'projects', projectId);
  await deleteDoc(docRef);
};
import { ref, uploadBytes, getBlob, getMetadata } from 'firebase/storage';

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

export const updateProjectCloud = async (projectId: string, projectName: string, tracks: Track[], bpm: number, masterVolume: number) => {
  if (!isFirebaseAvailable) return;
  const docRef = doc(db, 'projects', projectId);
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

  await setDoc(docRef, { 
    projectName,
    tracks: sanitizedTracks, 
    bpm, 
    masterVolume,
    lastUpdated: Date.now() 
  }, { merge: true });
};
