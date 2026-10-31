import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GraduationCap, PlayCircle, Keyboard, X, ChevronRight, ChevronUp, MessageCircleQuestion } from 'lucide-react';
import { tourSteps, ROUTE_HELP, ROUTE_SHORTCUTS, type HelpEntry } from './tours';
import { getTourCtx } from './tourContext';
import { useTourStore } from './tourStore';
import HelpChat from './HelpChat';

/** A tour is offered only if at least one of its targets is on screen right now. */
function isAvailable(entry: HelpEntry) {
  const ctx = getTourCtx();
  if (entry.when && !entry.when(ctx)) return false;
  const targeted = tourSteps(entry.tour, ctx).filter((s) => s.target);
  if (targeted.length === 0) return true;
  return targeted.some((s) =>
    Array.from(document.querySelectorAll<HTMLElement>(`[data-tour="${s.target}"]`)).some((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }),
  );
}

/** Abre la ayuda con IA desde cualquier lado (por ejemplo la paleta Ctrl+K) */
export const openHelpChat = () => window.dispatchEvent(new Event('ventra:help-chat'));

/** ¿Hay un botón, link o campo debajo de este rectángulo? (sin contar la propia ayuda) */
function coversSomething(root: HTMLElement, rect: DOMRect) {
  const pad = 3;
  const points: [number, number][] = [
    [rect.left + pad, rect.top + pad], [rect.right - pad, rect.top + pad], [rect.left + pad, rect.bottom - pad],
    [rect.right - pad, rect.bottom - pad], [(rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2],
  ];
  for (const [x, y] of points) {
    const under = document.elementsFromPoint(x, y).find((el) => !root.contains(el));
    if (under?.closest('button, a[href], input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])')) return true;
  }
  return false;
}

/**
 * Botón de Ayuda: recorridos guiados de la pantalla, atajos y la ayuda con IA.
 * header: en la barra de arriba, así no tapa nada. iconOnly: solo el ícono, para la barra de la caja.
 * floating: abajo a la izquierda; si queda encima de un botón o un campo, se esconde
 * (se sigue abriendo con Ctrl+K → Ayuda).
 */
export default function HelpMenu({ pathname, placement, iconOnly }: { pathname: string; placement: 'header' | 'floating'; iconOnly?: boolean }) {
  const entries = ROUTE_HELP[pathname] || [];
  const shortcuts = ROUTE_SHORTCUTS[pathname];
  const start = useTourStore((s) => s.start);
  const tourActive = useTourStore((s) => !!s.activeTour);
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState<HelpEntry[]>([]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const floating = placement === 'floating';

  useEffect(() => {
    const onOpen = () => setShowChat(true);
    window.addEventListener('ventra:help-chat', onOpen);
    return () => window.removeEventListener('ventra:help-chat', onOpen);
  }, []);

  // Flotante: nunca encima de otro botón. Se revisa seguido (las pantallas cambian sin avisar)
  useEffect(() => {
    if (!floating) return;
    const check = () => {
      const root = rootRef.current;
      const btn = buttonRef.current;
      if (!root || !btn || open) return;
      const r = btn.getBoundingClientRect();
      if (!r.width) return;
      setBlocked(coversSomething(root, r));
    };
    check();
    const t = setInterval(check, 600);
    window.addEventListener('resize', check);
    return () => { clearInterval(t); window.removeEventListener('resize', check); };
  }, [floating, open, pathname]);

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

  if (tourActive) return null;

  const onButton = () => {
    const list = entries.filter(isAvailable);
    // Sin recorridos ni atajos en esta pantalla: directo a preguntarle a la ayuda
    if (!list.length && !shortcuts) { setShowChat(true); return; }
    setAvailable(list);
    setOpen((o) => !o);
  };

  return (
    <>
      <div ref={rootRef} data-help-menu={placement}
        className={floating
          ? `fixed bottom-5 left-5 z-40 hidden md:block transition-opacity duration-150 ${blocked ? 'opacity-0 pointer-events-none' : ''}`
          : 'relative'}>
        {/* Menú siempre montado: solo cambia su visibilidad con CSS (sin montar/desmontar
            ni librerías de animación), así no puede aparecer un cuadro de más al abrir/cerrar. */}
        <div
              aria-hidden={!open}
              className={`keep-style absolute ${floating ? 'bottom-[52px] left-0 origin-bottom' : 'top-[42px] right-0 origin-top z-50'} transition-[opacity,transform,visibility] duration-150 ease-out ${
                open ? 'opacity-100 translate-y-0 visible' : `opacity-0 ${floating ? 'translate-y-1.5' : '-translate-y-1.5'} invisible pointer-events-none`
              } w-[310px] bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-[0_20px_50px_-12px_rgba(15,23,42,0.35)] p-2`}
            >
              <div className="px-3 pt-2.5 pb-2">
                <p className="eyebrow">Ayuda</p>
                <p className="text-[13px] font-semibold text-slate-900 dark:text-slate-100 mt-0.5">¿Qué querés aprender?</p>
              </div>
              <button
                onClick={() => { setOpen(false); setShowChat(true); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors group"
              >
                <MessageCircleQuestion className="w-5 h-5 text-rose-600 shrink-0" />
                <span className="flex-1 min-w-0">
                  <span className="block text-[13px] font-semibold text-slate-800 dark:text-slate-100">Preguntale a la ayuda</span>
                  <span className="block text-[11.5px] text-slate-500 dark:text-slate-400 leading-snug">Escribí qué querés hacer y te dice los pasos</span>
                </span>
                <ChevronRight className="w-4 h-4 text-slate-300 group-hover:text-slate-500 shrink-0" />
              </button>
              {available.length > 0 && <div className="h-px bg-slate-100 dark:bg-slate-800 my-1.5 mx-2" />}
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

        {iconOnly ? (
          <button
            ref={buttonRef}
            onClick={onButton}
            title="Ayuda"
            aria-label="Ayuda"
            aria-expanded={open}
            className={`flex items-center justify-center w-8 h-8 rounded-lg transition-colors active:scale-95 cursor-pointer shrink-0 ${open ? 'bg-rose-50 text-rose-700' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
          >
            <GraduationCap strokeWidth={2.25} className="w-4 h-4" />
          </button>
        ) : !floating ? (
          <button
            ref={buttonRef}
            onClick={onButton}
            title="Ayuda: preguntale cómo se hace algo, recorridos guiados y atajos"
            aria-expanded={open}
            className={`flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-full border text-[12px] font-semibold transition-colors ${
              open ? 'bg-rose-50 border-rose-300 text-rose-700' : 'bg-white border-slate-200 text-slate-700 hover:border-rose-300'
            }`}
          >
            <GraduationCap className="w-3.5 h-3.5 text-rose-600" /> <span className="hidden sm:inline">Ayuda</span>
          </button>
        ) : (
        <button
          ref={buttonRef}
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
        )}
      </div>

      {showChat && <HelpChat pathname={pathname} onClose={() => setShowChat(false)} />}

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
