import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { X, Barcode, Printer, Search, Plus, Minus, Trash2, Wand2, RefreshCw, Info } from 'lucide-react';
import { useFeature } from '../../stores/businessStore';
import { variantsOfGroup } from '../../utils/variants';
import { toast } from 'react-hot-toast';
import api from '../../services/api';
import { LABEL_FORMATS, buildLabelsDocument, type LabelOptions } from '../../utils/barcodeLabels';

export interface LabelSeedItem {
  productId: string;
  quantity: number;
  /** Purchase line bought by the pack: quantity gets multiplied by the product's units per pack. */
  buyFormat?: string;
}

interface BarcodeLabelModalProps {
  onClose: () => void;
  /** Pre-load products (e.g. the items of a purchase) with their label quantities. */
  initialItems?: LabelSeedItem[];
  title?: string;
  /** Called after internal barcodes were saved, so the caller can refresh its list. */
  onBarcodesAssigned?: () => void;
}

interface SelectedItem {
  product: any;
  quantity: number;
}

const SETTINGS_KEY = 'barcode_label_settings';
const MAX_LABELS = 2000;

function loadSettings(): { formatId: string; showName: boolean; showPrice: boolean } {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { formatId: 'a4-plain-48x25', showName: true, showPrice: false, ...JSON.parse(raw) };
  } catch {}
  // El precio no viene por defecto: cambia seguido y obligaría a reimprimir las etiquetas
  return { formatId: 'a4-plain-48x25', showName: true, showPrice: false };
}

export default function BarcodeLabelModal({ onClose, initialItems, title, onBarcodesAssigned }: BarcodeLabelModalProps) {
  const useVariants = useFeature('variants');
  const initialSettings = useMemo(loadSettings, []);
  const [formatId, setFormatId] = useState(initialSettings.formatId);
  const [showName, setShowName] = useState(initialSettings.showName);
  const [showPrice, setShowPrice] = useState(initialSettings.showPrice);
  const [startPosition, setStartPosition] = useState(1);

  const [items, setItems] = useState<SelectedItem[]>([]);
  const [search, setSearch] = useState('');
  const [onlyWithoutBarcode, setOnlyWithoutBarcode] = useState(!initialItems);
  const [results, setResults] = useState<any[]>([]);
  const [withoutBarcodeCount, setWithoutBarcodeCount] = useState<number | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [isLoadingSeed, setIsLoadingSeed] = useState(Boolean(initialItems?.length));

  const iframeRef = useRef<HTMLIFrameElement>(null);

  const format = LABEL_FORMATS.find((f) => f.id === formatId) || LABEL_FORMATS[0];

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({ formatId, showName, showPrice }));
    } catch {}
  }, [formatId, showName, showPrice]);

  // Pre-load seeded items (e.g. from a purchase), once on open
  useEffect(() => {
    if (!initialItems?.length) return;
    let cancelled = false;
    (async () => {
      const ids = [...new Set(initialItems.map((it) => it.productId))];
      const products = await Promise.all(
        ids.map((id) => api.get(`/products/${id}`).then((r) => r.data).catch(() => null)),
      );
      if (cancelled) return;
      const byId = new Map(products.filter(Boolean).map((p: any) => [p.id, p]));
      const units = new Map<string, number>();
      for (const it of initialItems) {
        const product = byId.get(it.productId);
        if (!product) continue;
        const perPack = it.buyFormat === 'PACK' && product.presentationType === 'PACK' ? product.unitsPerPack || 1 : 1;
        units.set(it.productId, (units.get(it.productId) || 0) + it.quantity * perPack);
      }
      setItems(
        [...units.entries()].map(([id, qty]) => ({ product: byId.get(id), quantity: Math.max(1, Math.min(999, Math.ceil(qty))) })),
      );
      setIsLoadingSeed(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refreshWithoutBarcodeCount = async () => {
    try {
      const { data } = await api.get('/products/count', { params: { noBarcode: 'true' } });
      setWithoutBarcodeCount(typeof data === 'number' ? data : data?.count ?? null);
    } catch {}
  };

  useEffect(() => { refreshWithoutBarcodeCount(); }, []);

  // Product search (debounced)
  useEffect(() => {
    const t = setTimeout(async () => {
      setIsSearching(true);
      try {
        const { data } = await api.get('/products', {
          params: {
            search: search.trim() || undefined,
            noBarcode: onlyWithoutBarcode ? 'true' : undefined,
            take: 40,
          },
        });
        setResults(Array.isArray(data) ? data : data?.data || []);
      } catch {
        setResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [search, onlyWithoutBarcode]);

  const addProduct = (product: any, quantity = 1) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.product.id === product.id);
      if (existing) {
        return prev.map((i) => (i.product.id === product.id ? { ...i, quantity: i.quantity + quantity } : i));
      }
      return [...prev, { product, quantity }];
    });
  };

  const setQuantity = (id: string, quantity: number) => {
    setItems((prev) => prev.map((i) => (i.product.id === id ? { ...i, quantity: Math.max(1, Math.min(999, quantity || 1)) } : i)));
  };

  const removeItem = (id: string) => setItems((prev) => prev.filter((i) => i.product.id !== id));

  const addAllResults = () => {
    results.forEach((p) => addProduct(p, 1));
  };

  /**
   * Indumentaria: cargar el modelo entero de una, con tantas etiquetas como unidades
   * haya en stock de cada talle, que es lo que se necesita al recibir la temporada.
   */
  const addWholeModel = async (product: any) => {
    let hermanas = variantsOfGroup(results, product.variantGroupId);
    if (hermanas.length <= 1) {
      try {
        const { data } = await api.get(`/products/variant-group/${product.variantGroupId}`);
        if (Array.isArray(data)) hermanas = data;
      } catch {
        hermanas = [product];
      }
    }
    hermanas.forEach((v: any) => addProduct(v, Math.max(1, Math.min(999, Math.ceil(v.stock || 1)))));
  };

  const setQuantitiesToStock = () => {
    setItems((prev) => prev.map((i) => ({ ...i, quantity: Math.max(1, Math.min(999, Math.ceil(i.product.stock || 1))) })));
  };

  const missingBarcodeItems = items.filter((i) => !i.product.barcode);

  const assignInternalBarcodes = async () => {
    if (missingBarcodeItems.length === 0) return;
    setIsAssigning(true);
    try {
      const { data } = await api.post('/products/internal-barcode/assign', {
        ids: missingBarcodeItems.map((i) => i.product.id),
      });
      const byId = new Map<string, string>(data.products.map((p: any) => [p.id, p.barcode]));
      setItems((prev) => prev.map((i) => (byId.has(i.product.id) ? { ...i, product: { ...i.product, barcode: byId.get(i.product.id) } } : i)));
      setResults((prev) => (onlyWithoutBarcode ? prev.filter((p) => !byId.has(p.id)) : prev.map((p) => (byId.has(p.id) ? { ...p, barcode: byId.get(p.id) } : p))));
      toast.success(`Se asignaron ${data.assigned} códigos internos`);
      refreshWithoutBarcodeCount();
      onBarcodesAssigned?.();
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudieron generar los códigos');
    } finally {
      setIsAssigning(false);
    }
  };

  const labels = useMemo(() => {
    const list: any[] = [];
    for (const i of items) {
      if (!i.product.barcode) continue;
      for (let n = 0; n < i.quantity; n++) list.push(i.product);
    }
    return list;
  }, [items]);

  const tooMany = labels.length > MAX_LABELS;

  const options: LabelOptions = { showName, showPrice, startPosition: startPosition - 1 };

  const documentHtml = useMemo(
    () => buildLabelsDocument(tooMany ? labels.slice(0, MAX_LABELS) : labels, format, options),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [labels, format, showName, showPrice, startPosition, tooMany],
  );

  const perPage = format.kind === 'a4' ? format.cols! * format.rows! : 1;
  const pageCount = labels.length === 0 ? 0 : Math.ceil((labels.length + (format.kind === 'a4' ? startPosition - 1 : 0)) / perPage);

  // Shrink the preview to the panel width. Injected as a screen-only stylesheet so the
  // printed output is never scaled.
  const fitPreview = () => {
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!iframe || !doc) return;
    const pageWidthPx = (format.kind === 'a4' ? 210 : format.labelW) * 3.7795;
    const zoom = Math.min(format.kind === 'a4' ? 1 : 2.5, (iframe.clientWidth - 40) / pageWidthPx);
    const style = doc.createElement('style');
    style.media = 'screen';
    style.textContent = `.page { zoom: ${zoom.toFixed(3)}; }`;
    doc.head.appendChild(style);
  };

  const handlePrint = () => {
    if (labels.length === 0) {
      toast.error('No hay etiquetas para imprimir');
      return;
    }
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    win.focus();
    win.print();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="bg-white w-full max-w-7xl h-[92vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-slate-200"
      >
        {/* Header */}
        <div className="px-5 py-3 flex items-center justify-between border-b border-slate-200 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Barcode className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black tracking-tight text-slate-800">{title || 'Etiquetas con código de barras'}</h2>
              <p className="text-[11px] text-slate-500">Generá códigos internos para productos sin código e imprimí etiquetas escaneables</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-slate-100 text-slate-500 cursor-pointer" title="Cerrar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Column 1: product search */}
          <div className="w-72 border-r border-slate-200 flex flex-col bg-slate-50/60 shrink-0">
            <div className="p-3 space-y-2 border-b border-slate-200 bg-white">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar productos..."
                  className="w-full pl-8 pr-2.5 py-2 bg-slate-50 border border-slate-300 rounded-lg text-xs outline-none focus:ring-2 focus:ring-emerald-100 focus:border-emerald-400"
                />
              </div>
              <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-700 cursor-pointer">
                <input type="checkbox" checked={onlyWithoutBarcode} onChange={(e) => setOnlyWithoutBarcode(e.target.checked)} className="rounded" />
                Solo sin código de barras
                {withoutBarcodeCount !== null && (
                  <span className="ml-auto px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">{withoutBarcodeCount}</span>
                )}
              </label>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-slate-400">{isSearching ? 'Buscando…' : `${results.length} resultados${results.length === 40 ? ' (máx.)' : ''}`}</span>
                {results.length > 0 && (
                  <button onClick={addAllResults} className="font-bold text-emerald-600 hover:underline cursor-pointer">Agregar todos</button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
              {results.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addProduct(p)}
                  className="w-full text-left p-2 rounded-lg border border-slate-200 bg-white hover:border-emerald-400 hover:bg-emerald-50/40 transition-colors flex items-center gap-2 cursor-pointer"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-800 truncate">{p.name}</p>
                    <p className={`text-[10px] font-mono ${p.barcode ? 'text-slate-500' : 'text-amber-600 font-sans font-semibold'}`}>
                      {p.barcode || 'Sin código'}
                    </p>
                  </div>
                  {useVariants && p.variantGroupId && (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => { e.stopPropagation(); addWholeModel(p); }}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); addWholeModel(p); } }}
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100 shrink-0 cursor-pointer"
                      title="Agregar todos los talles de este modelo, una etiqueta por unidad en stock"
                    >
                      Todo el modelo
                    </span>
                  )}
                  <Plus className="w-4 h-4 text-emerald-600 shrink-0" />
                </button>
              ))}
              {!isSearching && results.length === 0 && (
                <p className="text-center text-[11px] text-slate-400 py-8">
                  {onlyWithoutBarcode ? 'No hay productos sin código' : 'Sin resultados'}
                </p>
              )}
            </div>
          </div>

          {/* Column 2: selected items + settings */}
          <div className="w-96 border-r border-slate-200 flex flex-col shrink-0">
            <div className="p-3 border-b border-slate-200 space-y-2.5">
              <div>
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block mb-1">Formato de etiqueta</span>
                <select
                  value={formatId}
                  onChange={(e) => setFormatId(e.target.value)}
                  className="w-full bg-white border border-slate-300 rounded-lg px-2.5 py-2 text-xs font-semibold text-slate-800 outline-none focus:border-emerald-400"
                >
                  <optgroup label="Impresora común (hoja A4)">
                    {LABEL_FORMATS.filter((f) => f.kind === 'a4').map((f) => (
                      <option key={f.id} value={f.id}>{f.name} — {f.description}</option>
                    ))}
                  </optgroup>
                  <optgroup label="Impresora térmica de etiquetas">
                    {LABEL_FORMATS.filter((f) => f.kind === 'thermal').map((f) => (
                      <option key={f.id} value={f.id}>{f.name} — {f.description}</option>
                    ))}
                  </optgroup>
                </select>
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] font-semibold text-slate-700">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} className="rounded" /> Nombre
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={showPrice} onChange={(e) => setShowPrice(e.target.checked)} className="rounded" /> Precio
                </label>
                {format.kind === 'a4' && (
                  <label className="flex items-center gap-1.5" title="Para reutilizar una hoja autoadhesiva que ya usaste en parte">
                    Empezar en la etiqueta
                    <input
                      type="number"
                      min={1}
                      max={perPage}
                      value={startPosition}
                      onChange={(e) => setStartPosition(Math.max(1, Math.min(perPage, Number(e.target.value) || 1)))}
                      className="w-14 border border-slate-300 rounded-md px-1.5 py-1 text-xs"
                    />
                  </label>
                )}
              </div>
            </div>

            {missingBarcodeItems.length > 0 && (
              <div className="mx-3 mt-3 p-2.5 rounded-xl bg-amber-50 border border-amber-200 flex items-center gap-2">
                <Info className="w-4 h-4 text-amber-600 shrink-0" />
                <p className="text-[11px] text-amber-900 flex-1 leading-snug">
                  <b>{missingBarcodeItems.length}</b> producto(s) no tienen código y no se van a imprimir.
                </p>
                <button
                  onClick={assignInternalBarcodes}
                  disabled={isAssigning}
                  className="px-2.5 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-60 whitespace-nowrap"
                >
                  {isAssigning ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
                  Generar códigos
                </button>
              </div>
            )}

            <div className="px-3 pt-3 pb-1 flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Productos ({items.length})</span>
              {items.length > 0 && (
                <div className="flex items-center gap-3 text-[10px] font-bold">
                  <button onClick={setQuantitiesToStock} className="text-emerald-600 hover:underline cursor-pointer" title="Una etiqueta por unidad en stock">
                    Cantidad = stock
                  </button>
                  <button onClick={() => setItems([])} className="text-rose-600 hover:underline cursor-pointer">Quitar todos</button>
                </div>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-3 pb-3 space-y-1.5 custom-scrollbar">
              {isLoadingSeed && (
                <p className="text-center text-[11px] text-slate-400 py-8 flex items-center justify-center gap-2">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Cargando productos…
                </p>
              )}
              {items.map(({ product, quantity }) => (
                <div key={product.id} className="p-2 rounded-lg border border-slate-200 bg-white flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-slate-800 truncate">{product.name}</p>
                    <p className={`text-[10px] ${product.barcode ? 'font-mono text-slate-500' : 'font-semibold text-amber-600'}`}>
                      {product.barcode || 'Sin código'}
                    </p>
                  </div>
                  <div className="flex items-center border border-slate-300 rounded-lg overflow-hidden shrink-0">
                    <button onClick={() => setQuantity(product.id, quantity - 1)} className="px-1.5 py-1 hover:bg-slate-100 cursor-pointer" title="Menos">
                      <Minus className="w-3 h-3" />
                    </button>
                    <input
                      type="number"
                      min={1}
                      value={quantity}
                      onChange={(e) => setQuantity(product.id, Number(e.target.value))}
                      className="w-10 text-center text-xs font-bold outline-none"
                    />
                    <button onClick={() => setQuantity(product.id, quantity + 1)} className="px-1.5 py-1 hover:bg-slate-100 cursor-pointer" title="Más">
                      <Plus className="w-3 h-3" />
                    </button>
                  </div>
                  <button onClick={() => removeItem(product.id)} className="p-1 text-slate-400 hover:text-rose-600 cursor-pointer" title="Quitar">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
              {!isLoadingSeed && items.length === 0 && (
                <p className="text-center text-[11px] text-slate-400 py-10">Agregá productos desde la lista de la izquierda</p>
              )}
            </div>

            <div className="p-3 border-t border-slate-200 bg-slate-50 space-y-2">
              <div className="flex items-center justify-between text-[11px] text-slate-600">
                <span><b className="text-slate-800">{labels.length}</b> etiquetas</span>
                <span>{pageCount} {format.kind === 'a4' ? (pageCount === 1 ? 'hoja' : 'hojas') : 'en rollo'}</span>
              </div>
              {tooMany && (
                <p className="text-[10px] text-rose-600 font-semibold">Máximo {MAX_LABELS} etiquetas por impresión. Se imprimirán las primeras {MAX_LABELS}.</p>
              )}
              <button
                onClick={handlePrint}
                disabled={labels.length === 0}
                className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Printer className="w-4 h-4" /> Imprimir etiquetas
              </button>
              <p className="text-[10px] text-slate-500 leading-snug">
                En el diálogo de impresión elegí <b>Márgenes: Ninguno</b> y <b>Escala: 100%</b>
                {format.kind === 'thermal' ? ', y el tamaño de papel de tu impresora térmica.' : '.'}
              </p>
            </div>
          </div>

          {/* Column 3: live preview (same document that gets printed) */}
          <div className="flex-1 flex flex-col bg-slate-200 min-w-0">
            <div className="px-3 py-2 text-[10px] font-bold text-slate-600 uppercase tracking-wider border-b border-slate-300 bg-slate-100">
              Vista previa
            </div>
            <iframe ref={iframeRef} title="Vista previa de etiquetas" srcDoc={documentHtml} onLoad={fitPreview} className="flex-1 w-full border-0" />
          </div>
        </div>
      </motion.div>
    </div>
  );
}
