import { db, storage, isFirebaseAvailable, ensureSignedIn } from './firebase';
import { doc, onSnapshot, setDoc, getDocs, getDoc, collection, deleteDoc, query, where } from 'firebase/firestore';
import { ref, uploadBytes, getBlob, getMetadata, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage';
import { Track } from './store';

export interface CloudProjectMetadata {
  id: string;
  projectName: string;
  tracks: Track[];
  bpm: number;
  originalBpm: number;
  masterVolume: number;
  lastUpdated: number;
  hasBundle?: boolean;
  backups?: number[];
  ownerId?: string;
  isPublic?: boolean;
}

export const isGitHubPagesBuild = (): boolean => {
  if (typeof window === 'undefined') return false;
  
  // Exclude local development environments explicitly (so localhost/127.0.0.1 is never locked or shown the modal)
  const hostname = window.location?.hostname || '';
  if (
    hostname === 'localhost' || 
    hostname === '127.0.0.1' || 
    hostname === '[::1]' || 
    hostname.startsWith('192.168.') || 
    hostname.startsWith('10.') || 
    hostname.startsWith('172.')
  ) {
    return false;
  }

  return (
    hostname.includes('github.io') ||
    hostname.includes('github.net') ||
    window.location.pathname.includes('/JAAD') ||
    window.location.pathname.includes('/JAAD-DAW')
  );
};

export const isDemoProject = (projectName: string): boolean => {
  const name = (projectName || '').toLowerCase();
  return name.includes('fractured protocol') || name.includes('kaelo');
};

export const deleteProjectCloud = async (projectId: string, projectName?: string) => {
  if (isGitHubPagesBuild() && projectName && isDemoProject(projectName)) {
    console.warn(`Cloud Sync Blocked: Deletion of demo project "${projectName}" is blocked in hosted environment.`);
    throw new Error("Deletion of the demo project is disabled in the GitHub Pages build.");
  }
  
  if (!isFirebaseAvailable) return;
  await ensureSignedIn();

  // 1. Delete Firestore metadata document
  const docRef = doc(db, 'projects', projectId);
  await deleteDoc(docRef);

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
  onProgress?: (progress: number) => void,
  projectName?: string
): Promise<string> => {
  if (isGitHubPagesBuild() && projectName && isDemoProject(projectName)) {
    throw new Error("Saving edits of the demo project to the cloud is disabled in the GitHub Pages build.");
  }
  
  if (!isFirebaseAvailable) throw new Error("Firebase is not initialized");
  await ensureSignedIn();
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

  try {
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

    const blob = new Blob(chunks as any[], { type: 'application/zip' });
    console.log(`Cloud Sync: Finished downloading bundle ${projectId}. Total size: ${(receivedBytes / 1024 / 1024).toFixed(2)} MB`);
    if (onProgress) onProgress(100);
    return blob;
  } catch (err) {
    console.warn(`Direct fetch for project bundle ${projectId} failed (likely due to CORS or network rules). Falling back to Firebase Storage getBlob...`, err);
    if (onProgress) onProgress(30); // Show some progress indicator
    const blob = await getBlob(fileRef);
    if (onProgress) onProgress(100);
    return blob;
  }
};

export const uploadAssetCloud = async (assetId: string, blob: Blob, onProgress?: (progress: number) => void) => {
  if (!isFirebaseAvailable) return;
  await ensureSignedIn();
  const assetRef = ref(storage, `assets/${assetId}`);
  console.log(`Cloud Sync: Uploading asset ${assetId}...`);
  
  let attempts = 0;
  const maxAttempts = 3;
  let delay = 1000;
  
  while (attempts < maxAttempts) {
    try {
      await uploadBytes(assetRef, blob, {
        customMetadata: {
          assetId,
          uploadedAt: new Date().toISOString()
        }
      });
      console.log(`Cloud Sync: Successfully uploaded ${assetId} on attempt ${attempts + 1}`);
      if (onProgress) onProgress(100);
      return;
    } catch (error) {
      attempts++;
      console.warn(`Cloud Sync: Upload attempt ${attempts} failed for ${assetId}:`, error);
      if (attempts >= maxAttempts) {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, delay));
      delay *= 2;
    }
  }
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
  const user = await ensureSignedIn();
  const projectsRef = collection(db, 'projects');

  // Security rules only allow listing your own projects and public templates,
  // so we issue both queries and merge the results.
  const queries = [getDocs(query(projectsRef, where('isPublic', '==', true)))];
  if (user) {
    queries.push(getDocs(query(projectsRef, where('ownerId', '==', user.uid))));
  }

  const snapshots = await Promise.all(queries);
  const byId = new Map<string, any>();
  for (const snapshot of snapshots) {
    for (const docSnap of snapshot.docs) {
      byId.set(docSnap.id, { id: docSnap.id, ...docSnap.data() });
    }
  }
  return Array.from(byId.values());
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

export const uploadProjectBackupCloud = async (
  projectId: string,
  blob: Blob,
  timestamp: number
): Promise<string> => {
  if (!isFirebaseAvailable) throw new Error("Firebase is not initialized");
  await ensureSignedIn();
  const fileRef = ref(storage, `backups/${projectId}_${timestamp}.jaad`);
  console.log(`Cloud Sync: Starting upload of project backup ${projectId}_${timestamp}...`);

  return new Promise((resolve, reject) => {
    const uploadTask = uploadBytesResumable(fileRef, blob, {
      contentType: 'application/zip',
      customMetadata: {
        projectId,
        timestamp: timestamp.toString()
      }
    });

    uploadTask.on(
      'state_changed',
      () => {},
      (error) => {
        console.error(`Cloud Sync: Backup upload failed:`, error);
        reject(error);
      },
      async () => {
        try {
          const downloadUrl = await getDownloadURL(uploadTask.snapshot.ref);
          console.log(`Cloud Sync: Successfully uploaded backup ${timestamp}`);
          resolve(downloadUrl);
        } catch (err) {
          reject(err);
        }
      }
    );
  });
};

export const downloadProjectBackupCloud = async (
  projectId: string,
  timestamp: number,
  onProgress?: (progress: number) => void
): Promise<Blob> => {
  if (!isFirebaseAvailable) throw new Error("Firebase is not initialized");
  const fileRef = ref(storage, `backups/${projectId}_${timestamp}.jaad`);

  try {
    const downloadUrl = await getDownloadURL(fileRef);
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      throw new Error(`Failed to download project backup: ${response.statusText}`);
    }

    const contentLength = response.headers.get('content-length');
    const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;
    
    if (!response.body) throw new Error("Response body is not readable");

    const reader = response.body.getReader();
    let receivedBytes = 0;
    const chunks: Uint8Array[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      receivedBytes += value.length;
      if (totalBytes > 0 && onProgress) {
        onProgress((receivedBytes / totalBytes) * 100);
      }
    }
    if (onProgress) onProgress(100);
    return new Blob(chunks as any[], { type: 'application/zip' });
  } catch (err) {
    console.warn(`Direct fetch failed. Falling back to getBlob...`, err);
    if (onProgress) onProgress(30);
    const blob = await getBlob(fileRef);
    if (onProgress) onProgress(100);
    return blob;
  }
};

export const deleteProjectBackupCloud = async (projectId: string, timestamp: number) => {
  if (!isFirebaseAvailable) return;
  await ensureSignedIn();
  const fileRef = ref(storage, `backups/${projectId}_${timestamp}.jaad`);
  try {
    await deleteObject(fileRef);
    console.log(`Cloud Sync: Deleted old backup ${timestamp}`);
  } catch (e) {
    console.warn(`Cloud Sync: Backup ${timestamp} could not be deleted:`, e);
  }
};

export const updateProjectCloud = async (projectId: string, projectName: string, tracks: Track[], bpm: number, originalBpm: number, masterVolume: number, hasBundle?: boolean, backups?: number[]) => {
  if (isGitHubPagesBuild() && isDemoProject(projectName)) {
    console.warn(`Cloud Sync Blocked: Overwriting/saving demo project "${projectName}" is blocked in hosted environment.`);
    throw new Error("Saving edits of the demo project to the cloud is disabled in the GitHub Pages build.");
  }
  
  if (!isFirebaseAvailable) return;
  const user = await ensureSignedIn();
  const docRef = doc(db, 'projects', projectId);

  // Estimate payload size for Firestore (1MB limit)
  const estimatedSize = JSON.stringify({ tracks, bpm, originalBpm, masterVolume, projectName }).length;
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
      volumeEnvelope: clip.volumeEnvelope || [],
      fadeIn: clip.fadeIn || 0,
      fadeOut: clip.fadeOut || 0
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
        volumeEnvelope: clip.volumeEnvelope || [],
        fadeIn: clip.fadeIn || 0,
        fadeOut: clip.fadeOut || 0
      }))
    }))
  }));

  const payload: any = {
    projectName,
    tracks: sanitizedTracks,
    bpm,
    originalBpm,
    masterVolume,
    lastUpdated: Date.now()
  };

  // Claim/retain ownership so security rules can attribute the document.
  // Non-owners are rejected by the rules; shared links stay read-only.
  if (user) {
    payload.ownerId = user.uid;
  }

  if (hasBundle !== undefined) {
    payload.hasBundle = hasBundle;
  }

  if (backups !== undefined) {
    payload.backups = backups;
  }

  await setDoc(docRef, payload, { merge: true });
};

export const getProjectCloud = async (projectId: string): Promise<CloudProjectMetadata | null> => {
  if (!isFirebaseAvailable) return null;
  const docRef = doc(db, 'projects', projectId);
  const docSnap = await getDoc(docRef);
  if (docSnap.exists()) {
    return {
      id: docSnap.id,
      ...docSnap.data()
    } as CloudProjectMetadata;
  }
  return null;
};

