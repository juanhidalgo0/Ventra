import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Banknote, Clock, Package } from 'lucide-react';
import { useOnlineOrders, startOnlineOrdersSync } from '../../services/onlineStoreOrders';
import { subscribeBookings, subscribePaidBetween, localNow, addDays, weekday, dayLabel, hhmm, startAtMs, PAY_METHODS, type Booking } from '../../services/agenda';
import { usePlanStore, isAgendaOnly } from '../../stores/planStore';
import { useOwnerMobile } from '../../utils/ownerMobile';
import { ScreenHeader, money } from '../mobile/ui';
import { depositPaid, paidInFull } from '../../services/agendaCore';
import { subscribeNutriPayments, type NutriPayment } from '../../services/nutri';
import { useBusinessStore, isConsultorio } from '../../stores/businessStore';

const DEPOSIT_METHOD = 'Mercado Pago (online)';
const msOf = (t: any) => (t?.toMillis ? t.toMillis() : 0);

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
  const [paidList, setPaidList] = useState<Booking[] | null>(null);
  // Consultorio: los packs de consultas se cobran en la ficha del paciente y suman acá
  const consultorio = useBusinessStore((s) => isConsultorio(s.profile));
  const [packs, setPacks] = useState<NutriPayment[]>([]);
  const [from, to] = rangeOf(period, anchor);
  // La plata cuenta el día que entró (cobro o pago online), no el día del turno: así cuadra con la caja y con Mercado Pago
  const fromMs = startAtMs(from, 0), toMs = startAtMs(to, 24 * 60);
  const inPeriod = (t: any) => { const m = msOf(t); return m >= fromMs && m < toMs; };

  useEffect(() => { startOnlineOrdersSync(); }, []);
  useEffect(() => {
    if (!storeId) return;
    setBookings(null);
    return subscribeBookings(storeId, from, to, setBookings, () => setBookings([]));
  }, [storeId, from, to]);
  useEffect(() => {
    if (!storeId) return;
    setPaidList(null);
    return subscribePaidBetween(storeId, fromMs, toMs, setPaidList, () => setPaidList([]));
  }, [storeId, fromMs, toMs]);
  useEffect(() => {
    if (!storeId || !consultorio) return setPacks([]);
    return subscribeNutriPayments(storeId, from, to, setPacks);
  }, [storeId, consultorio, from, to]);

  const data = useMemo(() => {
    // Lo que entró en el período de cada turno: el cobro y lo pagado online por Mercado Pago. Lo pagado online que hay
    // que devolver (el comercio canceló, o el turno completo que canceló el cliente) va aparte: no es plata del comercio.
    const rows = (paidList || []).filter((b) => b.kind === 'booking').map((b) => {
      const pay = b.payment && inPeriod(b.payment.at) ? Number(b.payment.amount) || 0 : null;
      const online = depositPaid(b) && inPeriod(b.deposit?.paidAt) ? depositPaid(b) : 0;
      const refund = online && b.deposit?.refundNeeded ? online : 0;
      return { b, pay, online: refund ? 0 : online, refund, amount: (pay || 0) + (refund ? 0 : online) };
    });
    const paid = rows.filter((r) => r.pay !== null || r.online > 0).sort((x, y) => x.b.dateKey.localeCompare(y.b.dateKey) || x.b.startMin - y.b.startMin);
    const refunds = rows.filter((r) => r.refund > 0);
    const packTotal = packs.reduce((s, k) => s + (Number(k.amount) || 0), 0);
    const total = paid.reduce((s, r) => s + r.amount, 0) + packTotal;
    const byMethod = new Map<string, number>();
    for (const k of packs) byMethod.set(k.method, (byMethod.get(k.method) || 0) + (Number(k.amount) || 0));
    const byStaff = new Map<string, number>();
    for (const r of paid) {
      if (r.pay !== null && r.b.payment) byMethod.set(r.b.payment.method, (byMethod.get(r.b.payment.method) || 0) + r.pay);
      if (r.online) byMethod.set(DEPOSIT_METHOD, (byMethod.get(DEPOSIT_METHOD) || 0) + r.online);
      const who = r.b.staffName || 'Sin asignar';
      byStaff.set(who, (byStaff.get(who) || 0) + r.amount);
    }
    // Atendidos sin cobrar, y turnos ya pasados que siguen confirmados (¿vinieron?), con lo que les falta pagar
    const unpaid = (bookings || []).filter((b) => b.kind === 'booking' && !b.payment && !paidInFull(b) && (b.status === 'DONE' || ((b.status === 'CONFIRMED' || b.status === 'PENDING') && b.dateKey < today)));
    const methods = [...PAY_METHODS, ...[...byMethod.keys()].filter((m) => !PAY_METHODS.includes(m))]
      .map((m) => [m, byMethod.get(m) || 0] as const).filter(([, v]) => v > 0);
    return { paid, refunds, total, methods, staff: [...byStaff].sort((a, b) => b[1] - a[1]), unpaid, packs: [...packs].sort((a, b) => b.paidAt - a.paidAt) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookings, paidList, packs, today, fromMs, toMs]);
  const loading = bookings === null || paidList === null;

  const subtitle = loading ? 'Cargando…' : `${money(data.total)} cobrado · ${data.paid.length} turno${data.paid.length === 1 ? '' : 's'}`;
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
        <p className="text-[34px] font-bold tracking-tight tabular-nums leading-tight">{loading ? '…' : money(data.total)}</p>
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
                {b.price ? <span className="shrink-0 tabular-nums text-amber-900">{money(Math.max(0, b.price - depositPaid(b)))}</span> : null}
              </div>
            ))}
          </div>
        </section>
      )}

      {data.refunds.length > 0 && (
        <section className="bg-red-50 border border-red-200 rounded-2xl p-4">
          <p className="text-[14px] font-bold text-red-900">Para devolver ({data.refunds.length})</p>
          <p className="text-[12.5px] text-red-800 mt-0.5 mb-2">Pagaron online un turno que se canceló o que no se pudo dar. No suma en lo cobrado: devolvelo desde tu cuenta de Mercado Pago.</p>
          <div className="divide-y divide-red-200/70">
            {data.refunds.map(({ b, refund }) => (
              <div key={b.id} className="flex items-center gap-3 py-2 text-[13.5px]">
                <span className="w-24 shrink-0 text-red-800 tabular-nums">{dayLabel(b.dateKey, true)}</span>
                <span className="flex-1 min-w-0 truncate text-red-950 font-medium">{b.customerName} · {b.serviceName}</span>
                <span className="shrink-0 tabular-nums text-red-900">{money(refund)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {data.packs.length > 0 && (
        <section className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden">
          <p className="px-4 pt-4 pb-2 text-[14px] font-bold text-slate-900">Packs de consultas</p>
          <div className="divide-y divide-slate-100">
            {data.packs.map((k) => (
              <div key={k.id} className="flex items-center gap-3 px-4 py-3">
                <span className="w-9 h-9 rounded-full bg-rose-50 text-rose-700 flex items-center justify-center shrink-0"><Package className="w-4 h-4" /></span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[14px] font-semibold text-slate-900 truncate">{k.patientName}</span>
                  <span className="block text-[12.5px] text-slate-500 truncate">{dayLabel(k.dateKey, true)} · {k.concept}</span>
                </span>
                <span className="text-right shrink-0">
                  <span className="block text-[14px] font-bold text-slate-900 tabular-nums">{money(k.amount)}</span>
                  <span className="block text-[11.5px] text-slate-500">{k.method}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="bg-white rounded-2xl border border-slate-200/80 overflow-hidden">
        <p className="px-4 pt-4 pb-2 text-[14px] font-bold text-slate-900">Cobros</p>
        {loading ? <p className="px-4 pb-6 text-[13px] text-slate-400">Cargando…</p>
          : data.paid.length === 0 ? <p className="px-4 pb-6 text-[13px] text-slate-400">Cuando cobres un turno desde la agenda, aparece acá.</p>
          : (
            <div className="divide-y divide-slate-100">
              {[...data.paid].reverse().map(({ b, pay, online, amount }) => (
                <div key={b.id} className="flex items-center gap-3 px-4 py-3">
                  <span className="w-9 h-9 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0"><Banknote className="w-4 h-4" /></span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[14px] font-semibold text-slate-900 truncate">{b.customerName}</span>
                    <span className="block text-[12.5px] text-slate-500 truncate">{period === 'day' ? hhmm(b.startMin) : dayLabel(b.dateKey, true)} · {b.serviceName}{b.staffName ? ` · ${b.staffName}` : ''}</span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-[14px] font-bold text-slate-900 tabular-nums">{money(amount)}</span>
                    <span className="block text-[11.5px] text-slate-500">{[pay !== null ? b.payment?.method : '', online ? `${b.deposit?.full === false ? 'Seña' : 'Mercado Pago'} online ${money(online)}` : ''].filter(Boolean).join(' + ')}</span>
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
