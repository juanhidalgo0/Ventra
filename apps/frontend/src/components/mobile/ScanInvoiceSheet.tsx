import { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Camera, ImagePlus, X, Loader2, CheckCircle2, Monitor, Sparkles } from 'lucide-react';
import api from '../../services/api';
import { setStoreSetting } from '../../services/storeSettings';
import { Sheet, PrimaryButton, money, parseAmount } from './ui';
import { checkPhotos, warningText, PHOTO_TIP, type PhotoWarning } from '../../utils/photoQuality';
import { enqueueScan, isOffline } from '../../utils/scanQueue';
import { preparePhoto, type PreparedPhoto } from '../../utils/shrinkPhoto';
import { useScanJob, startScanJob, resetScanJob } from '../../utils/scanInvoiceJob';

/** Cómo se cargan las boletas (Compras): JSON en el ajuste del comercio purchase_auto */
export function readPurchaseAuto(): { enabled: boolean; keepMargin: boolean; round: number } {
  let v: any = null;
  try { v = JSON.parse(localStorage.getItem('purchase_auto') || 'null'); } catch { /* sin ajuste */ }
  return { enabled: v?.enabled === true, keepMargin: v?.keepMargin !== false, round: [0, 10, 100].includes(Number(v?.round)) ? Number(v.round) : 10 };
}
export const savePurchaseAuto = (v: { enabled: boolean; keepMargin: boolean; round: number }) => setStoreSetting('purchase_auto', JSON.stringify(v));

/**
 * Escanear una boleta de compra con el celular: se sacan las fotos (una por hoja) y la IA de
 * Ventra la lee. Si la boleta cierra (los renglones suman el total) y no hay nada dudoso, se
 * carga sola: suma el stock, actualiza costos y precios (manteniendo el margen) y crea los
 * productos nuevos. Si no, queda "por revisar" en la PC, sin tocar nada.
 */
export default function ScanInvoiceSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  // Cada foto ya achicada en el teléfono, con su miniatura (ver utils/shrinkPhoto)
  const [photos, setPhotos] = useState<PreparedPhoto[]>([]);
  const [preparing, setPreparing] = useState(0);
  // Total de la boleta (opcional): con él la IA controla que los renglones cierren y relee si no
  const [totalText, setTotalText] = useState('');
  const job = useScanJob();
  const busy = job.stage === 'uploading';
  const reading = job.stage === 'reading';
  const result = job.stage === 'done' ? job.result : null;
  const [auto, setAuto] = useState(readPurchaseAuto);
  const cameraRef = useRef<HTMLInputElement>(null);
  // Foto movida, oscura o chica: aviso con "Sacar de nuevo" o "Usar igual", nunca bloquea
  const [warnings, setWarnings] = useState<PhotoWarning[]>([]);
  const [accepted, setAccepted] = useState<Set<File>>(new Set());
  const files = photos.map((p) => p.file);
  useEffect(() => {
    let alive = true;
    checkPhotos(photos.map((p) => p.file)).then((w) => { if (alive) setWarnings(w); }).catch(() => {});
    return () => { alive = false; };
  }, [photos]);
  const shownWarnings = warnings.filter((w) => files[w.index] && !accepted.has(files[w.index]));
  const galleryRef = useRef<HTMLInputElement>(null);

  // Mientras la ventanita está abierta, el resultado se muestra acá (sin cartel aparte)
  useEffect(() => {
    useScanJob.setState({ watching: open });
    return () => useScanJob.setState({ watching: false });
  }, [open]);
  // Terminó una lectura: la lista de compras se actualiza
  const firstFinished = useRef(job.finished);
  useEffect(() => { if (job.finished !== firstFinished.current) onDone(); }, [job.finished]);
  useEffect(() => { if (job.stage === 'error' && open && job.error) toast.error(job.error, { duration: 8000 }); }, [job.stage, job.error]);
  // Reloj de la lectura, para que se vea que avanza
  const [, tick] = useState(0);
  useEffect(() => {
    if (!reading || !open) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [reading, open]);

  const dropThumbs = (list: PreparedPhoto[]) => list.forEach((p) => { try { URL.revokeObjectURL(p.thumb); } catch { /* nada */ } });
  const clearPhotos = () => { setPhotos((p) => { dropThumbs(p); return []; }); setAccepted(new Set()); };
  const reset = () => { clearPhotos(); setTotalText(''); resetScanJob(); };
  // Se puede cerrar siempre, salvo en el ratito que se suben las fotos: la lectura sigue sola
  const close = () => {
    if (busy) return;
    if (job.stage === 'done' || job.stage === 'error') reset();
    onClose();
  };
  const add = async (list: FileList | null) => {
    const imgs = Array.from(list || []).filter((f) => f.type.startsWith('image/')).slice(0, Math.max(0, 12 - photos.length));
    if (!imgs.length) return;
    setPreparing((n) => n + imgs.length);
    // De a una: varias fotos de 12 MP abiertas a la vez se comen la memoria de un Android básico
    for (const f of imgs) {
      const p = await preparePhoto(f);
      setPhotos((prev) => [...prev, p].slice(0, 12));
      setPreparing((n) => Math.max(0, n - 1));
    }
  };
  const remove = (i: number) => setPhotos((p) => { dropThumbs([p[i]]); return p.filter((_, k) => k !== i); });

  const read = async () => {
    if (!photos.length || preparing || busy || reading) return;
    const toSend = files;
    try {
      await startScanJob(toSend, parseAmount(totalText) || undefined);
      clearPhotos();
      setTotalText('');
    } catch (err: any) {
      // Sin conexión: la boleta queda guardada en el teléfono y se manda sola cuando vuelva (tanda 6.4)
      if (isOffline(err) && await enqueueScan(toSend)) {
        toast.success('Sin conexión: la boleta quedó en espera y se manda sola cuando vuelva internet.', { duration: 8000 });
        reset();
        onDone();
        onClose();
        return;
      }
      toast.error(err?.response?.data?.message || 'No se pudieron subir las fotos. Probá de nuevo.', { duration: 8000 });
    }
  };

  const secs = Math.max(0, Math.round((Date.now() - job.startedAt) / 1000));
  const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  const total = result ? (result.items || []).reduce((s: number, it: any) => s + (Number(it.total) || 0), 0) : 0;

  return (
    <Sheet open={open} onClose={close} title={result ? 'Boleta leída' : reading ? 'Leyendo la boleta' : 'Escanear boleta'}
      footer={result
        ? <PrimaryButton onClick={() => { reset(); }}>Escanear otra</PrimaryButton>
        : reading
          ? <PrimaryButton onClick={onClose}>Seguir usando la app</PrimaryButton>
          : <PrimaryButton onClick={read} loading={busy || preparing > 0}>{busy ? `Subiendo las fotos… ${job.uploadPct}%` : preparing ? 'Preparando las fotos…' : photos.length ? `Leer la boleta (${photos.length} ${photos.length === 1 ? 'foto' : 'fotos'})` : 'Sacá la foto primero'}</PrimaryButton>}>
      {reading ? (
        <div className="space-y-4 pt-2 pb-1 text-center">
          <div className="relative w-16 h-16 mx-auto">
            <Loader2 className="w-16 h-16 text-rose-600 animate-spin" />
            <Sparkles className="w-6 h-6 text-rose-600 absolute inset-0 m-auto" />
          </div>
          <div>
            <p className="text-[16px] font-bold text-slate-900">La IA está leyendo {job.photos > 1 ? `las ${job.photos} fotos` : 'la boleta'}</p>
            <p className="mt-1 text-[13px] text-slate-500 tabular-nums">{clock} · suele tardar entre 20 segundos y 1 minuto{job.photos > 1 ? ' (las hojas se leen al mismo tiempo)' : ''}. Si algo no cierra, la relee con más cuidado y tarda un poco más.</p>
          </div>
          <div className="rounded-2xl bg-sky-50 border border-sky-100 px-4 py-3 text-[13.5px] text-sky-900 text-left flex gap-3">
            <Monitor className="w-5 h-5 shrink-0 mt-0.5" />
            <span><b>Podés cerrar esto y seguir usando la app.</b> La lectura sigue sola y te avisamos cuando termine. Aunque cierres la app, la boleta se carga igual.</span>
          </div>
        </div>
      ) : result ? (
        <div className="space-y-4 pt-1">
          <div className="text-center">
            <CheckCircle2 className={`w-12 h-12 mx-auto ${result.auto ? 'text-emerald-600' : 'text-amber-500'}`} />
            <p className="mt-2 text-[17px] font-bold text-slate-900">{result.matchedSupplier?.name || result.supplierName || 'Proveedor'}</p>
            <p className="text-[13px] text-slate-500">{(result.items || []).length} productos{result.invoiceNumber ? ` · Factura ${result.invoiceNumber}` : ''} · {money(total)} sin IVA</p>
          </div>
          {result.status === 'DUPLICATE' ? (
            <div className="rounded-2xl bg-rose-50 border border-rose-100 px-4 py-3 flex gap-3 text-[13.5px] text-rose-900">
              <Monitor className="w-5 h-5 shrink-0 mt-0.5" />
              <span><b>Esta boleta ya estaba cargada</b>{result.duplicate?.createdAt ? ` (el ${new Date(result.duplicate.createdAt).toLocaleDateString('es-AR')})` : ''}. No se volvió a cargar, así no se duplica el stock.</span>
            </div>
          ) : result.auto ? (
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
          {/* Las fotos traían más de un comprobante: cada uno quedó por su lado */}
          {result.others?.length > 0 && (
            <div className="rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-[13px] text-sky-900">
              <p><b>En las fotos había {result.others.length + 1} comprobantes.</b> Cada uno se cargó por separado:</p>
              <ul className="mt-1.5 space-y-1">
                {result.others.map((o: any, i: number) => (
                  <li key={i}>
                    · {o.matchedSupplier?.name || o.supplierName || 'Proveedor'}{o.invoiceNumber ? ` N° ${o.invoiceNumber}` : ''}{o.docType && o.docType !== 'factura' ? ` (${o.docType})` : ''}:{' '}
                    <b>{o.status === 'DUPLICATE' ? 'ya estaba cargado' : o.auto ? 'se cargó solo' : 'quedó para revisar en la PC'}</b>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.failedImages?.length > 0 && (
            <p className="text-[12.5px] text-rose-700 font-semibold px-1">No pude leer {result.failedImages.length === 1 ? `la foto ${result.failedImages[0] + 1}` : `las fotos ${result.failedImages.map((n: number) => n + 1).join(', ')}`}: sacala de nuevo, de frente y con buena luz.</p>
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
                {it.product && it.changePct !== null && Math.abs(it.changePct) >= 10 && (
                  <p className={`text-[11.5px] font-semibold ${it.changePct > 0 ? 'text-rose-600' : 'text-emerald-600'}`}>Costo {it.changePct > 0 ? '+' : ''}{String(it.changePct).replace('.', ',')}% desde el que tenía</p>
                )}
                {it.doubtful && <p className="text-[11.5px] text-amber-700">Revisar: {(it.reasons || []).join(', ')}</p>}
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="space-y-4 pt-1">
          <p className="text-[13.5px] text-slate-600">Una foto por hoja, derecha y con buena luz. Si la factura tiene varias hojas, sacales foto a todas antes de leerla.</p>
          <p className="text-[12.5px] text-slate-500">¿Ticket largo? Sacá varias fotos de arriba hacia abajo y dejá 2 renglones repetidos entre una y la siguiente: Ventra junta los tramos sin repetir nada.</p>
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
          <input ref={galleryRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { add(e.target.files); e.target.value = ''; }} />
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => cameraRef.current?.click()} disabled={busy || photos.length >= 12} className="h-24 rounded-2xl bg-rose-600 text-white font-bold text-[15px] flex flex-col items-center justify-center gap-1.5 active:scale-[0.98] disabled:opacity-50">
              <Camera className="w-7 h-7" /> {photos.length ? 'Otra hoja' : 'Sacar foto'}
            </button>
            <button onClick={() => galleryRef.current?.click()} disabled={busy || photos.length >= 12} className="h-24 rounded-2xl border border-slate-300 text-slate-700 font-semibold text-[14px] flex flex-col items-center justify-center gap-1.5 active:scale-[0.98] disabled:opacity-50">
              <ImagePlus className="w-6 h-6" /> De la galería
            </button>
          </div>
          {shownWarnings.length > 0 && (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-3 text-[13px] text-amber-900">
              <p className="font-bold">{shownWarnings.map((w) => warningText(w, photos.length)).join('. ')}.</p>
              <p className="mt-0.5">{PHOTO_TIP}</p>
              <div className="mt-2.5 grid grid-cols-2 gap-2">
                <button onClick={() => { const bad = new Set(shownWarnings.map((w) => files[w.index])); setPhotos((p) => { dropThumbs(p.filter((x) => bad.has(x.file))); return p.filter((x) => !bad.has(x.file)); }); cameraRef.current?.click(); }}
                  className="h-11 rounded-xl bg-amber-600 text-white font-bold text-[14px] active:scale-[0.98]">Sacar de nuevo</button>
                <button onClick={() => setAccepted((a) => new Set([...a, ...shownWarnings.map((w) => files[w.index])]))}
                  className="h-11 rounded-xl border border-amber-300 text-amber-900 font-bold text-[14px] active:scale-[0.98]">Usar igual</button>
              </div>
            </div>
          )}
          {(photos.length > 0 || preparing > 0) && (
            <div className="grid grid-cols-3 gap-2">
              {photos.map((p, i) => (
                <div key={p.thumb} className="relative aspect-[3/4] rounded-xl overflow-hidden bg-slate-100">
                  <img src={p.thumb} alt={`Hoja ${i + 1}`} decoding="async" className="w-full h-full object-cover" />
                  <span className="absolute left-1.5 top-1.5 text-[11px] font-bold bg-black/60 text-white rounded px-1.5">Hoja {i + 1}</span>
                  {!busy && <button onClick={() => remove(i)} className="absolute right-1 top-1 w-7 h-7 rounded-full bg-black/60 text-white flex items-center justify-center" aria-label="Sacar la foto"><X className="w-4 h-4" /></button>}
                </div>
              ))}
              {Array.from({ length: preparing }, (_, k) => (
                <div key={`prep${k}`} className="aspect-[3/4] rounded-xl bg-slate-100 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
                </div>
              ))}
            </div>
          )}
          {photos.length > 0 && (
            <label className="block rounded-2xl border border-slate-200 px-3.5 py-2.5">
              <span className="block text-[13px] font-bold text-slate-900">Total de la boleta <span className="font-normal text-slate-500">(opcional)</span></span>
              <span className="flex items-center gap-1 mt-0.5">
                <span className="text-[18px] font-semibold text-slate-400">$</span>
                <input inputMode="decimal" value={totalText} onChange={(e) => setTotalText(e.target.value.replace(/[^\d.,]/g, ''))} placeholder="El total a pagar, con IVA"
                  className="flex-1 min-w-0 bg-transparent outline-none text-[18px] font-bold tabular-nums text-slate-900 placeholder:text-[14px] placeholder:font-normal placeholder:text-slate-400" />
              </span>
              <span className="block mt-0.5 text-[12px] text-slate-500">Si lo ponés, la IA controla que los productos sumen eso y, si no, la vuelve a leer. Sirve sobre todo cuando el total está cortado o borroso en la foto.</span>
            </label>
          )}
          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 px-3.5 py-3">
            <input type="checkbox" checked={auto.enabled} onChange={(e) => { const v = { ...auto, enabled: e.target.checked }; setAuto(v); savePurchaseAuto(v); }} className="w-5 h-5 mt-0.5 accent-rose-600 shrink-0" />
            <span className="text-[13px] text-slate-700">
              <b className="block text-slate-900">Cargarla sola si está todo bien</b>
              Si los renglones suman el total y no hay nada dudoso: suma el stock, actualiza los precios manteniendo tu margen y crea los productos nuevos. Si algo no cierra, queda para revisar.
            </span>
          </label>
          {busy && (
            <div className="space-y-1.5">
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-rose-600 transition-[width] duration-300" style={{ width: `${job.uploadPct}%` }} /></div>
              <p className="text-center text-[12.5px] text-slate-500">Subiendo las fotos… después la lectura sigue sola y podés seguir usando la app.</p>
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}
