import { useEffect } from 'react';
import { check } from '@tauri-apps/plugin-updater';
import toast from 'react-hot-toast';

export default function Updater() {
  useEffect(() => {
    // Only run inside Tauri
    if (!(window as any).__TAURI__) return;

    const checkForUpdates = async () => {
      try {
        const update = await check();
        if (update?.available) {
          toast((t) => (
            <div className="flex flex-col gap-2">
              <span className="font-bold text-slate-800">Actualización disponible</span>
              <span className="text-sm text-slate-600">Se encontró la versión {update.version}. ¿Instalar ahora?</span>
              <div className="flex gap-2 mt-2">
                <button
                  className="px-3 py-1 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700 transition-colors"
                  onClick={async () => {
                    toast.dismiss(t.id);
                    const loadingToast = toast.loading('Descargando e instalando actualización...');
                    try {
                      await update.downloadAndInstall();
                      toast.success('Actualización instalada. Por favor, cierra y vuelve a abrir la aplicación para aplicar los cambios.', { 
                        id: loadingToast,
                        duration: 8000
                      });
                    } catch (e: any) {
                      toast.error('Error al actualizar: ' + e.message, { id: loadingToast });
                    }
                  }}
                >
                  Instalar y Reiniciar
                </button>
                <button
                  className="px-3 py-1 bg-slate-200 text-slate-700 rounded text-sm font-medium hover:bg-slate-300 transition-colors"
                  onClick={() => toast.dismiss(t.id)}
                >
                  Más tarde
                </button>
              </div>
            </div>
          ), { duration: Infinity, position: 'bottom-right' });
        }
      } catch (err) {
        console.error('[Updater] Failed to check for updates:', err);
      }
    };

    // Check on startup after a small delay to not block the UI thread initially
    setTimeout(() => {
      checkForUpdates();
    }, 5000);

  }, []);

  return null;
}
