import type { LucideIcon } from 'lucide-react';

// Piezas compartidas de las pantallas del panel. Todas siguen la misma escala:
// títulos 20px, etiquetas 12.5–13px en minúscula normal, cifras con números
// tabulares, bordes finos y color solo donde significa algo.

/** Encabezado de pantalla: título, descripción corta y acciones a la derecha. */
export function PageHeader({ title, description, actions, className = '' }: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col sm:flex-row sm:items-end justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <h1 className="text-[20px] font-bold text-slate-900 dark:text-white tracking-[-0.02em] leading-tight">{title}</h1>
        {description && <p className="text-[13px] text-slate-500 dark:text-slate-400 mt-1">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

/** Tarjeta con título. `action` va a la derecha del título (un link, un selector). */
export function Panel({ title, icon: Icon, action, children, className = '', bodyClassName = '' }: {
  title?: React.ReactNode;
  icon?: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col min-w-0 ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-5 pt-4 pb-3">
          {title && (
            <h2 className="flex items-center gap-2 text-[14px] font-semibold text-slate-900 dark:text-white tracking-[-0.01em] min-w-0">
              {Icon && <Icon className="w-4 h-4 text-slate-400 shrink-0" strokeWidth={2.1} />}
              <span className="truncate">{title}</span>
            </h2>
          )}
          {action}
        </header>
      )}
      <div className={`px-5 pb-5 flex-1 min-h-0 ${title || action ? '' : 'pt-5'} ${bodyClassName}`}>{children}</div>
    </section>
  );
}

type Tone = 'neutral' | 'brand' | 'success' | 'warning' | 'danger' | 'info';

const toneChip: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  brand: 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400',
  success: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400',
  warning: 'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-400',
  danger: 'bg-red-50 text-red-600 dark:bg-red-950/50 dark:text-red-400',
  info: 'bg-sky-50 text-sky-600 dark:bg-sky-950/50 dark:text-sky-400',
};

export const toneText: Record<Tone, string> = {
  neutral: 'text-slate-900 dark:text-white',
  brand: 'text-rose-700 dark:text-rose-400',
  success: 'text-emerald-700 dark:text-emerald-400',
  warning: 'text-amber-700 dark:text-amber-400',
  danger: 'text-red-600 dark:text-red-400',
  info: 'text-sky-700 dark:text-sky-400',
};

/** Indicador (KPI): etiqueta, cifra grande y una línea de contexto. */
export function StatCard({ label, value, hint, icon: Icon, tone = 'neutral', valueTone, onClick }: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: LucideIcon;
  tone?: Tone;
  valueTone?: Tone;
  onClick?: () => void;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={`text-left bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-5 flex flex-col gap-3 min-w-0 ${
        onClick ? 'cursor-pointer hover:border-slate-300 dark:hover:border-slate-600 active:scale-[0.99] transition-[border-color,transform] duration-fast' : ''
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-slate-500 dark:text-slate-400 truncate">{label}</span>
        {Icon && (
          <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${toneChip[tone]}`}>
            <Icon className="w-4 h-4" strokeWidth={2.1} />
          </span>
        )}
      </div>
      <div className={`text-[26px] font-bold tracking-[-0.03em] leading-none truncate ${toneText[valueTone || 'neutral']}`}>{value}</div>
      {hint && <div className="text-[12.5px] text-slate-500 dark:text-slate-400 truncate">{hint}</div>}
    </Tag>
  );
}

/** Estado vacío: invita a actuar en vez de solo decir "no hay nada". */
export function EmptyState({ icon: Icon, title, description, action, className = '' }: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-10 px-4 ${className}`}>
      {Icon && (
        <span className="w-11 h-11 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mb-3">
          <Icon className="w-5 h-5" strokeWidth={2} />
        </span>
      )}
      <p className="text-[14px] font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      {description && <p className="text-[12.5px] text-slate-500 dark:text-slate-400 mt-1 max-w-[280px] leading-relaxed">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Selector de opciones excluyentes (Mes / Día / Rango). */
export function Segmented<T extends string>({ options, value, onChange }: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-800">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`h-8 px-3 rounded-md text-[13px] font-medium transition-colors duration-fast cursor-pointer ${
            value === o.id
              ? 'bg-white text-slate-900 shadow-xs dark:bg-slate-700 dark:text-white'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Estilos compartidos para controles sueltos (selects, fechas, botones). */
export const ui = {
  field: 'h-9 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg px-3 text-[13px] font-medium text-slate-700 dark:text-slate-200 outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15 transition-colors',
  btn: 'h-9 inline-flex items-center justify-center gap-2 px-3.5 rounded-lg text-[13px] font-semibold transition-[background-color,border-color,transform] duration-fast active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
  btnSecondary: 'bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800 dark:border-slate-700 dark:text-slate-200',
  btnPrimary: 'bg-rose-600 hover:bg-rose-700 text-white border border-transparent',
  btnDark: 'bg-slate-900 hover:bg-slate-800 text-white border border-transparent dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100',
};
