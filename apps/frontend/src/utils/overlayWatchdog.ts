/**
 * Detector de pantallas trabadas.
 *
 * Síntoma: la app "no deja clickear nada" y hay que reiniciarla. La causa
 * habitual es una capa a pantalla completa (el fondo oscuro de una ventana
 * modal) que quedó en el DOM con opacidad 0: no se ve, pero se come todos los
 * clics. Pasa cuando la animación de cierre no termina, por ejemplo si la app
 * se minimiza o pierde el foco justo en ese momento.
 *
 * Esto busca esa capa, deja el detalle en la consola y la desactiva.
 */

const MIN_COVERAGE = 0.8;

function isGhostOverlay(el: Element | null): el is HTMLElement {
  if (!el || !(el instanceof HTMLElement)) return false;
  const style = getComputedStyle(el);
  if (style.position !== 'fixed' && style.position !== 'absolute') return false;
  if (style.pointerEvents === 'none') return false;

  const rect = el.getBoundingClientRect();
  const coversScreen =
    rect.width >= window.innerWidth * MIN_COVERAGE && rect.height >= window.innerHeight * MIN_COVERAGE;
  if (!coversScreen) return false;

  // Invisible pero clickeable: eso es lo que traba la pantalla
  const opacity = parseFloat(style.opacity || '1');
  return opacity < 0.05 || style.visibility === 'hidden';
}

function describe(el: HTMLElement) {
  return {
    tag: el.tagName.toLowerCase(),
    clase: el.className?.toString().slice(0, 160),
    zIndex: getComputedStyle(el).zIndex,
    opacidad: getComputedStyle(el).opacity,
    hijos: el.children.length,
  };
}

/** Revisa varios puntos de la pantalla y desactiva las capas fantasma que encuentre. */
export function unblockStuckOverlays(reason: string): number {
  const points: [number, number][] = [
    [window.innerWidth / 2, window.innerHeight / 2],
    [window.innerWidth / 2, window.innerHeight * 0.15],
    [window.innerWidth * 0.2, window.innerHeight * 0.6],
    [window.innerWidth * 0.85, window.innerHeight * 0.5],
  ];

  const found = new Set<HTMLElement>();
  for (const [x, y] of points) {
    let el: Element | null = document.elementFromPoint(x, y);
    // La capa puede estar unos niveles por encima del elemento que recibe el punto
    for (let depth = 0; el && depth < 4; depth++) {
      if (isGhostOverlay(el)) { found.add(el); break; }
      el = el.parentElement;
    }
  }

  for (const el of found) {
    console.warn(`[Ventra] Pantalla trabada por una capa invisible (${reason}). Se desactiva:`, describe(el), el);
    el.style.pointerEvents = 'none';
    el.remove();
  }
  return found.size;
}

/** Engancha el detector a los momentos donde suele aparecer el problema. */
export function startOverlayWatchdog(onUnblocked?: (count: number) => void) {
  const run = (reason: string) => {
    const count = unblockStuckOverlays(reason);
    if (count > 0) onUnblocked?.(count);
  };

  // Un clic que "no hace nada" es la primera señal
  const onPointerDown = (e: PointerEvent) => {
    const target = e.target as Element | null;
    if (isGhostOverlay(target)) run('clic sobre la capa');
  };
  const onVisibility = () => { if (!document.hidden) setTimeout(() => run('la app volvió a primer plano'), 300); };
  const onFocus = () => setTimeout(() => run('la ventana recuperó el foco'), 300);
  // Escape es el reflejo natural cuando algo queda trabado
  const onKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') setTimeout(() => run('tecla Escape'), 250); };

  window.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onFocus);
  window.addEventListener('keydown', onKeyDown, true);

  return () => {
    window.removeEventListener('pointerdown', onPointerDown, true);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('keydown', onKeyDown, true);
  };
}
