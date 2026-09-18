import { doc, onSnapshot } from 'firebase/firestore';
import { getVentraDb } from './ventraFirebase';

// Aviso instantáneo de versión nueva: un listener liviano sobre un único
// documento público (ventra_desktop/latest_version) del proyecto de Ventra.
const getFirestoreDb = getVentraDb;

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
