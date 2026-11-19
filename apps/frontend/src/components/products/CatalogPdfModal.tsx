import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Printer, X, Check } from 'lucide-react';
import { usePOSStore, packOf, packForClient, tradeUnitOf } from '../../stores/posStore';
import api from '../../services/api';
import { loadStoreConfig, STORE_ID_KEY } from '../../services/onlineStore';
import { useTradeList, tradeListName, hasFeature } from '../../stores/businessStore';
import { buildCatalogDocument, catalogFileName, type CatalogPrices } from '../../utils/catalogSheet';

const PREFS_KEY = 'ventra_catalog_pdf';
const local = (k: string) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const ACCENTS = ['#0f766e', '#be123c', '#1d4ed8', '#7c3aed', '#c2410c', '#111827'];

interface Prefs { prices: CatalogPrices; showImages: boolean; showCodes: boolean; onlyStock: boolean; onlyOffers: boolean; accent: string; title: string; note: string }
const DEFAULTS: Prefs = { prices: 'RETAIL', showImages: true, showCodes: true, onlyStock: false, onlyOffers: false, accent: '#0f766e', title: 'Catálogo', note: '' };

const TRADE_CLIENT = { priceList: 'TRADE' };
const fmt$ = (n: number) => `$${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;

/** Promos que valen hoy (activas, en fecha y con cupo) */
function livePromo(pr: any, now = Date.now()) {
  if (!pr || pr.isActive === false) return false;
  if (pr.endDate && new Date(pr.endDate).getTime() < now) return false;
  if (pr.startDate && new Date(pr.startDate).getTime() > now) return false;
  if (pr.limitType === 'STOCK' && Number(pr.limitStock) > 0 && Number(pr.soldStock) >= Number(pr.limitStock)) return false;
  return true;
}

/**
 * Las ofertas de un producto escritas para la lista del catálogo: bulto (al mayorista, con su
 * precio), oferta por cantidad y las promos (NxM, % y combos). Con "Los dos", minorista / mayorista.
 * Mismas cuentas que la caja (packForClient, promoForClient).
 */
export function offersFor(p: any, promos: any[], prices: CatalogPrices, bulk: boolean): string[] {
  const out: string[] = [];
  const both = prices === 'BOTH';
  const pair = (retail: number, trade: number) => (both && Math.abs(retail - trade) > 0.5 ? `${fmt$(retail)} / ${fmt$(trade)}` : fmt$(prices === 'TRADE' ? trade : retail));
  const retailUnit = Number(p.salePrice) || 0;
  const tradeUnit = tradeUnitOf(p, TRADE_CLIENT) ?? retailUnit;
  const unit = prices === 'TRADE' ? tradeUnit : retailUnit;
  // Bulto
  const pack = packOf(p, bulk);
  const packOff = Number(p.packDiscount) > 0 && Number(p.packDiscount) < 100 ? Number(p.packDiscount) : 0;
  if (pack) out.push(`Bulto x${pack.size}${packOff ? ` (-${packOff}%)` : ''}: ${pair(pack.price, packForClient(pack, p, TRADE_CLIENT).price)}`);
  // Oferta por cantidad: vale para cualquier cliente, solo si le baja el precio
  const wq = Number(p.wholesaleMinQty), wp = Number(p.wholesalePrice);
  if (wq > 0 && wp > 0 && wp < unit - 0.005) out.push(`Desde ${wq} u.: ${fmt$(wp)} c/u`);
  // Promos de Promociones con este producto
  for (const pr of promos) {
    if (!livePromo(pr)) continue;
    const items: any[] = pr.products || [];
    if (!items.some((x) => String(x.productId) === String(p.id))) continue;
    const groups = new Set(items.map((x) => x.groupId || `single_${x.productId}`));
    if (pr.type === 'NX_M' && Number(pr.nValue) > 0) out.push(`Llevá ${pr.nValue}, pagá ${pr.mValue}`);
    else if (pr.type === 'DISCOUNT_PERCENT') {
      const r = Number(pr.discountPercentage) || 0;
      const t = Number(pr.tradeDiscountPercentage) > 0 ? Number(pr.tradeDiscountPercentage) : r;
      const pct = both && r !== t ? `-${r}% / -${t}%` : `-${prices === 'TRADE' ? t : r}%`;
      if (r > 0 || t > 0) out.push(items.length > 1 ? `${pct} en ${pr.name}` : pct);
    } else if (pr.type === 'FIXED_COMBO' && Number(pr.fixedPrice) > 0) {
      const r = Number(pr.fixedPrice);
      const t = Number(pr.tradeFixedPrice) > 0 ? Number(pr.tradeFixedPrice) : r;
      const qty = Math.max(1, Number(items[0]?.quantity) || 1);
      if (groups.size === 1 && qty > 1) out.push(`${qty} por ${pair(r, t)}${items.length > 1 ? ' (surtidos)' : ''}`);
      else out.push(`Combo ${pr.name}: ${pair(r, t)}`);
    }
  }
  return out.slice(0, 3);
}

/**
 * Catálogo en PDF para los clientes que no usan la tienda online: se eligen las categorías y la
 * lista de precios (minorista, mayorista o las dos), se ve cómo queda y se imprime o se guarda
 * en PDF para mandarlo por WhatsApp.
 */
export default function CatalogPdfModal({ onClose }: { onClose: () => void }) {
  const products = usePOSStore((s) => s.products);
  const tradeList = useTradeList();
  const tradeName = tradeListName();
  const [prefs, setPrefs] = useState<Prefs>(() => {
    try { return { ...DEFAULTS, ...(JSON.parse(local(PREFS_KEY) || '{}') as Partial<Prefs>) }; } catch { return DEFAULTS; }
  });
  useEffect(() => { try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch { /* sin almacenamiento */ } }, [prefs]);
  const set = (p: Partial<Prefs>) => setPrefs((x) => ({ ...x, ...p }));

  // Promociones: las de la caja, o se piden si todavía no se cargaron
  const loadedPromos = usePOSStore((s) => (s.rawPromotions?.length ? s.rawPromotions : s.promotions));
  const [fetchedPromos, setFetchedPromos] = useState<any[] | null>(null);
  useEffect(() => {
    if (loadedPromos?.length) return;
    api.get('/promotions', { silent: true } as any).then(({ data }) => setFetchedPromos(Array.isArray(data) ? data : [])).catch(() => setFetchedPromos([]));
  }, [loadedPromos]);
  const promos = loadedPromos?.length ? loadedPromos : fetchedPromos || [];

  const [onlineLogo, setOnlineLogo] = useState('');
  const store = useMemo(() => ({ name: local('gd_store_name'), logo: local('gd_store_logo') || onlineLogo || null, phone: local('gd_store_phone'), address: local('gd_store_address') }), [onlineLogo]);
  // Sin logo en Configuración → Tu comercio: el de la tienda online, si tiene
  useEffect(() => {
    if (local('gd_store_logo')) return;
    const id = local(STORE_ID_KEY);
    if (!id) return;
    loadStoreConfig(id).then((c) => { if (c?.logoUrl) setOnlineLogo(c.logoUrl); }).catch(() => { /* sin tienda o sin conexión */ });
  }, []);

  // Los productos que se venden (sin los de servicio con precio a mano), por categoría
  const sellable = useMemo(() => (products || []).filter((p: any) => p && p.isActive !== false && Number(p.salePrice) > 0 && !p.allowCustomPrice), [products]);
  const categories = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of sellable) { const c = p.category?.name || 'Varios'; m.set(c, (m.get(c) || 0) + 1); }
    return [...m].sort((a, b) => a[0].localeCompare(b[0], 'es'));
  }, [sellable]);
  const [picked, setPicked] = useState<Set<string> | null>(null); // null = todas
  const isPicked = (c: string) => !picked || picked.has(c);
  const toggle = (c: string) => setPicked((cur) => {
    const next = new Set(cur || categories.map(([n]) => n));
    if (next.has(c)) next.delete(c); else next.add(c);
    return next.size === categories.length ? null : next;
  });

  const prices: CatalogPrices = tradeList ? prefs.prices : 'RETAIL';
  const items = useMemo(() => sellable
    .filter((p: any) => isPicked(p.category?.name || 'Varios'))
    .filter((p: any) => !prefs.onlyStock || p.unlimitedStock || Number(p.stock) > 0)
    .map((p: any) => ({ p, offers: offersFor(p, promos, prices, hasFeature('bulk')) }))
    // "Solo ofertas": un volante con lo que tiene promo, oferta por cantidad o bulto
    .filter(({ offers }) => !prefs.onlyOffers || offers.length > 0)
    .map(({ p, offers }) => {
      const pack = packOf(p, hasFeature('bulk'));
      return {
        name: p.name,
        category: p.category?.name || 'Varios',
        brand: p.brand?.name || null,
        code: p.sku || p.barcode || null,
        image: prefs.showImages && p.imageUrl ? p.imageUrl : null,
        price: Number(p.salePrice) || 0,
        tradePrice: Number(p.tradePrice) > 0 ? Number(p.tradePrice) : null,
        pack: pack ? { size: pack.size, price: pack.price } : null,
        offers,
      };
    }), [sellable, picked, prefs.onlyStock, prefs.onlyOffers, prefs.showImages, promos, prices]);

  const doc = useMemo(() => buildCatalogDocument(items, {
    title: prefs.title || 'Catálogo', storeName: store.name, logo: store.logo, phone: store.phone, address: store.address,
    accent: prefs.accent, showImages: prefs.showImages, showCodes: prefs.showCodes, prices, tradeName, note: prefs.note.trim() || undefined,
  }), [items, prefs, prices, tradeName, store]);

  const frame = useRef<HTMLIFrameElement>(null);
  const fit = () => {
    const d = frame.current?.contentDocument;
    if (!frame.current || !d) return;
    const zoom = Math.min(1, (frame.current.clientWidth - 40) / (210 * 3.7795));
    (d.body.style as any).zoom = String(zoom);
  };
  // El PDF se guarda con el nombre del comercio y la fecha: el navegador usa el título de la página
  const print = () => {
    const w = frame.current?.contentWindow;
    if (!w) return;
    const name = catalogFileName({ title: prefs.title, storeName: store.name, prices, tradeName });
    const before = document.title;
    try { w.document.title = name; } catch { /* sin acceso */ }
    document.title = name;
    const restore = () => { document.title = before; window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    w.focus();
    w.print();
    setTimeout(restore, 1500);
  };
  const pages = (doc.match(/class="page"/g) || []).length;

  const chip = (on: boolean) => `px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border cursor-pointer ${on ? 'bg-teal-700 text-white border-teal-700' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`;
  return (
    <div className="fixed inset-0 z-[120] bg-slate-900/50 flex items-center justify-center p-3" onClick={onClose}>
      <div className="w-full max-w-6xl h-[92vh] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <BookOpen className="w-5 h-5 text-teal-700" />
            <div>
              <h3 className="text-base font-bold text-slate-800">Catálogo en PDF</h3>
              <p className="text-[12px] text-slate-500">Para mandar por WhatsApp a los clientes que no usan la tienda online</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 cursor-pointer"><X className="w-4 h-4 text-slate-500" /></button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          <div className="md:w-80 shrink-0 border-b md:border-b-0 md:border-r border-slate-200 p-4 space-y-4 overflow-y-auto">
            {tradeList && (
              <div>
                <p className="text-[12px] font-bold text-slate-600 mb-1.5">Precios</p>
                <div className="flex flex-wrap gap-1.5">
                  <button className={chip(prefs.prices === 'RETAIL')} onClick={() => set({ prices: 'RETAIL' })}>Minorista</button>
                  <button className={chip(prefs.prices === 'TRADE')} onClick={() => set({ prices: 'TRADE' })}>{tradeName}</button>
                  <button className={chip(prefs.prices === 'BOTH')} onClick={() => set({ prices: 'BOTH' })}>Los dos</button>
                </div>
              </div>
            )}
            <div>
              <p className="text-[12px] font-bold text-slate-600 mb-1.5">Título</p>
              <input value={prefs.title} onChange={(e) => set({ title: e.target.value.slice(0, 60) })} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm" placeholder="Catálogo" />
              <input value={prefs.note} onChange={(e) => set({ note: e.target.value.slice(0, 160) })} className="mt-1.5 w-full px-3 py-2 rounded-lg border border-slate-300 text-[12.5px]" placeholder="Aclaración (opcional): pedido mínimo, días de reparto…" />
            </div>
            <div>
              <p className="text-[12px] font-bold text-slate-600 mb-1.5">Formato</p>
              <div className="flex flex-wrap gap-1.5">
                <button className={chip(prefs.showImages)} onClick={() => set({ showImages: true })}>Con fotos</button>
                <button className={chip(!prefs.showImages)} onClick={() => set({ showImages: false })}>Lista sin fotos</button>
              </div>
              <p className="text-[11.5px] text-slate-500 mt-1">{prefs.showImages ? '15 productos por hoja, en tarjetas.' : 'Hasta 80 productos por hoja: más liviano para WhatsApp.'}</p>
            </div>
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-[13px] text-slate-700 cursor-pointer"><input type="checkbox" checked={prefs.showCodes} onChange={(e) => set({ showCodes: e.target.checked })} className="accent-teal-700" /> Con código</label>
              <label className="flex items-center gap-2 text-[13px] text-slate-700 cursor-pointer"><input type="checkbox" checked={prefs.onlyStock} onChange={(e) => set({ onlyStock: e.target.checked })} className="accent-teal-700" /> Solo lo que tiene stock</label>
              <label className="flex items-center gap-2 text-[13px] text-slate-700 cursor-pointer"><input type="checkbox" checked={prefs.onlyOffers} onChange={(e) => set({ onlyOffers: e.target.checked })} className="accent-teal-700" /> Solo productos en oferta</label>
            </div>
            <div>
              <p className="text-[12px] font-bold text-slate-600 mb-1.5">Color</p>
              <div className="flex gap-1.5">
                {ACCENTS.map((c) => (
                  <button key={c} onClick={() => set({ accent: c })} className="w-7 h-7 rounded-full border-2 cursor-pointer flex items-center justify-center" style={{ background: c, borderColor: prefs.accent === c ? '#0f172a' : 'transparent' }} aria-label={`Color ${c}`}>
                    {prefs.accent === c && <Check className="w-3.5 h-3.5 text-white" />}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[12px] font-bold text-slate-600">Categorías</p>
                <button onClick={() => setPicked(picked ? null : new Set())} className="text-[11.5px] font-semibold text-teal-700 cursor-pointer">{picked ? 'Todas' : 'Ninguna'}</button>
              </div>
              <div className="space-y-1 max-h-60 overflow-y-auto pr-1">
                {categories.map(([c, n]) => (
                  <label key={c} className="flex items-center gap-2 text-[12.5px] text-slate-700 cursor-pointer">
                    <input type="checkbox" checked={isPicked(c)} onChange={() => toggle(c)} className="accent-teal-700" />
                    <span className="flex-1 truncate">{c}</span><span className="text-slate-400">{n}</span>
                  </label>
                ))}
              </div>
            </div>
            <p className="text-[11.5px] text-slate-500">
              Lleva {store.logo ? 'el logo, ' : ''}{store.name ? `el nombre (${store.name})` : 'el nombre del comercio'}{store.phone ? ' y tu WhatsApp' : ''}: se cambian en Configuración → Tu comercio.
            </p>
          </div>
          <div className="flex-1 min-w-0 flex flex-col bg-slate-100">
            <iframe ref={frame} title="Catálogo" srcDoc={doc} onLoad={fit} className="flex-1 w-full border-0" />
            <div className="flex items-center justify-between gap-2 px-4 py-3 bg-white border-t border-slate-200">
              <span className="text-[12.5px] text-slate-600">{items.length} productos · {pages} {pages === 1 ? 'hoja' : 'hojas'}</span>
              <button onClick={print} disabled={!items.length} className="h-10 px-4 rounded-xl bg-teal-700 hover:bg-teal-800 text-white text-[13px] font-bold flex items-center gap-1.5 cursor-pointer disabled:opacity-50">
                <Printer className="w-4 h-4" /> Imprimir o guardar PDF
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
