import { useEffect } from 'react';
import { PENDING_UPDATE_KEY, useUpdaterStore } from '../../stores/updaterStore';
import { subscribeToLatestVersion } from '../../services/updatePush';

// Re-check for updates periodically while the app stays open (POS terminals
// are typically left running all day/shift).
const RECHECK_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Busca, baja e instala las actualizaciones. No muestra nada: el aviso es el ícono
 * discreto de la barra superior (UpdateBadge), que no tapa ni interrumpe el trabajo.
 */
export default function Updater() {
  const status = useUpdaterStore((s) => s.status);
  const update = useUpdaterStore((s) => s.update);
  const checkAndDownload = useUpdaterStore((s) => s.checkAndDownload);
  const install = useUpdaterStore((s) => s.install);

  useEffect(() => {
    if (!(window as any).__TAURI__) return;

    const initialTimer = setTimeout(() => checkAndDownload(), 5000);
    // Periodic poll is the fallback safety net — the Firestore listener below
    // is what makes this near-instant across every running PC.
    const interval = setInterval(() => checkAndDownload(), RECHECK_INTERVAL_MS);
    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [checkAndDownload]);

  // Instant push: every desktop app listens to one tiny Firestore doc that the
  // release pipeline updates when a new version is published, so every PC
  // reacts within seconds instead of waiting for its next periodic poll.
  useEffect(() => {
    if (!(window as any).__TAURI__) return;
    const unsubscribe = subscribeToLatestVersion(() => checkAndDownload());
    return unsubscribe;
  }, [checkAndDownload]);

  // NOTE: we deliberately do NOT hook into window close to auto-install.
  // That was tried and caused the app to become unclosable for some users
  // (a POS terminal that won't close is much worse than one that waits for
  // an explicit click). A postponed update is installed on the NEXT START instead.

  // Al abrir la app: si una versión quedó para después, se instala sola en cuanto está
  // descargada. Solo en los primeros minutos, para no reiniciar en medio de una venta.
  useEffect(() => {
    if (status !== 'ready' || !update) return;
    let pending = false;
    try { pending = !!localStorage.getItem(PENDING_UPDATE_KEY); } catch { /* sin almacenamiento */ }
    const openedRecently = performance.now() < 3 * 60 * 1000;
    if (pending && openedRecently) install();
  }, [status, update, install]);

  return null;
}
