/**
 * Revisión de boleta en el celular, de a un renglón (2026-11-26): una tarjeta con el pedacito de foto de ese
 * renglón, lo que se leyó, "cómo lo entendí" y botones grandes. Se pasa deslizando (o con las flechas), y la
 * barrita de colores de arriba muestra toda la boleta: verde bien, ámbar para mirar, turquesa con regalo.
 * Tocando un color se salta a ese renglón. La lista de siempre sigue a un toque.
 */
import { useRef, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, PenLine, Pencil, Gift, AlertTriangle, ImageIcon } from 'lucide-react';
import { PhotoCrop, rowPhoto } from '../products/InvoiceBoletaView';
import { money, qty } from './ui';

export type CardLine = {
  name: string; quantity: number; cost: number; product?: { id: string; name: string } | null; candidates?: any[];
  doubtful?: boolean; reasons?: string[]; info?: string[]; freeUnits?: number; gift?: boolean; handQuantity?: number | null;
  explain?: string; photo?: any; suggestedSalePrice?: number; edited?: boolean; [k: string]: any;
};

export const lineLooks = (l: CardLine) => !l.edited && !!(l.doubtful || (!l.product && l.candidates?.length));
const kindOf = (l: CardLine) => (lineLooks(l) ? 'look' : l.gift || Number(l.freeUnits) > 0 ? 'gift' : 'ok');
const COLORS = { ok: 'bg-emerald-500', look: 'bg-amber-500', gift: 'bg-teal-500' } as const;
const CHIP = { ok: ['Bien', 'bg-emerald-50 text-emerald-800'], look: ['Para mirar', 'bg-amber-100 text-amber-900'], gift: ['Con regalo', 'bg-teal-50 text-teal-800'] } as const;

export default function InvoiceCards({ lines, photos, photoImages, turns, onOk, onHand, onEdit }: {
  lines: CardLine[];
  photos: string[];
  photoImages: number[] | null;
  turns: number[];
  /** "Está bien": lo da por revisado */
  onOk: (i: number) => void;
  /** Usar la cantidad anotada a mano */
  onHand: (i: number) => void;
  /** Abre el editor de siempre (producto, cantidad, costo, precio) */
  onEdit: (i: number) => void;
}) {
  const firstLook = lines.findIndex(lineLooks);
  const [i, setI] = useState(firstLook >= 0 ? firstLook : 0);
  const cur = lines[Math.min(i, lines.length - 1)];
  const touch = useRef<number | null>(null);
  if (!cur) return null;
  const at = Math.min(i, lines.length - 1);
  const go = (k: number) => setI(Math.max(0, Math.min(lines.length - 1, k)));
  const nextLook = () => {
    const after = lines.findIndex((l, k) => k > at && lineLooks(l));
    const any = after >= 0 ? after : lines.findIndex((l, k) => k !== at && lineLooks(l));
    return any;
  };
  const looks = lines.filter(lineLooks).length;
  const k = kindOf(cur);
  const rp = rowPhoto({ scanned: cur }, photos, photoImages, turns);
  const ok = () => {
    onOk(at);
    const n = lines.findIndex((l, j) => j > at && lineLooks(l));
    if (n >= 0) go(n);
    else if (at < lines.length - 1) go(at + 1);
  };

  return (
    <div>
      {/* Toda la boleta en una barrita: tocá un color para ir a ese renglón */}
      <div className="flex gap-[3px] px-0.5" role="tablist" aria-label="Renglones de la boleta">
        {lines.map((l, j) => (
          <button key={j} type="button" aria-label={`Renglón ${j + 1}`} onClick={() => go(j)}
            className={`flex-1 h-2.5 rounded-full ${COLORS[kindOf(l)]} ${j === at ? 'ring-2 ring-offset-1 ring-slate-900' : 'opacity-80'}`} />
        ))}
      </div>
      <div className="flex items-center justify-between mt-2 px-1">
        <span className="text-[12.5px] text-slate-500">Renglón {at + 1} de {lines.length}{looks ? ` · ${looks} para mirar` : ' · todo revisado'}</span>
        {looks > 0 && nextLook() >= 0 && (
          <button type="button" onClick={() => go(nextLook())} className="text-[12.5px] font-semibold text-amber-800">Siguiente para mirar →</button>
        )}
      </div>

      {/* La tarjeta: se desliza a los costados para pasar de renglón */}
      <div className="mt-2 rounded-2xl border border-slate-200 bg-white p-3.5 space-y-3"
        onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          if (touch.current === null) return;
          const dx = e.changedTouches[0].clientX - touch.current;
          touch.current = null;
          if (Math.abs(dx) > 50) go(at + (dx < 0 ? 1 : -1));
        }}>
        <div className="flex items-center gap-2">
          <span className={`text-[12px] font-semibold px-2 py-0.5 rounded-md ${CHIP[k][1]}`}>{CHIP[k][0]}</span>
          <span className="flex-1" />
          <button type="button" onClick={() => go(at - 1)} disabled={at === 0} aria-label="Anterior" className="w-9 h-9 rounded-xl border border-slate-300 flex items-center justify-center disabled:opacity-30"><ChevronLeft className="w-5 h-5" /></button>
          <button type="button" onClick={() => go(at + 1)} disabled={at === lines.length - 1} aria-label="Siguiente" className="w-9 h-9 rounded-xl border border-slate-300 flex items-center justify-center disabled:opacity-30"><ChevronRight className="w-5 h-5" /></button>
        </div>

        {rp ? <PhotoCrop src={rp.src} box={rp.box} turn={rp.turn} />
          : <p className="text-[12px] text-slate-500 flex items-center gap-1.5"><ImageIcon className="w-4 h-4" /> Sin foto de esta boleta</p>}

        <div>
          <p className="text-[11.5px] text-slate-500">En la boleta</p>
          <p className="font-mono text-[13.5px] text-slate-900">{qty(cur.quantity)} · {cur.name}</p>
        </div>
        <div>
          <p className="text-[11.5px] text-slate-500">Es tu producto</p>
          <p className={`text-[15px] font-semibold ${cur.product ? 'text-slate-900' : 'text-sky-800'}`}>{cur.product?.name || 'Producto nuevo (se crea al confirmar)'}</p>
        </div>
        {cur.explain && (
          <div>
            <p className="text-[11.5px] text-slate-500">Cómo lo entendí</p>
            <p className="text-[13.5px] text-slate-800 leading-snug">{cur.explain}</p>
          </div>
        )}
        {Array.isArray(cur.info) && cur.info.length > 0 && <p className="text-[12.5px] text-teal-800 leading-snug flex gap-1.5"><Gift className="w-4 h-4 shrink-0 mt-0.5" />{cur.info.join(' · ')}</p>}
        {lineLooks(cur) && (cur.reasons || []).length > 0 && <p className="text-[12.5px] text-amber-800 leading-snug flex gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />{(cur.reasons || []).join(' · ')}</p>}
        <p className="text-[13px] text-slate-600 tabular-nums">{qty(cur.quantity)} × {money(cur.cost)} sin IVA = <b className="text-slate-900">{money(cur.quantity * cur.cost)}</b>{cur.suggestedSalePrice ? ` · venta ${money(cur.suggestedSalePrice)}` : ''}</p>

        <div className="grid gap-2">
          {cur.handQuantity !== null && cur.handQuantity !== undefined && (
            <button type="button" onClick={() => onHand(at)} className="h-12 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 font-semibold text-[14.5px] flex items-center justify-center gap-2">
              <PenLine className="w-5 h-5" /> {Number(cur.handQuantity) === 0 ? 'Sacarlo: no vino (anotado a mano)' : `Usar ${qty(Number(cur.handQuantity))} (anotado a mano)`}
            </button>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => onEdit(at)} className="h-12 rounded-xl border border-slate-300 text-slate-700 font-semibold text-[14.5px] flex items-center justify-center gap-2"><Pencil className="w-4 h-4" /> Corregir</button>
            <button type="button" onClick={ok} className="h-12 rounded-xl bg-slate-900 text-white font-semibold text-[14.5px] flex items-center justify-center gap-2"><Check className="w-5 h-5" /> Está bien</button>
          </div>
        </div>
      </div>
      <p className="mt-1.5 text-center text-[11.5px] text-slate-400">Deslizá la tarjeta para pasar de renglón</p>
    </div>
  );
}
