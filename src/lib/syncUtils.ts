import { db, storage } from './firebase';
import { doc, onSnapshot, setDoc, getDocs, collection, deleteDoc } from 'firebase/firestore';

export const deleteProjectCloud = async (projectId: string) => {
  const docRef = doc(db, 'projects', projectId);
  await deleteDoc(docRef);
};
import { ref, uploadBytes, getBlob } from 'firebase/storage';
import { Track } from './store';

export const uploadAssetCloud = async (assetId: string, blob: Blob) => {
  const assetRef = ref(storage, `assets/${assetId}`);
  await uploadBytes(assetRef, blob);
};

export const downloadAssetCloud = async (assetId: string) => {
  const assetRef = ref(storage, `assets/${assetId}`);
  try {
    return await getBlob(assetRef);
  } catch (e) {
    return null;
  }
};

export const listProjects = async () => {
  const querySnapshot = await getDocs(collection(db, 'projects'));
  return querySnapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  }));
};

export const subscribeToProject = (projectId: string, onUpdate: (data: any) => void) => {
  const docRef = doc(db, 'projects', projectId);
  return onSnapshot(docRef, (snapshot) => {
    if (snapshot.exists() && !snapshot.metadata.hasPendingWrites) {
      onUpdate(snapshot.data());
    }
  });
};

export const updateProjectCloud = async (projectId: string, projectName: string, tracks: Track[], bpm: number, masterVolume: number) => {
  const docRef = doc(db, 'projects', projectId);
  // We sanitize the state to ensure it's serializable for Firestore
  const sanitizedTracks = tracks.map(track => ({
    ...track,
    clips: track.clips.map(clip => ({
      id: clip.id,
      start: clip.start,
      duration: clip.duration,
      audioOffset: clip.audioOffset || 0,
      audioData: clip.audioData, // This is expected to be a string or serializable metadata
      notes: clip.notes || []
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
