import api from './api';
import toast from 'react-hot-toast';
import { STORE_ID_KEY, subscribeToStoreOrders, markOrderSyncedLocally, type StoreOrder } from './onlineStore';

// Escucha en segundo plano los pedidos que llegan a la tienda online y crea un
// Presupuesto (Quote) local por cada uno, para que el pedido quede visible en el
// POS además de llegarle al comercio por WhatsApp. Se monta una sola vez a nivel
// de la app (ver App.tsx) y corre mientras la terminal esté abierta y logueada.
let unsubscribe: (() => void) | null = null;
const processing = new Set<string>();

export function startOnlineOrdersSync() {
  if (unsubscribe) return; // ya corriendo
  const storeId = localStorage.getItem(STORE_ID_KEY);
  if (!storeId) return; // esta terminal todavía no configuró su tienda online

  unsubscribe = subscribeToStoreOrders(storeId, (orders) => {
    const pending = orders.filter(o => !o.syncedLocal && o.status !== 'SYNCED');
    for (const order of pending) {
      if (processing.has(order.id)) continue;
      processing.add(order.id);
      createLocalQuoteFromOrder(storeId, order)
        .catch((err) => console.warn('[OnlineStoreOrders] Error procesando pedido', order.id, err))
        .finally(() => processing.delete(order.id));
    }
  });
}

export function stopOnlineOrdersSync() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  processing.clear();
}

async function createLocalQuoteFromOrder(storeId: string, order: StoreOrder) {
  const itemsLine = order.items.map(i => `${i.qty}x ${i.name}`).join(', ');
  const notes = `PEDIDO ONLINE (Tienda Web)${order.customerNote ? ` — ${order.customerNote}` : ''} — Items: ${itemsLine}`;

  await api.post('/quotes', {
    clientName: order.customerName || 'Cliente Web',
    clientPhone: order.customerPhone || undefined,
    notes,
    items: order.items.map(i => ({
      productId: i.productId || undefined,
      productName: i.name,
      unitPrice: i.price,
      quantity: i.qty,
    })),
  });

  await markOrderSyncedLocally(storeId, order.id);
  toast.success(`🛍️ Nuevo pedido online de ${order.customerName || 'un cliente'} — guardado como presupuesto`, { duration: 6000 });
}
