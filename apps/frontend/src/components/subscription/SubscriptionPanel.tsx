import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { BadgeCheck, Clock, ExternalLink, Link2, Loader2, Lock, RefreshCw } from 'lucide-react';
import api from '../../services/api';

export interface SubscriptionStatus {
  state: 'EXEMPT' | 'UNLINKED' | 'ACTIVE' | 'GRACE' | 'READ_ONLY';
  enforced: boolean;
  email?: string | null;
  planName?: string | null;
  paidUntil?: string | null;
  graceEndsAt?: string | null;
  daysLeft?: number;
  lastSyncAt?: string | null;
  pending?: { code: string; url: string; expiresAt: string } | null;
}

export const SUBSCRIPTION_CHANGED = 'ventra-subscription-changed';

export function openExternal(url: string) {
  const tauri = (window as any).__TAURI__;
  const invokeFn = tauri?.core?.invoke || tauri?.invoke;
  if (invokeFn) invokeFn('open_browser', { url }).catch(() => window.open(url, '_blank'));
  else window.open(url, '_blank');
}

const fmtDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es-AR', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';

/** Configuración → Suscripción: estado de la cuenta y vinculación de esta PC con un código. */
export default function SubscriptionPanel() {
  const [status, setStatus] = useState<SubscriptionStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const pollRef = useRef<number | null>(null);

  const load = async () => {
    try {
      const { data } = await api.get('/subscription/status');
      setStatus(data);
    } catch {
      /* sin conexión con el servidor local */
    }
  };

  useEffect(() => {
    load();
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, []);

  // Mientras hay un código a la vista, preguntar cada 4 s si ya se confirmó en la web
  useEffect(() => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    if (!status?.pending) return;
    const linkedBefore = status.enforced ? status.lastSyncAt : null;
    pollRef.current = window.setInterval(async () => {
      try {
        const { data } = await api.post('/subscription/refresh');
        setStatus(data);
        if (data.enforced && data.lastSyncAt !== linkedBefore && !data.pending) {
          toast.success('¡Esta PC quedó vinculada a tu suscripción!');
          window.dispatchEvent(new Event(SUBSCRIPTION_CHANGED));
        }
      } catch { /* reintenta en el próximo ciclo */ }
    }, 4000);
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.pending?.code]);

  const startLink = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/subscription/link/start');
      setStatus(data);
      if (data.pending?.url) openExternal(data.pending.url);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo generar el código');
    } finally {
      setBusy(false);
    }
  };

  const refresh = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/subscription/refresh');
      setStatus(data);
      window.dispatchEvent(new Event(SUBSCRIPTION_CHANGED));
      toast.success('Estado actualizado');
    } catch {
      toast.error('No se pudo actualizar el estado');
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return <div className="card p-6 text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Cargando suscripción…</div>;
  }

  const badge = {
    ACTIVE: { text: 'Activa', cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', Icon: BadgeCheck },
    GRACE: { text: 'En período de gracia', cls: 'bg-amber-50 text-amber-800 border-amber-200', Icon: Clock },
    READ_ONLY: { text: 'Vencida · solo lectura', cls: 'bg-red-50 text-red-700 border-red-200', Icon: Lock },
    UNLINKED: { text: 'PC sin vincular', cls: 'bg-slate-100 text-slate-700 border-slate-200', Icon: Link2 },
    EXEMPT: { text: 'Sin control de suscripción', cls: 'bg-slate-100 text-slate-700 border-slate-200', Icon: Link2 },
  }[status.state];

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="card p-6 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-[15px] font-bold text-slate-900 dark:text-white">Suscripción de Ventra</h3>
            <p className="text-[13px] text-slate-500 mt-0.5">
              {status.enforced ? (status.email || 'Cuenta vinculada') : 'Vinculá esta PC con la cuenta con la que pagaste en ventra.store.'}
            </p>
          </div>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] font-semibold whitespace-nowrap ${badge.cls}`}>
            <badge.Icon className="w-3.5 h-3.5" /> {badge.text}
          </span>
        </div>

        {status.enforced && (
          <dl className="grid grid-cols-2 gap-3 text-[13px]">
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3">
              <dt className="text-slate-500">Plan</dt>
              <dd className="font-bold text-slate-900 dark:text-white mt-0.5">{status.planName || '—'}</dd>
            </div>
            <div className="rounded-xl bg-slate-50 dark:bg-slate-800 p-3">
              <dt className="text-slate-500">{status.paidUntil ? 'Paga hasta' : 'Pago'}</dt>
              <dd className="font-bold text-slate-900 dark:text-white mt-0.5">{status.paidUntil ? fmtDate(status.paidUntil) : 'Pendiente de acreditación'}</dd>
            </div>
            {status.state === 'GRACE' && (
              <div className="col-span-2 rounded-xl bg-amber-50 border border-amber-200 p-3 text-amber-900">
                Venció el pago. Te {status.daysLeft === 1 ? 'queda 1 día' : `quedan ${status.daysLeft} días`} de gracia (hasta el {fmtDate(status.graceEndsAt)}).
                Los días de gracia que uses se descuentan del próximo mes.
              </div>
            )}
            {status.state === 'READ_ONLY' && (
              <div className="col-span-2 rounded-xl bg-red-50 border border-red-200 p-3 text-red-800">
                Terminaron los días de gracia: podés consultar todo, pero no vender ni registrar nada hasta renovar.
              </div>
            )}
          </dl>
        )}

        {status.pending ? (
          <div className="rounded-2xl border-2 border-dashed border-slate-300 dark:border-slate-700 p-5 text-center">
            <p className="text-[13px] text-slate-600 dark:text-slate-300">Ingresá este código en <b>ventra.store/cuenta</b> (con tu cuenta de Google):</p>
            <p className="my-3 text-3xl font-black tracking-[0.2em] tabular-nums text-slate-900 dark:text-white select-all">{status.pending.code}</p>
            <p className="text-[12px] text-slate-500 flex items-center justify-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Esperando la confirmación… (el código vence a los 15 minutos)
            </p>
            <button onClick={() => openExternal(status.pending!.url)} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-rose-600 hover:underline">
              Abrir ventra.store/cuenta <ExternalLink className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-1">
          {status.state !== 'EXEMPT' && (
            <button onClick={startLink} disabled={busy} className="h-10 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[13px] font-bold inline-flex items-center gap-2 disabled:opacity-60">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              {status.enforced ? 'Vincular a otra cuenta' : 'Vincular esta PC'}
            </button>
          )}
          {status.enforced && (
            <button onClick={refresh} disabled={busy} className="h-10 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-[13px] font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800">
              <RefreshCw className="w-4 h-4" /> Actualizar estado
            </button>
          )}
          {(status.state === 'GRACE' || status.state === 'READ_ONLY') && (
            <button onClick={() => openExternal('https://ventra.store/#planes')} className="h-10 px-4 rounded-xl border border-slate-300 dark:border-slate-700 text-[13px] font-semibold text-slate-700 dark:text-slate-200 inline-flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-800">
              Renovar en ventra.store <ExternalLink className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
