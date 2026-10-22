import api from './api';
import { usePOSStore, packOf } from '../stores/posStore';
import { hasFeature } from '../stores/businessStore';

/**
 * Preventa (distribuidora): el vendedor toma el pedido en el celular y en la PC se pasa a la
 * caja. Cada pedido nace con su id en el celular: si no hay señal queda en una cola local y se
 * reenvía solo; como el servidor lo guarda por ese id, reenviarlo nunca lo duplica.
 */

export interface PreOrderItem {
  productId: string;
  productName: string;
  /** En unidades, como en las ventas */
  quantity: number;
  packSize?: number | null;
  unitPrice: number;
}

export interface PreOrderDraft {
  id: string;
  /** Cuándo se empezó a tomar: vale el precio de ese momento (ver preorders.service) */
  takenAt?: string;
  clientId: string | null;
  notes?: string;
  deliveryDate?: string | null;
  items: PreOrderItem[];
  /** Solo para mostrarlo mientras está en la cola */
  clientName?: string;
  total?: number;
  queuedAt?: string;
}

const QUEUE_KEY = 'ventra_preorder_queue';
export const PREORDER_QUEUE_EVENT = 'ventra:preorder-queue';

export const newPreOrderId = () =>
  (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID()
    : 'po-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);

export function readQueue(): PreOrderDraft[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') || []; } catch { return []; }
}
function writeQueue(q: PreOrderDraft[]) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(q)); } catch { /* sin espacio: queda en memoria del intento */ }
  window.dispatchEvent(new CustomEvent(PREORDER_QUEUE_EVENT));
}

/** Sin conexión, o el servidor todavía arrancando (la caja de la nube tarda en despertar): se reintenta */
const isNetworkError = (err: any) => !err?.response || [502, 503, 504].includes(err.response.status);

/**
 * Guarda el pedido. Sin conexión queda en la cola del celular y devuelve 'queued'.
 * Un rechazo del servidor (pedido ya cobrado, sin productos…) se informa como error.
 */
export async function savePreOrder(draft: PreOrderDraft): Promise<'saved' | 'queued'> {
  try {
    await api.put(`/preorders/${draft.id}`, draft);
    writeQueue(readQueue().filter((d) => d.id !== draft.id));
    // Venta a comercios: la tienda muestra el stock libre (cambió lo comprometido)
    import('./onlineStore').then((m) => m.refreshWholesaleStock()).catch(() => {});
    return 'saved';
  } catch (err: any) {
    if (!isNetworkError(err)) throw err;
    const q = readQueue().filter((d) => d.id !== draft.id);
    q.push({ ...draft, queuedAt: new Date().toISOString() });
    writeQueue(q);
    return 'queued';
  }
}

let flushing = false;
/** Manda lo que quedó en la cola. Lo que el servidor rechaza sale de la cola (no se puede arreglar reintentando). */
export async function flushPreOrderQueue(): Promise<{ sent: number; failed: string[] }> {
  if (flushing) return { sent: 0, failed: [] };
  flushing = true;
  let sent = 0;
  const failed: string[] = [];
  try {
    for (const draft of readQueue()) {
      try {
        await api.put(`/preorders/${draft.id}`, draft, { silent: true } as any);
        sent++;
        writeQueue(readQueue().filter((d) => d.id !== draft.id));
        import('./onlineStore').then((m) => m.refreshWholesaleStock()).catch(() => {});
      } catch (err: any) {
        if (isNetworkError(err)) break; // sigue sin señal: se reintenta después
        failed.push(`${draft.clientName || 'Pedido'}: ${err?.response?.data?.message || 'rechazado'}`);
        writeQueue(readQueue().filter((d) => d.id !== draft.id));
      }
    }
  } finally {
    flushing = false;
  }
  return { sent, failed };
}

/**
 * Pasa un pedido a la caja: arma el ticket con los mismos precios del pedido, elige el cliente
 * y deja el pedido vinculado (al cobrar queda como venta). Devuelve los productos que ya no existen.
 */
export function loadPreOrderIntoCart(order: any): string[] {
  const st = usePOSStore.getState();
  const missing: string[] = [];
  st.clearCart();
  for (const it of order.items || []) {
    const product = st.products.find((p: any) => p.id === it.productId);
    if (!product) { missing.push(it.productName); continue; }
    const pack = Number(it.packSize) > 1 ? Number(it.packSize) : 0;
    if (pack && packOf(product, hasFeature('bulk'))) {
      st.addPackToCart(product, { size: pack, price: Math.round(Number(it.unitPrice) * pack * 100) / 100 }, Number(it.quantity) / pack);
    } else {
      st.addToCart(product, Number(it.unitPrice), Number(it.quantity));
    }
  }
  if (order.client) {
    const client = st.clients.find((c: any) => c.id === order.client.id) || order.client;
    st.setSelectedClient(client);
  }
  st.setActiveOrder({ id: order.id, number: order.orderNumber, clientName: order.client?.name || '' });
  return missing;
}

/**
 * Oferta por cantidad (precio mayorista del producto): llevando la cantidad mínima del producto
 * entre todos sus renglones, cada unidad sale al precio de la oferta si es más barato. El
 * servidor hace la misma cuenta al guardar.
 */
export function withOffers(items: PreOrderItem[], products: any[]): (PreOrderItem & { offer?: boolean })[] {
  const byId = new Map(products.map((p: any) => [p.id, p]));
  const units = new Map<string, number>();
  for (const it of items) units.set(it.productId, (units.get(it.productId) || 0) + it.quantity);
  return items.map((it) => {
    const p: any = byId.get(it.productId);
    const price = Number(p?.wholesalePrice) || 0;
    const min = Number(p?.wholesaleMinQty) || 0;
    if (price > 0 && min > 0 && (units.get(it.productId) || 0) >= min - 1e-9 && price < it.unitPrice - 1e-9) return { ...it, unitPrice: price, offer: true };
    return it;
  });
}

/** Precio con el que entra al pedido: el del bulto o el de la unidad suelta */
export function priceFor(product: any, byPack: boolean) {
  const pack = packOf(product, true);
  if (byPack && pack) return { unitPrice: pack.price / pack.size, packSize: pack.size };
  return { unitPrice: Number(product.salePrice) || 0, packSize: null };
}
