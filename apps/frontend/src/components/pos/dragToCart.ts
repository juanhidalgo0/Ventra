/**
 * Arrastrar un producto de la caja al ticket.
 *
 * Todo pasa con el DOM directo (sin estado de React) para que mover el mouse no redibuje la
 * caja: una tarjetita "fantasma" sigue al mouse, el ticket se ilumina al pasar por arriba y al
 * soltar la tarjeta vuela y cae en el ticket. Soltada afuera vuelve a su lugar sin agregar nada.
 * El click de siempre no cambia: solo cuenta como arrastre si el mouse se movió más de 8 px.
 * Las animaciones usan transform/opacity (las hace la placa de video), así que andan también en
 * PCs viejas; con "reducir movimiento" del sistema el producto entra sin vuelo.
 */

import { markLearned } from './cartFx';
import { tourAction } from '../common/tour/tourStore';

const DRAG_THRESHOLD = 8;
const CART_SELECTOR = '[data-tour="pos-cart"]';

type DropHandler = (shiftKey: boolean) => void;

let suppressClickUntil = 0;

/** El click que llega justo después de un arrastre no tiene que agregar el producto de nuevo. */
function installClickGuard() {
  if ((window as any).__ventraDragClickGuard) return;
  (window as any).__ventraDragClickGuard = true;
  window.addEventListener('click', (e) => {
    if (performance.now() < suppressClickUntil) {
      e.preventDefault();
      e.stopPropagation();
      suppressClickUntil = 0;
    }
  }, true);
  // Sin esto el navegador arrastra la foto por su cuenta y corta el arrastre nuestro
  window.addEventListener('dragstart', (e) => {
    if ((e.target as Element | null)?.closest?.('[id^="product-btn-"]')) e.preventDefault();
  }, true);
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function buildGhost(card: HTMLElement, name: string) {
  const img = card.querySelector('img') as HTMLImageElement | null;
  const ghost = document.createElement('div');
  ghost.className = 'pos-drag-ghost';
  ghost.setAttribute('aria-hidden', 'true');
  if (img?.src) {
    const pic = document.createElement('img');
    pic.src = img.src;
    pic.alt = '';
    ghost.appendChild(pic);
  }
  const label = document.createElement('span');
  label.textContent = name;
  ghost.appendChild(label);
  document.body.appendChild(ghost);
  return ghost;
}

function cartList(cart: Element): Element {
  // La parte de las filas del ticket (o el ticket entero si está vacío)
  return cart.querySelector('[data-cart-product]')?.parentElement ?? cart;
}

/**
 * Se llama desde onPointerDown de la tarjeta del producto. onDrop agrega el producto (el mismo
 * camino que el click); productId sirve para encontrar la fila y hacerla rebotar.
 */
export function startProductDrag(e: React.PointerEvent<HTMLElement>, name: string, productId: string, onDrop: DropHandler) {
  if (e.pointerType !== 'mouse' || e.button !== 0) return; // en pantallas táctiles se toca y listo
  installClickGuard();
  const card = e.currentTarget;
  const startX = e.clientX;
  const startY = e.clientY;
  let ghost: HTMLDivElement | null = null;
  let overCart = false;
  let cart: Element | null = null;
  let lastX = startX;
  let lastY = startY;
  let raf = 0;

  const place = () => {
    raf = 0;
    if (!ghost) return;
    // Se inclina un poco hacia donde se mueve, como una tarjeta de verdad
    const tilt = Math.max(-10, Math.min(10, (lastX - startX) / 25));
    ghost.style.transform = `translate(${lastX - 70}px, ${lastY - 40}px) rotate(${tilt}deg) scale(${overCart ? 0.92 : 1})`;
  };

  const move = (ev: PointerEvent) => {
    lastX = ev.clientX;
    lastY = ev.clientY;
    if (!ghost) {
      if (Math.hypot(lastX - startX, lastY - startY) < DRAG_THRESHOLD) return;
      ghost = buildGhost(card, name);
      cart = document.querySelector(CART_SELECTOR);
      card.classList.add('pos-drag-origin');
      document.documentElement.classList.add('pos-dragging');
      window.getSelection()?.removeAllRanges();
    }
    const r = cart?.getBoundingClientRect();
    const inside = !!r && lastX >= r.left && lastX <= r.right && lastY >= r.top && lastY <= r.bottom;
    if (inside !== overCart) {
      overCart = inside;
      cart?.classList.toggle('pos-drop-over', inside);
      ghost.classList.toggle('is-over', inside);
    }
    if (!raf) raf = requestAnimationFrame(place);
  };

  const cleanup = () => {
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('keydown', key, true);
    window.removeEventListener('blur', cancel);
    if (raf) cancelAnimationFrame(raf);
    card.classList.remove('pos-drag-origin');
    document.documentElement.classList.remove('pos-dragging');
    cart?.classList.remove('pos-drop-over');
  };

  const flyBack = (g: HTMLDivElement) => {
    const r = card.getBoundingClientRect();
    const anim = g.animate(
      [{ transform: g.style.transform, opacity: 1 }, { transform: `translate(${r.left + r.width / 2 - 70}px, ${r.top + r.height / 2 - 40}px) rotate(0deg) scale(0.6)`, opacity: 0 }],
      { duration: reducedMotion() ? 1 : 260, easing: 'cubic-bezier(.2,.8,.2,1)' },
    );
    anim.onfinish = () => g.remove();
  };

  const flyIn = (g: HTMLDivElement, shiftKey: boolean) => {
    const target = cartList(cart!).getBoundingClientRect();
    const tx = target.left + target.width / 2 - 70;
    const ty = target.top + 24 - 40;
    // Sube apenas y cae en el ticket achicándose
    const anim = g.animate(
      [
        { transform: g.style.transform, opacity: 1 },
        { transform: `translate(${(lastX - 70 + tx) / 2}px, ${Math.min(lastY, ty) - 60}px) rotate(-6deg) scale(0.8)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${tx}px, ${ty}px) rotate(0deg) scale(0.25)`, opacity: 0 },
      ],
      { duration: reducedMotion() ? 1 : 420, easing: 'cubic-bezier(.3,.7,.4,1)' },
    );
    // El producto entra al ticket un poco antes de que la tarjeta termine de caer: se siente al instante
    if (reducedMotion()) onDrop(shiftKey);
    else window.setTimeout(() => onDrop(shiftKey), 250);
    markLearned('arrastrar');
    tourAction('dragToCart');
    anim.onfinish = () => {
      g.remove();
      if (reducedMotion()) return;
      // La fila del producto rebota y brilla en verde un momento
      requestAnimationFrame(() => {
        const row = cart?.querySelector(`[data-cart-product="${CSS.escape(productId)}"]`) as HTMLElement | null;
        row?.animate(
          [
            { transform: 'scale(1)', backgroundColor: 'rgba(23,146,95,0.18)' },
            { transform: 'scale(1.03)', backgroundColor: 'rgba(23,146,95,0.18)', offset: 0.35 },
            { transform: 'scale(1)', backgroundColor: 'rgba(23,146,95,0)' },
          ],
          { duration: 650, easing: 'cubic-bezier(.3,1.5,.5,1)' },
        );
        row?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      });
    };
  };

  const up = (ev: PointerEvent) => {
    const g = ghost;
    const dropped = overCart;
    cleanup();
    if (!g) return; // fue un click normal
    suppressClickUntil = performance.now() + 400;
    if (dropped) flyIn(g, ev.shiftKey);
    else flyBack(g);
  };

  const cancel = () => {
    const g = ghost;
    cleanup();
    if (g) flyBack(g);
  };
  const key = (ev: KeyboardEvent) => {
    if (ev.key === 'Escape' && ghost) { ev.preventDefault(); ev.stopPropagation(); cancel(); }
  };

  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('keydown', key, true);
  window.addEventListener('blur', cancel);
}
