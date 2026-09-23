import { useEffect, useState } from 'react';
import { CloudDownload } from 'lucide-react';
import api from '../../services/api';

/**
 * Aviso mientras una PC nueva (o una recuperación) baja todos los datos de la nube.
 * En ese rato la base está ocupada y no se pueden hacer cambios: se muestra el avance
 * para que nadie intente vender o cargar productos y se encuentre con un error.
 */
export default function SyncDownloadBanner() {
  const [progress, setProgress] = useState<{ label: string; done: number; total: number } | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const poll = async () => {
      try {
        const { data } = await api.get('/sync/status');
        const busy = data && (data.phase === 'full' || data.phase === 'restoring') && data.progress;
        if (alive) setProgress(busy ? data.progress : null);
        timer = window.setTimeout(poll, busy ? 2000 : 15000);
      } catch {
        if (alive) timer = window.setTimeout(poll, 15000);
      }
    };
    poll();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, []);

  if (!progress) return null;
  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null;

  return (
    <div className="fixed top-0 inset-x-0 z-[998] bg-rose-600 text-white keep-style">
      <div className="max-w-3xl mx-auto px-4 py-2 flex items-center gap-3">
        <CloudDownload className="w-4 h-4 shrink-0 animate-pulse" />
        <p className="text-[12.5px] font-semibold flex-1 min-w-0 truncate">
          {progress.label}{progress.total > 0 ? `: ${progress.done.toLocaleString('es-AR')} de ${progress.total.toLocaleString('es-AR')}` : '…'}
          <span className="font-normal text-rose-100"> · Esperá a que termine para vender o hacer cambios.</span>
        </p>
        {pct !== null && (
          <div className="w-24 h-1.5 rounded-full bg-white/25 overflow-hidden shrink-0">
            <div className="h-full bg-orange-200 rounded-full transition-all" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
