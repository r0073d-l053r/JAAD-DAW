import { initializeApp, FirebaseApp } from "firebase/app";
import { getFirestore, Firestore } from "firebase/firestore";
import { getAuth, Auth, signInAnonymously, User } from "firebase/auth";
import { getStorage, FirebaseStorage } from "firebase/storage";

let app: FirebaseApp | null = null;
let db: Firestore;
let auth: Auth;
let storage: FirebaseStorage;

export let isFirebaseAvailable = false;

const apiKey = import.meta.env.VITE_FIREBASE_API_KEY;

if (apiKey && apiKey !== "undefined" && apiKey.length > 5) {
  const firebaseConfig = {
    projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
    appId: import.meta.env.VITE_FIREBASE_APP_ID,
    databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
    storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    apiKey,
    authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
    messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID
  };

  app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  storage = getStorage(app);
  isFirebaseAvailable = true;
  console.log("Firebase: Initialized successfully.");
} else {
  console.warn("Firebase: No valid API key found. Cloud features will be unavailable.");
  // Leave them undefined so we can check isFirebaseAvailable
}

let signInPromise: Promise<User | null> | null = null;

/**
 * Signs in anonymously (once) so security rules can attribute writes to a uid.
 * Returns null when Firebase is unavailable or the Anonymous provider is
 * disabled in the Firebase console, in which case cloud writes may be
 * rejected by security rules.
 */
export const ensureSignedIn = (): Promise<User | null> => {
  if (!isFirebaseAvailable || !auth) return Promise.resolve(null);
  if (auth.currentUser) return Promise.resolve(auth.currentUser);
  if (!signInPromise) {
    signInPromise = signInAnonymously(auth)
      .then((cred) => cred.user)
      .catch((e) => {
        console.warn(
          "Firebase Auth: Anonymous sign-in failed. Enable the Anonymous provider in the Firebase console (Authentication > Sign-in method).",
          e
        );
        signInPromise = null; // allow retry on next call
        return null;
      });
  }
  return signInPromise;
};

// Kick off sign-in eagerly so a uid is ready before the first cloud write.
if (isFirebaseAvailable) {
  ensureSignedIn();
}

export { db, auth, storage };
export default app;
