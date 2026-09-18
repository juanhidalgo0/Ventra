import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { TOURS, type TourStep } from './tours';
import { useTourStore, setTourKeyHandler } from './tourStore';
import { useAuthStore } from '../../../stores/authStore';

const SPOT_PAD = 6;
const GAP = 14;
const MARGIN = 12;

type Rect = { top: number; left: number; width: number; height: number };
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

  // Resolve which steps actually exist on this screen right now.
  const steps = useMemo<TourStep[]>(() => {
    if (!activeTour) return [];
    return (TOURS[activeTour] as TourStep[]).filter((s) => !s.target || findTarget(s));
  }, [activeTour]);

  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [popSize, setPopSize] = useState({ width: 320, height: 170 });
  const popRef = useRef<HTMLDivElement>(null);

  useEffect(() => setIndex(0), [activeTour]);

  const step = steps[index];
  const isLast = index === steps.length - 1;

  const next = useCallback(() => (isLast ? finish() : setIndex((i) => i + 1)), [isLast, finish]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Enter a step: optionally click the target, then bring it into view.
  useEffect(() => {
    if (!step) return;
    const el = findTarget(step);
    if (!el) { setRect(null); return; }
    if (step.click) el.click();
    const r = el.getBoundingClientRect();
    if (r.top < 0 || r.bottom > window.innerHeight) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [step]);

  // Follow the target while it moves (scroll, resize, animations).
  useEffect(() => {
    if (!step) return;
    let raf = 0;
    let missingFrames = 0;
    const tick = () => {
      const el = findTarget(step);
      if (!el && step.target && ++missingFrames > 30) {
        finish();
        return;
      }
      if (el) {
        missingFrames = 0;
        const r = el.getBoundingClientRect();
        setRect((prev) => {
          if (!prev) return { top: r.top, left: r.left, width: r.width, height: r.height };
          const ease = (a: number, b: number) => (Math.abs(b - a) < 0.5 ? b : a + (b - a) * 0.28);
          const nextRect = {
            top: ease(prev.top, r.top),
            left: ease(prev.left, r.left),
            width: ease(prev.width, r.width),
            height: ease(prev.height, r.height),
          };
          return nextRect.top === prev.top && nextRect.left === prev.left &&
            nextRect.width === prev.width && nextRect.height === prev.height ? prev : nextRect;
        });
      } else {
        setRect(null);
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [step, finish]);

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

  return createPortal(
    <div className="fixed inset-0 z-[10000]" role="dialog" aria-modal="true" aria-label={step.title}>
      {/* Click shield: the page stays visible but inert while touring */}
      <div className="absolute inset-0" onClick={(e) => e.stopPropagation()} />

      {/* Dim everything except the target: an SVG mask with a rounded hole.
          (Not box-shadow — performance mode strips shadows from every div.) */}
      <svg className="keep-animated absolute inset-0 w-full h-full pointer-events-none">
        <defs>
          <mask id="guided-tour-mask">
            <rect width="100%" height="100%" fill="white" />
            {spot && <rect x={spot.left} y={spot.top} width={spot.width} height={spot.height} rx={14} fill="black" />}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(15,23,42,0.55)" mask="url(#guided-tour-mask)" />
      </svg>

      {spot && (
        <div
          className="keep-style absolute pointer-events-none rounded-[14px] border-[3px] border-white"
          style={{ ...spot, boxShadow: '0 0 0 5px rgba(52,172,126,0.45), 0 0 24px 4px rgba(52,172,126,0.35)' }}
        >
          <div className="keep-animated absolute -inset-[3px] rounded-[14px] border-2 border-emerald-400 animate-pulse" />
        </div>
      )}

      <AnimatePresence mode="wait">
        <motion.div
          key={index}
          ref={popRef}
          initial={{ opacity: 0, y: 6, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.08 } }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="keep-style absolute w-[300px] max-w-[calc(100vw-24px)] bg-white rounded-2xl shadow-[0_20px_50px_-12px_rgba(15,23,42,0.35)] border border-slate-200/70 px-5 pt-5 pb-4 font-sans"
          style={{ top: pos.top, left: pos.left }}
        >
          <button
            onClick={finish}
            className="absolute top-3 right-3 w-6 h-6 flex items-center justify-center rounded-md text-slate-300 hover:text-slate-500 hover:bg-slate-50 transition-colors"
            aria-label="Cerrar recorrido"
          >
            <X className="w-3.5 h-3.5" />
          </button>

          <h3 className="text-[15px] font-bold text-slate-900 tracking-tight pr-6">{step.title}</h3>
          <p className="mt-2 text-[13px] leading-relaxed text-slate-600">{renderBody(step.body)}</p>

          <div className="mt-4 flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-400 tabular-nums">
              {index + 1} de {steps.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={back}
                disabled={index === 0}
                className="px-3.5 h-8 rounded-lg bg-slate-100 text-slate-600 text-xs font-semibold hover:bg-slate-200 disabled:opacity-40 disabled:hover:bg-slate-100 transition-colors"
              >
                Atrás
              </button>
              <button
                onClick={next}
                autoFocus
                className="px-4 h-8 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-xs font-bold shadow-sm shadow-emerald-500/30 transition-colors"
              >
                {isLast ? 'Entendido' : 'Siguiente'}
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body,
  );
}

/** Starts a screen's tour the first time the user visits it. */
export function useAutoTour(id: keyof typeof TOURS, ready = true) {
  const startIfUnseen = useTourStore((s) => s.startIfUnseen);
  // Re-check when the logged-in user changes: each user gets their own first time.
  const userId = useAuthStore((s) => s.user?.id || s.user?.username);
  useEffect(() => {
    if (!ready || !userId) return;
    // Let the screen finish its entrance animation before measuring targets.
    const t = setTimeout(() => startIfUnseen(id), 700);
    return () => clearTimeout(t);
  }, [id, ready, startIfUnseen, userId]);
}
