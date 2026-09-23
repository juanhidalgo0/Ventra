import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAutoTour } from '../common/tour/GuidedTour';
import { motion, AnimatePresence } from 'framer-motion';
import api from '../../services/api';
import toast from 'react-hot-toast';
import {
  Globe,
  Palette,
  Store,
  MessageSquare,
  MapPin,
  Instagram,
  CheckCircle2,
  AlertCircle,
  Save,
  ExternalLink,
  RefreshCw,
  Sparkles,
  ShoppingBag,
  Loader2,
  Image as ImageIcon,
  Search,
  Package,
  Wrench,
  Shirt,
  LayoutGrid,
  Clock,
  Phone,
  User as UserIcon,
  Eye,
  Check,
  Truck,
  Wallet,
  Megaphone,
  Copy,
} from 'lucide-react';
import {
  resolveStoreId,
  loadStoreConfig,
  saveStoreConfig,
  isSubdomainAvailable,
  syncCatalogToStore,
  publishProductImages,
  PAYMENT_OPTIONS,
  dayRanges,
  withRanges,
  subscribeToStoreOrders,
  compressImageFile,
  type StoreConfig,
  type StoreOrder,
} from '../../services/onlineStore';

// Dominio público de la tienda online de Ventra. Cuando se publique el sitio de
// Firebase Hosting definitivo (ver README de despliegue), solo hay que actualizar
// esta constante — nada más del código depende del dominio.
const PUBLIC_STORE_BASE_URL = 'https://tienda.ventra.store';

const RUBROS = [
  { id: 'KIOSKO', label: 'Kiosco / Almacén', icon: Package },
  { id: 'FERRETERIA', label: 'Ferretería / Corralón', icon: Wrench },
  { id: 'INDUMENTARIA', label: 'Indumentaria y Calzado', icon: Shirt },
  { id: 'OTRO', label: 'Otro Rubro', icon: LayoutGrid },
];

function SectionHeader({ icon: Icon, title, subtitle, accent }: { icon: any; title: string; subtitle?: string; accent: string }) {
  return (
    <div className="flex items-start gap-3.5 pb-5 mb-6 border-b border-slate-100">
      <div
        className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
        style={{ backgroundColor: `${accent}14`, color: accent }}
      >
        <Icon className="w-5 h-5" />
      </div>
      <div className="pt-0.5">
        <h3 className="text-[15px] font-bold text-slate-900 tracking-tight leading-tight">{title}</h3>
        {subtitle && <p className="text-[13px] text-slate-500 font-medium mt-1 leading-snug">{subtitle}</p>}
      </div>
    </div>
  );
}

function FieldLabel({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-2">
      <label className="block text-[13px] font-semibold text-slate-800">{children}</label>
      {hint && <p className="text-[12px] text-slate-500 mt-0.5">{hint}</p>}
    </div>
  );
}

const inputBase = "w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-[14px] font-medium text-slate-900 placeholder:text-slate-400 outline-none transition-all shadow-[0_1px_2px_rgba(0,0,0,0.03)] focus:border-[var(--accent)] focus:ring-[3px] focus:ring-[var(--accent)]/15";

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
  if (!storeId) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-50">
        <Loader2 className="w-6 h-6 text-rose-500 animate-spin" />
      </div>
    );
  }
  return <OnlineStoreEditor storeId={storeId} />;
}

function OnlineStoreEditor({ storeId }: { storeId: string }) {

  const [config, setConfig] = useState<StoreConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  useAutoTour('onlineStore', !isLoading);
  const [isSaving, setIsSaving] = useState(false);
  const [subdomainStatus, setSubdomainStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');

  const [products, setProducts] = useState<any[]>([]);
  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [isSyncingCatalog, setIsSyncingCatalog] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ done: number; total: number } | null>(null);
  const [pendingToggles, setPendingToggles] = useState<Set<string>>(new Set());

  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    (async () => {
      setIsLoading(true);
      try {
        const loaded = await loadStoreConfig(storeId);
        setConfig(loaded);
      } catch (err) {
        console.error(err);
        toast.error('No se pudo cargar la configuración de la tienda (revisá tu conexión a internet)');
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
      const { data } = await api.get('/products', { params: { take: 5000 } });
      setProducts(data?.products || data || []);
    } catch (err) {
      console.error(err);
      toast.error('Error al cargar los productos del catálogo');
    } finally {
      setIsLoadingProducts(false);
    }
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  // Chequeo de disponibilidad del subdominio, debounced.
  useEffect(() => {
    if (!config?.subdomain) {
      setSubdomainStatus('idle');
      return;
    }
    setSubdomainStatus('checking');
    const handler = setTimeout(async () => {
      try {
        const available = await isSubdomainAvailable(config.subdomain, storeId);
        setSubdomainStatus(available ? 'available' : 'taken');
      } catch {
        setSubdomainStatus('idle');
      }
    }, 600);
    return () => clearTimeout(handler);
  }, [config?.subdomain, storeId]);

  const update = (patch: Partial<StoreConfig>) => {
    setConfig(prev => (prev ? { ...prev, ...patch } : prev));
  };

  const handleSave = async () => {
    if (!config) return;
    if (config.isPublished && subdomainStatus === 'taken') {
      toast.error('Ese subdominio ya está en uso por otra tienda. Elegí otro.');
      return;
    }
    if (config.isPublished && (!config.subdomain || !config.whatsappNumber)) {
      toast.error('Para publicar la tienda necesitás definir un subdominio y un número de WhatsApp.');
      return;
    }
    setIsSaving(true);
    try {
      await saveStoreConfig(storeId, config);
      toast.success('✨ Configuración de la tienda guardada');
    } catch (err) {
      console.error(err);
      toast.error('Error al guardar la configuración en la nube');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file, 300, 300, 0.7);
      update({ logoUrl: compressed });
    } catch {
      toast.error('No se pudo procesar la imagen del logo');
    } finally {
      e.target.value = '';
    }
  };

  const handleBannerUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImageFile(file, 1200, 400, 0.6);
      update({ bannerUrl: compressed });
    } catch {
      toast.error('No se pudo procesar la imagen del banner');
    } finally {
      e.target.value = '';
    }
  };

  const toggleProductOnline = async (product: any) => {
    const nextValue = !product.showOnline;
    setPendingToggles(prev => new Set(prev).add(product.id));
    setProducts(prev => prev.map(p => p.id === product.id ? { ...p, showOnline: nextValue } : p));
    try {
      await api.patch(`/products/${product.id}`, { showOnline: nextValue });
    } catch (err) {
      console.error(err);
      toast.error('Error al actualizar el producto');
      setProducts(prev => prev.map(p => p.id === product.id ? { ...p, showOnline: !nextValue } : p));
    } finally {
      setPendingToggles(prev => {
        const next = new Set(prev);
        next.delete(product.id);
        return next;
      });
    }
  };

  const handleSyncCatalog = async () => {
    let online = products.filter(p => p.showOnline);

    // Si todavía no se marcó ningún producto a mano, "Sincronizar Todo el Inventario"
    // hace exactamente eso: activa TODO el catálogo activo para la tienda de una vez.
    const syncingEverything = online.length === 0;
    const targetCount = syncingEverything ? products.length : online.length;

    const confirmed = window.confirm(
      syncingEverything
        ? `No marcaste ningún producto individualmente. Se va a activar y sincronizar TODO tu inventario ` +
          `(${targetCount} producto(s)) en la tienda, incluyendo categorías y marcas de cada uno. ¿Continuar?`
        : `Se va a sincronizar TODO el inventario marcado para la tienda (${targetCount} producto(s)), ` +
          `incluyendo categorías y marcas de cada uno. Esto reemplaza el catálogo publicado actualmente. ¿Continuar?`
    );
    if (!confirmed) return;

    setIsSyncingCatalog(true);
    try {
      if (syncingEverything) {
        await api.post('/products/bulk-set-show-online', { showOnline: true });
        online = products.map(p => ({ ...p, showOnline: true }));
        setProducts(online);
      }

      // Las fotos se suben a la nube (desde la PC no se pueden ver por internet)
      const images = await publishProductImages(storeId, online, (done, total) => setSyncProgress({ done, total }));
      await syncCatalogToStore(storeId, online.map(p => ({
        productId: p.id,
        name: p.name,
        description: p.description || '',
        price: p.salePrice,
        imageUrl: images.get(p.id) || '',
        category: p.category?.name || 'Varios',
        brand: p.brand?.name || '',
        unit: p.unit || 'UNIT',
        inStock: p.unlimitedStock || p.stock > 0,
      })));
      toast.success(`🚀 Inventario sincronizado: ${online.length} producto(s) publicado(s) en la tienda`);
    } catch (err) {
      console.error(err);
      toast.error('Error al sincronizar el inventario con la nube');
    } finally {
      setIsSyncingCatalog(false);
      setSyncProgress(null);
    }
  };

  // La tabla muestra de a 100: con miles de productos, dibujarlos todos hacía lento escribir en cualquier campo
  const [visibleRows, setVisibleRows] = useState(100);
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [brandFilter, setBrandFilter] = useState('ALL');

  const categoryOptions = useMemo(() => {
    const names = new Set<string>();
    products.forEach(p => { if (p.category?.name) names.add(p.category.name); });
    return Array.from(names).sort();
  }, [products]);

  const brandOptions = useMemo(() => {
    const names = new Set<string>();
    products.forEach(p => { if (p.brand?.name) names.add(p.brand.name); });
    return Array.from(names).sort();
  }, [products]);

  const filteredProducts = useMemo(() => {
    let list = products;
    if (categoryFilter !== 'ALL') list = list.filter(p => p.category?.name === categoryFilter);
    if (brandFilter !== 'ALL') list = list.filter(p => p.brand?.name === brandFilter);
    if (productSearch.trim()) {
      const q = productSearch.trim().toLowerCase();
      list = list.filter(p => p.name?.toLowerCase().includes(q) || p.barcode?.includes(q));
    }
    return list;
  }, [products, productSearch, categoryFilter, brandFilter]);

  const onlineCount = useMemo(() => products.filter(p => p.showOnline).length, [products]);
  const pendingOrdersCount = useMemo(() => orders.filter(o => !o.stage || o.stage === 'NEW').length, [orders]);

  const publicUrl = config?.subdomain ? `${PUBLIC_STORE_BASE_URL}/${config.subdomain}` : '';
  const accent = config?.primaryColor || '#e11d48';
  const rubroMeta = RUBROS.find(r => r.id === config?.rubro) || RUBROS[0];

  if (isLoading || !config) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-slate-50 gap-4">
        <div className="relative flex items-center justify-center">
          <div className="w-16 h-16 border-4 border-rose-100 border-t-rose-500 rounded-full animate-spin" />
          <Globe className="w-6 h-6 text-rose-500 absolute" />
        </div>
        <div className="text-center">
          <h3 className="text-sm font-bold text-slate-800">Cargando Tienda Online</h3>
          <p className="text-[13px] text-slate-500 font-medium mt-1">Conectando con la nube de Ventra...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="h-full flex flex-col gap-6 bg-slate-50 p-5 sm:p-7 overflow-y-auto custom-scrollbar pb-16"
      style={{ '--accent': accent } as React.CSSProperties}
    >
      {/* Header */}
      <div className="bg-white p-5 sm:p-6 rounded-2xl border border-slate-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_30px_-12px_rgba(0,0,0,0.08)] flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <div
            className="w-[52px] h-[52px] rounded-2xl flex items-center justify-center shadow-sm shrink-0"
            style={{ backgroundColor: accent, color: '#fff' }}
          >
            <Store className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h1 className="text-lg font-bold text-slate-900 tracking-tight">Mi Tienda Online</h1>
              {config.isPublished ? (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold uppercase tracking-wide">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Publicada
                </span>
              ) : (
                <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 border border-slate-200 text-[11px] font-bold uppercase tracking-wide">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-400" /> Borrador
                </span>
              )}
            </div>
            <p className="text-[13px] font-medium text-slate-500 mt-1">Catálogo propio con tu marca — pedidos directo a tu WhatsApp</p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0 w-full sm:w-auto">
          {publicUrl && (
            <button
              type="button"
              onClick={() => { navigator.clipboard?.writeText(publicUrl); toast.success('Enlace copiado: compartilo por WhatsApp o Instagram'); }}
              className="flex items-center justify-center gap-2 px-3.5 py-2.5 rounded-xl border border-slate-300 bg-white text-[13px] font-semibold text-slate-700 hover:bg-slate-50 transition-all cursor-pointer"
              title={publicUrl}
            >
              <Copy className="w-4 h-4" />
              <span className="hidden sm:inline">Copiar enlace</span>
            </button>
          )}
          {publicUrl && (
            <a
              href={publicUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-slate-300 bg-white text-[13px] font-semibold text-slate-700 hover:bg-slate-50 hover:border-slate-400 transition-all cursor-pointer"
            >
              <ExternalLink className="w-4 h-4" />
              <span>Ver Tienda</span>
            </a>
          )}
          <button
            data-tour="store-save"
            onClick={handleSave}
            disabled={isSaving}
            className="flex-1 sm:flex-initial flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold text-white shadow-md active:scale-[0.98] transition-all cursor-pointer disabled:opacity-60"
            style={{ backgroundColor: accent, boxShadow: `0 8px 20px -6px ${accent}66` }}
          >
            <Save className="w-4 h-4" />
            <span>{isSaving ? 'Guardando...' : 'Guardar Cambios'}</span>
          </button>
        </div>
      </div>

      <div className="w-full max-w-5xl mx-auto space-y-6">

        {/* Identidad y Rubro */}
        <div data-tour="store-identity" className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_30px_-16px_rgba(0,0,0,0.08)]">
          <SectionHeader icon={Sparkles} title="Identidad de la Tienda" subtitle="El nombre y rubro que van a ver tus clientes" accent={accent} />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <FieldLabel>Nombre Comercial</FieldLabel>
              <input
                type="text"
                value={config.businessName}
                onChange={(e) => update({ businessName: e.target.value })}
                className={inputBase}
                placeholder="Mi Negocio"
              />
            </div>

            <div>
              <FieldLabel>Subdominio Público</FieldLabel>
              <div className="flex flex-col sm:flex-row sm:items-stretch rounded-xl overflow-hidden border border-slate-300 bg-white focus-within:border-[var(--accent)] focus-within:ring-[3px] focus-within:ring-[var(--accent)]/15 transition-all">
                <div className="bg-slate-50 px-3 py-3 flex items-center justify-center text-[12.5px] font-semibold text-slate-500 border-b sm:border-b-0 sm:border-r border-slate-200 select-none whitespace-nowrap">
                  tienda.ventra.store/
                </div>
                <input
                  type="text"
                  value={config.subdomain}
                  onChange={(e) => update({ subdomain: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '-') })}
                  className="w-full sm:flex-1 bg-white px-3.5 py-3 text-[14px] font-medium text-slate-900 outline-none placeholder:text-slate-400"
                  placeholder="mi-negocio"
                />
              </div>
              {config.subdomain && (
                <p className={`text-[12.5px] font-semibold mt-2 flex items-center gap-1.5 ${
                  subdomainStatus === 'available' ? 'text-emerald-600' : subdomainStatus === 'taken' ? 'text-rose-600' : 'text-slate-400'
                }`}>
                  {subdomainStatus === 'checking' && <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Verificando disponibilidad...</>}
                  {subdomainStatus === 'available' && <><CheckCircle2 className="w-3.5 h-3.5" /> Disponible</>}
                  {subdomainStatus === 'taken' && <><AlertCircle className="w-3.5 h-3.5" /> Ya está en uso por otra tienda</>}
                </p>
              )}
            </div>
          </div>

          <div className="mt-5">
            <FieldLabel hint="Aparece debajo del nombre, en la portada de la tienda.">Descripción corta</FieldLabel>
            <input
              type="text"
              maxLength={120}
              value={config.description || ''}
              onChange={(e) => update({ description: e.target.value })}
              className={inputBase}
              placeholder="Almacén de barrio · Envíos en el día"
            />
          </div>

          <div className="mt-6">
            <FieldLabel>Rubro del Negocio</FieldLabel>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {RUBROS.map(r => {
                const Icon = r.icon;
                const active = config.rubro === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => update({ rubro: r.id })}
                    className="relative p-4 rounded-xl border-2 flex flex-col items-center gap-2.5 text-center transition-all cursor-pointer"
                    style={active
                      ? { borderColor: accent, backgroundColor: `${accent}0d` }
                      : { borderColor: '#e2e8f0', backgroundColor: '#fff' }
                    }
                  >
                    {active && (
                      <span
                        className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center"
                        style={{ backgroundColor: accent }}
                      >
                        <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
                      </span>
                    )}
                    <Icon className="w-5 h-5" style={{ color: active ? accent : '#64748b' }} />
                    <span className="text-[12.5px] font-semibold leading-tight" style={{ color: active ? accent : '#475569' }}>{r.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Apariencia */}
        <div data-tour="store-appearance" className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_30px_-16px_rgba(0,0,0,0.08)]">
          <SectionHeader icon={Palette} title="Apariencia y Marca" subtitle="Colores, logo y banner que definen el look de tu tienda" accent={accent} />

          <div className="grid grid-cols-1 lg:grid-cols-[1fr,1.1fr] gap-8">
            <div className="space-y-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="flex items-center gap-3.5 p-4 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer hover:border-slate-300 transition-all">
                  <input
                    type="color"
                    value={config.primaryColor}
                    onChange={(e) => update({ primaryColor: e.target.value })}
                    className="w-11 h-11 rounded-lg cursor-pointer border border-slate-300 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800">Color Principal</p>
                    <p className="text-[12px] text-slate-500 font-mono uppercase mt-0.5">{config.primaryColor}</p>
                  </div>
                </label>
                <label className="flex items-center gap-3.5 p-4 bg-slate-50 rounded-xl border border-slate-200 cursor-pointer hover:border-slate-300 transition-all">
                  <input
                    type="color"
                    value={config.secondaryColor}
                    onChange={(e) => update({ secondaryColor: e.target.value })}
                    className="w-11 h-11 rounded-lg cursor-pointer border border-slate-300 shrink-0"
                  />
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-800">Color Secundario</p>
                    <p className="text-[12px] text-slate-500 font-mono uppercase mt-0.5">{config.secondaryColor}</p>
                  </div>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <FieldLabel>Logo de la Tienda</FieldLabel>
                  <input ref={logoInputRef} type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                  <button
                    type="button"
                    onClick={() => logoInputRef.current?.click()}
                    className="w-full h-28 rounded-xl bg-slate-50 border-2 border-dashed border-slate-300 flex items-center justify-center overflow-hidden hover:border-[var(--accent)] hover:bg-white transition-all group cursor-pointer"
                  >
                    {config.logoUrl ? (
                      <img src={config.logoUrl} alt="Logo" className="max-h-full max-w-full object-contain p-2" />
                    ) : (
                      <div className="flex flex-col items-center gap-1.5 text-slate-400 group-hover:text-slate-500">
                        <ImageIcon className="w-5 h-5 group-hover:scale-110 transition-transform" />
                        <span className="text-[12px] font-semibold">Subir Logo</span>
                      </div>
                    )}
                  </button>
                </div>
                <div>
                  <FieldLabel>Banner de Portada</FieldLabel>
                  <input ref={bannerInputRef} type="file" accept="image/*" className="hidden" onChange={handleBannerUpload} />
                  <button
                    type="button"
                    onClick={() => bannerInputRef.current?.click()}
                    className="w-full h-28 rounded-xl bg-slate-50 border-2 border-dashed border-slate-300 flex items-center justify-center overflow-hidden hover:border-[var(--accent)] hover:bg-white transition-all group cursor-pointer"
                  >
                    {config.bannerUrl ? (
                      <img src={config.bannerUrl} alt="Banner" className="w-full h-full object-cover" />
                    ) : (
                      <div className="flex flex-col items-center gap-1.5 text-slate-400 group-hover:text-slate-500">
                        <ImageIcon className="w-5 h-5 group-hover:scale-110 transition-transform" />
                        <span className="text-[12px] font-semibold">Subir Banner</span>
                      </div>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Live preview */}
            <div>
              <div className="flex items-center gap-1.5 mb-2.5 text-slate-500">
                <Eye className="w-3.5 h-3.5" />
                <span className="text-[12px] font-bold uppercase tracking-wide">Vista Previa en Vivo</span>
              </div>
              <div className="rounded-2xl border border-slate-200 overflow-hidden shadow-sm bg-white">
                <div className="h-24 bg-slate-100 relative overflow-hidden">
                  {config.bannerUrl ? (
                    <img src={config.bannerUrl} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full" style={{ background: `linear-gradient(135deg, ${accent}, ${config.secondaryColor})` }} />
                  )}
                </div>
                <div className="p-4 flex items-center gap-3 bg-white">
                  <div className="w-11 h-11 rounded-xl border-2 border-white shadow-md -mt-9 bg-white flex items-center justify-center overflow-hidden shrink-0" style={{ backgroundColor: config.logoUrl ? '#fff' : accent }}>
                    {config.logoUrl ? (
                      <img src={config.logoUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Store className="w-5 h-5 text-white" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[14px] font-bold text-slate-900 truncate">{config.businessName || 'Mi Negocio'}</p>
                    <p className="text-[11.5px] font-semibold uppercase tracking-wide" style={{ color: accent }}>{rubroMeta.label}</p>
                  </div>
                  <button
                    type="button"
                    className="ml-auto text-white text-[11px] font-bold px-3 py-2 rounded-lg shrink-0"
                    style={{ backgroundColor: accent }}
                  >
                    🛒 Carrito
                  </button>
                </div>
              </div>
              <p className="text-[12px] text-slate-500 mt-2.5 leading-relaxed">Así se va a ver el encabezado de tu tienda. Se actualiza en tiempo real mientras editás.</p>
            </div>
          </div>
        </div>

        {/* Contacto */}
        <div data-tour="store-contact" className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_30px_-16px_rgba(0,0,0,0.08)]">
          <SectionHeader icon={MessageSquare} title="Contacto y Pedidos" subtitle="A dónde llegan los pedidos y cómo te encuentran" accent={accent} />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <div>
              <FieldLabel hint="Los pedidos del carrito llegan a este número.">WhatsApp del Comercio</FieldLabel>
              <div className="relative flex items-center">
                <Phone className="w-4 h-4 absolute left-3.5 text-emerald-600" />
                <input
                  type="text"
                  value={config.whatsappNumber}
                  onChange={(e) => update({ whatsappNumber: e.target.value.replace(/\D/g, '') })}
                  className={`${inputBase} pl-10`}
                  placeholder="5491123456789"
                />
              </div>
            </div>

            <div>
              <FieldLabel>Instagram</FieldLabel>
              <div className="relative flex items-center">
                <Instagram className="w-4 h-4 absolute left-3.5 text-slate-400" />
                <input
                  type="text"
                  value={config.instagram || ''}
                  onChange={(e) => update({ instagram: e.target.value })}
                  className={`${inputBase} pl-10`}
                  placeholder="@mi_negocio"
                />
              </div>
            </div>

            <div>
              <FieldLabel>Dirección (opcional)</FieldLabel>
              <div className="relative flex items-center">
                <MapPin className="w-4 h-4 absolute left-3.5 text-slate-400" />
                <input
                  type="text"
                  value={config.address || ''}
                  onChange={(e) => update({ address: e.target.value })}
                  className={`${inputBase} pl-10`}
                  placeholder="Av. Siempreviva 742"
                />
              </div>
            </div>
          </div>

          <div className="flex items-center justify-between p-4 sm:p-5 bg-slate-50 rounded-xl border border-slate-200 mt-6">
            <div className="pr-4">
              <span className="block text-[14px] font-bold text-slate-800">Publicar Tienda</span>
              <span className="block text-[12.5px] text-slate-500 font-medium mt-1 leading-relaxed">
                Mientras esté en "Borrador", la tienda no es visible públicamente aunque tenga la URL.
              </span>
            </div>
            <button
              type="button"
              onClick={() => update({ isPublished: !config.isPublished })}
              className="keep-style relative inline-flex h-7 w-14 shrink-0 cursor-pointer rounded-full p-1 transition-colors duration-300 ease-in-out"
              style={{ backgroundColor: config.isPublished ? '#10b981' : '#cbd5e1' }}
            >
              <span className={`keep-style pointer-events-none block h-5 w-5 transform rounded-full bg-white shadow-md transition-transform duration-300 ease-in-out ${
                config.isPublished ? 'translate-x-7' : 'translate-x-0'
              }`} />
            </button>
          </div>
        </div>

        {/* Pedidos, entregas y pagos */}
        <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_30px_-16px_rgba(0,0,0,0.08)]">
          <SectionHeader icon={Truck} title="Entregas, Pagos y Horarios" subtitle="Cómo reciben tus clientes lo que piden y cómo te pagan" accent={accent} />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <ToggleCard
              title="Retiro en el local"
              text="El cliente pasa a buscar su pedido."
              on={config.pickupEnabled !== false}
              onChange={(v) => update({ pickupEnabled: v })}
            />
            <ToggleCard
              title="Envío a domicilio"
              text="Le llevás el pedido al cliente."
              on={!!config.deliveryEnabled}
              onChange={(v) => update({ deliveryEnabled: v })}
            />
            <ToggleCard
              title="Envío con GoDelivery"
              text="Lo cobra GoDelivery al cliente, aparte."
              on={!!config.goDeliveryEnabled}
              onChange={(v) => update({ goDeliveryEnabled: v })}
            />
          </div>

          {config.deliveryEnabled && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mt-5">
              <div>
                <FieldLabel hint="0 = sin cargo">Costo del envío</FieldLabel>
                <MoneyField value={config.deliveryCost || 0} onChange={(v) => update({ deliveryCost: v })} />
              </div>
              <div>
                <FieldLabel hint="0 = nunca es gratis">Envío gratis desde</FieldLabel>
                <MoneyField value={config.freeDeliveryFrom || 0} onChange={(v) => update({ freeDeliveryFrom: v })} />
              </div>
              <div>
                <FieldLabel hint="Se muestra al elegir envío">Zona de entrega</FieldLabel>
                <input type="text" value={config.deliveryZone || ''} onChange={(e) => update({ deliveryZone: e.target.value })} className={inputBase} placeholder="Centro y barrios cercanos" />
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5 mt-6">
            <div>
              <FieldLabel hint="0 = sin mínimo">Pedido mínimo</FieldLabel>
              <MoneyField value={config.minOrder || 0} onChange={(v) => update({ minOrder: v })} />
            </div>
            <div>
              <FieldLabel hint="Se le muestra al cliente si elige transferencia">Alias o CBU para transferencias</FieldLabel>
              <input type="text" value={config.transferAlias || ''} onChange={(e) => update({ transferAlias: e.target.value })} className={inputBase} placeholder="mi.negocio.mp" />
            </div>
          </div>

          <div className="mt-6">
            <FieldLabel>Medios de pago que aceptás</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {PAYMENT_OPTIONS.map((m) => {
                const selected = (config.paymentMethods || []).includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => update({
                      paymentMethods: selected
                        ? (config.paymentMethods || []).filter((x) => x !== m)
                        : [...(config.paymentMethods || []), m],
                    })}
                    className="flex items-center gap-1.5 px-3.5 py-2 rounded-full border text-[13px] font-semibold transition-all cursor-pointer"
                    style={selected ? { borderColor: accent, backgroundColor: `${accent}12`, color: accent } : { borderColor: '#cbd5e1', color: '#475569' }}
                  >
                    {selected ? <Check className="w-3.5 h-3.5" /> : <Wallet className="w-3.5 h-3.5" />} {m}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mt-7">
            <FieldLabel hint="Con esto la tienda muestra &quot;Abierto ahora&quot; o &quot;Cerrado&quot;. Los pedidos se pueden hacer igual.">Horarios de atención</FieldLabel>
            <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
              {WEEK.map(({ idx, label }) => {
                const allHours = config.hours || [0, 1, 2, 3, 4, 5, 6].map(() => ({ open: false, from: '09:00', to: '20:00' }));
                const h = allHours[idx] || { open: false, from: '09:00', to: '20:00' };
                const ranges = dayRanges(h);
                const saveDay = (next: typeof h) => {
                  const hours = [...allHours];
                  hours[idx] = next;
                  update({ hours });
                };
                const setRange = (i: number, patch: Partial<{ from: string; to: string }>) =>
                  saveDay(withRanges(h, ranges.map((r, j) => (j === i ? { ...r, ...patch } : r))));
                return (
                  <div key={idx} className="flex items-start gap-3 px-4 py-2.5">
                    <label className="flex items-center gap-2.5 w-32 h-9 cursor-pointer shrink-0">
                      <input type="checkbox" checked={h.open} onChange={(e) => saveDay({ ...h, open: e.target.checked })} className="w-4 h-4 accent-[var(--accent)]" />
                      <span className={`text-[13.5px] font-semibold ${h.open ? 'text-slate-800' : 'text-slate-400'}`}>{label}</span>
                    </label>
                    {h.open ? (
                      <div className="flex-1 flex flex-col gap-1.5">
                        {ranges.map((r, i) => (
                          <div key={i} className="flex items-center gap-2 text-[13px] text-slate-500">
                            <input type="time" value={r.from} onChange={(e) => setRange(i, { from: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-slate-800" />
                            a
                            <input type="time" value={r.to} onChange={(e) => setRange(i, { to: e.target.value })} className="border border-slate-300 rounded-lg px-2 py-1.5 text-slate-800" />
                            {ranges.length > 1 && (
                              <button type="button" onClick={() => saveDay(withRanges(h, ranges.filter((_, j) => j !== i)))} className="text-[12.5px] font-semibold text-slate-400 hover:text-rose-600 px-1.5 cursor-pointer" title="Quitar este horario">
                                Quitar
                              </button>
                            )}
                          </div>
                        ))}
                        <div className="flex items-center gap-3">
                          {ranges.length < 3 && (
                            <button
                              type="button"
                              onClick={() => {
                                const last = ranges[ranges.length - 1];
                                saveDay(withRanges(h, [...ranges, { from: last && last.to < '17:00' ? '17:00' : '20:00', to: last && last.to < '17:00' ? '21:00' : '23:00' }]));
                              }}
                              className="text-[12.5px] font-semibold cursor-pointer"
                              style={{ color: accent }}
                            >
                              + Agregar horario
                            </button>
                          )}
                          {idx === 1 && (
                            <button
                              type="button"
                              onClick={() => update({ hours: allHours.map((d, j) => (j === 0 ? d : { ...h, ranges: [...ranges] })) })}
                              className="text-[12.5px] font-semibold text-slate-500 hover:text-slate-700 cursor-pointer"
                            >
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
          </div>

          <div className="grid grid-cols-1 md:grid-cols-[1fr,auto] gap-5 mt-7 items-end">
            <div>
              <FieldLabel hint="Una frase destacada arriba de todo. Dejalo vacío para no mostrar nada.">
                <span className="inline-flex items-center gap-1.5"><Megaphone className="w-3.5 h-3.5" /> Aviso destacado</span>
              </FieldLabel>
              <input type="text" maxLength={90} value={config.announcement || ''} onChange={(e) => update({ announcement: e.target.value })} className={inputBase} placeholder="Envío gratis en compras desde $30.000" />
            </div>
            <ToggleCard
              title="Mostrar productos sin stock"
              text="Aparecen como agotados."
              on={config.showOutOfStock !== false}
              onChange={(v) => update({ showOutOfStock: v })}
            />
          </div>
        </div>

        {/* Productos */}
        <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_30px_-16px_rgba(0,0,0,0.08)]">
          <div data-tour="store-products" className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pb-5 mb-6 border-b border-slate-100">
            <div className="flex items-start gap-3.5">
              <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${accent}14`, color: accent }}>
                <ShoppingBag className="w-5 h-5" />
              </div>
              <div className="pt-0.5">
                <h3 className="text-[15px] font-bold text-slate-900 tracking-tight">Productos en la Tienda</h3>
                <p className="text-[13px] text-slate-500 font-medium mt-1">
                  <span className="font-bold" style={{ color: accent }}>{onlineCount}</span> producto(s) visible(s) actualmente
                </p>
              </div>
            </div>
            <button
              onClick={handleSyncCatalog}
              disabled={isSyncingCatalog}
              className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-white text-[13px] font-bold shadow-sm active:scale-[0.98] transition-all cursor-pointer disabled:opacity-60 shrink-0"
              style={{ backgroundColor: accent }}
            >
              <RefreshCw className={`w-4 h-4 ${isSyncingCatalog ? 'animate-spin' : ''}`} />
              {isSyncingCatalog
                ? (syncProgress && syncProgress.total > 0 ? `Subiendo fotos ${syncProgress.done}/${syncProgress.total}...` : 'Sincronizando...')
                : 'Sincronizar Todo el Inventario'}
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-[1.4fr,1fr,1fr] gap-3 mb-4">
            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Buscar producto por nombre o código..."
                className={`${inputBase} pl-10`}
              />
            </div>
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value)}
              className={inputBase}
            >
              <option value="ALL">Todas las categorías</option>
              {categoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <select
              value={brandFilter}
              onChange={(e) => setBrandFilter(e.target.value)}
              className={inputBase}
            >
              <option value="ALL">Todas las marcas</option>
              {brandOptions.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          </div>

          <div className="max-h-96 overflow-y-auto custom-scrollbar rounded-xl border border-slate-200">
            {isLoadingProducts ? (
              <div className="p-10 flex items-center justify-center text-slate-400 gap-2 text-[13px] font-semibold">
                <Loader2 className="w-4 h-4 animate-spin" /> Cargando productos...
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="p-10 text-center text-slate-400 text-[13px] font-semibold">Sin resultados</div>
            ) : (
              <table className="w-full text-left">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 z-10">
                  <tr className="text-[11.5px] uppercase text-slate-500 font-bold tracking-wide">
                    <th className="py-3 px-4">Producto</th>
                    <th className="py-3 px-4 text-right">Precio</th>
                    <th className="py-3 px-4 text-center">Mostrar en Tienda</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredProducts.slice(0, visibleRows).map((p: any) => (
                    <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="py-3 px-4">
                        <p className="font-semibold text-[13.5px] text-slate-800 truncate max-w-xs">{p.name}</p>
                        <p className="text-[11.5px] text-slate-400 font-medium uppercase mt-0.5">
                          {p.category?.name || 'Sin categoría'}{p.brand?.name ? ` · ${p.brand.name}` : ''}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-right font-bold text-[13.5px] text-slate-700">
                        {new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(p.salePrice)}
                      </td>
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => toggleProductOnline(p)}
                          disabled={pendingToggles.has(p.id)}
                          className="keep-style relative inline-flex h-5 w-10 shrink-0 cursor-pointer rounded-full p-0.5 transition-colors duration-200 ease-in-out disabled:opacity-50"
                          style={{ backgroundColor: p.showOnline ? '#10b981' : '#cbd5e1' }}
                        >
                          <span className={`keep-style pointer-events-none block h-4 w-4 transform rounded-full bg-white shadow-md transition-transform duration-200 ease-in-out ${
                            p.showOnline ? 'translate-x-5' : 'translate-x-0'
                          }`} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!isLoadingProducts && filteredProducts.length > visibleRows && (
              <button
                onClick={() => setVisibleRows((n) => n + 200)}
                className="w-full py-3 text-[13px] font-semibold text-slate-600 hover:bg-slate-50 border-t border-slate-200 cursor-pointer"
              >
                Mostrar más ({filteredProducts.length - visibleRows} restantes)
              </button>
            )}
          </div>
        </div>

        {/* Pedidos Recibidos */}
        <div className="bg-white p-6 sm:p-8 rounded-2xl border border-slate-200 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_10px_30px_-16px_rgba(0,0,0,0.08)]">
          <div className="flex items-start gap-3.5 pb-5 mb-6 border-b border-slate-100">
            <div className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0" style={{ backgroundColor: `${accent}14`, color: accent }}>
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div className="pt-0.5 flex items-center gap-2.5 flex-wrap">
              <h3 className="text-[15px] font-bold text-slate-900 tracking-tight">Pedidos Recibidos</h3>
              {pendingOrdersCount > 0 && (
                <span className="px-2.5 py-1 rounded-full bg-rose-500 text-white text-[11px] font-bold animate-pulse">{pendingOrdersCount} NUEVO(S)</span>
              )}
            </div>
          </div>

          {orders.length === 0 ? (
            <div className="text-center py-10 text-slate-400 font-semibold text-[13.5px]">
              Todavía no llegó ningún pedido por la tienda online
            </div>
          ) : (
            <div className="space-y-2.5">
              {orders.slice(0, 15).map((o) => (
                <div key={o.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-200">
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-500 shrink-0">
                      <UserIcon className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-[13.5px] font-bold text-slate-800 truncate">{o.customerName || 'Cliente Web'}</p>
                      <p className="text-[12px] text-slate-500 font-medium truncate mt-0.5">
                        {o.orderCode ? `#${o.orderCode} · ` : ''}{o.items?.length || 0} producto(s) · {o.customerPhone}
                        {o.delivery ? ` · ${o.delivery === 'DELIVERY' ? 'Envío' : o.delivery === 'GODELIVERY' ? 'GoDelivery' : 'Retira'}` : ''}{o.paymentMethod ? ` · ${o.paymentMethod}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[14px] font-bold text-slate-800">
                      {new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(o.total || 0)}
                    </span>
                    <span className={`text-[10.5px] font-bold px-2.5 py-1 rounded-full uppercase tracking-wide ${
                      !o.stage || o.stage === 'NEW' ? 'bg-rose-50 text-rose-700 border border-rose-200'
                        : o.stage === 'CANCELLED' ? 'bg-slate-100 text-slate-500 border border-slate-200'
                        : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    }`}>
                      {({ NEW: 'Nuevo', PREPARING: 'Preparando', READY: 'Listo', DELIVERED: 'Entregado', CANCELLED: 'Cancelado' } as Record<string, string>)[o.stage || 'NEW']}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <p className="text-[12px] text-slate-400 font-medium flex items-center gap-1.5 mt-4">
            <Clock className="w-3.5 h-3.5" /> Los pedidos se gestionan en la sección Pedidos online (barra lateral o botón Pedidos de la caja).
          </p>
        </div>
      </div>
    </div>
  );
}

const WEEK = [
  { idx: 1, label: 'Lunes' }, { idx: 2, label: 'Martes' }, { idx: 3, label: 'Miércoles' }, { idx: 4, label: 'Jueves' },
  { idx: 5, label: 'Viernes' }, { idx: 6, label: 'Sábado' }, { idx: 0, label: 'Domingo' },
];

function ToggleCard({ title, text, on, onChange }: { title: string; text: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
      <div>
        <p className="text-[14px] font-bold text-slate-800">{title}</p>
        <p className="text-[12.5px] text-slate-500 mt-0.5">{text}</p>
      </div>
      <button
        type="button"
        onClick={() => onChange(!on)}
        className="keep-style relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full p-1 transition-colors"
        style={{ backgroundColor: on ? '#10b981' : '#cbd5e1' }}
        aria-pressed={on}
      >
        <span className={`keep-style block h-5 w-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-5' : 'translate-x-0'}`} />
      </button>
    </div>
  );
}

function MoneyField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="relative flex items-center">
      <span className="absolute left-4 text-[14px] font-semibold text-slate-400">$</span>
      <input
        type="text"
        inputMode="numeric"
        value={value ? String(value) : ''}
        onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)}
        className={`${inputBase} pl-8`}
        placeholder="0"
      />
    </div>
  );
}
