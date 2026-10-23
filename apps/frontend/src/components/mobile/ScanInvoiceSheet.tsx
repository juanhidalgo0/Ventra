import { useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Camera, ImagePlus, X, Loader2, CheckCircle2, Monitor, Sparkles } from 'lucide-react';
import api from '../../services/api';
import { setStoreSetting } from '../../services/storeSettings';
import { Sheet, PrimaryButton, money } from './ui';

/** Cómo se cargan las boletas (Compras): JSON en el ajuste del comercio purchase_auto */
export function readPurchaseAuto(): { enabled: boolean; keepMargin: boolean; round: number } {
  let v: any = null;
  try { v = JSON.parse(localStorage.getItem('purchase_auto') || 'null'); } catch { /* sin ajuste */ }
  return { enabled: v?.enabled !== false, keepMargin: v?.keepMargin !== false, round: [0, 10, 100].includes(Number(v?.round)) ? Number(v.round) : 10 };
}
export const savePurchaseAuto = (v: { enabled: boolean; keepMargin: boolean; round: number }) => setStoreSetting('purchase_auto', JSON.stringify(v));

/**
 * Escanear una boleta de compra con el celular: se sacan las fotos (una por hoja) y la IA de
 * Ventra la lee. Si la boleta cierra (los renglones suman el total) y no hay nada dudoso, se
 * carga sola: suma el stock, actualiza costos y precios (manteniendo el margen) y crea los
 * productos nuevos. Si no, queda "por revisar" en la PC, sin tocar nada.
 */
export default function ScanInvoiceSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [photos, setPhotos] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [auto, setAuto] = useState(readPurchaseAuto);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const reset = () => { setPhotos([]); setResult(null); setBusy(false); };
  const close = () => { if (busy) return; reset(); onClose(); };
  const add = (list: FileList | null) => {
    const imgs = Array.from(list || []).filter((f) => f.type.startsWith('image/'));
    if (imgs.length) setPhotos((p) => [...p, ...imgs].slice(0, 6));
  };

  const read = async () => {
    if (!photos.length) return;
    setBusy(true);
    try {
      const form = new FormData();
      photos.forEach((f) => form.append('files', f));
      const { data } = await api.post('/purchases/scan-invoice', form, { timeout: 180000 } as any);
      setResult(data);
      onDone();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo leer la boleta. Probá de nuevo.', { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  const total = result ? (result.items || []).reduce((s: number, it: any) => s + (Number(it.total) || 0), 0) : 0;

  return (
    <Sheet open={open} onClose={close} title={result ? 'Boleta leída' : 'Escanear boleta'}
      footer={result
        ? <PrimaryButton onClick={() => { reset(); }}>Escanear otra</PrimaryButton>
        : <PrimaryButton onClick={read} loading={busy}>{busy ? 'Leyendo la boleta…' : photos.length ? `Leer la boleta (${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'})` : 'Sacá la foto primero'}</PrimaryButton>}>
      {result ? (
        <div className="space-y-4 pt-1">
          <div className="text-center">
            <CheckCircle2 className={`w-12 h-12 mx-auto ${result.auto ? 'text-emerald-600' : 'text-amber-500'}`} />
            <p className="mt-2 text-[17px] font-bold text-slate-900">{result.matchedSupplier?.name || result.supplierName || 'Proveedor'}</p>
            <p className="text-[13px] text-slate-500">{(result.items || []).length} productos{result.invoiceNumber ? ` · Factura ${result.invoiceNumber}` : ''} · {money(total)} sin IVA</p>
          </div>
          {result.auto ? (
            <div className="rounded-2xl bg-emerald-50 border border-emerald-100 px-4 py-3 flex gap-3 text-[13.5px] text-emerald-900">
              <Sparkles className="w-5 h-5 shrink-0 mt-0.5" />
              <span><b>Listo, se cargó sola.</b> Se sumó el stock{result.updatedPrices ? `, se actualizaron ${result.updatedPrices} precios manteniendo tu margen` : ''}{result.newProducts ? ` y se crearon ${result.newProducts} productos nuevos (te quedan para revisar en Productos)` : ''}. Queda a cuenta del proveedor.</span>
            </div>
          ) : (
            <div className="rounded-2xl bg-amber-50 border border-amber-100 px-4 py-3 flex gap-3 text-[13.5px] text-amber-900">
              <Monitor className="w-5 h-5 shrink-0 mt-0.5" />
              <span>Quedó en <b>Compras → Por revisar</b>{result.why?.length ? ` porque ${result.why.join(' y ')}` : ''}. En la PC aparece sola para revisarla y confirmarla. Hasta entonces no se toca el stock ni los precios.</span>
            </div>
          )}
          <div className="rounded-2xl border border-slate-200 divide-y divide-slate-100 max-h-[40vh] overflow-y-auto">
            {(result.items || []).map((it: any, i: number) => (
              <div key={i} className="px-3.5 py-2 text-[13px]">
                <div className="flex justify-between gap-3">
                  <span className="text-slate-700 min-w-0">{it.quantity} × {it.product?.name || it.name}{!it.product && <span className="ml-1.5 text-[11px] font-semibold text-sky-700">nuevo</span>}</span>
                  <span className="text-slate-800 tabular-nums shrink-0">{money(Number(it.total) || 0)}</span>
                </div>
                {it.product && it.suggestedSalePrice !== it.product.salePrice && (
                  <p className="text-[11.5px] text-slate-500">Precio de venta {money(it.product.salePrice)} → {money(it.suggestedSalePrice)}</p>
                )}
                {it.doubtful && <p className="text-[11.5px] text-amber-700">Revisar: {(it.reasons || []).join(', ')}</p>}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4 pt-1">
          <p className="text-[13.5px] text-slate-600">Una foto por hoja, derecha y con buena luz. Si la factura tiene varias hojas, sacales foto a todas antes de leerla.</p>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
          <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => cameraRef.current?.click()} disabled={busy || photos.length >= 6} className="h-24 rounded-2xl bg-rose-600 text-white font-bold text-[15px] flex flex-col items-center justify-center gap-1.5 active:scale-[0.98] disabled:opacity-50">
              <Camera className="w-7 h-7" /> {photos.length ? 'Otra hoja' : 'Sacar foto'}
            </button>
            <button onClick={() => galleryRef.current?.click()} disabled={busy || photos.length >= 6} className="h-24 rounded-2xl border border-slate-300 text-slate-700 font-semibold text-[14px] flex flex-col items-center justify-center gap-1.5 active:scale-[0.98] disabled:opacity-50">
              <ImagePlus className="w-6 h-6" /> De la galería
            </button>
          </div>
          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((f, i) => (
                <div key={i} className="relative aspect-[3/4] rounded-xl overflow-hidden bg-slate-100">
                  <img src={URL.createObjectURL(f)} alt={`Hoja ${i + 1}`} className="w-full h-full object-cover" />
                  <span className="absolute left-1.5 top-1.5 text-[11px] font-bold bg-black/60 text-white rounded px-1.5">Hoja {i + 1}</span>
                  {!busy && <button onClick={() => setPhotos((p) => p.filter((_, k) => k !== i))} className="absolute right-1 top-1 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center" aria-label="Sacar la foto"><X className="w-4 h-4" /></button>}
                </div>
              ))}
            </div>
          )}
          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 px-3.5 py-3">
            <input type="checkbox" checked={auto.enabled} onChange={(e) => { const v = { ...auto, enabled: e.target.checked }; setAuto(v); savePurchaseAuto(v); }} className="w-5 h-5 mt-0.5 accent-rose-600 shrink-0" />
            <span className="text-[13px] text-slate-700">
              <b className="block text-slate-900">Cargarla sola si está todo bien</b>
              Si los renglones suman el total y no hay nada dudoso: suma el stock, actualiza los precios manteniendo tu margen y crea los productos nuevos. Si algo no cierra, queda para revisar.
            </span>
          </label>
          {busy && <p className="flex items-center justify-center gap-2 text-[13px] text-slate-500"><Loader2 className="w-4 h-4 animate-spin" /> La IA está leyendo los productos y los totales…</p>}
        </div>
      )}
    </Sheet>
  );
}
