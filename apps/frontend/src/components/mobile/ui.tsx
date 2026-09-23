import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

/** Piezas compartidas de la app móvil del dueño: mismo look en todas las pestañas. */

export const money = (n: number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);

export const qty = (n: number) => String(Math.round((n || 0) * 1000) / 1000).replace('.', ',');

export const METHOD_LABELS: Record<string, string> = {
  CASH: 'Efectivo', CLOVER: 'Tarjeta', MERCADOPAGO: 'Mercado Pago', DEBT: 'Cuenta corriente',
  TRANSFER: 'Transferencia', CARD: 'Tarjeta', DEBIT: 'Débito', CREDIT: 'Crédito', MIXED: 'Pago mixto',
};

/**
 * Encabezado verde de cada pestaña, como en una app nativa: se extiende debajo de la
 * barra de estado del celular, título grande en blanco, acción a la derecha y
 * contenido opcional abajo (buscador, filtros).
 */
export function ScreenHeader({ title, subtitle, action, children, back }: { title: string; subtitle?: string; action?: React.ReactNode; children?: React.ReactNode; back?: boolean }) {
  const navigate = useNavigate();
  return (
    <header className="shrink-0 bg-rose-600 text-white px-4 pt-[calc(env(safe-area-inset-top)+0.9rem)] pb-4 rounded-b-[24px] shadow-[0_6px_20px_-12px_rgba(14,110,82,0.8)] relative z-10">
      <div className="flex items-center justify-between gap-3 min-h-[40px]">
        {back && (
          <button onClick={() => navigate(-1)} className="w-10 h-10 -ml-2 -mr-1 rounded-full flex items-center justify-center shrink-0 active:bg-white/15" aria-label="Volver">
            <ChevronLeft className="w-6 h-6" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-[22px] font-bold tracking-tight leading-tight">{title}</h1>
          {subtitle && <p className="text-[12px] text-rose-100 truncate">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children && <div className="mt-3">{children}</div>}
    </header>
  );
}

/** Botón de acción del encabezado verde (lima, el acento de Ventra). */
export function HeaderAction({ icon: Icon, label, onClick }: { icon: any; label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="h-10 px-3.5 rounded-full bg-orange-200 text-orange-900 flex items-center gap-1.5 shrink-0 active:scale-95 transition-transform">
      <Icon className="w-[18px] h-[18px]" />
      <span className="text-[13px] font-bold">{label}</span>
    </button>
  );
}

/** Estilo de los buscadores dentro del encabezado verde. */
export const headerInput = 'w-full h-11 rounded-2xl bg-white text-[15px] text-slate-900 placeholder:text-slate-400 outline-none shadow-sm focus:ring-2 focus:ring-orange-200';

/** Píldoras de filtro (van sobre el encabezado verde), con desplazamiento horizontal. */
export function Chips<T extends string>({ options, value, onChange }: { options: { id: T; label: string; count?: number }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4">
      {options.map((o) => {
        const on = o.id === value;
        return (
          <button
            key={o.id}
            onClick={() => onChange(o.id)}
            className={`shrink-0 h-8 px-3.5 rounded-full text-[12.5px] font-semibold transition-colors ${
              on ? 'bg-white text-rose-700' : 'bg-white/10 text-white active:bg-white/20 ring-1 ring-inset ring-white/20'
            }`}
          >
            {o.label}
            {o.count !== undefined && <span className={`ml-1.5 ${on ? 'text-rose-400' : 'text-rose-100/80'}`}>{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Hoja que sube desde abajo (estilo app nativa). Se cierra tocando afuera, con la X o arrastrando hacia abajo. */
export function Sheet({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] keep-animated mobile-app">
          <motion.div
            className="absolute inset-0 bg-slate-900/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            className="absolute inset-x-0 bottom-0 max-h-[92dvh] flex flex-col bg-white rounded-t-[26px] shadow-2xl"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 420, damping: 40 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => { if (info.offset.y > 120 || info.velocity.y > 600) onClose(); }}
          >
            <div className="pt-2.5 pb-1 flex justify-center shrink-0">
              <span className="w-10 h-1.5 rounded-full bg-slate-200" />
            </div>
            {title && (
              <div className="flex items-center justify-between px-5 pb-2 shrink-0">
                <h2 className="text-[17px] font-semibold text-slate-900">{title}</h2>
                <button onClick={onClose} className="w-8 h-8 -mr-1 rounded-full bg-slate-100 flex items-center justify-center" aria-label="Cerrar">
                  <X className="w-4 h-4 text-slate-500" />
                </button>
              </div>
            )}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 pb-4" onPointerDownCapture={(e) => e.stopPropagation()}>
              {children}
            </div>
            {footer && <div className="shrink-0 px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.9rem)] border-t border-slate-100">{footer}</div>}
            {!footer && <div className="shrink-0 pb-[env(safe-area-inset-bottom)]" />}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function PrimaryButton({ children, onClick, disabled, loading, tone = 'brand', className = '' }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; loading?: boolean; tone?: 'brand' | 'danger'; className?: string;
}) {
  const colors = tone === 'danger' ? 'bg-red-600 active:bg-red-700' : 'bg-rose-600 active:bg-rose-700';
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      className={`w-full h-12 rounded-2xl text-white text-[15px] font-semibold flex items-center justify-center gap-2 transition-all active:scale-[0.99] disabled:opacity-40 ${colors} ${className}`}
    >
      {loading ? <span className="w-5 h-5 border-2 border-white/40 border-t-white rounded-full animate-spin" /> : children}
    </button>
  );
}

/** Campo de monto grande con teclado numérico del celular. */
export function MoneyInput({ value, onChange, autoFocus, placeholder = '0' }: { value: string; onChange: (v: string) => void; autoFocus?: boolean; placeholder?: string }) {
  return (
    <div className="flex items-center gap-1 h-16 px-4 rounded-2xl bg-slate-50 border border-slate-200 focus-within:border-rose-500 focus-within:bg-white transition-colors">
      <span className="text-[26px] font-semibold text-slate-400">$</span>
      <input
        inputMode="decimal"
        autoFocus={autoFocus}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/[^\d.,]/g, ''))}
        className="flex-1 min-w-0 bg-transparent outline-none text-[28px] font-bold tracking-tight text-slate-900 tabular-nums placeholder:text-slate-300"
      />
    </div>
  );
}

/** "1.500" → 1500, "1.500,50" → 1500.5, "10,5" → 10.5 y también "10.50" → 10.5 (teclados que solo tienen punto). */
export const parseAmount = (v: string) => {
  const s = v.trim();
  const normalized = s.includes(',')
    ? s.replace(/\./g, '').replace(',', '.')
    : /^\d+\.\d{1,2}$/.test(s) ? s : s.replace(/\./g, '');
  const n = parseFloat(normalized);
  return isNaN(n) ? 0 : n;
};

export function EmptyState({ icon: Icon, title, text, action }: { icon: any; title: string; text?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center px-8 py-14">
      <span className="w-14 h-14 rounded-2xl bg-rose-50 flex items-center justify-center">
        <Icon className="w-6 h-6 text-rose-600" />
      </span>
      <p className="mt-4 text-[15px] font-semibold text-slate-800">{title}</p>
      {text && <p className="mt-1 text-[13px] text-slate-500">{text}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="p-4 space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-16 rounded-2xl bg-white border border-slate-100 animate-pulse" />
      ))}
    </div>
  );
}
