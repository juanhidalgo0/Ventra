import { useEffect, useState } from 'react';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import { toast } from 'react-hot-toast';
import api from '../../services/api';

/** quantity null = todo el stock sin lote asignado (lo resuelve el servidor). */
export interface PendingLot { expiresAt: string; quantity: number | null }

interface Props {
  /** Producto ya guardado: los lotes se guardan al instante. Sin id, quedan pendientes hasta crear el producto. */
  productId?: string;
  pending: PendingLot[];
  onPendingChange: (lots: PendingLot[]) => void;
  alertDays: number;
}

const DAY = 86400000;

export function daysUntil(date: string | Date) {
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  const t = new Date(); t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / DAY);
}

export function expiryLabel(days: number) {
  if (days < 0) return { text: `Vencido hace ${-days} d`, cls: 'bg-rose-100 text-rose-700' };
  if (days === 0) return { text: 'Vence hoy', cls: 'bg-rose-100 text-rose-700' };
  if (days <= 7) return { text: `Vence en ${days} d`, cls: 'bg-amber-100 text-amber-700' };
  return { text: `En ${days} d`, cls: 'bg-slate-100 text-slate-600' };
}

export default function ExpiryLotsEditor({ productId, pending, onPendingChange, alertDays }: Props) {
  const [lots, setLots] = useState<any[]>([]);
  const [date, setDate] = useState('');
  const [qty, setQty] = useState('');

  useEffect(() => {
    if (!productId) return;
    api.get(`/products/${productId}/lots`).then(({ data }) => setLots(data || [])).catch(() => {});
  }, [productId]);

  const add = async () => {
    if (!date) { toast.error('Elegí la fecha de vencimiento'); return; }
    const quantity = qty.trim() === '' ? null : Math.max(0, parseFloat(qty) || 0);
    if (!productId) {
      onPendingChange([...pending, { expiresAt: date, quantity }].sort((a, b) => a.expiresAt.localeCompare(b.expiresAt)));
    } else {
      try {
        const { data } = await api.post(`/products/${productId}/lots`, quantity === null ? { expiresAt: date } : { expiresAt: date, quantity });
        setLots(l => [...l, data].sort((a, b) => +new Date(a.expiresAt) - +new Date(b.expiresAt)));
      } catch (err: any) {
        toast.error(err.response?.data?.message || 'No se pudo agregar el lote');
        return;
      }
    }
    setDate(''); setQty('');
  };

  const remove = async (idx: number) => {
    if (!productId) { onPendingChange(pending.filter((_, i) => i !== idx)); return; }
    const lot = lots[idx];
    try {
      await api.patch(`/products/lots/${lot.id}`, { status: 'REMOVED' });
      setLots(l => l.filter(x => x.id !== lot.id));
    } catch {
      toast.error('No se pudo quitar el lote');
    }
  };

  const rows = productId
    ? lots.map(l => ({ expiresAt: l.expiresAt, quantity: l.quantity }))
    : pending;

  return (
    <div className="space-y-2">
      {rows.length === 0 && (
        <p className="text-[11.5px] text-slate-500">Todavía no cargaste vencimientos.</p>
      )}
      {rows.map((r, i) => {
        const days = daysUntil(r.expiresAt.length === 10 ? `${r.expiresAt}T12:00:00` : r.expiresAt);
        const lbl = days <= alertDays && days > 7 ? { text: `Vence en ${days} d`, cls: 'bg-amber-100 text-amber-700' } : expiryLabel(days);
        return (
          <div key={i} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2.5 py-1.5">
            <CalendarClock className="w-4 h-4 text-slate-400 shrink-0" />
            <span className="text-[13px] font-semibold text-slate-800">
              {new Date(r.expiresAt.length === 10 ? `${r.expiresAt}T12:00:00` : r.expiresAt).toLocaleDateString('es-AR')}
            </span>
            <span className="text-[12px] text-slate-500">{r.quantity === null ? 'todo el stock' : `${r.quantity} u.`}</span>
            <span className={`ml-auto text-[11px] font-bold px-2 py-0.5 rounded-full ${lbl.cls}`}>{lbl.text}</span>
            <button type="button" onClick={() => remove(i)} className="p-1 text-slate-400 hover:text-rose-600" title="Quitar">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
      <div className="flex items-center gap-2">
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="flex-1 min-w-0 h-9 rounded-lg border border-slate-300 px-2 text-[13px]" />
        <input type="number" step="any" min="0" value={qty} onChange={e => setQty(e.target.value)} placeholder="Todo" title="Opcional: vacío = todo el stock que todavía no tiene fecha"
          className="w-20 h-9 rounded-lg border border-slate-300 px-2 text-[13px]" />
        <button type="button" onClick={add}
          className="h-9 px-3 rounded-lg bg-slate-900 text-white text-[12px] font-semibold flex items-center gap-1 hover:bg-slate-700">
          <Plus className="w-3.5 h-3.5" /> Agregar
        </button>
      </div>
    </div>
  );
}
