import { usePOSStore } from '../../stores/posStore';
import { QUICK_SALE_PRODUCT_ID } from './QuickSaleModal';

/**
 * Cobrar un turno de la agenda en la caja (planes con caja): el turno entra al ticket como una
 * venta de precio libre (producto VENTA_RAPIDA, el mismo de la venta rápida) con el nombre del
 * servicio, y cuando la venta se registra el turno queda pagado en la agenda con el medio de pago.
 * Así la plata del turno entra al arqueo de la caja, como cualquier venta.
 */

export interface CartTurno { storeId: string; booking: any }

export function addTurnoToCart(storeId: string, booking: any) {
  const st = usePOSStore.getState();
  const cartKey = `turno_${booking.id}`;
  if (st.cart.some((i: any) => i.cartKey === cartKey)) return;
  // Lo que falta: el precio menos la seña que ya pagó por Mercado Pago
  const paidDeposit = booking.deposit?.status === 'paid' ? Number(booking.deposit.paidAmount ?? booking.deposit.amount) || 0 : 0;
  const price = Math.max(0, (Number(booking.price) || 0) - paidDeposit);
  const who = String(booking.customerName || '').split(' ')[0];
  usePOSStore.setState({
    cart: [...st.cart, {
      cartKey,
      productId: QUICK_SALE_PRODUCT_ID,
      name: `Turno · ${booking.serviceName || 'servicio'}${who ? ` (${who})` : ''}`,
      price, regularPrice: price, originalSalePrice: price, isCustomPrice: true,
      quantity: 1, maxStock: 1, barcode: QUICK_SALE_PRODUCT_ID,
      turno: { storeId, booking } as CartTurno,
    } as any],
  });
}

/** Después de registrar la venta: marca como pagados los turnos que iban en el ticket. */
export function chargeTurnosOfSale(cart: any[], methodLabel: string) {
  const turnos = cart.filter((i) => i.turno?.booking?.id);
  if (!turnos.length) return;
  import('../../services/agenda').then(({ chargeBooking }) => Promise.all(turnos.map((i) =>
    chargeBooking(i.turno.storeId, i.turno.booking, { method: `${methodLabel} (caja)`, amount: Number(i.price) * Number(i.quantity || 1) }),
  ))).catch((err) => console.warn('[Caja] No se pudo marcar el turno como cobrado', err));
}
