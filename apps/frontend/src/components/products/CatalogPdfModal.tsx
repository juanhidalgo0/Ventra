import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, Printer, X, Check } from 'lucide-react';
import { usePOSStore, packOf } from '../../stores/posStore';
import { useTradeList, tradeListName, hasFeature } from '../../stores/businessStore';
import { buildCatalogDocument, type CatalogPrices } from '../../utils/catalogSheet';

const PREFS_KEY = 'ventra_catalog_pdf';
const local = (k: string) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const ACCENTS = ['#0f766e', '#be123c', '#1d4ed8', '#7c3aed', '#c2410c', '#111827'];

interface Prefs { prices: CatalogPrices; showImages: boolean; showCodes: boolean; onlyStock: boolean; accent: string; title: string; note: string }
const DEFAULTS: Prefs = { prices: 'RETAIL', showImages: true, showCodes: true, onlyStock: false, accent: '#0f766e', title: 'Catálogo', note: '' };

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

  const store = useMemo(() => ({ name: local('gd_store_name'), logo: local('gd_store_logo') || null, phone: local('gd_store_phone'), address: local('gd_store_address') }), []);

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

  const items = useMemo(() => sellable
    .filter((p: any) => isPicked(p.category?.name || 'Varios'))
    .filter((p: any) => !prefs.onlyStock || p.unlimitedStock || Number(p.stock) > 0)
    .map((p: any) => {
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
      };
    }), [sellable, picked, prefs.onlyStock, prefs.showImages]);

  const prices: CatalogPrices = tradeList ? prefs.prices : 'RETAIL';
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
  const print = () => { const w = frame.current?.contentWindow; if (w) { w.focus(); w.print(); } };
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
            <div className="space-y-1.5">
              <label className="flex items-center gap-2 text-[13px] text-slate-700 cursor-pointer"><input type="checkbox" checked={prefs.showImages} onChange={(e) => set({ showImages: e.target.checked })} className="accent-teal-700" /> Con fotos (si no, lista compacta)</label>
              <label className="flex items-center gap-2 text-[13px] text-slate-700 cursor-pointer"><input type="checkbox" checked={prefs.showCodes} onChange={(e) => set({ showCodes: e.target.checked })} className="accent-teal-700" /> Con código</label>
              <label className="flex items-center gap-2 text-[13px] text-slate-700 cursor-pointer"><input type="checkbox" checked={prefs.onlyStock} onChange={(e) => set({ onlyStock: e.target.checked })} className="accent-teal-700" /> Solo lo que tiene stock</label>
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
