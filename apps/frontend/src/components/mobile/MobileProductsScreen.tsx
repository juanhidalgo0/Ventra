import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Search, Plus, X, Package, ScanLine, Minus, Star, ChevronRight, AlertTriangle } from 'lucide-react';
import api, { resolveServerUrl } from '../../services/api';
import { usePOSStore } from '../../stores/posStore';
import { useBusinessStore } from '../../stores/businessStore';
import { ScreenHeader, headerInput, Chips, Sheet, PrimaryButton, MoneyInput, EmptyState, money, qty, parseAmount } from './ui';
import BarcodeScanner, { canScanBarcodes } from './BarcodeScanner';

type Filter = 'ALL' | 'LOW' | 'OUT';
const PAGE = 50;
/** Productos virtuales (cargas, venta rápida) tienen stock "infinito": no se muestran como mercadería. */
const hasStock = (p: any) => typeof p.stock === 'number' && p.stock < 99999;

/** También es "Control de stock" (desde Más): arranca filtrado en stock bajo, con botón volver. */
export default function MobileProductsScreen({ initialFilter = 'ALL', title = 'Productos', back = false }: { initialFilter?: Filter; title?: string; back?: boolean }) {
  const products = usePOSStore((s) => s.products);
  const setProducts = usePOSStore((s) => s.setProducts);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [lowIds, setLowIds] = useState<Map<string, number>>(new Map());
  const [limit, setLimit] = useState(PAGE);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [scanning, setScanning] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const loadLow = useCallback(() => {
    api.get('/products/low-stock-ids')
      .then(({ data }) => setLowIds(new Map((data || []).map((r: any) => [r.id, r.minStock]))))
      .catch(() => {});
  }, []);
  useEffect(() => { loadLow(); }, [loadLow]);

  const catalog = useMemo(() => products.filter((p: any) => hasStock(p) || !String(p.id).startsWith('VIRTUAL')), [products]);
  const outCount = useMemo(() => catalog.filter((p: any) => hasStock(p) && p.stock <= 0).length, [catalog]);

  const filtered = useMemo(() => {
    const terms = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const list = catalog.filter((p: any) => {
      if (filter === 'LOW' && !lowIds.has(p.id)) return false;
      if (filter === 'OUT' && !(hasStock(p) && p.stock <= 0)) return false;
      if (!terms.length) return true;
      const token = p._searchToken || p.name?.toLowerCase() || '';
      return terms.every((t) => token.includes(t));
    });
    return filter === 'ALL' && !terms.length ? [...list].sort((a: any, b: any) => (a.name || '').localeCompare(b.name || '', 'es')) : list;
  }, [catalog, search, filter, lowIds]);

  useEffect(() => { setLimit(PAGE); listRef.current?.scrollTo({ top: 0 }); }, [search, filter]);

  const patchLocal = (id: string, changes: any) => {
    setProducts(usePOSStore.getState().products.map((p: any) => (p.id === id ? { ...p, ...changes } : p)));
  };

  const onCode = useCallback((code: string) => {
    setScanning(false);
    const c = code.trim().toUpperCase();
    const p = usePOSStore.getState().products.find((x: any) =>
      (x.barcode || '').toUpperCase() === c || (x.sku || '').toUpperCase() === c ||
      x.additionalBarcodes?.some((b: any) => (b.barcode || '').toUpperCase() === c));
    if (p) setSelectedId(p.id);
    else { setSearch(code); toast(`No hay un producto con el código ${code}`); }
  }, []);

  return (
    <div className="flex-1 min-h-0 flex flex-col relative">
      <ScreenHeader
        back={back}
        title={title}
        subtitle={`${catalog.length} productos`}
        action={
          <button onClick={() => setCreating(true)} className="h-10 px-3.5 rounded-full bg-orange-200 text-orange-900 flex items-center gap-1.5 shrink-0 active:scale-95 transition-transform">
            <Plus className="w-[18px] h-[18px]" />
            <span className="text-[13px] font-semibold">Nuevo</span>
          </button>
        }
      >
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 inset-y-0 my-auto w-[18px] h-[18px] text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nombre o código"
              className={`${headerInput} pl-10 pr-9`}
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-1.5 inset-y-0 my-auto w-7 h-7 flex items-center justify-center" aria-label="Borrar búsqueda">
                <X className="w-4 h-4 text-slate-400" />
              </button>
            )}
          </div>
          {canScanBarcodes() && (
            <button onClick={() => setScanning(true)} className="w-11 h-11 rounded-2xl bg-white/15 ring-1 ring-inset ring-white/20 flex items-center justify-center" aria-label="Buscar escaneando">
              <ScanLine className="w-5 h-5 text-white" />
            </button>
          )}
        </div>
        <div className="mt-3">
          <Chips<Filter>
            options={[
              { id: 'ALL', label: 'Todos' },
              { id: 'LOW', label: 'Stock bajo', count: lowIds.size },
              { id: 'OUT', label: 'Sin stock', count: outCount },
            ]}
            value={filter}
            onChange={setFilter}
          />
        </div>
      </ScreenHeader>

      <div
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight > el.scrollHeight - 600 && limit < filtered.length) setLimit((l) => l + PAGE);
        }}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain"
      >
        {filtered.length === 0 ? (
          <EmptyState
            icon={filter === 'ALL' ? Package : AlertTriangle}
            title={products.length === 0 ? 'Cargando productos…' : filter === 'LOW' ? 'Ningún producto con stock bajo' : filter === 'OUT' ? 'No hay productos sin stock' : 'No encontramos productos'}
            text={search ? `Nada coincide con “${search}”.` : undefined}
          />
        ) : (
          <div className="px-4 py-3">
            <div className="bg-white rounded-2xl border border-slate-200/80 divide-y divide-slate-100 overflow-hidden">
              {filtered.slice(0, limit).map((p: any) => (
                <ProductRow key={p.id} product={p} low={lowIds.has(p.id)} onClick={() => setSelectedId(p.id)} />
              ))}
            </div>
          </div>
        )}
      </div>

      <ProductSheet
        productId={selectedId}
        onClose={() => setSelectedId(null)}
        onChanged={(id, changes) => { patchLocal(id, changes); loadLow(); }}
      />
      <NewProductSheet
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(p) => {
          setCreating(false);
          const barcodes = [p.barcode].filter(Boolean);
          setProducts([
            { ...p, imageUrl: resolveServerUrl(p.imageUrl), _searchToken: `${p.name.toLowerCase()} ${p.sku?.toLowerCase() || ''} ${barcodes.join(' ')}`.trim() },
            ...usePOSStore.getState().products,
          ]);
          loadLow();
        }}
      />
      {scanning && <BarcodeScanner onCode={onCode} onClose={() => setScanning(false)} />}
    </div>
  );
}

function ProductRow({ product: p, low, onClick }: { product: any; low: boolean; onClick: () => void }) {
  const [imgOk, setImgOk] = useState(true);
  const out = hasStock(p) && p.stock <= 0;
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-3 py-2.5 text-left active:bg-slate-50">
      <span className="w-12 h-12 rounded-xl bg-slate-50 overflow-hidden flex items-center justify-center shrink-0">
        {p.imageUrl && imgOk
          ? <img src={p.imageUrl} alt="" loading="lazy" onError={() => setImgOk(false)} className="w-full h-full object-cover" />
          : <span className="text-[18px] font-bold text-rose-200">{(p.name || '?').trim()[0]}</span>}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[14px] font-medium text-slate-800 leading-snug line-clamp-2">{p.name}</span>
        {hasStock(p) && (
          <span className={`inline-block mt-0.5 text-[11.5px] font-medium ${out ? 'text-red-600' : low ? 'text-amber-700' : 'text-slate-500'}`}>
            {out ? 'Sin stock' : `${qty(p.stock)} en stock`}{low && !out ? ' · bajo' : ''}
          </span>
        )}
      </span>
      <span className="text-[15px] font-bold text-slate-900 tabular-nums shrink-0">{money(p.salePrice)}</span>
      <ChevronRight className="w-4 h-4 text-slate-300 shrink-0" />
    </button>
  );
}

function ProductSheet({ productId, onClose, onChanged }: { productId: string | null; onClose: () => void; onChanged: (id: string, changes: any) => void }) {
  const [product, setProduct] = useState<any | null>(null);
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [delta, setDelta] = useState(0);
  const [savingPrice, setSavingPrice] = useState(false);
  const [savingStock, setSavingStock] = useState(false);
  const [savingCategory, setSavingCategory] = useState(false);
  const [desc, setDesc] = useState('');
  const [savingDesc, setSavingDesc] = useState(false);

  useEffect(() => {
    if (!productId) return;
    setProduct(null); setDelta(0);
    api.get(`/products/${productId}`)
      .then(({ data }) => {
        setProduct(data);
        setDesc(data.description || '');
        setPrice(String(data.salePrice ?? ''));
        setCost(String(data.costPrice ?? ''));
      })
      .catch(() => { toast.error('No pudimos abrir el producto'); onClose(); });
  }, [productId]);

  const priceValue = parseAmount(price);
  const costValue = parseAmount(cost);
  const margin = priceValue > 0 && costValue > 0 ? Math.round(((priceValue - costValue) / costValue) * 100) : null;
  const priceChanged = product && (priceValue !== product.salePrice || costValue !== product.costPrice);
  const tracksStock = product && !product.unlimitedStock;

  const savePrices = async () => {
    if (priceValue <= 0) return toast.error('El precio tiene que ser mayor a cero');
    setSavingPrice(true);
    try {
      await api.patch(`/products/${product.id}`, { salePrice: priceValue, costPrice: costValue });
      setProduct({ ...product, salePrice: priceValue, costPrice: costValue });
      onChanged(product.id, { salePrice: priceValue });
      toast.success('Precio actualizado');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo guardar');
    } finally {
      setSavingPrice(false);
    }
  };

  const saveStock = async () => {
    if (!delta) return;
    setSavingStock(true);
    try {
      await api.post(`/products/${product.id}/movement`, {
        type: delta > 0 ? 'ENTRY' : 'EXIT',
        quantity: Math.abs(delta),
        reason: delta > 0 ? 'Ingreso desde el celular' : 'Ajuste desde el celular',
      });
      const stock = product.stock + delta;
      setProduct({ ...product, stock });
      onChanged(product.id, { stock });
      setDelta(0);
      toast.success(delta > 0 ? `Sumaste ${qty(delta)} al stock` : `Restaste ${qty(-delta)} del stock`);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo ajustar el stock');
    } finally {
      setSavingStock(false);
    }
  };

  const saveDescription = async () => {
    setSavingDesc(true);
    try {
      await api.patch(`/products/${product.id}`, { description: desc.trim() });
      setProduct({ ...product, description: desc.trim() });
      onChanged(product.id, { description: desc.trim() });
      toast.success('Descripción guardada');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo guardar');
    } finally {
      setSavingDesc(false);
    }
  };

  const saveCategory = async (c: { id: string; name: string } | null) => {
    setSavingCategory(true);
    try {
      await api.patch(`/products/${product.id}`, { categoryId: c ? c.id : '' });
      setProduct({ ...product, categoryId: c?.id ?? null, category: c });
      onChanged(product.id, { categoryId: c?.id ?? null, category: c });
      toast.success(c ? `Categoría: ${c.name}` : 'Sin categoría');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo cambiar la categoría');
    } finally {
      setSavingCategory(false);
    }
  };

  const toggleFavorite = async () => {
    try {
      await api.patch(`/products/${product.id}/favorite`);
      setProduct({ ...product, isFavorite: !product.isFavorite });
      onChanged(product.id, { isFavorite: !product.isFavorite });
    } catch {
      toast.error('No se pudo marcar como favorito');
    }
  };

  return (
    <Sheet open={!!productId} onClose={onClose}>
      {!product ? (
        <div className="h-64 flex items-center justify-center"><span className="w-6 h-6 border-2 border-rose-200 border-t-rose-600 rounded-full animate-spin" /></div>
      ) : (
        <div className="pt-1 space-y-5">
          <div className="flex items-start gap-3">
            <span className="w-16 h-16 rounded-2xl bg-slate-50 overflow-hidden flex items-center justify-center shrink-0">
              {product.imageUrl
                ? <img src={resolveServerUrl(product.imageUrl)} alt="" className="w-full h-full object-cover" />
                : <span className="text-[24px] font-bold text-rose-200">{(product.name || '?')[0]}</span>}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[16px] font-semibold text-slate-900 leading-snug">{product.name}</p>
              <p className="text-[12px] text-slate-500 mt-0.5 truncate">
                {[product.barcode, product.category?.name].filter(Boolean).join(' · ') || 'Sin código'}
              </p>
            </div>
            <button onClick={toggleFavorite} className="w-10 h-10 rounded-full bg-slate-50 flex items-center justify-center shrink-0" aria-label="Favorito">
              <Star className={`w-5 h-5 ${product.isFavorite ? 'text-orange-500 fill-orange-400' : 'text-slate-400'}`} />
            </button>
          </div>

          <section>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="mb-1.5 text-[12.5px] font-medium text-slate-500">Precio de venta</p>
                <SmallMoney value={price} onChange={setPrice} />
              </div>
              <div>
                <p className="mb-1.5 text-[12.5px] font-medium text-slate-500">Costo</p>
                <SmallMoney value={cost} onChange={setCost} />
              </div>
            </div>
            <div className="mt-2 flex items-center justify-between">
              <p className="text-[12.5px] text-slate-500">
                {margin !== null ? <>Ganás <span className="font-semibold text-rose-700">{money(priceValue - costValue)}</span> por unidad ({margin}%)</> : 'Cargá el costo para ver cuánto ganás'}
              </p>
            </div>
            {priceChanged && <PrimaryButton className="mt-3" onClick={savePrices} loading={savingPrice}>Guardar precio</PrimaryButton>}
          </section>

          {tracksStock && (
            <section className="rounded-2xl bg-slate-50 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[12.5px] text-slate-500">Stock actual</p>
                  <p className={`text-[26px] font-bold tabular-nums ${product.stock <= 0 ? 'text-red-600' : product.stock <= product.minStock ? 'text-amber-700' : 'text-slate-900'}`}>
                    {qty(product.stock)}
                    {delta !== 0 && <span className="text-[16px] font-semibold text-rose-700"> → {qty(product.stock + delta)}</span>}
                  </p>
                  {product.minStock > 0 && <p className="text-[11.5px] text-slate-400">Mínimo {qty(product.minStock)}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setDelta((d) => d - 1)} className="w-11 h-11 rounded-xl bg-white border border-slate-200 flex items-center justify-center active:scale-90" aria-label="Restar">
                    <Minus className="w-5 h-5 text-slate-700" />
                  </button>
                  <button onClick={() => setDelta((d) => d + 1)} className="w-11 h-11 rounded-xl bg-white border border-slate-200 flex items-center justify-center active:scale-90" aria-label="Sumar">
                    <Plus className="w-5 h-5 text-slate-700" />
                  </button>
                </div>
              </div>
              <div className="flex gap-2 mt-3">
                {[6, 12, 24].map((n) => (
                  <button key={n} onClick={() => setDelta((d) => d + n)} className="flex-1 h-9 rounded-xl bg-white border border-slate-200 text-[13px] font-medium text-slate-700">+{n}</button>
                ))}
              </div>
              {delta !== 0 && (
                <PrimaryButton className="mt-3" onClick={saveStock} loading={savingStock}>
                  {delta > 0 ? `Sumar ${qty(delta)} al stock` : `Restar ${qty(-delta)} del stock`}
                </PrimaryButton>
              )}
            </section>
          )}

          <section>
            <p className="mb-1.5 text-[12.5px] font-medium text-slate-500">Descripción <span className="text-slate-400">(se ve en la tienda online)</span></p>
            <textarea value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={300} rows={2} placeholder="Ej: salsa de tomate, muzzarella y aceitunas" className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[14.5px] outline-none focus:border-rose-500 focus:bg-white resize-none" />
            {desc.trim() !== (product.description || '').trim() && <PrimaryButton className="mt-2" onClick={saveDescription} loading={savingDesc}>Guardar descripción</PrimaryButton>}
          </section>

          <section>
            <p className="mb-1.5 text-[12.5px] font-medium text-slate-500">Categoría</p>
            <CategoryPicker value={product.categoryId ?? null} onChange={saveCategory} disabled={savingCategory} />
          </section>
        </div>
      )}
    </Sheet>
  );
}

function SmallMoney({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center h-12 px-3 rounded-xl bg-slate-50 border border-slate-200 focus-within:border-rose-500 focus-within:bg-white">
      <span className="text-[16px] text-slate-400 mr-1">$</span>
      <input
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
        className="flex-1 min-w-0 bg-transparent outline-none text-[18px] font-semibold text-slate-900 tabular-nums"
      />
    </div>
  );
}

function NewProductSheet({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (p: any) => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [barcode, setBarcode] = useState('');
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [stock, setStock] = useState('');
  const [category, setCategory] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  // Gastronomía: sin stock (se cocina a pedido) y con tamaños a distinto precio
  const isFood = useBusinessStore((s) => s.profile) === 'GASTRONOMIA';
  const [withOptions, setWithOptions] = useState(false);
  const [optionName, setOptionName] = useState('Tamaño');
  const [options, setOptions] = useState<{ label: string; price: string }[]>([{ label: '', price: '' }, { label: '', price: '' }]);

  useEffect(() => {
    if (open) {
      setName(''); setDescription(''); setBarcode(''); setPrice(''); setCost(''); setStock(''); setCategory(null);
      setWithOptions(false); setOptionName(isFood ? 'Tamaño' : 'Opción');
      setOptions(isFood ? [{ label: 'Chica', price: '' }, { label: 'Grande', price: '' }] : [{ label: '', price: '' }, { label: '', price: '' }]);
    }
  }, [open]);

  /** Un producto con opciones: cada opción se guarda como una variante con su precio */
  const saveWithOptions = async () => {
    const rows = options.map((o) => ({ label: o.label.trim(), price: parseAmount(o.price) })).filter((o) => o.label);
    if (rows.length < 2) return toast.error('Cargá al menos dos opciones');
    if (rows.some((o) => o.price <= 0)) return toast.error('Cada opción necesita su precio');
    if (new Set(rows.map((o) => o.label.toUpperCase())).size !== rows.length) return toast.error('Hay opciones repetidas');
    const axis = (optionName.trim() || 'opción').toLowerCase();
    setBusy(true);
    try {
      const { data } = await api.post('/products/variant-matrix', {
        baseName: name.trim(),
        base: { costPrice: parseAmount(cost), categoryId: category?.id, description: description.trim() || undefined, ...(isFood ? { unlimitedStock: true } : {}) },
        variants: rows.map((o) => ({ attrs: { [axis]: o.label }, salePrice: o.price, ...(isFood ? {} : { stock: parseAmount(stock) }) })),
      });
      toast.success(`${name.trim()}: ${rows.length} opciones creadas`);
      (Array.isArray(data) ? data : []).forEach((p: any) => onCreated({ ...p, category: p.category || category }));
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo crear el producto');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!name.trim()) return toast.error('Poné un nombre');
    if (withOptions) return saveWithOptions();
    if (parseAmount(price) <= 0) return toast.error('Poné el precio de venta');
    setBusy(true);
    try {
      const { data } = await api.post('/products', {
        name: name.trim(),
        description: description.trim() || undefined,
        barcode: barcode.trim() || undefined,
        salePrice: parseAmount(price),
        costPrice: parseAmount(cost),
        stock: parseAmount(stock),
        categoryId: category?.id,
        ...(isFood ? { unlimitedStock: true } : {}),
      });
      toast.success('Producto creado');
      onCreated({ ...data, category: data.category || category });
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo crear el producto');
    } finally {
      setBusy(false);
    }
  };

  const onCode = useCallback((code: string) => { setBarcode(code); setScanning(false); }, []);

  return (
    <>
      <Sheet open={open} onClose={onClose} title="Nuevo producto" footer={<PrimaryButton onClick={save} loading={busy}>Crear producto</PrimaryButton>}>
        <div className="space-y-4 pt-1">
          <Field label="Nombre">
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder={isFood ? 'Pizza muzzarella' : 'Coca-Cola 2,25 L'} className="w-full h-12 px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-[15px] outline-none focus:border-rose-500 focus:bg-white" />
          </Field>
          <Field label="Descripción (opcional)">
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} rows={2} placeholder={isFood ? 'Salsa de tomate, muzzarella y aceitunas' : 'Se ve en la tienda online'} className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-[15px] outline-none focus:border-rose-500 focus:bg-white resize-none" />
          </Field>
{!isFood && (
          <Field label="Código de barras (opcional)">
            <div className="flex gap-2">
              <input value={barcode} onChange={(e) => setBarcode(e.target.value)} inputMode="numeric" placeholder="7790895000997" className="flex-1 min-w-0 h-12 px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-[15px] outline-none focus:border-rose-500 focus:bg-white tabular-nums" />
              {canScanBarcodes() && (
                <button onClick={() => setScanning(true)} className="w-12 h-12 rounded-xl bg-rose-600 flex items-center justify-center" aria-label="Escanear código">
                  <ScanLine className="w-5 h-5 text-white" />
                </button>
              )}
            </div>
          </Field>
          )}
          <button type="button" onClick={() => setWithOptions(!withOptions)} className="w-full flex items-center justify-between gap-3 text-left rounded-xl bg-slate-50 border border-slate-200 px-3.5 py-3">
            <span>
              <span className="block text-[14px] font-semibold text-slate-800">{isFood ? 'Tiene tamaños' : 'Tiene opciones'} con distinto precio</span>
              <span className="block text-[12px] text-slate-500">{isFood ? 'Ej.: pizza chica y grande' : 'Ej.: chico, mediano y grande'}</span>
            </span>
            <span className={`relative w-12 h-7 rounded-full shrink-0 transition-colors ${withOptions ? 'bg-rose-600' : 'bg-slate-300'}`}>
              <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${withOptions ? 'left-6' : 'left-1'}`} />
            </span>
          </button>
          {withOptions ? (
            <div className="space-y-2">
              <Field label="Nombre de la opción">
                <input value={optionName} onChange={(e) => setOptionName(e.target.value)} placeholder="Tamaño" className="w-full h-11 px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-[15px] outline-none focus:border-rose-500 focus:bg-white" />
              </Field>
              {options.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={o.label} onChange={(e) => setOptions(options.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} placeholder={i === 0 ? 'Chica' : i === 1 ? 'Grande' : 'Otra'} className="flex-1 min-w-0 h-12 px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-[15px] outline-none focus:border-rose-500 focus:bg-white" />
                  <div className="w-36 shrink-0"><SmallMoney value={o.price} onChange={(v) => setOptions(options.map((x, j) => (j === i ? { ...x, price: v } : x)))} /></div>
                  {options.length > 2 && <button type="button" onClick={() => setOptions(options.filter((_, j) => j !== i))} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center shrink-0" aria-label="Quitar"><X className="w-4 h-4 text-slate-500" /></button>}
                </div>
              ))}
              {options.length < 8 && <button type="button" onClick={() => setOptions([...options, { label: '', price: '' }])} className="text-[13px] font-semibold text-rose-700">+ Agregar opción</button>}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <Field label="Precio de venta"><SmallMoney value={price} onChange={setPrice} /></Field>
              <Field label="Costo"><SmallMoney value={cost} onChange={setCost} /></Field>
            </div>
          )}
          {!isFood && (
            <Field label={withOptions ? 'Stock inicial de cada opción' : 'Stock inicial'}>
              <input value={stock} onChange={(e) => setStock(e.target.value.replace(/[^\d.,]/g, ''))} inputMode="decimal" placeholder="0" className="w-full h-12 px-3.5 rounded-xl bg-slate-50 border border-slate-200 text-[15px] outline-none focus:border-rose-500 focus:bg-white tabular-nums" />
            </Field>
          )}
          <div>
            <span className="block mb-1.5 text-[12.5px] font-medium text-slate-500">Categoría</span>
            <CategoryPicker value={category?.id ?? null} onChange={setCategory} />
            <p className="mt-1.5 text-[11.5px] text-slate-400">En la tienda online los productos se agrupan por categoría.</p>
          </div>
        </div>
      </Sheet>
      {scanning && <BarcodeScanner onCode={onCode} onClose={() => setScanning(false)} />}
    </>
  );
}

/** Categorías activas (las borradas quedan con isActive=false). Se cargan una vez por sesión. */
let categoriesCache: Promise<{ id: string; name: string }[]> | null = null;
function loadCategories() {
  if (!categoriesCache) {
    categoriesCache = api.get('/categories')
      .then(({ data }) => ((data || []) as any[]).filter((c) => c.isActive !== false).map((c) => ({ id: c.id, name: c.name }))
        .sort((a, b) => a.name.localeCompare(b.name, 'es')))
      .catch(() => { categoriesCache = null; return []; });
  }
  return categoriesCache;
}

/**
 * Elegir la categoría del producto (o crear una nueva). En la tienda online los productos
 * se agrupan por categoría, así que conviene que el comercio pueda ordenarlos desde el celular.
 */
function CategoryPicker({ value, onChange, disabled }: { value: string | null; onChange: (c: { id: string; name: string } | null) => void; disabled?: boolean }) {
  const [cats, setCats] = useState<{ id: string; name: string }[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { loadCategories().then(setCats); }, []);

  const create = async () => {
    const n = name.trim();
    if (!n) return setAdding(false);
    const existing = cats.find((c) => c.name.toLowerCase() === n.toLowerCase());
    if (existing) { onChange(existing); setAdding(false); setName(''); return; }
    setBusy(true);
    try {
      const { data } = await api.post('/categories', { name: n });
      const c = { id: data.id, name: data.name };
      const next = [...cats, c].sort((a, b) => a.name.localeCompare(b.name, 'es'));
      setCats(next);
      categoriesCache = Promise.resolve(next);
      onChange(c);
      setAdding(false); setName('');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'No se pudo crear la categoría');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`flex flex-wrap gap-2 ${disabled ? 'opacity-60 pointer-events-none' : ''}`}>
      {cats.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => onChange(value === c.id ? null : c)}
          className={`h-9 px-3.5 rounded-full text-[13px] font-medium border transition-colors ${value === c.id ? 'bg-rose-600 border-rose-600 text-white' : 'bg-white border-slate-200 text-slate-700'}`}
        >
          {c.name}
        </button>
      ))}
      {adding ? (
        <div className="flex items-center gap-1.5 h-9 pl-3 pr-1 rounded-full border border-rose-400 bg-white">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); create(); } }}
            autoFocus
            placeholder="Nombre"
            className="w-28 bg-transparent outline-none text-[13px]"
          />
          <button type="button" onClick={create} disabled={busy} className="h-7 px-2.5 rounded-full bg-rose-600 text-white text-[12px] font-semibold">{busy ? '…' : 'Crear'}</button>
        </div>
      ) : (
        <button type="button" onClick={() => setAdding(true)} className="h-9 px-3 rounded-full border border-dashed border-slate-300 text-[13px] font-medium text-slate-500 flex items-center gap-1">
          <Plus className="w-4 h-4" /> Nueva
        </button>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block mb-1.5 text-[12.5px] font-medium text-slate-500">{label}</span>
      {children}
    </label>
  );
}
