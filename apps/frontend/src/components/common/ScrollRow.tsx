import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

/**
 * Fila horizontal sin barra de scroll. Las flechas viven en su propio espacio a
 * los costados (nunca tapan un botón) y aparecen solo del lado donde hay más
 * contenido. La ruedita del mouse mueve la fila de costado.
 */
export default function ScrollRow({
  children,
  className = '',
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const left = el.scrollLeft > 2;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2;
    setCanLeft((prev) => (prev === left ? prev : left));
    setCanRight((prev) => (prev === right ? prev : right));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener('scroll', update, { passive: true });
    // Ruedita vertical → scroll horizontal (no pasivo, para no mover la página)
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollBy({ left: e.deltaY, behavior: 'auto' });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      el.removeEventListener('scroll', update);
      el.removeEventListener('wheel', onWheel);
    };
  }, [update]);

  // El contenido cambia (otro rubro seleccionado, más categorías): recalcular
  useEffect(() => { update(); }, [children, update]);

  const scrollBy = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: 'smooth' });
  };

  const slot = (visible: boolean) =>
    `keep-style shrink-0 h-8 rounded-full border bg-white text-slate-500 border-slate-200 hover:text-rose-700 hover:border-rose-300 hover:bg-rose-50 shadow-sm flex items-center justify-center overflow-hidden transition-all duration-200 cursor-pointer ${
      visible ? 'w-8 opacity-100' : 'w-0 opacity-0 border-transparent pointer-events-none'
    }`;

  return (
    <div className="flex items-center flex-1 min-w-0">
      <button
        type="button"
        onClick={() => scrollBy(-1)}
        aria-label="Ver rubros anteriores"
        tabIndex={-1}
        className={slot(canLeft) + (canLeft ? ' mr-2' : '')}
      >
        <ChevronLeft className="w-4 h-4 shrink-0" />
      </button>

      <div ref={ref} className={`flex items-center gap-2 overflow-x-auto scrollbar-hide flex-1 min-w-0 ${className}`} {...rest}>
        {children}
      </div>

      <button
        type="button"
        onClick={() => scrollBy(1)}
        aria-label="Ver más rubros"
        tabIndex={-1}
        className={slot(canRight) + (canRight ? ' ml-2' : '')}
      >
        <ChevronRight className="w-4 h-4 shrink-0" />
      </button>
    </div>
  );
}
