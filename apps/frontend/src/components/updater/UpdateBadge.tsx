import { useEffect, useRef, useState } from 'react';
import { ArrowDownToLine } from 'lucide-react';
import { useUpdaterStore } from '../../stores/updaterStore';

/**
 * Aviso discreto de versión nueva para la barra superior: un ícono con un puntito. No
 * tapa nada ni interrumpe; al tocarlo se elige actualizar ahora o al volver a abrir Ventra.
 */
export default function UpdateBadge({ className = '' }: { className?: string }) {
  const status = useUpdaterStore((s) => s.status);
  const version = useUpdaterStore((s) => s.version);
  const installing = useUpdaterStore((s) => s.installing);
  const postponed = useUpdaterStore((s) => s.postponed);
  const install = useUpdaterStore((s) => s.install);
  const postpone = useUpdaterStore((s) => s.postpone);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  if (status !== 'ready' || !version || installing) return null;

  return (
    <div ref={ref} className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title={postponed ? `Versión ${version}: se instala al volver a abrir Ventra` : `Versión ${version} lista para instalar`}
        className="relative flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
      >
        <ArrowDownToLine strokeWidth={2.25} className="w-4 h-4" />
        {!postponed && <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-slate-900" />}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-64 z-[60] rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg p-3 text-left">
          <p className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Versión {version} lista</p>
          <p className="text-[12px] text-slate-500 dark:text-slate-400 mt-0.5">
            {postponed
              ? 'Se va a instalar sola la próxima vez que abras Ventra.'
              : 'Tarda unos segundos y la app se vuelve a abrir sola.'}
          </p>
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={() => { setOpen(false); install(); }}
              className="flex-1 h-8 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 text-[12px] font-semibold cursor-pointer transition-colors"
            >
              Actualizar ahora
            </button>
            {!postponed && (
              <button
                type="button"
                onClick={() => { postpone(); setOpen(false); }}
                className="h-8 px-2.5 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-[12px] font-semibold cursor-pointer transition-colors"
              >
                Al reabrir
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
