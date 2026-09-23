import { useEffect, useState } from 'react';
import { RefreshCw, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { useUpdaterStore } from '../../stores/updaterStore';
import { subscribeToLatestVersion } from '../../services/updatePush';

async function invokeTauri(cmd: string, args?: Record<string, unknown>) {
  const tauri = (window as any).__TAURI__;
  const invokeFn = tauri?.core?.invoke || tauri?.invoke;
  if (!invokeFn) return;
  return invokeFn(cmd, args);
}

// Re-check for updates periodically while the app stays open (POS terminals
// are typically left running all day/shift).
const RECHECK_INTERVAL_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * Si el usuario cierra el aviso, la versión queda "pendiente": la próxima vez que
 * se abra la app, apenas termina de descargarse se instala sola (antes de que se
 * empiece a trabajar), sin volver a preguntar.
 */
const PENDING_KEY = 'ventra_update_on_next_start';

export default function Updater() {
  const status = useUpdaterStore((s) => s.status);
  const version = useUpdaterStore((s) => s.version);
  const update = useUpdaterStore((s) => s.update);
  const checkAndDownload = useUpdaterStore((s) => s.checkAndDownload);

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
  // an explicit click). A dismissed update is installed on the NEXT START instead.

  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);

  const install = async () => {
    if (!update || installing) return;
    setInstalling(true);
    const loadingToast = toast.loading('Instalando actualización...');
    try {
      // The backend is a separate Node process spawned by Rust, holding native
      // .node addons (bcrypt, etc.) open — if it's still running when the NSIS
      // installer tries to overwrite those files, Windows has them locked and
      // the install fails/prompts. Stopping it first (and waiting for the OS
      // to actually release the files, not just requesting termination) avoids
      // that race entirely, instead of hoping the timing works out.
      await invokeTauri('stop_backend_for_update');
      localStorage.removeItem(PENDING_KEY);
      await update.install();
      toast.dismiss(loadingToast);
      await invokeTauri('restart_app');
    } catch (err: any) {
      setInstalling(false);
      toast.error('Error al instalar: ' + (err?.message || err), { id: loadingToast });
    }
  };

  // Al abrir la app: si una versión quedó pendiente (se cerró el aviso), se instala
  // sola en cuanto está descargada. Solo en los primeros minutos, para no reiniciar
  // en medio de una venta.
  useEffect(() => {
    if (status !== 'ready' || !update) return;
    const pending = localStorage.getItem(PENDING_KEY);
    const openedRecently = performance.now() < 3 * 60 * 1000;
    if (pending && openedRecently) install();
  }, [status, update]);

  if (status !== 'ready' || !update || dismissed || installing) return null;

  const dismiss = () => {
    localStorage.setItem(PENDING_KEY, version || '1');
    setDismissed(true);
    toast('La actualización se instala sola la próxima vez que abras Ventra', { icon: '🕐', duration: 4000 });
  };

  // Píldora chica arriba al centro: no tapa el botón de cobrar del POS (abajo a la derecha)
  return (
    <div className="fixed top-2 left-1/2 -translate-x-1/2 z-[999] flex items-center gap-2 bg-white/95 dark:bg-slate-900/95 backdrop-blur border border-slate-200 dark:border-slate-700 shadow-lg rounded-full pl-3 pr-1.5 py-1.5 keep-style">
      <RefreshCw className="w-3.5 h-3.5 text-rose-600 shrink-0" />
      <span className="text-[12px] font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">Versión {version} lista</span>
      <button
        onClick={install}
        className="px-2.5 py-1 rounded-full bg-rose-600 hover:bg-rose-700 text-white text-[11.5px] font-bold whitespace-nowrap cursor-pointer keep-style"
      >
        Actualizar ahora
      </button>
      <button
        onClick={dismiss}
        title="Cerrar: se actualiza sola al volver a abrir Ventra"
        className="w-6 h-6 rounded-full flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 cursor-pointer keep-style"
        aria-label="Cerrar"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
