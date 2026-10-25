import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { AlertCircle, Bike, ChevronDown, ExternalLink, Link2, Loader2, RefreshCw, Search, ShoppingBag } from 'lucide-react';
import toast from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { openExternal } from '../../utils/externalLinks';
import { useConfirm } from '../common/ConfirmDialog';
import { GoOrder, isChargeable, loadGoOrderInCart } from './goOrders';

/**
 * GO Delivery: el catálogo de la caja publicado en la app GO y los pedidos que llegan de ahí.
 * Lo hace el servidor (backend: modules/go). En los comercios donde "lo compra el repartidor",
 * el repartidor paga en el mostrador como cualquier cliente y la venta se cobra en la caja.
 */
type Status = {
  linked: boolean; comercioId?: string; storeName?: string; fulfillmentMode?: string | null;
  storeActive?: boolean | null; storePaused?: boolean; unlinkedInGo?: boolean;
  publishMode?: 'all' | 'categories' | 'selected' | 'sold'; publishCategories?: string[]; syncStock?: boolean;
  isMainPc?: boolean; mainPc?: string | null; thisPc?: string; publishedCount?: number;
  lastPushAt?: number | null; lastPollAt?: number | null; lastError?: string | null;
};
type Stats = {
  orders: number; delivered: number; cancelled: number; open: number; revenue: number; avgTicket: number; avgMinutes: number | null; itemsSold: number;
  topProducts: { name: string; qty: number; amount: number }[]; missing: { name: string; times: number }[];
  cancelReasons: { reason: string; count: number }[]; byHour: number[]; byWeekday: number[]; byDay: { day: string; orders: number; amount: number }[];
};
type Period = 'today' | '7d' | '30d' | 'month';
const PERIODS: { id: Period; label: string }[] = [
  { id: 'today', label: 'Hoy' }, { id: '7d', label: '7 días' }, { id: '30d', label: '30 días' }, { id: 'month', label: 'Este mes' },
];
const TABS = [
  { id: 'numbers', label: 'Números' }, { id: 'orders', label: 'Pedidos' }, { id: 'publish', label: 'Qué se publica' }, { id: 'link', label: 'Conexión' },
] as const;
type Tab = typeof TABS[number]['id'];

const BRAND = '#0E6E52';
/** La página del comercio en la app GO (se ve con el link aunque la tienda esté oculta) */
const GO_STORE_URL = (comercioId: string) => `https://godelivery-magdalena.web.app/#/comercio/${encodeURIComponent(comercioId)}`;
const money = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);
const plural = (n: number, one: string, many: string) => `${n.toLocaleString('es-AR')} ${n === 1 ? one : many}`;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const WEEKDAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Buscando repartidor', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  accepted: { label: 'Comprando', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  confirmed: { label: 'Confirmado', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  preparing: { label: 'Preparando', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  ready: { label: 'Listo', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  delivering: { label: 'En camino', cls: 'bg-violet-50 text-violet-700 ring-violet-200' },
  completed: { label: 'Entregado', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  delivered: { label: 'Entregado', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  cancelled: { label: 'Cancelado', cls: 'bg-slate-100 text-slate-500 ring-slate-200' },
};
const errMsg = (e: any, fallback: string) => e?.response?.data?.message || e?.message || fallback;

function periodRange(p: Period) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const from = p === 'today' ? today : p === '7d' ? new Date(today.getTime() - 6 * 864e5) : p === '30d' ? new Date(today.getTime() - 29 * 864e5) : new Date(now.getFullYear(), now.getMonth(), 1);
  return { from: ymd(from), to: ymd(today) };
}

export default function GoScreen() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('numbers');

  const loadStatus = async () => {
    setError(null);
    try {
      const { data } = await api.get('/go/status');
      setStatus(data);
      try { localStorage.setItem('go_linked', data.linked ? '1' : '0'); } catch { /* sin almacenamiento */ }
    } catch (e) {
      setError(errMsg(e, 'No se pudo leer el estado de GO'));
    }
  };
  useEffect(() => { loadStatus(); }, []);

  return (
    <div className="h-full overflow-y-auto bg-slate-50 custom-scrollbar">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="space-y-4">
          <div className="min-w-0">
            <p className="text-[11.5px] font-semibold tracking-[0.14em] text-rose-600">GO DELIVERY</p>
            <h1 className="text-[24px] font-bold text-slate-900 tracking-tight">Ventas por la app GO</h1>
            <p className="text-[13px] text-slate-500">
              {status?.linked
                ? <>Tus productos están en GO como <b className="text-slate-700">{status.storeName}</b>{status.fulfillmentMode === 'shopper' ? '. Los pedidos los compra el repartidor en tu mostrador.' : '.'}</>
                : 'Publicá tus productos en la app GO y mirá lo que vendés por ahí.'}
            </p>
            {status?.linked && status.comercioId && (
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={() => openExternal(GO_STORE_URL(status.comercioId!))}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl bg-white border border-slate-200 text-[13px] font-semibold text-slate-700 hover:bg-slate-50">
                  <ExternalLink className="w-4 h-4" /> Ver mi tienda en GO{status.storeActive === false ? ' (todavía oculta al público)' : ''}
                </button>
                <PanelButton section="settings" label="Fotos, datos y horarios" />
                <PanelButton section="panel" label="Todo el panel de GO" />
              </div>
            )}
          </div>
          {status?.linked && (
            <div className="inline-flex flex-wrap gap-1 bg-white border border-slate-200 rounded-xl p-1 max-w-full">
              {TABS.map((t) => (
                <button key={t.id} onClick={() => setTab(t.id)}
                  className={`h-9 px-3.5 rounded-lg text-[13.5px] font-semibold whitespace-nowrap transition-colors ${tab === t.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {error ? (
          <ErrorBox text={error} onRetry={loadStatus} />
        ) : !status ? (
          <LoadingBox text="Cargando…" />
        ) : !status.linked ? (
          <LinkCard onLinked={(s) => { setStatus(s); setTab('publish'); }} />
        ) : (
          <>
            {status.unlinkedInGo && (
              <Notice tone="bad">GO ya no reconoce esta vinculación. Pedile un código nuevo a GO y volvé a vincular desde Conexión.</Notice>
            )}
            {status.storeActive === false && <Notice tone="warn">Tu comercio todavía no está visible en GO. Cuando GO lo active, tus clientes van a poder pedir.</Notice>}
            {!status.isMainPc && (
              <Notice tone="info">Esta PC no publica ni recibe los pedidos: lo hace <b>{status.mainPc || 'otra PC'}</b>. Los números y pedidos se ven igual (llegan por la sincronización).</Notice>
            )}
            {tab === 'numbers' && <NumbersTab />}
            {tab === 'orders' && <OrdersTab />}
            {tab === 'publish' && <PublishTab status={status} onChange={setStatus} />}
            {tab === 'link' && <LinkTab status={status} onChange={(s) => { setStatus(s); if (!s.linked) setTab('numbers'); }} />}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Abre el panel del comercio en la app GO con la sesión de la caja (sin iniciar sesión en GO):
 * el servidor pide un link de un solo uso que vence en 2 minutos.
 */
function PanelButton({ section, label }: { section: 'settings' | 'panel'; label: string }) {
  const [busy, setBusy] = useState(false);
  const open = async () => {
    setBusy(true);
    // En el navegador la pestaña se abre ya (en el toque): después de esperar al servidor se bloquea
    const tab = (window as any).__TAURI__ ? null : window.open('', '_blank');
    try {
      const { data } = await api.post('/go/panel-link', { section });
      if (tab) { tab.opener = null; tab.location.href = data.url; } else openExternal(data.url);
    } catch (e) {
      tab?.close();
      toast.error(errMsg(e, 'No se pudo abrir el panel de GO'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button onClick={open} disabled={busy}
      className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl text-white text-[13px] font-semibold disabled:opacity-60" style={{ background: BRAND }}>
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />} {label}
    </button>
  );
}

// ───────────────────────────────────────── vincular

function LinkCard({ onLinked }: { onLinked: (s: Status) => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const submit = async () => {
    setBusy(true);
    setErr('');
    try {
      const { data } = await api.post('/go/link', { code });
      toast.success('¡Listo! Tu caja quedó vinculada con GO');
      try { localStorage.setItem('go_linked', '1'); } catch { /* sin almacenamiento */ }
      onLinked(data);
    } catch (e) {
      setErr(errMsg(e, 'No se pudo vincular'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card title="Vincular con GO">
      <div className="grid gap-5 md:grid-cols-[1.2fr,1fr]">
        <div className="space-y-2 text-[13.5px] text-slate-600 leading-relaxed">
          <p>1. Pedile a GO el <b>código de vinculación</b> de tu comercio (8 letras y números).</p>
          <p>2. Pegalo acá y elegí qué productos se publican (uno por uno o por rubros). <b>Hasta que no elijas, no se publica nada.</b> Se publican sin stock: si algo falta, el repartidor lo marca y se oculta un día.</p>
          <p>3. Cada vez que cambies un precio o un producto en Ventra, se actualiza en GO.</p>
        </div>
        <div className="space-y-3">
          <label className="block text-[12.5px] font-semibold text-slate-600" htmlFor="go-code">Código de GO</label>
          <input id="go-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={12} autoComplete="off" placeholder="Ej: K7P2QX9M"
            className="w-full h-12 px-4 rounded-xl border border-slate-300 bg-white text-[18px] font-bold tracking-[0.2em] text-slate-900 uppercase" />
          {err && <p className="text-[13px] font-semibold text-rose-600">{err}</p>}
          <button onClick={submit} disabled={busy || code.replace(/[^A-Z0-9]/gi, '').length !== 8}
            className="w-full h-12 rounded-xl bg-slate-900 text-white text-[14px] font-bold flex items-center justify-center gap-2 disabled:opacity-50">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />} Vincular
          </button>
        </div>
      </div>
    </Card>
  );
}

// ───────────────────────────────────────── números

function NumbersTab() {
  const [period, setPeriod] = useState<Period>('7d');
  const [stats, setStats] = useState<Stats | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const range = useMemo(() => periodRange(period), [period]);
  const load = async () => {
    setLoading(true);
    setErr(null);
    try {
      const { data } = await api.get('/go/stats', { params: range });
      setStats(data);
    } catch (e) {
      setErr(errMsg(e, 'No se pudieron cargar los números'));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  const oneDay = period === 'today';
  const chart = useMemo(() => {
    if (!stats) return [];
    if (oneDay) return stats.byHour.map((n, h) => ({ label: `${h}h`, value: n }));
    const days: { label: string; value: number }[] = [];
    const map = new Map(stats.byDay.map((d) => [d.day, d.amount]));
    for (let t = new Date(`${range.from}T00:00:00`).getTime(); t <= new Date(`${range.to}T00:00:00`).getTime(); t += 864e5) {
      const k = ymd(new Date(t));
      days.push({ label: new Date(t).toLocaleDateString('es-AR', { day: 'numeric', month: 'short' }), value: map.get(k) || 0 });
    }
    return days;
  }, [stats, oneDay, range.from, range.to]);
  const busiest = stats ? stats.byWeekday.map((n, i) => ({ label: WEEKDAYS[i], value: n })) : [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap gap-1 bg-white border border-slate-200 rounded-xl p-1 max-w-full">
          {PERIODS.map((p) => (
            <button key={p.id} onClick={() => setPeriod(p.id)}
              className={`h-8 px-3 rounded-lg text-[13px] font-semibold whitespace-nowrap ${period === p.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{p.label}</button>
          ))}
        </div>
        <button onClick={load} disabled={loading} title="Actualizar" aria-label="Actualizar" className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-800 disabled:opacity-50">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {err ? <ErrorBox text={err} onRetry={load} /> : !stats ? <LoadingBox text="Cargando números…" /> : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Kpi label="Vendido por GO" value={money(stats.revenue)} hint="Productos de los pedidos entregados" strong />
            <Kpi label="Pedidos entregados" value={stats.delivered.toLocaleString('es-AR')} hint={plural(stats.itemsSold, 'producto', 'productos')} />
            <Kpi label="Ticket promedio" value={money(stats.avgTicket)} />
            <Kpi label="Demora promedio" value={stats.avgMinutes === null ? '—' : `${stats.avgMinutes} min`} hint="Desde que piden hasta que reciben" />
            <Kpi label="Cancelados" value={stats.cancelled.toLocaleString('es-AR')} hint={stats.open ? `${plural(stats.open, 'en curso', 'en curso')}` : undefined} />
          </div>
          {stats.orders === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-12 flex flex-col items-center gap-2 text-center">
              <ShoppingBag className="w-8 h-8 text-slate-300" />
              <p className="text-[14.5px] font-semibold text-slate-700">No hubo pedidos de GO en este período</p>
              <p className="text-[13px] text-slate-500">Probá con otro rango de fechas.</p>
            </div>
          ) : (
            <>
              <Card title={oneDay ? 'Pedidos por hora' : 'Vendido por día'}>
                <MiniBars data={chart} money={!oneDay} />
              </Card>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Card title="Lo que más se pide">
                  {stats.topProducts.length ? (
                    <div className="divide-y divide-slate-100 -my-2">
                      {stats.topProducts.map((p, i) => (
                        <div key={i} className="flex items-center gap-3 py-2.5">
                          <span className="w-6 text-[12.5px] font-bold text-slate-400 tabular-nums">{i + 1}</span>
                          <div className="flex-1 min-w-0">
                            <p className="text-[13.5px] font-semibold text-slate-800 truncate" title={p.name}>{p.name}</p>
                            <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                              <div className="h-full rounded-full bg-emerald-600" style={{ width: `${(p.qty / (stats.topProducts[0]?.qty || 1)) * 100}%` }} />
                            </div>
                          </div>
                          <span className="text-right shrink-0">
                            <span className="block text-[13.5px] font-bold text-slate-800 tabular-nums">{plural(p.qty, 'u.', 'u.')}</span>
                            <span className="block text-[11.5px] text-slate-500 tabular-nums">{money(p.amount)}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-[13px] text-slate-500">Todavía no hay pedidos entregados.</p>}
                </Card>
                <Card title="Lo que el repartidor no encontró">
                  {stats.missing.length ? (
                    <>
                      <p className="text-[12.5px] text-slate-500 -mt-1 mb-2">Revisá el stock de estos: cada faltante es una venta perdida.</p>
                      <div className="divide-y divide-slate-100 -my-1">
                        {stats.missing.map((m, i) => (
                          <div key={i} className="flex items-center justify-between gap-3 py-2">
                            <span className="text-[13.5px] text-slate-700 min-w-0 truncate" title={m.name}>{m.name}</span>
                            <span className="text-[12.5px] font-bold text-amber-700 shrink-0">{plural(m.times, 'vez', 'veces')}</span>
                          </div>
                        ))}
                      </div>
                    </>
                  ) : <p className="text-[13px] text-slate-500">No faltó nada. 👌</p>}
                </Card>
              </div>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <Card title="Días con más pedidos"><MiniBars data={busiest} /></Card>
                <Card title="Por qué se cancelaron">
                  {stats.cancelReasons.length ? (
                    <div className="space-y-2">
                      {stats.cancelReasons.map((r, i) => (
                        <div key={i} className="flex items-start justify-between gap-3 text-[13px]">
                          <span className="text-slate-700 min-w-0 break-words">{r.reason}</span>
                          <span className="font-bold text-slate-800 shrink-0 tabular-nums">{r.count}</span>
                        </div>
                      ))}
                    </div>
                  ) : <p className="text-[13px] text-slate-500">Ningún pedido cancelado.</p>}
                </Card>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function MiniBars({ data, money: isMoney = false }: { data: { label: string; value: number }[]; money?: boolean }) {
  return (
    <div className="h-56 -ml-2">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
          <XAxis dataKey="label" stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={10} />
          <YAxis stroke="#94a3b8" fontSize={11} tickLine={false} axisLine={false} width={isMoney ? 64 : 32} allowDecimals={false}
            tickFormatter={(v) => (isMoney ? (v >= 1000 ? `$${Math.round(v / 1000)}k` : `$${v}`) : String(v))} />
          <Tooltip cursor={{ fill: '#f1f5f9' }} formatter={(v: number) => [isMoney ? money(v) : v, isMoney ? 'Vendido' : 'Pedidos']}
            contentStyle={{ borderRadius: 12, border: '1px solid #e2e8f0', fontSize: 13 }} />
          <Bar isAnimationActive={false} dataKey="value" fill={BRAND} radius={[6, 6, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ───────────────────────────────────────── pedidos

function OrdersTab() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>('today');
  const [orders, setOrders] = useState<GoOrder[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const range = useMemo(() => periodRange(period), [period]);
  const load = async () => {
    setErr(null);
    try {
      const { data } = await api.get('/go/orders', { params: range });
      setOrders(data);
    } catch (e) {
      setErr(errMsg(e, 'No se pudieron cargar los pedidos'));
    }
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [range.from, range.to]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap gap-1 bg-white border border-slate-200 rounded-xl p-1 max-w-full">
          {PERIODS.map((p) => (
            <button key={p.id} onClick={() => setPeriod(p.id)}
              className={`h-8 px-3 rounded-lg text-[13px] font-semibold whitespace-nowrap ${period === p.id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>{p.label}</button>
          ))}
        </div>
        <button onClick={load} title="Actualizar" aria-label="Actualizar" className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:text-slate-800">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      {err ? <ErrorBox text={err} onRetry={load} /> : !orders ? <LoadingBox text="Cargando pedidos…" /> : orders.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-12 flex flex-col items-center gap-2 text-center">
          <Bike className="w-8 h-8 text-slate-300" />
          <p className="text-[14.5px] font-semibold text-slate-700">No hay pedidos de GO en este período</p>
        </div>
      ) : (
        <Card title={plural(orders.length, 'pedido', 'pedidos')}>
          <div className="divide-y divide-slate-100 -my-2">
            {orders.map((o) => {
              const st = STATUS[o.status] || { label: o.status, cls: 'bg-slate-50 text-slate-600 ring-slate-200' };
              const isOpen = open === o.id;
              const missing = o.items.filter((i) => i.shopStatus === 'missing').length;
              return (
                <div key={o.id}>
                  <button onClick={() => setOpen(isOpen ? null : o.id)} className="w-full flex items-center gap-3 py-3 text-left">
                    <div className="flex-1 min-w-0">
                      <p className="text-[14px] font-semibold text-slate-800 truncate">
                        {o.customer || 'Cliente'}{o.number ? <span className="text-slate-400 font-medium"> · #{o.number}</span> : null}
                      </p>
                      <p className="text-[12.5px] text-slate-500 truncate">
                        {new Date(o.createdMs).toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        {` · ${plural(o.items.length, 'producto', 'productos')}`}{o.driverName ? ` · ${o.driverName}` : ''}{missing ? ` · faltaron ${missing}` : ''}
                      </p>
                    </div>
                    <span className={`text-[14px] font-bold tabular-nums shrink-0 ${o.status === 'cancelled' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                      {money(o.shopPending ? o.estimatedSubtotal : o.subtotal)}
                    </span>
                    <span className={`hidden sm:inline text-[11px] font-bold px-2 py-0.5 rounded-full ring-1 shrink-0 ${st.cls}`}>{st.label}</span>
                    <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {isOpen && (
                    <div className="mb-3 rounded-xl bg-slate-50 border border-slate-200 divide-y divide-slate-200/70">
                      <div className="px-4 py-2 text-[12.5px] text-slate-600 sm:hidden"><span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ring-1 ${st.cls}`}>{st.label}</span></div>
                      {o.items.map((i, k) => (
                        <div key={k} className="flex items-start gap-3 px-4 py-2 text-[13px]">
                          <span className="w-10 text-slate-500 tabular-nums shrink-0">{i.shopStatus === 'missing' ? `${i.orderedQty ?? i.qty}×` : `${i.qty}×`}</span>
                          <span className="flex-1 min-w-0 break-words">
                            <span className={i.shopStatus === 'missing' ? 'text-slate-400 line-through' : 'text-slate-700'}>{i.name}</span>
                            {i.shopStatus === 'missing' && <span className="block text-[11.5px] font-semibold text-amber-700">No había</span>}
                            {i.shopStatus === 'partial' && <span className="block text-[11.5px] font-semibold text-amber-600">Había {i.qty} de {i.orderedQty}</span>}
                            {i.shopStatus === 'replaced' && i.replacement && <span className="block text-[11.5px] font-semibold text-amber-600">Cambiado por {i.replacement.name}</span>}
                          </span>
                          <span className="font-semibold text-slate-700 tabular-nums shrink-0">{money((Number(i.price) || 0) * (Number(i.qty) || 0))}</span>
                        </div>
                      ))}
                      {o.cancelReason && <div className="px-4 py-2 text-[12.5px] text-slate-500 break-words">Motivo: {o.cancelReason}</div>}
                      {o.shopPending && o.status !== 'cancelled' && <div className="px-4 py-2 text-[12.5px] text-slate-500">Total aproximado: se confirma cuando el repartidor compra.</div>}
                      {o.saleId && <div className="px-4 py-2 text-[12.5px] font-semibold text-emerald-700">Cobrado en la caja</div>}
                      {isChargeable(o) && (
                        <div className="px-4 py-3">
                          <button onClick={() => { if (loadGoOrderInCart(o)) navigate('/pos'); }}
                            className="w-full sm:w-auto h-10 px-4 rounded-xl text-white font-semibold text-[13.5px] flex items-center justify-center gap-2" style={{ background: BRAND }}>
                            <ShoppingBag className="w-4 h-4" /> Cobrar en la caja
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}

// ───────────────────────────────────────── qué se publica

type GoProduct = { id: string; name: string; barcode?: string | null; price: number; category?: string | null; categoryId?: string | null; published: boolean; override: boolean | null; reason?: string };

function PublishTab({ status, onChange }: { status: Status; onChange: (s: Status) => void }) {
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [mode, setMode] = useState(status.publishMode || 'selected');
  const [selCats, setSelCats] = useState<string[]>(status.publishCategories || []);
  const [syncStock, setSyncStock] = useState(!!status.syncStock);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [only, setOnly] = useState<'' | 'published' | 'hidden'>('');
  const [products, setProducts] = useState<GoProduct[] | null>(null);
  const [clearing, setClearing] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const dirty = mode !== status.publishMode || syncStock !== !!status.syncStock || JSON.stringify([...selCats].sort()) !== JSON.stringify([...(status.publishCategories || [])].sort());

  useEffect(() => {
    // "Sin rubro" es un rubro más (backend: NO_CATEGORY)
    const none = { id: '__none__', name: 'Sin rubro' };
    api.get('/categories').then(({ data }) => setCats([...(Array.isArray(data) ? data : []).filter((c: any) => c.isActive !== false).map((c: any) => ({ id: c.id, name: c.name })), none])).catch(() => setCats([none]));
  }, []);
  const loadProducts = async () => {
    try {
      const { data } = await api.get('/go/products', { params: { search: search || undefined, only: only || undefined } });
      setProducts(data);
    } catch { setProducts([]); }
  };
  useEffect(() => {
    const t = setTimeout(loadProducts, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, only, status.publishMode, (status.publishCategories || []).join(',')]);

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await api.put('/go/settings', { publishMode: mode, publishCategories: selCats, syncStock });
      onChange(data);
      toast.success('Guardado: se actualiza en GO en unos segundos');
    } catch (e) {
      toast.error(errMsg(e, 'No se pudo guardar'));
    } finally {
      setSaving(false);
    }
  };
  const setOne = async (p: GoProduct, publish: boolean | null) => {
    try {
      await api.put('/go/products', { ids: [p.id], publish });
      loadProducts();
    } catch (e) {
      toast.error(errMsg(e, 'No se pudo cambiar'));
    }
  };
  /** Todos los productos quedan sin publicar ("Solo los que elijo" sin nada elegido) */
  const unpublishAll = async () => {
    const ok = await confirm({
      title: '¿Sacar todos los productos de la tienda?',
      message: 'Ningún producto se va a ver en GO. La tienda queda en "Solo los que elijo", sin nada elegido, y después podés volver a publicar los que quieras. No se borra nada de tu caja.',
      confirmLabel: 'Sí, sacar todos',
      danger: true,
    });
    if (!ok) return;
    setClearing(true);
    try {
      const { data } = await api.post('/go/products/unpublish-all');
      onChange(data);
      setMode('selected');
      loadProducts();
      toast.success('Listo: en unos segundos ningún producto se ve en GO');
      // El contador baja cuando GO termina de ocultarlos
      setTimeout(() => { api.get('/go/status').then(({ data: s }) => onChange(s)).catch(() => {}); }, 6000);
    } catch (e) {
      toast.error(errMsg(e, 'No se pudo sacar los productos'));
    } finally {
      setClearing(false);
    }
  };
  const toggleCat = (id: string) => setSelCats((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  return (
    <div className="space-y-5">
      {confirmDialog}
      <Card title="Qué productos se ven en GO">
        <div className="grid gap-2 grid-cols-2 lg:grid-cols-4">
          {([
            ['sold', 'Lo que se vende', 'Lo vendido en la caja; lo nuevo se suma solo'],
            ['all', 'Todo el catálogo', 'Todos los productos con precio'],
            ['categories', 'Por rubros', 'Solo los rubros que elijas'],
            ['selected', 'Solo los que elijo', 'Uno por uno, abajo'],
          ] as const).map(([id, title, sub]) => (
            <button key={id} onClick={() => setMode(id)}
              className={`text-left rounded-xl border p-3 transition-colors ${mode === id ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
              <span className="block text-[13.5px] font-bold">{title}</span>
              <span className={`block text-[12px] ${mode === id ? 'text-slate-300' : 'text-slate-500'}`}>{sub}</span>
            </button>
          ))}
        </div>
        {mode === 'sold' && (
          <p className="mt-3 text-[12.5px] text-slate-500 leading-relaxed">
            Se publica todo lo que se vendió alguna vez en la caja. Cuando se vende algo que no estaba en la tienda, se suma solo en unos segundos.
            Si el repartidor marca que no había, se saca hasta que se vuelva a vender en el kiosco. Lo que saques a mano no vuelve solo.
          </p>
        )}
        {mode === 'categories' && (
          <div className="mt-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
              <p className="text-[12.5px] font-semibold text-slate-600">{plural(selCats.length, 'rubro elegido', 'rubros elegidos')}</p>
              <div className="flex gap-2">
                <button onClick={() => setSelCats(cats.map((c) => c.id))} className="h-8 px-3 rounded-lg border border-slate-200 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-50">Todos</button>
                <button onClick={() => setSelCats([])} className="h-8 px-3 rounded-lg border border-slate-200 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-50">Ninguno</button>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 max-h-56 overflow-y-auto">
              {cats.map((c) => (
                <button key={c.id} onClick={() => toggleCat(c.id)}
                  className={`max-w-full h-9 px-3 rounded-full text-[13px] font-semibold border truncate ${selCats.includes(c.id) ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                  {c.name}
                </button>
              ))}
              {!cats.length && <p className="text-[13px] text-slate-500">No hay rubros cargados.</p>}
            </div>
          </div>
        )}
        <label className="mt-5 flex items-start gap-3 rounded-xl border border-slate-200 p-3 cursor-pointer">
          <input type="checkbox" checked={syncStock} onChange={(e) => setSyncStock(e.target.checked)} className="mt-1 w-4 h-4 accent-emerald-600 shrink-0" />
          <span className="min-w-0">
            <span className="block text-[13.5px] font-bold text-slate-800">Mandar también el stock</span>
            <span className="block text-[12.5px] text-slate-500">Recomendado apagado: si el stock de la caja no es exacto, en GO aparecerían agotados productos que sí tenés. Apagado, si algo falta el repartidor lo marca y se oculta por un día.</span>
          </span>
        </label>
        <div className="mt-4 flex flex-wrap items-center justify-end gap-3">
          {dirty && <span className="text-[12.5px] text-amber-600 font-semibold">Hay cambios sin guardar</span>}
          <button onClick={save} disabled={!dirty || saving} className="h-10 px-5 rounded-xl bg-slate-900 text-white text-[13.5px] font-bold disabled:opacity-40 flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Guardar
          </button>
        </div>
      </Card>

      <Card title="Producto por producto" action={
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span className="text-[12.5px] text-slate-500">{plural(status.publishedCount || 0, 'publicado', 'publicados')}</span>
          <button onClick={unpublishAll} disabled={clearing || !(status.publishedCount || 0)}
            className="h-8 px-3 rounded-lg border border-rose-200 bg-white text-[12.5px] font-semibold text-rose-600 hover:bg-rose-50 disabled:opacity-40 flex items-center gap-1.5">
            {clearing && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Sacar todos de la tienda
          </button>
        </div>
      }>
        <p className="text-[12.5px] text-slate-500 -mt-1 mb-3">Podés sumar o sacar productos sueltos, aunque no estén en los rubros elegidos. El nombre que se ve en la app se cambia desde GO.</p>
        <div className="flex flex-wrap gap-2 mb-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre o código" className="w-full h-10 pl-9 pr-3 rounded-xl border border-slate-300 bg-white text-[13.5px]" />
          </div>
          <select value={only} onChange={(e) => setOnly(e.target.value as any)} className="h-10 px-3 rounded-xl border border-slate-300 bg-white text-[13.5px]">
            <option value="">Todos</option>
            <option value="published">Publicados</option>
            <option value="hidden">Sin publicar</option>
          </select>
        </div>
        {!products ? <LoadingBox text="Cargando productos…" /> : products.length === 0 ? (
          <p className="text-[13px] text-slate-500 py-4 text-center">No hay productos con ese filtro.</p>
        ) : (
          <div className="divide-y divide-slate-100 -my-1">
            {products.map((p) => (
              <div key={p.id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <p className="text-[13.5px] font-semibold text-slate-800 truncate" title={p.name}>{p.name}</p>
                  <p className="text-[12px] text-slate-500 truncate">{money(p.price)}{p.category ? ` · ${p.category}` : ''}{p.reason ? ` · ${p.reason}` : ''}</p>
                </div>
                {p.override !== null && (
                  <button onClick={() => setOne(p, null)} className="hidden sm:block h-8 px-2.5 rounded-lg text-[12px] font-semibold text-slate-500 hover:bg-slate-100 shrink-0" title="Que siga la regla general">Como el resto</button>
                )}
                <button onClick={() => setOne(p, !p.published)} disabled={p.reason === 'Sin precio' || (p.reason || '').startsWith('Por peso')}
                  className={`h-8 px-3 rounded-lg text-[12.5px] font-bold shrink-0 disabled:opacity-40 ${p.published ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-white text-slate-600 ring-1 ring-slate-200'}`}>
                  {p.published ? 'Publicado' : 'Publicar'}
                </button>
              </div>
            ))}
          </div>
        )}
        {products && products.length >= 300 && <p className="text-[12.5px] text-slate-500 mt-2">Se muestran 300: buscá para encontrar otros.</p>}
      </Card>
    </div>
  );
}

// ───────────────────────────────────────── conexión

function LinkTab({ status, onChange }: { status: Status; onChange: (s: Status) => void }) {
  const [busy, setBusy] = useState('');
  const run = async (what: string, fn: () => Promise<any>, ok: string) => {
    setBusy(what);
    try {
      const { data } = await fn();
      onChange(data);
      toast.success(ok);
    } catch (e) {
      toast.error(errMsg(e, 'No se pudo'));
    } finally {
      setBusy('');
    }
  };
  const when = (ms?: number | null) => (ms ? new Date(ms).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : 'todavía no');
  return (
    <div className="space-y-5">
      <Card title="Tu comercio en GO">
        <dl className="grid gap-3 sm:grid-cols-2 text-[13.5px]">
          <Row k="Nombre en GO" v={status.storeName || '—'} />
          <Row k="Cómo se arman los pedidos" v={status.fulfillmentMode === 'shopper' ? 'Lo compra el repartidor en tu mostrador' : 'Los prepara el comercio'} />
          <Row k="Productos publicados" v={(status.publishedCount || 0).toLocaleString('es-AR')} />
          <Row k="Estado en la app" v={status.storeActive === false ? 'Todavía no visible' : status.storePaused ? 'Pausado' : 'Visible'} />
        </dl>
        {status.fulfillmentMode === 'shopper' && (
          <p className="mt-4 text-[12.5px] text-slate-500 leading-relaxed">El pedido va directo a los repartidores, sin que tengas que aceptarlo. El repartidor viene, elige los productos y paga en el mostrador: cobrale como a cualquier cliente.</p>
        )}
      </Card>
      <Card title="Esta PC">
        <dl className="grid gap-3 sm:grid-cols-2 text-[13.5px]">
          <Row k="Publica y recibe los pedidos" v={status.isMainPc ? 'Sí, esta PC' : (status.mainPc || 'Otra PC')} />
          <Row k="Última publicación" v={when(status.lastPushAt)} />
          <Row k="Última consulta de pedidos" v={when(status.lastPollAt)} />
          {status.lastError && <Row k="Último problema" v={status.lastError} bad />}
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          {status.isMainPc ? (
            <button onClick={() => run('sync', () => api.post('/go/sync-now'), 'Publicado')} disabled={!!busy} className="h-10 px-4 rounded-xl bg-slate-900 text-white text-[13.5px] font-bold disabled:opacity-50 flex items-center gap-2">
              {busy === 'sync' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Publicar ahora
            </button>
          ) : (
            <button onClick={() => run('main', () => api.post('/go/main-pc'), 'Ahora esta PC publica y recibe los pedidos')} disabled={!!busy} className="h-10 px-4 rounded-xl bg-slate-900 text-white text-[13.5px] font-bold disabled:opacity-50">
              Usar esta PC para GO
            </button>
          )}
          <button
            onClick={() => { if (window.confirm('¿Desvincular la caja de GO? Tus productos dejan de actualizarse en la app.')) run('unlink', () => api.post('/go/unlink'), 'Caja desvinculada de GO'); }}
            disabled={!!busy} className="h-10 px-4 rounded-xl border border-rose-200 text-rose-600 text-[13.5px] font-bold hover:bg-rose-50 disabled:opacity-50">
            Desvincular
          </button>
        </div>
      </Card>
    </div>
  );
}

// ───────────────────────────────────────── piezas

function Row({ k, v, bad }: { k: string; v: string; bad?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-slate-500">{k}</dt>
      <dd className={`font-semibold break-words ${bad ? 'text-rose-600' : 'text-slate-800'}`}>{v}</dd>
    </div>
  );
}

function Notice({ tone, children }: { tone: 'bad' | 'warn' | 'info'; children: React.ReactNode }) {
  const cls = tone === 'bad' ? 'bg-rose-50 border-rose-200 text-rose-800' : tone === 'warn' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-sky-50 border-sky-200 text-sky-800';
  return <div className={`rounded-2xl border px-4 py-3 text-[13px] leading-relaxed ${cls}`}>{children}</div>;
}

function ErrorBox({ text, onRetry }: { text: string; onRetry: () => void }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-10 flex flex-col items-center gap-2 text-center">
      <AlertCircle className="w-7 h-7 text-rose-500" />
      <p className="text-[14px] font-semibold text-slate-700 break-words">{text}</p>
      <button onClick={onRetry} className="mt-2 h-10 px-4 rounded-xl bg-rose-600 text-white text-[13.5px] font-bold">Reintentar</button>
    </div>
  );
}

function LoadingBox({ text }: { text: string }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-12 flex items-center justify-center gap-2 text-slate-400 text-[13.5px] font-semibold">
      <Loader2 className="w-5 h-5 animate-spin" /> {text}
    </div>
  );
}

function Card({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="px-5 pt-4 pb-3 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-bold text-slate-900 tracking-tight min-w-0">{title}</h2>
        {action}
      </header>
      <div className="px-5 pb-5">{children}</div>
    </section>
  );
}

function Kpi({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] min-w-0">
      <p className="text-[12.5px] text-slate-500">{label}</p>
      <p className={`mt-1 text-[22px] font-bold tabular-nums tracking-tight break-words ${strong ? 'text-emerald-700' : 'text-slate-900'}`}>{value}</p>
      {hint && <p className="text-[11.5px] text-slate-400 mt-0.5">{hint}</p>}
    </div>
  );
}
