import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { AlertCircle, ChevronDown, Loader2, RefreshCw, ShoppingBag } from 'lucide-react';
import { resolveStoreId, fetchStoreOrders, fetchProductCosts, type StoreOrder } from '../../services/onlineStore';

type Period = 'today' | '7d' | '30d' | 'month' | 'custom';
const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Hoy' },
  { id: '7d', label: '7 días' },
  { id: '30d', label: '30 días' },
  { id: 'month', label: 'Este mes' },
  { id: 'custom', label: 'Elegir fechas' },
];

const BRAND = '#0E6E52';
const money = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('es-AR')} ${n === 1 ? one : many}`;
const DELIVERY: Record<string, string> = { PICKUP: 'Retiro en el local', DELIVERY: 'Envío', GODELIVERY: 'GoDelivery', TABLE: 'En la mesa' };
const STAGE: Record<string, string> = { NEW: 'Nuevo', PREPARING: 'Preparando', READY: 'Listo', DELIVERED: 'Entregado', CANCELLED: 'Cancelado' };

const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const orderDate = (o: StoreOrder): Date | null => (o.createdAt?.toDate ? o.createdAt.toDate() : null);

function rangeFor(period: Period, from: string, to: string): { start: Date; end: Date } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86400000);
  if (period === 'today') return { start: today, end: tomorrow };
  if (period === '7d') return { start: new Date(today.getTime() - 6 * 86400000), end: tomorrow };
  if (period === '30d') return { start: new Date(today.getTime() - 29 * 86400000), end: tomorrow };
  if (period === 'month') return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: tomorrow };
  const s = from ? new Date(`${from}T00:00:00`) : new Date(today.getTime() - 6 * 86400000);
  const e = to ? new Date(new Date(`${to}T00:00:00`).getTime() + 86400000) : tomorrow;
  return { start: s, end: e > s ? e : new Date(s.getTime() + 86400000) };
}

/** Métricas de la tienda online: lo que se vendió por la tienda, sacado de sus pedidos. */
export default function OnlineStoreMetricsScreen() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>('7d');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [storeId, setStoreId] = useState<string | null>(null);
  const [orders, setOrders] = useState<StoreOrder[] | null>(null);
  const [costs, setCosts] = useState<Record<string, number> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    resolveStoreId().then(setStoreId).catch(() => setError('No pudimos conectar con tu tienda online. Revisá la conexión a internet.'));
  }, []);

  const { start, end } = useMemo(() => rangeFor(period, from, to), [period, from, to]);

  const load = async () => {
    if (!storeId) return;
    setLoading(true);
    setError(null);
    try {
      const list = await fetchStoreOrders(storeId, start, end);
      setOrders(list);
      setCosts(null);
      const ids = Array.from(new Set(list.flatMap((o) => (o.items || []).map((i) => String(i.productId)))));
      fetchProductCosts(ids).then(setCosts).catch(() => setCosts({}));
    } catch (err) {
      console.error(err);
      setError('No se pudieron cargar los pedidos. Revisá la conexión y probá de nuevo.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeId, start.getTime(), end.getTime()]);

  const stats = useMemo(() => {
    const all = orders || [];
    const valid = all.filter((o) => o.stage !== 'CANCELLED');
    const total = valid.reduce((s, o) => s + (Number(o.total) || 0), 0);
    const units = valid.reduce((s, o) => s + (o.items || []).reduce((a, i) => a + (Number(i.qty) || 0), 0), 0);
    let profit = 0;
    let costed = 0;
    let itemsTotal = 0;
    const byProduct = new Map<string, { name: string; qty: number; total: number }>();
    for (const o of valid) {
      for (const i of o.items || []) {
        const line = (Number(i.price) || 0) * (Number(i.qty) || 0);
        itemsTotal += line;
        const cost = costs?.[String(i.productId)] || undefined;
        if (cost !== undefined) { profit += line - cost * (Number(i.qty) || 0); costed += line; }
        const key = String(i.productId);
        const cur = byProduct.get(key) || { name: i.name, qty: 0, total: 0 };
        cur.qty += Number(i.qty) || 0;
        cur.total += line;
        byProduct.set(key, cur);
      }
    }
    const countBy = (fn: (o: StoreOrder) => string) => {
      const m = new Map<string, { count: number; total: number }>();
      valid.forEach((o) => { const k = fn(o); const c = m.get(k) || { count: 0, total: 0 }; c.count++; c.total += Number(o.total) || 0; m.set(k, c); });
      return Array.from(m.entries()).sort((a, b) => b[1].total - a[1].total);
    };
    // Gráfico: por hora si es un solo día, si no por día
    const oneDay = end.getTime() - start.getTime() <= 86400000;
    const buckets = new Map<string, number>();
    if (oneDay) for (let h = 0; h < 24; h++) buckets.set(String(h), 0);
    else for (let t = start.getTime(); t < end.getTime(); t += 86400000) buckets.set(dayKey(new Date(t)), 0);
    valid.forEach((o) => {
      const d = orderDate(o);
      if (!d) return;
      const k = oneDay ? String(d.getHours()) : dayKey(d);
      if (buckets.has(k)) buckets.set(k, (buckets.get(k) || 0) + (Number(o.total) || 0));
    });
    const chart = Array.from(buckets.entries()).map(([k, v]) => ({
      label: oneDay ? `${k}h` : new Date(`${k}T00:00:00`).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }),
      total: v,
    }));
    return {
      total, units, count: valid.length, cancelled: all.length - valid.length,
      avg: valid.length ? total / valid.length : 0,
      profit, profitCoverage: itemsTotal ? costed / itemsTotal : 0,
      top: Array.from(byProduct.values()).sort((a, b) => b.total - a.total).slice(0, 8),
      byDelivery: countBy((o) => DELIVERY[o.delivery || ''] || 'Sin indicar'),
      byPayment: countBy((o) => o.paymentMethod || 'Sin indicar'),
      chart, oneDay,
    };
  }, [orders, costs, start, end]);

  return (
    <div className="h-full overflow-y-auto bg-slate-50 custom-scrollbar">
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">
        {/* Encabezado */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-4">
          <div>
            <p className="text-[11.5px] font-semibold tracking-[0.14em] text-rose-600">TIENDA ONLINE</p>
            <h1 className="text-[24px] font-bold text-slate-900 tracking-tight">Métricas y ventas</h1>
            <p className="text-[13px] text-slate-500">Lo que vendiste por tu tienda online, según los pedidos que recibiste.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-white border border-slate-200 rounded-xl p-1">
              {PERIODS.map((p) => (
                <button key={p.id} onClick={() => setPeriod(p.id)}
                  className={`h-8 px-3 rounded-lg text-[13px] font-semibold transition-colors ${period === p.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                  {p.label}
                </button>
              ))}
            </div>
            <button onClick={load} disabled={loading} title="Actualizar" aria-label="Actualizar" className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-800 disabled:opacity-50">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
        {period === 'custom' && (
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-slate-600">
            Desde <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="h-10 px-3 rounded-xl border border-slate-300 bg-white text-slate-800" />
            hasta <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="h-10 px-3 rounded-xl border border-slate-300 bg-white text-slate-800" />
          </div>
        )}

        {error ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-10 flex flex-col items-center gap-2 text-center">
            <AlertCircle className="w-7 h-7 text-rose-500" />
            <p className="text-[14px] font-semibold text-slate-700">{error}</p>
            <button onClick={load} className="mt-2 h-10 px-4 rounded-xl bg-rose-600 text-white text-[13.5px] font-bold">Reintentar</button>
          </div>
        ) : orders === null ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-16 flex items-center justify-center gap-2 text-slate-400 text-[13.5px] font-semibold">
            <Loader2 className="w-5 h-5 animate-spin" /> Cargando pedidos…
          </div>
        ) : (
          <>
            {/* Números */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <Kpi label="Vendido" value={money(stats.total)} hint={stats.cancelled ? `Sin contar ${plural(stats.cancelled, 'cancelado', 'cancelados')}` : undefined} strong />
              <Kpi label="Pedidos" value={stats.count.toLocaleString('es-AR')} hint={plural(stats.units, 'producto vendido', 'productos vendidos')} />
              <Kpi label="Ticket promedio" value={money(stats.avg)} />
              <Kpi
                label="Ganancia estimada"
                value={!stats.count ? '—' : costs === null ? '…' : stats.profitCoverage === 0 ? '—' : money(stats.profit)}
                hint={!stats.count || costs === null ? undefined
                  : stats.profitCoverage === 0 ? 'Cargá el costo de tus productos para verla'
                  : stats.profitCoverage < 0.999 ? 'Con el costo actual (algunos productos no tienen costo)'
                  : 'Con el costo actual de cada producto'}
              />
            </div>

            {stats.count === 0 ? (
              <div className="bg-white rounded-2xl border border-slate-200 p-12 flex flex-col items-center gap-2 text-center">
                <ShoppingBag className="w-8 h-8 text-slate-300" />
                <p className="text-[14.5px] font-semibold text-slate-700">No hubo pedidos en este período</p>
                <p className="text-[13px] text-slate-500">Probá con otro rango de fechas, o compartí el link de tu tienda para recibir pedidos.</p>
                <button onClick={() => navigate('/online-store')} className="mt-2 h-10 px-4 rounded-xl border border-slate-300 text-[13.5px] font-semibold text-slate-700 hover:bg-slate-50">Ir a mi tienda</button>
              </div>
            ) : (
              <>
                <Card title={stats.oneDay ? 'Ventas por hora' : 'Ventas por día'}>
                  <div className="h-60 -ml-2">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={stats.chart} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={12} />
                        <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} width={64}
                          tickFormatter={(v) => (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`)} />
                        <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v: number) => [money(v), 'Vendido']}
                          contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 13 }} />
                        <Bar dataKey="total" fill={BRAND} radius={[6, 6, 0, 0]} maxBarSize={36} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Card>

                <div className="grid grid-cols-1 lg:grid-cols-[1.4fr,1fr] gap-5">
                  <Card title="Productos más vendidos">
                    <div className="divide-y divide-slate-100 -my-2">
                      {stats.top.map((p, i) => (
                        <div key={i} className="flex items-center gap-3 py-2.5">
                          <span className="w-6 text-[12.5px] font-bold text-slate-400 tabular-nums">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13.5px] font-semibold text-slate-800 truncate">{p.name}</p>
                            <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div className="h-full rounded-full bg-rose-500" style={{ width: `${(p.total / (stats.top[0]?.total || 1)) * 100}%` }} />
                            </div>
                          </div>
                          <span className="text-right shrink-0">
                            <span className="block text-[13.5px] font-bold text-slate-800 tabular-nums">{money(p.total)}</span>
                            <span className="block text-[11.5px] text-slate-500">{plural(p.qty, 'unidad', 'unidades')}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  </Card>
                  <div className="space-y-5">
                    <Card title="Cómo lo reciben"><Breakdown rows={stats.byDelivery} total={stats.total} /></Card>
                    <Card title="Cómo pagan"><Breakdown rows={stats.byPayment} total={stats.total} /></Card>
                  </div>
                </div>

                <Card title="Pedidos del período" action={<button onClick={() => navigate('/pedidos')} className="h-9 px-3.5 rounded-xl border border-slate-300 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">Atender pedidos</button>}>
                  <div className="divide-y divide-slate-100 -my-2">
                    {(orders || []).slice(0, 100).map((o) => {
                      const d = orderDate(o);
                      const isOpen = open === o.id;
                      return (
                        <div key={o.id}>
                          <button onClick={() => setOpen(isOpen ? null : o.id)} className="w-full flex items-center gap-3 py-3 text-left">
                            <div className="flex-1 min-w-0">
                              <p className="text-[14px] font-semibold text-slate-800 truncate">
                                {o.customerName || 'Cliente'}{o.orderCode ? <span className="text-slate-400 font-medium"> · #{o.orderCode}</span> : null}
                              </p>
                              <p className="text-[12.5px] text-slate-500 truncate">
                                {d ? d.toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}
                                {o.delivery ? ` · ${DELIVERY[o.delivery] || o.delivery}` : ''}{o.paymentMethod ? ` · ${o.paymentMethod}` : ''}
                              </p>
                            </div>
                            <span className={`text-[14px] font-bold tabular-nums ${o.stage === 'CANCELLED' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{money(o.total)}</span>
                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ring-1 ${o.stage === 'CANCELLED' ? 'bg-slate-100 text-slate-500 ring-slate-200' : !o.stage || o.stage === 'NEW' ? 'bg-rose-50 text-rose-700 ring-rose-200' : 'bg-slate-50 text-slate-600 ring-slate-200'}`}>
                              {STAGE[o.stage || 'NEW']}
                            </span>
                            <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                          </button>
                          {isOpen && (
                            <div className="mb-3 rounded-xl bg-slate-50 border border-slate-200 divide-y divide-slate-200/70">
                              {(o.items || []).map((i, k) => (
                                <div key={k} className="flex items-center gap-3 px-4 py-2 text-[13px]">
                                  <span className="w-8 text-slate-500 tabular-nums">{i.qty}×</span>
                                  <span className="flex-1 min-w-0 truncate text-slate-700">{(i as any).title || i.name}</span>
                                  <span className="font-semibold text-slate-700 tabular-nums">{money((Number(i.price) || 0) * (Number(i.qty) || 0))}</span>
                                </div>
                              ))}
                              {(Number(o.deliveryCost) > 0 || Number(o.discount) > 0) && (
                                <div className="px-4 py-2 text-[12.5px] text-slate-500 flex flex-wrap gap-x-4">
                                  {Number(o.deliveryCost) > 0 && <span>Envío {money(Number(o.deliveryCost))}</span>}
                                  {Number(o.discount) > 0 && <span>Descuento −{money(Number(o.discount))}</span>}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {(orders || []).length > 100 && <p className="text-[12.5px] text-slate-500">Se muestran los 100 más recientes.</p>}
                </Card>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="px-5 pt-4 pb-3 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-bold text-slate-900 tracking-tight">{title}</h2>
        {action}
      </header>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

function Kpi({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <p className="text-[12.5px] text-slate-500">{label}</p>
      <p className={`mt-1 text-[24px] font-bold tabular-nums tracking-tight ${strong ? 'text-rose-700' : 'text-slate-900'}`}>{value}</p>
      {hint && <p className="text-[11.5px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function Breakdown({ rows, total }: { rows: [string, { count: number; total: number }][]; total: number }) {
  return (
    <div className="space-y-3">
      {rows.map(([label, v]) => {
        const pct = total ? Math.round((v.total / total) * 100) : 0;
        return (
          <div key={label}>
            <div className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="font-semibold text-slate-700 truncate">{label}</span>
              <span className="text-slate-500 tabular-nums shrink-0">{plural(v.count, 'pedido', 'pedidos')} · {pct}%</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full rounded-full bg-rose-500" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
