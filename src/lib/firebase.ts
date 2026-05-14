import { initializeApp, FirebaseApp } from "firebase/app";
import { getFirestore, Firestore } from "firebase/firestore";
import { getAuth, Auth } from "firebase/auth";
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

export { db, auth, storage };
export default app;
