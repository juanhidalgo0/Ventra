import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ExtrasEditor from '../store/ExtrasEditor';
import ImageCropModal, { STORE_LOGO, STORE_BANNER } from '../common/ImageCropModal';
import { useAutoTour } from '../common/tour/GuidedTour';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
  Store,
  MapPin,
  Instagram,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Loader2,
  Image as ImageIcon,
  Search,
  Package,
  Wrench,
  Shirt,
  UtensilsCrossed,
  Plus,
  LayoutGrid,
  LayoutDashboard,
  Clock,
  Phone,
  Check,
  Truck,
  Wallet,
  Megaphone,
  Copy,
  Palette,
  ChevronRight,
  Circle,
  Undo2,
  UploadCloud,
  ShoppingBag,
} from 'lucide-react';
import {
  resolveStoreId,
  loadStoreConfig,
  saveStoreConfig,
  isSubdomainAvailable,
  syncCatalogToStore,
  toOnlineProduct,
  publishOnlinePromos,
  ORDER_CHANNELS,
  publishProductImages,
  PAYMENT_OPTIONS,
  dayRanges,
  withRanges,
  subscribeToStoreOrders,
  fetchAllProducts,
  loadPublishedCatalog,
  diffCatalog,
  type OnlineProduct,
  type StoreConfig,
  type StoreOrder,
} from '../../services/onlineStore';

const PUBLIC_STORE_BASE_URL = 'https://tienda.ventra.store';

const RUBROS = [
  { id: 'KIOSKO', label: 'Kiosco / Almacén', icon: Package },
  { id: 'FERRETERIA', label: 'Ferretería / Corralón', icon: Wrench },
  { id: 'INDUMENTARIA', label: 'Indumentaria y Calzado', icon: Shirt },
  { id: 'GASTRONOMIA', label: 'Gastronomía', icon: UtensilsCrossed },
  { id: 'OTRO', label: 'Otro rubro', icon: LayoutGrid },
];

/** Los datos que se editan en esta pantalla. Se guardan solo estos (lo demás, como los pausados desde el celular, no se pisa). */
const EDIT_KEYS = [
  'businessName', 'subdomain', 'description', 'rubro', 'whatsappNumber', 'instagram', 'address', 'orderChannel',
  'primaryColor', 'secondaryColor', 'logoUrl', 'bannerUrl', 'announcement',
  'pickupEnabled', 'deliveryEnabled', 'goDeliveryEnabled', 'deliveryCost', 'freeDeliveryFrom', 'deliveryZone',
  'deliveryEta', 'pickupEta', 'minOrder', 'transferAlias', 'paymentMethods',
  'hours', 'showOutOfStock', 'alwaysInStock',
] as const;
type EditKey = typeof EDIT_KEYS[number];

type SectionId = 'resumen' | 'negocio' | 'productos' | 'apariencia' | 'entregas' | 'horarios' | 'extras';

const SECTIONS: { id: SectionId; label: string; icon: any; keys: EditKey[] }[] = [
  { id: 'resumen', label: 'Resumen', icon: LayoutDashboard, keys: [] },
  { id: 'negocio', label: 'Datos del negocio', icon: Store, keys: ['businessName', 'subdomain', 'description', 'rubro', 'whatsappNumber', 'instagram', 'address', 'orderChannel'] },
  { id: 'productos', label: 'Productos', icon: Package, keys: ['showOutOfStock', 'alwaysInStock'] },
  { id: 'apariencia', label: 'Apariencia', icon: Palette, keys: ['primaryColor', 'secondaryColor', 'logoUrl', 'bannerUrl', 'announcement'] },
  { id: 'entregas', label: 'Entregas y pagos', icon: Truck, keys: ['pickupEnabled', 'deliveryEnabled', 'goDeliveryEnabled', 'deliveryCost', 'freeDeliveryFrom', 'deliveryZone', 'deliveryEta', 'pickupEta', 'minOrder', 'transferAlias', 'paymentMethods'] },
  { id: 'horarios', label: 'Horarios', icon: Clock, keys: ['hours'] },
  { id: 'extras', label: 'Extras y agregados', icon: Plus, keys: [] },
];

const pickEditable = (c: StoreConfig) => Object.fromEntries(EDIT_KEYS.map((k) => [k, (c as any)[k] ?? null])) as Record<EditKey, any>;
const same = (a: any, b: any) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const money = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(n || 0);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const inputBase = 'w-full h-11 bg-white border border-slate-300 rounded-xl px-3.5 text-[14px] text-slate-900 placeholder:text-slate-400 outline-none transition-shadow focus:border-rose-500 focus:ring-[3px] focus:ring-rose-500/15';

/** Primero se resuelve la tienda del comercio (con la PC vinculada es la de la cuenta). */
export default function OnlineStoreScreen() {
  const [storeId, setStoreId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    resolveStoreId().then(setStoreId).catch((err) => { console.error(err); setFailed(true); });
  }, []);
  if (failed) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-slate-50 gap-3 p-6 text-center">
        <AlertCircle className="w-8 h-8 text-rose-500" />
        <p className="text-sm font-bold text-slate-800">No pudimos conectar con tu tienda online</p>
        <p className="text-[13px] text-slate-500">Revisá la conexión a internet y volvé a entrar.</p>
      </div>
    );
  }
  if (!storeId) return <FullLoader />;
  return <OnlineStoreEditor storeId={storeId} />;
}

function FullLoader() {
  return (
    <div className="h-full flex flex-col items-center justify-center bg-slate-50 gap-3">
      <Loader2 className="w-6 h-6 text-rose-600 animate-spin" />
      <p className="text-[13px] text-slate-500">Cargando tu tienda online…</p>
    </div>
  );
}

function OnlineStoreEditor({ storeId }: { storeId: string }) {
  const navigate = useNavigate();
  const [config, setConfig] = useState<StoreConfig | null>(null);
  /** Lo último guardado en la nube: contra esto se detectan los cambios sin publicar */
  const [saved, setSaved] = useState<Record<EditKey, any> | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  useAutoTour('onlineStore', !isLoading);
  const [tab, setTab] = useState<SectionId>('resumen');
  const [subdomainStatus, setSubdomainStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');

  const [products, setProducts] = useState<any[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(true);
  /** Catálogo que hoy ve el público (undefined = cargando, null = todavía no se publicó agrupado) */
  const [published, setPublished] = useState<OnlineProduct[] | null | undefined>(undefined);
  const [pendingToggles, setPendingToggles] = useState<Set<string>>(new Set());
  const [publishing, setPublishing] = useState<string | null>(null);

  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [crop, setCrop] = useState<{ file: File; kind: 'logo' | 'banner' } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        const loaded = await loadStoreConfig(storeId);
        setConfig(loaded);
        setSaved(pickEditable(loaded));
        loadPublishedCatalog(storeId, loaded.catalogParts).then(setPublished).catch(() => setPublished(null));
      } catch (err) {
        console.error(err);
        toast.error('No se pudo cargar la tienda (revisá tu conexión a internet)');
      } finally {
        setIsLoading(false);
      }
    })();
  }, [storeId]);

  useEffect(() => {
    const unsub = subscribeToStoreOrders(storeId, setOrders);
    return () => unsub();
  }, [storeId]);

  const loadProducts = useCallback(async () => {
    setIsLoadingProducts(true);
    try {
      setProducts(await fetchAllProducts());
    } catch (err) {
      console.error(err);
      toast.error('Error al cargar los productos');
    } finally {
      setIsLoadingProducts(false);
    }
  }, []);
  useEffect(() => { loadProducts(); }, [loadProducts]);

  // Disponibilidad de la dirección web, con una pausa mientras se escribe
  useEffect(() => {
    if (!config?.subdomain) { setSubdomainStatus('idle'); return; }
    setSubdomainStatus('checking');
    const handler = setTimeout(async () => {
      try {
        setSubdomainStatus((await isSubdomainAvailable(config.subdomain, storeId)) ? 'available' : 'taken');
      } catch {
        setSubdomainStatus('idle');
      }
    }, 600);
    return () => clearTimeout(handler);
  }, [config?.subdomain, storeId]);

  const update = (patch: Partial<StoreConfig>) => setConfig((prev) => (prev ? { ...prev, ...patch } : prev));

  // ── Cambios sin publicar ────────────────────────────────────────
  const dirtyKeys = useMemo(() => {
    if (!config || !saved) return new Set<EditKey>();
    const cur = pickEditable(config);
    return new Set(EDIT_KEYS.filter((k) => !same(cur[k], saved[k])));
  }, [config, saved]);

  const ignoreStock = !!config?.alwaysInStock || config?.rubro === 'GASTRONOMIA';
  const localOnline = useMemo(() => products.filter((p) => p.showOnline).map((p) => toOnlineProduct(p, p.imageUrl ? 'local' : '')), [products]);
  const diff = useMemo(
    () => (published === undefined || isLoadingProducts ? null : diffCatalog(localOnline, published, ignoreStock)),
    [localOnline, published, ignoreStock, isLoadingProducts],
  );
  const catalogChanges = diff ? diff.added.size + diff.removed.size + diff.changed.size : 0;
  const catalogDirty = !!diff && (diff.unknown ? localOnline.length > 0 : catalogChanges > 0);
  const hasChanges = dirtyKeys.size > 0 || catalogDirty;
  const dirtySections = useMemo(() => new Set(SECTIONS.filter((s) => s.keys.some((k) => dirtyKeys.has(k))).map((s) => s.id)), [dirtyKeys]);

  const validate = (c: StoreConfig, visible: boolean): SectionId | null => {
    if (subdomainStatus === 'taken') { toast.error('Esa dirección web ya la usa otra tienda. Elegí otra.'); return 'negocio'; }
    if (visible && !c.subdomain) { toast.error('Elegí la dirección web de tu tienda.'); return 'negocio'; }
    if (visible && !c.whatsappNumber) { toast.error('Cargá el WhatsApp donde vas a recibir los pedidos.'); return 'negocio'; }
    return null;
  };

  const publishCatalog = async () => {
    const online = products.filter((p) => p.showOnline);
    if (online.length === 0 && published && published.length > 0
      && !window.confirm('No hay ningún producto marcado: la tienda va a quedar sin productos. ¿Seguir?')) return false;
    setPublishing('Preparando productos…');
    const images = await publishProductImages(storeId, online, (done, total) => setPublishing(`Subiendo fotos ${done} de ${total}…`));
    setPublishing('Publicando productos…');
    const list = online.map((p) => toOnlineProduct(p, images.get(p.id) || ''));
    await syncCatalogToStore(storeId, list);
    await publishOnlinePromos(storeId, new Set(online.map((p) => String(p.id)))).catch((e) => console.warn('[OnlineStore] Promos sin publicar', e));
    setPublished(list);
    return true;
  };

  /** Publica todo lo pendiente: los datos de la tienda y los productos. */
  const publishAll = async (extra?: Partial<StoreConfig>) => {
    if (!config || publishing) return;
    const next = { ...config, ...extra };
    const bad = validate(next, !!next.isPublished);
    if (bad) { setTab(bad); return; }
    setPublishing('Guardando…');
    try {
      if (dirtyKeys.size > 0 || extra) {
        // Solo lo que cambió: no se pisa lo que se haya tocado desde el celular mientras tanto
        const patch: Record<string, any> = { ...extra };
        dirtyKeys.forEach((k) => { if ((next as any)[k] !== undefined) patch[k] = (next as any)[k]; });
        await saveStoreConfig(storeId, patch as Partial<StoreConfig>);
        setSaved(pickEditable(next));
        if (extra) setConfig(next);
      }
      if (catalogDirty && !(await publishCatalog())) return;
      toast.success(next.isPublished ? 'Listo: los cambios ya se ven en tu tienda' : 'Cambios guardados');
    } catch (err) {
      console.error(err);
      toast.error('No se pudieron publicar los cambios. Revisá la conexión y probá de nuevo.');
    } finally {
      setPublishing(null);
    }
  };

  const discard = () => {
    if (!saved) return;
    setConfig((prev) => (prev ? ({ ...prev, ...saved } as StoreConfig) : prev));
  };

  const setVisible = async (visible: boolean) => {
    if (!config || publishing) return;
    if (visible) return publishAll({ isPublished: true });
    if (!window.confirm('¿Ocultar la tienda? Tus clientes no van a poder verla ni hacer pedidos hasta que la vuelvas a hacer visible.')) return;
    setPublishing('Ocultando…');
    try {
      await saveStoreConfig(storeId, { isPublished: false });
      update({ isPublished: false });
      toast.success('La tienda quedó oculta');
    } catch {
      toast.error('No se pudo ocultar la tienda');
    } finally {
      setPublishing(null);
    }
  };

  // Ctrl+S publica
  const publishRef = useRef(publishAll);
  publishRef.current = publishAll;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); publishRef.current(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const goTo = (id: SectionId) => { setTab(id); scrollRef.current?.scrollTo({ top: 0 }); };

  // ── Productos ───────────────────────────────────────────────────
  const toggleProductOnline = async (product: any) => {
    const nextValue = !product.showOnline;
    setPendingToggles((prev) => new Set(prev).add(product.id));
    setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, showOnline: nextValue } : p)));
    try {
      await api.patch(`/products/${product.id}`, { showOnline: nextValue });
    } catch (err) {
      console.error(err);
      toast.error('Error al actualizar el producto');
      setProducts((prev) => prev.map((p) => (p.id === product.id ? { ...p, showOnline: !nextValue } : p)));
    } finally {
      setPendingToggles((prev) => { const next = new Set(prev); next.delete(product.id); return next; });
    }
  };

  const setManyOnline = async (ids: string[], value: boolean) => {
    const prev = products;
    const idSet = new Set(ids);
    setProducts((list) => list.map((p) => (idSet.has(p.id) ? { ...p, showOnline: value } : p)));
    try {
      await api.post('/products/bulk-set-show-online', { ids, showOnline: value });
    } catch {
      setProducts(prev);
      toast.error('No se pudo guardar');
    }
  };

  const publicUrl = config?.subdomain ? `${PUBLIC_STORE_BASE_URL}/${config.subdomain}` : '';
  const savedUrl = saved?.subdomain ? `${PUBLIC_STORE_BASE_URL}/${saved.subdomain}` : '';
  const pendingOrdersCount = useMemo(() => orders.filter((o) => !o.stage || o.stage === 'NEW').length, [orders]);

  if (isLoading || !config || !saved) return <FullLoader />;

  const accent = config.primaryColor || '#0E6E52';
  const publishedCount = published ? published.length : null;

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto bg-slate-50 custom-scrollbar">
      {/* Encabezado */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col md:flex-row md:items-center gap-4">
          <div className="flex items-center gap-4 min-w-0 flex-1">
            <div className="w-14 h-14 rounded-2xl overflow-hidden flex items-center justify-center shrink-0 border border-slate-200" style={{ backgroundColor: config.logoUrl ? '#fff' : accent }}>
              {config.logoUrl ? <img src={config.logoUrl} alt="" className="w-full h-full object-cover" /> : <Store className="w-6 h-6 text-white" />}
            </div>
            <div className="min-w-0">
              <p className="text-[11.5px] font-semibold tracking-[0.14em] text-rose-600">TIENDA ONLINE</p>
              <h1 className="text-[22px] font-bold text-slate-900 tracking-tight truncate">{config.businessName || 'Mi tienda'}</h1>
              {savedUrl ? (
                <div data-tour="store-link" className="flex items-center gap-1 mt-0.5 min-w-0">
                  <a href={savedUrl} target="_blank" rel="noopener noreferrer" className="text-[13px] text-slate-500 hover:text-rose-700 truncate">{savedUrl}</a>
                  <IconBtn title="Copiar enlace" onClick={() => { navigator.clipboard?.writeText(savedUrl); toast.success('Enlace copiado: compartilo por WhatsApp o Instagram'); }}><Copy className="w-3.5 h-3.5" /></IconBtn>
                  <IconBtn title="Abrir la tienda" onClick={() => window.open(savedUrl, '_blank', 'noopener')}><ExternalLink className="w-3.5 h-3.5" /></IconBtn>
                </div>
              ) : (
                <button onClick={() => goTo('negocio')} className="text-[13px] font-semibold text-amber-700 hover:underline mt-0.5">Elegí la dirección web de tu tienda →</button>
              )}
            </div>
          </div>

          <button
            data-tour="store-visible"
            type="button"
            onClick={() => setVisible(!config.isPublished)}
            disabled={!!publishing}
            className={`flex items-center gap-3 pl-4 pr-3 h-12 rounded-2xl border transition-colors disabled:opacity-60 shrink-0 ${config.isPublished ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200 hover:border-slate-300'}`}
          >
            <span className="text-left">
              <span className={`block text-[13.5px] font-bold ${config.isPublished ? 'text-emerald-800' : 'text-slate-700'}`}>{config.isPublished ? 'Tienda visible' : 'Tienda oculta'}</span>
              <span className={`block text-[11.5px] ${config.isPublished ? 'text-emerald-700' : 'text-slate-500'}`}>{config.isPublished ? 'Tus clientes pueden pedir' : 'Nadie la ve todavía'}</span>
            </span>
            <Switch on={!!config.isPublished} />
          </button>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-6 grid grid-cols-1 lg:grid-cols-[230px,1fr] gap-6">
        {/* Menú de secciones */}
        <nav className="lg:sticky lg:top-6 self-start flex lg:flex-col gap-1 overflow-x-auto lg:overflow-visible pb-1 lg:pb-0">
          {SECTIONS.map((s) => {
            const Icon = s.icon;
            const active = tab === s.id;
            const pending = dirtySections.has(s.id) || (s.id === 'productos' && catalogDirty);
            const warn = s.id === 'negocio' && (!config.subdomain || !config.whatsappNumber);
            return (
              <button
                key={s.id}
                data-tour={`store-nav-${s.id}`}
                onClick={() => goTo(s.id)}
                className={`flex items-center gap-3 h-11 px-3.5 rounded-xl text-[14px] font-semibold whitespace-nowrap transition-colors ${active ? 'bg-white text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.06)] ring-1 ring-slate-200' : 'text-slate-600 hover:bg-white/70 hover:text-slate-900'}`}
              >
                <Icon className={`w-[18px] h-[18px] shrink-0 ${active ? 'text-rose-600' : 'text-slate-400'}`} />
                <span className="flex-1 text-left">{s.label}</span>
                {s.id === 'resumen' && pendingOrdersCount > 0 && <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-rose-600 text-white text-[11px] font-bold flex items-center justify-center">{pendingOrdersCount}</span>}
                {pending && <span title="Cambios sin publicar" className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />}
                {!pending && warn && <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />}
              </button>
            );
          })}
        </nav>

        <main className="min-w-0 space-y-5 pb-24">
          {tab === 'resumen' && (
            <SummarySection
              config={config}
              savedUrl={savedUrl}
              publishedCount={publishedCount}
              markedCount={localOnline.length}
              orders={orders}
              pendingOrdersCount={pendingOrdersCount}
              goTo={goTo}
              onOrders={() => navigate('/pedidos')}
              onVisible={() => setVisible(true)}
            />
          )}

          {tab === 'negocio' && (
            <>
              <Card title="Tu negocio" text="Lo primero que ven tus clientes al entrar.">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                  <Field label="Nombre del negocio">
                    <input type="text" value={config.businessName} onChange={(e) => update({ businessName: e.target.value })} className={inputBase} placeholder="Mi negocio" />
                  </Field>
                  <Field label="Dirección web" hint="Es el link que vas a compartir.">
                    <div className="flex items-stretch h-11 rounded-xl overflow-hidden border border-slate-300 bg-white focus-within:border-rose-500 focus-within:ring-[3px] focus-within:ring-rose-500/15">
                      <span className="bg-slate-50 px-3 flex items-center text-[13px] text-slate-500 border-r border-slate-200 select-none whitespace-nowrap">tienda.ventra.store/</span>
                      <input type="text" value={config.subdomain} onChange={(e) => update({ subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })} className="flex-1 min-w-0 px-3 text-[14px] text-slate-900 outline-none" placeholder="mi-negocio" />
                    </div>
                    {config.subdomain && (
                      <p className={`text-[12.5px] font-medium mt-1.5 flex items-center gap-1.5 ${subdomainStatus === 'available' ? 'text-emerald-600' : subdomainStatus === 'taken' ? 'text-rose-600' : 'text-slate-400'}`}>
                        {subdomainStatus === 'checking' && <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Verificando…</>}
                        {subdomainStatus === 'available' && <><CheckCircle2 className="w-3.5 h-3.5" /> Disponible</>}
                        {subdomainStatus === 'taken' && <><AlertCircle className="w-3.5 h-3.5" /> Ya la usa otra tienda</>}
                      </p>
                    )}
                  </Field>
                </div>
                <Field label="Descripción corta" hint="Aparece debajo del nombre, en la portada.">
                  <input type="text" maxLength={120} value={config.description || ''} onChange={(e) => update({ description: e.target.value })} className={inputBase} placeholder="Almacén de barrio · Envíos en el día" />
                </Field>
                <Field label="Rubro" hint="Adapta la tienda a tu negocio. En Gastronomía se muestra como una carta.">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2.5">
                    {RUBROS.map((r) => {
                      const Icon = r.icon;
                      const active = config.rubro === r.id;
                      return (
                        <button key={r.id} type="button" onClick={() => update({ rubro: r.id })}
                          className={`p-3.5 rounded-xl border flex flex-col items-center gap-2 text-center transition-colors ${active ? 'border-rose-500 bg-rose-50 ring-1 ring-rose-500' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                          <Icon className={`w-5 h-5 ${active ? 'text-rose-600' : 'text-slate-400'}`} />
                          <span className={`text-[12.5px] font-semibold leading-tight ${active ? 'text-rose-800' : 'text-slate-600'}`}>{r.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </Field>
              </Card>

              <Card title="Contacto y pedidos" text="Dónde te llegan los pedidos y cómo te encuentran.">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <Field label="WhatsApp del negocio" hint="Con código de país y área, sin espacios.">
                    <IconInput icon={Phone} iconClass="text-emerald-600" value={config.whatsappNumber} onChange={(v) => update({ whatsappNumber: v.replace(/\D/g, '') })} placeholder="5491123456789" />
                  </Field>
                  <Field label="Instagram" hint="Opcional.">
                    <IconInput icon={Instagram} value={config.instagram || ''} onChange={(v) => update({ instagram: v })} placeholder="@mi_negocio" />
                  </Field>
                  <Field label="Dirección" hint="Opcional. Se muestra en la tienda.">
                    <IconInput icon={MapPin} value={config.address || ''} onChange={(v) => update({ address: v })} placeholder="Av. Siempreviva 742" />
                  </Field>
                </div>
                <Field label="¿Cómo te llegan los pedidos?">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                    {ORDER_CHANNELS.map((ch) => {
                      const on = (config.orderChannel || 'BOTH') === ch.id;
                      return (
                        <button key={ch.id} type="button" onClick={() => update({ orderChannel: ch.id })}
                          className={`text-left rounded-xl border p-4 transition-colors ${on ? 'border-rose-500 bg-rose-50 ring-1 ring-rose-500' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
                          <span className="flex items-center gap-2 text-[14px] font-bold text-slate-800">
                            {on ? <CheckCircle2 className="w-4 h-4 text-rose-600" /> : <Circle className="w-4 h-4 text-slate-300" />}{ch.title}
                          </span>
                          <span className="block text-[12.5px] text-slate-500 mt-1 leading-snug">{ch.text}</span>
                        </button>
                      );
                    })}
                  </div>
                </Field>
              </Card>
            </>
          )}

          {tab === 'productos' && (
            <ProductsSection
              products={products}
              isLoading={isLoadingProducts}
              diff={diff}
              publishedCount={publishedCount}
              pendingToggles={pendingToggles}
              onToggle={toggleProductOnline}
              onSetMany={setManyOnline}
              config={config}
              update={update}
            />
          )}

          {tab === 'apariencia' && (
            <Card title="Apariencia" text="Colores, logo y portada: que la tienda se vea como tu negocio.">
              <div className="grid grid-cols-1 xl:grid-cols-[1fr,1.1fr] gap-7">
                <div className="space-y-5">
                  <div className="grid grid-cols-2 gap-3">
                    <ColorField label="Color principal" value={config.primaryColor} onChange={(v) => update({ primaryColor: v })} />
                    <ColorField label="Color secundario" value={config.secondaryColor} onChange={(v) => update({ secondaryColor: v })} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <ImagePick label="Logo" hint="Cuadrado, 512×512" src={config.logoUrl} contain onPick={(file) => setCrop({ file, kind: 'logo' })} onClear={() => update({ logoUrl: '' })} />
                    <ImagePick label="Portada" hint="Apaisada, 1500×500" src={config.bannerUrl} onPick={(file) => setCrop({ file, kind: 'banner' })} onClear={() => update({ bannerUrl: '' })} />
                  </div>
                  <Field label={<span className="inline-flex items-center gap-1.5"><Megaphone className="w-3.5 h-3.5" /> Aviso destacado</span>} hint="Una frase arriba de todo. Vacío = no se muestra.">
                    <input type="text" maxLength={90} value={config.announcement || ''} onChange={(e) => update({ announcement: e.target.value })} className={inputBase} placeholder="Envío gratis en compras desde $30.000" />
                  </Field>
                </div>
                <StorePreview config={config} accent={accent} />
              </div>
              {crop && (
                <ImageCropModal
                  file={crop.file}
                  {...(crop.kind === 'logo' ? STORE_LOGO : STORE_BANNER)}
                  round={crop.kind === 'logo'}
                  title={crop.kind === 'logo' ? 'Encuadrar logo' : 'Encuadrar portada'}
                  onCancel={() => setCrop(null)}
                  onDone={(url) => { update(crop.kind === 'logo' ? { logoUrl: url } : { bannerUrl: url }); setCrop(null); }}
                />
              )}
            </Card>
          )}

          {tab === 'entregas' && (
            <>
              <Card title="Entregas" text="Cómo reciben tus clientes lo que piden.">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <ToggleCard title="Retiro en el local" text="El cliente pasa a buscarlo." on={config.pickupEnabled !== false} onChange={(v) => update({ pickupEnabled: v })} />
                  <ToggleCard title="Envío a domicilio" text="Lo llevás vos." on={!!config.deliveryEnabled} onChange={(v) => update({ deliveryEnabled: v })} />
                  <ToggleCard title="Envío con GoDelivery" text="GoDelivery le cobra el envío al cliente." on={!!config.goDeliveryEnabled} onChange={(v) => update({ goDeliveryEnabled: v })} />
                </div>
                {config.deliveryEnabled && (
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-5 p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <Field label="Costo del envío" hint="0 = sin cargo"><MoneyField value={config.deliveryCost || 0} onChange={(v) => update({ deliveryCost: v })} /></Field>
                    <Field label="Envío gratis desde" hint="0 = nunca es gratis"><MoneyField value={config.freeDeliveryFrom || 0} onChange={(v) => update({ freeDeliveryFrom: v })} /></Field>
                    <Field label="Zona de entrega" hint="Se muestra al elegir envío"><input type="text" value={config.deliveryZone || ''} onChange={(e) => update({ deliveryZone: e.target.value })} className={inputBase} placeholder="Centro y barrios cercanos" /></Field>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <Field label="Demora del envío" hint="Se ve en la portada"><input type="text" value={config.deliveryEta || ''} onChange={(e) => update({ deliveryEta: e.target.value })} className={inputBase} placeholder="30-45 min" /></Field>
                  <Field label="Demora para retirar" hint="Se ve en la portada"><input type="text" value={config.pickupEta || ''} onChange={(e) => update({ pickupEta: e.target.value })} className={inputBase} placeholder="20 min" /></Field>
                  <Field label="Pedido mínimo" hint="0 = sin mínimo"><MoneyField value={config.minOrder || 0} onChange={(v) => update({ minOrder: v })} /></Field>
                </div>
              </Card>

              <Card title="Pagos" text="Cómo te pueden pagar tus clientes.">
                <Field label="Medios de pago que aceptás">
                  <div className="flex flex-wrap gap-2">
                    {PAYMENT_OPTIONS.map((m) => {
                      const selected = (config.paymentMethods || []).includes(m);
                      return (
                        <button key={m} type="button"
                          onClick={() => update({ paymentMethods: selected ? (config.paymentMethods || []).filter((x) => x !== m) : [...(config.paymentMethods || []), m] })}
                          className={`flex items-center gap-1.5 h-9 px-3.5 rounded-full border text-[13px] font-semibold transition-colors ${selected ? 'border-rose-500 bg-rose-50 text-rose-800' : 'border-slate-300 text-slate-600 hover:border-slate-400'}`}>
                          {selected ? <Check className="w-3.5 h-3.5" /> : <Wallet className="w-3.5 h-3.5" />} {m}
                        </button>
                      );
                    })}
                  </div>
                </Field>
                <Field label="Alias o CBU para transferencias" hint="Se le muestra al cliente si elige transferencia.">
                  <input type="text" value={config.transferAlias || ''} onChange={(e) => update({ transferAlias: e.target.value })} className={`${inputBase} md:max-w-sm`} placeholder="mi.negocio.mp" />
                </Field>
              </Card>
            </>
          )}

          {tab === 'horarios' && (
            <Card title="Horarios de atención" text='La tienda muestra "Abierto ahora" o "Cerrado". Los pedidos se pueden hacer igual.'>
              <HoursEditor config={config} update={update} />
            </Card>
          )}

          {tab === 'extras' && (
            <Card title="Extras y agregados" text="Opciones con precio que el cliente suma al producto: borde relleno, agregados, salsas. Se guardan al instante.">
              <ExtrasEditor storeId={storeId} initial={config.extraGroups || []} onSaved={(g) => setConfig((c) => (c ? { ...c, extraGroups: g } : c))} />
            </Card>
          )}
        </main>
      </div>

      {/* Aviso flotante de cambios sin publicar */}
      <AnimatePresence>
        {(hasChanges || publishing) && (
          <motion.div
            initial={{ y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 24, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="sticky bottom-5 z-30 flex justify-center px-6 pointer-events-none"
          >
            <div data-tour="store-save" className="pointer-events-auto flex items-center gap-4 pl-4 pr-2 py-2 rounded-2xl bg-slate-900 text-white shadow-[0_12px_40px_-8px_rgba(15,23,42,0.45)] max-w-full">
              {publishing ? (
                <span className="flex items-center gap-2.5 text-[13.5px] font-semibold py-2 pr-3"><Loader2 className="w-4 h-4 animate-spin" />{publishing}</span>
              ) : (
                <>
                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-400" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-bold">{config.isPublished ? 'Tenés cambios sin publicar' : 'Tenés cambios sin guardar'}</span>
                    <span className="block text-[12px] text-slate-300 truncate">{changesSummary(dirtySections, catalogDirty, diff, catalogChanges, !!config.isPublished)}</span>
                  </span>
                  {dirtyKeys.size > 0 && (
                    <button onClick={discard} className="h-9 px-3 rounded-xl text-[13px] font-semibold text-slate-300 hover:text-white hover:bg-white/10 flex items-center gap-1.5 shrink-0">
                      <Undo2 className="w-4 h-4" /> Descartar
                    </button>
                  )}
                  <button onClick={() => publishAll()} title="Ctrl+S" className="h-10 px-4 rounded-xl bg-rose-500 hover:bg-rose-400 text-white text-[13.5px] font-bold flex items-center gap-2 shrink-0">
                    <UploadCloud className="w-4 h-4" /> {config.isPublished ? 'Publicar cambios' : 'Guardar'}
                  </button>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function changesSummary(sections: Set<SectionId>, catalogDirty: boolean, diff: ReturnType<typeof diffCatalog> | null, n: number, visible: boolean) {
  const parts = SECTIONS.filter((s) => sections.has(s.id) && s.id !== 'productos').map((s) => s.label);
  if (sections.has('productos') || catalogDirty) {
    parts.push(catalogDirty && diff && !diff.unknown && n > 0 ? plural(n, 'producto', 'productos') : 'Productos');
  }
  const what = parts.join(' · ');
  return visible ? what : `${what} · la tienda sigue oculta`;
}

// ─── Resumen ─────────────────────────────────────────────────────
function SummarySection({ config, savedUrl, publishedCount, markedCount, orders, pendingOrdersCount, goTo, onOrders, onVisible }: {
  config: StoreConfig; savedUrl: string; publishedCount: number | null; markedCount: number; orders: StoreOrder[]; pendingOrdersCount: number;
  goTo: (id: SectionId) => void; onOrders: () => void; onVisible: () => void;
}) {
  const today = new Date().toDateString();
  const todayOrders = orders.filter((o) => o.createdAt?.toDate && o.createdAt.toDate().toDateString() === today);
  const steps = [
    { done: !!config.businessName && !!config.subdomain, label: 'Nombre y dirección web', hint: 'Cómo te encuentran tus clientes', go: () => goTo('negocio') },
    { done: !!config.whatsappNumber, label: 'WhatsApp para recibir pedidos', hint: 'Ahí te llega cada pedido', go: () => goTo('negocio') },
    { done: (publishedCount ?? markedCount) > 0, label: 'Productos en la tienda', hint: 'Elegí qué productos se venden online', go: () => goTo('productos') },
    { done: !!config.logoUrl, label: 'Logo y colores', hint: 'Opcional, pero da confianza', go: () => goTo('apariencia') },
    { done: !!config.isPublished, label: 'Hacer visible la tienda', hint: 'Recién ahí la pueden ver tus clientes', go: onVisible },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  return (
    <>
      {doneCount < steps.length && (
        <Card title="Dejá tu tienda lista" text={`${doneCount} de ${steps.length} pasos completos.`}>
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden -mt-1">
            <div className="h-full bg-rose-500 rounded-full transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          <div className="divide-y divide-slate-100 -mx-1">
            {steps.map((s) => (
              <button key={s.label} onClick={s.go} disabled={s.done} className="w-full flex items-center gap-3.5 px-1 py-3 text-left disabled:cursor-default group">
                {s.done ? <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" /> : <Circle className="w-5 h-5 text-slate-300 shrink-0" />}
                <span className="flex-1 min-w-0">
                  <span className={`block text-[14px] font-semibold ${s.done ? 'text-slate-400 line-through' : 'text-slate-800'}`}>{s.label}</span>
                  {!s.done && <span className="block text-[12.5px] text-slate-500">{s.hint}</span>}
                </span>
                {!s.done && <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500" />}
              </button>
            ))}
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat label="Productos en la tienda" value={publishedCount === null ? '—' : String(publishedCount)} onClick={() => goTo('productos')} />
        <Stat label="Pedidos sin atender" value={String(pendingOrdersCount)} tone={pendingOrdersCount > 0 ? 'text-rose-600' : undefined} onClick={onOrders} />
        <Stat label="Pedidos de hoy" value={String(todayOrders.length)} onClick={onOrders} />
      </div>

      <Card
        title="Últimos pedidos"
        text={savedUrl ? 'Los pedidos se atienden en Pedidos online.' : 'Cuando tengas tu tienda, los pedidos aparecen acá.'}
        action={orders.length > 0 ? <button onClick={onOrders} className="h-9 px-3.5 rounded-xl border border-slate-300 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-1.5">Ver pedidos <ChevronRight className="w-4 h-4" /></button> : undefined}
      >
        {orders.length === 0 ? (
          <div className="py-8 flex flex-col items-center gap-2 text-center">
            <ShoppingBag className="w-7 h-7 text-slate-300" />
            <p className="text-[13.5px] font-semibold text-slate-500">Todavía no llegó ningún pedido</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100 -my-2">
            {orders.slice(0, 6).map((o) => (
              <div key={o.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[14px] font-semibold text-slate-800 truncate">{o.customerName || 'Cliente'}{o.orderCode ? <span className="text-slate-400 font-medium"> · #{o.orderCode}</span> : null}</p>
                  <p className="text-[12.5px] text-slate-500 truncate">
                    {plural(o.items?.length || 0, 'producto', 'productos')}
                    {o.delivery ? ` · ${o.delivery === 'DELIVERY' ? 'Envío' : o.delivery === 'GODELIVERY' ? 'GoDelivery' : o.delivery === 'TABLE' ? 'Mesa' : 'Retira'}` : ''}
                    {o.paymentMethod ? ` · ${o.paymentMethod}` : ''}
                  </p>
                </div>
                <span className="text-[14px] font-bold text-slate-800 tabular-nums">{money(o.total || 0)}</span>
                <StageBadge stage={o.stage} />
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

function StageBadge({ stage }: { stage?: string }) {
  const s = stage || 'NEW';
  const label = ({ NEW: 'Nuevo', PREPARING: 'Preparando', READY: 'Listo', DELIVERED: 'Entregado', CANCELLED: 'Cancelado' } as Record<string, string>)[s] || s;
  const tone = s === 'NEW' ? 'bg-rose-50 text-rose-700 ring-rose-200' : s === 'CANCELLED' ? 'bg-slate-100 text-slate-500 ring-slate-200' : s === 'DELIVERED' ? 'bg-slate-50 text-slate-600 ring-slate-200' : 'bg-amber-50 text-amber-700 ring-amber-200';
  return <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ring-1 shrink-0 ${tone}`}>{label}</span>;
}

// ─── Productos ───────────────────────────────────────────────────
function ProductsSection({ products, isLoading, diff, publishedCount, pendingToggles, onToggle, onSetMany, config, update }: {
  products: any[]; isLoading: boolean; diff: ReturnType<typeof diffCatalog> | null; publishedCount: number | null;
  pendingToggles: Set<string>; onToggle: (p: any) => void; onSetMany: (ids: string[], v: boolean) => Promise<void>;
  config: StoreConfig; update: (p: Partial<StoreConfig>) => void;
}) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [show, setShow] = useState<'ALL' | 'ON' | 'OFF' | 'PENDING'>('ALL');
  const [visibleRows, setVisibleRows] = useState(100);
  const [bulkBusy, setBulkBusy] = useState(false);

  const categories = useMemo(() => Array.from(new Set(products.map((p) => p.category?.name).filter(Boolean))).sort() as string[], [products]);
  const statusOf = (p: any): 'added' | 'changed' | 'removed' | null => {
    if (!diff || diff.unknown) return null;
    if (diff.added.has(p.id)) return 'added';
    if (diff.removed.has(p.id)) return 'removed';
    if (diff.changed.has(p.id)) return 'changed';
    return null;
  };
  const filtered = useMemo(() => {
    let list = products;
    if (category !== 'ALL') list = list.filter((p) => p.category?.name === category);
    if (show === 'ON') list = list.filter((p) => p.showOnline);
    if (show === 'OFF') list = list.filter((p) => !p.showOnline);
    if (show === 'PENDING') list = list.filter((p) => statusOf(p));
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((p) => p.name?.toLowerCase().includes(q) || p.barcode?.includes(q));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, search, category, show, diff]);
  useEffect(() => setVisibleRows(100), [search, category, show]);

  const markedCount = useMemo(() => products.filter((p) => p.showOnline).length, [products]);
  const allOn = filtered.length > 0 && filtered.every((p) => p.showOnline);
  const narrowed = category !== 'ALL' || show !== 'ALL' || !!search.trim();
  const bulk = async () => {
    const next = !allOn;
    if (!window.confirm(`¿${next ? 'Mostrar' : 'Ocultar'} ${narrowed ? 'estos' : 'todos los'} ${filtered.length} productos en la tienda?`)) return;
    setBulkBusy(true);
    await onSetMany(filtered.map((p) => p.id), next);
    setBulkBusy(false);
  };
  const pendingCount = diff && !diff.unknown ? diff.added.size + diff.removed.size + diff.changed.size : 0;

  return (
    <>
      <Card
        title="Productos en la tienda"
        text={isLoading ? 'Cargando tus productos…' : `${markedCount} de ${products.length} productos marcados para vender online${publishedCount !== null ? ` · ${publishedCount} publicados ahora` : ''}.`}
        action={!isLoading && products.length > 0 && (
          <button onClick={bulk} disabled={bulkBusy || filtered.length === 0} className="h-9 px-3.5 rounded-xl border border-slate-300 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap">
            {allOn ? (narrowed ? 'Ocultar estos' : 'Ocultar todos') : (narrowed ? 'Mostrar estos' : 'Mostrar todos')}
          </button>
        )}
      >
        {!isLoading && markedCount === 0 && products.length > 0 && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
            <p className="flex-1 text-[13.5px] text-amber-900"><b>Todavía no elegiste productos.</b> Mostrá todo tu inventario de una vez, o activá uno por uno en la lista.</p>
            <button onClick={async () => { setBulkBusy(true); await onSetMany(products.map((p) => p.id), true); setBulkBusy(false); }} disabled={bulkBusy} className="h-9 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-[13px] font-bold disabled:opacity-60 whitespace-nowrap">
              Mostrar todos ({products.length})
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-[1.5fr,1fr] gap-2.5">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por nombre o código…" className={`${inputBase} pl-10`} />
          </div>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputBase}>
            <option value="ALL">Todas las categorías</option>
            {categories.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {([['ALL', 'Todos'], ['ON', 'En la tienda'], ['OFF', 'No se muestran'], ['PENDING', `Sin publicar${pendingCount ? ` (${pendingCount})` : ''}`]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setShow(id)} className={`h-8 px-3 rounded-full text-[12.5px] font-semibold transition-colors ${show === id ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{label}</button>
          ))}
        </div>

        <div className="rounded-xl border border-slate-200 overflow-hidden">
          {isLoading ? (
            <div className="p-10 flex items-center justify-center text-slate-400 gap-2 text-[13px] font-semibold"><Loader2 className="w-4 h-4 animate-spin" /> Cargando productos…</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-slate-400 text-[13px] font-semibold">Sin resultados</div>
          ) : (
            <div className="max-h-[520px] overflow-y-auto custom-scrollbar divide-y divide-slate-100">
              {filtered.slice(0, visibleRows).map((p) => {
                const st = statusOf(p);
                return (
                  <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50/70">
                    <div className="w-10 h-10 rounded-lg bg-slate-100 overflow-hidden shrink-0 flex items-center justify-center">
                      {p.imageUrl ? <img src={p.imageUrl} alt="" loading="lazy" className="w-full h-full object-cover" /> : <ImageIcon className="w-4 h-4 text-slate-300" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13.5px] font-semibold text-slate-800 truncate">{p.name}</p>
                      <p className="text-[12px] text-slate-400 truncate">{p.category?.name || 'Sin categoría'}{p.brand?.name ? ` · ${p.brand.name}` : ''}</p>
                    </div>
                    {st === 'added' && <Pill tone="emerald">Se agrega</Pill>}
                    {st === 'changed' && <Pill tone="amber">Cambió</Pill>}
                    {st === 'removed' && <Pill tone="slate">Se quita</Pill>}
                    <span className="w-24 text-right text-[13.5px] font-bold text-slate-700 tabular-nums">{money(p.salePrice)}</span>
                    <button onClick={() => onToggle(p)} disabled={pendingToggles.has(p.id)} className="disabled:opacity-50" aria-label={p.showOnline ? 'Ocultar de la tienda' : 'Mostrar en la tienda'}>
                      <Switch on={!!p.showOnline} small />
                    </button>
                  </div>
                );
              })}
              {filtered.length > visibleRows && (
                <button onClick={() => setVisibleRows((n) => n + 200)} className="w-full py-3 text-[13px] font-semibold text-slate-600 hover:bg-slate-50">
                  Mostrar más ({filtered.length - visibleRows} restantes)
                </button>
              )}
            </div>
          )}
        </div>
        <p className="text-[12.5px] text-slate-500">Los cambios de precio, stock y fotos que hagas en el sistema también se marcan acá y se publican con <b>Publicar cambios</b>.</p>
      </Card>

      <Card title="Stock" text="Qué pasa con los productos que se quedan sin stock.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <ToggleCard title="Mostrar productos sin stock" text="Aparecen como agotados." on={config.showOutOfStock !== false} onChange={(v) => update({ showOutOfStock: v })} />
          <ToggleCard title="Vender todo como disponible" text="Se pueden pedir aunque figuren sin stock." on={!!config.alwaysInStock} onChange={(v) => update({ alwaysInStock: v })} />
        </div>
      </Card>
    </>
  );
}

// ─── Horarios ────────────────────────────────────────────────────
const WEEK = [
  { idx: 1, label: 'Lunes' }, { idx: 2, label: 'Martes' }, { idx: 3, label: 'Miércoles' }, { idx: 4, label: 'Jueves' },
  { idx: 5, label: 'Viernes' }, { idx: 6, label: 'Sábado' }, { idx: 0, label: 'Domingo' },
];

function HoursEditor({ config, update }: { config: StoreConfig; update: (p: Partial<StoreConfig>) => void }) {
  const allHours = config.hours || [0, 1, 2, 3, 4, 5, 6].map(() => ({ open: false, from: '09:00', to: '20:00' }));
  return (
    <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
      {WEEK.map(({ idx, label }) => {
        const h = allHours[idx] || { open: false, from: '09:00', to: '20:00' };
        const ranges = dayRanges(h);
        const saveDay = (next: typeof h) => { const hours = [...allHours]; hours[idx] = next; update({ hours }); };
        const setRange = (i: number, patch: Partial<{ from: string; to: string }>) =>
          saveDay(withRanges(h, ranges.map((r, j) => (j === i ? { ...r, ...patch } : r))));
        return (
          <div key={idx} className="flex items-start gap-4 px-4 py-3">
            <button type="button" onClick={() => saveDay({ ...h, open: !h.open })} className="flex items-center gap-3 w-36 h-9 shrink-0">
              <Switch on={h.open} small />
              <span className={`text-[14px] font-semibold ${h.open ? 'text-slate-800' : 'text-slate-400'}`}>{label}</span>
            </button>
            {h.open ? (
              <div className="flex-1 flex flex-col gap-1.5">
                {ranges.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 text-[13px] text-slate-500">
                    <input type="time" value={r.from} onChange={(e) => setRange(i, { from: e.target.value })} className="h-9 border border-slate-300 rounded-lg px-2 text-slate-800" />
                    a
                    <input type="time" value={r.to} onChange={(e) => setRange(i, { to: e.target.value })} className="h-9 border border-slate-300 rounded-lg px-2 text-slate-800" />
                    {ranges.length > 1 && (
                      <button type="button" onClick={() => saveDay(withRanges(h, ranges.filter((_, j) => j !== i)))} className="text-[12.5px] font-semibold text-slate-400 hover:text-rose-600 px-1.5">Quitar</button>
                    )}
                  </div>
                ))}
                <div className="flex items-center gap-4">
                  {ranges.length < 3 && (
                    <button type="button" onClick={() => {
                      const last = ranges[ranges.length - 1];
                      saveDay(withRanges(h, [...ranges, { from: last && last.to < '17:00' ? '17:00' : '20:00', to: last && last.to < '17:00' ? '21:00' : '23:00' }]));
                    }} className="text-[12.5px] font-semibold text-rose-700 hover:underline">+ Agregar otro horario</button>
                  )}
                  {idx === 1 && (
                    <button type="button" onClick={() => update({ hours: allHours.map((d, j) => (j === 0 ? d : { ...h, ranges: [...ranges] })) })} className="text-[12.5px] font-semibold text-slate-500 hover:text-slate-800">
                      Copiar a lunes–sábado
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <span className="text-[13px] text-slate-400 h-9 flex items-center">Cerrado</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Vista previa ────────────────────────────────────────────────
function StorePreview({ config, accent }: { config: StoreConfig; accent: string }) {
  const rubro = RUBROS.find((r) => r.id === config.rubro) || RUBROS[0];
  return (
    <div>
      <p className="text-[12px] font-semibold text-slate-500 mb-2">Vista previa</p>
      <div className="rounded-2xl border border-slate-200 overflow-hidden shadow-sm bg-white">
        {config.announcement && <div className="px-3 py-1.5 text-center text-[11.5px] font-semibold text-white truncate" style={{ backgroundColor: accent }}>{config.announcement}</div>}
        <div className="aspect-[3/1] bg-slate-100 overflow-hidden">
          {config.bannerUrl ? <img src={config.bannerUrl} alt="" className="w-full h-full object-cover" /> : <div className="w-full h-full" style={{ background: `linear-gradient(135deg, ${accent}, ${config.secondaryColor})` }} />}
        </div>
        <div className="p-4 flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl border-2 border-white shadow-md -mt-10 overflow-hidden shrink-0 flex items-center justify-center" style={{ backgroundColor: config.logoUrl ? '#fff' : accent }}>
            {config.logoUrl ? <img src={config.logoUrl} alt="" className="w-full h-full object-cover" /> : <Store className="w-5 h-5 text-white" />}
          </div>
          <div className="min-w-0">
            <p className="text-[14.5px] font-bold text-slate-900 truncate">{config.businessName || 'Mi negocio'}</p>
            <p className="text-[12px] text-slate-500 truncate">{config.description || rubro.label}</p>
          </div>
          <span className="ml-auto text-white text-[11.5px] font-bold px-3 py-2 rounded-lg shrink-0" style={{ backgroundColor: accent }}>Ver carrito</span>
        </div>
      </div>
      <p className="text-[12px] text-slate-500 mt-2">Se actualiza mientras editás. Tus clientes lo ven recién al publicar.</p>
    </div>
  );
}

// ─── Piezas ──────────────────────────────────────────────────────
function Card({ title, text, action, children }: { title: string; text?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-slate-200/80 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="px-6 pt-5 pb-4 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[16px] font-bold text-slate-900 tracking-tight">{title}</h2>
          {text && <p className="text-[13px] text-slate-500 mt-0.5">{text}</p>}
        </div>
        {action}
      </header>
      <div className="px-6 pb-6 space-y-5">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: React.ReactNode; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[13px] font-semibold text-slate-800">{label}</label>
      {hint && <p className="text-[12px] text-slate-500 mt-0.5">{hint}</p>}
      <div className="mt-2">{children}</div>
    </div>
  );
}

function IconInput({ icon: Icon, iconClass = 'text-slate-400', value, onChange, placeholder }: { icon: any; iconClass?: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative flex items-center">
      <Icon className={`w-4 h-4 absolute left-3.5 ${iconClass}`} />
      <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={`${inputBase} pl-10`} placeholder={placeholder} />
    </div>
  );
}

function IconBtn({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 shrink-0">
      {children}
    </button>
  );
}

function Switch({ on, small }: { on: boolean; small?: boolean }) {
  return (
    <span className={`keep-style relative inline-flex shrink-0 rounded-full p-0.5 transition-colors ${small ? 'h-5 w-9' : 'h-6 w-11'}`} style={{ backgroundColor: on ? '#10b981' : '#cbd5e1' }}>
      <span className={`keep-style block rounded-full bg-white shadow transition-transform ${small ? 'h-4 w-4' : 'h-5 w-5'} ${on ? (small ? 'translate-x-4' : 'translate-x-5') : 'translate-x-0'}`} />
    </span>
  );
}

function Pill({ tone, children }: { tone: 'emerald' | 'amber' | 'slate'; children: React.ReactNode }) {
  const cls = tone === 'emerald' ? 'bg-emerald-50 text-emerald-700 ring-emerald-200' : tone === 'amber' ? 'bg-amber-50 text-amber-700 ring-amber-200' : 'bg-slate-100 text-slate-600 ring-slate-200';
  return <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ring-1 shrink-0 ${cls}`}>{children}</span>;
}

function Stat({ label, value, tone = 'text-slate-900', onClick }: { label: string; value: string; tone?: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="text-left bg-white rounded-2xl border border-slate-200/80 p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] hover:border-slate-300 transition-colors">
      <p className={`text-[26px] font-bold tabular-nums tracking-tight ${tone}`}>{value}</p>
      <p className="text-[12.5px] text-slate-500">{label}</p>
    </button>
  );
}

function ToggleCard({ title, text, on, onChange }: { title: string; text: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" onClick={() => onChange(!on)} aria-pressed={on}
      className={`w-full flex items-center justify-between gap-4 p-4 rounded-xl border text-left transition-colors ${on ? 'border-emerald-200 bg-emerald-50/50' : 'border-slate-200 bg-white hover:border-slate-300'}`}>
      <span>
        <span className="block text-[14px] font-bold text-slate-800">{title}</span>
        <span className="block text-[12.5px] text-slate-500 mt-0.5">{text}</span>
      </span>
      <Switch on={on} />
    </button>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 cursor-pointer hover:border-slate-300">
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="w-10 h-10 rounded-lg cursor-pointer border border-slate-300 shrink-0" />
      <span className="min-w-0">
        <span className="block text-[13px] font-semibold text-slate-800">{label}</span>
        <span className="block text-[12px] text-slate-500 font-mono uppercase">{value}</span>
      </span>
    </label>
  );
}

function ImagePick({ label, hint, src, contain, onPick, onClear }: { label: string; hint: string; src?: string; contain?: boolean; onPick: (f: File) => void; onClear: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-semibold text-slate-800">{label}</span>
        {src && <button type="button" onClick={onClear} className="text-[12px] font-semibold text-slate-400 hover:text-rose-600">Quitar</button>}
      </div>
      <p className="text-[12px] text-slate-500">{hint}</p>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onPick(f); }} />
      <button type="button" onClick={() => ref.current?.click()}
        className="mt-2 w-full h-28 rounded-xl bg-slate-50 border-2 border-dashed border-slate-300 flex items-center justify-center overflow-hidden hover:border-rose-400 hover:bg-white transition-colors group">
        {src ? (
          <img src={src} alt="" className={contain ? 'max-h-full max-w-full object-contain p-2' : 'w-full h-full object-cover'} />
        ) : (
          <span className="flex flex-col items-center gap-1.5 text-slate-400 group-hover:text-slate-600">
            <ImageIcon className="w-5 h-5" />
            <span className="text-[12px] font-semibold">Subir {label.toLowerCase()}</span>
          </span>
        )}
      </button>
    </div>
  );
}

function MoneyField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="relative flex items-center">
      <span className="absolute left-3.5 text-[14px] font-semibold text-slate-400">$</span>
      <input type="text" inputMode="numeric" value={value ? String(value) : ''} onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)} className={`${inputBase} pl-8`} placeholder="0" />
    </div>
  );
}
