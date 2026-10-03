import { useEffect, useState } from 'react';
import { CloudDownload } from 'lucide-react';
import api from '../../services/api';
import { useAuthStore } from '../../stores/authStore';

type Progress = { label: string; done: number; total: number; background: boolean };

/**
 * Aviso mientras una PC nueva (o una recuperación) baja todos los datos de la nube.
 * En ese rato la base está ocupada: no se puede vender, cargar ni crear usuarios.
 * - Sin sesión (login / crear administrador): pantalla completa con la barra de avance,
 *   porque los usuarios del comercio llegan justamente con esta descarga.
 * - Con sesión: un aviso chico abajo a la izquierda, que no tapa botones.
 * Una sincronización larga de fondo (realineación) no frena la caja: se avisa igual,
 * aclarando que se puede seguir vendiendo.
 */
export default function SyncDownloadBanner() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [progress, setProgress] = useState<Progress | null>(null);

  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const poll = async () => {
      let busy = false;
      try {
        const { data } = await api.get('/sync-progress', { timeout: 4000, silent: true } as any);
        busy = !!data?.downloading || !!data?.background;
        if (alive) setProgress(busy ? { label: data.label, done: data.done || 0, total: data.total || 0, background: !data.downloading } : null);
      } catch {
        /* backend todavía arrancando: se reintenta */
      }
      if (alive) timer = window.setTimeout(poll, busy ? 1500 : 10000);
    };
    poll();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, []);

  if (!progress) return null;
  const pct = progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : null;
  const count = progress.total > 0
    ? `${progress.done.toLocaleString('es-AR')} de ${progress.total.toLocaleString('es-AR')}`
    : progress.done > 0 ? `${progress.done.toLocaleString('es-AR')} registros` : 'Preparando…';

  if (!isAuthenticated && !progress.background) {
    return (
      <div className="fixed inset-0 z-[1000] bg-slate-50 flex items-center justify-center p-6 keep-style">
        <div className="w-full max-w-md bg-white rounded-3xl border border-slate-200 shadow-xl p-8 text-center">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-rose-50 flex items-center justify-center">
            <CloudDownload className="w-8 h-8 text-rose-600 animate-pulse" />
          </div>
          <h2 className="mt-5 text-xl font-bold text-slate-900">Descargando tus datos de la nube</h2>
          <p className="mt-2 text-[14px] text-slate-500">
            Esta PC está trayendo tus productos, ventas, clientes y usuarios. Puede tardar unos minutos la primera vez.
          </p>
          <div className="mt-6 h-2.5 rounded-full bg-slate-100 overflow-hidden">
            {pct !== null
              ? <div className="h-full bg-rose-600 rounded-full transition-all duration-500" style={{ width: `${Math.max(pct, 3)}%` }} />
              : <div className="h-full w-1/3 bg-rose-600 rounded-full animate-pulse" />}
          </div>
          <div className="mt-2 flex justify-between text-[12.5px] text-slate-500">
            <span>{count}</span>
            {pct !== null && <span className="font-semibold text-slate-700">{pct}%</span>}
          </div>
          <p className="mt-6 text-[12.5px] text-slate-400">No cierres Ventra. Cuando termine, entrás con tu usuario de siempre.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed bottom-3 left-3 z-[998] max-w-[calc(100vw-24px)] keep-style">
      <div className="flex items-center gap-2.5 rounded-xl bg-white/95 border border-slate-200 shadow-lg px-3 py-2 w-[300px] max-w-full">
        <CloudDownload className="w-4 h-4 shrink-0 text-rose-600 animate-pulse" />
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold text-slate-700 truncate">
            {progress.background ? 'Sincronizando con la nube' : progress.label} · {count}
          </p>
          <p className="text-[11px] text-slate-500 truncate">
            {progress.background ? 'Podés seguir vendiendo normalmente.' : 'Esperá a que termine para vender o hacer cambios.'}
          </p>
          {pct !== null && (
            <div className="mt-1 h-1 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full bg-rose-600 rounded-full transition-all" style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
