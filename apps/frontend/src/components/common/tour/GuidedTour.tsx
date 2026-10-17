import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { TOURS, tourSteps, PRACTICE_TOURS, ROAMING_TOURS, type TourStep } from './tours';
import { getTourCtx } from './tourContext';
import { useTourStore, setTourKeyHandler, runTourAction, hasTourAction } from './tourStore';
import { useAuthStore } from '../../../stores/authStore';

const SPOT_PAD = 6;
const GAP = 14;
const MARGIN = 12;

type Rect = { top: number; left: number; width: number; height: number };
const pathOf = (p: string) => p.split('?')[0];
/** Cuánto se espera el objetivo de un paso de otra pantalla (carga de la ruta y de sus datos) */
const ROAM_WAIT = 3000;
type Side = 'bottom' | 'top' | 'right' | 'left' | 'center';

function findTarget(step: TourStep): HTMLElement | null {
  if (!step.target) return null;
  const nodes = document.querySelectorAll<HTMLElement>(`[data-tour="${step.target}"]`);
  for (const el of nodes) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) return el;
  }
  return null;
}

function renderBody(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') ? (
      <strong key={i} className="font-semibold text-rose-600">{part.slice(2, -2)}</strong>
    ) : (
      <React.Fragment key={i}>{part}</React.Fragment>
    ),
  );
}

function place(target: Rect | null, pop: { width: number; height: number }): { top: number; left: number; side: Side } {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (!target) return { top: (vh - pop.height) / 2, left: (vw - pop.width) / 2, side: 'center' };

  const fits: Record<Exclude<Side, 'center'>, boolean> = {
    bottom: target.top + target.height + GAP + pop.height + MARGIN <= vh,
    top: target.top - GAP - pop.height - MARGIN >= 0,
    right: target.left + target.width + GAP + pop.width + MARGIN <= vw,
    left: target.left - GAP - pop.width - MARGIN >= 0,
  };
  // Tall targets (panels) read better with the card beside them.
  const order: Exclude<Side, 'center'>[] =
    target.height > vh * 0.5 ? ['left', 'right', 'bottom', 'top'] : ['bottom', 'top', 'right', 'left'];
  const side = order.find((s) => fits[s]);

  const clampX = (x: number) => Math.min(Math.max(x, MARGIN), vw - pop.width - MARGIN);
  const clampY = (y: number) => Math.min(Math.max(y, MARGIN), vh - pop.height - MARGIN);
  const cx = target.left + target.width / 2 - pop.width / 2;
  const cy = target.top + target.height / 2 - pop.height / 2;

  switch (side) {
    case 'bottom': return { top: target.top + target.height + GAP, left: clampX(cx), side };
    case 'top': return { top: target.top - GAP - pop.height, left: clampX(cx), side };
    case 'right': return { top: clampY(cy), left: target.left + target.width + GAP, side };
    case 'left': return { top: clampY(cy), left: target.left - GAP - pop.width, side };
    default: return { top: clampY(cy), left: clampX(cx), side: 'center' };
  }
}

export default function GuidedTour() {
  const activeTour = useTourStore((s) => s.activeTour);
  const finish = useTourStore((s) => s.finish);
  // Recorridos que pasan por varias pantallas: cada paso con `path` lleva a la suya
  const navigate = useNavigate();
  const location = useLocation();
  const here = useRef(location.pathname);
  here.current = location.pathname;
  /** Hacia dónde se iba: un paso cuyo objetivo no aparece se saltea en ese sentido */
  const dir = useRef<1 | -1>(1);

  // Los pasos que existen en pantalla. Los recorridos con modo práctica primero arman la caja
  // de práctica (caja abierta, productos de ejemplo) y recién después se fija qué pasos hay.
  // Los pasos `lazy` se quedan aunque su objetivo todavía no exista (aparece con una acción).
  const [steps, setSteps] = useState<TourStep[]>([]);
  useEffect(() => {
    setSteps([]);
    if (!activeTour) return;
    const practice = PRACTICE_TOURS.has(activeTour) && hasTourAction('practice:start');
    if (practice) runTourAction('practice:start');
    // Los pasos de otra pantalla (path) se quedan: su objetivo se busca al llegar
    const resolve = () => setSteps(tourSteps(activeTour, getTourCtx()).filter((s) => !s.target || s.lazy || s.path || findTarget(s)));
    const t = setTimeout(resolve, practice ? 450 : 0);
    return () => {
      clearTimeout(t);
      // Al terminar (o cambiar de recorrido) la caja vuelve a como estaba
      if (practice) runTourAction('practice:end');
    };
  }, [activeTour]);

  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [popSize, setPopSize] = useState({ width: 320, height: 170 });
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => setIndex(0), [activeTour]);

  const step = steps[index];
  const isLast = index === steps.length - 1;

  const next = useCallback(() => { dir.current = 1; if (isLast) finish(); else setIndex((i) => i + 1); }, [isLast, finish]);
  const back = useCallback(() => { dir.current = -1; setIndex((i) => Math.max(0, i - 1)); }, []);

  // Enter a step: run its screen action, optionally click the target, then bring it into view.
  useEffect(() => {
    if (!step) return;
    if (step.path && pathOf(step.path) !== here.current) navigate(step.path);
    if (step.run) runTourAction(step.run);
    const el = findTarget(step);
    if (!el) { setRect(null); return; }
    if (step.click) el.click();
    const r = el.getBoundingClientRect();
    // Scroll instantáneo: el "smooth" fuerza muchos repintados en PCs lentas
    if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'center' });
  }, [step]);

  // Seguir al objetivo SIN un bucle por cuadro: se mide al entrar al paso, al
  // hacer scroll/resize (agrupado en un solo frame) y con un chequeo liviano
  // cada 250 ms para animaciones o cambios de diseño. Antes medía 60 veces por
  // segundo y re-renderizaba en cada una, lo que trababa las PCs viejas.
  useEffect(() => {
    if (!step) return;
    let raf = 0;
    let missingSince = 0;
    let scrolled = false;
    // Paso de otra pantalla cuyo objetivo no llegó (no hay datos, otro plan): se saltea
    const skip = () => {
      const n = index + dir.current;
      if (n >= steps.length) finish();
      else if (n < 0) { dir.current = 1; setIndex(index + 1); }
      else setIndex(n);
    };
    const measure = () => {
      raf = 0;
      const el = findTarget(step);
      if (!el) {
        if (step.target) {
          if (!missingSince) missingSince = Date.now();
          else if (Date.now() - missingSince > (step.path ? ROAM_WAIT : 1000)) { if (step.path) skip(); else finish(); return; }
        }
        setRect((prev) => (prev ? null : prev));
        return;
      }
      missingSince = 0;
      // Recién llegado a la pantalla: traerlo a la vista (al entrar al paso todavía no estaba)
      if (step.path && !scrolled) {
        scrolled = true;
        const r = el.getBoundingClientRect();
        if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'center' });
      }
      const r = el.getBoundingClientRect();
      setRect((prev) =>
        prev && Math.abs(prev.top - r.top) < 1 && Math.abs(prev.left - r.left) < 1 &&
        Math.abs(prev.width - r.width) < 1 && Math.abs(prev.height - r.height) < 1
          ? prev
          : { top: r.top, left: r.left, width: r.width, height: r.height });
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(measure); };
    measure();
    const interval = setInterval(schedule, 250);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    return () => {
      clearInterval(interval);
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
    };
  }, [step, finish, index, steps.length]);

  useLayoutEffect(() => {
    if (!popRef.current) return;
    const { offsetWidth: width, offsetHeight: height } = popRef.current;
    if (width !== popSize.width || height !== popSize.height) setPopSize({ width, height });
  });

  // Capture keys before the POS hotkeys see them (Enter would confirm a sale).
  useEffect(() => {
    if (!activeTour) return;
    const onKey = (e: KeyboardEvent) => {
      const handled = ['Escape', 'Enter', 'ArrowRight', 'ArrowLeft'].includes(e.key) || /^F\d+$/.test(e.key);
      if (!handled) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape') finish();
      else if (e.key === 'Enter' || e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
    };
    setTourKeyHandler(onKey);
    return () => setTourKeyHandler(null);
  }, [activeTour, next, back, finish]);

  if (!activeTour || !step) return null;

  const spot = rect && {
    top: rect.top - SPOT_PAD,
    left: rect.left - SPOT_PAD,
    width: rect.width + SPOT_PAD * 2,
    height: rect.height + SPOT_PAD * 2,
  };
  const pos = place(spot, popSize);
  // Esperando que cargue la otra pantalla: la tarjeta no se muestra en el medio a la nada
  const waiting = !!(step.path && step.target && !rect);

  // El foco y la tarjeta se deslizan de un paso al siguiente (solo transform/opacity y la
  // geometría del recorte: livianos también en PCs viejas). Sin objetivo, el recorte se
  // achica hacia el centro y la tarjeta queda centrada.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 0;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 0;
  const hole = spot || { top: vh / 2, left: vw / 2, width: 0, height: 0 };
  const glide = 'all 320ms cubic-bezier(0.22, 1, 0.36, 1)';

  return createPortal(
    <div className="fixed inset-0 z-[10000] tour-enter" role="dialog" aria-modal="true" aria-label={step.title}>
      {/* Click shield: the page stays visible but inert while touring */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      {/* Dim everything except the target: an SVG mask with a rounded hole.
          (Not box-shadow — performance mode strips shadows from every div.) */}
      <svg className="keep-animated absolute inset-0 w-full h-full pointer-events-none">
        <defs>
          <mask id="guided-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            <rect rx={14} fill="black" style={{ x: hole.left, y: hole.top, width: hole.width, height: hole.height, transition: glide } as React.CSSProperties} />
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(15,23,42,0.55)" mask="url(#guided-tour-mask)" />
      </svg>

      <div
        className={`keep-style keep-animated absolute pointer-events-none rounded-[14px] border-[3px] border-emerald-400 ${spot ? 'tour-ring' : ''}`}
        style={{ ...hole, opacity: spot ? 1 : 0, transition: glide }}
      />

      <div
        ref={popRef}
        className="keep-style keep-animated absolute w-[300px] max-w-[calc(100vw-24px)] bg-white rounded-2xl shadow-lg border border-slate-200/70 px-5 pt-5 pb-4 font-sans"
        style={{ top: pos.top, left: pos.left, opacity: waiting ? 0 : 1, transition: 'top 320ms cubic-bezier(0.22, 1, 0.36, 1), left 320ms cubic-bezier(0.22, 1, 0.36, 1), opacity 160ms ease-out' }}
      >
        <button
          onClick={finish}
          className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center rounded-md text-slate-300 hover:text-slate-500 hover:bg-slate-50 transition-colors"
          aria-label="Cerrar recorrido"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        {/* El contenido cambia con una entrada corta; la tarjeta en sí se desliza */}
        <div key={`${activeTour}-${index}`} className="tour-step">
          <h3 className="text-[15px] font-bold text-slate-900 tracking-tight pr-6">{step.title}</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-600">{renderBody(step.body)}</p>
        </div>

        <div className="mt-4 flex gap-1" aria-hidden>
          {steps.map((_, i) => (
            <span key={i} className="h-1 flex-1 rounded-full bg-slate-100 overflow-hidden">
              <span className="block h-full rounded-full bg-emerald-500 origin-left" style={{ transform: `scaleX(${i <= index ? 1 : 0})`, transition: 'transform 300ms ease-out' }} />
            </span>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="text-[11px] font-medium text-slate-400 tabular-nums">
            {index + 1} de {steps.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={back}
              disabled={index === 0}
              className="px-3.5 h-8 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold hover:bg-slate-200 disabled:opacity-40 disabled:hover:bg-slate-100 transition-colors active:scale-[0.97]"
            >
              Atrás
            </button>
            <button
              onClick={next}
              autoFocus
              className="px-4 h-8 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold shadow-sm shadow-emerald-500/30 transition-colors active:scale-[0.97]"
            >
              {isLast ? 'Entendido' : 'Siguiente'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Starts a screen's tour the first time the user visits it. */
export function useAutoTour(id: keyof typeof TOURS, ready = true) {
  const startIfUnseen = useTourStore((s) => s.startIfUnseen);
  // Si la bienvenida estaba abierta, el recorrido arranca apenas se cierra
  const paused = useTourStore((s) => s.paused);
  // Re-check when the logged-in user changes: each user gets their own first time.
  const userId = useAuthStore((s) => s.user?.id || s.user?.username);
  useEffect(() => {
    if (!ready || !userId || paused) return;
    // Let the screen finish its entrance animation before measuring targets.
    const t = setTimeout(() => startIfUnseen(id), 700);
    return () => clearTimeout(t);
  }, [id, ready, startIfUnseen, userId, paused]);
  // El recorrido es de esta pantalla: si se va (otra ruta, o en la demo otro plan), se corta.
  // Si no, seguía abierto en la pantalla nueva solo con sus pasos sin objetivo, fuera de contexto.
  // Los que recorren varias pantallas (ROAMING_TOURS) siguen: el cambio de pantalla es parte del recorrido.
  useEffect(() => () => { if (!ROAMING_TOURS.has(id)) useTourStore.getState().cancel(id); }, [id]);
}
