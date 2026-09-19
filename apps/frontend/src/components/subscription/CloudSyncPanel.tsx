import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, CloudDownload, CloudOff, CloudUpload, Loader2, RefreshCw } from 'lucide-react';
import api from '../../services/api';

interface SyncStatus {
  enabled: boolean;
  phase: 'disabled' | 'idle' | 'syncing' | 'full' | 'restoring' | 'offline' | 'error' | 'waiting';
  pending: number;
  pendingImages: number;
  lastSyncAt: string | null;
  lastError: string | null;
  progress: { label: string; done: number; total: number } | null;
}

const ago = (iso: string | null) => {
  if (!iso) return 'nunca';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (min < 1) return 'recién';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `hace ${h} h`;
  return new Date(iso).toLocaleString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/** Configuración → Suscripción: estado de la copia en la nube y recuperación. */
export default function CloudSyncPanel() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState<'now' | 'restore' | null>(null);

  const load = () => api.get('/sync/status').then(({ data }) => setStatus(data)).catch(() => {});

  useEffect(() => {
    load();
    const t = window.setInterval(load, 3000);
    return () => window.clearInterval(t);
  }, []);

  if (!status || !status.enabled) return null;

  const syncNow = async () => {
    setBusy('now');
    try {
      const { data } = await api.post('/sync/now');
      setStatus(data);
      if (data.phase === 'offline') toast.error('Sin conexión: se sube cuando vuelva internet');
      else if (data.phase === 'error') toast.error(data.lastError || 'No se pudo sincronizar');
      else toast.success('Datos al día en la nube');
    } finally {
      setBusy(null);
    }
  };

  const restore = async () => {
    const ok = window.confirm(
      '¿Recuperar tus datos desde la nube?\n\n' +
      'Se reemplaza TODO lo que hay en esta PC (productos, ventas, cajas, clientes, usuarios) por la copia guardada en la nube.\n' +
      'Antes se guarda automáticamente un backup de seguridad de lo que hay ahora.',
    );
    if (!ok) return;
    setBusy('restore');
    const t = toast.loading('Recuperando tus datos… no cierres Ventra');
    try {
      const { data } = await api.post('/sync/restore', {}, { timeout: 15 * 60 * 1000 });
      toast.success(`Listo: se recuperaron ${data.rows.toLocaleString('es-AR')} registros y ${data.images.toLocaleString('es-AR')} fotos`, { id: t, duration: 6000 });
      setTimeout(() => window.location.reload(), 1500);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudieron recuperar los datos', { id: t });
    } finally {
      setBusy(null);
    }
  };

  const working = status.phase === 'syncing' || status.phase === 'full' || status.phase === 'restoring';
  const upToDate = status.pending === 0 && status.pendingImages === 0 && !working && status.phase !== 'error';
  const head = status.phase === 'waiting'
    ? { Icon: AlertTriangle, text: 'Esperando', cls: 'text-amber-800 bg-amber-50 border-amber-200' }
    : status.phase === 'offline'
    ? { Icon: CloudOff, text: 'Sin conexión', cls: 'text-slate-600 bg-slate-100 border-slate-200' }
    : status.phase === 'error'
      ? { Icon: AlertTriangle, text: 'Con error', cls: 'text-red-700 bg-red-50 border-red-200' }
      : working
        ? { Icon: Loader2, text: status.phase === 'restoring' ? 'Recuperando' : 'Subiendo', cls: 'text-sky-700 bg-sky-50 border-sky-200' }
        : upToDate
          ? { Icon: CloudUpload, text: 'Al día', cls: 'text-emerald-700 bg-emerald-50 border-emerald-200' }
          : { Icon: CloudUpload, text: 'Pendiente', cls: 'text-amber-800 bg-amber-50 border-amber-200' };

  const pct = status.progress && status.progress.total > 0 ? Math.min(100, Math.round((status.progress.done / status.progress.total) * 100)) : null;

  return (
    <div className="card p-6 space-y-4 max-w-2xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">Datos en la nube</h3>
          <p className="text-[13px] text-slate-500 mt-0.5">
            Copia automática de todo lo de esta PC. Funciona sin internet: los cambios se suben cuando vuelve la conexión.
          </p>
        </div>
        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] font-semibold whitespace-nowrap ${head.cls}`}>
          <head.Icon className={`w-3.5 h-3.5 ${working ? 'animate-spin' : ''}`} /> {head.text}
        </span>
      </div>

      {status.progress && (
        <div>
          <div className="flex justify-between text-[12px] text-slate-600 mb-1">
            <span>{status.progress.label}</span>
            <span className="tabular-nums">{status.progress.done.toLocaleString('es-AR')}{status.progress.total ? ` / ${status.progress.total.toLocaleString('es-AR')}` : ''}</span>
          </div>
          <div className="h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
            <div className="h-full bg-sky-500 transition-all" style={{ width: `${pct ?? 30}%` }} />
          </div>
        </div>
      )}

      <dl className="grid grid-cols-3 gap-3 text-[13px]">
        <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3">
          <dt className="text-slate-500">Última subida</dt>
          <dd className="font-bold text-slate-900 dark:text-white mt-0.5">{ago(status.lastSyncAt)}</dd>
        </div>
        <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3">
          <dt className="text-slate-500">Cambios pendientes</dt>
          <dd className="font-bold text-slate-900 dark:text-white mt-0.5 tabular-nums">{status.pending.toLocaleString('es-AR')}</dd>
        </div>
        <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3">
          <dt className="text-slate-500">Fotos por subir</dt>
          <dd className="font-bold text-slate-900 dark:text-white mt-0.5 tabular-nums">{status.pendingImages.toLocaleString('es-AR')}</dd>
        </div>
      </dl>

      {(status.phase === 'error' || status.phase === 'waiting') && status.lastError && (
        <p className="text-[12.5px] text-red-700 bg-red-50 border border-red-200 rounded-xl p-3">{status.lastError}</p>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <button onClick={syncNow} disabled={!!busy || working} className="h-10 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-[13px] font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50">
          {busy === 'now' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Sincronizar ahora
        </button>
        <button onClick={restore} disabled={!!busy || working} className="h-10 px-4 rounded-xl border border-red-200 text-[13px] font-semibold text-red-700 inline-flex items-center gap-2 hover:bg-red-50 disabled:opacity-50">
          {busy === 'restore' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CloudDownload className="w-4 h-4" />} Recuperar mis datos desde la nube
        </button>
      </div>
      <p className="text-[12px] text-slate-500">
        “Recuperar” es para una PC nueva o después de perder datos: reemplaza lo de esta PC por la copia de la nube (antes guarda un backup).
      </p>
    </div>
  );
}
