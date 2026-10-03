import { create } from 'zustand';
import { check, type Update } from '@tauri-apps/plugin-updater';

type UpdaterStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'error';

interface UpdaterState {
  status: UpdaterStatus;
  version: string | null;
  progress: number; // 0-100, best-effort
  update: Update | null;
  /** Instalando: la app se reinicia sola al terminar. */
  installing: boolean;
  /** El usuario eligió instalarla al volver a abrir Ventra. */
  postponed: boolean;
  checkAndDownload: () => Promise<void>;
  install: () => Promise<void>;
  postpone: () => void;
}

/**
 * Versión que el usuario dejó para la próxima vez que abra la app: apenas termina de
 * descargarse se instala sola (antes de que se empiece a trabajar), sin volver a preguntar.
 */
export const PENDING_UPDATE_KEY = 'ventra_update_on_next_start';

async function invokeTauri(cmd: string, args?: Record<string, unknown>) {
  const tauri = (window as any).__TAURI__;
  const invokeFn = tauri?.core?.invoke || tauri?.invoke;
  if (!invokeFn) return;
  return invokeFn(cmd, args);
}

const readPending = () => {
  try { return !!localStorage.getItem(PENDING_UPDATE_KEY); } catch { return false; }
};

/** Se pidió un chequeo mientras había otro en curso: repetirlo al terminar. */
let recheckAfter = false;

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: 'idle',
  version: null,
  progress: 0,
  update: null,
  installing: false,
  postponed: readPending(),

  // Checks for a new version and, if found, downloads it silently in the
  // background right away — no user prompt to start the download. The user
  // is only ever asked once the file is fully downloaded and ready to apply.
  checkAndDownload: async () => {
    // Si ya hay una descarga en curso, se vuelve a chequear cuando termine:
    // así, si mientras tanto salió otra versión, se baja esa (la última).
    if (get().status === 'downloading' || get().status === 'checking') {
      recheckAfter = true;
      return;
    }
    const readyVersion = get().status === 'ready' ? get().version : null;
    set({ status: 'checking' });
    try {
      const update = await check();
      if (!update) {
        set({ status: readyVersion ? 'ready' : 'idle' });
        return;
      }
      // La última publicada ya está descargada: nada que hacer
      if (readyVersion && update.version === readyVersion) {
        set({ status: 'ready' });
        return;
      }

      // Hay una más nueva que la descargada (o ninguna descargada): se baja esa.
      // Siempre se instala directo la última, nunca una por una.
      set({ status: 'downloading', version: update.version, progress: 0, update });

      let totalBytes = 0;
      let downloadedBytes = 0;
      await update.download((event) => {
        if (event.event === 'Started') {
          totalBytes = event.data.contentLength || 0;
        } else if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength;
          const pct = totalBytes > 0 ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)) : 0;
          set({ progress: pct });
        } else if (event.event === 'Finished') {
          set({ progress: 100 });
        }
      });

      set({ status: 'ready' });
    } catch (err) {
      console.error('[Updater] Check/download failed:', err);
      set({ status: readyVersion ? 'ready' : 'error' });
    } finally {
      if (recheckAfter) {
        recheckAfter = false;
        setTimeout(() => get().checkAndDownload(), 1000);
      }
    }
  },

  install: async () => {
    const { update, installing } = get();
    if (!update || installing) return;
    set({ installing: true });
    const { default: toast } = await import('react-hot-toast');
    const loadingToast = toast.loading('Instalando actualización...');
    try {
      // The backend is a separate Node process spawned by Rust, holding native
      // .node addons (bcrypt, etc.) open — if it's still running when the NSIS
      // installer tries to overwrite those files, Windows has them locked and
      // the install fails/prompts. Stopping it first (and waiting for the OS
      // to actually release the files, not just requesting termination) avoids
      // that race entirely, instead of hoping the timing works out.
      // Que la sincronización termine la tanda en curso antes de cerrar el servidor
      try {
        const { default: api } = await import('../services/api');
        await api.post('/sync/pause', {}, { timeout: 20000 });
      } catch { /* sin servidor o sin sesión: se cierra igual */ }
      await invokeTauri('stop_backend_for_update');
      try { localStorage.removeItem(PENDING_UPDATE_KEY); } catch { /* sin almacenamiento */ }
      await update.install();
      toast.dismiss(loadingToast);
      await invokeTauri('restart_app');
    } catch (err: any) {
      set({ installing: false });
      toast.error('Error al instalar: ' + (err?.message || err), { id: loadingToast });
    }
  },

  postpone: () => {
    try { localStorage.setItem(PENDING_UPDATE_KEY, get().version || '1'); } catch { /* sin almacenamiento */ }
    set({ postponed: true });
  },
}));
