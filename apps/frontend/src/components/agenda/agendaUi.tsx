import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { BookingStatus } from '../../services/agenda';

/** Piezas compartidas por las pantallas de la agenda (turnos, clientes y cobros). */

export const PUBLIC_BASE = 'https://tienda.ventra.store';

export const STATUS: Record<BookingStatus, { label: string; cls: string }> = {
  PENDING: { label: 'Por confirmar', cls: 'bg-amber-50 text-amber-700 ring-amber-200' },
  CONFIRMED: { label: 'Confirmado', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-200' },
  DONE: { label: 'Atendido', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
  NO_SHOW: { label: 'No vino', cls: 'bg-red-50 text-red-700 ring-red-200' },
  CANCELLED: { label: 'Cancelado', cls: 'bg-slate-100 text-slate-500 ring-slate-200' },
  BLOCK: { label: 'Bloqueado', cls: 'bg-slate-100 text-slate-600 ring-slate-200' },
  AWAITING_PAYMENT: { label: 'Esperando seña', cls: 'bg-sky-50 text-sky-700 ring-sky-200' },
};

export const input = 'w-full h-11 px-3 rounded-xl bg-slate-50 border border-slate-200 text-[14.5px] outline-none focus:border-rose-500 focus:bg-white';
export const label = 'block mb-1.5 text-[12.5px] font-medium text-slate-500';

export function Modal({ title, onClose, children, footer }: { title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  // Al cerrar con la X, el fondo o Esc, la hoja sale animada y recién después se desmonta
  const [closing, setClosing] = useState(false);
  const timer = useRef<number>();
  const close = useCallback(() => {
    if (timer.current) return;
    setClosing(true);
    timer.current = window.setTimeout(onClose, 190);
  }, [onClose]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return (
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center">
      <div className={`absolute inset-0 bg-slate-900/40 anim-veil ${closing ? 'ag-veil-out' : ''}`} onClick={close} />
      <div role="dialog" aria-modal="true" className={`relative w-full sm:max-w-lg max-h-[92dvh] flex flex-col bg-white rounded-t-[26px] sm:rounded-3xl shadow-2xl ag-sheet ${closing ? 'ag-sheet-out' : ''}`}>
        <div className="sm:hidden mx-auto mt-2 h-1 w-10 rounded-full bg-slate-200" aria-hidden />
        <div className="flex items-center gap-3 px-5 pt-4 pb-2">
          <h3 className="flex-1 text-[18px] font-bold text-slate-900">{title}</h3>
          <button onClick={close} className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center ag-press" aria-label="Cerrar"><X className="w-4 h-4 text-slate-600" /></button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-4">{children}</div>
        {footer && <div className="px-5 pt-3 pb-[calc(14px+env(safe-area-inset-bottom))] border-t border-slate-100">{footer}</div>}
      </div>
    </div>
  );
}
