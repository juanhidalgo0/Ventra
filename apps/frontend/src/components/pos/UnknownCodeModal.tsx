import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Loader2, ScanBarcode } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';

/**
 * Se escaneó un código que no está cargado. Sin salir de la venta:
 *  - el dueño o el encargado lo da de alta ahí mismo (nombre y foto salen solos de los
 *    catálogos de los supermercados; pone el precio) y entra directo al ticket;
 *  - el cajero, que no carga productos, lo vende igual con el precio a mano: queda como
 *    venta rápida con el nombre y el código, así el dueño lo ve en el historial y lo carga.
 */

function parseAmount(raw: string) {
  // Acepta "1500", "1.500" (miles), "12,5" y "12.5" (decimales)
  let normalized = raw;
  if (raw.includes(',')) normalized = raw.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{3}$/.test(raw)) normalized = raw.replace(/\./g, '');
  const n = parseFloat(normalized);
  return isNaN(n) ? 0 : n;
}

const money = (raw: string) => raw.replace(/[^\d.,]/g, '');

interface Props {
  code: string;
  /** Dueño o encargado: puede dar de alta productos */
  canCreate: boolean;
  categories: { id: string; name: string }[];
  onClose: () => void;
  /** Producto recién creado: va al ticket */
  onCreated: (product: any) => void;
  /** Vendido sin cargar, con precio a mano */
  onSell: (item: { name: string; price: number; quantity: number }) => void;
}

const input = 'w-full h-12 px-3.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-850 text-[16px] font-semibold text-slate-900 dark:text-white outline-none focus:border-rose-500 focus:ring-4 focus:ring-rose-500/15 transition-all placeholder:text-slate-300 placeholder:font-normal';
const label = 'block text-[13px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5';

export default function UnknownCodeModal({ code, canCreate, categories, onClose, onCreated, onSell }: Props) {
  const [mode, setMode] = useState<'create' | 'sell'>(canCreate ? 'create' : 'sell');
  const [name, setName] = useState('');
  const [nameTouched, setNameTouched] = useState(false);
  const [looking, setLooking] = useState(true);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [useImage, setUseImage] = useState(true);
  const [price, setPrice] = useState('');
  const [cost, setCost] = useState('');
  const [stock, setStock] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [qty, setQty] = useState('1');
  const [saving, setSaving] = useState(false);
  const priceRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Nombre y foto según los supermercados (si es un código de producto conocido)
  useEffect(() => {
    let alive = true;
    if (!/^\d{8,14}$/.test(code)) { setLooking(false); return; }
    api.get(`/products/barcode-info/${encodeURIComponent(code)}`, { silent: true, timeout: 12000 } as any)
      .then(({ data }) => {
        if (!alive) return;
        if (data?.name) setName((current) => (nameTouched || current ? current : data.name));
        if (data?.imageUrl) setImageUrl(data.imageUrl);
      })
      .catch(() => {})
      .finally(() => { if (alive) setLooking(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  useEffect(() => {
    const t = setTimeout(() => priceRef.current?.focus(), 40);
    return () => clearTimeout(t);
  }, [mode]);

  // Escape cierra sin que la caja lo tome (como la venta rápida)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const priceNum = parseAmount(price);
  const qtyNum = parseAmount(qty) || 0;
  const cleanName = name.trim();

  const create = async () => {
    if (saving) return;
    if (!cleanName) { toast.error('Escribí el nombre del producto'); nameRef.current?.focus(); return; }
    if (!(priceNum > 0)) { toast.error('Poné el precio de venta'); priceRef.current?.focus(); return; }
    setSaving(true);
    try {
      const { data } = await api.post('/products', {
        name: cleanName,
        barcode: code,
        salePrice: priceNum,
        costPrice: parseAmount(cost),
        stock: parseAmount(stock),
        ...(categoryId ? { categoryId } : {}),
        ...(useImage && imageUrl ? { imageUrl } : {}),
      });
      toast.success(`${data?.name || cleanName} quedó cargado`);
      onCreated(data);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo cargar el producto');
    } finally {
      setSaving(false);
    }
  };

  const sell = () => {
    if (!(priceNum > 0) || !(qtyNum > 0)) { priceRef.current?.focus(); return; }
    onSell({ name: `${(cleanName || 'Artículo sin cargar').toUpperCase()} · ${code}`, price: priceNum, quantity: qtyNum });
  };

  const submit = () => (mode === 'create' ? create() : sell());
  const onEnter = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    e.stopPropagation();
    submit();
  };

  return createPortal(
    <div data-unknown-code className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="keep-style w-full max-w-[460px] max-h-[94vh] overflow-y-auto bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-[0_24px_60px_-16px_rgba(15,23,42,0.45)] p-6"
      >
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-10 h-10 rounded-xl bg-gradient-to-br from-rose-400 to-rose-600 text-white flex items-center justify-center shadow-sm shadow-rose-600/30 shrink-0">
              <ScanBarcode className="w-5 h-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 leading-tight">
                {mode === 'create' ? 'Producto nuevo' : 'Vender sin cargar'}
              </h2>
              <p className="text-[12px] text-slate-500 truncate">Código no registrado: <b className="font-mono text-slate-700 dark:text-slate-300">{code}</b></p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Cerrar">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex gap-3 items-start">
          {mode === 'create' && imageUrl && (
            <button type="button" onClick={() => setUseImage((v) => !v)} title={useImage ? 'No usar esta foto' : 'Usar esta foto'}
              className={`shrink-0 w-[72px] h-[72px] rounded-xl border-2 overflow-hidden bg-white ${useImage ? 'border-rose-500' : 'border-slate-200 opacity-40'}`}>
              <img src={imageUrl} alt="" className="w-full h-full object-contain" />
            </button>
          )}
          <label className="block flex-1 min-w-0">
            <span className={label}>
              Nombre {mode === 'create' ? <span className="text-rose-600">*</span> : <span className="font-normal text-slate-400">(opcional)</span>}
              {looking && <span className="ml-2 inline-flex items-center gap-1 text-[11.5px] font-normal text-slate-400"><Loader2 className="w-3 h-3 animate-spin" /> buscando…</span>}
            </span>
            <input ref={nameRef} value={name} onChange={(e) => { setNameTouched(true); setName(e.target.value); }} onKeyDown={onEnter}
              placeholder={looking ? '' : 'Ej: Galletitas de agua 300 g'} maxLength={120} className={input} />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-3 mt-3">
          <label className="block">
            <span className={label}>Precio de venta <span className="text-rose-600">*</span></span>
            <div className="relative">
              <span className="absolute inset-y-0 left-3.5 flex items-center text-slate-400 font-semibold text-[17px] pointer-events-none">$</span>
              <input ref={priceRef} inputMode="decimal" value={price} onChange={(e) => setPrice(money(e.target.value))} onKeyDown={onEnter} placeholder="0" className={`${input} pl-8 text-[17px]`} />
            </div>
          </label>
          {mode === 'create' ? (
            <label className="block">
              <span className={label}>Costo <span className="font-normal text-slate-400">(opcional)</span></span>
              <div className="relative">
                <span className="absolute inset-y-0 left-3.5 flex items-center text-slate-400 font-semibold text-[17px] pointer-events-none">$</span>
                <input inputMode="decimal" value={cost} onChange={(e) => setCost(money(e.target.value))} onKeyDown={onEnter} placeholder="0" className={`${input} pl-8`} />
              </div>
            </label>
          ) : (
            <label className="block">
              <span className={label}>Cantidad</span>
              <input inputMode="decimal" value={qty} onChange={(e) => setQty(money(e.target.value))} onKeyDown={onEnter} onFocus={(e) => e.target.select()} className={input} />
            </label>
          )}
        </div>

        {mode === 'create' && (
          <div className="grid grid-cols-2 gap-3 mt-3">
            <label className="block">
              <span className={label}>¿Cuántos tenés? <span className="font-normal text-slate-400">(opcional)</span></span>
              <input inputMode="decimal" value={stock} onChange={(e) => setStock(money(e.target.value))} onKeyDown={onEnter} placeholder="0" className={input} />
            </label>
            <label className="block">
              <span className={label}>Categoría <span className="font-normal text-slate-400">(opcional)</span></span>
              <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)} className={`${input} font-medium text-[14px]`}>
                <option value="">Sin categoría</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          </div>
        )}

        <p className="mt-3 text-[12px] text-slate-500 leading-snug">
          {mode === 'create'
            ? 'Queda cargado con este código y entra al ticket. El resto (proveedor, stock mínimo) se completa después en Productos.'
            : 'Se cobra como venta rápida con el nombre y el código, así queda en el historial para cargarlo después.'}
        </p>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <button onClick={onClose}
            className="h-12 rounded-xl border border-slate-300 dark:border-slate-700 text-[14px] font-semibold text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors">
            Cancelar
          </button>
          <button onClick={submit} disabled={saving || !(priceNum > 0) || (mode === 'create' && !cleanName)}
            className="h-12 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[14px] font-bold shadow-md shadow-rose-600/25 disabled:bg-slate-200 disabled:text-slate-400 disabled:shadow-none dark:disabled:bg-slate-800 transition-colors flex items-center justify-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {mode === 'create' ? 'Cargar y agregar' : 'Agregar al carrito'}
          </button>
        </div>

        {canCreate && (
          <button onClick={() => setMode(mode === 'create' ? 'sell' : 'create')}
            className="mt-3 w-full text-center text-[12.5px] font-semibold text-slate-500 hover:text-slate-700 underline underline-offset-2">
            {mode === 'create' ? 'Venderlo ahora sin cargarlo' : 'Mejor cargarlo como producto'}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
