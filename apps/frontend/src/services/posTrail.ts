import api from './api';
import { usePOSStore, type CartItem } from '../stores/posStore';
import { useAuthStore } from '../stores/authStore';

/**
 * Registro silencioso de lo que se saca del ticket (quitar un renglón, bajar la cantidad,
 * vaciar el ticket, borrar un ticket en espera). Va al control de anulaciones del dueño
 * (/anulaciones): la forma más común de robar en el mostrador es cobrar, quitar los productos
 * y quedarse con la plata. En la caja no se muestra nada: ni avisos ni errores.
 *
 * Solo se registran las quitas que hace el cajero a mano. Vaciar el ticket después de cobrar,
 * presupuestar o cargar un pedido usa clearCart directo y no pasa por acá.
 */

const QUEUE = 'pos_trail_queue';
const MAX_QUEUE = 500;

export type TrailAction = 'ITEM_REMOVED' | 'QTY_REDUCED' | 'CART_CLEARED' | 'HELD_CART_DELETED';

interface TrailItem { productId: string; name: string; quantity: number; price: number; secondsInCart: number | null }

interface Ctx { sessionId: string | null; terminal: string | null; practice: boolean }
let ctx: Ctx = { sessionId: null, terminal: null, practice: false };

/** Hora en que entró (o subió de cantidad por última vez) cada renglón del ticket */
const addedAt = new Map<string, number>();
/** Hora en que se abrió el cobro del ticket actual (ya se le estaba cobrando al cliente) */
let totalShownAt: number | null = null;

let prevQty = new Map<string, number>();
usePOSStore.subscribe((state) => {
  const now = Date.now();
  const next = new Map<string, number>();
  for (const i of state.cart) {
    next.set(i.cartKey, i.quantity);
    const before = prevQty.get(i.cartKey);
    if (before === undefined || i.quantity > before) addedAt.set(i.cartKey, now);
  }
  for (const key of [...addedAt.keys()]) if (!next.has(key)) addedAt.delete(key);
  if (!state.cart.length) totalShownAt = null;
  prevQty = next;
});

/** La caja avisa en qué sesión y terminal está (en modo práctica no se registra nada). */
export function setTrailContext(next: Partial<Ctx>) { ctx = { ...ctx, ...next }; }

/** Se abrió el cobro: ya se le estaba cobrando al cliente. */
export function markTotalShown() { if (usePOSStore.getState().cart.length && !totalShownAt) totalShownAt = Date.now(); }

const cartValue = (cart: CartItem[]) => Math.round(cart.reduce((s, i) => s + (i.isReturn ? -1 : 1) * i.price * i.quantity, 0) * 100) / 100;
const secondsIn = (key: string) => { const at = addedAt.get(key); return at ? Math.round((Date.now() - at) / 1000) : null; };

/** `shownAt`: hora en que se abrió el cobro, tomada ANTES de cambiar el carrito (al vaciarlo se borra) */
function record(action: TrailAction, items: TrailItem[], totalBefore: number, totalAfter: number, shownAt: number | null, extra: Record<string, any> = {}) {
  if (ctx.practice || !items.length) return;
  const user = useAuthStore.getState().user;
  const ev = {
    id: crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    action,
    at: new Date().toISOString(),
    userId: user?.id || null,
    userName: user?.fullName || user?.username || null,
    sessionId: ctx.sessionId,
    terminal: ctx.terminal,
    items,
    amount: Math.round(items.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100,
    totalBefore,
    totalAfter,
    totalShown: !!shownAt,
    secondsSinceTotal: shownAt ? Math.round((Date.now() - shownAt) / 1000) : null,
    ...extra,
  };
  try {
    const q = readQueue();
    q.push(ev);
    localStorage.setItem(QUEUE, JSON.stringify(q.slice(-MAX_QUEUE)));
  } catch { /* sin almacenamiento */ }
  flushTrail();
}

function readQueue(): any[] {
  try { const q = JSON.parse(localStorage.getItem(QUEUE) || '[]'); return Array.isArray(q) ? q : []; } catch { return []; }
}

let sending = false;
/** Manda lo pendiente. Sin servidor queda en la cola y se reintenta solo. */
export async function flushTrail() {
  if (sending) return;
  const batch = readQueue().slice(0, 100);
  if (!batch.length) return;
  sending = true;
  let more = false;
  try {
    await api.post('/pos-trail', { events: batch }, { silent: true } as any);
    const sent = new Set(batch.map((e) => e.id));
    const rest = readQueue().filter((e) => !sent.has(e.id));
    if (rest.length) localStorage.setItem(QUEUE, JSON.stringify(rest));
    else localStorage.removeItem(QUEUE);
    more = rest.length > 0;
  } catch { /* se reintenta después */ } finally {
    sending = false;
  }
  // Lo que entró mientras se mandaba sale enseguida
  if (more) flushTrail();
}
if (typeof window !== 'undefined') {
  setTimeout(flushTrail, 5000);
  setInterval(flushTrail, 60_000);
  window.addEventListener('online', () => { flushTrail(); });
}

/** Quita un renglón del ticket (y lo registra). */
export function trailRemoveLine(cartKey: string) {
  const st = usePOSStore.getState();
  const item = st.cart.find((i) => i.cartKey === cartKey);
  const before = cartValue(st.cart);
  const secs = secondsIn(cartKey);
  const shownAt = totalShownAt;
  st.removeFromCart(cartKey);
  if (!item || item.isReturn) return;
  record('ITEM_REMOVED', [{ productId: item.productId, name: item.name, quantity: item.quantity, price: item.price, secondsInCart: secs }], before, cartValue(usePOSStore.getState().cart), shownAt);
}

/** Cambia la cantidad de un renglón; si baja, registra lo que se sacó. */
export function trailSetQuantity(cartKey: string, quantity: number) {
  const st = usePOSStore.getState();
  const item = st.cart.find((i) => i.cartKey === cartKey);
  const before = cartValue(st.cart);
  const secs = secondsIn(cartKey);
  const shownAt = totalShownAt;
  st.updateQuantity(cartKey, quantity);
  if (!item || item.isReturn) return;
  const removed = Math.round((item.quantity - Math.max(0, quantity)) * 1000) / 1000;
  if (removed <= 0) return;
  record(quantity <= 0 ? 'ITEM_REMOVED' : 'QTY_REDUCED', [{ productId: item.productId, name: item.name, quantity: removed, price: item.price, secondsInCart: secs }], before, cartValue(usePOSStore.getState().cart), shownAt);
}

const toItems = (cart: CartItem[]): TrailItem[] => cart.filter((i) => !i.isReturn).map((i) => ({
  productId: i.productId, name: i.name, quantity: i.quantity, price: i.price, secondsInCart: secondsIn(i.cartKey),
}));

/** Vacía el ticket a mano (botón Vaciar, Shift+Supr, Vaciar carrito del celular). */
export function trailClearCart() {
  const st = usePOSStore.getState();
  const items = toItems(st.cart);
  const before = cartValue(st.cart);
  const shownAt = totalShownAt;
  st.clearCart();
  record('CART_CLEARED', items, before, 0, shownAt);
}

/** Borra un ticket en espera. */
export function trailDeleteHeldCart(id: string) {
  const st = usePOSStore.getState();
  const held = st.heldCarts.find((h: any) => h.id === id);
  st.deleteHeldCart(id);
  if (!held) return;
  const items: TrailItem[] = (held.cart || []).filter((i: CartItem) => !i.isReturn)
    .map((i: CartItem) => ({ productId: i.productId, name: i.name, quantity: i.quantity, price: i.price, secondsInCart: null }));
  record('HELD_CART_DELETED', items, cartValue(held.cart || []), 0, null, { heldSince: held.createdAt, heldName: held.clientName });
}

