import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Banknote, Clock } from 'lucide-react';
import { useOnlineOrders, startOnlineOrdersSync } from '../../services/onlineStoreOrders';
import { subscribeBookings, localNow, addDays, weekday, dayLabel, hhmm, PAY_METHODS, type Booking } from '../../services/agenda';
import { usePlanStore, isAgendaOnly } from '../../stores/planStore';
import { useOwnerMobile } from '../../utils/ownerMobile';
import { ScreenHeader, money } from '../mobile/ui';

type Period = 'day' | 'week' | 'month';
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/** Primer y último día del período que contiene `anchor`. La semana va de lunes a domingo. */
function rangeOf(period: Period, anchor: string): [string, string] {
  if (period === 'day') return [anchor, anchor];
  if (period === 'week') {
    const from = addDays(anchor, -((weekday(anchor) + 6) % 7));
    return [from, addDays(from, 6)];
  }
  const [y, m] = anchor.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${anchor.slice(0, 7)}-01`, `${anchor.slice(0, 7)}-${String(last).padStart(2, '0')}`];
}

function shift(period: Period, anchor: string, dir: number) {
  if (period === 'day') return addDays(anchor, dir);
  if (period === 'week') return addDays(anchor, 7 * dir);
  const [y, m] = anchor.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + dir, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
}

function periodLabel(period: Period, from: string, to: string, today: string) {
  if (period === 'day') return from === today ? 'Hoy' : dayLabel(from);
  if (period === 'week') {
    const f = (k: string) => `${+k.slice(8)}/${+k.slice(5, 7)}`;
    return `${f(from)} al ${f(to)}`;
  }
  return `${MONTHS[+from.slice(5, 7) - 1]} ${from.slice(0, 4)}`;
}

/**
 * Cobros de turnos (planes sin caja): cuánto entró en el día, la semana o el mes, por medio
 * de pago y por profesional, y qué quedó atendido sin cobrar.
 */
export default function AgendaPaymentsScreen() {
  const mobile = useOwnerMobile().active;
  const agendaOnly = usePlanStore((s) => isAgendaOnly(s.features));
  const { storeId } = useOnlineOrders();
  const today = localNow().dateKey;
  const [period, setPeriod] = useState<Period>('day');
  const [anchor, setAnchor] = useState(today);
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [from, to] = rangeOf(period, anchor);

  useEffect(() => { startOnlineOrdersSync(); }, []);
  useEffect(() => {
    if (!storeId) return;
    setBookings(null);
    return subscribeBookings(storeId, from, to, setBookings, () => setBookings([]));
  }, [storeId, from, to]);

  const data = useMemo(() => {
    const list = (bookings || []).filter((b) => b.kind === 'booking');
    const paid = list.filter((b) => b.payment);
    const total = paid.reduce((s, b) => s + (Number(b.payment!.amount) || 0), 0);
    const byMethod = new Map<string, number>();
    const byStaff = new Map<string, number>();
    for (const b of paid) {
      byMethod.set(b.payment!.method, (byMethod.get(b.payment!.method) || 0) + (Number(b.payment!.amount) || 0));
      const who = b.staffName || 'Sin asignar';
      byStaff.set(who, (byStaff.get(who) || 0) + (Number(b.payment!.amount) || 0));
    }
    // Atendidos sin cobrar, y turnos ya pasados que siguen confirmados (¿vinieron?)
    const unpaid = list.filter((b) => !b.payment && (b.status === 'DONE' || ((b.status === 'CONFIRMED' || b.status === 'PENDING') && b.dateKey < today)));
    const methods = [...PAY_METHODS, ...[...byMethod.keys()].filter((m) => !PAY_METHODS.includes(m))]
      .map((m) => [m, byMethod.get(m) || 0] as const).filter(([, v]) => v > 0);
    return { paid, total, methods, staff: [...byStaff].sort((a, b) => b[1] - a[1]), unpaid };
  }, [bookings, today]);

  const subtitle = bookings === null ? 'Cargando…' : `${money(data.total)} cobrado · ${data.paid.length} turno${data.paid.length === 1 ? '' : 's'}`;
  const isCurrent = from <= today && today <= to;

  const body = !storeId ? (
    <p className="p-10 text-center text-[14px] text-slate-500">Primero armá tu página de turnos en Agenda.</p>
  ) : (
    <div className={`${mobile ? 'px-4 py-4 pb-24' : 'p-6 max-w-5xl w-full mx-auto'} space-y-4`}>
      <div className="grid grid-cols-3 p-1 rounded-xl bg-slate-100">
        {([['day', 'Día'], ['week', 'Semana'], ['month', 'Mes']] as const).map(([id, text]) => (
          <button key={id} onClick={() => { setPeriod(id); setAnchor(today); }} className={`h-9 rounded-lg text-[13.5px] font-semibold ${period === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{text}</button>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <button onClick={() => setAnchor(shift(period, anchor, -1))} className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-600" aria-label="Anterior"><ChevronLeft className="w-5 h-5" /></button>
        <div className="flex-1 text-center">
          <p className="text-[15px] font-bold text-slate-900 first-letter:uppercase">{periodLabel(period, from, to, today)}</p>
          {!isCurrent && <button onClick={() => setAnchor(today)} className="text-[12.5px] font-semibold text-rose-700">Volver a hoy</button>}
        </div>
        <button onClick={() => setAnchor(shift(period, anchor, 1))} className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-600" aria-label="Siguiente"><ChevronRight className="w-5 h-5" /></button>
      </div>

      <section className="rounded-2xl bg-rose-600 text-white p-5">
        <p className="text-[13px] font-medium text-white/80">Cobrado</p>
        <p className="text-[34px] font-bold tracking-tight tabular-nums leading-tight">{bookings === null ? '…' : money(data.total)}</p>
        <p className="text-[13px] text-white/80">{data.paid.length} turno{data.paid.length === 1 ? '' : 's'} cobrado{data.paid.length === 1 ? '' : 's'}{data.paid.length ? ` · promedio ${money(Math.round(data.total / data.paid.length))}` : ''}</p>
      </section>

      <div className={`grid gap-4 ${mobile ? '' : 'md:grid-cols-2'}`}>
        <section className="bg-white rounded-2xl border border-slate-200/80 p-4">
          <p className="text-[14px] font-bold text-slate-900 mb-3">Por medio de pago</p>
          {data.methods.length === 0 ? <p className="text-[13px] text-slate-400">Todavía no hay cobros en este período.</p> : (
            <div className="space-y-3">
              {data.methods.map(([m, v]) => (
                <div key={m}>
                  <div className="flex justify-between text-[13.5px]"><span className="text-slate-700">{m}</span><span className="font-semibold text-slate-900 tabular-nums">{money(v)}</span></div>
                  <div className="mt-1.5 h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full rounded-full bg-rose-500" style={{ width: `${data.total ? Math.max(3, (v / data.total) * 100) : 0}%` }} /></div>
                </div>
              ))}
            </div>
          )}
        </section>

        {data.staff.length > 1 && (
          <section className="bg-white rounded-2xl border border-slate-200/80 p-4">
            <p className="text-[14px] font-bold text-slate-900 mb-3">Por profesional</p>
            <div className="space-y-2.5">
              {data.staff.map(([who, v]) => (
                <div key={who} className="flex justify-between text-[13.5px]"><span className="text-slate-700">{who}</span><span className="font-semibold text-slate-900 tabular-nums">{money(v)}</span></div>
              ))}
            </div>
          </section>
        )}
      </div>

      {data.unpaid.length > 0 && (
        <section className="bg-amber-50 border border-amber-200 rounded-2xl p-4">
          <p className="text-[14px] font-bold text-amber-900 flex items-center gap-2"><Clock className="w-4 h-4" /> Sin cobrar ({data.unpaid.length})</p>
          <p className="text-[12.5px] text-amber-800 mt-0.5 mb-2">Turnos atendidos o ya pasados que no tienen cobro. Abrilos en Agenda para cobrarlos o marcar si no vinieron.</p>
          <div className="divide-y divide-amber-200/70">
            {data.unpaid.slice(0, 20).map((b) => (
              <div key={b.id} className="flex items-center gap-3 py-2 text-[13.5px]">
                <span className="w-24 shrink-0 text-amber-800 tabular-nums">{period === 'day' ? hhmm(b.startMin) : `${dayLabel(b.dateKey, true)}`}</span>
                <span className="flex-1 min-w-0 truncate text-amber-950 font-medium">{b.customerName} · {b.serviceName}</span>
                {b.price ? <span className="shrink-0 tabular-nums text-amber-900">{money(b.price)}</span> : null}
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden">
        <p className="px-4 pt-4 pb-2 text-[14px] font-bold text-slate-900">Cobros</p>
        {bookings === null ? <p className="px-4 pb-6 text-[13px] text-slate-400">Cargando…</p>
          : data.paid.length === 0 ? <p className="px-4 pb-6 text-[13px] text-slate-400">Cuando cobres un turno desde la agenda, aparece acá.</p>
          : (
            <div className="divide-y divide-slate-100">
              {[...data.paid].reverse().map((b) => (
                <div key={b.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-9 h-9 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0"><Banknote className="w-4 h-4" /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] font-semibold text-slate-900 truncate">{b.customerName}</span>
                    <span className="block text-[12.5px] text-slate-500 truncate">{period === 'day' ? hhmm(b.startMin) : dayLabel(b.dateKey, true)} · {b.serviceName}{b.staffName ? ` · ${b.staffName}` : ''}</span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-[14px] font-bold text-slate-900 tabular-nums">{money(b.payment!.amount)}</span>
                    <span className="block text-[11.5px] text-slate-500">{b.payment!.method}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
      </section>
    </div>
  );

  if (mobile) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <ScreenHeader back={!agendaOnly} title="Cobros" subtitle={subtitle} />
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{body}</div>
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50">
      <div className="max-w-5xl w-full mx-auto px-6 pt-6">
        <p className="text-[12px] font-semibold tracking-[0.14em] text-rose-600">AGENDA</p>
        <h1 className="text-[26px] font-bold text-slate-900 tracking-tight">Cobros</h1>
        <p className="text-[13px] text-slate-500">{subtitle}</p>
      </div>
      {body}
    </div>
  );
}
