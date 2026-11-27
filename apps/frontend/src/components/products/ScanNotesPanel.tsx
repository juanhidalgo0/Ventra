/**
 * Avisos de una boleta escaneada (2026-11-26): bonificaciones, regalos, boleta vieja, correcciones a mano,
 * descuento por forma de pago, aumentos y proveedor deducido. Los arma el backend (scanNotesFor) y los
 * muestran la PC (NewPurchaseScreen) y el celular (ReviewInvoiceSheet). Los que se resuelven con un toque
 * traen action y se muestran con su botón.
 */
import { Gift, CalendarClock, PenLine, TrendingUp, Building2, Wallet, Info, Check } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { readPurchaseAuto, roundPriceUp } from '../mobile/ScanInvoiceSheet';

export type ScanNote = { kind: string; text: string; action?: { type: string; label: string; [k: string]: any } };

const ICONS: Record<string, any> = { bonus: Gift, gift: Gift, old: CalendarClock, hand: PenLine, raise: TrendingUp, supplier: Building2, payment: Wallet };
const TONES: Record<string, string> = {
  bonus: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  gift: 'border-emerald-200 bg-emerald-50 text-emerald-900',
  old: 'border-amber-200 bg-amber-50 text-amber-900',
  hand: 'border-amber-200 bg-amber-50 text-amber-900',
  raise: 'border-rose-200 bg-rose-50 text-rose-900',
  supplier: 'border-sky-200 bg-sky-50 text-sky-900',
  payment: 'border-slate-200 bg-slate-50 text-slate-800',
};

/**
 * Costo por unidad sin el regalo (el de reposición): con 24 + 2 de regalo, lo pagado dividido 24.
 * Es el que se usa para el precio de venta, así un regalo no baja el precio. Igual que restockUnitCost del backend.
 */
export function restockCost(unitCost: number, quantity: number, freeUnits?: number | null): number {
  const free = Number(freeUnits) || 0;
  const q = Number(quantity) || 0;
  if (!(free > 0) || !(q > free)) return unitCost;
  return (unitCost * q) / (q - free);
}

/**
 * "Subir también esos": los productos de la misma línea que no vinieron en la boleta suben el mismo % que su
 * pariente (costo y precio de venta, con el redondeo de Compras). Va por el editor de precios: queda con
 * deshacer. Devuelve true si se aplicó.
 */
export async function applyRaiseGroup(action: ScanNote['action'], label: string): Promise<boolean> {
  const products: any[] = Array.isArray(action?.products) ? action!.products : [];
  if (!products.length) return false;
  const step = readPurchaseAuto().round;
  const items = products.map((p) => {
    const f = 1 + (Number(p.pct) || 0) / 100;
    return { id: p.id, prices: { costPrice: Math.round(p.costPrice * f * 100) / 100, salePrice: roundPriceUp(p.salePrice * f, step) } };
  });
  const list = products.slice(0, 12).map((p) => `• ${p.name} +${String(p.pct).replace('.', ',')}%`).join('\n');
  if (!window.confirm(`Subir ${items.length} producto${items.length === 1 ? '' : 's'} que no vinieron en esta boleta (mismo costo y misma línea que los que subieron):\n\n${list}${products.length > 12 ? `\n… y ${products.length - 12} más` : ''}\n\nSe puede deshacer desde Aumentar precios.`)) return false;
  try {
    const { data } = await api.post('/products/price-editor/apply', { items, label: label.slice(0, 200) });
    toast.success(`Listo: ${data?.updated ?? items.length} productos actualizados`);
    return true;
  } catch (err: any) {
    toast.error(err?.response?.data?.message || 'No se pudieron subir los precios');
    return false;
  }
}

export default function ScanNotesPanel({ notes, done, onAction, compact = false }: {
  notes: ScanNote[];
  /** Avisos ya resueltos (por índice): se muestran tildados y sin botón */
  done?: Set<number>;
  onAction?: (note: ScanNote, index: number) => void;
  compact?: boolean;
}) {
  if (!notes?.length) return null;
  return (
    <div className={`flex flex-col ${compact ? 'gap-1.5' : 'gap-2'}`}>
      {notes.map((n, i) => {
        const Icon = ICONS[n.kind] || Info;
        const resolved = done?.has(i);
        return (
          <div key={i} className={`rounded-xl border px-3 py-2 flex items-start gap-2.5 ${compact ? 'text-[12.5px]' : 'text-[13px]'} ${TONES[n.kind] || 'border-slate-200 bg-white text-slate-800'}`}>
            <Icon className="w-4 h-4 shrink-0 mt-0.5 opacity-80" aria-hidden />
            <p className="flex-1 min-w-0 leading-snug">{n.text}</p>
            {n.action && onAction && (resolved
              ? <span className="shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold text-emerald-700"><Check className="w-3.5 h-3.5" /> Listo</span>
              : <button type="button" onClick={() => onAction(n, i)} className="shrink-0 h-8 px-3 rounded-lg bg-slate-900 text-white text-[12px] font-bold hover:bg-slate-800 cursor-pointer">{n.action.label}</button>)}
          </div>
        );
      })}
    </div>
  );
}
