import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/authStore';
import { myWorkRole } from '../../services/workRole';
import toast from 'react-hot-toast';
import {
  ArrowLeft, Plus, Truck, Loader2, ChevronUp, ChevronDown, X, MapPin, Phone, Package, Route, FileText, Check,
  CalendarDays, Undo2, Flag,
} from 'lucide-react';
import api from '../../services/api';
import { usePOSStore } from '../../stores/posStore';
import { useOwnerMobile } from '../../utils/ownerMobile';
import { useAutoTour } from '../common/tour/GuidedTour';
import { setTourScreen } from '../common/tour/tourContext';
import { loadEmisor, MissingStoreNameError, type Emisor } from '../pos/SalesNoteSheet';
import DocumentPreview from '../common/DocumentPreview';
import { LoadSheet, RouteSheet, RunRemitos, consolidate, liveOrders, bultosOf, looseOf } from './RunSheets';
import { DeliverySheet, SettleSheet, DispatchSheet, DELIVERY_LABEL, paymentSummary, ShortagesBanner } from './DeliverySheets';

/**
 * Reparto (distribuidora): se juntan los pedidos de preventa que salen un día en un camión.
 * De acá salen la hoja de carga, la hoja de ruta y los remitos de todo el reparto.
 */

const money = (n: number) => `$ ${(Math.round((n || 0) * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;
const qty = (n: number) => (Math.round(n * 100) / 100).toLocaleString('es-AR', { maximumFractionDigits: 2 });
const plural = (n: number, one: string, many: string) => `${qty(n)} ${n === 1 ? one : many}`;
const dayLabel = (d: any) => {
  const date = new Date(d);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(date); that.setHours(0, 0, 0, 0);
  const diff = Math.round((that.getTime() - today.getTime()) / 86400000);
  const base = date.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'numeric' });
  return diff === 0 ? `Hoy, ${base}` : diff === 1 ? `Mañana, ${base}` : diff === -1 ? `Ayer, ${base}` : base.charAt(0).toUpperCase() + base.slice(1);
};
const isoDay = (offset: number) => { const d = new Date(); d.setDate(d.getDate() + offset); return d.toISOString().slice(0, 10); };
const mapsUrl = (c: any) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([c?.address, c?.locality, 'Buenos Aires, Argentina'].filter(Boolean).join(', '))}`;

const STATUS: Record<string, { label: string; cls: string }> = {
  ARMANDO: { label: 'Armando', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  EN_REPARTO: { label: 'En reparto', cls: 'bg-sky-50 text-sky-800 border-sky-200' },
  CERRADO: { label: 'Cerrado', cls: 'bg-slate-100 text-slate-600 border-slate-200' },
};

/** Datos del comercio y códigos de producto para las hojas */
function useSheetData() {
  const [emisor, setEmisor] = useState<Emisor | null>(null);
  const [missingName, setMissingName] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => {
    loadEmisor().then(setEmisor).catch((e) => { if (e instanceof MissingStoreNameError) setMissingName(true); });
    const st = usePOSStore.getState();
    if (!st.products.length) {
      api.get('/products/pos-catalog', { silent: true } as any).then(({ data }) => { st.setProducts(data?.products || []); setTick((t) => t + 1); }).catch(() => {});
    }
  }, []);
  const codeOf = (id: string) => {
    const p = usePOSStore.getState().products.find((x: any) => x.id === id);
    return p?.barcode || p?.sku || '';
  };
  return { emisor, missingName, codeOf };
}

export default function RepartoScreen() {
  // Atajos desde "Hoy": ?run=<id> abre un reparto; ?nuevo=1&zona=X arma uno con esa zona elegida
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<{ kind: 'list' } | { kind: 'new'; zone?: string } | { kind: 'run'; id: string }>(() => {
    const run = params.get('run');
    if (run) return { kind: 'run', id: run };
    if (params.get('nuevo')) return { kind: 'new', zone: params.get('zona') || undefined };
    return { kind: 'list' };
  });
  useEffect(() => { if (params.toString()) setParams({}, { replace: true }); }, []);
  if (view.kind === 'new') return <RunBuilder initialZone={view.zone} onCancel={() => setView({ kind: 'list' })} onCreated={(id) => setView({ kind: 'run', id })} />;
  if (view.kind === 'run') return <RunDetail id={view.id} onBack={() => setView({ kind: 'list' })} />;
  return <RunList onNew={() => setView({ kind: 'new' })} onOpen={(id) => setView({ kind: 'run', id })} />;
}

const chip = (on: boolean) => `shrink-0 px-3.5 h-9 rounded-full text-[13px] font-semibold border transition-colors cursor-pointer ${on ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`;

// ─── Lista de repartos ────────────────────────────────────────────

function RunList({ onNew, onOpen }: { onNew: () => void; onOpen: (id: string) => void }) {
  const navigate = useNavigate();
  const inShell = useOwnerMobile().active;
  const [status, setStatus] = useState('ACTIVE');
  const [runs, setRuns] = useState<any[]>([]);
    const [pending, setPending] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
    setTourScreen({ mobile: inShell });
  useAutoTour('distribReparto', !loading);
  // El chofer ve los repartos que lleva él; los arma el encargado
  const isDriver = myWorkRole() === 'CHOFER';
  const [mine, setMine] = useState(isDriver);

  useEffect(() => {
    setLoading(true);
    api.get('/delivery-runs', { params: { status: status === 'ACTIVE' ? 'ALL' : status, ...(mine ? { driver: 'me' } : {}) }, silent: true } as any)
      .then(({ data }) => setRuns((data || []).filter((r: any) => status !== 'ACTIVE' || r.status !== 'CERRADO')))
      .catch(() => setRuns([]))
            .finally(() => setLoading(false));
  }, [status, mine]);
  useEffect(() => {
    api.get('/preorders', { params: { status: 'PENDING', unassigned: '1' }, silent: true } as any).then(({ data }) => setPending((data || []).length)).catch(() => {});
  }, []);

  return (
    <div className="h-full overflow-y-auto bg-slate-50">
      <div className={`max-w-3xl mx-auto space-y-4 pb-24 ${inShell ? 'px-1 py-2' : 'px-4 py-6'}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            {!inShell && <h1 className="text-[24px] font-bold text-slate-900 tracking-tight leading-tight">Reparto</h1>}
            <p className="text-[13.5px] text-slate-500 leading-snug">Juntá los pedidos que salen en cada camión y sacá la hoja de carga, la de ruta y los remitos.</p>
            {useAuthStore.getState().user?.role !== 'ADMIN' && !myWorkRole() && (
              <button onClick={() => navigate('/empezar')} className="mt-1 text-[12px] font-semibold text-slate-400 hover:text-slate-600 cursor-pointer">Cambiar lo que hago en este equipo</button>
            )}
          </div>
                    {!isDriver && <button data-tour="reparto-new" onClick={onNew} className="shrink-0 flex items-center gap-1.5 h-11 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[14px] font-bold cursor-pointer active:scale-[0.98] shadow-sm">
                        <Plus className="w-4 h-4" /> Armar reparto
          </button>}
        </div>

                {!isDriver && pending !== null && pending > 0 && (
          <button onClick={onNew} className="w-full text-left flex items-center gap-3 px-4 py-3 rounded-2xl bg-white border-2 border-rose-200 cursor-pointer hover:border-rose-300">
            <Package className="w-5 h-5 text-rose-600 shrink-0" />
            <span className="flex-1 text-[14px] text-slate-800"><strong>{plural(pending, 'pedido pendiente', 'pedidos pendientes')}</strong> todavía sin reparto.</span>
            <span className="text-[13px] font-bold text-rose-700">Armar</span>
          </button>
        )}

                <div data-tour="reparto-filters" className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
                    {isDriver && <button onClick={() => setMine((v) => !v)} className={chip(mine)}>{mine ? 'Los míos' : 'De todos'}</button>}
          {[['ACTIVE', 'Activos'], ['ARMANDO', 'Armando'], ['EN_REPARTO', 'En reparto'], ['CERRADO', 'Cerrados']].map(([k, l]) => (
            <button key={k} onClick={() => setStatus(k)} className={chip(status === k)}>{l}</button>
          ))}
        </div>

        {loading ? (
          <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
        ) : runs.length === 0 ? (
          <div className="py-14 text-center">
            <div className="w-14 h-14 rounded-2xl bg-white border border-slate-200 mx-auto mb-3 flex items-center justify-center"><Truck className="w-7 h-7 text-slate-300" /></div>
            <p className="text-[15px] font-bold text-slate-700">No hay repartos acá</p>
            <p className="text-[13px] text-slate-500 mt-1">Tocá "Armar reparto" para juntar los pedidos de una o varias zonas.</p>
          </div>
        ) : (
                    <div data-tour="reparto-list" className="space-y-2.5">
            {runs.map((r) => {
              const st = STATUS[r.status] || STATUS.ARMANDO;
              return (
                <button key={r.id} onClick={() => onOpen(r.id)} className="w-full text-left rounded-2xl bg-white border border-slate-200 hover:border-slate-300 px-4 py-3.5 cursor-pointer">
                  <div className="flex items-center gap-2">
                    <p className="text-[15.5px] font-bold text-slate-900">{dayLabel(r.date)}</p>
                    <span className={`text-[10.5px] font-bold px-2 py-0.5 rounded-full border ${st.cls}`}>{st.label}</span>
                    <span className="ml-auto text-[15.5px] font-bold text-slate-900">{money(r.total)}</span>
                  </div>
                  <p className="text-[12.5px] text-slate-500 mt-0.5">
                    Reparto N° {r.runNumber}{r.driverName ? ` · ${r.driverName}` : ''} · {plural(r.stops, 'parada', 'paradas')} · {plural(r.bultos, 'bulto', 'bultos')}
                  </p>
                  {r.zones?.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {r.zones.map((z: string) => <span key={z} className="text-[11.5px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">{z}</span>)}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Armar un reparto ─────────────────────────────────────────────

/** Pedidos pendientes sin reparto, agrupados por localidad, para elegir */
function OrderPicker({ orders, selected, setSelected }: { orders: any[]; selected: Set<string>; setSelected: (s: Set<string>) => void }) {
  const groups = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const o of orders) {
      const z = (o.client?.locality || '').trim() || 'Sin localidad';
      m.set(z, [...(m.get(z) || []), o]);
    }
    return Array.from(m.entries()).sort((a, b) => (a[0] === 'Sin localidad' ? 1 : b[0] === 'Sin localidad' ? -1 : a[0].localeCompare(b[0], 'es')));
  }, [orders]);
  const toggle = (ids: string[], on: boolean) => {
    const next = new Set(selected);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    setSelected(next);
  };
  const Box = ({ on, partial }: { on: boolean; partial?: boolean }) => (
    <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 ${on ? 'bg-rose-600 border-rose-600' : partial ? 'bg-rose-100 border-rose-400' : 'border-slate-300 bg-white'}`}>
      {on && <Check className="w-3.5 h-3.5 text-white" />}
      {!on && partial && <span className="w-2 h-0.5 bg-rose-600 rounded" />}
    </span>
  );
  if (!orders.length) {
    return (
      <div className="py-10 text-center rounded-2xl bg-white border border-slate-200">
        <p className="text-[14px] font-semibold text-slate-700">No hay pedidos pendientes sin reparto</p>
        <p className="text-[12.5px] text-slate-500 mt-1">Los pedidos se toman en Preventa.</p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {groups.map(([zone, list]) => {
        const ids = list.map((o) => o.id);
        const n = ids.filter((id) => selected.has(id)).length;
        const bultos = list.reduce((s, o) => s + bultosOf(o), 0);
        return (
          <div key={zone} className="rounded-2xl bg-white border border-slate-200 overflow-hidden">
            <button onClick={() => toggle(ids, n < ids.length)} className="w-full px-4 py-3 flex items-center gap-3 bg-slate-50 border-b border-slate-100 cursor-pointer">
              <Box on={n === ids.length} partial={n > 0} />
              <span className="flex-1 text-left">
                <span className="block text-[15px] font-bold text-slate-900">{zone}</span>
                <span className="block text-[12px] text-slate-500">{plural(list.length, 'pedido', 'pedidos')} · {plural(bultos, 'bulto', 'bultos')}</span>
              </span>
              <span className="text-[13.5px] font-bold text-slate-800">{money(list.reduce((s, o) => s + (o.total || 0), 0))}</span>
            </button>
            <div className="divide-y divide-slate-100">
              {list.map((o) => (
                <button key={o.id} onClick={() => toggle([o.id], !selected.has(o.id))} className="w-full px-4 py-2.5 flex items-center gap-3 text-left cursor-pointer hover:bg-slate-50">
                  <Box on={selected.has(o.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-slate-900 truncate">{o.client?.name || 'Sin cliente'}</span>
                    <span className="block text-[12px] text-slate-500 truncate">Pedido N° {o.orderNumber}{o.client?.address ? ` · ${o.client.address}` : ''}</span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-[13.5px] font-bold text-slate-800">{money(o.total)}</span>
                    <span className="block text-[11.5px] text-slate-500">{[bultosOf(o) ? plural(bultosOf(o), 'bulto', 'bultos') : '', looseOf(o) ? `${qty(looseOf(o))} u.` : ''].filter(Boolean).join(' + ')}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Choferes: los usuarios del comercio ──────────────────────────

type DriverUser = { id: string; name: string; role: string; workRole?: string | null };
const myId = () => useAuthStore.getState().user?.id;
/** Usuarios que pueden llevar un reparto (choferes primero, después el dueño) */
function useDriverUsers() {
  const [users, setUsers] = useState<DriverUser[]>([]);
  useEffect(() => { api.get('/delivery-runs/drivers', { silent: true } as any).then(({ data }) => setUsers(data || [])).catch(() => {}); }, []);
  // Solo los que manejan: choferes, el dueño y el que está usando el equipo
  return users.filter((u) => u.workRole === 'CHOFER' || u.role === 'ADMIN' || u.id === myId());
}
const userNamed = (users: DriverUser[], name: string) => {
  const n = name.trim().toLowerCase();
  return n ? users.find((u) => u.name.trim().toLowerCase() === n) || null : null;
};

function RunBuilder({ initialZone, onCancel, onCreated }: { initialZone?: string; onCancel: () => void; onCreated: (id: string) => void }) {
    const [orders, setOrders] = useState<any[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useAutoTour('distribArmar', orders !== null);
  const [date, setDate] = useState(isoDay(1));
  const [driverName, setDriverName] = useState('');
  const [vehicle, setVehicle] = useState('');
    const [drivers, setDrivers] = useState<string[]>([]);
  const users = useDriverUsers();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get('/preorders', { params: { status: 'PENDING', unassigned: '1' } }).then(({ data }) => {
      setOrders(data || []);
      if (initialZone) setSelected(new Set((data || []).filter((o: any) => ((o.client?.locality || '').trim() || 'Sin localidad') === initialZone).map((o: any) => o.id)));
    }).catch(() => { setOrders([]); toast.error('No se pudieron cargar los pedidos'); });
    api.get('/delivery-runs', { params: { status: 'ALL' }, silent: true } as any).then(({ data }) => {
      setDrivers(Array.from(new Set((data || []).map((r: any) => r.driverName).filter(Boolean))) as string[]);
    }).catch(() => {});
  }, []);

  const chosen = (orders || []).filter((o) => selected.has(o.id));
  const sumBultos = chosen.reduce((s, o) => s + bultosOf(o), 0);
  const sumTotal = chosen.reduce((s, o) => s + (o.total || 0), 0);

  const create = async () => {
    if (!chosen.length) { toast.error('Elegí los pedidos que salen'); return; }
    setSaving(true);
    try {
      // Paradas: por localidad y, dentro de cada una, por dirección
      const ordered = [...chosen].sort((a, b) => (a.client?.locality || '~').localeCompare(b.client?.locality || '~', 'es') || (a.client?.address || '').localeCompare(b.client?.address || '', 'es'));
            const driverUser = userNamed(users, driverName);
      const { data } = await api.post('/delivery-runs', { date: `${date}T08:00:00`, driverName: driverName.trim() || undefined, driverUserId: driverUser?.id, vehicle: vehicle.trim() || undefined, orderIds: ordered.map((o) => o.id) });
      toast.success(`Reparto N° ${data.runNumber} armado`);
      onCreated(data.id);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo armar el reparto');
    } finally {
      setSaving(false);
    }
  };

  const input = 'w-full h-11 px-3.5 rounded-xl bg-white border border-slate-300 text-[14.5px] outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15';

  return (
    <div className="h-full flex flex-col bg-slate-50">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 px-3 py-2.5 flex items-center gap-2">
        <button onClick={onCancel} className="w-10 h-10 rounded-full hover:bg-slate-100 flex items-center justify-center cursor-pointer" aria-label="Volver"><ArrowLeft className="w-5 h-5 text-slate-700" /></button>
        <p className="text-[16px] font-bold text-slate-900">Armar reparto</p>
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-4 space-y-5 pb-36">
                    <section data-tour="armar-when" className="space-y-3">
            <h2 className="text-[15px] font-bold text-slate-900">¿Cuándo sale y quién lo lleva?</h2>
            <div className="flex gap-2 flex-wrap">
              {[[0, 'Hoy'], [1, 'Mañana']].map(([off, l]) => (
                <button key={l as string} onClick={() => setDate(isoDay(off as number))} className={chip(date === isoDay(off as number))}>{l}</button>
              ))}
              <label className={`${chip(date !== isoDay(0) && date !== isoDay(1))} flex items-center gap-1.5`}>
                <CalendarDays className="w-3.5 h-3.5" />
                <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="bg-transparent outline-none text-[13px]" aria-label="Fecha del reparto" />
              </label>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-[12.5px] font-bold text-slate-600 mb-1">Chofer</label>
                                {users.length > 1 && (
                  <div className="flex gap-1.5 flex-wrap mb-1.5">
                    {users.slice(0, 6).map((u) => (
                      <button key={u.id} type="button" onClick={() => setDriverName(u.name)} className={chip(userNamed(users, driverName)?.id === u.id)}>
                        {u.id === myId() ? `Yo (${u.name})` : u.name}
                      </button>
                    ))}
                  </div>
                )}
                <input list="run-drivers" value={driverName} onChange={(e) => setDriverName(e.target.value)} placeholder="Ej.: Carlos" className={input} />
                <datalist id="run-drivers">{Array.from(new Set([...users.map((u) => u.name), ...drivers])).map((d) => <option key={d} value={d} />)}</datalist>
              </div>
              <div>
                <label className="block text-[12.5px] font-bold text-slate-600 mb-1">Vehículo <span className="font-normal text-slate-400">(opcional)</span></label>
                <input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="Ej.: Camioneta blanca" className={input} />
              </div>
            </div>
          </section>

                    <section data-tour="armar-orders" className="space-y-3">
            <div className="flex items-end justify-between gap-3">
              <h2 className="text-[15px] font-bold text-slate-900">¿Qué pedidos salen?</h2>
              {orders && orders.length > 0 && (
                <button onClick={() => setSelected(selected.size === orders.length ? new Set() : new Set(orders.map((o) => o.id)))} className="text-[13px] font-bold text-rose-700 cursor-pointer">
                  {selected.size === orders.length ? 'Quitar todos' : 'Elegir todos'}
                </button>
              )}
            </div>
            <p className="text-[12.5px] text-slate-500 -mt-2">Tocá una localidad para elegir todos sus pedidos, o elegilos de a uno.</p>
            {orders === null ? <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>
              : <OrderPicker orders={orders} selected={selected} setSelected={setSelected} />}
          </section>
        </div>
      </div>
      <div className="sticky bottom-0 bg-white border-t border-slate-200 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)] shadow-[0_-8px_24px_-16px_rgba(15,23,42,0.35)]">
        <div className="max-w-3xl mx-auto flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-[12px] text-slate-500 truncate">{chosen.length ? `${plural(chosen.length, 'parada', 'paradas')} · ${plural(sumBultos, 'bulto', 'bultos')}` : 'Elegí los pedidos'}</p>
            <p className="text-[21px] font-bold text-slate-900 leading-tight">{money(sumTotal)}</p>
          </div>
                    <button data-tour="armar-create" onClick={create} disabled={saving || !chosen.length} className="h-12 px-6 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-[15px] font-bold cursor-pointer flex items-center gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Truck className="w-4 h-4" />} Armar reparto
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Un reparto ───────────────────────────────────────────────────

function RunDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const [run, setRun] = useState<any | null>(null);
  const [tab, setTab] = useState<'ruta' | 'carga'>('ruta');
  const [doc, setDoc] = useState<null | 'carga' | 'ruta' | 'remitos'>(null);
  const [remitoMode, setRemitoMode] = useState<'remito' | 'both'>('remito');
  const [adding, setAdding] = useState<any[] | null>(null);
  const [addSel, setAddSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [delivering, setDelivering] = useState<any | null>(null);
      const [settling, setSettling] = useState(false);
  const users = useDriverUsers();
  const isDriver = myWorkRole() === 'CHOFER';
  // La primera vez que se ve un reparto armado y uno en la calle, se explica cada parte
  useAutoTour('distribRuta', run?.status === 'ARMANDO' && !doc && !adding);
  useAutoTour('distribEntregas', run?.status === 'EN_REPARTO' && !doc && !delivering && !settling);
  // Marcar varias paradas como entregadas de una vez
  const [picking, setPicking] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [askPay, setAskPay] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const { emisor, missingName, codeOf } = useSheetData();

  const load = () => api.get(`/delivery-runs/${id}`).then(({ data }) => setRun(data)).catch(() => { toast.error('No se pudo abrir el reparto'); onBack(); });
  useEffect(() => { load(); }, [id]);

  if (!run) return <div className="h-full flex items-center justify-center"><Loader2 className="w-6 h-6 text-slate-400 animate-spin" /></div>;

  const orders = liveOrders(run);
  const editable = run.status === 'ARMANDO';
  const st = STATUS[run.status] || STATUS.ARMANDO;
  const total = orders.reduce((s: number, o: any) => s + (o.total || 0), 0);
  const bultos = orders.reduce((s: number, o: any) => s + bultosOf(o), 0);

  const setStops = async (ids: string[]) => {
    setBusy(true);
    try { setRun((await api.put(`/delivery-runs/${id}/stops`, { orderIds: ids })).data); }
    catch (err: any) { toast.error(err?.response?.data?.message || 'No se pudo cambiar el reparto'); }
    finally { setBusy(false); }
  };
  const move = (i: number, dir: -1 | 1) => {
    const ids = orders.map((o: any) => o.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setRun({ ...run, orders: ids.map((x: string) => orders.find((o: any) => o.id === x)) });
    setStops(ids);
  };
  const removeStop = (oid: string) => setStops(orders.filter((o: any) => o.id !== oid).map((o: any) => o.id));
  const setStatus = async (status: string, msg: string) => {
    setBusy(true);
    try { setRun((await api.patch(`/delivery-runs/${id}`, { status })).data); toast.success(msg); }
    catch (err: any) { toast.error(err?.response?.data?.message || 'No se pudo cambiar el estado'); }
    finally { setBusy(false); }
  };
    const editField = async (field: 'driverName' | 'vehicle', label: string) => {
    const value = window.prompt(field === 'driverName' && users.length ? `${label} (${users.map((u) => u.name).join(', ')} u otro)` : label, run[field] || '');
    if (value === null) return;
    // Si es uno de los usuarios, el reparto queda a su nombre y le aparece en su celular
    const driverUser = field === 'driverName' ? userNamed(users, value) : null;
    const body: any = { [field]: value.trim() };
    if (driverUser) body.driverUserId = driverUser.id;
    try { setRun((await api.patch(`/delivery-runs/${id}`, body)).data); } catch { toast.error('No se pudo guardar'); }
  };
  const undo = async () => {
    if (!window.confirm('¿Deshacer el reparto? Los pedidos vuelven a quedar pendientes, sin reparto.')) return;
    try { await api.delete(`/delivery-runs/${id}`); toast.success('Reparto deshecho'); onBack(); }
    catch (err: any) { toast.error(err?.response?.data?.message || 'No se pudo deshacer'); }
  };
  const openAdd = async () => {
    try { setAdding((await api.get('/preorders', { params: { status: 'PENDING', unassigned: '1' } })).data || []); setAddSel(new Set()); }
    catch { toast.error('No se pudieron cargar los pedidos'); }
  };
  const confirmAdd = async () => {
    await setStops([...orders.map((o: any) => o.id), ...Array.from(addSel)]);
    setAdding(null);
  };
  const openDoc = (d: 'carga' | 'ruta' | 'remitos') => {
    if (missingName) { toast.error('Falta el nombre del comercio. Lo carga el administrador en Configuración → General y POS.', { duration: 6000 }); return; }
    if (!orders.length) { toast.error('El reparto no tiene pedidos'); return; }
    setDoc(d);
  };

  const rows = consolidate(run, codeOf);
  // Los pedidos que salieron ya son ventas (BILLED): esas son las paradas a registrar
  const routeStops = orders.filter((o: any) => o.status === 'BILLED' && o.saleId);
  const togglePick = (oid: string) => setPicked((prev) => { const n = new Set(prev); if (n.has(oid)) n.delete(oid); else n.add(oid); return n; });
  const pickedTotal = orders.filter((o: any) => picked.has(o.id)).reduce((s: number, o: any) => s + (o.total || 0), 0);
  const markMany = async (payment: 'cash' | 'transfer' | 'debt') => {
    setBusy(true);
    try {
      const { data } = await api.put(`/delivery-runs/${id}/deliveries`, { orderIds: Array.from(picked), payment });
      setRun(data);
      toast.success(`${plural(picked.size, 'parada marcada', 'paradas marcadas')} como entregadas`);
      setPicked(new Set()); setPicking(false); setAskPay(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudieron marcar');
    } finally {
      setBusy(false);
    }
  };
  const actionBtn = 'flex-1 min-w-[110px] h-12 rounded-xl bg-white border border-slate-200 hover:border-slate-300 text-[13.5px] font-bold text-slate-800 flex items-center justify-center gap-2 cursor-pointer';
  const baseName = `Reparto_${run.runNumber}_${new Date(run.date).toISOString().slice(0, 10)}`;

  return (
    <div className="h-full flex flex-col bg-slate-50">
      <div className="sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 px-3 py-2.5 flex items-center gap-2">
        <button onClick={onBack} className="w-10 h-10 rounded-full hover:bg-slate-100 flex items-center justify-center cursor-pointer" aria-label="Volver"><ArrowLeft className="w-5 h-5 text-slate-700" /></button>
        <div className="min-w-0 flex-1">
          <p className="text-[16px] font-bold text-slate-900 leading-tight truncate">{dayLabel(run.date)}</p>
          <p className="text-[12px] text-slate-500 truncate">Reparto N° {run.runNumber}</p>
        </div>
        <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full border ${st.cls}`}>{st.label}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-4 space-y-4 pb-28">
                    <div data-tour="ruta-driver" className="grid grid-cols-2 gap-2">
            <button onClick={() => editField('driverName', 'Nombre del chofer')} className="text-left px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 cursor-pointer hover:border-slate-300">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Chofer</p>
              <p className="text-[14.5px] font-bold text-slate-900 truncate">{run.driverName || <span className="text-slate-400 font-medium">Sin asignar</span>}</p>
            </button>
            <button onClick={() => editField('vehicle', 'Vehículo')} className="text-left px-3.5 py-2.5 rounded-xl bg-white border border-slate-200 cursor-pointer hover:border-slate-300">
              <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">Vehículo</p>
              <p className="text-[14.5px] font-bold text-slate-900 truncate">{run.vehicle || <span className="text-slate-400 font-medium">Sin indicar</span>}</p>
            </button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {[['Paradas', String(orders.length)], ['Bultos', qty(bultos)], ['A cobrar', money(total)]].map(([l, v]) => (
              <div key={l} className="px-3 py-2.5 rounded-xl bg-white border border-slate-200">
                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide">{l}</p>
                <p className="text-[16px] font-bold text-slate-900 truncate">{v}</p>
              </div>
            ))}
          </div>

                                        {run.status === 'ARMANDO' && <ShortagesBanner shortages={run.shortages} />}
          {run.status === 'CERRADO' && run.expensesTotal > 0 && (
            <div className="px-4 py-3 rounded-2xl bg-white border border-slate-200 text-[13px] text-slate-700">
              <span className="font-bold text-slate-900">Gastos del reparto: {money(run.expensesTotal)}</span>
              {(() => { try { return ` · ${JSON.parse(run.expenses || '[]').map((e: any) => `${e.concept} ${money(e.amount)}`).join(' · ')}`; } catch { return ''; } })()}
            </div>
          )}

          <div data-tour="ruta-docs" className="flex flex-wrap gap-2">
            <button onClick={() => openDoc('carga')} className={actionBtn}><Package className="w-4 h-4 text-rose-600" /> Hoja de carga</button>
            <button onClick={() => openDoc('ruta')} className={actionBtn}><Route className="w-4 h-4 text-rose-600" /> Hoja de ruta</button>
            <button onClick={() => openDoc('remitos')} className={actionBtn}><FileText className="w-4 h-4 text-rose-600" /> Remitos</button>
          </div>

                    <div data-tour="ruta-tabs" className="flex p-1 rounded-xl bg-slate-200/60">
            {([['ruta', 'Paradas'], ['carga', 'Qué se carga']] as const).map(([k, l]) => (
              <button key={k} onClick={() => setTab(k)} className={`flex-1 h-9 rounded-lg text-[13.5px] font-bold cursor-pointer ${tab === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'}`}>{l}</button>
            ))}
          </div>

                    {tab === 'ruta' ? (
            <div data-tour="ruta-stops" className="space-y-2">
              {run.status === 'EN_REPARTO' && routeStops.length > 1 && (
                <div className="flex items-center justify-between gap-2 px-1">
                  {picking ? (
                    <>
                      <button onClick={() => setPicked(new Set(routeStops.filter((o: any) => !o.deliveryStatus).map((o: any) => o.id)))} className="text-[13px] font-bold text-rose-700 cursor-pointer">Elegir las sin registrar</button>
                      <button onClick={() => { setPicking(false); setPicked(new Set()); }} className="text-[13px] font-bold text-slate-500 cursor-pointer">Cancelar</button>
                    </>
                  ) : (
                    <>
                      <span className="text-[12.5px] text-slate-500">¿Se entregaron varias sin problemas?</span>
                                            <button data-tour="ruta-many" onClick={() => setPicking(true)} className="h-9 px-3.5 rounded-xl border border-slate-300 bg-white text-[13px] font-bold text-slate-800 cursor-pointer hover:bg-slate-50 flex items-center gap-1.5">
                        <Check className="w-4 h-4" /> Marcar varias
                      </button>
                    </>
                  )}
                </div>
              )}
              {orders.map((o: any, i: number) => (
                <div key={o.id}
                  onClick={picking && o.status === 'BILLED' ? () => togglePick(o.id) : undefined}
                  className={`rounded-2xl bg-white border px-3 py-3 flex items-start gap-3 ${picking && o.status === 'BILLED' ? 'cursor-pointer' : ''} ${picked.has(o.id) ? 'border-rose-500 ring-2 ring-rose-200' : 'border-slate-200'}`}>
                  {picking && o.status === 'BILLED' ? (
                    <span className={`w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 ${picked.has(o.id) ? 'bg-rose-600 border-rose-600' : 'border-slate-300 bg-white'}`}>
                      {picked.has(o.id) ? <Check className="w-4 h-4 text-white" /> : <span className="text-[12px] font-bold text-slate-400">{i + 1}</span>}
                    </span>
                  ) : (
                    <span className="w-8 h-8 rounded-full bg-slate-900 text-white text-[13px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-[15px] font-bold text-slate-900 leading-tight">{o.client?.name || 'Sin cliente'}</p>
                    <p className="text-[12.5px] text-slate-500 mt-0.5">{[o.client?.address, o.client?.locality].filter(Boolean).join(', ') || 'Sin dirección'}</p>
                    <p className="text-[12.5px] text-slate-700 mt-1">
                      <strong>{money(o.total)}</strong> · {bultosOf(o) ? plural(bultosOf(o), 'bulto', 'bultos') : ''}{bultosOf(o) && looseOf(o) ? ' + ' : ''}{looseOf(o) ? `${qty(looseOf(o))} u.` : ''} · N° {o.orderNumber}
                    </p>
                                        {o.notes && <p className="text-[12px] text-slate-500 italic mt-0.5">{o.notes}</p>}
                    {run.status !== 'CERRADO' && o.prevDebt > 0.009 && (
                      <p className="text-[12px] font-semibold text-rose-700 mt-0.5">Debe {money(o.prevDebt)} de antes{o.prevCash || o.prevTransfer ? ` · pagó ${money((o.prevCash || 0) + (o.prevTransfer || 0))}` : ''}</p>
                    )}
                    {run.status !== 'ARMANDO' && (
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        {o.deliveryStatus ? (
                          <>
                            <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${DELIVERY_LABEL[o.deliveryStatus].cls}`}>{DELIVERY_LABEL[o.deliveryStatus].label}</span>
                            <span className="text-[12px] text-slate-600">{o.deliveryStatus === 'NOT_DELIVERED' ? o.deliveryReason : paymentSummary(o)}</span>
                          </>
                        ) : (
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border bg-white text-slate-500 border-slate-200">Sin registrar</span>
                        )}
                      </div>
                    )}
                    <div className="flex gap-2 mt-2">
                      {(o.client?.address || o.client?.locality) && (
                                                <a data-tour="ruta-contact" href={mapsUrl(o.client)} target="_blank" rel="noreferrer" className="h-8 px-2.5 rounded-lg bg-slate-100 text-slate-700 text-[12px] font-bold flex items-center gap-1"><MapPin className="w-3.5 h-3.5" /> Mapa</a>
                      )}
                      {o.client?.phone && (
                        <a href={`tel:${o.client.phone.replace(/[^\d+]/g, '')}`} className="h-8 px-2.5 rounded-lg bg-slate-100 text-slate-700 text-[12px] font-bold flex items-center gap-1"><Phone className="w-3.5 h-3.5" /> Llamar</a>
                      )}
                      {run.status === 'EN_REPARTO' && o.status === 'BILLED' && !picking && (
                                                <button data-tour="ruta-deliver" onClick={() => setDelivering(o)} className={`h-8 px-3 rounded-lg text-[12px] font-bold flex items-center gap-1 cursor-pointer ${o.deliveryStatus ? 'bg-slate-100 text-slate-700' : 'bg-rose-600 text-white'}`}>
                          <Check className="w-3.5 h-3.5" /> {o.deliveryStatus ? 'Corregir' : 'Registrar entrega'}
                        </button>
                      )}
                    </div>
                  </div>
                  {editable && (
                    <div className="flex flex-col gap-1 shrink-0">
                      <button onClick={() => move(i, -1)} disabled={busy || i === 0} className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center disabled:opacity-30 cursor-pointer" aria-label="Subir parada"><ChevronUp className="w-4 h-4" /></button>
                      <button onClick={() => move(i, 1)} disabled={busy || i === orders.length - 1} className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center disabled:opacity-30 cursor-pointer" aria-label="Bajar parada"><ChevronDown className="w-4 h-4" /></button>
                      <button onClick={() => removeStop(o.id)} disabled={busy} className="w-8 h-8 rounded-lg border border-slate-200 flex items-center justify-center text-rose-600 cursor-pointer" aria-label="Sacar del reparto" title="Sacar del reparto (el pedido sigue pendiente)"><X className="w-4 h-4" /></button>
                    </div>
                  )}
                </div>
              ))}
              {editable && (
                <button onClick={openAdd} className="w-full h-12 rounded-2xl border-2 border-dashed border-slate-300 text-slate-600 text-[14px] font-bold hover:border-slate-400 cursor-pointer flex items-center justify-center gap-2">
                  <Plus className="w-4 h-4" /> Agregar pedidos
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-2xl bg-white border border-slate-200 divide-y divide-slate-100">
              {rows.map((r) => (
                <div key={r.name + r.code} className="px-4 py-2.5 flex items-center gap-3">
                  <span className="min-w-0 flex-1 text-[14px] font-semibold text-slate-900">{r.name}</span>
                  <span className="text-right shrink-0">
                    <span className="block text-[14.5px] font-bold text-slate-900">
                      {r.packs.size ? Array.from(r.packs.entries()).map(([size, n]) => `${qty(n)} ${n === 1 ? 'bulto' : 'bultos'}${r.packs.size > 1 ? ` x${size}` : ''}`).join(' + ') : `${qty(r.loose)} u.`}
                    </span>
                    {r.packs.size > 0 && r.loose > 0 && <span className="block text-[12px] text-slate-500">+ {qty(r.loose)} sueltas</span>}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 bg-white border-t border-slate-200 px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
        <div className="max-w-3xl mx-auto flex items-center gap-2">
          {editable ? (
            <>
              <button onClick={undo} className="h-12 px-4 rounded-xl text-slate-600 text-[13.5px] font-bold hover:bg-slate-100 cursor-pointer flex items-center gap-1.5"><Undo2 className="w-4 h-4" /> Deshacer</button>
              <span className="flex-1" />
                            <button data-tour="ruta-dispatch" onClick={() => setDispatching(true)} disabled={busy || !orders.length} className="h-12 px-5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-[15px] font-bold cursor-pointer flex items-center gap-2">
                <Truck className="w-4 h-4" /> Salió a reparto
              </button>
            </>
          ) : run.status === 'EN_REPARTO' && picking ? (
            <>
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-slate-500">{picked.size ? plural(picked.size, 'parada elegida', 'paradas elegidas') : 'Tocá las paradas entregadas'}</p>
                <p className="text-[18px] font-bold text-slate-900 leading-tight">{money(pickedTotal)}</p>
              </div>
              <button onClick={() => setAskPay(true)} disabled={busy || !picked.size} className="h-12 px-5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-[15px] font-bold cursor-pointer flex items-center gap-2 shrink-0">
                <Check className="w-4 h-4" /> Marcar entregadas
              </button>
            </>
          ) : run.status === 'EN_REPARTO' ? (
            <>
              <div className="flex-1 min-w-0 text-[12.5px] text-slate-500 px-1 truncate">
                {routeStops.filter((o: any) => o.deliveryStatus).length} de {routeStops.length} paradas registradas
              </div>
                                          {isDriver ? (
                <p className="text-[12px] text-slate-500 text-right leading-snug max-w-[200px]">Al volver, el encargado cuenta la plata y cierra el reparto.</p>
              ) : (
                <button data-tour="ruta-settle" onClick={() => setSettling(true)} disabled={busy} className="h-12 px-5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-[15px] font-bold cursor-pointer flex items-center gap-2 shrink-0">
                  <Flag className="w-4 h-4" /> Volvió: rendir
                </button>
              )}
            </>
          ) : (
            <div className="flex-1 grid grid-cols-3 gap-2 text-center">
              <div><p className="text-[11px] font-semibold text-slate-500 uppercase">Efectivo esperado</p><p className="text-[15px] font-bold text-slate-900">{money(run.expectedCash || 0)}</p></div>
              <div><p className="text-[11px] font-semibold text-slate-500 uppercase">Entregó</p><p className="text-[15px] font-bold text-slate-900">{run.cashReceived == null ? '—' : money(run.cashReceived)}</p></div>
              <div>
                <p className="text-[11px] font-semibold text-slate-500 uppercase">Diferencia</p>
                {(() => { const d = run.cashReceived == null ? 0 : Math.round((run.cashReceived - (run.expectedCash || 0)) * 100) / 100; return <p className={`text-[15px] font-bold ${Math.abs(d) < 0.01 ? 'text-emerald-700' : d < 0 ? 'text-rose-700' : 'text-amber-700'}`}>{Math.abs(d) < 0.01 ? 'Justa' : (d < 0 ? '−' : '+') + money(Math.abs(d))}</p>; })()}
              </div>
            </div>
          )}
        </div>
      </div>

      {askPay && (
        <div className="fixed inset-0 z-[200] bg-slate-900/50 flex items-end sm:items-center justify-center" onClick={() => setAskPay(false)}>
          <div role="dialog" aria-modal="true" aria-label="Cómo pagaron" className="w-full sm:max-w-md bg-white rounded-t-3xl sm:rounded-3xl p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] space-y-3" onClick={(e) => e.stopPropagation()}>
            <p className="text-[17px] font-bold text-slate-900">¿Cómo pagaron?</p>
            <p className="text-[13px] text-slate-500 -mt-1">Las {plural(picked.size, 'parada', 'paradas')} quedan como "Entregado todo" ({money(pickedTotal)}). Si alguna pagó distinto, corregila después.</p>
            {([['cash', 'Todas en efectivo'], ['transfer', 'Todas por transferencia'], ['debt', 'Ninguna pagó (a cuenta corriente)']] as const).map(([k, l]) => (
              <button key={k} onClick={() => markMany(k)} disabled={busy} className="w-full h-12 rounded-xl border-2 border-slate-200 hover:border-slate-900 text-[14.5px] font-bold text-slate-800 cursor-pointer disabled:opacity-50">{l}</button>
            ))}
            <button onClick={() => setAskPay(false)} className="w-full h-10 text-[13.5px] font-semibold text-slate-500 cursor-pointer">Cancelar</button>
          </div>
        </div>
      )}

      {dispatching && (
        <DispatchSheet run={run} onClose={() => setDispatching(false)} onDone={(r) => { setRun(r); setDispatching(false); }} />
      )}

      {delivering && (
        <DeliverySheet run={run} order={delivering} onClose={() => setDelivering(null)} onSaved={(r) => { setRun(r); setDelivering(null); }} />
      )}
      {settling && (
        <SettleSheet run={run} onClose={() => setSettling(false)} onDone={(r) => { setRun(r); setSettling(false); }} />
      )}

      {adding && (
        <div className="fixed inset-0 z-[200] bg-slate-900/50 flex items-end sm:items-center justify-center" onClick={() => setAdding(null)}>
          <div className="w-full sm:max-w-2xl bg-slate-50 rounded-t-3xl sm:rounded-3xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 flex items-center justify-between border-b border-slate-200">
              <p className="text-[16px] font-bold text-slate-900">Agregar pedidos al reparto</p>
              <button onClick={() => setAdding(null)} className="w-9 h-9 rounded-full hover:bg-slate-100 flex items-center justify-center cursor-pointer" aria-label="Cerrar"><X className="w-5 h-5 text-slate-500" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4"><OrderPicker orders={adding} selected={addSel} setSelected={setAddSel} /></div>
            <div className="px-5 py-3.5 border-t border-slate-200 flex justify-end">
              <button onClick={confirmAdd} disabled={!addSel.size || busy} className="h-11 px-5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white text-[14px] font-bold cursor-pointer">
                Agregar {addSel.size ? plural(addSel.size, 'pedido', 'pedidos') : ''}
              </button>
            </div>
          </div>
        </div>
      )}

      {doc && emisor && (
        <DocumentPreview
          title={doc === 'carga' ? 'Hoja de carga' : doc === 'ruta' ? 'Hoja de ruta' : 'Remitos del reparto'}
          subtitle={`${dayLabel(run.date)} · Reparto N° ${run.runNumber}${run.driverName ? ` · ${run.driverName}` : ''}`}
          options={doc === 'remitos' ? [
            { key: 'remito', label: 'Solo remitos', help: 'Un remito sin precios por pedido: lo firma quien recibe y vuelve con el chofer.' },
            { key: 'both', label: 'Remito y nota', help: 'Por cada pedido, la nota de venta con precios (para el cliente) y el remito para firmar.' },
          ] : undefined}
          option={remitoMode}
          onOption={(k) => setRemitoMode(k as 'remito' | 'both')}
          fileName={`${doc === 'carga' ? 'Hoja_de_carga' : doc === 'ruta' ? 'Hoja_de_ruta' : 'Remitos'}_${baseName}`}
          whatsapp={doc !== 'remitos' ? {
            text: `${doc === 'carga' ? 'Hoja de carga' : 'Hoja de ruta'} del reparto N° ${run.runNumber} (${dayLabel(run.date)}): ${plural(orders.length, 'parada', 'paradas')}, ${plural(bultos, 'bulto', 'bultos')}, ${money(total)} a cobrar.`,
            hint: 'Elegís al chofer en WhatsApp',
          } : undefined}
          onClose={() => setDoc(null)}
          render={(paper) => (
            doc === 'carga' ? <div style={paper ? { display: 'flex', justifyContent: 'center' } : undefined}><LoadSheet run={run} emisor={emisor} codeOf={codeOf} paper={paper} /></div>
              : doc === 'ruta' ? <div style={paper ? { display: 'flex', justifyContent: 'center' } : undefined}><RouteSheet run={run} emisor={emisor} paper={paper} /></div>
                : <RunRemitos run={run} emisor={emisor} codeOf={codeOf} withNote={remitoMode === 'both'} paper={paper} />
          )}
        />
      )}
    </div>
  );
}
