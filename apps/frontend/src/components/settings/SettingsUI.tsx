import { useState, type ReactNode } from 'react';
import toast from 'react-hot-toast';
import { Loader2, type LucideIcon } from 'lucide-react';

/**
 * Piezas comunes de Configuración: todas las secciones usan las mismas tarjetas, filas,
 * interruptores y campos, así se ven iguales y nadie vuelve a escribir los estilos a mano.
 */

/** Campo de texto o lista con el mismo aspecto en toda la sección. */
export const inputCls =
  'w-full min-w-0 h-10 rounded-xl border border-slate-300 bg-white px-3 text-[14px] text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/15 disabled:bg-slate-50 disabled:text-slate-500';

/** Aviso corto al guardar solo; un único toast aunque se toquen varios interruptores seguidos. */
export function toastSaved(text = 'Guardado') {
  toast.success(text, { id: 'settings-saved' });
}

/** Título de la sección, arriba del contenido. */
export function SectionHeader({ title, description, children }: { title: string; description?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div className="min-w-0">
        <h2 className="text-[20px] font-bold text-slate-900 tracking-tight">{title}</h2>
        {description && <p className="text-[13.5px] text-slate-500 mt-0.5">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 shrink-0">{children}</div>}
    </div>
  );
}

/** Dónde vale un ajuste: solo en esta PC o en todas las cajas del comercio. */
export function ScopeBadge({ scope }: { scope: 'pc' | 'store' }) {
  return (
    <span className="inline-flex items-center h-6 px-2 rounded-md bg-slate-100 text-[11.5px] font-medium text-slate-600 whitespace-nowrap">
      {scope === 'pc' ? 'Solo esta PC' : 'Para todas las cajas'}
    </span>
  );
}

export function SettingsCard({
  icon: Icon, title, description, scope, action, children, tone, className = '',
}: {
  icon?: LucideIcon;
  title: string;
  description?: ReactNode;
  scope?: 'pc' | 'store';
  action?: ReactNode;
  children?: ReactNode;
  tone?: 'danger';
  className?: string;
}) {
  const danger = tone === 'danger';
  return (
    <section className={`card p-5 sm:p-6 ${danger ? 'border-red-200' : ''} ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          {Icon && (
            <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${danger ? 'bg-red-50 text-red-600' : 'bg-rose-50 text-rose-600'}`}>
              <Icon className="w-[18px] h-[18px]" />
            </span>
          )}
          <div className="min-w-0">
            <h3 className={`text-[15px] font-bold tracking-tight ${danger ? 'text-red-700' : 'text-slate-900'}`}>{title}</h3>
            {description && <p className="text-[13px] text-slate-500 mt-0.5 leading-snug">{description}</p>}
            {/* En pantallas angostas la etiqueta va debajo, para no apretar el título */}
            {scope && <div className="sm:hidden mt-1.5"><ScopeBadge scope={scope} /></div>}
          </div>
        </div>
        {(scope || action) && (
          <div className="flex items-center gap-2 shrink-0">
            {scope && <span className="hidden sm:inline-flex"><ScopeBadge scope={scope} /></span>}
            {action}
          </div>
        )}
      </div>
      {children && <div className="mt-4">{children}</div>}
    </section>
  );
}

/** Subtítulo dentro de una tarjeta, para separar grupos de filas. */
export function GroupLabel({ children, first }: { children: ReactNode; first?: boolean }) {
  return <p className={`text-[12px] font-semibold text-slate-500 ${first ? '' : 'mt-5'} mb-1`}>{children}</p>;
}

/** Interruptor prendido/apagado. */
export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 ${checked ? 'bg-rose-600' : 'bg-slate-300'}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${checked ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
  );
}

/** Una fila de ajuste: qué es a la izquierda, el control a la derecha. */
export function SettingRow({
  title, description, children, indent, first, stack,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  indent?: boolean;
  first?: boolean;
  /** Control ancho (campo, lista): en el celular va debajo del texto en vez de al costado. */
  stack?: boolean;
}) {
  const layout = stack ? 'flex flex-col items-stretch sm:flex-row sm:items-center' : 'flex items-center';
  return (
    <div className={`${layout} justify-between gap-x-4 gap-y-2 py-3 ${first ? '' : 'border-t border-slate-100'} ${indent ? 'pl-4 ml-1 border-l-2 border-l-slate-200' : ''}`}>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-slate-800">{title}</div>
        {description && <div className="text-[12.5px] text-slate-500 leading-snug mt-0.5">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/** Fila con interruptor (el caso más común). */
export function ToggleRow({
  title, description, checked, onChange, indent, first, disabled,
}: {
  title: string;
  description?: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  indent?: boolean;
  first?: boolean;
  disabled?: boolean;
}) {
  return (
    <SettingRow title={title} description={description} indent={indent} first={first}>
      <Toggle checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </SettingRow>
  );
}

/** Campo con su etiqueta y una ayuda opcional debajo. */
export function Field({ label, hint, required, children, className = '' }: { label: string; hint?: ReactNode; required?: boolean; children: ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="block text-[12.5px] font-semibold text-slate-600 mb-1.5">
        {label}{required && <span className="text-rose-600"> *</span>}
      </span>
      {children}
      {hint && <span className="block text-[12px] text-slate-500 mt-1.5 leading-snug">{hint}</span>}
    </label>
  );
}

/**
 * Acción que borra datos: el botón abre una confirmación que pide escribir una palabra.
 * Toda la lógica de "escribí X para confirmar" vive acá, igual para todas.
 */
export function DangerAction({
  title, description, buttonLabel, word, onConfirm, severe, first,
}: {
  title: string;
  description: ReactNode;
  buttonLabel: string;
  word: string;
  onConfirm: () => Promise<boolean | void>;
  /** La más grave: botón rojo lleno. */
  severe?: boolean;
  first?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = typed.trim().toUpperCase() === word;
  const close = () => { setOpen(false); setTyped(''); };

  const confirm = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try {
      const done = await onConfirm();
      if (done !== false) close();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`py-4 ${first ? 'pt-0' : 'border-t border-slate-100'}`}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-slate-800">{title}</div>
          <div className="text-[12.5px] text-slate-500 leading-snug mt-0.5">{description}</div>
        </div>
        {!open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className={`h-9 px-3.5 rounded-xl text-[13px] font-semibold shrink-0 transition-colors cursor-pointer ${severe ? 'bg-red-600 hover:bg-red-700 text-white' : 'border border-red-200 bg-white text-red-600 hover:bg-red-50'}`}
          >
            {buttonLabel}
          </button>
        )}
      </div>
      {open && (
        <div className="mt-3 p-4 rounded-xl bg-red-50/60 border border-red-200 space-y-3">
          <p className="text-[13px] text-red-800">
            Para confirmar, escribí <b className="font-bold">{word}</b>. No se puede deshacer.
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') confirm(); if (e.key === 'Escape') close(); }}
              className={`${inputCls} sm:flex-1 border-red-200 focus:border-red-500 focus:ring-red-500/15`}
              placeholder={word}
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={confirm}
                disabled={!ok || busy}
                className="h-10 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white text-[13px] font-semibold disabled:bg-slate-200 disabled:text-slate-500 disabled:cursor-not-allowed cursor-pointer inline-flex items-center gap-1.5"
              >
                {busy && <Loader2 className="w-4 h-4 animate-spin" />} {buttonLabel}
              </button>
              <button type="button" onClick={close} disabled={busy} className="h-10 px-4 rounded-xl border border-slate-300 bg-white text-slate-700 text-[13px] font-semibold hover:bg-slate-50 cursor-pointer">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
