/**
 * Revisión visual de una boleta escaneada (2026-11-26).
 *
 * En vez de una tabla de números: a la izquierda la boleta, renglón por renglón, pintada según cómo quedó
 * (bien, para mirar, con regalo); a la derecha el renglón elegido con el PEDACITO DE FOTO donde está
 * (la IA dice dónde está cada renglón y cuánto girar la foto), "cómo lo entendí" en palabras y lo que se
 * puede hacer. Con Enter se pasa al siguiente que hay que mirar; "Está bien" lo da por revisado.
 * La tabla de siempre sigue a un toque ("Tabla"), para agregar productos o editar todo junto.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, Gift, AlertTriangle, ImageIcon, Trash2, PenLine, Eye } from 'lucide-react';
import { rowId } from './PurchaseItemsTable';
import { restockCost } from './ScanNotesPanel';
import api from '../../services/api';

export type BoletaRow = {
  productId: string; lineId?: string; name: string; quantity: number; cost: number; total: number;
  salePrice?: number; isNew?: boolean; doubtful?: boolean; reasons?: string[]; info?: string[];
  freeUnits?: number; gift?: boolean; stockOnly?: boolean; handQuantity?: number | null;
  candidates?: { id: string; name: string }[]; scanned?: any; base?: { costPrice: number; salePrice: number };
};

// "$ 43.935" o "$ 43.935,10" (nunca "$ 43.935,1")
const money = (n: number) => {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  const dec = Number.isInteger(v) ? 0 : 2;
  return `$ ${v.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`;
};
const qtyTxt = (n: number) => (Math.round((Number(n) || 0) * 1000) / 1000).toLocaleString('es-AR');
const isLook = (r: BoletaRow) => !!(r.isNew || r.doubtful);
const kindOf = (r: BoletaRow) => (isLook(r) ? 'look' : r.gift || Number(r.freeUnits) > 0 ? 'gift' : 'ok');
const KIND = {
  ok: { label: 'Bien', bar: 'border-l-emerald-500', chip: 'bg-emerald-50 text-emerald-800' },
  look: { label: 'Para mirar', bar: 'border-l-amber-500 bg-amber-50/70', chip: 'bg-amber-100 text-amber-900' },
  gift: { label: 'Con regalo', bar: 'border-l-teal-500 bg-teal-50/60', chip: 'bg-teal-50 text-teal-800' },
} as const;

/**
 * Las fotos de la boleta guardadas en la caja con la compra (si se escaneó en otro aparato: el celular u
 * otra PC). Se piden con la sesión y quedan como URLs locales. enabled=false: no pide nada.
 */
export function useStoredPhotos(purchaseId: string | null | undefined, enabled = true): string[] {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    if (!purchaseId || !enabled) { setUrls([]); return; }
    let alive = true;
    const made: string[] = [];
    (async () => {
      try {
        const { data } = await api.get(`/purchases/${purchaseId}/photos`, { silent: true } as any);
        const n = Math.min(30, Number(data?.count) || 0);
        const out: string[] = [];
        for (let k = 0; k < n; k++) {
          const r = await api.get(`/purchases/${purchaseId}/photos/${k}`, { responseType: 'blob', silent: true } as any).catch(() => null);
          if (!r) continue;
          const u = URL.createObjectURL(r.data);
          made.push(u);
          out[k] = u;
        }
        if (alive) setUrls(out); else made.forEach((u) => URL.revokeObjectURL(u));
      } catch { /* sin fotos guardadas */ }
    })();
    return () => { alive = false; made.forEach((u) => URL.revokeObjectURL(u)); };
  }, [purchaseId, enabled]);
  return urls;
}

/** De qué foto y con qué giro es un renglón: { src, box, turn } o null */
export function rowPhoto(row: { scanned?: any } | null, photos: string[], photoImages: number[] | null, turns: number[]) {
  if (!row || !photos.length) return null;
  const photo = row.scanned?.photo || null;
  const pos = photo ? (photoImages ? photoImages.indexOf(Number(photo.image)) : Number(photo.image) || 0) : photos.length === 1 ? 0 : -1;
  if (pos < 0 || !photos[pos]) return null;
  return { src: photos[pos], box: (photo?.box as number[] | null) || null, turn: Number(turns[pos]) || 0 };
}

/**
 * El pedacito de la foto donde está el renglón, derecho (girado si la foto estaba acostada) y con un poco
 * de aire arriba y abajo para ver los renglones vecinos. Sin ubicación: la foto entera, chica.
 */
export function PhotoCrop({ src, box, turn }: { src: string; box: number[] | null; turn: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    const img = new Image();
    img.onload = () => {
      const c = ref.current;
      if (!c) return;
      const W = img.naturalWidth, H = img.naturalHeight;
      let [x0, y0, x1, y1] = box ? box.map((v) => v / 1000) : [0, 0, 1, 1];
      const [bx0, by0, bx1, by1] = [x0, y0, x1, y1];
      const sideways = turn === 90 || turn === 270;
      if (box) {
        // Aire: un renglón y medio de cada lado (en la dirección de los renglones vecinos)
        if (!sideways) { const h = y1 - y0; y0 -= h * 1.5; y1 += h * 1.5; x0 -= 0.02; x1 += 0.02; }
        else { const w = x1 - x0; x0 -= w * 1.5; x1 += w * 1.5; y0 -= 0.02; y1 += 0.02; }
      }
      const cl = (v: number) => Math.max(0, Math.min(1, v));
      x0 = cl(x0); x1 = cl(x1); y0 = cl(y0); y1 = cl(y1);
      const sx = x0 * W, sy = y0 * H, sw = Math.max(1, (x1 - x0) * W), sh = Math.max(1, (y1 - y0) * H);
      const outW = sideways ? sh : sw, outH = sideways ? sw : sh;
      const k = Math.min(1, 640 / outW, (box ? 260 : 420) / outH);
      const cw = Math.round(outW * k), ch = Math.round(outH * k);
      c.width = cw; c.height = ch;
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.save();
      if (turn === 90) { ctx.translate(cw, 0); ctx.rotate(Math.PI / 2); }
      else if (turn === 180) { ctx.translate(cw, ch); ctx.rotate(Math.PI); }
      else if (turn === 270) { ctx.translate(0, ch); ctx.rotate(-Math.PI / 2); }
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw * k, sh * k);
      ctx.restore();
      // El renglón marcado (sin el aire): su franja, ya en la foto derecha
      if (box) {
        let a = sideways ? (bx0 - x0) / (x1 - x0) : (by0 - y0) / (y1 - y0);
        let b = sideways ? (bx1 - x0) / (x1 - x0) : (by1 - y0) / (y1 - y0);
        // Girada 180 o 270: lo de arriba de la foto queda abajo
        if (turn === 180 || turn === 270) [a, b] = [1 - b, 1 - a];
        ctx.strokeStyle = 'rgba(217,119,6,0.95)'; ctx.lineWidth = 2;
        ctx.strokeRect(1, Math.max(1, a * ch), cw - 2, Math.max(4, (b - a) * ch));
      }
    };
    img.onerror = () => setFailed(true);
    img.src = src;
  }, [src, box ? box.join(',') : '', turn]);
  if (failed) return <p className="text-[12px] text-slate-500">No se pudo abrir la foto.</p>;
  return <canvas ref={ref} className="max-w-full rounded-lg border border-slate-200 bg-white" />;
}

export default function InvoiceBoletaView({ items, photos, photoImages, turns, ivaMul, check, totalWithIva, onUpdate, onRemove, onAssociate, onHand, onStockOnly, onOpenPhotos }: {
  items: BoletaRow[];
  /** Fotos de la boleta (URLs), en el orden de photoImages */
  photos: string[];
  /** Número de foto de cada posición (el de la lectura); null = la foto n° k está en la posición k */
  photoImages: number[] | null;
  turns: number[];
  ivaMul: (r: BoletaRow) => number;
  check: { ok: boolean | null; message: string; printed: number | null } | null;
  totalWithIva: number;
  onUpdate: (id: string, field: string, value: any) => void;
  onRemove: (id: string) => void;
  onAssociate: (row: BoletaRow, productId: string) => void;
  onHand: (row: BoletaRow) => void;
  onStockOnly: (row: BoletaRow, on: boolean) => void;
  onOpenPhotos: () => void;
}) {
  const [onlyLook, setOnlyLook] = useState(false);
  const firstLook = items.find(isLook);
  const [sel, setSel] = useState<string | null>(firstLook ? rowId(firstLook) : items[0] ? rowId(items[0]) : null);
  const shown = onlyLook ? items.filter(isLook) : items;
  const cur = items.find((r) => rowId(r) === sel) || shown[0] || items[0] || null;
  const looks = items.filter(isLook);
  const gifted = items.reduce((s, r) => {
    const free = Number(r.freeUnits) || 0;
    return free > 0 ? s + free * restockCost(Number(r.cost) || 0, Number(r.quantity) || 0, free) * ivaMul(r) : s;
  }, 0);

  // El siguiente para mirar (después del actual; si no queda, el primero)
  const nextLook = (from: BoletaRow | null) => {
    if (!looks.length) return null;
    const i = from ? items.findIndex((r) => rowId(r) === rowId(from)) : -1;
    return items.slice(i + 1).find(isLook) || looks.find((r) => !from || rowId(r) !== rowId(from)) || null;
  };
  const go = (r: BoletaRow | null) => { if (r) setSel(rowId(r)); };
  const step = (d: number) => {
    const i = shown.findIndex((r) => cur && rowId(r) === rowId(cur));
    go(shown[Math.max(0, Math.min(shown.length - 1, i + d))] || null);
  };

  // Enter: siguiente para mirar; flechas: renglón anterior / siguiente (fuera de los campos de texto)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.key === 'Enter') { e.preventDefault(); go(nextLook(cur)); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.querySelector('[data-sel="1"]')?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  const okThis = (r: BoletaRow) => {
    onUpdate(rowId(r), 'doubtful', false);
    // El que sigue, sin contar este (ya está bien)
    const i = items.findIndex((x) => rowId(x) === rowId(r));
    go(items.slice(i + 1).find((x) => isLook(x) && rowId(x) !== rowId(r)) || items.find((x) => isLook(x) && rowId(x) !== rowId(r)) || null);
  };

  // Foto de este renglón: su posición entre las fotos, su giro y su rectángulo
  const rp = rowPhoto(cur, photos, photoImages, turns);
  const photo = rp ? { box: rp.box } : null;
  const src = rp?.src;
  const turn = rp?.turn || 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Tres respuestas de un vistazo */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-slate-100/80 px-3 py-2">
          <p className="text-[11.5px] text-slate-500">Total</p>
          {check?.ok ? <p className="text-[16px] font-semibold text-emerald-700 flex items-center gap-1"><Check className="w-4 h-4" /> Cierra</p>
            : check?.ok === false ? <p className="text-[16px] font-semibold text-red-700 flex items-center gap-1"><AlertTriangle className="w-4 h-4" /> No cierra</p>
            : <p className="text-[16px] font-semibold text-slate-600">Sin total</p>}
          <p className="text-[11.5px] text-slate-500 tabular-nums">{money(totalWithIva)}{check?.printed ? ` / boleta ${money(check.printed)}` : ''}</p>
        </div>
        <button type="button" onClick={() => go(nextLook(null))} className="rounded-xl bg-slate-100/80 px-3 py-2 text-left cursor-pointer hover:bg-slate-200/70">
          <p className="text-[11.5px] text-slate-500">Para mirar</p>
          <p className={`text-[16px] font-semibold ${looks.length ? 'text-amber-700' : 'text-emerald-700'}`}>{looks.length ? `${looks.length} de ${items.length}` : 'Ninguno'}</p>
          <p className="text-[11.5px] text-slate-500">{looks.length ? 'Enter: el siguiente' : 'Todo revisado'}</p>
        </button>
        <div className="rounded-xl bg-slate-100/80 px-3 py-2">
          <p className="text-[11.5px] text-slate-500">Regalo</p>
          <p className={`text-[16px] font-semibold ${gifted > 0 ? 'text-teal-700' : 'text-slate-400'}`}>{gifted > 0 ? `$ ${Math.round(gifted).toLocaleString('es-AR')}` : 'No vino'}</p>
          <p className="text-[11.5px] text-slate-500">{gifted > 0 ? 'que no pagaste' : 'sin bonificación'}</p>
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] items-start">
        {/* La boleta, renglón por renglón */}
        <div className="rounded-2xl border border-slate-300 bg-white overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200">
            <span className="flex-1 text-[12px] text-slate-500">{items.length} renglones · tocá uno</span>
            <label className="inline-flex items-center gap-1.5 text-[12px] text-slate-600 cursor-pointer">
              <input type="checkbox" checked={onlyLook} onChange={(e) => setOnlyLook(e.target.checked)} className="w-3.5 h-3.5 accent-amber-600" /> Solo lo dudoso
            </label>
          </div>
          <div ref={listRef} className="max-h-[520px] overflow-y-auto">
            {shown.map((r) => {
              const k = KIND[kindOf(r)];
              const active = cur && rowId(r) === rowId(cur);
              return (
                <button key={rowId(r)} type="button" data-sel={active ? '1' : '0'} onClick={() => setSel(rowId(r))}
                  className={`w-full text-left grid grid-cols-[44px_minmax(0,1fr)_auto] gap-2 px-3 py-2 border-l-4 border-b border-b-slate-100 font-mono text-[12px] cursor-pointer ${k.bar} ${active ? 'outline outline-2 -outline-offset-2 outline-sky-500' : 'hover:bg-slate-50'}`}>
                  <span className="tabular-nums text-slate-700">{qtyTxt(r.quantity)}</span>
                  <span className="truncate text-slate-800">
                    {r.scanned?.name || r.name}
                    {Number(r.freeUnits) > 0 && <span className="ml-1 text-teal-700">+{qtyTxt(Number(r.freeUnits))}</span>}
                    {r.handQuantity !== null && r.handQuantity !== undefined && <span className="ml-1 text-red-600">a mano</span>}
                  </span>
                  <span className="tabular-nums text-slate-700">{money(Number(r.total) * ivaMul(r))}</span>
                </button>
              );
            })}
            {!shown.length && <p className="px-3 py-6 text-center text-[13px] text-emerald-700">No queda nada para mirar.</p>}
          </div>
          <div className="flex flex-wrap gap-3 px-3 py-2 border-t border-slate-200 text-[11.5px] text-slate-500">
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> bien</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> para mirar</span>
            <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-teal-500" /> con regalo</span>
          </div>
        </div>

        {/* El renglón elegido */}
        {cur && (
          <div className="rounded-2xl border border-slate-300 bg-white p-4 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-md ${KIND[kindOf(cur)].chip}`}>{KIND[kindOf(cur)].label}</span>
              <span className="flex-1" />
              <button type="button" onClick={() => step(-1)} aria-label="Renglón anterior" className="w-8 h-8 rounded-lg border border-slate-300 flex items-center justify-center hover:bg-slate-50 cursor-pointer"><ChevronLeft className="w-4 h-4" /></button>
              <button type="button" onClick={() => step(1)} aria-label="Renglón siguiente" className="w-8 h-8 rounded-lg border border-slate-300 flex items-center justify-center hover:bg-slate-50 cursor-pointer"><ChevronRight className="w-4 h-4" /></button>
            </div>

            {/* El pedacito de foto */}
            {src ? (
              <div>
                <PhotoCrop src={src} box={photo?.box || null} turn={turn} />
                <button type="button" onClick={onOpenPhotos} className="mt-1 inline-flex items-center gap-1 text-[12px] text-sky-700 hover:underline cursor-pointer"><Eye className="w-3.5 h-3.5" /> Ver la foto entera</button>
                {!photo?.box && <p className="text-[11.5px] text-slate-500">La IA no marcó dónde está este renglón: buscalo en la foto.</p>}
              </div>
            ) : (
              <p className="text-[12px] text-slate-500 flex items-center gap-1.5"><ImageIcon className="w-4 h-4" /> Esta boleta no tiene foto guardada (se cargó por WhatsApp, desde un archivo o antes de que se guardaran las fotos).</p>
            )}

            <div>
              <p className="text-[11.5px] text-slate-500">En la boleta</p>
              <p className="font-mono text-[13px] text-slate-800">{qtyTxt(cur.scanned?.quantity ?? cur.quantity)} · {cur.scanned?.name || cur.name}</p>
            </div>
            <div>
              <p className="text-[11.5px] text-slate-500">Es tu producto</p>
              {cur.isNew ? (
                <div>
                  <p className="text-[14px] font-semibold text-sky-800">Producto nuevo: se crea al confirmar</p>
                  {cur.candidates?.length ? (
                    <div className="mt-1 flex flex-wrap gap-1">
                      <span className="text-[12px] text-slate-500">¿Es alguno de estos?</span>
                      {cur.candidates.slice(0, 4).map((c) => (
                        <button key={c.id} type="button" onClick={() => onAssociate(cur, c.id)} className="h-7 px-2.5 rounded-full border border-sky-200 bg-sky-50 text-[12px] font-semibold text-sky-800 hover:bg-sky-100 cursor-pointer">{c.name}</button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : <p className="text-[14px] font-semibold text-slate-900">{cur.scanned?.product?.name || cur.name}</p>}
            </div>
            {cur.scanned?.explain && (
              <div>
                <p className="text-[11.5px] text-slate-500">Cómo lo entendí</p>
                <p className="text-[13px] text-slate-800 leading-snug">{cur.scanned.explain}</p>
              </div>
            )}
            {cur.info?.length ? <p className="text-[12.5px] text-teal-800 leading-snug flex gap-1.5"><Gift className="w-4 h-4 shrink-0 mt-0.5" />{cur.info.join(' · ')}</p> : null}
            {cur.doubtful && cur.reasons?.length && !(cur.isNew && cur.reasons.length === 1 && cur.reasons[0] === 'producto nuevo')
              ? <p className="text-[12.5px] text-amber-800 leading-snug flex gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{cur.reasons.join(' · ')}</p> : null}

            {/* Corregir acá mismo */}
            <div className="grid grid-cols-3 gap-2">
              <label className="text-[11.5px] text-slate-500">Cantidad
                <input type="number" value={cur.quantity} onChange={(e) => onUpdate(rowId(cur), 'quantity', e.target.value)} className="mt-0.5 w-full h-9 px-2 rounded-lg border border-slate-300 text-[14px] text-slate-900 tabular-nums" />
              </label>
              <label className="text-[11.5px] text-slate-500">Costo c/u
                <input type="number" step="0.01" value={cur.cost} onChange={(e) => onUpdate(rowId(cur), 'cost', e.target.value)} className="mt-0.5 w-full h-9 px-2 rounded-lg border border-slate-300 text-[14px] text-slate-900 tabular-nums" />
              </label>
              <label className="text-[11.5px] text-slate-500">Precio de venta
                <input type="number" value={cur.salePrice ?? ''} disabled={!!cur.stockOnly} onChange={(e) => onUpdate(rowId(cur), 'salePrice', e.target.value)} className="mt-0.5 w-full h-9 px-2 rounded-lg border border-slate-300 text-[14px] text-slate-900 tabular-nums disabled:bg-slate-50 disabled:text-slate-400" />
              </label>
            </div>
            {!cur.isNew && cur.base && cur.base.salePrice > 0 && !cur.stockOnly && Number(cur.salePrice) !== cur.base.salePrice && (
              <p className="text-[12px] text-slate-500 -mt-1">Antes {money(cur.base.salePrice)} → ahora {money(Number(cur.salePrice) || 0)}</p>
            )}
            {!cur.isNew && (cur.stockOnly || cur.info?.some((t) => t.startsWith('boleta del'))) && (
              <label className="inline-flex items-center gap-1.5 text-[12.5px] text-slate-700 cursor-pointer">
                <input type="checkbox" checked={!!cur.stockOnly} onChange={(e) => onStockOnly(cur, e.target.checked)} className="w-4 h-4 accent-amber-600" />
                Solo sumar stock (no cambiar costo ni precio)
              </label>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              {cur.handQuantity !== null && cur.handQuantity !== undefined && (
                <button type="button" onClick={() => onHand(cur)} className="h-9 px-3 rounded-lg border border-amber-300 bg-amber-50 text-[13px] font-semibold text-amber-900 hover:bg-amber-100 cursor-pointer inline-flex items-center gap-1.5">
                  <PenLine className="w-4 h-4" /> {cur.handQuantity === 0 ? 'Sacarlo: no vino' : `Usar ${qtyTxt(cur.handQuantity)} (anotado a mano)`}
                </button>
              )}
              {isLook(cur) && !cur.isNew && (
                <button type="button" onClick={() => okThis(cur)} className="h-9 px-3 rounded-lg bg-slate-900 text-white text-[13px] font-semibold hover:bg-slate-800 cursor-pointer inline-flex items-center gap-1.5">
                  <Check className="w-4 h-4" /> Está bien
                </button>
              )}
              {looks.length > 0 && (
                <button type="button" onClick={() => go(nextLook(cur))} className="h-9 px-3 rounded-lg border border-slate-300 text-[13px] font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer inline-flex items-center gap-1.5">
                  Siguiente para mirar <ChevronRight className="w-4 h-4" />
                </button>
              )}
              <span className="flex-1" />
              <button type="button" onClick={() => { const n = nextLook(cur); onRemove(rowId(cur)); go(n); }} className="h-9 px-3 rounded-lg text-[13px] text-red-700 hover:bg-red-50 cursor-pointer inline-flex items-center gap-1.5">
                <Trash2 className="w-4 h-4" /> Sacar renglón
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
