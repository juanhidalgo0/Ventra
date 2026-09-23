import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { BarChart, Bar, XAxis, ResponsiveContainer, Cell, Tooltip } from 'recharts';
import {
  TrendingUp, TrendingDown, AlertTriangle, ChevronRight, RefreshCw, ShoppingCart,
  Receipt, Users, PackageSearch, Wallet, Download, X,
} from 'lucide-react';
import api from '../../services/api';
import InstallAppCard from './InstallAppCard';
import { PullToRefresh } from './ui';
import { useOnlineOrders, isNewOrder } from '../../services/onlineStoreOrders';
import { useAuthStore } from '../../stores/authStore';

type Period = 'day' | 'week' | 'month';

interface OwnerSummary {
  revenue: number;
  cost: number;
  grossProfit: number;
  expenses: number;
  profit: number;
  tickets: number;
  averageTicket: number;
  previous: { revenue: number; profit: number; tickets: number };
  buckets: { label: string; revenue: number }[];
  paymentBreakdown: Record<string, number>;
  topProducts: { name: string; quantity: number; revenue: number }[];
  lowStock: { count: number; items: { id: string; name: string; stock: number; minStock: number }[] };
  openSessions: { id: string; terminalName: string; userName: string; openedAt: string; expectedCash: number }[];
}

const PERIODS: { id: Period; label: string; compare: string }[] = [
  { id: 'day', label: 'Hoy', compare: 'vs. el mismo día de la semana pasada' },
  { id: 'week', label: '7 días', compare: 'vs. los 7 días anteriores' },
  { id: 'month', label: 'Mes', compare: 'vs. el mismo tramo del mes pasado' },
];

const METHOD_LABELS: Record<string, string> = {
  CASH: 'Efectivo', CLOVER: 'Tarjeta', MERCADOPAGO: 'Mercado Pago', DEBT: 'Cuenta corriente',
  TRANSFER: 'Transferencia', CARD: 'Tarjeta', DEBIT: 'Débito', CREDIT: 'Crédito',
};

const money = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);

const pctChange = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null);

function timeAgo(date: Date | null, now: number) {
  if (!date) return '';
  const s = Math.max(0, Math.round((now - date.getTime()) / 1000));
  if (s < 30) return 'recién';
  if (s < 90) return 'hace 1 min';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  return `hace ${Math.round(s / 3600)} h`;
}


export default function MobileHomeScreen() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const [period, setPeriod] = useState<Period>('day');
  const [data, setData] = useState<OwnerSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const [now, setNow] = useState(Date.now());
  const newOrders = useOnlineOrders((s) => s.orders.filter(isNewOrder));
  const showInstall = localStorage.getItem('pwa_install_dismissed') !== '1';

  const storeName = localStorage.getItem('gd_store_name') || 'Tu comercio';
  const firstName = (user?.fullName || user?.username || '').split(' ')[0];

  const load = useCallback(async (p: Period, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const { data } = await api.get('/sales/owner-summary', { params: { period: p } });
      setData(data);
      setError(false);
      setUpdatedAt(new Date());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(period); }, [period, load]);

  // Se refresca solo cada minuto y al volver a la app
  useEffect(() => {
    const tick = setInterval(() => { setNow(Date.now()); load(period, true); }, 60000);
    const onVisible = () => { if (document.visibilityState === 'visible') { setNow(Date.now()); load(period, true); } };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [period, load]);

  const chart = useMemo(() => {
    if (!data) return [];
    if (period !== 'day') return data.buckets;
    // En el día se muestran solo las horas de trabajo: desde la primera hasta la última con ventas (mínimo 8 a 21 h)
    const withSales = data.buckets.map((b, i) => (b.revenue > 0 ? i : -1)).filter((i) => i >= 0);
    const start = Math.min(8, ...withSales);
    const end = Math.max(Math.min(21, new Date().getHours()), ...withSales);
    return data.buckets.slice(start, end + 1);
  }, [data, period]);
  const peak = chart.reduce((best, b, i) => (b.revenue > (chart[best]?.revenue ?? 0) ? i : best), 0);

  const profitChange = data ? pctChange(data.profit, data.previous.profit) : null;
  const periodInfo = PERIODS.find((p) => p.id === period)!;
  const payments = data ? Object.entries(data.paymentBreakdown).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]) : [];
  const paymentsTotal = payments.reduce((s, [, v]) => s + v, 0);


  // Lo que conviene atender ya: aparece arriba de todo, cada aviso lleva a su pantalla
  const alerts: { key: string; tone: 'green' | 'amber' | 'red'; title: string; text: string; to: string }[] = [];
  if (newOrders.length) alerts.push({
    key: 'orders', tone: 'green', to: '/pedidos',
    title: newOrders.length === 1 ? '1 pedido online nuevo' : `${newOrders.length} pedidos online nuevos`,
    text: newOrders.slice(0, 3).map((o) => o.customerName || 'Cliente').join(', '),
  });
  (data?.openSessions || []).forEach((s) => {
    const hours = (now - new Date(s.openedAt).getTime()) / 3600000;
    if (hours >= 12) alerts.push({
      key: `cash-${s.id}`, tone: 'red', to: '/cash-control',
      title: `${s.terminalName}: caja abierta hace ${Math.floor(hours)} h`,
      text: `${s.userName} no la cerró. Revisala y cerrala.`,
    });
  });
  if (data && data.lowStock.count > 0) alerts.push({
    key: 'stock', tone: 'amber', to: '/stock-control',
    title: `${data.lowStock.count} ${data.lowStock.count === 1 ? 'producto' : 'productos'} con stock bajo`,
    text: data.lowStock.items.map((i) => i.name).join(', '),
  });
  const TONES = {
    green: 'bg-emerald-50 border-emerald-200 text-emerald-900 [&_.ic]:bg-emerald-100 [&_.ic]:text-emerald-700',
    amber: 'bg-amber-50 border-amber-200 text-amber-900 [&_.ic]:bg-amber-100 [&_.ic]:text-amber-700',
    red: 'bg-red-50 border-red-200 text-red-900 [&_.ic]:bg-red-100 [&_.ic]:text-red-700',
  };

  return (
    <PullToRefresh onRefresh={() => load(period, true)}>
    <div className="min-h-full pb-6">
      {/* Encabezado verde con la ganancia */}
      <header className="bg-rose-600 text-white px-5 pt-[calc(env(safe-area-inset-top)+1rem)] pb-16 rounded-b-[28px]">
        <div className="flex items-center justify-between">
          <div className="min-w-0">
            <p className="text-[12px] text-rose-100">Hola{firstName ? `, ${firstName}` : ''}</p>
            <h1 className="text-[17px] font-semibold tracking-tight truncate">{storeName}</h1>
          </div>
          <button
            onClick={() => load(period)}
            className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center active:scale-95 transition-transform"
            aria-label="Actualizar"
          >
            <RefreshCw className={`w-[18px] h-[18px] ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="mt-4 inline-flex p-1 rounded-full bg-rose-800/40">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className="relative px-4 h-8 text-[12.5px] font-medium rounded-full"
            >
              {period === p.id && (
                <motion.span layoutId="home-period" className="absolute inset-0 rounded-full bg-orange-200" transition={{ type: 'spring', stiffness: 500, damping: 40 }} />
              )}
              <span className={`relative ${period === p.id ? 'text-orange-900' : 'text-rose-100'}`}>{p.label}</span>
            </button>
          ))}
        </div>

        <p className="mt-5 text-[12px] text-rose-100">Ganancia</p>
        <AnimatePresence mode="wait">
          <motion.p
            key={`${period}-${data?.profit ?? 'x'}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="text-[34px] leading-tight font-bold tracking-tight tabular-nums"
          >
            {data ? money(data.profit) : '—'}
          </motion.p>
        </AnimatePresence>
        {profitChange !== null && (
          <p className="mt-1 flex items-center gap-1 text-[12px] text-orange-200">
            {profitChange >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
            <span className="font-semibold">{profitChange >= 0 ? '+' : ''}{profitChange}%</span>
            <span className="text-rose-100">{periodInfo.compare}</span>
          </p>
        )}
      </header>

      <div className="px-4 -mt-10 space-y-3">
        {error && !data && (
          <div className="bg-white rounded-2xl p-5 border border-slate-200 text-center">
            <p className="text-sm font-medium text-slate-800">No pudimos traer los números</p>
            <p className="text-xs text-slate-500 mt-1">Revisá la conexión e intentá de nuevo.</p>
            <button onClick={() => load(period)} className="mt-3 px-4 h-9 rounded-full bg-rose-600 text-white text-sm font-medium">Reintentar</button>
          </div>
        )}

        {/* Para atender */}
        {alerts.length > 0 && (
          <div className="space-y-2">
            {alerts.map((a) => (
              <button key={a.key} onClick={() => navigate(a.to)} className={`w-full text-left border rounded-2xl p-3.5 flex items-center gap-3 active:scale-[0.99] transition-transform shadow-sm ${TONES[a.tone]}`}>
                <span className="ic w-9 h-9 rounded-xl flex items-center justify-center shrink-0">
                  {a.key === 'orders' ? <ShoppingCart className="w-[18px] h-[18px]" /> : <AlertTriangle className="w-[18px] h-[18px]" />}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-[13.5px] font-semibold">{a.title}</span>
                  {a.text && <span className="block text-[12px] opacity-80 truncate">{a.text}</span>}
                </span>
                <ChevronRight className="w-4 h-4 opacity-60 shrink-0" />
              </button>
            ))}
          </div>
        )}

        {/* Ventas y gastos */}
        <div className="grid grid-cols-2 gap-3">
          <StatCard label="Ventas" value={data?.revenue} sub={data ? `${data.tickets} ${data.tickets === 1 ? 'venta' : 'ventas'}` : ''} tone="text-emerald-700" loading={!data} />
          <StatCard label="Gastos" value={data?.expenses} sub="Salidas de caja" tone="text-red-600" loading={!data} />
        </div>

        {/* Cómo se llega a la ganancia */}
        {data && (
          <Card>
            <p className="text-[12px] font-medium text-slate-500 mb-2">Cómo se calcula</p>
            <Row label="Ventas" value={money(data.revenue)} />
            <Row label="Costo de la mercadería" value={`− ${money(data.cost)}`} muted />
            <Row label="Gastos" value={`− ${money(data.expenses)}`} muted />
            <div className="border-t border-dashed border-slate-200 my-2" />
            <Row label="Ganancia" value={money(data.profit)} strong />
            <p className="text-[11px] text-slate-400 mt-2">Ticket promedio {money(data.averageTicket)}</p>
          </Card>
        )}

        {/* Accesos rápidos */}
        <div className="grid grid-cols-4 gap-2">
          <QuickAction icon={ShoppingCart} label="Vender" onClick={() => navigate('/pos')} />
          <QuickAction icon={Receipt} label="Gasto" onClick={() => navigate('/gastos')} />
          <QuickAction icon={Users} label="Fiado" onClick={() => navigate('/clients')} />
          <QuickAction icon={Wallet} label="Cajas" onClick={() => navigate('/cash-control')} />
        </div>

        {/* Gráfico */}
        <Card>
          <div className="flex items-baseline justify-between">
            <p className="text-[13px] font-semibold text-slate-800">{period === 'day' ? 'Ventas por hora' : 'Ventas por día'}</p>
            {data && chart[peak]?.revenue > 0 && (
              <p className="text-[11px] text-slate-500">Pico: {period === 'month' ? `día ${chart[peak].label}` : chart[peak].label}</p>
            )}
          </div>
          <div className="h-36 mt-3 -mx-1">
            {data ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    interval={period === 'month' ? 4 : period === 'day' ? 2 : 0}
                    tick={{ fontSize: 10, fill: '#94a3b8' }}
                  />
                  <Tooltip
                    cursor={{ fill: 'rgba(14,110,82,0.06)' }}
                    formatter={(v: number) => [money(v), 'Ventas']}
                    contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 12 }}
                  />
                  <Bar dataKey="revenue" radius={[6, 6, 2, 2]} maxBarSize={22}>
                    {chart.map((_, i) => <Cell key={i} fill={i === peak ? '#0E6E52' : '#CDEEE0'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : <div className="h-full rounded-xl bg-slate-100 animate-pulse" />}
          </div>
        </Card>

        {/* Cajas abiertas */}
        {data && data.openSessions.length > 0 && (
          <Card>
            <p className="text-[13px] font-semibold text-slate-800 mb-1">Cajas abiertas</p>
            {data.openSessions.map((s) => (
              <button key={s.id} onClick={() => navigate('/cash-control')} className="w-full flex items-center justify-between py-2.5 border-b last:border-0 border-slate-100 text-left">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-slate-800 truncate">{s.terminalName}</p>
                  <p className="text-[11.5px] text-slate-500 truncate">
                    {s.userName} · desde las {new Date(s.openedAt).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
                <div className="text-right shrink-0 pl-3">
                  <p className="text-[13px] font-semibold text-slate-800 tabular-nums">{money(s.expectedCash)}</p>
                  <p className="text-[11px] text-slate-500">en efectivo</p>
                </div>
              </button>
            ))}
          </Card>
        )}

        {/* Medios de pago */}
        {payments.length > 0 && (
          <Card>
            <p className="text-[13px] font-semibold text-slate-800 mb-3">Cómo te pagaron</p>
            <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-100">
              {payments.map(([m, v], i) => (
                <div key={m} style={{ width: `${(v / paymentsTotal) * 100}%`, background: PAY_COLORS[i % PAY_COLORS.length] }} />
              ))}
            </div>
            <div className="mt-3 space-y-1.5">
              {payments.map(([m, v], i) => (
                <div key={m} className="flex items-center justify-between text-[12.5px]">
                  <span className="flex items-center gap-2 text-slate-600">
                    <span className="w-2 h-2 rounded-full" style={{ background: PAY_COLORS[i % PAY_COLORS.length] }} />
                    {METHOD_LABELS[m] || m}
                  </span>
                  <span className="font-medium text-slate-800 tabular-nums">{money(v)}</span>
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* Lo más vendido */}
        {data && data.topProducts.length > 0 && (
          <Card>
            <p className="text-[13px] font-semibold text-slate-800 mb-1">Lo más vendido</p>
            {data.topProducts.map((p, i) => (
              <div key={p.name + i} className="flex items-center gap-3 py-2 border-b last:border-0 border-slate-100">
                <span className="w-6 h-6 rounded-lg bg-rose-50 text-rose-700 text-[11px] font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] text-slate-800 truncate">{p.name}</p>
                  <p className="text-[11px] text-slate-500">{Math.round(p.quantity * 100) / 100} unidades</p>
                </div>
                <p className="text-[13px] font-medium text-slate-800 tabular-nums">{money(p.revenue)}</p>
              </div>
            ))}
          </Card>
        )}

        {data && data.tickets === 0 && (
          <div className="text-center py-6">
            <PackageSearch className="w-8 h-8 text-slate-300 mx-auto" />
            <p className="text-[13px] text-slate-500 mt-2">Todavía no hay ventas en este período.</p>
          </div>
        )}

        {showInstall && <InstallAppCard />}

        {updatedAt && (
          <p className="text-center text-[11px] text-slate-400 pt-1">Actualizado {timeAgo(updatedAt, now)}</p>
        )}
      </div>
    </div>
    </PullToRefresh>
  );
}

const PAY_COLORS = ['#0E6E52', '#93AE25', '#34AC7E', '#D9A70F', '#9EDDC3', '#58691A'];

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">{children}</div>;
}

function StatCard({ label, value, sub, tone, loading }: { label: string; value?: number; sub: string; tone: string; loading: boolean }) {
  return (
    <div className="bg-white rounded-2xl p-4 border border-slate-200/80 shadow-[0_4px_16px_rgba(15,23,42,0.06)]">
      <p className="text-[12px] text-slate-500">{label}</p>
      {loading ? (
        <div className="h-6 w-24 mt-1 rounded bg-slate-100 animate-pulse" />
      ) : (
        <p className={`text-[19px] font-bold tracking-tight tabular-nums mt-0.5 ${tone}`}>{money(value || 0)}</p>
      )}
      <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>
    </div>
  );
}

function Row({ label, value, muted, strong }: { label: string; value: string; muted?: boolean; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className={`text-[12.5px] ${strong ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>{label}</span>
      <span className={`text-[12.5px] tabular-nums ${strong ? 'font-bold text-rose-700' : muted ? 'text-slate-500' : 'font-medium text-slate-800'}`}>{value}</span>
    </div>
  );
}

function QuickAction({ icon: Icon, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="bg-white rounded-2xl py-3 border border-slate-200/80 flex flex-col items-center gap-1.5 active:scale-95 transition-transform">
      <span className="w-9 h-9 rounded-xl bg-rose-50 flex items-center justify-center">
        <Icon className="w-[18px] h-[18px] text-rose-600" />
      </span>
      <span className="text-[11.5px] font-medium text-slate-700">{label}</span>
    </button>
  );
}
