import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Plus, Search, X, Loader2, Check, Trash2, Printer, MessageCircle, Wallet, PackageCheck, Pencil, Ban,
  CalendarClock, Phone, ClipboardList, Store, AlertTriangle, Clock, KeyRound, History, FileText,
} from 'lucide-react';
import api from '../../services/api';
import { usePOSStore } from '../../stores/posStore';
import { useSmallScreen } from '../../utils/ownerMobile';
import { useMobileFocus } from '../mobile/MobileShell';
import { useCashSession } from '../mobile/useCashSession';
import { getPaymentMethods } from '../mobile/checkout';
import { parseAmount, ScreenHeader, HeaderAction, Chips, headerInput } from '../mobile/ui';
import { PageHeader, StatCard, Segmented, EmptyState, ui } from '../ui/Page';
import DocumentPreview from '../common/DocumentPreview';
import { loadEmisor, MissingStoreNameError, type Emisor } from '../pos/SalesNoteSheet';
import { WorkOrderReceipt, PRIORITY_LABEL } from './WorkOrderReceipt';
import { waNumber, dayDiff, dueLabel } from './workOrderUtils';
import { useWorkRole, isProductionRole } from '../../services/workRole';
import { useConfirm } from '../common/ConfirmDialog';
import { useFeature } from '../../stores/businessStore';
import QuotesListModal from '../pos/QuotesListModal';
import { QuotePreview } from '../pos/QuoteDocument';

const money = (n: number) => `$ ${(Math.round((n || 0) * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
const qty = (n: number) => (Math.round((n || 0) * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 });
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : 'wo-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10));
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export const STATUS_LABEL: Record<string, string> = { PENDIENTE: 'Pendiente', EN_PROCESO: 'En proceso', LISTO: 'Listo', ENTREGADO: 'Entregado', CANCELADO: 'Cancelado' };
const STATUS_TONE: Record<string, string> = {
  PENDIENTE: 'bg-slate-100 text-slate-700', EN_PROCESO: 'bg-sky-50 text-sky-800', LISTO: 'bg-emerald-50 text-emerald-800',
  ENTREGADO: 'bg-slate-100 text-slate-500', CANCELADO: 'bg-red-50 text-red-700',
};
const PRIORITY_TONE: Record<string, string> = { ALTA: 'bg-red-50 text-red-700 border-red-200', MEDIA: 'bg-amber-50 text-amber-800 border-amber-200', BAJA: 'bg-slate-50 text-slate-600 border-slate-200' };

const late = (o: any) => o.dueAt && ['PENDIENTE', 'EN_PROCESO', 'LISTO'].includes(o.status) && new Date(o.dueAt).getTime() < Date.now();

type Filter = 'ACTIVOS' | 'LISTO' | 'ENTREGADO' | 'TODOS';

/**
 * Encargos (imprenta y trabajos a pedido): la agenda de lo que hay que entregar, ordenada por
 * fecha de entrega y prioridad. Cada encargo se toma con o sin seña, pasa por pendiente → en
 * proceso → listo, se le avisa al cliente por WhatsApp y al entregarse se cobra el saldo.
 * En el celular, con el encabezado verde de la app; en la PC, con el de las pantallas de admin.
 */
export default function WorkOrdersScreen() {
  const phone = useSmallScreen();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<Filter>('ACTIVOS');
  const [search, setSearch] = useState('');
  const [orders, setOrders] = useState<any[] | null>(null);
  const [active, setActive] = useState<any[]>([]);
  const [editing, setEditing] = useState<any | null>(() => (params.get('nuevo') ? blankOrder() : null));
  const [openId, setOpenId] = useState<string | null>(params.get('id'));
  // Taller y Diseño: ven los trabajos y los mueven, sin precios ni cobros
  const production = isProductionRole(useWorkRole());
  const canQuote = useFeature('quotes') && !production;
  const [showQuotes, setShowQuotes] = useState(false);

  const load = () => {
    api.get('/work-orders', { params: { status: filter === 'ACTIVOS' ? 'ACTIVOS' : filter, search: search.trim() || undefined } })
      .then(({ data }) => setOrders(data || []))
      .catch(() => setOrders([]));
    // El resumen siempre es de lo que falta entregar
    api.get('/work-orders', { params: { status: 'ACTIVOS' }, silent: true } as any).then(({ data }) => setActive(data || [])).catch(() => {});
  };
  useEffect(() => { load(); }, [filter]);
  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [search]);
  useEffect(() => {
    // Desde un pedido de la tienda online: "Pasar a encargo"
    const raw = sessionStorage.getItem('ventra_workorder_from_online');
    if (raw && params.get('nuevo')) {
      try { setEditing({ ...blankOrder(), ...JSON.parse(raw) }); } catch { /* sin datos: encargo vacío */ }
      sessionStorage.removeItem('ventra_workorder_from_online');
    }
    if (params.get('nuevo') || params.get('id')) setParams({}, { replace: true });
  }, []);

  const stats = useMemo(() => {
    const lateN = active.filter(late).length;
    const today = active.filter((o) => o.dueAt && !late(o) && dayDiff(new Date(o.dueAt)) === 0).length;
    const ready = active.filter((o) => o.status === 'LISTO').length;
    const toCollect = active.reduce((s, o) => s + Math.max(0, (o.total || 0) - (o.deposit || 0)), 0);
    return { late: lateN, today, ready, toCollect, count: active.length };
  }, [active]);

  const groups = useMemo(() => {
    const list = orders || [];
    if (filter !== 'ACTIVOS') return [{ title: '', items: list }];
    const rank: Record<string, number> = { ALTA: 0, MEDIA: 1, BAJA: 2 };
    const sorted = [...list].sort((a, b) => (a.dueAt ? new Date(a.dueAt).getTime() : Infinity) - (b.dueAt ? new Date(b.dueAt).getTime() : Infinity) || rank[a.priority] - rank[b.priority]);
    const out: { title: string; items: any[] }[] = [
      { title: 'Atrasados', items: [] }, { title: 'Hoy', items: [] }, { title: 'Mañana', items: [] },
      { title: 'Esta semana', items: [] }, { title: 'Más adelante', items: [] }, { title: 'Sin fecha', items: [] },
    ];
    for (const o of sorted) {
      if (!o.dueAt) { out[5].items.push(o); continue; }
      const n = dayDiff(new Date(o.dueAt));
      if (late(o)) out[0].items.push(o);
      else if (n === 0) out[1].items.push(o);
      else if (n === 1) out[2].items.push(o);
      else if (n <= 7) out[3].items.push(o);
      else out[4].items.push(o);
    }
    return out.filter((g) => g.items.length);
  }, [orders, filter]);

  if (editing) {
    return <WorkOrderEditor initial={editing} canQuote={canQuote} onExit={(saved) => { setEditing(null); if (saved) { load(); setOpenId(saved.id); } }} />;
  }

  const quotesList = showQuotes && <QuotesListModal onClose={() => setShowQuotes(false)} onToWorkOrder={(draft) => setEditing({ ...blankOrder(), ...draft })} />;

  const filters: { id: Filter; label: string; count?: number }[] = [
    { id: 'ACTIVOS', label: 'Para entregar', count: stats.count },
    { id: 'LISTO', label: 'Listos', count: stats.ready },
    { id: 'ENTREGADO', label: 'Entregados' },
    { id: 'TODOS', label: 'Todos' },
  ];
  const subtitle = stats.count
    ? `${stats.count} para entregar${stats.late ? ` · ${stats.late} atrasado${stats.late === 1 ? '' : 's'}` : ''}${stats.ready ? ` · ${stats.ready} listo${stats.ready === 1 ? '' : 's'}` : ''}`
    : 'Nada para entregar';
  const newButton = production ? undefined : <button onClick={() => setEditing(blankOrder())} className={`${ui.btn} ${ui.btnPrimary}`}><Plus className="w-4 h-4" /> Nuevo encargo</button>;

  const list = orders === null ? (
    <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
  ) : !orders.length ? (
    <div className="rounded-2xl bg-white border border-slate-200">
      <EmptyState icon={ClipboardList}
        title={search ? 'Sin resultados' : filter === 'ACTIVOS' ? 'No hay encargos para entregar' : 'No hay encargos acá'}
        description={search ? 'Probá con otro nombre, trabajo o número.' : production ? 'Cuando el mostrador cargue un trabajo, aparece acá.' : 'Cargá el primero: cliente, trabajo, fecha de entrega y seña.'}
        action={search ? undefined : newButton} />
    </div>
  ) : (
    <div className="space-y-5">
      {groups.map((g) => (
        <section key={g.title || 'todos'} className="space-y-2">
          {g.title && (
            <h2 className={`flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.06em] ${g.title === 'Atrasados' ? 'text-red-600' : 'text-slate-500'}`}>
              {g.title === 'Atrasados' && <AlertTriangle className="w-3.5 h-3.5" />}{g.title}<span className="font-semibold text-slate-400">{g.items.length}</span>
            </h2>
          )}
          <div className={phone ? 'space-y-2' : 'grid grid-cols-1 lg:grid-cols-2 gap-2.5'}>
            {g.items.map((o) => <OrderCard key={o.id} o={o} hidePrices={production} onOpen={() => setOpenId(o.id)} />)}
          </div>
        </section>
      ))}
    </div>
  );

  const detail = openId && (
    <WorkOrderDetail id={openId} onClose={() => setOpenId(null)} onChanged={load} onEdit={(o) => { setOpenId(null); setEditing(toDraft(o)); }} />
  );

  if (phone) {
    return (
      <div className="h-full flex flex-col bg-slate-50">
        <ScreenHeader title="Encargos" subtitle={subtitle} action={production ? undefined : (
          <div className="flex items-center gap-2">
            {canQuote && <HeaderAction icon={FileText} label="Presupuestos" onClick={() => setShowQuotes(true)} />}
            <HeaderAction icon={Plus} label="Nuevo" onClick={() => setEditing(blankOrder())} />
          </div>
        )}>
          <div className="space-y-3">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar cliente, trabajo o número" className={`${headerInput} pl-10 pr-3`} />
            </div>
            <Chips<Filter> options={filters} value={filter} onChange={setFilter} />
          </div>
        </ScreenHeader>
        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-28 space-y-4">
          {filter === 'ACTIVOS' && stats.count > 0 && !search && (
            <div className="grid grid-cols-3 gap-2">
              <MiniStat label="Atrasados" value={stats.late} tone={stats.late ? 'text-red-600' : 'text-slate-900'} />
              <MiniStat label="Para hoy" value={stats.today} tone="text-slate-900" />
              {production
                ? <MiniStat label="Listos" value={stats.ready} tone="text-slate-900" />
                : <MiniStat label="Por cobrar" value={money(stats.toCollect)} tone="text-slate-900" small />}
            </div>
          )}
          {list}
        </div>
        {detail}
        {quotesList}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className="max-w-6xl mx-auto px-6 py-6 space-y-5">
        <PageHeader title="Encargos" description={production ? 'Los trabajos para hacer, ordenados por fecha de entrega.' : 'Los trabajos a pedido, ordenados por fecha de entrega.'} actions={(
          <>
            {canQuote && <button onClick={() => setShowQuotes(true)} className={`${ui.btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}><FileText className="w-4 h-4" /> Presupuestos</button>}
            {newButton}
          </>
        )} />
        <div className={`grid grid-cols-2 ${production ? 'lg:grid-cols-3' : 'lg:grid-cols-4'} gap-3`}>
          <StatCard label="Atrasados" value={stats.late} icon={AlertTriangle} tone={stats.late ? 'danger' : 'neutral'} valueTone={stats.late ? 'danger' : 'neutral'} hint="Ya pasó la fecha de entrega" />
          <StatCard label="Para hoy" value={stats.today} icon={CalendarClock} tone="brand" hint="Se entregan hoy" />
          <StatCard label="Listos para retirar" value={stats.ready} icon={PackageCheck} tone="success" hint={production ? 'Ya terminados' : 'Avisale al cliente'} onClick={() => setFilter('LISTO')} />
          {!production && <StatCard label="Por cobrar" value={money(stats.toCollect)} icon={Wallet} tone="warning" hint={`${stats.count} encargo${stats.count === 1 ? '' : 's'} sin entregar`} />}
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <Segmented<Filter> options={filters.map(({ id, label }) => ({ id, label }))} value={filter} onChange={setFilter} />
          <div className="relative sm:ml-auto sm:w-80">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar cliente, trabajo o número" className={`${ui.field} w-full pl-9`} />
          </div>
        </div>
        {list}
      </div>
      {detail}
      {quotesList}
    </div>
  );
}

function MiniStat({ label, value, tone, small }: { label: string; value: any; tone: string; small?: boolean }) {
  return (
    <div className="rounded-2xl bg-white border border-slate-200 px-3 py-2.5 min-w-0">
      <p className="text-[11.5px] font-medium text-slate-500 truncate">{label}</p>
      <p className={`${small ? 'text-[15px] mt-1' : 'text-[20px]'} font-bold tabular-nums leading-tight truncate ${tone}`}>{value}</p>
    </div>
  );
}

const AVATAR_TONE: Record<string, string> = { PENDIENTE: 'bg-slate-100 text-slate-600', EN_PROCESO: 'bg-sky-100 text-sky-700', LISTO: 'bg-emerald-100 text-emerald-700', ENTREGADO: 'bg-slate-100 text-slate-400', CANCELADO: 'bg-red-50 text-red-400' };

function OrderCard({ o, onOpen, hidePrices }: { o: any; onOpen: () => void; hidePrices?: boolean }) {
  const rest = Math.max(0, (o.total || 0) - (o.deposit || 0));
  const title = (o.items || []).map((i: any) => i.description).join(' · ');
  const isLate = late(o);
  const initial = (o.client?.name || '?').trim().charAt(0).toUpperCase();
  return (
    <button onClick={onOpen} className="w-full text-left rounded-2xl bg-white border border-slate-200 px-3.5 py-3 cursor-pointer hover:border-slate-300 active:scale-[0.995] transition-[border-color,transform]">
      <div className="flex items-center gap-3">
        <span className={`w-10 h-10 rounded-full flex items-center justify-center text-[15px] font-bold shrink-0 ${AVATAR_TONE[o.status]}`}>{initial}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 min-w-0">
            <p className="text-[15px] font-semibold text-slate-900 truncate">{o.client?.name || 'Sin cliente'}</p>
          </div>
          <p className="text-[13px] text-slate-500 truncate">{title}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className={`text-[13px] font-semibold flex items-center justify-end gap-1 ${isLate ? 'text-red-600' : 'text-slate-700'}`}>
            <Clock className="w-3.5 h-3.5" />{dueLabel(o.dueAt)}
          </p>
          {!hidePrices && (
            <p className={`text-[13px] tabular-nums ${o.status === 'ENTREGADO' ? 'text-slate-400' : rest > 0 ? 'text-slate-900 font-semibold' : 'text-emerald-700 font-semibold'}`}>
              {o.status === 'ENTREGADO' ? money(o.total) : rest > 0 ? money(rest) : 'Pagado'}
            </p>
          )}
        </div>
      </div>
      <div className="mt-2 pl-[52px] flex items-center gap-1.5 text-[12px] min-w-0">
        <span className={`font-semibold px-2 py-0.5 rounded-full shrink-0 ${STATUS_TONE[o.status]}`}>{STATUS_LABEL[o.status]}</span>
        {o.priority === 'ALTA' && o.status !== 'ENTREGADO' && <span className="font-bold px-2 py-0.5 rounded-full shrink-0 bg-red-50 text-red-700">Urgente</span>}
        {o.source === 'TIENDA' && <span className="font-semibold px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 flex items-center gap-1 shrink-0"><Store className="w-3 h-3" /> Tienda</span>}
        <span className="text-slate-400 shrink-0">N° {o.number}</span>
        {!hidePrices && o.deposit > 0 && o.status !== 'ENTREGADO' && <span className="ml-auto text-slate-500 truncate">Seña {money(o.deposit)}</span>}
      </div>
    </button>
  );
}

// ─── Editor ───────────────────────────────────────────────────────

interface Line { productId: string | null; description: string; specs: string; quantity: string; unitPrice: string }
const blankLine = (): Line => ({ productId: null, description: '', specs: '', quantity: '1', unitPrice: '' });
function blankOrder() {
  return { id: newId(), client: null, clientName: '', clientPhone: '', priority: 'MEDIA', dueAt: '', notes: '', items: [blankLine()], deposit: 0, isNew: true };
}
function toDraft(o: any) {
  const local = (d: any) => { if (!d) return ''; const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 16); };
  return {
    id: o.id, number: o.number, client: o.client, clientName: '', clientPhone: '', priority: o.priority, dueAt: local(o.dueAt), notes: o.notes || '', deposit: o.deposit || 0,
    items: (o.items || []).map((i: any) => ({ productId: i.productId, description: i.description, specs: i.specs || '', quantity: String(i.quantity), unitPrice: String(i.unitPrice) })),
    isNew: false,
  };
}
const atLocal = (days: number, hour = 18) => { const d = new Date(); d.setDate(d.getDate() + days); d.setHours(hour, 0, 0, 0); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

function WorkOrderEditor({ initial, canQuote, onExit }: { initial: any; canQuote?: boolean; onExit: (saved: any | null) => void }) {
  useMobileFocus();
  const phone = useSmallScreen();
  const products = usePOSStore((s) => s.products);
  const [clients, setClients] = useState<any[]>([]);
  const [client, setClient] = useState<any | null>(initial.client);
  const [newClient, setNewClient] = useState(!initial.client && !!initial.clientName);
  const [clientName, setClientName] = useState(initial.clientName || '');
  const [clientPhone, setClientPhone] = useState(initial.clientPhone || '');
  const [clientQuery, setClientQuery] = useState('');
  const [lines, setLines] = useState<Line[]>(initial.items?.length ? initial.items : [blankLine()]);
  const [priority, setPriority] = useState(initial.priority || 'MEDIA');
  const [dueAt, setDueAt] = useState(initial.dueAt || '');
  const [notes, setNotes] = useState(initial.notes || '');
  const [deposit, setDeposit] = useState('');
  const [method, setMethod] = useState('CASH');
  const [productQuery, setProductQuery] = useState('');
  const [saving, setSaving] = useState(false);
  const [askValidity, setAskValidity] = useState(false);
  const [savedQuote, setSavedQuote] = useState<any | null>(null);
  const [askOwnerKey, ownerKeyPanel] = useOwnerKey();
  const cash = useCashSession();
  const methods = useMemo(() => [...getPaymentMethods().filter((m) => m.id !== 'DEBT'), { id: 'TRANSFERENCIA', name: 'Transferencia' }], []);
  // Un encargo nuevo escrito a mano también se puede guardar como presupuesto (no uno que ya viene de otro lado)
  const canSaveAsQuote = canQuote && initial.isNew && !initial.source && !initial.quoteId;

  useEffect(() => { api.get('/clients', { silent: true } as any).then(({ data }) => setClients(Array.isArray(data) ? data : data?.data || [])).catch(() => {}); }, []);

  const foundClients = useMemo(() => {
    const q = norm(clientQuery);
    if (!q) return [];
    return clients.filter((c) => norm(`${c.name} ${c.phone || ''}`).includes(q)).slice(0, 8);
  }, [clients, clientQuery]);
  const foundProducts = useMemo(() => {
    const q = norm(productQuery);
    if (!q) return [];
    return products.filter((p: any) => !['VENTA_RAPIDA', 'PAGO_CTA_CTE'].includes(p.id) && norm(`${p.name} ${p.barcode || ''}`).includes(q)).slice(0, 8);
  }, [products, productQuery]);

  const total = lines.reduce((s, l) => s + (parseAmount(l.quantity) || 0) * (parseAmount(l.unitPrice) || 0), 0);
  const set = (i: number, k: keyof Line, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  const save = async () => {
    const items = lines
      .map((l) => ({ productId: l.productId, description: l.description.trim(), specs: l.specs.trim() || undefined, quantity: parseAmount(l.quantity), unitPrice: parseAmount(l.unitPrice) || 0 }))
      .filter((l) => l.description && l.quantity > 0);
    if (!items.length) { toast.error('Cargá al menos un trabajo con su cantidad'); return; }
    if (!client && !clientName.trim()) { toast.error('Elegí el cliente o cargá uno nuevo'); return; }
    const sena = parseAmount(deposit) || 0;
    if (sena > total + 0.009) { toast.error('La seña no puede ser mayor que el total'); return; }
    setSaving(true);
    try {
      const body: any = {
        items, priority, notes: notes.trim() || undefined,
        dueAt: dueAt ? new Date(dueAt).toISOString() : null,
        ...(client ? { clientId: client.id } : { clientName: clientName.trim(), clientPhone: clientPhone.trim() }),
        ...(initial.source ? { source: initial.source, onlineOrderId: initial.onlineOrderId } : {}),
        ...(initial.quoteId ? { quoteId: initial.quoteId } : {}),
      };
      let data: any;
      try {
        data = (await api.put(`/work-orders/${initial.id}`, body)).data;
      } catch (err: any) {
        // Con seña cobrada, cambiar el total lo autoriza el dueño con su clave
        if (!err?.response?.data?.needsAdmin) throw err;
        const adminPassword = await askOwnerKey(err.response.data.message);
        if (!adminPassword) return;
        data = (await api.put(`/work-orders/${initial.id}`, { ...body, adminPassword })).data;
      }
      if (sena > 0) {
        let sessionId = cash.session?.id;
        if (!sessionId) sessionId = (await cash.open(0))?.id;
        data = (await api.post(`/work-orders/${initial.id}/collect`, { amount: sena, method, sessionId, key: `alta-${Date.now()}` })).data;
      }
      toast.success(initial.isNew ? `Encargo N° ${data.number} guardado` : 'Encargo actualizado');
      onExit(data);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo guardar el encargo');
    } finally {
      setSaving(false);
    }
  };

  const quoteItems = () => lines
    .map((l) => ({ productId: l.productId || undefined, productName: l.description.trim(), specs: l.specs.trim() || undefined, quantity: parseAmount(l.quantity), unitPrice: parseAmount(l.unitPrice) || 0 }))
    .filter((l) => l.productName && l.quantity > 0);

  const startQuote = () => {
    if (!quoteItems().length) { toast.error('Cargá al menos un trabajo con su cantidad'); return; }
    if (!client && !clientName.trim()) { toast.error('Elegí el cliente o cargá uno nuevo'); return; }
    if (parseAmount(deposit) > 0) { toast.error('La seña se cobra cuando se pasa a encargo: borrala para guardar el presupuesto'); return; }
    setAskValidity(true);
  };

  const saveQuote = async (validDays: number) => {
    setSaving(true);
    try {
      const { data } = await api.post('/quotes', {
        clientName: client ? client.name : clientName.trim(),
        clientPhone: (client ? client.phone : clientPhone.trim()) || undefined,
        notes: notes.trim() || undefined,
        validDays,
        items: quoteItems(),
      });
      toast.success(`Presupuesto ${data.quoteNumber} guardado`);
      setAskValidity(false);
      setSavedQuote(data);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo guardar el presupuesto');
    } finally {
      setSaving(false);
    }
  };

  const input = 'w-full h-11 px-3 rounded-xl bg-white border border-slate-300 text-[15px] outline-none focus:border-rose-500';
  const label = 'block text-[12.5px] font-semibold text-slate-600 mb-1';
  return (
    <div className="h-full flex flex-col bg-slate-50">
      <div className={phone
        ? 'shrink-0 bg-rose-600 text-white px-3 pt-[calc(env(safe-area-inset-top)+0.6rem)] pb-3 flex items-center gap-2 rounded-b-[20px]'
        : 'sticky top-0 z-10 bg-white border-b border-slate-200 px-3 py-2.5 flex items-center gap-2'}>
        <button onClick={() => onExit(null)} className={`w-10 h-10 rounded-full flex items-center justify-center cursor-pointer ${phone ? 'active:bg-white/15' : 'hover:bg-slate-100'}`} aria-label="Volver"><ArrowLeft className={`w-5 h-5 ${phone ? 'text-white' : 'text-slate-700'}`} /></button>
        <p className={`flex-1 font-bold ${phone ? 'text-[19px]' : 'text-[16px] text-slate-900'}`}>{initial.isNew ? 'Nuevo encargo' : `Encargo N° ${initial.number}`}</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-4 space-y-4 pb-10">
          {/* Cliente */}
          <section className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2.5">
            <p className="text-[15px] font-bold text-slate-900">Cliente</p>
            {client ? (
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[15px] font-semibold text-slate-900 truncate">{client.name}</p>
                  <p className="text-[12.5px] text-slate-500">{client.phone || 'Sin teléfono: no se le va a poder avisar por WhatsApp'}</p>
                </div>
                {initial.isNew || !initial.deposit ? <button onClick={() => setClient(null)} className="text-[13px] font-semibold text-rose-700 cursor-pointer">Cambiar</button> : null}
              </div>
            ) : newClient ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input className={input} placeholder="Nombre o empresa" value={clientName} onChange={(e) => setClientName(e.target.value)} autoFocus />
                <input className={input} placeholder="WhatsApp (para avisarle)" inputMode="tel" value={clientPhone} onChange={(e) => setClientPhone(e.target.value)} />
                <button onClick={() => setNewClient(false)} className="text-left text-[13px] font-semibold text-slate-500 cursor-pointer">Buscar uno que ya está cargado</button>
              </div>
            ) : (
              <>
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input className={`${input} pl-9`} placeholder="Buscar por nombre o teléfono" value={clientQuery} onChange={(e) => setClientQuery(e.target.value)} autoFocus={initial.isNew} />
                </div>
                {foundClients.length > 0 && (
                  <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                    {foundClients.map((c) => (
                      <button key={c.id} onClick={() => { setClient(c); setClientQuery(''); }} className="w-full text-left px-3 py-2.5 hover:bg-slate-50 cursor-pointer">
                        <span className="block text-[14.5px] font-semibold text-slate-900">{c.name}</span>
                        <span className="block text-[12px] text-slate-500">{c.phone || 'Sin teléfono'}</span>
                      </button>
                    ))}
                  </div>
                )}
                <button onClick={() => { setNewClient(true); setClientName(clientQuery); }} className="w-full h-11 rounded-xl border border-dashed border-slate-300 text-[14px] font-semibold text-slate-700 flex items-center justify-center gap-2 cursor-pointer hover:bg-slate-50">
                  <Plus className="w-4 h-4" /> Cliente nuevo
                </button>
              </>
            )}
          </section>

          {/* Trabajos */}
          <section className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
            <p className="text-[15px] font-bold text-slate-900">Qué encargó</p>
            {lines.map((l, i) => (
              <div key={i} className="rounded-xl border border-slate-200 p-3 space-y-2">
                <div className="flex gap-2">
                  <input className={input} placeholder="Trabajo (ej.: Tarjetas personales)" value={l.description} onChange={(e) => set(i, 'description', e.target.value)} />
                  {lines.length > 1 && <button onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="w-11 h-11 shrink-0 rounded-xl border border-slate-200 flex items-center justify-center cursor-pointer" aria-label="Quitar"><Trash2 className="w-4 h-4 text-slate-500" /></button>}
                </div>
                <textarea className="w-full min-h-[60px] px-3 py-2 rounded-xl bg-white border border-slate-300 text-[14px] outline-none focus:border-rose-500" placeholder="Detalle: medida, papel, color, terminación, archivo…" value={l.specs} onChange={(e) => set(i, 'specs', e.target.value)} />
                <div className="grid grid-cols-3 gap-2 items-end">
                  <div><label className={label}>Cantidad</label><input className={input} inputMode="decimal" value={l.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} /></div>
                  <div><label className={label}>Precio c/u</label><input className={input} inputMode="decimal" placeholder="0" value={l.unitPrice} onChange={(e) => set(i, 'unitPrice', e.target.value)} /></div>
                  <p className="text-right text-[15px] font-bold text-slate-900 tabular-nums pb-2.5">{money((parseAmount(l.quantity) || 0) * (parseAmount(l.unitPrice) || 0))}</p>
                </div>
              </div>
            ))}
            <div className="flex flex-col sm:flex-row gap-2">
              <button onClick={() => setLines((ls) => [...ls, blankLine()])} className="h-11 px-4 rounded-xl border border-slate-300 text-[14px] font-semibold text-slate-700 flex items-center justify-center gap-2 cursor-pointer"><Plus className="w-4 h-4" /> Otro trabajo</button>
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input className={`${input} pl-9`} placeholder="O agregá un producto del catálogo" value={productQuery} onChange={(e) => setProductQuery(e.target.value)} />
                {foundProducts.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 mt-1 rounded-xl border border-slate-200 bg-white shadow-lg divide-y divide-slate-100 max-h-64 overflow-y-auto">
                    {foundProducts.map((p: any) => (
                      <button key={p.id} onClick={() => {
                        setLines((ls) => [...ls.filter((x) => x.description || x.unitPrice), { productId: p.id, description: p.name, specs: '', quantity: '1', unitPrice: String(p.salePrice || 0) }]);
                        setProductQuery('');
                      }} className="w-full text-left px-3 py-2.5 hover:bg-slate-50 cursor-pointer flex justify-between gap-2">
                        <span className="text-[14px] text-slate-800 truncate">{p.name}</span>
                        <span className="text-[13px] text-slate-500 tabular-nums shrink-0">{money(p.salePrice)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* Entrega y prioridad */}
          <section className="rounded-2xl bg-white border border-slate-200 p-4 space-y-3">
            <p className="text-[15px] font-bold text-slate-900">Para cuándo</p>
            <div className="flex flex-wrap gap-2">
              {[['Hoy', 0], ['Mañana', 1], ['En 3 días', 3], ['En una semana', 7]].map(([l, d]) => (
                <button key={l as string} onClick={() => setDueAt(atLocal(d as number))} className="h-9 px-3.5 rounded-full text-[13px] font-semibold border border-slate-200 bg-white text-slate-700 cursor-pointer hover:bg-slate-50">{l}</button>
              ))}
            </div>
            <input type="datetime-local" className={input} value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
            <div>
              <label className={label}>Prioridad</label>
              <div className="grid grid-cols-3 gap-2">
                {['ALTA', 'MEDIA', 'BAJA'].map((p) => (
                  <button key={p} onClick={() => setPriority(p)} className={`h-11 rounded-xl border-2 text-[14px] font-semibold cursor-pointer ${priority === p ? PRIORITY_TONE[p] + ' border-current' : 'border-slate-200 bg-white text-slate-600'}`}>{PRIORITY_LABEL[p]}</button>
                ))}
              </div>
            </div>
            <textarea className="w-full min-h-[60px] px-3 py-2 rounded-xl bg-white border border-slate-300 text-[14px] outline-none focus:border-rose-500" placeholder="Notas internas (opcional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </section>

          {/* Seña */}
          <section className="rounded-2xl bg-white border border-slate-200 p-4 space-y-2.5">
            <div className="flex items-center justify-between">
              <p className="text-[15px] font-bold text-slate-900">Seña</p>
              {initial.deposit > 0 && <p className="text-[13px] text-slate-600">Ya dejó {money(initial.deposit)}</p>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input className={input} inputMode="decimal" placeholder={initial.deposit > 0 ? 'Otro pago a cuenta' : 'Cuánto deja (opcional)'} value={deposit} onChange={(e) => setDeposit(e.target.value)} />
              <select className={input} value={method} onChange={(e) => setMethod(e.target.value)}>
                {methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            {total > 0 && <div className="flex justify-between gap-2 text-[14px] flex-wrap">
              <button onClick={() => setDeposit(String(Math.round(total * 0.5)))} className="text-rose-700 font-semibold cursor-pointer">Poner el 50% ({money(Math.round(total * 0.5))})</button>
              <span className="text-slate-600">Queda {money(Math.max(0, total - (initial.deposit || 0) - (parseAmount(deposit) || 0)))}</span>
            </div>}
          </section>
        </div>
      </div>
      <div className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-slate-500">Total</p>
          <p className="text-[20px] font-bold text-slate-900 tabular-nums">{money(total)}</p>
        </div>
        {canSaveAsQuote && (
          <button onClick={startQuote} disabled={saving} className="h-12 px-4 rounded-xl border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-50 text-[14px] font-bold flex items-center gap-2 cursor-pointer">
            <FileText className="w-4 h-4" /> Presupuesto
          </button>
        )}
        <button onClick={save} disabled={saving} className="h-12 px-6 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-[15px] font-bold flex items-center gap-2 cursor-pointer">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Guardar encargo
        </button>
      </div>
      {ownerKeyPanel}
      {askValidity && (
        <Panel title="¿Hasta cuándo vale el presupuesto?" onClose={() => setAskValidity(false)}>
          <div className="grid grid-cols-2 gap-2 pt-1">
            {[3, 7, 15, 30].map((d) => (
              <button key={d} disabled={saving} onClick={() => saveQuote(d)} className="h-12 rounded-xl border-2 border-slate-200 text-[14px] font-semibold text-slate-700 hover:border-rose-500 disabled:opacity-50 cursor-pointer">{d} días</button>
            ))}
          </div>
        </Panel>
      )}
      {savedQuote && <QuotePreview quote={savedQuote} onClose={() => onExit(null)} />}
    </div>
  );
}

// ─── Detalle ──────────────────────────────────────────────────────

function Panel({ title, onClose, children, footer }: { title: string; onClose: () => void; children: any; footer?: any }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[70] mobile-app">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="absolute inset-x-0 bottom-0 sm:inset-auto sm:left-1/2 sm:top-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 sm:w-[560px] max-h-[92dvh] flex flex-col bg-white rounded-t-[26px] sm:rounded-2xl shadow-2xl">
        <div className="flex items-center justify-between px-5 pt-4 pb-2 shrink-0">
          <h2 className="text-[17px] font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center cursor-pointer" aria-label="Cerrar"><X className="w-4 h-4 text-slate-500" /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-4">{children}</div>
        {footer && <div className="shrink-0 px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.9rem)] border-t border-slate-100">{footer}</div>}
      </div>
    </div>
  );
}

function WorkOrderDetail({ id, onClose, onChanged, onEdit }: { id: string; onClose: () => void; onChanged: () => void; onEdit: (o: any) => void }) {
  const [o, setO] = useState<any | null>(null);
  const [busy, setBusy] = useState('');
  const [mode, setMode] = useState<'' | 'collect' | 'deliver' | 'print'>('');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [emisor, setEmisor] = useState<Emisor | null>(null);
  const cash = useCashSession();
  const methods = useMemo(() => [...getPaymentMethods(), { id: 'TRANSFERENCIA', name: 'Transferencia' }], []);
  const role = useWorkRole();
  const production = isProductionRole(role);
  const [askOwnerKey, ownerKeyPanel] = useOwnerKey();
  const [askConfirm, confirmDialog] = useConfirm();
  const [notesDraft, setNotesDraft] = useState<{ notes: string; specs: Record<string, string> } | null>(null);

  const load = () => api.get(`/work-orders/${id}`).then(({ data }) => setO(data)).catch(() => { toast.error('No se encontró el encargo'); onClose(); });
  useEffect(() => { load(); }, [id]);
  if (!o) return <Panel title="Encargo" onClose={onClose}><div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div></Panel>;

  const rest = Math.max(0, Math.round(((o.total || 0) - (o.deposit || 0)) * 100) / 100);
  const open = ['PENDIENTE', 'EN_PROCESO', 'LISTO'].includes(o.status);
  const run = async (key: string, fn: () => Promise<any>, ok?: string) => {
    setBusy(key);
    try {
      const { data } = await fn();
      setO(data);
      onChanged();
      if (ok) toast.success(ok);
      return true;
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo');
      return false;
    } finally {
      setBusy('');
    }
  };
  const session = async () => cash.session?.id || (await cash.open(0))?.id;
  // Cancelar con seña lo autoriza el dueño: si el servidor pide la clave, se pide y se reintenta
  const cancel = async () => {
    const ok = await askConfirm({
      title: '¿Cancelar el encargo?',
      message: o.deposit > 0 ? `La seña de ${money(o.deposit)} queda a favor del cliente.` : undefined,
      confirmLabel: 'Cancelar encargo', cancelLabel: 'Volver', danger: true,
    });
    if (!ok) return;
    setBusy('cancel');
    try {
      let data: any;
      try {
        data = (await api.post(`/work-orders/${o.id}/cancel`, {})).data;
      } catch (err: any) {
        if (!err?.response?.data?.needsAdmin) throw err;
        const adminPassword = await askOwnerKey(err.response.data.message);
        if (!adminPassword) return;
        data = (await api.post(`/work-orders/${o.id}/cancel`, { adminPassword })).data;
      }
      setO(data);
      onChanged();
      toast.success('Encargo cancelado');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo cancelar');
    } finally {
      setBusy('');
    }
  };
  const wa = waNumber(o.client?.phone);
  const notify = async () => {
    if (!wa) return;
    const text = `Hola ${o.client?.name?.split(' ')[0] || ''}! Tu pedido N° ${o.number} (${o.items.map((i: any) => i.description).join(', ')}) ya está listo para retirar.${rest > 0 ? ` Saldo a pagar: ${money(rest).replace(' ', ' ')}.` : ''} Gracias!`;
    window.open(`https://wa.me/${wa}?text=${encodeURIComponent(text)}`, '_blank');
    api.post(`/work-orders/${o.id}/notified`).then(({ data }) => setO(data)).catch(() => {});
  };
  const print = async () => {
    try { setEmisor(await loadEmisor()); setMode('print'); }
    catch (err) { toast.error(err instanceof MissingStoreNameError ? 'Cargá el nombre del comercio en Configuración para imprimir' : 'No se pudo armar el comprobante'); }
  };

  const action = (Icon: any, label: string, onClick: () => void, tone = 'text-slate-800', disabled = false) => (
    <button onClick={onClick} disabled={disabled || !!busy} className={`h-12 rounded-xl border border-slate-200 bg-white flex items-center justify-center gap-2 text-[14px] font-semibold cursor-pointer disabled:opacity-40 ${tone}`}>
      <Icon className="w-4 h-4" /> {label}
    </button>
  );

  return (
    <>
      <Panel title={`Encargo N° ${o.number}`} onClose={onClose}
        footer={open && !production ? (
          <button onClick={() => { setAmount(String(rest)); setMethod('CASH'); setMode('deliver'); }} className="w-full h-12 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[15px] font-bold flex items-center justify-center gap-2 cursor-pointer">
            <PackageCheck className="w-4 h-4" /> Entregar{rest > 0 ? ` y cobrar ${money(rest)}` : ''}
          </button>
        ) : undefined}>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-[17px] font-bold text-slate-900">{o.client?.name || 'Sin cliente'}</p>
              {o.client?.phone && <p className="text-[13px] text-slate-600 flex items-center gap-1.5"><Phone className="w-3.5 h-3.5" /> {o.client.phone}</p>}
            </div>
            <span className={`text-[12px] font-semibold px-2.5 py-1 rounded-full border ${PRIORITY_TONE[o.priority]}`}>Prioridad {PRIORITY_LABEL[o.priority].toLowerCase()}</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-[13.5px]">
            <div className="rounded-xl bg-slate-50 px-3 py-2"><p className="text-[11.5px] text-slate-500">Entrada</p><p className="font-semibold text-slate-900">{new Date(o.receivedAt).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</p></div>
            <div className={`rounded-xl px-3 py-2 ${late(o) ? 'bg-red-50' : 'bg-slate-50'}`}><p className="text-[11.5px] text-slate-500 flex items-center gap-1"><CalendarClock className="w-3 h-3" /> Entrega</p><p className={`font-semibold ${late(o) ? 'text-red-700' : 'text-slate-900'}`}>{dueLabel(o.dueAt)}{late(o) ? ' · atrasado' : ''}</p></div>
          </div>

          {o.status !== 'CANCELADO' && (() => {
            // Avance del trabajo: se toca un paso para moverlo (entregar tiene su propio botón abajo)
            const steps = ['PENDIENTE', 'EN_PROCESO', 'LISTO', 'ENTREGADO'];
            const at = steps.indexOf(o.status);
            return (
              <div className="grid grid-cols-4 gap-1">
                {steps.map((s, i) => {
                  const done = i < at, current = i === at, canTap = open && s !== 'ENTREGADO' && !current;
                  return (
                    <button key={s} disabled={!canTap || !!busy} onClick={() => run('st', () => api.post(`/work-orders/${o.id}/status`, { status: s }), s === 'LISTO' ? 'Marcado como listo' : undefined)}
                      className={`flex flex-col items-center gap-1.5 py-1 ${canTap ? 'cursor-pointer' : 'cursor-default'}`}>
                      <span className="relative w-full flex items-center justify-center">
                        {i > 0 && <span className={`absolute right-1/2 left-[-50%] top-1/2 h-0.5 -translate-y-1/2 ${i <= at ? 'bg-rose-600' : 'bg-slate-200'}`} />}
                        <span className={`relative w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold ${done ? 'bg-rose-600 text-white' : current ? 'bg-rose-600 text-white ring-4 ring-rose-100' : 'bg-white border-2 border-slate-200 text-slate-400'}`}>
                          {done ? <Check className="w-4 h-4" /> : i + 1}
                        </span>
                      </span>
                      <span className={`text-[11.5px] font-semibold leading-tight text-center ${current ? 'text-slate-900' : done ? 'text-slate-600' : 'text-slate-400'}`}>{STATUS_LABEL[s]}</span>
                    </button>
                  );
                })}
              </div>
            );
          })()}
          {!open && o.deliveredAt && <p className="text-[12.5px] text-slate-500 -mt-1">Entregado el {new Date(o.deliveredAt).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}.</p>}
          {o.status === 'CANCELADO' && <p className={`text-[13.5px] font-semibold px-3 py-2 rounded-xl ${STATUS_TONE[o.status]}`}>{STATUS_LABEL[o.status]}{o.deliveredAt ? ` el ${new Date(o.deliveredAt).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}` : ''}</p>}

          <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
            {o.items.map((it: any) => (
              <div key={it.id} className="px-3.5 py-2.5 flex gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[14.5px] font-semibold text-slate-900">{qty(it.quantity)} × {it.description}</p>
                  {it.specs && <p className="text-[12.5px] text-slate-600 whitespace-pre-wrap">{it.specs}</p>}
                </div>
                {!production && <p className="text-[14px] font-semibold text-slate-900 tabular-nums shrink-0">{money(it.total)}</p>}
              </div>
            ))}
            {!production && <div className="px-3.5 py-2.5 text-[14px] space-y-0.5">
              <div className="flex justify-between"><span className="text-slate-600">Total</span><span className="font-bold tabular-nums">{money(o.total)}</span></div>
              <div className="flex justify-between"><span className="text-slate-600">Seña</span><span className="tabular-nums">{money(o.deposit)}</span></div>
              {open && <div className="flex justify-between"><span className="font-semibold text-slate-900">Falta pagar</span><span className="font-bold tabular-nums">{money(rest)}</span></div>}
            </div>}
          </div>
          {o.notes && <p className="text-[13px] text-slate-600 whitespace-pre-wrap"><b>Notas:</b> {o.notes}</p>}

          {!production && (
            <div className="grid grid-cols-2 gap-2">
              {action(MessageCircle, o.notifiedAt ? 'Avisar de nuevo' : 'Avisar que está listo', notify, 'text-emerald-700', !wa)}
              {action(Printer, 'Comprobante', print)}
              {open && action(Wallet, 'Cobrar seña', () => { setAmount(''); setMethod('CASH'); setMode('collect'); }, 'text-slate-800', rest <= 0 || !o.clientId)}
              {open && action(Pencil, 'Editar', () => onEdit(o))}
            </div>
          )}
          {/* Diseño corrige las notas y el detalle de cada trabajo (sin tocar precios) */}
          {open && role === 'DISENO' && <div className="grid">{action(FileText, 'Corregir notas y detalle', () => setNotesDraft({ notes: o.notes || '', specs: Object.fromEntries(o.items.map((it: any) => [it.id, it.specs || ''])) }))}</div>}
          {!production && !wa && <p className="text-[12px] text-slate-500">Para avisar por WhatsApp, cargale el teléfono al cliente.</p>}
          {!production && o.notifiedAt && <p className="text-[12px] text-slate-500">Avisado por WhatsApp el {new Date(o.notifiedAt).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}.</p>}
          {open && !production && (
            <button onClick={cancel} disabled={!!busy}
              className="w-full h-10 text-[13.5px] font-semibold text-red-700 flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40"><Ban className="w-4 h-4" /> Cancelar encargo</button>
          )}

          {/* Quién hizo cada cosa */}
          {o.history?.length > 0 && (
            <div className="pt-1">
              <p className="text-[12px] font-bold uppercase tracking-[0.06em] text-slate-500 flex items-center gap-1.5 mb-1.5"><History className="w-3.5 h-3.5" /> Movimientos</p>
              <ol className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
                {o.history.slice().reverse().map((h: any, i: number) => (
                  <li key={i} className="px-3.5 py-2 text-[13px] flex items-start gap-3">
                    <span className="text-slate-500 tabular-nums shrink-0 w-[86px]">{new Date(h.at).toLocaleString('es-AR', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</span>
                    <span className="min-w-0 flex-1 text-slate-800">
                      <b className="font-semibold">{h.who}</b> · {h.action === 'STATUS' && h.detail ? `Pasó a ${(STATUS_LABEL[h.detail] || h.detail).toLowerCase()}` : h.label}
                      {h.action !== 'STATUS' && h.detail && <span className="text-slate-500"> · {fmtDetail(h.detail)}</span>}
                      {h.byOwner && <span className="ml-1 inline-flex items-center gap-1 text-[11.5px] font-semibold text-amber-700"><KeyRound className="w-3 h-3" /> con clave del dueño</span>}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>
      </Panel>

      {notesDraft && (
        <Panel title="Notas y detalle" onClose={() => setNotesDraft(null)}
          footer={
            <button disabled={!!busy} onClick={async () => {
              const ok = await run('notes', () => api.post(`/work-orders/${o.id}/notes`, notesDraft), 'Notas guardadas');
              if (ok) setNotesDraft(null);
            }} className="w-full h-12 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-[15px] font-bold flex items-center justify-center gap-2 cursor-pointer">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Guardar
            </button>
          }>
          <div className="space-y-3 pt-1">
            {o.items.map((it: any) => (
              <label key={it.id} className="block">
                <span className="block text-[12.5px] font-semibold text-slate-600 mb-1">{qty(it.quantity)} × {it.description}</span>
                <textarea value={notesDraft.specs[it.id] || ''} onChange={(e) => setNotesDraft({ ...notesDraft, specs: { ...notesDraft.specs, [it.id]: e.target.value } })} rows={2}
                  placeholder="Medidas, papel, terminación…" className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 text-[14.5px] outline-none focus:border-rose-500 resize-none" />
              </label>
            ))}
            <label className="block">
              <span className="block text-[12.5px] font-semibold text-slate-600 mb-1">Notas del encargo</span>
              <textarea value={notesDraft.notes} onChange={(e) => setNotesDraft({ ...notesDraft, notes: e.target.value })} rows={3}
                className="w-full px-3 py-2 rounded-xl bg-white border border-slate-300 text-[14.5px] outline-none focus:border-rose-500 resize-none" />
            </label>
          </div>
        </Panel>
      )}
      {ownerKeyPanel}
      {confirmDialog}

      {(mode === 'collect' || mode === 'deliver') && (
        <Panel title={mode === 'collect' ? 'Cobrar seña' : 'Entregar encargo'} onClose={() => setMode('')}
          footer={
            <button disabled={!!busy} onClick={async () => {
              const sessionId = await session();
              const ok = mode === 'collect'
                ? await run('pay', () => api.post(`/work-orders/${o.id}/collect`, { amount: parseAmount(amount), method, sessionId, key: `${Date.now()}` }), 'Seña cobrada')
                : await run('pay', () => api.post(`/work-orders/${o.id}/deliver`, { sessionId, payments: rest > 0 ? [{ method, amount: rest }] : [] }), 'Encargo entregado');
              if (ok) setMode('');
            }} className="w-full h-12 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-[15px] font-bold flex items-center justify-center gap-2 cursor-pointer">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} {mode === 'collect' ? 'Cobrar' : rest > 0 ? `Cobrar ${money(rest)} y entregar` : 'Entregar'}
            </button>
          }>
          <div className="space-y-3 pt-1">
            {mode === 'collect' ? (
              <>
                <p className="text-[14px] text-slate-600">Falta pagar {money(rest)}.</p>
                <input inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Cuánto deja"
                  className="w-full h-14 px-4 rounded-2xl bg-slate-50 border border-slate-200 text-[22px] font-bold outline-none focus:border-rose-500" />
              </>
            ) : (
              <p className="text-[14px] text-slate-600">{rest > 0 ? `Se cobra el saldo de ${money(rest)}${o.deposit > 0 ? ` (la seña de ${money(o.deposit)} ya está descontada)` : ''}.` : 'Ya está todo pagado.'} Queda registrado como venta.</p>
            )}
            {(mode === 'collect' || rest > 0) && (
              <div className="grid grid-cols-2 gap-2">
                {methods.filter((m) => mode === 'deliver' || m.id !== 'DEBT').filter((m) => m.id !== 'DEBT' || o.clientId).map((m) => (
                  <button key={m.id} onClick={() => setMethod(m.id)} className={`h-11 rounded-xl border-2 text-[14px] font-semibold cursor-pointer ${method === m.id ? 'border-rose-600 bg-rose-50 text-rose-800' : 'border-slate-200 text-slate-700'}`}>{m.id === 'DEBT' ? 'Queda a cuenta' : m.name}</button>
                ))}
              </div>
            )}
          </div>
        </Panel>
      )}

      {mode === 'print' && emisor && (
        <DocumentPreview
          title="Comprobante del encargo"
          subtitle={`N° ${o.number} · ${o.client?.name || ''}`}
          fileName={`Encargo_${o.number}`}
          whatsapp={{ phone: o.client?.phone, text: `Comprobante de tu encargo N° ${o.number}${o.dueAt ? `, para el ${dueLabel(o.dueAt)}` : ''}.` }}
          render={(paper) => <WorkOrderReceipt order={o} emisor={emisor} paper={paper} />}
          onClose={() => setMode('')}
        />
      )}
    </>
  );
}

/** Detalle del historial: los importes en pesos ("Total 5000 → 4000", "2000 (CASH)") */
function fmtDetail(d: string) {
  return String(d)
    .replace(/\((CASH|DEBT|CLOVER|MERCADOPAGO|TRANSFERENCIA)\)/, (_, m) => `(${({ CASH: 'efectivo', DEBT: 'a cuenta', CLOVER: 'tarjeta', MERCADOPAGO: 'Mercado Pago', TRANSFERENCIA: 'transferencia' } as any)[m]})`)
    .replace(/(\d+(?:\.\d+)?)/g, (n) => money(Number(n)));
}

/**
 * Pide la clave del administrador para algo que autoriza el dueño (cancelar o cambiar el precio
 * de un encargo con seña). Devuelve la clave, o null si se cerró. El servidor la verifica.
 */
function useOwnerKey(): [(reason?: string) => Promise<string | null>, JSX.Element | null] {
  const [req, setReq] = useState<{ reason?: string; resolve: (v: string | null) => void } | null>(null);
  const [pass, setPass] = useState('');
  const ask = (reason?: string) => new Promise<string | null>((resolve) => { setPass(''); setReq({ reason, resolve }); });
  const close = (v: string | null) => { req?.resolve(v); setReq(null); };
  const panel = req ? (
    <Panel title="Lo autoriza el dueño" onClose={() => close(null)}
      footer={
        <button disabled={!pass} onClick={() => close(pass)} className="w-full h-12 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-[15px] font-bold flex items-center justify-center gap-2 cursor-pointer">
          <KeyRound className="w-4 h-4" /> Autorizar
        </button>
      }>
      <form className="space-y-3 pt-1" onSubmit={(e) => { e.preventDefault(); if (pass) close(pass); }}>
        <p className="text-[14px] text-slate-600">{req.reason || 'Hace falta la clave del administrador.'}</p>
        <input type="password" autoFocus value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Clave del administrador"
          className="w-full h-12 px-4 rounded-xl bg-white border border-slate-300 text-[16px] outline-none focus:border-rose-500" />
      </form>
    </Panel>
  ) : null;
  return [ask, panel];
}
