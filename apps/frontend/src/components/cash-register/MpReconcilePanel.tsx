import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Smartphone } from 'lucide-react';
import api from '../../services/api';
import { isMercadoPagoMethod } from '../../utils/mpPoint';
import { comingSoon } from '../../utils/comingSoon';

type Posnet = { id: string; name: string };

export interface MpPayment { id: string; at: string | null; amount: number; channel: string; method: string | null; type: string | null; last4: string | null; installments: number | null }
export interface MpReconcile {
  real: { count: number; total: number };
  realForSession: number;
  registered: { count: number; total: number };
  matchedCount: number;
  otherTills: { count: number; total: number };
  unmatchedPayments: { payment: MpPayment; suggestions: { saleId: string; saleNumber: number; paymentRowId: string; method: string; amount: number; at: string; minutes: number }[] }[];
  unmatchedSales: { saleId: string; saleNumber: number; paymentRowId: string; amount: number; at: string; reference: string | null; unconfirmed: boolean }[];
}

/** Medios de pago configurados en esta PC (los mismos que usa el cierre de caja) */
export function readPosnets(): Posnet[] {
  try {
    const stored = localStorage.getItem('posnet_configs');
    if (stored) return JSON.parse(stored) as Posnet[];
  } catch { /* sin storage */ }
  return [{ id: 'CLOVER', name: 'Clover' }, { id: 'MERCADOPAGO', name: 'MercadoPago' }];
}

const mpMethodIds = (posnets: Posnet[]) => posnets.filter((p) => isMercadoPagoMethod(p.id, posnets)).map((p) => p.id);

/**
 * Pagos que Mercado Pago realmente cobró en el turno, cruzados con las ventas cargadas
 * como Mercado Pago. `enabled` = la cuenta de Mercado Pago está conectada.
 */
export function useMpReconcile(sessionId: string | undefined, posnets: Posnet[], enabled: boolean) {
  const [result, setResult] = useState<MpReconcile | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const methods = mpMethodIds(posnets).join(',');

  const refresh = useCallback(async () => {
    if (!sessionId || !enabled) return;
    setLoading(true);
    try {
      const { data } = await api.get(`/mercadopago/reconcile/${sessionId}`, { params: { mpMethods: methods } });
      setResult(data);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.message || 'No se pudieron traer los pagos de Mercado Pago.');
    } finally {
      setLoading(false);
    }
  }, [sessionId, enabled, methods]);

  useEffect(() => { refresh(); }, [refresh]);
  return { result, loading, error, refresh };
}

/** ¿La cuenta de Mercado Pago está conectada? null mientras se consulta */
export function useMpConnected() {
  const [connected, setConnected] = useState<boolean | null>(comingSoon('mercadoPago') ? false : null);
  useEffect(() => {
    if (comingSoon('mercadoPago')) return;
    api.get('/mercadopago/status')
      .then(({ data }) => {
        const ok = !!data?.connected && !data?.needsReconnect;
        setConnected(ok);
        // Para el aviso de pagos sin venta: qué medios de esta caja son Mercado Pago
        if (ok) api.post('/mercadopago/local-methods', { methods: mpMethodIds(readPosnets()) }).catch(() => {});
      })
      .catch(() => setConnected(false));
  }, []);
  return connected;
}

/** Una línea para las notas del cierre: queda a la vista del dueño */
export function mpReconcileNote(r: MpReconcile) {
  const fmt = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
  const parts = [`Cobrado en Mercado Pago ${fmt(r.realForSession)}`, `cargado como MP ${fmt(r.registered.total)}`];
  if (r.unmatchedPayments.length) parts.push(`${r.unmatchedPayments.length} pago(s) sin venta`);
  if (r.unmatchedSales.length) parts.push(`${r.unmatchedSales.length} venta(s) MP sin pago`);
  if (!r.unmatchedPayments.length && !r.unmatchedSales.length) parts.push('todo coincide');
  return `[Control Mercado Pago] ${parts.join(' · ')}`;
}

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '—');
const CHANNEL: Record<string, string> = { point: 'maquinita', qr: 'QR', transfer: 'transferencia', other: 'online' };

/**
 * Panel del cierre: qué pagos de Mercado Pago no tienen venta y qué ventas de Mercado Pago
 * no tienen pago, con la corrección a un clic (verificada contra Mercado Pago).
 */
export default function MpReconcilePanel({
  data,
  posnets,
  onFixed,
  readOnly = false,
}: {
  data: ReturnType<typeof useMpReconcile>;
  posnets: Posnet[];
  onFixed?: () => void;
  /** Caja ya cerrada (vista del dueño): se muestra el cruce, sin corregir ventas */
  readOnly?: boolean;
}) {
  const { result, loading, error, refresh } = data;
  const [busy, setBusy] = useState<string | null>(null);
  const fmt = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(n);
  const methodName = (id: string) => (id === 'CASH' ? 'Efectivo' : posnets.find((p) => p.id === id)?.name || id);
  const otherMethods = [{ id: 'CASH', name: 'Efectivo' }, ...posnets.filter((p) => !isMercadoPagoMethod(p.id, posnets))];

  const fix = async (key: string, body: Record<string, any>) => {
    setBusy(key);
    try {
      await api.post('/mercadopago/reconcile/fix', { ...body, mpMethods: mpMethodIds(posnets) });
      toast.success('Venta corregida');
      onFixed?.();
      await refresh();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo corregir la venta');
    } finally {
      setBusy(null);
    }
  };

  const issues = result ? result.unmatchedPayments.length + result.unmatchedSales.length : 0;
  const diff = result ? Math.round((result.realForSession - result.registered.total) * 100) / 100 : 0;

  return (
    <div className={`rounded-2xl border p-4 space-y-3 ${!result ? 'border-slate-200 dark:border-slate-700' : issues ? 'border-amber-300 dark:border-amber-700 bg-amber-50/40 dark:bg-amber-900/10' : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50/40 dark:bg-emerald-900/10'}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-300 flex items-center justify-center shrink-0">
            <Smartphone className="w-4 h-4" />
          </div>
          <div>
            <p className="text-[13px] font-black text-slate-800 dark:text-slate-100 uppercase tracking-wider">Control con Mercado Pago</p>
            <p className="text-[12px] text-slate-500">Lo que Mercado Pago cobró de verdad en este turno, contra lo cargado en Ventra</p>
          </div>
        </div>
        <button onClick={refresh} disabled={loading} className="h-8 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 text-[12px] font-semibold text-slate-600 dark:text-slate-300 inline-flex items-center gap-1.5 hover:bg-white dark:hover:bg-slate-800 disabled:opacity-60 shrink-0">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Actualizar
        </button>
      </div>

      {error && !result && (
        <p className="text-[13px] text-amber-900 dark:text-amber-200 flex gap-2"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" /> {error}</p>
      )}
      {!result && !error && (
        <p className="text-[13px] text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Consultando los pagos de Mercado Pago…</p>
      )}

      {result && (
        <>
          <dl className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2.5">
              <dt className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Cobrado en MP</dt>
              <dd className="text-lg font-black text-slate-900 dark:text-white tabular-nums">{fmt(result.realForSession)}</dd>
            </div>
            <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2.5">
              <dt className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Cargado como MP</dt>
              <dd className="text-lg font-black text-slate-900 dark:text-white tabular-nums">{fmt(result.registered.total)}</dd>
            </div>
            <div className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-2.5">
              <dt className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Diferencia</dt>
              <dd className={`text-lg font-black tabular-nums ${Math.abs(diff) < 0.01 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'}`}>{diff > 0 ? '+' : ''}{fmt(diff)}</dd>
            </div>
          </dl>

          {readOnly && issues > 0 && (
            <p className="text-[12px] text-slate-500">La caja ya está cerrada: esto es para revisar. Las correcciones se hacen al cerrar la caja.</p>
          )}
          {issues === 0 && (
            <p className="text-[13px] font-semibold text-emerald-700 dark:text-emerald-300 flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4" /> Todo coincide: cada pago de Mercado Pago tiene su venta.
            </p>
          )}
          {result.otherTills.count > 0 && (
            <p className="text-[12px] text-slate-500">{result.otherTills.count} pago(s) por {fmt(result.otherTills.total)} son de ventas de otra caja y no se cuentan acá.</p>
          )}

          {result.unmatchedPayments.length > 0 && (
            <div className="space-y-2">
              <p className="text-[12px] font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">Pagos de Mercado Pago sin venta</p>
              {result.unmatchedPayments.map(({ payment: p, suggestions }) => (
                <div key={p.id} className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                  <p className="text-[13px] text-slate-800 dark:text-slate-100">
                    <b className="tabular-nums">{fmt(p.amount)}</b> a las {time(p.at)} · {CHANNEL[p.channel] || p.channel}
                    {p.method ? ` · ${p.method}` : ''}{p.last4 ? ` ****${p.last4}` : ''}
                    <span className="text-slate-400 text-[11.5px]"> · pago N° {p.id}</span>
                  </p>
                  {suggestions.length ? suggestions.map((s) => (
                    <div key={s.paymentRowId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-sky-50 dark:bg-sky-900/20 px-3 py-2">
                      <span className="text-[12.5px] text-sky-900 dark:text-sky-200">
                        ¿Es la venta <b>#{s.saleNumber}</b> de las {time(s.at)}, cargada como <b>{methodName(s.method)}</b>?
                      </span>
                      {!readOnly && <button
                        onClick={() => fix(s.paymentRowId, { paymentRowId: s.paymentRowId, action: 'toMp', mpPaymentId: p.id })}
                        disabled={!!busy}
                        className="h-8 px-3 rounded-lg bg-sky-600 hover:bg-sky-700 text-white text-[12px] font-bold disabled:opacity-60 inline-flex items-center gap-1.5"
                      >
                        {busy === s.paymentRowId && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Sí, pasarla a Mercado Pago
                      </button>}
                    </div>
                  )) : (
                    <p className="text-[12px] text-slate-500">No hay una venta del mismo monto cerca de esa hora. Puede ser una venta que no se registró, una anulada sin devolver el pago, o un cobro de otra cosa.</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {result.unmatchedSales.length > 0 && (
            <div className="space-y-2">
              <p className="text-[12px] font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">Ventas cargadas como Mercado Pago sin pago</p>
              {result.unmatchedSales.map((s) => (
                <div key={s.paymentRowId} className="rounded-xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[13px] text-slate-800 dark:text-slate-100">
                    Venta <b>#{s.saleNumber}</b> · <b className="tabular-nums">{fmt(s.amount)}</b> a las {time(s.at)}
                    {s.unconfirmed && <span className="ml-1.5 text-[11px] font-bold uppercase text-amber-700 bg-amber-100 dark:bg-amber-900/40 dark:text-amber-300 rounded px-1.5 py-0.5">sin confirmar</span>}
                    <span className="block text-[12px] text-slate-500">No llegó ningún pago de ese monto a Mercado Pago.{readOnly ? '' : ' ¿Con qué se cobró?'}</span>
                  </p>
                  {!readOnly && <div className="flex flex-wrap gap-1.5">
                    {otherMethods.map((m) => (
                      <button
                        key={m.id}
                        onClick={() => fix(s.paymentRowId + m.id, { paymentRowId: s.paymentRowId, action: 'fromMp', method: m.id })}
                        disabled={!!busy}
                        className="h-8 px-3 rounded-lg border border-slate-300 dark:border-slate-600 text-[12px] font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60 inline-flex items-center gap-1.5"
                      >
                        {busy === s.paymentRowId + m.id && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Fue {m.name}
                      </button>
                    ))}
                  </div>}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Control de Mercado Pago de una caja, para las pantallas del dueño. No muestra nada si MP no está conectado. */
export function MpSessionControl({ sessionId, readOnly = true }: { sessionId: string; readOnly?: boolean }) {
  const [posnets] = useState(readPosnets);
  const connected = useMpConnected();
  const data = useMpReconcile(sessionId, posnets, !!connected);
  if (!connected) return null;
  return <MpReconcilePanel data={data} posnets={posnets} readOnly={readOnly} />;
}
