import toast from 'react-hot-toast';
import { create } from 'zustand';
import { STORE_ID_KEY, subscribeToStoreOrders, loadStoreConfig, type StoreOrder } from './onlineStore';
import { ensureVentraSession } from './ventraFirebase';

/**
 * Pedidos de la tienda online, en vivo, para toda la app: la sección "Pedidos online",
 * el contador de la barra lateral, el botón de la caja y el Inicio del celular.
 * Los ve cualquier usuario (el cajero es quien los prepara y entrega).
 *
 * Antes cada pedido se convertía en un Presupuesto; ahora tienen su sección propia
 * y Presupuestos queda solo para cotizaciones.
 */
interface OnlineOrdersState {
  storeId: string | null;
  orders: StoreOrder[];
  ready: boolean;
  /** La tienda está publicada: recién ahí tienen sentido el botón y la sección de pedidos */
  published: boolean;
}

export const useOnlineOrders = create<OnlineOrdersState>(() => ({ storeId: null, orders: [], ready: false, published: false }));

/** Pedidos que todavía nadie empezó a preparar */
export const isNewOrder = (o: StoreOrder) => !o.stage || o.stage === 'NEW';

/** Se muestra la sección si la tienda está publicada o si quedaron pedidos sin terminar. */
export function useOrdersVisible() {
  return useOnlineOrders((s) => s.published || s.orders.some((o) => o.stage !== 'DELIVERED' && o.stage !== 'CANCELLED'));
}

/** Se llama al publicar o despublicar la tienda desde la configuración. */
export function setStorePublished(published: boolean) {
  useOnlineOrders.setState({ published });
  if (published) startOnlineOrdersSync();
}

let unsubscribe: (() => void) | null = null;
let starting = false;
const SEEN_KEY = 'ventra_orders_seen';

function playChime() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    [880, 1175].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.connect(g); g.connect(ctx.destination);
      const t = ctx.currentTime + i * 0.18;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.start(t); o.stop(t + 0.4);
    });
  } catch { /* sin audio */ }
}

export async function startOnlineOrdersSync() {
  if (unsubscribe || starting) return;
  starting = true;
  try {
    // Con la PC vinculada, la sesión trae la tienda de la cuenta (y la deja en STORE_ID_KEY)
    await ensureVentraSession().catch(() => null);
    const storeId = localStorage.getItem(STORE_ID_KEY);
    if (!storeId) return; // este comercio todavía no tiene tienda online

    let seen: Set<string>;
    try { seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { seen = new Set(); }
    let first = true;

    useOnlineOrders.setState({ storeId });
    loadStoreConfig(storeId).then((c) => useOnlineOrders.setState({ published: !!c.isPublished })).catch(() => {});
    unsubscribe = subscribeToStoreOrders(storeId, (orders) => {
      useOnlineOrders.setState({ orders, ready: true });
      const fresh = orders.filter((o) => isNewOrder(o) && !seen.has(o.id));
      // En el primer arranque solo se marcan como vistos (no suena por pedidos viejos)
      if (!first && fresh.length) {
        playChime();
        const o = fresh[0];
        toast.success(
          fresh.length === 1
            ? `🛍️ Nuevo pedido online de ${o.customerName || 'un cliente'}${o.orderCode ? ` (#${o.orderCode})` : ''}`
            : `🛍️ ${fresh.length} pedidos online nuevos`,
          { duration: 8000, id: 'online-order' },
        );
      }
      fresh.forEach((o) => seen.add(o.id));
      try { localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-300))); } catch { /* sin espacio */ }
      first = false;
    });
  } finally {
    starting = false;
  }
}

export function stopOnlineOrdersSync() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  useOnlineOrders.setState({ storeId: null, orders: [], ready: false, published: false });
}
