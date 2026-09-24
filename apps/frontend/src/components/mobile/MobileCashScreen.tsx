import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Wallet, Lock, AlertTriangle, ChevronRight, CheckCircle2, History, FileText } from 'lucide-react';
import api from '../../services/api';
import { getClientId } from '../../utils/clientId';
import { ScreenHeader, Sheet, PrimaryButton, MoneyInput, EmptyState, ListSkeleton, money, parseAmount, METHOD_LABELS } from './ui';

const time = (d: string) => new Date(d).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
const dayTime = (d: string) => {
  const date = new Date(d);
  const today = new Date();
  const isToday = date.toDateString() === today.toDateString();
  return isToday ? `Hoy ${time(d)}` : `${date.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })} ${time(d)}`;
};

function movementTotals(session: any) {
  let income = 0, expense = 0, withdrawal = 0;
  for (const m of session.cashMovements || []) {
    if (m.type === 'INCOME') income += m.amount;
    else if (m.type === 'EXPENSE') expense += m.amount;
    else if (m.type === 'WITHDRAWAL') withdrawal += m.amount;
  }
  return { income, expense, withdrawal };
}

const parseJson = (v: any) => {
  if (!v) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return null; }
};

/** Medios de pago con monto, de mayor a menor */
const methodEntries = (b: Record<string, any> | null | undefined) =>
  Object.entries(b || {}).map(([k, v]) => [k, Number(v) || 0] as [string, number]).filter(([, v]) => Math.abs(v) >= 0.01).sort((a, b) => b[1] - a[1]);

const X_PAGE = 30;
const Z_PAGE = 20;

/**
 * Cajas y cierres en el celular: cajas abiertas con su efectivo, cierre con arqueo y
 * el historial completo, por turno (Cierre X) o por día (Cierre Z).
 */
export default function MobileCashScreen() {
  const [active, setActive] = useState<any[] | null>(null);
  const [pending, setPending] = useState<any[]>([]);
  const [tab, setTab] = useState<'X' | 'Z'>('X');
  const [xList, setXList] = useState<any[]>([]);
  const [zList, setZList] = useState<any[]>([]);
  const [moreX, setMoreX] = useState(false);
  const [moreZ, setMoreZ] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<any | null>(null);
  const [closing, setClosing] = useState<{ session: any; mode: 'close' | 'arqueo' } | null>(null);
  const [historyItem, setHistoryItem] = useState<any | null>(null);
  const [zItem, setZItem] = useState<any | null>(null);

  const load = useCallback(async () => {
    const [a, p, x, z] = await Promise.all([
      api.get('/cash/active').then((r) => r.data || []).catch(() => []),
      api.get('/cash/pending-arqueos/all').then((r) => r.data || []).catch(() => []),
      api.get('/cash/history', { params: { limit: X_PAGE, skip: 0 } }).then((r) => r.data || []).catch(() => []),
      api.get('/cash/z-reports', { params: { limit: Z_PAGE, skip: 0 } }).then((r) => r.data || []).catch(() => []),
    ]);
    setActive(a);
    setPending(p);
    setXList(x); setMoreX(x.length === X_PAGE);
    setZList(z); setMoreZ(z.length === Z_PAGE);
  }, []);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      if (tab === 'X') {
        const { data } = await api.get('/cash/history', { params: { limit: X_PAGE, skip: xList.length } });
        const page = data || [];
        setXList((l) => [...l, ...page.filter((s: any) => !l.some((o) => o.id === s.id))]);
        setMoreX(page.length === X_PAGE);
      } else {
        const { data } = await api.get('/cash/z-reports', { params: { limit: Z_PAGE, skip: zList.length } });
        const page = data || [];
        setZList((l) => [...l, ...page.filter((r: any) => !l.some((o) => o.id === r.id))]);
        setMoreZ(page.length === Z_PAGE);
      }
    } catch {
      toast.error('No se pudieron cargar más cierres');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => { load(); }, [load]);

  const totalCash = (active || []).reduce((s, x) => s + (x.expectedAmount || 0), 0);

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ScreenHeader back title="Cajas" subtitle={active ? `${active.length} ${active.length === 1 ? 'abierta' : 'abiertas'}` : 'Cargando…'}>
        <div className="rounded-2xl bg-white/10 ring-1 ring-inset ring-white/15 px-4 py-3">
          <p className="text-[12px] text-rose-100">Efectivo en las cajas abiertas</p>
          <p className="text-[26px] font-bold tabular-nums tracking-tight">{money(totalCash)}</p>
        </div>
      </ScreenHeader>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-5">
        {active === null ? <ListSkeleton rows={3} /> : (
          <>
            {pending.length > 0 && (
              <section>
                <SectionTitle>Arqueos pendientes</SectionTitle>
                <div className="space-y-2">
                  {pending.map((s) => (
                    <button key={s.id} onClick={() => setClosing({ session: s, mode: 'arqueo' })} className="w-full text-left bg-amber-50 border border-amber-200 rounded-2xl p-4 flex items-center gap-3 active:scale-[0.99] transition-transform">
                      <span className="w-10 h-10 rounded-xl bg-amber-100 flex items-center justify-center shrink-0"><AlertTriangle className="w-5 h-5 text-amber-700" /></span>
                      <span className="flex-1 min-w-0">
                        <span className="block text-[14px] font-semibold text-amber-900">{s.terminalName} · {s.user?.fullName}</span>
                        <span className="block text-[12px] text-amber-800">Cerrada sin contar el efectivo. Tocá para hacer el arqueo.</span>
                      </span>
                      <ChevronRight className="w-4 h-4 text-amber-700" />
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section>
              <SectionTitle>Abiertas</SectionTitle>
              {active.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200/80">
                  <EmptyState icon={Wallet} title="No hay cajas abiertas" text="Cuando alguien abra una caja, la vas a ver acá con su efectivo en vivo." />
                </div>
              ) : (
                <div className="space-y-3">
                  {active.map((s) => {
                    const b = s.paymentsBreakdown || {};
                    const other = Object.entries(b).filter(([k, v]) => k !== 'CASH' && (v as number) > 0) as [string, number][];
                    return (
                      <button key={s.id} onClick={() => setSelected(s)} className="w-full text-left bg-white rounded-2xl border border-slate-200/80 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] active:scale-[0.99] transition-transform">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="text-[15px] font-semibold text-slate-900">{s.terminalName}</p>
                            <p className="text-[12px] text-slate-500">{s.user?.fullName} · desde {dayTime(s.openedAt)}</p>
                          </div>
                          <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full shrink-0">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Abierta
                          </span>
                        </div>
                        <p className="mt-3 text-[12px] text-slate-500">Efectivo esperado</p>
                        <p className="text-[24px] font-bold text-slate-900 tabular-nums tracking-tight">{money(s.expectedAmount)}</p>
                        {other.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {other.map(([k, v]) => (
                              <span key={k} className="text-[11.5px] font-medium text-slate-600 bg-slate-100 px-2 py-1 rounded-lg">{METHOD_LABELS[k] || k} {money(v)}</span>
                            ))}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </section>

            <section>
              <div className="mb-3 grid grid-cols-2 gap-1 rounded-2xl bg-slate-200/70 p-1">
                {([['X', 'Cierres X', 'por turno'], ['Z', 'Cierres Z', 'del día']] as const).map(([id, label, hint]) => (
                  <button
                    key={id}
                    onClick={() => setTab(id)}
                    className={`h-11 rounded-xl text-[13.5px] font-semibold transition-colors ${tab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 active:bg-white/50'}`}
                  >
                    {label} <span className={`font-normal ${tab === id ? 'text-slate-500' : 'text-slate-400'}`}>· {hint}</span>
                  </button>
                ))}
              </div>
              {tab === 'X' ? (
                xList.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-slate-200/80">
                    <EmptyState icon={History} title="Todavía no hay turnos cerrados" text="Cada vez que se cierra una caja (Cierre X) aparece acá." />
                  </div>
                ) : (
                  <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
                    {xList.map((s) => <XRow key={s.id} s={s} onClick={() => setHistoryItem(s)} />)}
                  </div>
                )
              ) : zList.length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200/80">
                  <EmptyState icon={FileText} title="Todavía no hay Cierres Z" text="El Cierre Z es el cierre final del día: junta todos los turnos. Se genera desde la PC." />
                </div>
              ) : (
                <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
                  {zList.map((r) => <ZRow key={r.id} r={r} onClick={() => setZItem(r)} />)}
                </div>
              )}
              {(tab === 'X' ? moreX : moreZ) && (
                <button onClick={loadMore} disabled={loadingMore} className="mt-3 w-full h-11 rounded-2xl bg-white border border-slate-200 text-[14px] font-semibold text-slate-700 active:bg-slate-50 disabled:opacity-60">
                  {loadingMore ? 'Cargando…' : 'Ver más'}
                </button>
              )}
            </section>
          </>
        )}
      </div>

      <SessionSheet session={selected} onClose={() => setSelected(null)} onCloseCash={(s) => { setSelected(null); setClosing({ session: s, mode: 'close' }); }} />
      <CloseSheet data={closing} onClose={() => setClosing(null)} onDone={() => { setClosing(null); load(); }} />
      <HistorySheet session={historyItem} onClose={() => setHistoryItem(null)} />
      <ZSheet report={zItem} onClose={() => setZItem(null)} onOpenSession={(s) => { setZItem(null); setHistoryItem(s); }} />
    </div>
  );
}

function XRow({ s, onClick }: { s: any; onClick: () => void }) {
  const counted = s.closingAmountCounted !== null && s.closingAmountCounted !== undefined;
  const diff = s.difference ?? ((s.closingAmountCounted ?? 0) - (s.closingAmountExpected ?? 0));
  const ok = counted && Math.abs(diff) < 1;
  const revenue = parseJson(s.closingSummary)?.totalRevenue;
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-slate-50">
      <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${!counted ? 'bg-amber-50' : ok ? 'bg-emerald-50' : 'bg-red-50'}`}>
        {!counted ? <AlertTriangle className="w-[18px] h-[18px] text-amber-600" /> : ok ? <CheckCircle2 className="w-[18px] h-[18px] text-emerald-600" /> : <History className="w-[18px] h-[18px] text-red-600" />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] font-medium text-slate-800 truncate">{s.terminalName} · {s.user?.fullName}</span>
        <span className="block text-[12px] text-slate-500 truncate">
          {s.closedAt ? dayTime(s.closedAt) : dayTime(s.openedAt)}{typeof revenue === 'number' ? ` · vendió ${money(revenue)}` : ''}
        </span>
      </span>
      <span className="text-right shrink-0">
        <span className="block text-[14px] font-semibold text-slate-900 tabular-nums">{counted ? money(s.closingAmountCounted) : money(s.closingAmountExpected ?? 0)}</span>
        <span className={`block text-[11.5px] font-medium tabular-nums ${!counted ? 'text-amber-600' : ok ? 'text-emerald-600' : diff > 0 ? 'text-amber-600' : 'text-red-600'}`}>
          {!counted ? 'Falta arqueo' : ok ? 'Sin diferencia' : `${diff > 0 ? 'Sobran' : 'Faltan'} ${money(Math.abs(diff))}`}
        </span>
      </span>
    </button>
  );
}

function ZRow({ r, onClick }: { r: any; onClick: () => void }) {
  const sum = parseJson(r.summary) || {};
  const turns = sum.sessionCount ?? r.sessions?.length ?? 0;
  const diff = r.differenceTotal ?? 0;
  const ok = Math.abs(diff) < 1;
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3 text-left active:bg-slate-50">
      <span className="w-9 h-9 rounded-xl bg-rose-50 flex items-center justify-center shrink-0"><FileText className="w-[18px] h-[18px] text-rose-600" /></span>
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] font-medium text-slate-800 truncate">Cierre Z · {dayTime(r.generatedAt)}</span>
        <span className="block text-[12px] text-slate-500 truncate">{turns} {turns === 1 ? 'turno' : 'turnos'} · {r.generatedBy?.fullName || ''}</span>
      </span>
      <span className="text-right shrink-0">
        <span className="block text-[14px] font-semibold text-slate-900 tabular-nums">{money(r.totalDeclared)}</span>
        <span className={`block text-[11.5px] font-medium tabular-nums ${ok ? 'text-emerald-600' : diff > 0 ? 'text-amber-600' : 'text-red-600'}`}>
          {ok ? 'Sin diferencia' : `${diff > 0 ? 'Sobran' : 'Faltan'} ${money(Math.abs(diff))}`}
        </span>
      </span>
    </button>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] font-semibold text-slate-500 px-1 mb-2">{children}</p>;
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-[14px]">
      <span className="text-slate-600">{label}</span>
      <span className={`font-semibold tabular-nums ${tone || 'text-slate-900'}`}>{value}</span>
    </div>
  );
}

function SessionSheet({ session: s, onClose, onCloseCash }: { session: any | null; onClose: () => void; onCloseCash: (s: any) => void }) {
  const m = s ? movementTotals(s) : { income: 0, expense: 0, withdrawal: 0 };
  const b = s?.paymentsBreakdown || {};
  return (
    <Sheet
      open={!!s}
      onClose={onClose}
      title={s?.terminalName}
      footer={s ? <PrimaryButton onClick={() => onCloseCash(s)}><Lock className="w-4 h-4" /> Cerrar caja</PrimaryButton> : undefined}
    >
      {s && (
        <div className="space-y-4 pt-1">
          <p className="text-[13px] text-slate-500">{s.user?.fullName} · abierta {dayTime(s.openedAt)}</p>
          <div className="rounded-2xl bg-rose-50 px-4 py-3">
            <p className="text-[12px] text-rose-800">Efectivo que debería haber</p>
            <p className="text-[28px] font-bold text-rose-800 tabular-nums tracking-tight">{money(s.expectedAmount)}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 px-4 py-2 divide-y divide-slate-100">
            <Row label="Inicio de caja" value={money(s.openingAmount)} />
            <Row label="Ventas en efectivo" value={`+ ${money(b.CASH || 0)}`} tone="text-emerald-700" />
            {m.income > 0 && <Row label="Ingresos" value={`+ ${money(m.income)}`} tone="text-emerald-700" />}
            {m.expense > 0 && <Row label="Gastos" value={`− ${money(m.expense)}`} tone="text-red-600" />}
            {m.withdrawal > 0 && <Row label="Retiros" value={`− ${money(m.withdrawal)}`} tone="text-red-600" />}
          </div>
          {Object.entries(b).some(([k, v]) => k !== 'CASH' && (v as number) > 0) && (
            <div>
              <p className="text-[12.5px] font-semibold text-slate-500 mb-2">Otros cobros (no están en el cajón)</p>
              <div className="rounded-2xl bg-slate-50 px-4 py-2">
                {Object.entries(b).filter(([k, v]) => k !== 'CASH' && (v as number) > 0).map(([k, v]) => (
                  <Row key={k} label={METHOD_LABELS[k] || k} value={money(v as number)} />
                ))}
              </div>
            </div>
          )}
          {(s.cashMovements || []).length > 0 && (
            <div>
              <p className="text-[12.5px] font-semibold text-slate-500 mb-2">Movimientos de caja</p>
              <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
                {s.cashMovements.map((mv: any) => (
                  <div key={mv.id} className="flex items-center justify-between px-4 py-2.5 text-[13.5px]">
                    <span className="min-w-0">
                      <span className="block text-slate-800 truncate">{mv.description || (mv.type === 'INCOME' ? 'Ingreso' : mv.type === 'WITHDRAWAL' ? 'Retiro' : 'Gasto')}</span>
                      <span className="block text-[11.5px] text-slate-500">{time(mv.createdAt)}</span>
                    </span>
                    <span className={`font-semibold tabular-nums ${mv.type === 'INCOME' ? 'text-emerald-700' : 'text-red-600'}`}>
                      {mv.type === 'INCOME' ? '+' : '−'}{money(mv.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

function CloseSheet({ data, onClose, onDone }: { data: { session: any; mode: 'close' | 'arqueo' } | null; onClose: () => void; onDone: () => void }) {
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setCounted(''); setNotes(''); }, [data]);

  const s = data?.session;
  const expected = s ? (s.expectedAmount ?? s.closingAmountExpected ?? 0) : 0;
  const value = parseAmount(counted);
  const diff = counted === '' ? null : value - expected;

  const confirm = async () => {
    if (!s) return;
    setBusy(true);
    try {
      if (data!.mode === 'close') {
        await api.post(`/cash/${s.id}/close`, { clientId: getClientId(), closingAmountCounted: value, closingNotes: notes });
        toast.success(`Caja ${s.terminalName} cerrada`);
      } else {
        await api.post(`/cash/${s.id}/arqueo`, { closingAmountCounted: value, closingNotes: notes });
        toast.success('Arqueo completado');
      }
      onDone();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo completar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open={!!data}
      onClose={onClose}
      title={data?.mode === 'arqueo' ? 'Arqueo de caja' : `Cerrar ${s?.terminalName || 'caja'}`}
      footer={<PrimaryButton onClick={confirm} loading={busy} disabled={counted === ''}>{data?.mode === 'arqueo' ? 'Guardar arqueo' : 'Cerrar caja'}</PrimaryButton>}
    >
      {s && (
        <div className="space-y-4 pt-1">
          {data!.mode === 'close' && (
            <div className="flex items-center justify-between rounded-2xl bg-slate-50 px-4 py-3">
              <span className="text-[13.5px] text-slate-600">Debería haber</span>
              <span className="text-[18px] font-bold text-slate-900 tabular-nums">{money(expected)}</span>
            </div>
          )}
          <div>
            <p className="mb-2 text-[12.5px] font-medium text-slate-500">¿Cuánto efectivo hay en el cajón?</p>
            <MoneyInput value={counted} onChange={setCounted} autoFocus />
          </div>
          {diff !== null && data!.mode === 'close' && (
            <div className={`rounded-2xl px-4 py-3 flex items-center justify-between ${Math.abs(diff) < 1 ? 'bg-emerald-50 text-emerald-800' : diff > 0 ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700'}`}>
              <span className="text-[14px] font-medium">{Math.abs(diff) < 1 ? 'Coincide' : diff > 0 ? 'Sobra' : 'Falta'}</span>
              <span className="text-[18px] font-bold tabular-nums">{money(Math.abs(diff))}</span>
            </div>
          )}
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Nota (opcional): diferencias, retiros, etc."
            className="w-full min-h-[80px] rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3 text-[14px] outline-none focus:border-rose-500 focus:bg-white"
          />
        </div>
      )}
    </Sheet>
  );
}

function DiffRow({ diff }: { diff: number }) {
  const ok = Math.abs(diff) < 1;
  return (
    <Row
      label="Diferencia"
      value={ok ? 'Sin diferencia' : `${diff > 0 ? '+' : '−'}${money(Math.abs(diff))}`}
      tone={ok ? 'text-emerald-600' : diff > 0 ? 'text-amber-600' : 'text-red-600'}
    />
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[12.5px] font-semibold text-slate-500 mb-2">{title}</p>
      <div className="rounded-2xl border border-slate-200 px-4 py-2 divide-y divide-slate-100">{children}</div>
    </div>
  );
}

/** Detalle de un turno cerrado (Cierre X). */
function HistorySheet({ session: s, onClose }: { session: any | null; onClose: () => void }) {
  const sum = s ? parseJson(s.closingSummary) || {} : {};
  const m = s ? movementTotals(s) : { income: 0, expense: 0, withdrawal: 0 };
  const income = sum.cashIncome ?? m.income;
  const expense = sum.cashExpense ?? m.expense;
  const withdrawal = sum.cashWithdrawal ?? m.withdrawal;
  const counted = !!s && s.closingAmountCounted !== null && s.closingAmountCounted !== undefined;
  const diff = s ? (s.difference ?? ((s.closingAmountCounted ?? 0) - (s.closingAmountExpected ?? 0))) : 0;
  const methods = methodEntries(sum.paymentBreakdown);
  const opening = sum.openingAmount ?? s?.openingAmount;
  const notes = s?.closingNotes ? String(s.closingNotes).split('[METADATA]')[0].trim() : '';
  return (
    <Sheet open={!!s} onClose={onClose} title={s ? `Cierre X · ${s.terminalName}` : ''}>
      {s && (
        <div className="space-y-4 pt-1">
          <div>
            <p className="text-[13px] text-slate-600 font-medium">{s.user?.fullName}</p>
            <p className="text-[12.5px] text-slate-500">Abierta {dayTime(s.openedAt)}{s.closedAt ? ` · cerrada ${dayTime(s.closedAt)}` : ''}</p>
            <p className={`mt-1 text-[12px] font-medium ${s.zReportId ? 'text-slate-500' : 'text-amber-700'}`}>{s.zReportId ? 'Incluido en un Cierre Z' : 'Pendiente de Cierre Z'}</p>
          </div>

          {typeof sum.totalRevenue === 'number' && (
            <div className="rounded-2xl bg-rose-50 px-4 py-3">
              <p className="text-[12px] text-rose-800">Vendido en el turno{typeof sum.totalSales === 'number' ? ` · ${sum.totalSales} ${sum.totalSales === 1 ? 'venta' : 'ventas'}` : ''}</p>
              <p className="text-[26px] font-bold text-rose-800 tabular-nums tracking-tight">{money(sum.totalRevenue)}</p>
            </div>
          )}

          {methods.length > 0 && (
            <Block title="Por medio de pago">
              {methods.map(([k, v]) => <Row key={k} label={METHOD_LABELS[k] || k} value={money(v)} />)}
            </Block>
          )}

          <Block title="Efectivo">
            {typeof opening === 'number' && <Row label="Inicio de caja" value={money(opening)} />}
            {sum.paymentBreakdown?.CASH !== undefined && <Row label="Ventas en efectivo" value={`+ ${money(sum.paymentBreakdown.CASH)}`} tone="text-emerald-700" />}
            {income > 0 && <Row label="Ingresos" value={`+ ${money(income)}`} tone="text-emerald-700" />}
            {expense > 0 && <Row label="Gastos" value={`− ${money(expense)}`} tone="text-red-600" />}
            {withdrawal > 0 && <Row label="Retiros" value={`− ${money(withdrawal)}`} tone="text-red-600" />}
            <Row label="Debía haber" value={money(s.closingAmountExpected ?? 0)} />
            {counted ? (
              <>
                <Row label="Se contó" value={money(s.closingAmountCounted)} />
                <DiffRow diff={diff} />
              </>
            ) : (
              <Row label="Se contó" value="Falta arqueo" tone="text-amber-600" />
            )}
          </Block>

          {(s.cashMovements || []).length > 0 && (
            <Block title="Movimientos de caja">
              {s.cashMovements.map((mv: any) => (
                <div key={mv.id} className="flex items-center justify-between py-2 text-[13.5px]">
                  <span className="min-w-0">
                    <span className="block text-slate-800 truncate">{mv.description || (mv.type === 'INCOME' ? 'Ingreso' : mv.type === 'WITHDRAWAL' ? 'Retiro' : 'Gasto')}</span>
                    <span className="block text-[11.5px] text-slate-500">{time(mv.createdAt)}</span>
                  </span>
                  <span className={`font-semibold tabular-nums ${mv.type === 'INCOME' ? 'text-emerald-700' : 'text-red-600'}`}>
                    {mv.type === 'INCOME' ? '+' : '−'}{money(mv.amount)}
                  </span>
                </div>
              ))}
            </Block>
          )}

          {notes && <p className="rounded-2xl bg-slate-50 px-4 py-3 text-[13.5px] text-slate-700 whitespace-pre-line">{notes}</p>}
        </div>
      )}
    </Sheet>
  );
}

/** Detalle de un Cierre Z: el día completo, con todos sus turnos. */
function ZSheet({ report: r, onClose, onOpenSession }: { report: any | null; onClose: () => void; onOpenSession: (s: any) => void }) {
  const sum = r ? parseJson(r.summary) || {} : {};
  const methods = methodEntries(sum.paymentBreakdown);
  const declared = sum.posnetDeclarations || {};
  const sold = methods.reduce((t, [, v]) => t + v, 0);
  const sessions: any[] = r?.sessions?.length ? r.sessions : sum.sessions || [];
  return (
    <Sheet open={!!r} onClose={onClose} title={r ? `Cierre Z · ${dayTime(r.generatedAt)}` : ''}>
      {r && (
        <div className="space-y-4 pt-1">
          <p className="text-[13px] text-slate-500">Generado por {r.generatedBy?.fullName || '—'} · {sessions.length} {sessions.length === 1 ? 'turno' : 'turnos'}</p>

          <div className="rounded-2xl bg-rose-50 px-4 py-3">
            <p className="text-[12px] text-rose-800">Vendido en el día</p>
            <p className="text-[26px] font-bold text-rose-800 tabular-nums tracking-tight">{money(sold)}</p>
          </div>

          <Block title="Totales">
            <Row label="Esperado" value={money(r.totalExpected)} />
            <Row label="Declarado" value={money(r.totalDeclared)} />
            <DiffRow diff={r.differenceTotal ?? 0} />
          </Block>

          {methods.length > 0 && (
            <Block title="Por medio de pago">
              {methods.map(([k, v]) => (
                <Row
                  key={k}
                  label={METHOD_LABELS[k] || k}
                  value={k !== 'CASH' && k !== 'DEBT' && declared[k] !== undefined && Math.abs((Number(declared[k]) || 0) - v) >= 1
                    ? `${money(v)} · declarado ${money(Number(declared[k]) || 0)}`
                    : money(v)}
                />
              ))}
            </Block>
          )}

          <Block title="Efectivo">
            {typeof sum.totalCashExpected === 'number' && <Row label="Debía haber" value={money(sum.totalCashExpected)} />}
            {typeof sum.totalCashCounted === 'number' && <Row label="Se contó" value={money(sum.totalCashCounted)} />}
            {typeof sum.totalCashDifference === 'number' && <DiffRow diff={sum.totalCashDifference} />}
            {(sum.cashIncome || 0) > 0 && <Row label="Ingresos" value={`+ ${money(sum.cashIncome)}`} tone="text-emerald-700" />}
            {(sum.cashExpense || 0) > 0 && <Row label="Gastos" value={`− ${money(sum.cashExpense)}`} tone="text-red-600" />}
            {(sum.cashWithdrawal || 0) > 0 && <Row label="Retiros" value={`− ${money(sum.cashWithdrawal)}`} tone="text-red-600" />}
          </Block>

          {sessions.length > 0 && (
            <div>
              <p className="text-[12.5px] font-semibold text-slate-500 mb-2">Turnos del día (Cierres X)</p>
              <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                {sessions.map((s) => <XRow key={s.id} s={s} onClick={() => onOpenSession(s)} />)}
              </div>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
