import toast from 'react-hot-toast';
import { haptic } from '../utils/haptics';
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
  /** Venta a comercios activa (null = todavía no se sabe) */
  wholesale: boolean | null;
}

export const useOnlineOrders = create<OnlineOrdersState>(() => ({ storeId: null, orders: [], ready: false, published: false, wholesale: null }));

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
let retry: ReturnType<typeof setTimeout> | null = null;
let retries = 0; // el plan Caja nunca tiene sesión de tienda: no se insiste para siempre
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
    // Con la PC vinculada, la sesión trae la tienda de la cuenta (y la deja en STORE_ID_KEY).
    // Sin sesión NO se usa lo que haya guardado: en web.ventra.store el navegador lo comparte
    // entre cuentas y puede ser la tienda de otra (al guardar, "vinculada a otra instalación").
    // Pasa sobre todo mientras la caja en la nube arranca: se reintenta en un rato.
    const user = await ensureVentraSession().catch(() => null);
    if (!user) {
      if (!retry && retries < 6) retry = setTimeout(() => { retry = null; retries++; startOnlineOrdersSync(); }, 15000);
      return;
    }
    retries = 0;
    const storeId = localStorage.getItem(STORE_ID_KEY);
    // Este comercio todavía no tiene tienda online (tampoco venta a comercios)
    if (!storeId) { useOnlineOrders.setState({ wholesale: false }); return; }

    let seen: Set<string>;
    try { seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || '[]')); } catch { seen = new Set(); }
    let first = true;

    useOnlineOrders.setState({ storeId });
    startFreeStockTimer();
    loadStoreConfig(storeId).then((c) => useOnlineOrders.setState({ published: !!c.isPublished, wholesale: !!c.wholesale?.enabled })).catch(() => {});
    unsubscribe = subscribeToStoreOrders(storeId, (orders) => {
      useOnlineOrders.setState({ orders, ready: true });
      const fresh = orders.filter((o) => isNewOrder(o) && !seen.has(o.id));
      // En el primer arranque solo se marcan como vistos (no suena por pedidos viejos)
      if (!first && fresh.length) {
        playChime();
        haptic([60, 80, 60]);
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

/**
 * Venta a comercios: el stock libre de la tienda también cambia con las compras y las ventas del
 * mostrador, que no pasan por los pedidos. Se revisa cada 3 minutos (solo escribe si cambió).
 */
let freeStockTimer: ReturnType<typeof setInterval> | null = null;
function startFreeStockTimer() {
  if (freeStockTimer) return;
  import('../stores/businessStore').then(({ hasFeature }) => {
    if (freeStockTimer || !(hasFeature('bulk') || hasFeature('preorders'))) return;
    import('./onlineStore').then((m) => {
      m.refreshWholesaleStock(5000);
      freeStockTimer = setInterval(() => m.refreshWholesaleStock(0), 3 * 60000);
    });
  }).catch(() => {});
}

export function stopOnlineOrdersSync() {
  if (retry) { clearTimeout(retry); retry = null; }
  if (freeStockTimer) { clearInterval(freeStockTimer); freeStockTimer = null; }
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  useOnlineOrders.setState({ storeId: null, orders: [], ready: false, published: false, wholesale: null });
}
