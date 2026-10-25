import { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import api from '../../services/api';
import { wsService } from '../../services/websocket';
import { usePOSStore } from '../../stores/posStore';

/**
 * Pedidos de GO para la caja: los que todavía están en curso y "Cobrar pedido GO", que arma el
 * ticket con lo que pidió el cliente (o lo que el repartidor marcó que llevó). La venta se cobra
 * como cualquier otra y queda unida al pedido (backend: sales.service, goOrderId).
 */
export type GoItem = {
  ventraId?: string | null; barcode?: string | null; name: string; qty: number; orderedQty?: number; price: number;
  shopStatus?: string | null; replacement?: { name: string; price: number } | null;
};
export type GoOrder = {
  id: string; number?: string | null; status: string; isShopper: boolean; shopPending: boolean; createdMs: number; completedMs?: number | null;
  cancelReason?: string | null; customer?: string | null; driverName?: string | null; paymentMethod?: string | null;
  subtotal: number; estimatedSubtotal: number; total: number; items: GoItem[]; saleId?: string | null;
};

const FINAL = ['completed', 'delivered', 'cancelled'];
const money = (n: number) => new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n || 0);
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Se puede cobrar en la caja: en curso y todavía sin venta */
export const isChargeable = (o: GoOrder) => !FINAL.includes(o.status) && !o.saleId;

/** Pedidos de GO en curso sin cobrar (de ayer y hoy). Se actualiza con cada aviso de GO. */
export function useGoOpenOrders(enabled = true) {
  const [orders, setOrders] = useState<GoOrder[]>([]);
  const load = useCallback(async () => {
    try {
      const { data } = await api.get('/go/orders', { params: { status: 'open', from: ymd(new Date(Date.now() - 864e5)) } });
      setOrders((Array.isArray(data) ? data : []).filter(isChargeable));
    } catch { /* sin GO o sin conexión con el servidor: no se muestra nada */ }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    load();
    const t = setInterval(load, 60_000);
    const onEvent = () => { load(); };
    wsService.on('go:order', onEvent);
    return () => { clearInterval(t); wsService.off('go:order', onEvent); };
  }, [enabled, load]);
  return { orders, reload: load };
}

/** Carga el pedido en el carrito con los precios de la caja. Devuelve false si no se cargó. */
export function loadGoOrderInCart(o: GoOrder): boolean {
  const { products, addToCart, clearCart, cart, setActiveGoOrder } = usePOSStore.getState();
  if (o.saleId) { toast.error('Este pedido ya se cobró en la caja.'); return false; }
  if (cart.length && !window.confirm('La caja tiene productos cargados. ¿Reemplazarlos por este pedido de GO?')) return false;
  clearCart();
  const manual: string[] = [];
  let loaded = 0;
  for (const it of o.items) {
    if (it.shopStatus === 'missing') continue;
    // El reemplazo lo eligió el repartidor en el local: se escanea como cualquier producto
    if (it.shopStatus === 'replaced') {
      manual.push(it.replacement ? `${it.qty} × ${it.replacement.name} (${money(it.replacement.price)} c/u)` : `el reemplazo de ${it.name}`);
      continue;
    }
    const p = products.find((x: any) => x.id === it.ventraId) || (it.barcode ? products.find((x: any) => x.barcode === it.barcode) : undefined);
    if (!p) { manual.push(it.name); continue; }
    addToCart(p, undefined, Number(it.qty) > 0 ? Number(it.qty) : 1);
    loaded++;
  }
  setActiveGoOrder({ id: o.id, number: o.number ?? null, driverName: o.driverName ?? null });
  if (manual.length) toast(`Escaneá a mano: ${manual.join(', ')}`, { icon: '🛵', duration: 9000 });
  toast.success(o.shopPending
    ? `Pedido GO cargado (${loaded}). Si el repartidor no lleva algo, sacalo antes de cobrar.`
    : `Pedido GO cargado con lo que llevó el repartidor (${loaded}).`, { duration: 6000 });
  return true;
}
