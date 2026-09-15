import { useEffect } from 'react';
import { RefreshCw } from 'lucide-react';
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
  // an explicit click). Updating only ever happens via the button below,
  // which the user triggers themselves — never as a side effect of closing.

  if (status !== 'ready' || !update) return null;

  const handleInstallNow = async () => {
    const loadingToast = toast.loading('Instalando actualización...');
    try {
      // The backend is a separate Node process spawned by Rust, holding native
      // .node addons (bcrypt, etc.) open — if it's still running when the NSIS
      // installer tries to overwrite those files, Windows has them locked and
      // the install fails/prompts. Stopping it first (and waiting for the OS
      // to actually release the files, not just requesting termination) avoids
      // that race entirely, instead of hoping the timing works out.
      await invokeTauri('stop_backend_for_update');
      await update.install();
      toast.dismiss(loadingToast);
      await invokeTauri('restart_app');
    } catch (err: any) {
      toast.error('Error al instalar: ' + (err?.message || err), { id: loadingToast });
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-[999] flex items-center gap-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-2xl rounded-2xl px-4 py-3">
      <div className="w-9 h-9 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 flex items-center justify-center shrink-0">
        <RefreshCw className="w-4.5 h-4.5" />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-bold text-slate-800 dark:text-slate-100 leading-tight">Actualización lista</p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-tight">Versión {version} descargada</p>
      </div>
      <button
        onClick={handleInstallNow}
        className="ml-1 px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold whitespace-nowrap transition-all active:scale-95 cursor-pointer shadow-sm"
      >
        Reiniciar y actualizar
      </button>
    </div>
  );
}
