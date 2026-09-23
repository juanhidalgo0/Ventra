import { create } from 'zustand';
import { check, type Update } from '@tauri-apps/plugin-updater';

type UpdaterStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'error';

interface UpdaterState {
  status: UpdaterStatus;
  version: string | null;
  progress: number; // 0-100, best-effort
  update: Update | null;
  checkAndDownload: () => Promise<void>;
}

/** Se pidió un chequeo mientras había otro en curso: repetirlo al terminar. */
let recheckAfter = false;

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: 'idle',
  version: null,
  progress: 0,
  update: null,

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
}));
