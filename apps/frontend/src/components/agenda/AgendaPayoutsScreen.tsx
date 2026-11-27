import { useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { ChevronLeft, ChevronRight, Copy, Settings } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useOnlineOrders, startOnlineOrdersSync } from '../../services/onlineStoreOrders';
import { loadStoreConfig } from '../../services/onlineStore';
import { subscribeBookings, subscribeStaffPrivate, fullAgenda, localNow, payoutFor, STAFF_COLORS, type Booking, type StaffPrivate, type AgendaStaff } from '../../services/agenda';
import { useOwnerMobile } from '../../utils/ownerMobile';
import { ScreenHeader, money } from '../mobile/ui';
import { rangeOf, shift, periodLabel } from './AgendaPaymentsScreen';
import ExportButtons from '../common/ExportButtons';
import type { Report } from '../../utils/report';

type P = 'week' | 'month';

/**
 * Liquidación por profesional: cuántos turnos atendió cada uno en la semana o el mes, cuánto
 * facturaron y cuánto le toca (comisión) o cuánto paga de alquiler del sillón. Lo que se cargó en
 * Configurar → Profesionales → Editar → Cómo cobra.
 */
export default function AgendaPayoutsScreen() {
  const mobile = useOwnerMobile().active;
  const navigate = useNavigate();
  const { storeId } = useOnlineOrders();
  const today = localNow().dateKey;
  const [period, setPeriod] = useState<P>('week');
  const [anchor, setAnchor] = useState(today);
  const [from, to] = rangeOf(period, anchor);
  const [staff, setStaff] = useState<AgendaStaff[] | null>(null);
  const [priv, setPriv] = useState<Record<string, StaffPrivate>>({});
  const [bookings, setBookings] = useState<Booking[] | null>(null);

  useEffect(() => { startOnlineOrdersSync(); }, []);
  useEffect(() => {
    if (!storeId) return;
    loadStoreConfig(storeId).then((c) => setStaff(fullAgenda((c as any).agenda).staff)).catch(() => setStaff([]));
    return subscribeStaffPrivate(storeId, null, setPriv);
  }, [storeId]);
  useEffect(() => {
    if (!storeId) return;
    setBookings(null);
    return subscribeBookings(storeId, from, to, setBookings, () => setBookings([]));
  }, [storeId, from, to]);

  const rows = useMemo(() => (staff || []).map((s, i) => ({
    s, color: s.color || STAFF_COLORS[i % STAFF_COLORS.length], pay: priv[s.id]?.pay || null,
    p: payoutFor(priv[s.id]?.pay, (bookings || []).filter((b) => b.staffId === s.id), from, to),
  })).filter((r) => r.s.active !== false || r.p.count > 0), [staff, priv, bookings, from, to]);
  // Comisiones: lo que el local le paga a cada uno. Alquileres: lo que cada uno le paga al local.
  const total = rows.reduce((a, r) => ({
    revenue: a.revenue + r.p.revenue,
    commissions: a.commissions + (r.pay?.mode === 'commission' ? r.p.toStaff : 0),
    rents: a.rents + r.p.rent,
  }), { revenue: 0, commissions: 0, rents: 0 });
  const loading = !staff || !bookings;
  const label = periodLabel(period, from, to, today);
  const isCurrent = from <= today && today <= to;

  const summary = () => [`Liquidación ${label}`, ...rows.map((r) => {
    const head = `${r.s.name}: ${r.p.count} turno${r.p.count === 1 ? '' : 's'}, ${money(r.p.revenue)}`;
    if (r.pay?.mode === 'commission') return `${head} → le toca ${money(r.p.toStaff)} (${r.pay.pct}%)`;
    if (r.pay?.mode === 'chair') return `${head} → alquiler ${money(r.p.rent)}`;
    return head;
  })].join('\n');
  const copy = async () => { try { await navigator.clipboard.writeText(summary()); toast.success('Liquidación copiada'); } catch { toast.error('No se pudo copiar'); } };

  /** La liquidación en Excel o PDF */
  const buildReport = (): Report | null => {
    if (loading) return null;
    const how = (pay: any) => pay?.mode === 'commission' ? `Comisión ${pay.pct}%` : pay?.mode === 'chair' ? `Alquiler ${money(pay.amount)} por ${pay.every === 'week' ? 'semana' : 'mes'}` : 'Sin cargar';
    return {
      title: 'Liquidación por profesional',
      subtitle: label.charAt(0).toUpperCase() + label.slice(1),
      fileName: `Liquidación ${label}`,
      summary: [
        { label: 'Facturado', value: total.revenue, type: 'money' },
        { label: 'Comisiones a pagar', value: total.commissions, type: 'money', tone: 'bad' },
        { label: 'Alquileres a cobrar', value: total.rents, type: 'money', tone: 'good' },
      ],
      tables: [{
        title: 'Profesionales',
        columns: [{ header: 'Profesional' }, { header: 'Cómo cobra' }, { header: 'Turnos atendidos', type: 'int' }, { header: 'Facturado', type: 'money' }, { header: 'Le toca (comisión)', type: 'money' }, { header: 'Paga de alquiler', type: 'money' }],
        rows: rows.map(({ s, pay, p }) => [s.name, how(pay), p.count, p.revenue, pay?.mode === 'commission' ? p.toStaff : null, pay?.mode === 'chair' ? p.rent : null]),
        totals: ['Total', '', rows.reduce((t, r) => t + r.p.count, 0), total.revenue, total.commissions, total.rents],
        emptyText: 'No hay profesionales cargados',
      }],
      notes: ['Cuentan los turnos marcados como atendidos o cobrados. Lo facturado es lo cobrado (o el precio del servicio si no se registró el cobro).'],
    };
  };

  const body = !storeId ? (
    <p className="p-10 text-center text-[14px] text-slate-500">Primero armá tu página de turnos en Agenda.</p>
  ) : (
    <div className={`${mobile ? 'px-4 py-4 pb-24' : 'p-6 max-w-5xl w-full mx-auto'} space-y-4`}>
      <div className="grid grid-cols-2 p-1 rounded-xl bg-slate-100">
        {([['week', 'Semana'], ['month', 'Mes']] as const).map(([id, text]) => (
          <button key={id} onClick={() => { setPeriod(id); setAnchor(today); }} className={`h-9 rounded-lg text-[13.5px] font-semibold ${period === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>{text}</button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => setAnchor(shift(period, anchor, -1))} className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-600" aria-label="Anterior"><ChevronLeft className="w-5 h-5" /></button>
        <div className="flex-1 text-center">
          <p className="text-[15px] font-bold text-slate-900 first-letter:uppercase">{label}</p>
          {!isCurrent && <button onClick={() => setAnchor(today)} className="text-[12.5px] font-semibold text-rose-700">Volver a hoy</button>}
        </div>
        <button onClick={() => setAnchor(shift(period, anchor, 1))} className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-600" aria-label="Siguiente"><ChevronRight className="w-5 h-5" /></button>
      </div>

      <section className="rounded-2xl bg-rose-600 text-white p-5 grid grid-cols-3 gap-2">
        <div><p className="text-[12px] text-white/80">Facturado</p><p className="text-[20px] font-bold tabular-nums">{loading ? '…' : money(total.revenue)}</p></div>
        <div><p className="text-[12px] text-white/80">Comisiones a pagar</p><p className="text-[20px] font-bold tabular-nums">{loading ? '…' : money(total.commissions)}</p></div>
        <div><p className="text-[12px] text-white/80">Alquileres a cobrar</p><p className="text-[20px] font-bold tabular-nums">{loading ? '…' : money(total.rents)}</p></div>
      </section>

      <section className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100">
        {loading ? <p className="p-4 text-[13px] text-slate-400">Cargando…</p> : rows.length === 0 ? <p className="p-4 text-[13px] text-slate-400">No hay profesionales cargados.</p> : rows.map(({ s, color, pay, p }) => (
          <div key={s.id} className="p-4 flex items-start gap-3">
            <span className="w-3 h-3 rounded-full mt-1.5 shrink-0" style={{ background: color }} />
            <div className="flex-1 min-w-0">
              <p className="text-[15px] font-bold text-slate-900">{s.name}</p>
              <p className="text-[12.5px] text-slate-500">{p.count} turno{p.count === 1 ? '' : 's'} atendido{p.count === 1 ? '' : 's'} · {money(p.revenue)} · {pay?.mode === 'commission' ? `comisión ${pay.pct}%` : pay?.mode === 'chair' ? `alquila el sillón (${money(pay.amount)} por ${pay.every === 'week' ? 'semana' : 'mes'})` : 'sin forma de cobro cargada'}</p>
            </div>
            <div className="text-right shrink-0">
              {pay?.mode === 'commission' && <><p className="text-[16px] font-bold text-emerald-700 tabular-nums">{money(p.toStaff)}</p><p className="text-[11.5px] text-slate-500">le toca</p></>}
              {pay?.mode === 'chair' && <><p className="text-[16px] font-bold text-slate-900 tabular-nums">{money(p.rent)}</p><p className="text-[11.5px] text-slate-500">te paga{p.rent !== pay.amount ? ' (proporcional)' : ''}</p></>}
              {!pay && <button onClick={() => navigate('/agenda?ver=config')} className="text-[12.5px] font-semibold text-rose-700 flex items-center gap-1"><Settings className="w-3.5 h-3.5" /> Cargar</button>}
            </div>
          </div>
        ))}
      </section>
      {!loading && rows.length > 0 && (
        <button onClick={copy} className="w-full h-11 rounded-xl bg-white border border-slate-200 text-[13.5px] font-semibold text-slate-700 flex items-center justify-center gap-2"><Copy className="w-4 h-4" /> Copiar la liquidación</button>
      )}
      <p className="text-[12px] text-slate-400">Cuentan los turnos marcados como atendidos o cobrados. Lo facturado es lo cobrado (o el precio del servicio si no se registró el cobro).</p>
    </div>
  );

  if (mobile) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <ScreenHeader back title="Liquidación" subtitle={label} action={<ExportButtons variant="header" build={buildReport} disabled={loading} />} />
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">{body}</div>
      </div>
    );
  }
  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-slate-50">
      <div className="max-w-5xl w-full mx-auto px-6 pt-6">
        <p className="text-[12px] font-semibold tracking-[0.14em] text-rose-600">AGENDA</p>
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-[26px] font-bold text-slate-900 tracking-tight">Liquidación por profesional</h1>
            <p className="text-[13px] text-slate-500">Comisiones y alquiler del sillón</p>
          </div>
          <ExportButtons build={buildReport} disabled={loading} />
        </div>
      </div>
      {body}
    </div>
  );
}
