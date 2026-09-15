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

export const useUpdaterStore = create<UpdaterState>((set, get) => ({
  status: 'idle',
  version: null,
  progress: 0,
  update: null,

  // Checks for a new version and, if found, downloads it silently in the
  // background right away — no user prompt to start the download. The user
  // is only ever asked once the file is fully downloaded and ready to apply.
  checkAndDownload: async () => {
    if (get().status === 'downloading' || get().status === 'ready') return; // already in progress / done
    set({ status: 'checking' });
    try {
      const update = await check();
      if (!update) {
        set({ status: 'idle' });
        return;
      }

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
      set({ status: 'error' });
    }
  },
}));
