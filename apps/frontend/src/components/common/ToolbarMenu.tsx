import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export interface ToolbarMenuItem {
  label: string;
  description?: string;
  icon?: React.ReactNode;
  onClick: () => void;
  badge?: string | number;
  danger?: boolean;
  disabled?: boolean;
}

interface ToolbarMenuProps {
  label: string;
  icon: React.ReactNode;
  items: ToolbarMenuItem[];
  /** Punto de color para avisar que hay algo pendiente adentro */
  alert?: boolean;
  className?: string;
}

/** Botón de barra de herramientas que agrupa acciones en un menú desplegable. */
export default function ToolbarMenu({ label, icon, items, alert, className = '' }: ToolbarMenuProps) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  // El menú se dibuja fuera de la barra (portal) porque el recuadro la recorta
  const MENU_WIDTH = 256;
  useLayoutEffect(() => {
    if (!open || !buttonRef.current) return;
    const place = () => {
      const r = buttonRef.current!.getBoundingClientRect();
      setPosition({
        top: r.bottom + 4,
        left: Math.max(8, Math.min(r.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const visible = items.filter(i => !i.disabled);
  if (visible.length === 0) return null;

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        onClick={() => setOpen(v => !v)}
        className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-bold transition-all active:scale-[0.97] cursor-pointer shadow-sm border ${className || 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'}`}
      >
        {icon}
        <span>{label}</span>
        {alert && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && position && createPortal(
        <>
          <div className="fixed inset-0 z-[300]" onClick={() => setOpen(false)} />
          <div
            style={{ top: position.top, left: position.left, width: MENU_WIDTH }}
            className="fixed z-[301] bg-white border border-slate-200 rounded-xl shadow-xl py-1 overflow-hidden max-h-[70vh] overflow-y-auto"
          >
            {visible.map(item => (
              <button
                key={item.label}
                onClick={() => { setOpen(false); item.onClick(); }}
                className={`w-full text-left px-3 py-2 flex items-start gap-2 transition-colors ${item.danger ? 'hover:bg-red-50 text-red-700' : 'hover:bg-slate-50 text-slate-800'}`}
              >
                {item.icon && <span className="mt-0.5 shrink-0">{item.icon}</span>}
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold truncate">
                    {item.label}
                    {item.badge !== undefined && (
                      <span className="ml-1.5 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-bold">{item.badge}</span>
                    )}
                  </span>
                  {item.description && <span className="block text-[11px] text-slate-500 leading-tight">{item.description}</span>}
                </span>
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </div>
  );
}
