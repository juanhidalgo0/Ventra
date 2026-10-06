import { useEffect } from 'react';
import { PENDING_UPDATE_KEY, useUpdaterStore } from '../../stores/updaterStore';
import { usePOSStore } from '../../stores/posStore';

/** Minutos sin tocar la caja para instalar una actualización con la app abierta */
const IDLE_INSTALL_MS = 10 * 60 * 1000;
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

  // Al abrir la app: si hay una versión descargada, se instala sola (aunque nadie haya tocado
  // el cartel de actualizar). Solo en los primeros minutos y con la caja vacía, para no
  // reiniciar en medio de una venta. Si no se pudo, queda para la próxima vez que se abra.
  useEffect(() => {
    if (status !== 'ready' || !update) return;
    const openedRecently = performance.now() < 3 * 60 * 1000;
    if (!openedRecently) {
      try { localStorage.setItem(PENDING_UPDATE_KEY, update.version || '1'); } catch { /* sin almacenamiento */ }
      return;
    }
    if (usePOSStore.getState().cart.length > 0) return;
    install();
  }, [status, update, install]);

  // Con la app abierta todo el día (kioscos 24 h) no hay "próximo inicio": la versión descargada
  // se instala sola cuando la caja queda quieta 10 minutos con el carrito vacío. Reinicia en
  // menos de un minuto y no corta ninguna venta.
  useEffect(() => {
    if (!(window as any).__TAURI__ || status !== 'ready' || !update) return;
    let lastActivity = Date.now();
    const touch = () => { lastActivity = Date.now(); };
    const events = ['keydown', 'mousedown', 'touchstart', 'wheel'] as const;
    events.forEach((e) => window.addEventListener(e, touch, true));
    const timer = setInterval(() => {
      if (Date.now() - lastActivity < IDLE_INSTALL_MS) return;
      if (usePOSStore.getState().cart.length > 0) return;
      install();
    }, 30_000);
    return () => {
      clearInterval(timer);
      events.forEach((e) => window.removeEventListener(e, touch, true));
    };
  }, [status, update, install]);

  return null;
}
