import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Plus, Minus, Search, X, ClipboardList, WifiOff, ShoppingCart, Trash2, Loader2, ChevronDown, ChevronUp,
    MapPin, Check, PencilLine, Store, AlertTriangle, RotateCcw, CalendarDays, UserPlus,
} from 'lucide-react';
import api from '../../services/api';
import { usePOSStore, packOf } from '../../stores/posStore';
import { useAuthStore } from '../../stores/authStore';
import { myWorkRole } from '../../services/workRole';
import { readRouteDays, saveRouteDays, zonesFor, dayName, WEEK, ROUTE_DAYS_EVENT, type RouteDays } from '../../services/routeDays';
import { STORE_SETTINGS_EVENT } from '../../services/storeSettings';
import { useOwnerMobile } from '../../utils/ownerMobile';
import { ScreenHeader, HeaderAction, Chips } from '../mobile/ui';
import { useMobileFocus } from '../mobile/MobileShell';
import { useAutoTour } from '../common/tour/GuidedTour';
import { setTourScreen } from '../common/tour/tourContext';
import {
  newPreOrderId, savePreOrder, flushPreOrderQueue, readQueue, loadPreOrderIntoCart, priceFor, withOffers,
  PREORDER_QUEUE_EVENT, type PreOrderItem,
} from '../../services/preorders';

/**
 * Preventa (distribuidora). En el celular del vendedor: tomar pedidos, con o sin señal.
 * En la PC: ver los pedidos por día y localidad y pasarlos a la caja para cobrarlos.
 */

const CATALOG_CACHE = 'ventra_preventa_catalog';
const CLIENTS_CACHE = 'ventra_preventa_clients';
/** Unidades de cada producto que ya están en pedidos pendientes (stock comprometido) */
const COMMITTED_CACHE = 'ventra_preventa_committed';
/** El último pedido de cada cliente, para repetirlo (también sin señal) */
const LAST_CACHE = 'ventra_preventa_last_orders';
/** El pedido que se está armando: si se cierra la app o se sale sin querer, no se pierde */
const DRAFT_KEY = 'ventra_preorder_draft';

const money = (n: number) => `$ ${(Math.round((n || 0) * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
const qtyFmt = (n: number) => (Math.round(n * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 });
const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const plural = (n: number, one: string, many: string) => `${qtyFmt(n)} ${n === 1 ? one : many}`;

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  PENDING: { label: 'Pendiente', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  BILLED: { label: 'Vendido', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  CANCELLED: { label: 'Cancelado', cls: 'bg-slate-100 text-slate-500 border-slate-200' },
};

const readJson = (k: string, fallback: any) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? fallback; } catch { return fallback; } };
const writeJson = (k: string, v: any) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sin espacio: se sigue con lo que hay */ } };

interface Draft { id: string; takenAt?: string; orderNumber?: number; client: any | null; items: PreOrderItem[]; notes: string; savedAt?: string }
const readDraft = (): Draft | null => {
  const d = readJson(DRAFT_KEY, null);
  return d && (d.client || d.items?.length) ? d : null;
};
const clearDraft = () => { try { localStorage.removeItem(DRAFT_KEY); } catch { /* nada que borrar */ } };

/** Catálogo y clientes: del servidor si hay señal, si no lo último que se bajó en este equipo */
function useCatalog() {
  const [products, setProducts] = useState<any[]>(() => readJson(CATALOG_CACHE, []));
    const [clients, setClients] = useState<any[]>(() => readJson(CLIENTS_CACHE, []));
    const [committed, setCommitted] = useState<Record<string, number>>(() => readJson(COMMITTED_CACHE, {}));
  const [lastOrders, setLastOrders] = useState<Record<string, any>>(() => readJson(LAST_CACHE, {}));
  useEffect(() => {
    api.get('/products/pos-catalog', { silent: true } as any).then(({ data }) => {
      const list = (data?.products || []).map((p: any) => ({
        id: p.id, name: p.name, barcode: p.barcode, sku: p.sku, salePrice: p.salePrice, stock: p.stock,
        unitsPerPack: p.unitsPerPack, packPrice: p.packPrice, salesCount: p.salesCount || 0,
      }));
      setProducts(list);
      writeJson(CATALOG_CACHE, list);
    }).catch(() => {});
    api.get('/clients', { silent: true } as any).then(({ data }) => {
            const list = (data || []).map((c: any) => ({ id: c.id, name: c.name, locality: c.locality, address: c.address, phone: c.phone, cuit: c.cuit, dni: c.dni, ivaCondition: c.ivaCondition, balance: c.balance, creditLimit: c.creditLimit }));
      setClients(list);
            writeJson(CLIENTS_CACHE, list);
    }).catch(() => {});
    api.get('/preorders/committed', { silent: true } as any).then(({ data }) => {
      setCommitted(data || {});
            writeJson(COMMITTED_CACHE, data || {});
    }).catch(() => {});
    api.get('/preorders/last-by-client', { silent: true } as any).then(({ data }) => {
      setLastOrders(data || {});
      writeJson(LAST_CACHE, data || {});
    }).catch(() => {});
  }, []);
  return { products, clients, committed, lastOrders };
}

function useQueue() {
  const [queue, setQueue] = useState(readQueue());
  useEffect(() => {
    const refresh = () => setQueue(readQueue());
    const flush = () => flushPreOrderQueue().then(({ sent, failed }) => {
      if (sent) toast.success(sent === 1 ? 'Se envió el pedido que esperaba señal' : `Se enviaron ${sent} pedidos que esperaban señal`);
      failed.forEach((f) => toast.error(`No se pudo enviar un pedido. ${f}`, { duration: 8000 }));
    });
    window.addEventListener(PREORDER_QUEUE_EVENT, refresh);
    window.addEventListener('online', flush);
    const timer = window.setInterval(flush, 20000);
    flush();
    return () => { window.removeEventListener(PREORDER_QUEUE_EVENT, refresh); window.removeEventListener('online', flush); window.clearInterval(timer); };
  }, []);
  return queue;
}

export default function PreventaScreen() {
  const [params, setParams] = useSearchParams();
  const [draft, setDraft] = useState<Draft | null>(readDraft);
  // ?nuevo=1 (desde "Hoy"): abre el pedido nuevo, o el borrador si había uno a medio armar
  const [editing, setEditing] = useState<Draft | null>(() => (params.get('nuevo') ? readDraft() || { id: newPreOrderId(), takenAt: new Date().toISOString(), client: null, items: [], notes: '' } : null));
  useEffect(() => { if (params.toString()) setParams({}, { replace: true }); }, []);
  const catalog = useCatalog();
  const queue = useQueue();

  const open = (d: Draft) => setEditing(d);
  const startNew = () => open({ id: newPreOrderId(), takenAt: new Date().toISOString(), client: null, items: [], notes: '' });
  const fromOrder = (o: any): Draft => ({
    id: o.id, orderNumber: o.orderNumber, client: o.client || null, notes: o.notes || '',
    items: (o.items || []).map((i: any) => ({ productId: i.productId, productName: i.productName, quantity: Number(i.quantity), packSize: i.packSize || null, unitPrice: Number(i.unitPrice) })),
  });

  if (editing) {
    return (
      <OrderEditor
        initial={editing}
        {...catalog}
        onExit={(kept) => { setDraft(kept ? readDraft() : null); setEditing(null); }}
      />
    );
  }
  return (
    <OrderList
      clients={catalog.clients}
      queue={queue}
      draft={draft}
      onNew={() => (draft ? open(draft) : startNew())}
      onResume={() => draft && open(draft)}
      onDiscard={() => { clearDraft(); setDraft(null); }}
            onEdit={(o) => open(fromOrder(o))}
      onNewFor={(c) => open({ id: newPreOrderId(), takenAt: new Date().toISOString(), client: c, items: [], notes: '' })}
    />
  );
}

// ─── Lista ────────────────────────────────────────────────────────

function OrderList({ clients, queue, draft, onNew, onResume, onDiscard, onEdit, onNewFor }: {
  clients: any[]; queue: any[]; draft: Draft | null;
    onNew: () => void; onResume: () => void; onDiscard: () => void; onEdit: (o: any) => void; onNewFor: (client: any) => void;
}) {
  const navigate = useNavigate();
    const inShell = useOwnerMobile().active;
  const [orders, setOrders] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
  setTourScreen({ mobile: inShell });
  useAutoTour('distribPreventa', !loading);
  // El vendedor arranca viendo solo los pedidos que tomó él
  const isSeller = myWorkRole() === 'VENDEDOR';
  const [mine, setMine] = useState(isSeller);
  const [status, setStatus] = useState('PENDING');
  const [range, setRange] = useState<'today' | 'week' | 'all'>('week');
  const [locality, setLocality] = useState('');
  const [open, setOpen] = useState<string | null>(null);
    const localities = useMemo(() => Array.from(new Set(clients.map((c) => (c.locality || '').trim()).filter(Boolean))).sort(), [clients]);

  // Recorrido fijo: las localidades de hoy y sus clientes que todavía no pidieron
  const routeDays = useRouteDays();
  const todayZones = zonesFor(routeDays);
  const [todayOrders, setTodayOrders] = useState<any[]>([]);
  useEffect(() => {
    if (!todayZones.length) return;
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    // Ya pidió: un pedido de hoy, o uno anterior que todavía no salió (pendiente)
    Promise.all([
      api.get('/preorders', { params: { status: 'ALL', from: from.toISOString() }, silent: true } as any),
      api.get('/preorders', { params: { status: 'PENDING' }, silent: true } as any),
    ]).then(([hoy, pend]) => setTodayOrders([...(hoy.data || []), ...(pend.data || [])])).catch(() => {});
  }, [todayZones.join('|'), queue.length]);
  const orderedToday = new Set([
    ...todayOrders.filter((o) => o.status !== 'CANCELLED').map((o) => o.clientId),
    ...queue.map((q: any) => q.clientId),
  ]);
  const todayClients = clients.filter((c) => todayZones.includes((c.locality || '').trim()));
  const toVisit = todayClients.filter((c) => !orderedToday.has(c.id)).sort((a, b) => (a.locality || '').localeCompare(b.locality || '', 'es') || a.name.localeCompare(b.name, 'es'));
  const [showAllVisit, setShowAllVisit] = useState(false);
  const [editingRoute, setEditingRoute] = useState(false);
  const isAdmin = useAuthStore.getState().user?.role === 'ADMIN';

  const load = () => {
    setLoading(true);
    const params: any = { status };
    if (range !== 'all') {
      const from = new Date();
      from.setHours(0, 0, 0, 0);
      if (range === 'week') from.setDate(from.getDate() - 6);
      params.from = from.toISOString();
    }
        if (locality) params.locality = locality;
    if (mine) params.mine = '1';
    api.get('/preorders', { params, silent: true } as any)
      .then(({ data }) => setOrders(data || []))
      .catch(() => setOrders([]))
      .finally(() => setLoading(false));
  };
    useEffect(load, [status, range, locality, mine, queue.length]);

  const totals = useMemo(() => {
    let bultos = 0;
    let total = 0;
    for (const o of orders) {
      if (o.status === 'CANCELLED') continue;
      total += Number(o.total) || 0;
      for (const it of o.items || []) if (Number(it.packSize) > 1) bultos += Number(it.quantity) / Number(it.packSize);
    }
    return { total, bultos };
  }, [orders]);

  const toCaja = async (order: any) => {
    const st = usePOSStore.getState();
    if (!st.products.length) {
      try { st.setProducts((await api.get('/products/pos-catalog')).data?.products || []); } catch { /* sin catálogo: abajo se avisa qué faltó */ }
    }
    const missing = loadPreOrderIntoCart(order);
    if (missing.length) toast(`Estos productos ya no existen y no se cargaron: ${missing.join(', ')}`, { icon: '⚠️', duration: 8000 });
    else toast.success(`Pedido N° ${order.orderNumber} en la caja: revisalo y cobralo`);
    navigate('/pos');
  };

  const cancel = async (order: any) => {
    if (!window.confirm(`¿Cancelar el pedido N° ${order.orderNumber} de ${order.client?.name || 'sin cliente'}? No se puede deshacer.`)) return;
    try { await api.post(`/preorders/${order.id}/cancel`); toast.success('Pedido cancelado'); load(); }
    catch (err: any) { toast.error(err?.response?.data?.message || 'No se pudo cancelar'); }
  };

  const chip = (on: boolean) => `shrink-0 px-3.5 h-9 rounded-full text-[13px] font-semibold border transition-colors cursor-pointer ${on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`;

  const statusOptions = [['PENDING', 'Pendientes'], ['BILLED', 'Vendidos'], ['CANCELLED', 'Cancelados'], ['ALL', 'Todos']] as const;
  const live = orders.filter((o) => o.status !== 'CANCELLED').length;
  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      {inShell && (
        // En el celular, el encabezado verde de la app con los filtros de estado
        <div className="sticky top-0 z-20">
        <ScreenHeader title="Pedidos"
          subtitle={loading ? 'Cargando…' : `${plural(live, 'pedido', 'pedidos')} · ${qtyFmt(totals.bultos)} bultos · ${money(totals.total)}`}
          action={<span data-tour="preventa-new"><HeaderAction icon={Plus} label="Nuevo" onClick={onNew} /></span>}>
          <Chips options={statusOptions.map(([id, label]) => ({ id, label }))} value={status as any} onChange={(v) => setStatus(v)} />
        </ScreenHeader>
        </div>
      )}
      <div className={`max-w-3xl mx-auto space-y-4 pb-28 ${inShell ? 'px-4 pt-4' : 'px-4 py-6'}`}>
        {inShell && useAuthStore.getState().user?.role !== 'ADMIN' && !myWorkRole() && (
          <button onClick={() => navigate('/empezar')} className="text-[12px] font-semibold text-slate-400 cursor-pointer">Cambiar lo que hago en este equipo</button>
        )}
        {!inShell && <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {<h1 className="text-[24px] font-bold text-slate-900 tracking-tight leading-tight">Preventa</h1>}
            <p className="text-[13.5px] text-slate-500 leading-snug">Los pedidos que toman los vendedores. Salen en un reparto o se cobran en el mostrador.</p>
            {useAuthStore.getState().user?.role !== 'ADMIN' && !myWorkRole() && (
              <button onClick={() => navigate('/empezar')} className="mt-1 text-[12px] font-semibold text-slate-400 hover:text-slate-600 cursor-pointer">Cambiar lo que hago en este equipo</button>
            )}
          </div>
          <button data-tour="preventa-new" onClick={onNew} className="shrink-0 flex items-center gap-1.5 h-11 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[14px] font-bold cursor-pointer active:scale-[0.98] shadow-sm">
            <Plus className="w-4 h-4" /> Nuevo pedido
          </button>
        </div>}

        {draft && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-white border-2 border-rose-200">
            <PencilLine className="w-5 h-5 text-rose-600 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-[14px] font-bold text-slate-900">Pedido sin terminar</p>
              <p className="text-[12.5px] text-slate-500 truncate">
                {draft.client?.name || 'Sin cliente'}{draft.items.length ? ` · ${plural(draft.items.length, 'producto', 'productos')}` : ''}
              </p>
            </div>
            <button onClick={onDiscard} className="text-[12.5px] font-semibold text-slate-500 hover:text-slate-700 px-2 cursor-pointer">Descartar</button>
            <button onClick={onResume} className="h-9 px-3.5 rounded-xl bg-rose-600 text-white text-[13px] font-bold cursor-pointer">Seguir</button>
          </div>
        )}

                {todayZones.length > 0 ? (
          <section data-tour="preventa-today" className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
            <div className="px-4 pt-3.5 pb-2 flex items-start gap-3">
              <CalendarDays className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-[14.5px] font-bold text-slate-900 leading-tight">Hoy {dayName(new Date().getDay())} te toca: {todayZones.join(', ')}</p>
                <p className="text-[12.5px] text-slate-500 mt-0.5">
                  {todayClients.length === 0 ? 'Todavía no hay clientes cargados en esas localidades.'
                    : toVisit.length === 0 ? (todayClients.length === 1 ? 'Ya pidió el cliente de hoy.' : `Ya pidieron los ${todayClients.length} clientes de hoy.`)
                    : `${plural(todayClients.length - toVisit.length, 'cliente ya pidió', 'clientes ya pidieron')} · ${plural(toVisit.length, 'falta', 'faltan')}`}
                </p>
              </div>
              {isAdmin && <button onClick={() => setEditingRoute(true)} className="text-[12.5px] font-bold text-rose-700 cursor-pointer shrink-0">Días</button>}
            </div>
            {toVisit.length > 0 && (
              <div className="divide-y divide-slate-100 border-t border-slate-100">
                {(showAllVisit ? toVisit : toVisit.slice(0, 5)).map((c) => (
                  <button key={c.id} onClick={() => onNewFor(c)} className="w-full text-left px-4 py-2.5 flex items-center gap-3 cursor-pointer hover:bg-slate-50">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-semibold text-slate-900 truncate">{c.name}</span>
                      <span className="block text-[12px] text-slate-500 truncate">{[c.address, c.locality].filter(Boolean).join(', ') || 'Sin dirección'}</span>
                    </span>
                    <span className="text-[12.5px] font-bold text-rose-700 shrink-0 flex items-center gap-1"><Plus className="w-3.5 h-3.5" /> Pedido</span>
                  </button>
                ))}
                {toVisit.length > 5 && (
                  <button onClick={() => setShowAllVisit((v) => !v)} className="w-full py-2.5 text-[12.5px] font-bold text-slate-600 cursor-pointer hover:bg-slate-50">
                    {showAllVisit ? 'Ver menos' : `Ver los ${toVisit.length} que faltan`}
                  </button>
                )}
              </div>
            )}
          </section>
        ) : isAdmin && localities.length > 0 && Object.keys(routeDays).length === 0 ? (
          <button data-tour="preventa-today" onClick={() => setEditingRoute(true)} className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-2xl bg-white border border-dashed border-slate-300 cursor-pointer hover:border-slate-400">
            <CalendarDays className="w-5 h-5 text-slate-500 shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block text-[14px] font-bold text-slate-800">Armá el recorrido de la semana</span>
              <span className="block text-[12.5px] text-slate-500">Qué días vas a cada localidad. Cada día te muestra a quién visitar y quién falta pedir.</span>
            </span>
          </button>
        ) : null}

        {editingRoute && <RouteDaysSheet localities={localities} initial={routeDays} onClose={() => setEditingRoute(false)} />}

        {queue.length > 0 && (
          <div className="flex items-center gap-3 px-4 py-3 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900">
            <WifiOff className="w-5 h-5 shrink-0" />
            <p className="flex-1 text-[13px] leading-snug">
              {queue.length === 1
                ? <><strong>Un pedido espera señal.</strong> Está guardado en este celular y se manda solo cuando vuelve la conexión.</>
                : <><strong>{queue.length} pedidos esperan señal.</strong> Están guardados en este celular y se mandan solos cuando vuelve la conexión.</>}
            </p>
            <button onClick={() => flushPreOrderQueue()} className="text-[12.5px] font-bold underline cursor-pointer shrink-0">Reintentar</button>
          </div>
        )}

                <div data-tour="preventa-filters" className="space-y-2">
          <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
                        {isSeller && (
              <button onClick={() => setMine((v) => !v)} className={chip(mine)}>{mine ? 'Los míos' : 'De todos'}</button>
            )}
            {!inShell && statusOptions.map(([k, l]) => (
              <button key={k} onClick={() => setStatus(k)} className={chip(status === k)}>{l}</button>
            ))}
          </div>
          <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
            {([['today', 'Hoy'], ['week', 'Últimos 7 días'], ['all', 'Todo']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setRange(k)} className={chip(range === k)}>{l}</button>
            ))}
            {localities.length > 0 && (
              <select value={locality} onChange={(e) => setLocality(e.target.value)} aria-label="Localidad"
                className={`${chip(!!locality)} pr-2 outline-none appearance-auto`}>
                <option value="">Todas las localidades</option>
                {localities.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            )}
          </div>
        </div>

        {!inShell && !loading && orders.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Pedidos" value={String(orders.filter((o) => o.status !== 'CANCELLED').length)} />
            <Stat label="Bultos" value={qtyFmt(totals.bultos)} />
            <Stat label="Total" value={money(totals.total)} strong />
          </div>
        )}

        {loading ? (
          <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
        ) : orders.length === 0 ? (
          <div className="py-14 text-center">
            <div className="w-14 h-14 rounded-2xl bg-white border border-slate-200 mx-auto mb-3 flex items-center justify-center">
              <ClipboardList className="w-7 h-7 text-slate-300" />
            </div>
            <p className="text-[15px] font-bold text-slate-700">{status === 'PENDING' ? 'No hay pedidos pendientes' : 'No hay pedidos'}</p>
            <p className="text-[13px] text-slate-500 mt-1">Probá con otras fechas, o tocá "Nuevo pedido" para tomar uno.</p>
          </div>
        ) : (
                    <div data-tour="preventa-list" className="space-y-2.5">
            {orders.map((o) => {
              const st = STATUS_LABEL[o.status] || STATUS_LABEL.PENDING;
              const isOpen = open === o.id;
              const bultos = (o.items || []).reduce((s: number, it: any) => s + (Number(it.packSize) > 1 ? it.quantity / it.packSize : 0), 0);
              return (
                <div key={o.id} className={`rounded-2xl bg-white border overflow-hidden transition-shadow ${isOpen ? 'border-slate-300 shadow-sm' : 'border-slate-200'}`}>
                  <button onClick={() => setOpen(isOpen ? null : o.id)} className="w-full text-left px-4 py-3.5 flex items-center gap-3 cursor-pointer">
                    <span className="w-10 h-10 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[15px] font-bold shrink-0">{(o.client?.name || '?').trim().charAt(0).toUpperCase()}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[15px] font-semibold text-slate-900 truncate">{o.client?.name || 'Sin cliente'}</p>
                      <p className="text-[12.5px] text-slate-500 truncate">
                        N° {o.orderNumber}
                        {o.client?.locality ? ` · ${o.client.locality}` : ''}
                        {' · '}{new Date(o.createdAt).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1">
                        {(status === 'ALL' || o.status !== status) && <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>}
                        {o.runId && o.status === 'PENDING' && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border bg-sky-50 text-sky-800 border-sky-200">En reparto</span>}
                        {o.user && <span className="text-[11.5px] text-slate-400 truncate">{o.user.fullName || o.user.username}</span>}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[15.5px] font-bold text-slate-900">{money(o.total)}</p>
                      {bultos > 0 && <p className="text-[11.5px] text-slate-500">{plural(bultos, 'bulto', 'bultos')}</p>}
                    </div>
                    {isOpen ? <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" /> : <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />}
                  </button>
                  {isOpen && (
                    <div className="px-4 pb-4 border-t border-slate-100">
                      <ul className="divide-y divide-slate-100 mt-1">
                        {(o.items || []).map((it: any) => (
                          <li key={it.id} className="py-2 flex items-baseline gap-3 text-[13.5px]">
                            <span className="w-20 shrink-0 font-bold text-slate-800">
                              {Number(it.packSize) > 1 ? plural(it.quantity / it.packSize, 'bulto', 'bultos') : plural(it.quantity, 'unidad', 'unidades')}
                            </span>
                            <span className="flex-1 min-w-0 text-slate-700">{it.productName}</span>
                            <span className="font-semibold text-slate-800">{money(it.total)}</span>
                          </li>
                        ))}
                      </ul>
                      {o.notes && <p className="mt-2 px-3 py-2 rounded-xl bg-slate-50 text-[13px] text-slate-700"><strong>Aclaración:</strong> {o.notes}</p>}
                      {o.status === 'PENDING' && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button onClick={() => toCaja(o)} className="flex-1 min-w-[160px] h-11 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-[14px] font-bold cursor-pointer flex items-center justify-center gap-2">
                            <ShoppingCart className="w-4 h-4" /> Pasar a la caja
                          </button>
                          <button onClick={() => onEdit(o)} className="h-11 px-4 rounded-xl border border-slate-300 text-slate-700 text-[14px] font-bold cursor-pointer hover:bg-slate-50">Editar</button>
                          <button onClick={() => cancel(o)} className="h-11 px-4 rounded-xl text-rose-700 text-[14px] font-bold cursor-pointer hover:bg-rose-50">Cancelar</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="px-3 py-2.5 rounded-xl bg-white border border-slate-200">
      <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-[16px] font-bold truncate ${strong ? 'text-slate-900' : 'text-slate-800'}`}>{value}</p>
    </div>
  );
}

// ─── Tomar / corregir un pedido ───────────────────────────────────

const IVA_OPTIONS: [string, string][] = [
  ['CONSUMIDOR_FINAL', 'Consumidor final'],
  ['MONOTRIBUTO', 'Monotributo'],
  ['RESPONSABLE_INSCRIPTO', 'Responsable inscripto'],
  ['EXENTO', 'Exento'],
];

/** Alta de un cliente en la calle, sin salir del pedido: lo mínimo para entregarle y facturarle. */
function NewClientCard({ zones, defaultZone, defaultName, onCancel, onCreated }: { zones: string[]; defaultZone: string; defaultName: string; onCancel: () => void; onCreated: (c: any) => void }) {
  const [f, setF] = useState({ name: defaultName, address: '', locality: defaultZone, phone: '', cuit: '', ivaCondition: 'CONSUMIDOR_FINAL' });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const input = 'w-full h-11 px-3 rounded-xl bg-slate-50 border border-slate-200 text-[15px] outline-none focus:border-rose-500 focus:bg-white';
  const save = async () => {
    if (!f.name.trim()) { toast.error('Poné el nombre del comercio'); return; }
    if (!f.locality.trim()) { toast.error('Poné la localidad: con eso sale en el reparto de su zona'); return; }
    setBusy(true);
    try {
      const { data } = await api.post('/clients', {
        name: f.name.trim(), address: f.address.trim() || undefined, locality: f.locality.trim(), phone: f.phone.trim() || undefined,
        cuit: f.cuit.replace(/\D/g, '') || undefined, ivaCondition: f.ivaCondition,
      });
      toast.success(`${data.name} dado de alta`);
      onCreated(data);
    } catch (err: any) {
      toast.error(err?.response ? (err.response.data?.message || 'No se pudo dar de alta') : 'Sin señal: el cliente nuevo se carga cuando vuelva la conexión. Mientras, anotalo en las notas de otro pedido.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2.5">
      <p className="text-[15px] font-bold text-slate-900">Cliente nuevo</p>
      <input className={input} placeholder="Nombre del comercio" value={f.name} onChange={set('name')} autoFocus />
      <input className={input} placeholder="Dirección" value={f.address} onChange={set('address')} />
      <div className="grid grid-cols-2 gap-2">
        <input className={input} placeholder="Localidad" list="nuevo-cliente-zonas" value={f.locality} onChange={set('locality')} />
        <input className={input} placeholder="Teléfono" inputMode="tel" value={f.phone} onChange={set('phone')} />
      </div>
      <datalist id="nuevo-cliente-zonas">{zones.map((z) => <option key={z} value={z} />)}</datalist>
      <div className="grid grid-cols-2 gap-2">
        <input className={input} placeholder="CUIT (si pide factura A)" inputMode="numeric" value={f.cuit} onChange={set('cuit')} />
        <select className={input} value={f.ivaCondition} onChange={set('ivaCondition')}>
          {IVA_OPTIONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>
      <div className="flex gap-2 pt-1">
        <button onClick={onCancel} className="h-11 px-4 rounded-xl border border-slate-200 text-[14px] font-semibold text-slate-700 cursor-pointer">Cancelar</button>
        <button onClick={save} disabled={busy} className="flex-1 h-11 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-[14.5px] font-bold cursor-pointer flex items-center justify-center gap-2">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Dar de alta y seguir
        </button>
      </div>
    </div>
  );
}

function OrderEditor({ initial, products, clients: baseClients, committed, lastOrders, onExit }: { initial: Draft; products: any[]; clients: any[]; committed: Record<string, number>; lastOrders: Record<string, any>; onExit: (keptDraft: boolean) => void }) {
  const user = useAuthStore((s) => s.user);
  // Los que el vendedor da de alta en la calle se suman a la lista sin esperar a la próxima bajada
  const [added, setAdded] = useState<any[]>([]);
  const clients = useMemo(() => [...added, ...baseClients.filter((c) => !added.some((a) => a.id === c.id))], [added, baseClients]);
  const [creating, setCreating] = useState(false);
  const [client, setClient] = useState<any | null>(initial.client);
    const [step, setStep] = useState<'client' | 'products'>(initial.client ? 'products' : 'client');
  useMobileFocus();
  // La primera vez que se toma un pedido, cada paso se explica solo
  useAutoTour('distribPedidoCliente', step === 'client');
  useAutoTour('distribPedidoProductos', step === 'products' && products.length > 0);
  const [clientQuery, setClientQuery] = useState('');
    const todayZones = zonesFor(readRouteDays());
  const TODAY = '__hoy__';
  const [zone, setZone] = useState(todayZones.length ? TODAY : '');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<PreOrderItem[]>(initial.items);
  const [notes, setNotes] = useState(initial.notes || '');
  const [showItems, setShowItems] = useState(true);
  const [saving, setSaving] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  // Borrador: cada cambio queda guardado en el equipo
  useEffect(() => {
    if (!client && !items.length) return;
    writeJson(DRAFT_KEY, { ...initial, client, items, notes, savedAt: new Date().toISOString() });
  }, [client, items, notes]);

  // Con la oferta por cantidad aplicada (los renglones guardan el precio de lista)
  const priced = useMemo(() => withOffers(items, products), [items, products]);
  const total = priced.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const bultos = items.reduce((s, i) => s + (i.packSize ? i.quantity / i.packSize : 0), 0);
  const zones = useMemo(() => Array.from(new Set(clients.map((c) => (c.locality || '').trim()).filter(Boolean))).sort(), [clients]);

  const foundClients = useMemo(() => {
    const q = norm(clientQuery);
    return clients
            .filter((c) => (!zone || (zone === TODAY ? todayZones.includes((c.locality || '').trim()) : (c.locality || '').trim() === zone)) && (!q || norm(`${c.name} ${c.locality || ''} ${c.address || ''}`).includes(q)))
      .sort((a, b) => (a.locality || '~').localeCompare(b.locality || '~', 'es') || a.name.localeCompare(b.name, 'es'))
      .slice(0, 80);
  }, [clients, clientQuery, zone]);

  const foundProducts = useMemo(() => {
    const q = norm(query);
    const list = q
      ? products.filter((p) => norm(`${p.name} ${p.barcode || ''} ${p.sku || ''}`).includes(q))
      : [...products].sort((a, b) => (b.salesCount || 0) - (a.salesCount || 0) || a.name.localeCompare(b.name, 'es'));
    return list.slice(0, 40);
  }, [products, query]);

    const inOrder = (productId: string) => items.filter((i) => i.productId === productId);

  // Stock comprometido: lo que ya está en otros pedidos pendientes no se puede volver a prometer.
  // Al corregir un pedido ya guardado, lo suyo propio no cuenta como "de otros".
  const own = useMemo(() => {
    const m: Record<string, number> = {};
    if (initial.orderNumber) for (const i of initial.items) m[i.productId] = (m[i.productId] || 0) + i.quantity;
    return m;
  }, []);
  const othersOf = (p: any) => Math.max(0, (committed[p.id] || 0) - (own[p.id] || 0));
  const freeOf = (p: any) => Number(p.stock) - othersOf(p);
  const warned = useRef(new Set<string>());

  // Cuenta corriente del cliente: lo que debe y su límite (del último catálogo bajado)
  const cli = (client && clients.find((c) => c.id === client.id)) || client;
  const balance = Number(cli?.balance) || 0;
  const limit = Number(cli?.creditLimit) || 0;
  const overBy = limit > 0 ? Math.round((balance + total - limit) * 100) / 100 : 0;

  const add = (p: any, byPack: boolean) => {
    const { unitPrice, packSize } = priceFor(p, byPack);
    const step = packSize || 1;
    const free = freeOf(p);
    const mineUnits = inOrder(p.id).reduce((s, m) => s + m.quantity, 0);
    if (Number.isFinite(free) && mineUnits + step > free + 1e-9 && !warned.current.has(p.id)) {
      warned.current.add(p.id);
      const pack = packOf(p, true);
      const left = Math.max(0, free);
      const leftText = pack ? `${qtyFmt(Math.floor(left / pack.size))} bulto(s)${left % pack.size ? ` y ${qtyFmt(left % pack.size)} u.` : ''}` : `${qtyFmt(left)} u.`;
      toast(`De ${p.name} quedan ${leftText} sin pedir. El pedido se guarda igual: avisá en el depósito.`, { icon: '⚠️', duration: 6000 });
    }
    setItems((prev) => {
      const i = prev.findIndex((x) => x.productId === p.id && (x.packSize || null) === (packSize || null));
      if (i >= 0) return prev.map((x, k) => (k === i ? { ...x, quantity: x.quantity + step } : x));
      return [...prev, { productId: p.id, productName: p.name, quantity: step, packSize, unitPrice }];
    });
  };
    // El último pedido del cliente (no el que se está corrigiendo), para cargarlo de una
  const last = client && lastOrders[client.id]?.id !== initial.id ? lastOrders[client.id] : null;
  const repeatLast = () => {
    if (!last) return;
    const byId = new Map(products.map((p) => [p.id, p]));
    const next: PreOrderItem[] = [];
    let missing = 0;
    for (const it of last.items || []) {
      const p = byId.get(it.productId);
      if (!p) { missing++; continue; }
      // Con el precio de hoy. Si lo pidió por bulto y el producto sigue teniendo bulto, en bultos
      const bultos = it.packSize ? it.quantity / it.packSize : 0;
      const pack = packOf(p, true);
      const byPack = !!(it.packSize && pack);
      const { unitPrice, packSize } = priceFor(p, byPack);
      const quantity = byPack && pack ? Math.max(1, Math.round(bultos)) * pack.size : it.quantity;
      const i = next.findIndex((x) => x.productId === p.id && (x.packSize || null) === (packSize || null));
      if (i >= 0) next[i] = { ...next[i], quantity: next[i].quantity + quantity };
      else next.push({ productId: p.id, productName: p.name, quantity, packSize, unitPrice });
    }
    if (!next.length) { toast.error('Ninguno de esos productos está en el catálogo'); return; }
    setItems(next);
    setShowItems(true);
    toast.success(missing ? `Se cargó el último pedido (${missing} producto(s) ya no están). Revisá las cantidades.` : 'Se cargó el último pedido con los precios de hoy. Revisá las cantidades.');
  };
  const change = (idx: number, dir: 1 | -1) => setItems((prev) => prev
    .map((x, k) => (k === idx ? { ...x, quantity: x.quantity + dir * (x.packSize || 1) } : x))
    .filter((x) => x.quantity > 0));

  const leave = () => {
    const kept = !!(client || items.length);
    if (kept) toast('El pedido quedó guardado como borrador. Lo seguís desde Preventa.', { icon: '📝' });
    onExit(kept);
  };

  const save = async () => {
    if (!client) { setStep('client'); toast.error('Elegí el cliente'); return; }
        if (!items.length) { toast.error('Agregá al menos un producto'); searchRef.current?.focus(); return; }
    if (overBy > 0.009 && !window.confirm(`${cli?.name} pasa su límite de crédito por ${money(overBy)} (debe ${money(balance)} y su límite es ${money(limit)}). ¿Guardar el pedido igual?`)) return;
    setSaving(true);
    try {
      const res = await savePreOrder({ id: initial.id, takenAt: initial.takenAt, clientId: client.id, notes: notes.trim() || undefined, items: priced.map(({ offer, ...it }) => it), clientName: client.name, total });
      clearDraft();
      if (res === 'saved') toast.success(`Pedido de ${client.name} guardado`);
      else toast('Sin señal: el pedido quedó guardado en el celular y se manda solo cuando vuelva la conexión.', { icon: '📶', duration: 7000 });
      onExit(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo guardar el pedido');
    } finally {
      setSaving(false);
    }
  };

  const stepper = (
        <div data-tour="pedido-steps" className="flex items-center gap-1.5 text-[12.5px] font-semibold">
      {(['client', 'products'] as const).map((s, i) => {
        const done = s === 'client' ? !!client : items.length > 0;
        const on = step === s;
        return (
          <button key={s} onClick={() => (s === 'products' && !client ? null : setStep(s))}
            className={`flex items-center gap-1.5 h-8 px-3 rounded-full cursor-pointer transition-colors ${on ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'}`}>
            <span className={`w-4 h-4 rounded-full text-[10px] flex items-center justify-center ${on ? 'bg-white text-slate-900' : done ? 'bg-emerald-600 text-white' : 'bg-slate-300 text-white'}`}>
              {done && !on ? <Check className="w-3 h-3" /> : i + 1}
            </span>
            {s === 'client' ? 'Cliente' : 'Productos'}
          </button>
        );
      })}
    </div>
  );

  const header = (
    <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 px-3 py-2.5 flex items-center gap-2">
      <button onClick={leave} className="w-10 h-10 rounded-full hover:bg-slate-100 flex items-center justify-center cursor-pointer shrink-0" aria-label="Volver a la lista">
        <ArrowLeft className="w-5 h-5 text-slate-700" />
      </button>
      <div className="min-w-0 flex-1">
        <p className="text-[15.5px] font-bold text-slate-900 leading-tight truncate">{initial.orderNumber ? `Pedido N° ${initial.orderNumber}` : 'Nuevo pedido'}</p>
        <p className="text-[11.5px] text-slate-500 truncate">Toma: {user?.fullName || user?.username}</p>
      </div>
      {stepper}
    </div>
  );

  // Paso 1: el cliente
  if (step === 'client') {
    return (
      <div className="h-full flex flex-col bg-slate-50">
        {header}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-4 py-4 space-y-3 pb-10">
            <h2 className="text-[18px] font-bold text-slate-900">¿A qué cliente le tomás el pedido?</h2>
                        <div data-tour="pedido-client-search" className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input autoFocus value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} placeholder="Buscar por nombre o dirección"
                className="w-full h-12 pl-10 pr-10 rounded-xl bg-white border border-slate-300 text-[15px] outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15" />
              {clientQuery && <button onClick={() => setClientQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 cursor-pointer" aria-label="Borrar búsqueda"><X className="w-4 h-4 text-slate-400" /></button>}
            </div>
                                    {(zones.length > 1 || todayZones.length > 0) && (
              <div data-tour="pedido-zones" className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
                {[...(todayZones.length ? [TODAY] : []), '', ...zones].map((z) => (
                  <button key={z || 'todas'} onClick={() => setZone(z)}
                    className={`shrink-0 h-9 px-3.5 rounded-full text-[13px] font-semibold border cursor-pointer ${zone === z ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}>
                    {z === TODAY ? `Hoy: ${todayZones.join(', ')}` : z || 'Todas las zonas'}
                  </button>
                ))}
              </div>
            )}
            {creating ? (
              <NewClientCard
                zones={zones}
                defaultZone={zone === TODAY ? todayZones[0] || '' : zone}
                defaultName={clientQuery}
                onCancel={() => setCreating(false)}
                onCreated={(c) => {
                  setAdded((a) => [c, ...a]);
                  setCreating(false);
                  setClientQuery('');
                  setClient(c);
                  setStep('products');
                  setTimeout(() => searchRef.current?.focus(), 50);
                }}
              />
            ) : (
              <button onClick={() => setCreating(true)} className="w-full h-12 rounded-xl border border-dashed border-slate-300 bg-white text-[14.5px] font-semibold text-slate-700 flex items-center justify-center gap-2 cursor-pointer hover:bg-slate-50">
                <UserPlus className="w-4 h-4" /> Cliente nuevo
              </button>
            )}
            {foundClients.length === 0 ? (
              <div className="py-10 text-center">
                <p className="text-[14px] font-semibold text-slate-700">{clients.length ? 'No hay clientes con esa búsqueda' : 'Todavía no hay clientes cargados'}</p>
                <p className="text-[12.5px] text-slate-500 mt-1">{clients.length ? 'Probá con otra palabra, con otra zona, o dalo de alta con "Cliente nuevo".' : 'Dalo de alta con "Cliente nuevo".'}</p>
              </div>
            ) : (
              <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                {foundClients.map((c) => (
                  <button key={c.id} onClick={() => { setClient(c); setStep('products'); setTimeout(() => searchRef.current?.focus(), 50); }}
                    className={`w-full text-left px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-slate-50 ${client?.id === c.id ? 'bg-rose-50/60' : ''}`}>
                    <span className="w-9 h-9 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-[14px] font-bold shrink-0">
                      {(c.name || '?').trim().charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px] font-semibold text-slate-900 truncate">{c.name}</span>
                                            <span className="block text-[12.5px] text-slate-500 truncate">{[c.address, c.locality].filter(Boolean).join(', ') || 'Sin dirección cargada'}</span>
                    </span>
                    {Number(c.balance) > 0.009 && (
                      <span className={`shrink-0 text-right text-[11.5px] font-bold leading-tight ${Number(c.creditLimit) > 0 && Number(c.balance) > Number(c.creditLimit) ? 'text-rose-700' : 'text-slate-500'}`}>
                        Debe {money(Number(c.balance))}
                        {Number(c.creditLimit) > 0 && Number(c.balance) > Number(c.creditLimit) && <span className="block text-[10.5px]">Pasó su límite</span>}
                      </span>
                    )}
                    {client?.id === c.id && <Check className="w-5 h-5 text-rose-600 shrink-0" />}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Paso 2: los productos
  return (
    <div className="h-full flex flex-col bg-slate-50">
      {header}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-4 space-y-4 pb-40">
                    <button data-tour="pedido-client" onClick={() => setStep('client')} className="w-full text-left px-4 py-3 rounded-2xl bg-white border border-slate-200 flex items-center gap-3 cursor-pointer hover:border-slate-300">
            <Store className="w-5 h-5 text-rose-600 shrink-0" />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-bold text-slate-900 truncate">{client?.name}</span>
              <span className="block text-[12.5px] text-slate-500 truncate flex items-center gap-1">
                                <MapPin className="w-3 h-3 inline shrink-0" />{[client?.address, client?.locality].filter(Boolean).join(', ') || 'Sin dirección cargada'}
              </span>
              {balance > 0.009 && (
                <span className="block text-[12px] font-semibold text-slate-600 mt-0.5">Debe {money(balance)}{limit > 0 ? ` · límite ${money(limit)}` : ''}</span>
              )}
            </span>
            <span className="text-[12.5px] font-bold text-rose-700 shrink-0">Cambiar</span>
          </button>

          {overBy > 0.009 && (
            <div data-tour="pedido-limit" className="flex gap-3 px-4 py-3 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <p className="text-[13px] leading-snug">
                <strong>Con este pedido pasa su límite de crédito por {money(overBy)}.</strong> Debe {money(balance)} y su límite es {money(limit)}. Se puede guardar igual; conviene cobrarle algo en la entrega.
              </p>
            </div>
          )}

                    {last && items.length === 0 && (
            <section data-tour="pedido-repeat" className="rounded-2xl bg-white border-2 border-rose-200 px-4 py-3 space-y-2">
              <div className="flex items-center gap-3">
                <RotateCcw className="w-5 h-5 text-rose-600 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-bold text-slate-900">Su último pedido</p>
                  <p className="text-[12px] text-slate-500">N° {last.orderNumber} · {new Date(last.date).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric' })} · {plural((last.items || []).length, 'producto', 'productos')}</p>
                </div>
                <button onClick={repeatLast} className="h-10 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[13.5px] font-bold cursor-pointer shrink-0 active:scale-[0.98]">Repetir</button>
              </div>
              <p className="text-[12.5px] text-slate-600 leading-snug">
                {(last.items || []).slice(0, 4).map((it: any) => `${it.packSize ? `${qtyFmt(it.quantity / it.packSize)} b.` : `${qtyFmt(it.quantity)} u.`} ${it.productName}`).join(' · ')}
                {(last.items || []).length > 4 ? ` y ${(last.items || []).length - 4} más` : ''}
              </p>
            </section>
          )}

          {items.length > 0 && (
            <section data-tour="pedido-items"  className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
              <button onClick={() => setShowItems((v) => !v)} className="w-full px-4 py-3 flex items-center justify-between cursor-pointer">
                <span className="text-[14px] font-bold text-slate-900">Tu pedido · {plural(items.length, 'producto', 'productos')}</span>
                {showItems ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
              </button>
              {showItems && (
                <div className="divide-y divide-slate-100 border-t border-slate-100">
                  {priced.map((it, idx) => (
                    <div key={`${it.productId}-${it.packSize || 0}`} className="px-3 py-2.5 flex items-center gap-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-semibold text-slate-900 leading-tight">{it.productName}</p>
                        <p className="text-[12px] text-slate-500 mt-0.5">{it.packSize ? `Bulto x${it.packSize} · ${money(it.unitPrice * it.packSize)}` : `Unidad · ${money(it.unitPrice)}`}{it.offer && <span className="ml-1.5 font-bold text-emerald-700">Oferta por cantidad</span>}</p>
                      </div>
                      <Stepper
                        value={it.packSize ? it.quantity / it.packSize : it.quantity}
                        unit={it.packSize ? (it.quantity / it.packSize === 1 ? 'bulto' : 'bultos') : (it.quantity === 1 ? 'unidad' : 'unid.')}
                        onMinus={() => change(idx, -1)} onPlus={() => change(idx, 1)}
                        removes={it.quantity <= (it.packSize || 1)}
                      />
                      <span className="w-[76px] text-right text-[14px] font-bold text-slate-900 shrink-0">{money(it.quantity * it.unitPrice)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          <section className="space-y-2">
                        <div data-tour="pedido-search" className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar producto o código"
                className="w-full h-12 pl-10 pr-10 rounded-xl bg-white border border-slate-300 text-[15px] outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15" />
              {query && <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2 p-1 cursor-pointer" aria-label="Borrar búsqueda"><X className="w-4 h-4 text-slate-400" /></button>}
            </div>
            <p className="px-1 text-[11.5px] font-bold text-slate-500 uppercase tracking-wide">{query ? `${foundProducts.length} resultado(s)` : 'Los más vendidos'}</p>
            {products.length === 0 && (
              <p className="py-6 text-center text-[13px] text-slate-500">No hay catálogo en este equipo. Abrí esta pantalla una vez con señal para bajarlo.</p>
            )}
            {foundProducts.map((p) => {
              const pack = packOf(p, true);
              const mine = inOrder(p.id);
              const mineText = mine.map((m) => (m.packSize ? plural(m.quantity / m.packSize, 'bulto', 'bultos') : plural(m.quantity, 'unidad', 'unidades'))).join(' + ');
                            const stock = Number(p.stock);
              const others = othersOf(p);
              const free = stock - others;
              const mineUnits = mine.reduce((s, m) => s + m.quantity, 0);
              const units = (n: number) => (pack ? `${plural(Math.floor(n / pack.size), 'bulto', 'bultos')}${n % pack.size ? ` y ${qtyFmt(n % pack.size)} u.` : ''}` : `${qtyFmt(n)} u.`);
              const stockText = !Number.isFinite(stock) ? '' : free <= 0 ? (others > 0 ? 'Todo el stock ya está en otros pedidos' : 'Sin stock')
                : others > 0 ? `Quedan ${units(free)} sin pedir (hay ${units(stock)})` : `Stock: ${units(stock)}`;
              const short = Number.isFinite(stock) && mineUnits > free + 1e-9;
              return (
                                <div key={p.id} data-tour="pedido-product" className={`px-3 py-3 rounded-2xl bg-white border flex items-center gap-2.5 ${mine.length ? 'border-rose-300 ring-1 ring-rose-200' : 'border-slate-200'}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-[14.5px] font-semibold text-slate-900 leading-tight">{p.name}</p>
                    <p className="text-[12.5px] text-slate-600 mt-1">
                      {pack && <><strong className="text-slate-800">Bulto x{pack.size}</strong> {money(pack.price)}<span className="text-slate-300"> · </span></>}
                      Unidad {money(p.salePrice)}
                    </p>
                                        <p className={`text-[11.5px] mt-0.5 ${free <= 0 || short ? 'text-amber-700 font-semibold' : 'text-slate-400'}`}>
                      {mine.length ? <span className="text-rose-700 font-bold">En el pedido: {mineText}</span> : stockText}
                      {mine.length > 0 && short && <span className="block text-amber-700">No alcanza: {free > 0 ? `quedan ${units(free)} sin pedir` : 'no queda stock sin pedir'}</span>}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    {pack && (
                      <button onClick={() => add(p, true)} className="h-9 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[13px] font-bold cursor-pointer active:scale-[0.97] flex items-center gap-1">
                        <Plus className="w-3.5 h-3.5" /> Bulto
                      </button>
                    )}
                    <button onClick={() => add(p, false)}
                      className={`h-9 px-3 rounded-xl text-[13px] font-bold cursor-pointer active:scale-[0.97] flex items-center gap-1 ${pack ? 'border border-slate-300 text-slate-700 hover:bg-slate-50' : 'bg-rose-600 hover:bg-rose-700 text-white'}`}>
                      <Plus className="w-3.5 h-3.5" /> Unidad
                    </button>
                  </div>
                </div>
              );
            })}
          </section>

                    <section data-tour="pedido-notes">
            <label className="block text-[13px] font-bold text-slate-700 mb-1.5">Aclaración para el reparto <span className="font-normal text-slate-400">(opcional)</span></label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} placeholder="Ej.: entregar a la tarde, paga con transferencia"
              className="w-full px-3.5 py-3 rounded-xl bg-white border border-slate-300 text-[14.5px] outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15" />
          </section>
        </div>
      </div>

      <div className="sticky bottom-0 bg-white border-t border-slate-200 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)] shadow-[0_-8px_24px_-16px_rgba(15,23,42,0.35)]">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-slate-500 truncate">
              {items.length ? `${plural(items.length, 'producto', 'productos')}${bultos > 0 ? ` · ${plural(bultos, 'bulto', 'bultos')}` : ''}` : 'Todavía no agregaste productos'}
            </p>
            <p className="text-[21px] font-bold text-slate-900 leading-tight">{money(total)}</p>
          </div>
                    <button data-tour="pedido-save" onClick={save} disabled={saving || !items.length}
            className="h-12 px-6 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-[15px] font-bold cursor-pointer active:scale-[0.98] flex items-center gap-2 shadow-sm">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Guardar pedido
          </button>
        </div>
      </div>
    </div>
  );
}

function Stepper({ value, unit, onMinus, onPlus, removes }: { value: number; unit: string; onMinus: () => void; onPlus: () => void; removes: boolean }) {
  return (
    <div className="flex items-center gap-1 bg-slate-100 rounded-xl p-1 shrink-0">
      <button onClick={onMinus} className="w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center cursor-pointer active:scale-95" aria-label={removes ? 'Quitar del pedido' : 'Uno menos'}>
        {removes ? <Trash2 className="w-4 h-4 text-rose-600" /> : <Minus className="w-4 h-4 text-slate-700" />}
      </button>
      <span className="min-w-10 text-center leading-none">
        <span className="block text-[15px] font-bold text-slate-900">{qtyFmt(value)}</span>
        <span className="block text-[9.5px] font-semibold text-slate-500 uppercase mt-0.5">{unit}</span>
      </span>
      <button onClick={onPlus} className="w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center cursor-pointer active:scale-95" aria-label="Uno más">
        <Plus className="w-4 h-4 text-slate-700" />
      </button>
    </div>
  );
}

/** El recorrido de la semana, que se actualiza si se cambia acá o llega de otro equipo */
function useRouteDays() {
  const [map, setMap] = useState<RouteDays>(readRouteDays);
  useEffect(() => {
    const refresh = () => setMap(readRouteDays());
    window.addEventListener(ROUTE_DAYS_EVENT, refresh);
    window.addEventListener(STORE_SETTINGS_EVENT, refresh);
    return () => { window.removeEventListener(ROUTE_DAYS_EVENT, refresh); window.removeEventListener(STORE_SETTINGS_EVENT, refresh); };
  }, []);
  return map;
}

/** Qué días se visita cada localidad. Lo arma el dueño; lo ven todos los vendedores. */
function RouteDaysSheet({ localities, initial, onClose }: { localities: string[]; initial: RouteDays; onClose: () => void }) {
  const [map, setMap] = useState<RouteDays>(() => ({ ...initial }));
  const toggle = (zone: string, day: number) => setMap((m) => {
    const days = m[zone] || [];
    return { ...m, [zone]: days.includes(day) ? days.filter((d) => d !== day) : [...days, day] };
  });
  const save = () => {
    saveRouteDays(map);
    toast.success('Recorrido guardado');
    onClose();
  };
  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/50 flex items-end sm:items-center justify-center" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Recorrido de la semana" className="w-full sm:max-w-lg bg-slate-50 rounded-t-3xl sm:rounded-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 pt-5 pb-3 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[18px] font-bold text-slate-900">Recorrido de la semana</h2>
            <p className="text-[13px] text-slate-500 mt-0.5">Tocá los días que se visita cada localidad. Cada día, Preventa muestra a quién visitar y quién falta pedir.</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-full hover:bg-slate-200/60 flex items-center justify-center cursor-pointer shrink-0" aria-label="Cerrar"><X className="w-5 h-5 text-slate-500" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 pb-3 space-y-2">
          {localities.length === 0 && <p className="py-8 text-center text-[13px] text-slate-500">Cargá la localidad de tus clientes para armar el recorrido.</p>}
          {localities.map((zone) => (
            <div key={zone} className="rounded-2xl bg-white border border-slate-200 px-3.5 py-3">
              <p className="text-[14.5px] font-bold text-slate-900 flex items-center gap-1.5"><MapPin className="w-4 h-4 text-slate-400" /> {zone}</p>
              <div className="mt-2 grid grid-cols-6 gap-1.5">
                {WEEK.map((w) => {
                  const on = (map[zone] || []).includes(w.day);
                  return (
                    <button key={w.day} onClick={() => toggle(zone, w.day)} aria-pressed={on} aria-label={`${zone}: ${w.name}`}
                      className={`h-10 rounded-xl text-[13.5px] font-bold border cursor-pointer transition-colors ${on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}>
                      {w.short}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+16px)] border-t border-slate-200 bg-white rounded-b-3xl">
          <button onClick={save} className="w-full h-12 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[15px] font-bold cursor-pointer">Guardar recorrido</button>
        </div>
      </div>
    </div>
  );
}
