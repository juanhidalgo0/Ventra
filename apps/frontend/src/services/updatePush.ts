import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, onSnapshot } from 'firebase/firestore';

// Reuses the same (public, client-safe) Firebase project already used for the
// GoDelivery integration — just to push instant "new version available"
// notifications to every running desktop app. This is a single lightweight
// realtime listener on one tiny document; it never touches sale/product data.
const firebaseConfig = {
  apiKey: 'AIzaSyAldeFtUWWlEpcuEg1LSTko90cVEvnsMLA',
  authDomain: 'godelivery-magdalena.firebaseapp.com',
  projectId: 'godelivery-magdalena',
  storageBucket: 'godelivery-magdalena.firebasestorage.app',
  messagingSenderId: '848164656125',
  appId: '1:848164656125:web:eef2314205f5d8f887ff94',
};

function getFirestoreDb() {
  const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
  return getFirestore(app);
}

// Subscribes to the "latest published version" doc and calls onNewVersion
// every time it changes (including the initial read). Returns an unsubscribe
// function. Fails silently (no crash, no toast) if offline or Firestore is
// unreachable — the periodic poll in Updater.tsx is the fallback in that case.
export function subscribeToLatestVersion(onNewVersion: (version: string) => void): () => void {
  try {
    const db = getFirestoreDb();
    const ref = doc(db, 'ventra_desktop', 'latest_version');
    return onSnapshot(
      ref,
      (snap) => {
        const version = snap.data()?.version;
        if (typeof version === 'string' && version) onNewVersion(version);
      },
      (err) => console.warn('[UpdatePush] Firestore listener error (will rely on periodic poll):', err.message)
    );
  } catch (err) {
    console.warn('[UpdatePush] Failed to subscribe:', err);
    return () => {};
  }
}
