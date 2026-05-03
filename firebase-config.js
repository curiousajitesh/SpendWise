// ═══════════════════════════════════════════════════
// SpendWise — Firebase Configuration
// -----------------------------------------------
// HOW TO SET UP:
// 1. Go to https://console.firebase.google.com
// 2. Create a new project named "SpendWise"
// 3. Enable Authentication → Email/Password + Google
// 4. Enable Firestore Database (start in test mode)
// 5. Go to Project Settings → Your Apps → Add Web App
// 6. Copy your config values and paste below
// ═══════════════════════════════════════════════════

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  GoogleAuthProvider,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore,
  enableIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ▼▼▼ REPLACE THESE WITH YOUR FIREBASE PROJECT VALUES ▼▼▼
const firebaseConfig = {
  apiKey: "AIzaSyCJh0nV4kfCcuAXU7QozQM2MmOapfseBKo",
  authDomain: "spendwise-ajitesh.firebaseapp.com",
  projectId: "spendwise-ajitesh",
  storageBucket: "spendwise-ajitesh.firebasestorage.app",
  messagingSenderId: "755642804987",
  appId: "1:755642804987:web:9616dc679e30c8368b9e5e",
};

// ▲▲▲ REPLACE THESE WITH YOUR FIREBASE PROJECT VALUES ▲▲▲

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// Enable offline persistence (works offline, syncs when back online)
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === "failed-precondition") {
    console.warn("Offline persistence: multiple tabs open.");
  } else if (err.code === "unimplemented") {
    console.warn("Offline persistence not supported in this browser.");
  }
});
