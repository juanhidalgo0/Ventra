import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, Loader2, X, Check, Landmark, Wallet, Smartphone } from 'lucide-react';
import api from '../../services/api';
import { setStoreSetting } from '../../services/storeSettings';
import { useFeature } from '../../stores/businessStore';

const money = (n: number) => `$ ${(Math.round((n || 0) * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const keyOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const parse = (v: string) => Number(String(v).replace(/\./g, '').replace(',', '.'));
const SOURCE_LABEL: Record<string, string> = { FUND: 'de la caja del mes', SESSION: 'de una caja', TRANSFER: 'por transferencia' };

/**
 * Comisiones de los vendedores, mes por mes: cuánto le corresponde a cada uno (su % de lo que
 * el cliente recibió en los repartos rendidos ese mes), lo que ya se le pagó y lo que falta.
 * Solo el dueño. Cada vendedor puede tener su % o usar el general.
 */
export default function CommissionsPanel() {
  const usesFund = useFeature('monthfund');
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [data, setData] = useState<any | null>(null);
  const [general, setGeneral] = useState(() => localStorage.getItem('seller_commission_pct') || '');
  const [paying, setPaying] = useState<any | null>(null);
  const key = keyOf(month);

  const load = useCallback(() => {
    api.get('/preorders/commissions', { params: { month: key } }).then((r) => setData(r.data)).catch((err) => {
      setData(false);
      if (err?.response?.status === 403) toast.error('Las comisiones las maneja el dueño');
    });
  }, [key]);
  useEffect(() => { setData(null); load(); }, [load]);

  // El % general se guarda en los ajustes compartidos; el servidor lo lee al calcular
  const saveGeneral = (v: string) => {
    setGeneral(v);
    setStoreSetting('seller_commission_pct', v);
    window.clearTimeout((saveGeneral as any).t);
    (saveGeneral as any).t = window.setTimeout(load, 1200);
  };

  const setOwn = async (s: any, v: string) => {
    try {
      await api.put(`/preorders/commissions/${s.userId}/pct`, { pct: v });
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo guardar el %');
    }
  };

  const now = new Date();
  const isCurrent = key === keyOf(now);
  const card = 'rounded-2xl bg-white border border-slate-200';

  return (
    <div className="space-y-3">
      <div className={`${card} p-3 flex items-center gap-2`}>
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="w-10 h-10 rounded-xl hover:bg-slate-100 flex items-center justify-center cursor-pointer" aria-label="Mes anterior"><ChevronLeft className="w-5 h-5 text-slate-600" /></button>
        <p className="flex-1 text-center text-[15px] font-bold text-slate-900 capitalize">{MONTHS[month.getMonth()]} {month.getFullYear()}</p>
        <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} disabled={isCurrent} className="w-10 h-10 rounded-xl hover:bg-slate-100 disabled:opacity-30 flex items-center justify-center cursor-pointer" aria-label="Mes siguiente"><ChevronRight className="w-5 h-5 text-slate-600" /></button>
      </div>

      <div className={`${card} p-4 flex flex-wrap items-center gap-3`}>
        <label htmlFor="comision-general" className="text-[14px] font-semibold text-slate-800">Comisión general</label>
        <div className="flex items-center gap-1.5">
          <input id="comision-general" inputMode="decimal" value={general} onChange={(e) => saveGeneral(e.target.value)} placeholder="0"
            className="w-20 h-10 px-3 rounded-xl border border-slate-300 text-[15px] text-right outline-none focus:border-rose-500" />
          <span className="text-[14px] text-slate-600">% de lo entregado</span>
        </div>
        <p className="w-full text-[12.5px] text-slate-500">Vale para los vendedores que no tienen un % propio. Cuenta lo que el cliente recibió en los repartos rendidos en el mes: lo rechazado no suma.</p>
      </div>

      {data === null ? (
        <div className="py-12 flex justify-center"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
      ) : data === false ? (
        <p className="text-center text-[14px] text-slate-500 py-10">No se pudieron traer las comisiones.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {([['Corresponde', data.totals.commission, 'text-slate-900'], ['Pagado', data.totals.paid, 'text-emerald-700'], ['Falta pagar', data.totals.owed, data.totals.owed > 0 ? 'text-rose-700' : 'text-slate-900']] as const).map(([l, v, tone]) => (
              <div key={l} className={`${card} px-3 py-3`}>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{l}</p>
                <p className={`text-[17px] font-bold tabular-nums ${tone}`}>{money(v)}</p>
              </div>
            ))}
          </div>

          {data.sellers.length === 0 ? (
            <p className="text-center text-[14px] text-slate-500 py-10">No hay vendedores. Ponele el trabajo "Vendedor" a cada uno en Usuarios.</p>
          ) : (
            <div className={`${card} divide-y divide-slate-100`}>
              {data.sellers.map((s: any) => (
                <div key={s.userId} className="px-4 py-3 space-y-2">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] font-semibold text-slate-900 truncate">{s.name}</p>
                      <p className="text-[12.5px] text-slate-500">{s.orders} {s.orders === 1 ? 'pedido entregado' : 'pedidos entregados'} · {money(s.delivered)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[16px] font-bold text-slate-900 tabular-nums">{money(s.commission)}</p>
                      <p className={`text-[12px] font-semibold ${s.owed > 0.009 ? 'text-rose-700' : s.commission > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                        {s.owed > 0.009 ? `Falta ${money(s.owed)}` : s.commission > 0 ? 'Pagado' : 'Sin comisión'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <OwnPct seller={s} general={data.generalPct} onSave={(v) => setOwn(s, v)} />
                    <span className="flex-1" />
                    {s.owed > 0.009 && (
                      <button onClick={() => setPaying(s)} className="h-9 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-[13.5px] font-bold cursor-pointer">Pagar</button>
                    )}
                  </div>
                  {s.payments.length > 0 && (
                    <div className="rounded-xl bg-slate-50 px-3 py-2 space-y-0.5">
                      {s.payments.map((p: any) => (
                        <p key={p.id} className="text-[12.5px] text-slate-600 flex justify-between gap-2">
                          <span className="truncate">{new Date(p.at).toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric' })} · {SOURCE_LABEL[p.source] || p.source}{p.by ? ` · ${p.by}` : ''}{p.notes ? ` · ${p.notes}` : ''}</span>
                          <span className="font-semibold tabular-nums shrink-0">{money(p.amount)}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {paying && <PaySheet seller={paying} month={key} monthLabel={`${MONTHS[month.getMonth()]} ${month.getFullYear()}`} usesFund={usesFund}
        onClose={() => setPaying(null)} onDone={(d) => { setPaying(null); setData(d); }} />}
    </div>
  );
}

/** % propio del vendedor: vacío = el general */
function OwnPct({ seller, general, onSave }: { seller: any; general: number; onSave: (v: string) => void }) {
  const [v, setV] = useState(seller.ownPct == null ? '' : String(seller.ownPct));
  useEffect(() => { setV(seller.ownPct == null ? '' : String(seller.ownPct)); }, [seller.ownPct]);
  const commit = () => {
    const now = seller.ownPct == null ? '' : String(seller.ownPct);
    if (v.trim() !== now) onSave(v.trim());
  };
  return (
    <label className="flex items-center gap-1.5 text-[13px] text-slate-600">
      <span>Su %</span>
      <input inputMode="decimal" value={v} onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        placeholder={String(general || 0)} aria-label={`Comisión de ${seller.name}`}
        className="w-16 h-9 px-2 rounded-lg border border-slate-300 text-[14px] text-right outline-none focus:border-rose-500" />
      <span className="text-[12px] text-slate-400">{seller.ownPct == null ? '(el general)' : ''}</span>
    </label>
  );
}

/** Pagarle al vendedor: cuánto y de dónde sale la plata */
function PaySheet({ seller, month, monthLabel, usesFund, onClose, onDone }: { seller: any; month: string; monthLabel: string; usesFund: boolean; onClose: () => void; onDone: (data: any) => void }) {
  const [amount, setAmount] = useState(String(seller.owed));
  const [source, setSource] = useState<'FUND' | 'SESSION' | 'TRANSFER'>(usesFund ? 'FUND' : 'SESSION');
  const [sessions, setSessions] = useState<any[] | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const value = parse(amount);

  useEffect(() => {
    api.get('/sales/owner-summary', { params: { period: 'month' } }).then((r) => {
      const list = r.data?.openSessions || [];
      setSessions(list);
      setSessionId(list[0]?.id || '');
      if (!usesFund && !list.length) setSource('TRANSFER');
    }).catch(() => setSessions([]));
  }, []);

  const save = async () => {
    if (!(value > 0)) { toast.error('Ingresá cuánto le pagás'); return; }
    if (source === 'SESSION' && !sessionId) { toast.error('Elegí la caja'); return; }
    setBusy(true);
    try {
      const { data } = await api.post('/preorders/commissions/pay', { userId: seller.userId, month, amount: value, source, sessionId: source === 'SESSION' ? sessionId : undefined, notes });
      toast.success(`Pago a ${seller.name} registrado`);
      onDone(data);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo registrar el pago');
    } finally {
      setBusy(false);
    }
  };

  const options: [typeof source, string, string, any, boolean][] = [
    ['FUND', 'Efectivo de la caja del mes', 'Sale de la plata guardada (Tesorería).', Landmark, usesFund],
    ['SESSION', 'Efectivo de una caja abierta', 'Queda como gasto del turno: el cajón tiene que tener menos.', Wallet, true],
    ['TRANSFER', 'Transferencia', 'No sale de ninguna caja: solo queda anotado.', Smartphone, true],
  ];

  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Pagar a ${seller.name}`} className="w-full sm:max-w-md max-h-[92vh] overflow-y-auto bg-white rounded-t-3xl sm:rounded-3xl p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <p className="text-[17px] font-bold text-slate-900">Pagar a {seller.name}</p>
            <p className="text-[13px] text-slate-500">Comisión de {monthLabel}: le corresponden {money(seller.commission)}{seller.paid > 0 ? `, ya cobró ${money(seller.paid)}` : ''}.</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-lg hover:bg-slate-100 flex items-center justify-center cursor-pointer" aria-label="Cerrar"><X className="w-4 h-4 text-slate-500" /></button>
        </div>

        <div>
          <label htmlFor="pago-comision" className="block text-[13px] font-bold text-slate-700 mb-1">¿Cuánto le pagás?</label>
          <input id="pago-comision" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus
            className="w-full h-12 px-4 rounded-xl bg-white border border-slate-300 text-[18px] font-bold outline-none focus:border-rose-500" />
          {value > 0 && value < seller.owed - 0.009 && <p className="text-[12.5px] text-slate-500 mt-1">Le quedan {money(seller.owed - value)} para otro pago.</p>}
        </div>

        <div className="space-y-2">
          <p className="text-[13px] font-bold text-slate-700">¿De dónde sale la plata?</p>
          {options.filter((o) => o[4]).map(([k, l, h, Icon]) => {
            const disabled = k === 'SESSION' && sessions !== null && !sessions.length;
            return (
              <button key={k} onClick={() => !disabled && setSource(k)} disabled={disabled}
                className={`w-full text-left px-4 py-3 rounded-2xl border-2 flex items-center gap-3 cursor-pointer disabled:opacity-50 disabled:cursor-default ${source === k ? 'border-rose-600 bg-rose-50/70' : 'border-slate-200 bg-white'}`}>
                <Icon className="w-5 h-5 text-slate-600 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] font-bold text-slate-900">{l}</span>
                  <span className="block text-[12.5px] text-slate-500">{disabled ? 'No hay cajas abiertas ahora.' : h}</span>
                </span>
                {source === k && <Check className="w-5 h-5 text-rose-600 shrink-0" />}
              </button>
            );
          })}
          {source === 'SESSION' && (sessions || []).length > 1 && (
            <div className="grid grid-cols-1 gap-2 pl-2">
              {sessions!.map((s) => (
                <button key={s.id} onClick={() => setSessionId(s.id)} className={`h-11 px-3.5 rounded-xl border text-left flex items-center justify-between cursor-pointer ${sessionId === s.id ? 'border-rose-600 bg-rose-50' : 'border-slate-200 bg-white'}`}>
                  <span className="text-[14px] font-medium text-slate-800">{s.terminalName}</span>
                  <span className="text-[12.5px] text-slate-500 tabular-nums">{money(s.expectedCash)}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Nota (opcional)" maxLength={200}
          className="w-full h-11 px-3.5 rounded-xl border border-slate-300 text-[14px] outline-none focus:border-rose-500" />

        <button onClick={save} disabled={busy || !(value > 0)} className="w-full h-12 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-[15px] font-bold cursor-pointer flex items-center justify-center gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Registrar el pago {value > 0 ? money(value) : ''}
        </button>
      </div>
    </div>
  );
}
