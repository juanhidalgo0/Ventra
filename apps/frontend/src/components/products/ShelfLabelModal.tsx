import { useEffect, useMemo, useRef, useState } from 'react';
import { X, Tag, Printer, Search, Plus, Minus, Trash2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import api, { resolveServerUrl } from '../../services/api';
import { SHELF_FORMATS, buildShelfDocument, type ShelfOptions, type ShelfProduct } from '../../utils/shelfLabels';

interface Item { product: any; quantity: number }

const SETTINGS_KEY = 'shelf_label_settings';
const MAX_LABELS = 1000;

const DEFAULTS = { formatId: 'a4-70x37', showImage: false, showBarcode: false, showUnitPrice: true, showDate: true, showStore: false, offer: false };

function loadSettings(): typeof DEFAULTS {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; } catch { return DEFAULTS; }
}

const toShelf = (p: any, prev?: number | null): ShelfProduct => ({
  id: p.id, name: p.name, salePrice: Number(p.salePrice) || 0, barcode: p.barcode || null,
  imageUrl: p.imageUrl || null, brand: p.brand?.name || null, unit: p.unit || null,
  prevPrice: prev ?? p.prevSalePrice ?? null,
});

/**
 * Etiquetas de góndola (ver utils/shelfLabels): precio grande, nombre, precio por litro o kilo y,
 * si se quiere, foto, código de barras, fecha y el nombre del comercio. Para hojas A4 (comunes o
 * autoadhesivas) o rollos térmicos.
 */
export default function ShelfLabelModal({ onClose, initialProductIds, initialOffer, prevPrices }: {
  onClose: () => void;
  initialProductIds?: string[];
  initialOffer?: boolean;
  /** Precio anterior de cada producto (de "precios que cambiaron"), para tacharlo en las ofertas */
  prevPrices?: Record<string, number | null>;
}) {
  const saved = useMemo(loadSettings, []);
  const [opts, setOpts] = useState({ ...saved, ...(initialOffer !== undefined ? { offer: initialOffer } : {}) });
  const [startAt, setStartAt] = useState(1);
  const [items, setItems] = useState<Item[]>([]);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const format = SHELF_FORMATS.find((f) => f.id === opts.formatId) || SHELF_FORMATS[0];
  const storeName = (() => { try { return localStorage.getItem('gd_store_name') || ''; } catch { return ''; } })();

  useEffect(() => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(opts)); } catch { /* sin espacio */ } }, [opts]);

  // Productos que vienen elegidos (por ejemplo, los que cambiaron de precio)
  useEffect(() => {
    if (!initialProductIds?.length) return;
    let alive = true;
    Promise.all([...new Set(initialProductIds)].map((id) => api.get(`/products/${id}`).then((r) => r.data).catch(() => null)))
      .then((list) => { if (alive) setItems(list.filter(Boolean).map((product) => ({ product, quantity: 1 }))); });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await api.get('/products', { params: { search: search.trim() || undefined, take: 40 } });
        setResults(Array.isArray(data) ? data : data?.data || []);
      } catch { setResults([]); } finally { setSearching(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const add = (product: any) => setItems((prev) => (prev.some((i) => i.product.id === product.id)
    ? prev.map((i) => (i.product.id === product.id ? { ...i, quantity: i.quantity + 1 } : i))
    : [...prev, { product, quantity: 1 }]));
  const setQty = (id: string, q: number) => setItems((prev) => prev.map((i) => (i.product.id === id ? { ...i, quantity: Math.max(1, Math.min(50, q)) } : i)));
  const remove = (id: string) => setItems((prev) => prev.filter((i) => i.product.id !== id));

  const labels = useMemo(() => {
    const out: ShelfProduct[] = [];
    for (const i of items) for (let k = 0; k < i.quantity && out.length < MAX_LABELS; k++) out.push(toShelf(i.product, prevPrices?.[i.product.id]));
    return out;
  }, [items]);

  const shelfOpts: ShelfOptions = { ...opts, storeName, resolveImage: (u) => resolveServerUrl(u) };
  const doc = useMemo(() => buildShelfDocument(labels, format, shelfOpts, format.kind === 'a4' ? startAt : 1), [labels, format, opts, startAt, storeName]);
  const perPage = format.kind === 'a4' ? format.cols! * format.rows! : 1;
  const pages = labels.length ? Math.ceil((labels.length + (format.kind === 'a4' ? startAt - 1 : 0)) / perPage) : 0;

  // La vista previa se achica al ancho del panel (solo en pantalla: lo impreso sale en tamaño real)
  const fitPreview = () => {
    const iframe = iframeRef.current;
    const d = iframe?.contentDocument;
    if (!iframe || !d) return;
    const pageWidthPx = (format.kind === 'a4' ? 210 : format.w) * 3.7795;
    const zoom = Math.min(format.kind === 'a4' ? 1 : 2.5, (iframe.clientWidth - 40) / pageWidthPx);
    const style = d.createElement('style');
    style.media = 'screen';
    style.textContent = `.page { zoom: ${zoom.toFixed(3)}; }`;
    d.head.appendChild(style);
  };

  const print = async () => {
    if (!labels.length) { toast.error('Elegí al menos un producto'); return; }
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    // Que carguen las fotos antes de imprimir
    const imgs = Array.from(win.document.images);
    await Promise.race([
      Promise.all(imgs.map((im) => (im.complete ? null : new Promise((r) => { im.onload = im.onerror = r; })))),
      new Promise((r) => setTimeout(r, 4000)),
    ]);
    win.focus();
    win.print();
  };

  const toggle = (key: keyof typeof DEFAULTS, label: string, hint?: string) => (
    <label className="flex items-start gap-2 text-[12px] text-slate-700 cursor-pointer">
      <input type="checkbox" checked={!!opts[key]} onChange={(e) => setOpts({ ...opts, [key]: e.target.checked })} className="mt-0.5 rounded" />
      <span><span className="font-semibold">{label}</span>{hint && <span className="block text-[10.5px] text-slate-400">{hint}</span>}</span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-7xl h-[92vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200">
        <div className="px-5 py-3 flex items-center justify-between border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center"><Tag className="w-5 h-5" /></div>
            <div>
              <h2 className="text-base font-black tracking-tight text-slate-800">Etiquetas de góndola</h2>
              <p className="text-[11px] text-slate-500">Precio grande, precio por litro o kilo y, si querés, la foto y el código</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 cursor-pointer" title="Cerrar"><X className="w-5 h-5" /></button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Buscar productos */}
          <div className="w-72 border-r border-slate-200 flex flex-col bg-slate-50/60 shrink-0">
            <div className="p-3 space-y-2 border-b border-slate-200 bg-white">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar productos..." autoFocus
                  className="w-full pl-8 pr-2.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-rose-100 focus:border-rose-400" />
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-slate-400">{searching ? 'Buscando…' : `${results.length} resultados`}</span>
                {results.length > 0 && <button onClick={() => results.forEach(add)} className="font-bold text-rose-600 hover:underline cursor-pointer">Agregar todos</button>}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {results.map((p) => (
                <button key={p.id} onClick={() => add(p)} className="w-full text-left p-2 rounded-lg border border-slate-200 bg-white hover:border-rose-300 hover:bg-rose-50/40 flex items-center gap-2 cursor-pointer">
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-slate-800 truncate">{p.name}</span>
                    <span className="block text-[10.5px] text-slate-500">$ {Number(p.salePrice || 0).toLocaleString('es-AR')}</span>
                  </span>
                  <Plus className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                </button>
              ))}
            </div>
          </div>

          {/* Elegidos y opciones */}
          <div className="w-80 border-r border-slate-200 flex flex-col shrink-0">
            <div className="p-3 border-b border-slate-200 space-y-2.5">
              <div>
                <p className="text-[11px] font-bold text-slate-500 mb-1">Tamaño</p>
                <select value={opts.formatId} onChange={(e) => { setOpts({ ...opts, formatId: e.target.value }); setStartAt(1); }}
                  className="w-full h-9 px-2 rounded-lg border border-slate-300 bg-white text-[12.5px] font-semibold text-slate-800">
                  {SHELF_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.name} · {f.description}</option>)}
                </select>
              </div>
              {format.kind === 'a4' && (
                <label className="flex items-center gap-2 text-[12px] text-slate-700">
                  Empezar en la etiqueta
                  <input type="number" min={1} max={perPage} value={startAt} onChange={(e) => setStartAt(Math.max(1, Math.min(perPage, Number(e.target.value) || 1)))}
                    className="w-16 h-8 px-2 rounded-lg border border-slate-300 text-[12px]" />
                  <span className="text-[10.5px] text-slate-400">para usar una hoja empezada</span>
                </label>
              )}
              <div className="grid grid-cols-1 gap-1.5">
                {toggle('showUnitPrice', 'Precio por litro o kilo', 'Lo calcula del nombre (1,5 L, 500 g)')}
                {toggle('showImage', 'Foto del producto')}
                {toggle('showBarcode', 'Código de barras')}
                {toggle('showDate', 'Fecha del precio')}
                {toggle('showStore', 'Nombre del comercio', storeName || 'Cargalo en Configuración')}
                {toggle('offer', 'Estilo oferta', 'Franja roja y precio anterior tachado si bajó')}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {!items.length && <p className="text-center text-[12px] text-slate-400 mt-6 px-4">Buscá productos a la izquierda y tocá para agregarlos.</p>}
              {items.map((i) => (
                <div key={i.product.id} className="p-2 rounded-lg border border-slate-200 bg-white flex items-center gap-2">
                  <span className="min-w-0 flex-1">
                    <span className="block text-xs font-semibold text-slate-800 truncate">{i.product.name}</span>
                    <span className="block text-[10.5px] text-slate-500">$ {Number(i.product.salePrice || 0).toLocaleString('es-AR')}</span>
                  </span>
                  <button onClick={() => setQty(i.product.id, i.quantity - 1)} className="w-6 h-6 rounded border border-slate-200 flex items-center justify-center text-slate-500"><Minus className="w-3 h-3" /></button>
                  <span className="w-5 text-center text-xs font-bold">{i.quantity}</span>
                  <button onClick={() => setQty(i.product.id, i.quantity + 1)} className="w-6 h-6 rounded border border-slate-200 flex items-center justify-center text-slate-500"><Plus className="w-3 h-3" /></button>
                  <button onClick={() => remove(i.product.id)} className="w-6 h-6 rounded flex items-center justify-center text-slate-400 hover:text-rose-600" title="Sacar"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              ))}
            </div>
            <div className="p-3 border-t border-slate-200 flex items-center gap-2">
              <span className="text-[11.5px] text-slate-500 flex-1">{labels.length} {labels.length === 1 ? 'etiqueta' : 'etiquetas'}{pages ? ` · ${pages} ${format.kind === 'a4' ? (pages === 1 ? 'hoja' : 'hojas') : ''}` : ''}</span>
              {items.length > 0 && <button onClick={() => setItems([])} className="text-[11.5px] font-semibold text-slate-500 hover:text-rose-600">Vaciar</button>}
              <button onClick={print} disabled={!labels.length} className="h-9 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[13px] font-bold flex items-center gap-1.5 disabled:opacity-50">
                <Printer className="w-4 h-4" /> Imprimir
              </button>
            </div>
          </div>

          {/* Vista previa */}
          <div className="flex-1 flex flex-col bg-slate-100 min-w-0">
            <iframe ref={iframeRef} title="Vista previa de etiquetas de góndola" srcDoc={doc} onLoad={fitPreview} className="flex-1 w-full border-0" />
          </div>
        </div>
      </div>
    </div>
  );
}
