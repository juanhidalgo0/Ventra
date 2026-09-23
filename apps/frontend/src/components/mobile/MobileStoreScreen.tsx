import { useEffect, useMemo, useRef, useState } from 'react';
import ImageCropModal, { STORE_LOGO, STORE_BANNER } from '../common/ImageCropModal';
import toast from 'react-hot-toast';
import {
  Store, Copy, Share2, ExternalLink, ShoppingBag, Info, Truck, Clock, Palette, RefreshCw, ChevronRight,
  MessageCircle, Image as ImageIcon, Check, Package, Search, Eye, EyeOff,
} from 'lucide-react';
import {
  resolveStoreId, loadStoreConfig, saveStoreConfig, isSubdomainAvailable, subscribeToStoreOrders,
  compressImageFile, publishOnlineCatalog, dayRanges, withRanges, PAYMENT_OPTIONS,
  type StoreConfig, type StoreOrder, type DayHours,
} from '../../services/onlineStore';
import api from '../../services/api';
import { ScreenHeader, Sheet, PrimaryButton, EmptyState, ListSkeleton, money } from './ui';

const PUBLIC_BASE = 'https://tienda.ventra.store';
const WEEK = [
  { idx: 1, label: 'Lunes' }, { idx: 2, label: 'Martes' }, { idx: 3, label: 'Miércoles' }, { idx: 4, label: 'Jueves' },
  { idx: 5, label: 'Viernes' }, { idx: 6, label: 'Sábado' }, { idx: 0, label: 'Domingo' },
];
type Panel = 'orders' | 'products' | 'info' | 'delivery' | 'hours' | 'look' | null;

const input = 'w-full h-12 px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-[15px] outline-none focus:border-rose-500 focus:bg-white';
const waLink = (phone: string, text = '') => {
  let d = phone.replace(/\D/g, '');
  if (d.length === 10) d = `549${d}`;
  return `https://wa.me/${d}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
};

/** Tienda online en el celular: estado, enlace para compartir, pedidos y la configuración por partes. */
export default function MobileStoreScreen() {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [config, setConfig] = useState<StoreConfig | null>(null);
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [panel, setPanel] = useState<Panel>(null);
  const [error, setError] = useState(false);
  const [publishing, setPublishing] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    resolveStoreId()
      .then(async (id) => { setStoreId(id); setConfig(await loadStoreConfig(id)); })
      .catch(() => setError(true));
  }, []);
  useEffect(() => {
    if (!storeId) return;
    return subscribeToStoreOrders(storeId, setOrders);
  }, [storeId]);

  const url = config?.subdomain ? `${PUBLIC_BASE}/${config.subdomain}` : '';
  const newOrders = orders.filter((o) => !o.stage || o.stage === 'NEW').length;

  /** Guarda un cambio parcial y lo refleja en pantalla. */
  const save = async (patch: Partial<StoreConfig>) => {
    if (!storeId || !config) return;
    const next = { ...config, ...patch };
    if (next.isPublished && (!next.subdomain || !next.whatsappNumber)) {
      toast.error('Para publicar la tienda necesitás la dirección web y el WhatsApp (en Datos de la tienda).');
      throw new Error('incompleta');
    }
    await saveStoreConfig(storeId, next);
    setConfig(next);
    toast.success('Guardado');
  };

  const share = async () => {
    if (!url) return;
    if (navigator.share) await navigator.share({ title: config?.businessName, text: 'Hacé tu pedido online', url }).catch(() => {});
    else { await navigator.clipboard?.writeText(url); toast.success('Enlace copiado'); }
  };

  const publishCatalog = async () => {
    if (!storeId) return;
    setPublishing({ done: 0, total: 0 });
    try {
      const n = await publishOnlineCatalog(storeId, (done, total) => setPublishing({ done, total }));
      toast.success(`Catálogo actualizado: ${n} productos`);
    } catch {
      toast.error('No se pudo actualizar el catálogo');
    } finally {
      setPublishing(null);
    }
  };

  if (error) {
    return (
      <div className="flex-1 min-h-0 flex flex-col">
        <ScreenHeader back title="Tienda online" />
        <EmptyState icon={Store} title="No pudimos abrir tu tienda" text="Revisá la conexión a internet y volvé a entrar." />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <ScreenHeader back title="Tienda online" subtitle={config?.businessName}>
        {config && (
          <div className="rounded-2xl bg-white/10 ring-1 ring-inset ring-white/15 p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[12px] text-rose-100 flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${config.isPublished ? 'bg-orange-200' : 'bg-white/40'}`} />
                  {config.isPublished ? 'Publicada' : 'Borrador (no se ve)'}
                </p>
                <p className="text-[14px] font-semibold truncate">{url ? url.replace('https://', '') : 'Sin dirección web todavía'}</p>
              </div>
              <PublishToggle on={config.isPublished} onChange={(v) => save({ isPublished: v }).catch(() => {})} />
            </div>
            {url && (
              <div className="grid grid-cols-3 gap-2 mt-3">
                <HeaderBtn icon={Copy} label="Copiar" onClick={() => { navigator.clipboard?.writeText(url); toast.success('Enlace copiado'); }} />
                <HeaderBtn icon={Share2} label="Compartir" onClick={share} />
                <a href={url} target="_blank" rel="noopener noreferrer" className="h-10 rounded-xl bg-white/15 flex items-center justify-center gap-1.5 text-[13px] font-semibold">
                  <ExternalLink className="w-4 h-4" /> Ver
                </a>
              </div>
            )}
          </div>
        )}
      </ScreenHeader>

      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 space-y-3">
        {!config ? <ListSkeleton rows={5} /> : (
          <>
            <Row icon={ShoppingBag} tint="bg-rose-50 text-rose-700" title="Pedidos" text={orders.length ? `${orders.length} recibidos${newOrders ? ` · ${newOrders} nuevos` : ''}` : 'Todavía no llegó ninguno'} badge={newOrders} onClick={() => setPanel('orders')} />
            <Row icon={Info} tint="bg-sky-50 text-sky-700" title="Datos de la tienda" text="Nombre, dirección web, WhatsApp, aviso" onClick={() => setPanel('info')} />
            <Row icon={Truck} tint="bg-amber-50 text-amber-700" title="Entregas y pagos" text={[config.pickupEnabled !== false && 'Retiro', config.deliveryEnabled && 'Envío', config.goDeliveryEnabled && 'GoDelivery', (config.paymentMethods || []).length && `${(config.paymentMethods || []).length} medios de pago`].filter(Boolean).join(' · ')} onClick={() => setPanel('delivery')} />
            <Row icon={Clock} tint="bg-violet-50 text-violet-700" title="Horarios" text="Días y turnos de atención" onClick={() => setPanel('hours')} />
            <Row icon={Palette} tint="bg-pink-50 text-pink-700" title="Apariencia" text="Logo, portada y color" onClick={() => setPanel('look')} />

            <Row icon={Package} tint="bg-emerald-50 text-emerald-700" title="Productos en la tienda" text="Elegí qué productos ven tus clientes" onClick={() => setPanel('products')} />

            <div className="bg-white rounded-2xl border border-slate-200/80 p-4">
              <p className="text-[14px] font-semibold text-slate-800">Publicar en la tienda</p>
              <p className="text-[12.5px] text-slate-500 mt-0.5">Sube a la tienda los productos elegidos con sus fotos, precios y stock de ahora. Usalo cada vez que cambies precios o productos.</p>
              <button onClick={publishCatalog} disabled={!!publishing} className="mt-3 w-full h-12 rounded-xl bg-rose-600 text-white text-[15px] font-semibold flex items-center justify-center gap-2 disabled:opacity-60 active:scale-[0.99]">
                <RefreshCw className={`w-4 h-4 ${publishing ? 'animate-spin' : ''}`} />
                {publishing ? (publishing.total ? `Subiendo fotos ${publishing.done}/${publishing.total}…` : 'Publicando…') : 'Publicar productos'}
              </button>
            </div>
          </>
        )}
      </div>

      {config && (
        <>
          <OrdersSheet open={panel === 'orders'} orders={orders} onClose={() => setPanel(null)} store={config.businessName} />
          <ProductsSheet open={panel === 'products'} onClose={() => setPanel(null)} onPublish={() => { setPanel(null); publishCatalog(); }} />
          <InfoSheet open={panel === 'info'} config={config} storeId={storeId!} onClose={() => setPanel(null)} onSave={(p) => save(p).then(() => setPanel(null))} />
          <DeliverySheet open={panel === 'delivery'} config={config} onClose={() => setPanel(null)} onSave={(p) => save(p).then(() => setPanel(null))} />
          <HoursSheet open={panel === 'hours'} config={config} onClose={() => setPanel(null)} onSave={(p) => save(p).then(() => setPanel(null))} />
          <LookSheet open={panel === 'look'} config={config} onClose={() => setPanel(null)} onSave={(p) => save(p).then(() => setPanel(null))} />
        </>
      )}
    </div>
  );
}

type StoreProduct = { id: string; name: string; salePrice: number; showOnline: boolean; imageUrl?: string; category?: { name: string } };

/** Lista de productos con un interruptor cada uno: se ven o no en la tienda. */
function ProductsSheet({ open, onClose, onPublish }: { open: boolean; onClose: () => void; onPublish: () => void }) {
  const [items, setItems] = useState<StoreProduct[] | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'on' | 'off'>('all');
  const [changed, setChanged] = useState(false);

  useEffect(() => {
    if (!open) return;
    setItems(null); setChanged(false);
    api.get('/products', { params: { take: 5000 } })
      .then(({ data }) => setItems(((data?.products || data || []) as any[]).map((p) => ({ id: p.id, name: p.name, salePrice: p.salePrice, showOnline: !!p.showOnline, category: p.category }))))
      .catch(() => { toast.error('No se pudieron cargar los productos'); setItems([]); });
  }, [open]);

  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (items || []).filter((p) => (filter === 'all' || (filter === 'on') === p.showOnline) && (!t || p.name.toLowerCase().includes(t)));
  }, [items, q, filter]);
  const onCount = (items || []).filter((p) => p.showOnline).length;

  const setShow = async (ids: string[], show: boolean) => {
    const prev = items;
    setItems((list) => (list || []).map((p) => (ids.includes(p.id) ? { ...p, showOnline: show } : p)));
    setChanged(true);
    try { await api.post('/products/bulk-set-show-online', { ids, showOnline: show }); }
    catch { setItems(prev); toast.error('No se pudo guardar. Probá de nuevo.'); }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Productos en la tienda"
      footer={
        <PrimaryButton onClick={changed ? onPublish : onClose}>
          {changed ? `Publicar cambios (${onCount} en la tienda)` : 'Listo'}
        </PrimaryButton>
      }
    >
      <p className="text-[13px] text-slate-500 -mt-1 mb-3">Activá los productos que querés vender online. Después tocá <b>Publicar cambios</b>.</p>
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto" className={`${input} pl-10`} />
      </div>
      <div className="flex gap-2 mt-3">
        {([['all', `Todos (${items?.length ?? 0})`], ['on', `En la tienda (${onCount})`], ['off', 'Ocultos']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setFilter(k)} className={`h-9 px-3.5 rounded-full text-[13px] font-semibold ${filter === k ? 'bg-rose-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{l}</button>
        ))}
      </div>
      {items && shown.length > 0 && (
        <div className="grid grid-cols-2 gap-2 mt-3">
          <button onClick={() => setShow(shown.map((p) => p.id), true)} className="h-10 rounded-xl bg-emerald-50 text-emerald-700 text-[13px] font-semibold flex items-center justify-center gap-1.5"><Eye className="w-4 h-4" /> Mostrar {q ? 'estos' : 'todos'}</button>
          <button onClick={() => setShow(shown.map((p) => p.id), false)} className="h-10 rounded-xl bg-slate-100 text-slate-600 text-[13px] font-semibold flex items-center justify-center gap-1.5"><EyeOff className="w-4 h-4" /> Ocultar {q ? 'estos' : 'todos'}</button>
        </div>
      )}
      <div className="mt-3 divide-y divide-slate-100">
        {!items ? <ListSkeleton rows={6} /> : shown.length === 0 ? (
          <p className="py-10 text-center text-[13px] text-slate-400">No hay productos para mostrar</p>
        ) : shown.slice(0, 200).map((p) => (
          <button key={p.id} onClick={() => setShow([p.id], !p.showOnline)} className="w-full flex items-center gap-3 py-3 text-left">
            <span className="flex-1 min-w-0">
              <span className="block text-[14.5px] font-medium text-slate-800 truncate">{p.name}</span>
              <span className="block text-[12px] text-slate-500">{money(p.salePrice)}{p.category?.name ? ` · ${p.category.name}` : ''}</span>
            </span>
            <span className={`w-12 h-7 rounded-full p-0.5 transition-colors shrink-0 ${p.showOnline ? 'bg-rose-600' : 'bg-slate-300'}`}>
              <span className={`block w-6 h-6 rounded-full bg-white shadow transition-transform ${p.showOnline ? 'translate-x-5' : ''}`} />
            </span>
          </button>
        ))}
        {shown.length > 200 && <p className="py-3 text-center text-[12px] text-slate-400">Mostrando 200 de {shown.length}. Buscá para encontrar el resto.</p>}
      </div>
    </Sheet>
  );
}

function HeaderBtn({ icon: Icon, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="h-10 rounded-xl bg-white/15 flex items-center justify-center gap-1.5 text-[13px] font-semibold active:bg-white/25">
      <Icon className="w-4 h-4" /> {label}
    </button>
  );
}

function PublishToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className={`relative w-14 h-8 rounded-full shrink-0 transition-colors ${on ? 'bg-orange-200' : 'bg-white/25'}`} aria-label="Publicar tienda">
      <span className={`absolute top-1 w-6 h-6 rounded-full shadow transition-all ${on ? 'left-7 bg-rose-700' : 'left-1 bg-white'}`} />
    </button>
  );
}

function Toggle({ title, text, on, onChange }: { title: string; text?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!on)} className="w-full flex items-center justify-between gap-4 text-left py-1">
      <span>
        <span className="block text-[14.5px] font-semibold text-slate-800">{title}</span>
        {text && <span className="block text-[12.5px] text-slate-500">{text}</span>}
      </span>
      <span className={`relative w-12 h-7 rounded-full shrink-0 transition-colors ${on ? 'bg-rose-600' : 'bg-slate-300'}`}>
        <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-6' : 'left-1'}`} />
      </span>
    </button>
  );
}

function Row({ icon: Icon, tint, title, text, badge, onClick }: { icon: any; tint: string; title: string; text: string; badge?: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full bg-white rounded-2xl border border-slate-200/80 p-4 flex items-center gap-3 text-left active:scale-[0.99] transition-transform">
      <span className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${tint}`}><Icon className="w-5 h-5" /></span>
      <span className="flex-1 min-w-0">
        <span className="block text-[15px] font-semibold text-slate-900">{title}</span>
        <span className="block text-[12.5px] text-slate-500 truncate">{text}</span>
      </span>
      {!!badge && <span className="min-w-[22px] h-[22px] px-1.5 rounded-full bg-rose-600 text-white text-[11.5px] font-bold flex items-center justify-center">{badge}</span>}
      <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
    </button>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[12.5px] font-medium text-slate-500 mb-1.5">{label}</p>
      {children}
      {hint && <p className="text-[11.5px] text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function useSaving(onSave: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try { await onSave(); } catch { /* el mensaje ya se mostró */ } finally { setBusy(false); }
  };
  return { busy, run };
}

function OrdersSheet({ open, orders, onClose, store }: { open: boolean; orders: StoreOrder[]; onClose: () => void; store: string }) {
  const [selected, setSelected] = useState<StoreOrder | null>(null);
  useEffect(() => { if (!open) setSelected(null); }, [open]);
  const when = (o: StoreOrder) => (o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString('es-AR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

  return (
    <Sheet open={open} onClose={onClose} title={selected ? `Pedido ${selected.orderCode ? `#${selected.orderCode}` : ''}` : 'Pedidos'}>
      {selected ? (
        <div className="space-y-4 pt-1">
          <div className="text-center">
            <p className="text-[30px] font-bold text-slate-900 tabular-nums tracking-tight">{money(selected.total)}</p>
            <p className="text-[13px] text-slate-500">{when(selected)}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 px-4 py-3 space-y-1 text-[13.5px]">
            <p className="font-semibold text-slate-800">{selected.customerName}</p>
            <p className="text-slate-600">{selected.customerPhone}</p>
            <p className="text-slate-600">{selected.delivery === 'DELIVERY' ? `Envío a ${selected.address || '—'}` : selected.delivery === 'GODELIVERY' ? `GoDelivery a ${selected.address || '—'}` : 'Retira en el local'}{selected.paymentMethod ? ` · paga con ${selected.paymentMethod}` : ''}</p>
            {selected.customerNote && <p className="text-slate-600">{selected.customerNote}</p>}
          </div>
          <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100">
            {selected.items.map((i, k) => (
              <div key={k} className="flex justify-between px-3.5 py-2.5 text-[13.5px]">
                <span className="text-slate-800">{i.qty} × {i.name}</span>
                <span className="font-medium text-slate-800 tabular-nums">{money(i.price * i.qty)}</span>
              </div>
            ))}
            {!!selected.deliveryCost && <div className="flex justify-between px-3.5 py-2.5 text-[13.5px] text-slate-600"><span>Envío</span><span className="tabular-nums">{money(selected.deliveryCost)}</span></div>}
          </div>
          {selected.customerPhone && (
            <a href={waLink(selected.customerPhone, `Hola ${selected.customerName.split(' ')[0]}! Recibimos tu pedido${selected.orderCode ? ` #${selected.orderCode}` : ''} en ${store}.`)} target="_blank" rel="noopener noreferrer" className="w-full h-12 rounded-2xl bg-emerald-600 text-white font-semibold text-[15px] flex items-center justify-center gap-2">
              <MessageCircle className="w-4 h-4" /> Escribirle por WhatsApp
            </a>
          )}
          <button onClick={() => setSelected(null)} className="w-full h-11 rounded-2xl bg-slate-100 text-[14px] font-semibold text-slate-700">Ver todos</button>
        </div>
      ) : orders.length === 0 ? (
        <EmptyState icon={ShoppingBag} title="Todavía no llegó ningún pedido" text="Compartí el enlace de tu tienda por WhatsApp e Instagram." />
      ) : (
        <div className="divide-y divide-slate-100 -mx-1">
          {orders.map((o) => (
            <button key={o.id} onClick={() => setSelected(o)} className="w-full flex items-center gap-3 px-1 py-3 text-left">
              <span className="w-10 h-10 rounded-full bg-rose-50 text-rose-700 font-semibold flex items-center justify-center shrink-0">{(o.customerName || '?')[0].toUpperCase()}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-[14px] font-medium text-slate-800 truncate">{o.customerName}{o.orderCode ? ` · #${o.orderCode}` : ''}</span>
                <span className="block text-[12px] text-slate-500 truncate">{when(o)} · {o.items.length} productos · {o.delivery === 'DELIVERY' ? 'envío' : o.delivery === 'GODELIVERY' ? 'GoDelivery' : 'retira'}</span>
              </span>
              <span className="text-[14px] font-semibold text-slate-900 tabular-nums">{money(o.total)}</span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

function InfoSheet({ open, config, storeId, onClose, onSave }: { open: boolean; config: StoreConfig; storeId: string; onClose: () => void; onSave: (p: Partial<StoreConfig>) => Promise<void> }) {
  const [f, setF] = useState(config);
  const [slugState, setSlugState] = useState<'idle' | 'checking' | 'ok' | 'taken'>('idle');
  useEffect(() => { if (open) setF(config); }, [open]);
  useEffect(() => {
    if (!open || !f.subdomain || f.subdomain === config.subdomain) { setSlugState('idle'); return; }
    setSlugState('checking');
    const t = setTimeout(() => isSubdomainAvailable(f.subdomain, storeId).then((ok) => setSlugState(ok ? 'ok' : 'taken')).catch(() => setSlugState('idle')), 500);
    return () => clearTimeout(t);
  }, [f.subdomain, open]);
  const { busy, run } = useSaving(async () => {
    if (slugState === 'taken') { toast.error('Esa dirección ya la usa otra tienda'); throw new Error('taken'); }
    await onSave({ businessName: f.businessName, subdomain: f.subdomain, description: f.description, whatsappNumber: f.whatsappNumber, instagram: f.instagram, address: f.address, announcement: f.announcement });
  });
  return (
    <Sheet open={open} onClose={onClose} title="Datos de la tienda" footer={<PrimaryButton onClick={run} loading={busy}>Guardar</PrimaryButton>}>
      <div className="space-y-4 pt-1">
        <Field label="Nombre"><input className={input} value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} /></Field>
        <Field label="Dirección web" hint={slugState === 'checking' ? 'Verificando…' : slugState === 'ok' ? 'Disponible' : slugState === 'taken' ? 'Ya la usa otra tienda' : undefined}>
          <div className="flex items-center h-12 rounded-xl bg-slate-50 border border-slate-200 focus-within:border-rose-500 overflow-hidden">
            <span className="pl-3.5 text-[13px] text-slate-400 shrink-0">tienda.ventra.store/</span>
            <input className="flex-1 min-w-0 h-full bg-transparent outline-none text-[15px] pr-3" value={f.subdomain} onChange={(e) => setF({ ...f, subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} placeholder="mi-negocio" />
          </div>
        </Field>
        <Field label="Descripción corta"><input className={input} maxLength={120} value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Almacén de barrio · Envíos en el día" /></Field>
        <Field label="WhatsApp (a donde llegan los pedidos)" hint="Con código de país, sin espacios: 5491123456789">
          <input className={input} inputMode="tel" value={f.whatsappNumber} onChange={(e) => setF({ ...f, whatsappNumber: e.target.value.replace(/\D/g, '') })} placeholder="5491123456789" />
        </Field>
        <Field label="Aviso destacado (opcional)"><input className={input} maxLength={90} value={f.announcement || ''} onChange={(e) => setF({ ...f, announcement: e.target.value })} placeholder="Envío gratis desde $30.000" /></Field>
        <Field label="Instagram (opcional)"><input className={input} value={f.instagram || ''} onChange={(e) => setF({ ...f, instagram: e.target.value })} placeholder="@mi_negocio" /></Field>
        <Field label="Dirección del local (opcional)"><input className={input} value={f.address || ''} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Av. San Martín 1234" /></Field>
      </div>
    </Sheet>
  );
}

function DeliverySheet({ open, config, onClose, onSave }: { open: boolean; config: StoreConfig; onClose: () => void; onSave: (p: Partial<StoreConfig>) => Promise<void> }) {
  const [f, setF] = useState(config);
  useEffect(() => { if (open) setF(config); }, [open]);
  const num = (v: string) => Number(v.replace(/\D/g, '')) || 0;
  const { busy, run } = useSaving(() => onSave({
    pickupEnabled: f.pickupEnabled !== false, deliveryEnabled: !!f.deliveryEnabled, goDeliveryEnabled: !!f.goDeliveryEnabled, deliveryCost: f.deliveryCost || 0,
    freeDeliveryFrom: f.freeDeliveryFrom || 0, deliveryZone: f.deliveryZone, minOrder: f.minOrder || 0,
    paymentMethods: f.paymentMethods, transferAlias: f.transferAlias, showOutOfStock: f.showOutOfStock !== false, alwaysInStock: !!f.alwaysInStock,
  }));
  const pays = f.paymentMethods || [];
  return (
    <Sheet open={open} onClose={onClose} title="Entregas y pagos" footer={<PrimaryButton onClick={run} loading={busy}>Guardar</PrimaryButton>}>
      <div className="space-y-4 pt-1">
        <Toggle title="Retiro en el local" on={f.pickupEnabled !== false} onChange={(v) => setF({ ...f, pickupEnabled: v })} />
        <Toggle title="Envío a domicilio" text="Lo llevás vos." on={!!f.deliveryEnabled} onChange={(v) => setF({ ...f, deliveryEnabled: v })} />
        <Toggle title="Envío con GoDelivery" text="Lo cobra GoDelivery al cliente, aparte. No se informan precios." on={!!f.goDeliveryEnabled} onChange={(v) => setF({ ...f, goDeliveryEnabled: v })} />
        {f.deliveryEnabled && (
          <div className="rounded-2xl bg-slate-50 p-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Costo del envío"><input className={input} inputMode="numeric" value={f.deliveryCost ? String(f.deliveryCost) : ''} onChange={(e) => setF({ ...f, deliveryCost: num(e.target.value) })} placeholder="0 = gratis" /></Field>
              <Field label="Gratis desde"><input className={input} inputMode="numeric" value={f.freeDeliveryFrom ? String(f.freeDeliveryFrom) : ''} onChange={(e) => setF({ ...f, freeDeliveryFrom: num(e.target.value) })} placeholder="0 = nunca" /></Field>
            </div>
            <Field label="Zona de entrega"><input className={input} value={f.deliveryZone || ''} onChange={(e) => setF({ ...f, deliveryZone: e.target.value })} placeholder="Centro y barrios cercanos" /></Field>
          </div>
        )}
        <Field label="Pedido mínimo"><input className={input} inputMode="numeric" value={f.minOrder ? String(f.minOrder) : ''} onChange={(e) => setF({ ...f, minOrder: num(e.target.value) })} placeholder="0 = sin mínimo" /></Field>
        <Field label="Medios de pago que aceptás">
          <div className="flex flex-wrap gap-2">
            {PAYMENT_OPTIONS.map((m) => {
              const on = pays.includes(m);
              return (
                <button key={m} onClick={() => setF({ ...f, paymentMethods: on ? pays.filter((x) => x !== m) : [...pays, m] })} className={`h-9 px-3 rounded-full border text-[13px] font-medium flex items-center gap-1 ${on ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-200 text-slate-700'}`}>
                  {on && <Check className="w-3.5 h-3.5" />}{m}
                </button>
              );
            })}
          </div>
        </Field>
        {pays.includes('Transferencia') && (
          <Field label="Alias o CBU para transferencias"><input className={input} value={f.transferAlias || ''} onChange={(e) => setF({ ...f, transferAlias: e.target.value })} placeholder="mi.negocio.mp" /></Field>
        )}
        <Toggle title="Mostrar productos sin stock" text="Aparecen como agotados." on={f.showOutOfStock !== false} onChange={(v) => setF({ ...f, showOutOfStock: v })} />
        <Toggle title="Vender todo como disponible" text="Todos los productos se pueden pedir aunque figuren sin stock." on={!!f.alwaysInStock} onChange={(v) => setF({ ...f, alwaysInStock: v })} />
      </div>
    </Sheet>
  );
}

function HoursSheet({ open, config, onClose, onSave }: { open: boolean; config: StoreConfig; onClose: () => void; onSave: (p: Partial<StoreConfig>) => Promise<void> }) {
  const base = useMemo<DayHours[]>(() => config.hours || [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: d !== 0, from: '09:00', to: '20:00' })), [config.hours]);
  const [hours, setHours] = useState<DayHours[]>(base);
  useEffect(() => { if (open) setHours(base); }, [open]);
  const setDay = (idx: number, h: DayHours) => setHours(hours.map((x, i) => (i === idx ? h : x)));
  const { busy, run } = useSaving(() => onSave({ hours }));
  const time = 'h-10 px-2 rounded-lg border border-slate-200 bg-white text-[14px] text-slate-800';

  return (
    <Sheet open={open} onClose={onClose} title="Horarios" footer={<PrimaryButton onClick={run} loading={busy}>Guardar</PrimaryButton>}>
      <div className="divide-y divide-slate-100 pt-1">
        {WEEK.map(({ idx, label }) => {
          const h = hours[idx] || { open: false, from: '09:00', to: '20:00' };
          const ranges = dayRanges(h);
          return (
            <div key={idx} className="py-3">
              <Toggle title={label} text={h.open ? undefined : 'Cerrado'} on={h.open} onChange={(v) => setDay(idx, { ...h, open: v })} />
              {h.open && (
                <div className="mt-2 space-y-2">
                  {ranges.map((r, i) => (
                    <div key={i} className="flex items-center gap-2 text-[13px] text-slate-500">
                      <input type="time" className={time} value={r.from} onChange={(e) => setDay(idx, withRanges(h, ranges.map((x, j) => (j === i ? { ...x, from: e.target.value } : x))))} />
                      a
                      <input type="time" className={time} value={r.to} onChange={(e) => setDay(idx, withRanges(h, ranges.map((x, j) => (j === i ? { ...x, to: e.target.value } : x))))} />
                      {ranges.length > 1 && (
                        <button onClick={() => setDay(idx, withRanges(h, ranges.filter((_, j) => j !== i)))} className="text-[12.5px] font-semibold text-slate-400 px-1">Quitar</button>
                      )}
                    </div>
                  ))}
                  <div className="flex gap-4">
                    {ranges.length < 3 && (
                      <button onClick={() => setDay(idx, withRanges(h, [...ranges, { from: '17:00', to: '21:00' }]))} className="text-[13px] font-semibold text-rose-700">+ Agregar horario</button>
                    )}
                    {idx === 1 && (
                      <button onClick={() => setHours(hours.map((d, j) => (j === 0 ? d : { ...h, ranges: [...ranges] })))} className="text-[13px] font-semibold text-slate-500">Copiar a lunes–sábado</button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

function LookSheet({ open, config, onClose, onSave }: { open: boolean; config: StoreConfig; onClose: () => void; onSave: (p: Partial<StoreConfig>) => Promise<void> }) {
  const [f, setF] = useState(config);
  useEffect(() => { if (open) setF(config); }, [open]);
  const logoRef = useRef<HTMLInputElement>(null);
  const bannerRef = useRef<HTMLInputElement>(null);
  const { busy, run } = useSaving(() => onSave({ logoUrl: f.logoUrl, bannerUrl: f.bannerUrl, primaryColor: f.primaryColor }));
  const pick = async (e: React.ChangeEvent<HTMLInputElement>, kind: 'logo' | 'banner') => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setCrop({ file, kind });
  };
  const [crop, setCrop] = useState<{ file: File; kind: 'logo' | 'banner' } | null>(null);
  const COLORS = ['#0E6E52', '#1D4ED8', '#B91C1C', '#C2410C', '#7C3AED', '#DB2777', '#0F766E', '#111827'];

  return (
    <Sheet open={open} onClose={onClose} title="Apariencia" footer={<PrimaryButton onClick={run} loading={busy}>Guardar</PrimaryButton>}>
      <div className="space-y-4 pt-1">
        <div className="rounded-2xl overflow-hidden border border-slate-200">
          <button onClick={() => bannerRef.current?.click()} className="w-full aspect-[3/1] flex items-center justify-center relative" style={{ background: f.primaryColor }}>
            {f.bannerUrl ? <img src={f.bannerUrl} alt="" className="absolute inset-0 w-full h-full object-cover" /> : <span className="text-white/80 text-[13px] font-medium flex items-center gap-1.5"><ImageIcon className="w-4 h-4" /> Tocá para poner una portada</span>}
          </button>
          <div className="p-3 flex items-center gap-3 bg-white">
            <button onClick={() => logoRef.current?.click()} className="w-16 h-16 -mt-7 rounded-2xl border-4 border-white shadow flex items-center justify-center overflow-hidden shrink-0" style={{ background: f.primaryColor }}>
              {f.logoUrl ? <img src={f.logoUrl} alt="" className="w-full h-full object-cover" /> : <ImageIcon className="w-5 h-5 text-white/80" />}
            </button>
            <div className="min-w-0">
              <p className="text-[15px] font-bold text-slate-900 truncate">{f.businessName}</p>
              <p className="text-[12px] text-slate-500">Tocá el logo o la portada para cambiarlos</p>
              <p className="text-[11.5px] text-slate-400">Logo 512×512 px · Portada 1500×500 px</p>
            </div>
          </div>
        </div>
{crop && (
        <ImageCropModal
          file={crop.file}
          {...(crop.kind === 'logo' ? STORE_LOGO : STORE_BANNER)}
          round={crop.kind === 'logo'}
          title={crop.kind === 'logo' ? 'Encuadrar logo' : 'Encuadrar portada'}
          onCancel={() => setCrop(null)}
          onDone={(url) => { setF((x) => ({ ...x, [crop.kind === 'logo' ? 'logoUrl' : 'bannerUrl']: url })); setCrop(null); }}
        />
      )}
        <input ref={logoRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e, 'logo')} />
        <input ref={bannerRef} type="file" accept="image/*" className="hidden" onChange={(e) => pick(e, 'banner')} />
        <Field label="Color de la tienda">
          <div className="flex flex-wrap gap-2.5">
            {COLORS.map((c) => (
              <button key={c} onClick={() => setF({ ...f, primaryColor: c })} className="w-10 h-10 rounded-full flex items-center justify-center ring-offset-2" style={{ background: c, boxShadow: f.primaryColor === c ? `0 0 0 3px white, 0 0 0 5px ${c}` : undefined }} aria-label={c}>
                {f.primaryColor === c && <Check className="w-5 h-5 text-white" />}
              </button>
            ))}
            <label className="w-10 h-10 rounded-full border-2 border-dashed border-slate-300 flex items-center justify-center overflow-hidden cursor-pointer" aria-label="Otro color">
              <input type="color" value={f.primaryColor} onChange={(e) => setF({ ...f, primaryColor: e.target.value })} className="opacity-0 w-full h-full" />
            </label>
          </div>
        </Field>
      </div>
    </Sheet>
  );
}
