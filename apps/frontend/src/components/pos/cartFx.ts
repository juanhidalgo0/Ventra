/**
 * Efectos del ticket de la caja, todos con el DOM directo y solo transform/opacity para que no
 * frenen PCs viejas ni hagan redibujar la caja:
 * - bumpNumber: rebote del número de cantidad (rueda del mouse).
 * - startCartRowDrag: sacar una fila arrastrándola afuera del ticket (se desarma en partículas).
 * - printTicketFx: al confirmar la venta, una COPIA del ticket sale como un papel impreso;
 *   el ticket real ya se vació, así que la venta siguiente no espera nada.
 * Con "reducir movimiento" del sistema no hay animaciones (las acciones pasan igual).
 */

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const CART_SELECTOR = '[data-tour="pos-cart"]';

export function bumpNumber(el: Element | null | undefined, dir: 1 | -1) {
  if (!el || reducedMotion()) return;
  (el as HTMLElement).animate(
    [
      { transform: 'translateY(0) scale(1)' },
      { transform: `translateY(${dir > 0 ? -5 : 5}px) scale(1.25)`, offset: 0.4 },
      { transform: 'translateY(0) scale(1)' },
    ],
    { duration: 220, easing: 'cubic-bezier(.3,1.6,.5,1)' },
  );
}

function burst(x: number, y: number) {
  if (reducedMotion()) return;
  const colors = ['#E24B4A', '#F09595', '#94a3b8', '#cbd5e1', '#64748b'];
  for (let i = 0; i < 16; i++) {
    const p = document.createElement('div');
    const size = 4 + Math.random() * 6;
    p.className = 'pos-particle';
    p.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px;background:${colors[i % colors.length]};border-radius:${Math.random() > 0.5 ? '50%' : '2px'}`;
    document.body.appendChild(p);
    const ang = (Math.PI * 2 * i) / 16 + Math.random() * 0.4;
    const dist = 40 + Math.random() * 70;
    p.animate(
      [
        { transform: 'translate(-50%,-50%) scale(1) rotate(0deg)', opacity: 1 },
        { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist + 30}px)) scale(0.3) rotate(${Math.random() * 360}deg)`, opacity: 0 },
      ],
      { duration: 480 + Math.random() * 200, easing: 'cubic-bezier(.2,.7,.4,1)' },
    ).onfinish = () => p.remove();
  }
}

/**
 * Arrastrar una fila del ticket: soltada afuera del ticket se quita (onRemove hace lo mismo que
 * la cruz, así queda en el control de anulaciones); soltada adentro vuelve a su lugar.
 */
export function startCartRowDrag(e: React.PointerEvent<HTMLElement>, onRemove: () => void) {
  if (e.pointerType !== 'mouse' || e.button !== 0) return;
  if ((e.target as Element).closest('button, input, a, select, textarea')) return;
  const row = e.currentTarget;
  const cart = row.closest(CART_SELECTOR);
  if (!cart) return;
  const startX = e.clientX;
  const startY = e.clientY;
  const rr = row.getBoundingClientRect();
  let ghost: HTMLDivElement | null = null;
  let out = false;
  let lastX = startX;
  let lastY = startY;
  let raf = 0;

  const place = () => {
    raf = 0;
    if (!ghost) return;
    const dx = lastX - startX;
    const dy = lastY - startY;
    ghost.style.transform = `translate(${rr.left + dx}px, ${rr.top + dy}px) rotate(${Math.max(-6, Math.min(6, dx / 40))}deg) scale(${out ? 0.9 : 1})`;
  };

  const move = (ev: PointerEvent) => {
    lastX = ev.clientX;
    lastY = ev.clientY;
    if (!ghost) {
      if (Math.hypot(lastX - startX, lastY - startY) < 8) return;
      ghost = document.createElement('div');
      ghost.className = 'pos-row-ghost';
      ghost.style.width = `${rr.width}px`;
      ghost.appendChild(row.cloneNode(true));
      const tag = document.createElement('div');
      tag.className = 'pos-row-ghost-tag';
      tag.textContent = 'Soltá para quitar';
      ghost.appendChild(tag);
      document.body.appendChild(ghost);
      row.classList.add('pos-drag-origin');
      document.documentElement.classList.add('pos-dragging');
      window.getSelection()?.removeAllRanges();
    }
    const r = cart.getBoundingClientRect();
    const inside = lastX >= r.left && lastX <= r.right && lastY >= r.top && lastY <= r.bottom;
    if (!inside !== out) {
      out = !inside;
      ghost.classList.toggle('is-out', out);
    }
    if (!raf) raf = requestAnimationFrame(place);
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('keydown', key, true);
    window.removeEventListener('blur', cancel);
    if (raf) cancelAnimationFrame(raf);
    row.classList.remove('pos-drag-origin');
    document.documentElement.classList.remove('pos-dragging');
  };

  const back = (g: HTMLDivElement) => {
    g.animate(
      [{ transform: g.style.transform }, { transform: `translate(${rr.left}px, ${rr.top}px) rotate(0deg) scale(1)` }],
      { duration: reducedMotion() ? 1 : 220, easing: 'cubic-bezier(.2,.8,.2,1)' },
    ).onfinish = () => g.remove();
  };

  const up = () => {
    const g = ghost;
    const remove = out;
    cleanup();
    if (!g) return;
    if (!remove) { back(g); return; }
    const gr = g.getBoundingClientRect();
    burst(gr.left + gr.width / 2, gr.top + gr.height / 2);
    g.animate(
      [{ transform: g.style.transform, opacity: 1 }, { transform: `${g.style.transform} scale(0.4)`, opacity: 0 }],
      { duration: reducedMotion() ? 1 : 180, easing: 'ease-in' },
    ).onfinish = () => g.remove();
    onRemove();
  };

  const cancel = () => {
    const g = ghost;
    cleanup();
    if (g) back(g);
  };
  const key = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && ghost) { ev.preventDefault(); ev.stopPropagation(); cancel(); }
  };

  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('keydown', key, true);
  window.addEventListener('blur', cancel);
}

/**
 * Venta confirmada: "la plata entra a la caja". El total del ticket se despega, crece en verde y
 * vuela en curva hasta el botón Caja con unas monedas detrás; el botón salta y muestra "+$X".
 * Se llama ANTES de vaciar el carrito (lee la posición del total) y no frena nada: son copias
 * que se animan aparte, solo con transform/opacity.
 */
export function cashInFx(totalText: string) {
  if (reducedMotion()) return;
  const totalEl = document.querySelector('[data-pos-total]') as HTMLElement | null;
  const cajaEl = document.querySelector('[data-tour="pos-caja"]') as HTMLElement | null;
  if (!totalEl || !cajaEl) return;
  const from = totalEl.getBoundingClientRect();
  const to = cajaEl.getBoundingClientRect();
  if (!from.width || !to.width) return;

  // Centros, y el punto alto de la curva (arriba y a mitad de camino)
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;
  const tx = to.left + to.width / 2;
  const ty = to.top + to.height / 2;
  const mx = (fx + tx) / 2;
  const my = Math.min(fy, ty) + (Math.max(fy, ty) - Math.min(fy, ty)) * 0.25 - 60;
  const path = (el: HTMLElement, w: number, h: number, s0: number, s1: number) => [
    { transform: `translate(${fx - w / 2}px, ${fy - h / 2}px) scale(${s0})`, opacity: 1 },
    { transform: `translate(${fx - w / 2}px, ${fy - h / 2 - 14}px) scale(${s0 * 1.18})`, opacity: 1, offset: 0.18 },
    { transform: `translate(${mx - w / 2}px, ${my - h / 2}px) scale(${(s0 + s1) / 2})`, opacity: 1, offset: 0.6 },
    { transform: `translate(${tx - w / 2}px, ${ty - h / 2}px) scale(${s1})`, opacity: 0.2 },
  ];

  const money = document.createElement('div');
  money.className = 'pos-cash-money';
  money.textContent = totalText;
  money.style.fontSize = getComputedStyle(totalEl).fontSize;
  document.body.appendChild(money);
  const mw = money.offsetWidth;
  const mh = money.offsetHeight;
  money.animate(path(money, mw, mh, 1, 0.25), { duration: 760, easing: 'cubic-bezier(.45,0,.35,1)', fill: 'forwards' })
    .onfinish = () => money.remove();

  // Moneditas que siguen al total, cada una un poquito atrasada
  for (let i = 0; i < 6; i++) {
    const coin = document.createElement('div');
    coin.className = 'pos-cash-coin';
    coin.textContent = '$';
    document.body.appendChild(coin);
    const jitter = (i % 2 ? 1 : -1) * (8 + i * 3);
    const frames = path(coin, 22, 22, 0.9, 0.6).map((f, k) => (k === 2
      ? { ...f, transform: f.transform.replace(/translate\(([-\d.]+)px, ([-\d.]+)px\)/, (_m, x, y) => `translate(${Number(x) + jitter}px, ${Number(y) - jitter}px)`) }
      : f));
    coin.animate(frames, { duration: 760, delay: 70 + i * 55, easing: 'cubic-bezier(.45,0,.35,1)', fill: 'both' })
      .onfinish = () => coin.remove();
  }

  // Llega: el botón Caja salta y aparece "+$X"
  window.setTimeout(() => {
    cajaEl.animate([
      { transform: 'scale(1)' }, { transform: 'scale(1.14)', offset: 0.3 }, { transform: 'scale(0.96)', offset: 0.6 }, { transform: 'scale(1)' },
    ], { duration: 420, easing: 'ease-out' });
    const glow = document.createElement('div');
    glow.className = 'pos-cash-glow';
    glow.style.cssText = `left:${to.left - 4}px;top:${to.top - 4}px;width:${to.width + 8}px;height:${to.height + 8}px`;
    document.body.appendChild(glow);
    glow.animate([{ opacity: 0.9, transform: 'scale(1)' }, { opacity: 0, transform: 'scale(1.35)' }], { duration: 600, easing: 'ease-out' })
      .onfinish = () => glow.remove();
    const plus = document.createElement('div');
    plus.className = 'pos-cash-plus';
    plus.textContent = `+${totalText}`;
    plus.style.cssText = `left:${tx}px;top:${to.bottom + 4}px`;
    document.body.appendChild(plus);
    plus.animate([
      { transform: 'translate(-50%, 6px) scale(0.8)', opacity: 0 },
      { transform: 'translate(-50%, 0) scale(1.05)', opacity: 1, offset: 0.2 },
      { transform: 'translate(-50%, -4px) scale(1)', opacity: 1, offset: 0.75 },
      { transform: 'translate(-50%, -14px) scale(1)', opacity: 0 },
    ], { duration: 1300, easing: 'ease-out' }).onfinish = () => plus.remove();
  }, 700);
}

/**
 * Cartelitos de ayuda ("Arrastrá al ticket", "Girá la rueda"): aparecen al dejar el mouse un
 * momento encima hasta que el usuario lo hizo 3 veces en esta PC; después no molestan más
 * (clase pos-sabe-arrastrar / pos-sabe-rueda en <html>, estilos en index.css).
 */
const LEARN_KEYS = { arrastrar: 'pos_aprendio_arrastrar', rueda: 'pos_aprendio_rueda' } as const;
export type LearnKind = keyof typeof LEARN_KEYS;
export function markLearned(kind: LearnKind) {
  try {
    const n = Number(localStorage.getItem(LEARN_KEYS[kind]) || 0) + 1;
    localStorage.setItem(LEARN_KEYS[kind], String(n));
    if (n >= 3) document.documentElement.classList.add(`pos-sabe-${kind}`);
  } catch { /* sin almacenamiento: los cartelitos siguen */ }
}
export function initLearned() {
  for (const kind of Object.keys(LEARN_KEYS) as LearnKind[]) {
    try { if (Number(localStorage.getItem(LEARN_KEYS[kind]) || 0) >= 3) document.documentElement.classList.add(`pos-sabe-${kind}`); } catch { /* nada */ }
  }
}
