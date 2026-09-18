import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GraduationCap, PlayCircle, Keyboard, X, ChevronRight, ChevronUp } from 'lucide-react';
import { TOURS, ROUTE_HELP, ROUTE_SHORTCUTS, type TourStep, type HelpEntry } from './tours';
import { useTourStore } from './tourStore';

/** A tour is offered only if at least one of its targets is on screen right now. */
function isAvailable(entry: HelpEntry) {
  const targeted = (TOURS[entry.tour] as TourStep[]).filter((s) => s.target);
  if (targeted.length === 0) return true;
  return targeted.some((s) =>
    Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${s.target}"]`)).some((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }),
  );
}

export default function HelpMenu({ pathname, side }: { pathname: string; side: 'left' | 'right' }) {
  const entries = ROUTE_HELP[pathname];
  const shortcuts = ROUTE_SHORTCUTS[pathname];
  const start = useTourStore((s) => s.start);
  const tourActive = useTourStore((s) => !!s.activeTour);
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState<HelpEntry[]>([]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  useEffect(() => {
    if (!showShortcuts) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopImmediatePropagation(); setShowShortcuts(false); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [showShortcuts]);

  if (!entries || tourActive) return null;

  const onButton = () => {
    const list = entries.filter(isAvailable);
    // One tour and nothing else to show: skip the menu.
    if (list.length === 1 && !shortcuts) { start(list[0].tour); return; }
    setAvailable(list);
    setOpen((o) => !o);
  };

  return (
    <>
      <div ref={rootRef} className={`fixed bottom-5 z-40 ${side === 'left' ? 'left-5 hidden md:block' : 'right-5'}`}>
        {/* Menú siempre montado: solo cambia su visibilidad con CSS (sin montar/desmontar
            ni librerías de animación), así no puede aparecer un cuadro de más al abrir/cerrar. */}
        <div
              aria-hidden={!open}
              className={`keep-style absolute bottom-[52px] origin-bottom transition-[opacity,transform,visibility] duration-150 ease-out ${
                open ? 'opacity-100 translate-y-0 visible' : 'opacity-0 translate-y-1.5 invisible pointer-events-none'
              } w-[310px] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-[0_20px_50px_-12px_rgba(15,23,42,0.35)] p-2 ${side === 'left' ? 'left-0' : 'right-0'}`}
            >
              <div className="px-3 pt-2.5 pb-2">
                <p className="eyebrow">Ayuda</p>
                <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 mt-0.5">¿Qué querés aprender?</p>
              </div>
              {available.map((entry) => (
                <button
                  key={entry.tour}
                  onClick={() => { setOpen(false); start(entry.tour); }}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors group"
                >
                  <PlayCircle className="w-5 h-5 text-rose-600 shrink-0" />
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">{entry.label}</span>
                    <span className="block text-[11.5px] text-slate-500 dark:text-slate-400 leading-snug">{entry.description}</span>
                  </span>
                  <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 shrink-0" />
                </button>
              ))}
              {shortcuts && (
                <>
                  <div className="h-px bg-slate-100 dark:bg-slate-800 my-1.5 mx-2" />
                  <button
                    onClick={() => { setOpen(false); setShowShortcuts(true); }}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors group"
                  >
                    <Keyboard className="w-5 h-5 text-slate-500 shrink-0" />
                    <span className="flex-1 text-[13px] font-semibold text-slate-800 dark:text-slate-100">Atajos de teclado</span>
                    <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 shrink-0" />
                  </button>
                </>
              )}
        </div>

        <button
          onClick={onButton}
          title="Ayuda y recorridos guiados"
          aria-expanded={open}
          className={`keep-style group h-11 pl-1.5 pr-3 rounded-2xl flex items-center gap-2.5 bg-white dark:bg-slate-900 border shadow-[0_8px_24px_-8px_rgba(15,23,42,0.35)] transition-colors ${
            open ? 'border-rose-300 ring-4 ring-rose-500/15' : 'border-slate-200 dark:border-slate-700 hover:border-rose-300'
          }`}
        >
          <span className="w-8 h-8 rounded-xl bg-rose-600 text-white flex items-center justify-center shrink-0">
            <GraduationCap className="w-[18px] h-[18px]" />
          </span>
          <span className="text-[13px] font-semibold text-slate-800 dark:text-slate-100">Ayuda</span>
          <ChevronUp className={`w-4 h-4 text-slate-400 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {showShortcuts && shortcuts && createPortal(
        <div className="fixed inset-0 z-[9000] bg-slate-900/50 flex items-center justify-center p-4" onClick={() => setShowShortcuts(false)}>
          <div
            onClick={(e) => e.stopPropagation()}
            className="keep-style w-full max-w-lg max-h-[85vh] overflow-y-auto custom-scrollbar bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-2xl p-6"
          >
            <div className="flex items-start justify-between mb-5">
              <div>
                <p className="eyebrow">Ayuda</p>
                <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100 mt-1">Atajos de teclado</h2>
              </div>
              <button onClick={() => setShowShortcuts(false)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-5">
              {shortcuts.map((g) => (
                <div key={g.group}>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2">{g.group}</p>
                  <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
                    {g.keys.map(([key, label]) => (
                      <div key={key + label} className="flex items-center justify-between gap-4 px-3.5 py-2">
                        <span className="text-[13px] text-slate-700 dark:text-slate-200">{label}</span>
                        <kbd className="shrink-0 min-w-[2.25rem] text-center px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 border-b-2 text-[11.5px] font-mono font-bold text-slate-700 dark:text-slate-200">
                          {key}
                        </kbd>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
