/**
 * Descuenta unidades de los lotes activos de un producto, empezando por el que vence
 * primero (FEFO). Los lotes que quedan en cero se cierran como vendidos. Si se vende
 * más de lo que suman los lotes, el resto simplemente no tiene lote asignado.
 */
export async function consumeLotsFefo(tx: any, productId: string, quantity: number) {
  let left = quantity;
  if (!(left > 0)) return;
  const lots = await tx.productLot.findMany({
    where: { productId, status: 'ACTIVE', quantity: { gt: 0 } },
    orderBy: { expiresAt: 'asc' },
  });
  for (const lot of lots) {
    if (left <= 0) break;
    const take = Math.min(lot.quantity, left);
    const remaining = lot.quantity - take;
    await tx.productLot.update({
      where: { id: lot.id },
      data: remaining > 0 ? { quantity: remaining } : { quantity: 0, status: 'SOLD' },
    });
    left -= take;
  }
}

/** Crea el lote de una compra recibida, si el producto controla vencimiento y vino la fecha. */
export async function createPurchaseLot(tx: any, product: { id: string; trackExpiry?: boolean }, expiresAt: any, quantity: number, purchaseId?: string) {
  if (!product?.trackExpiry || !expiresAt || !(quantity > 0)) return;
  const str = String(expiresAt);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(str) ? new Date(`${str}T12:00:00`) : new Date(str);
  if (isNaN(d.getTime())) return;
  await tx.productLot.create({ data: { productId: product.id, expiresAt: d, quantity, purchaseId: purchaseId || null } });
}

/**
 * Devuelve unidades a los lotes (anulación de una venta o devolución): al lote activo que vence
 * primero, que es de donde salieron con FEFO. Si no queda ninguno activo, se reabre el último
 * lote que se cerró como vendido. Sin lotes, el stock vuelve igual (solo que sin lote asignado).
 */
export async function restoreLots(tx: any, productId: string, quantity: number) {
  if (!(quantity > 0)) return;
  const active = await tx.productLot.findFirst({ where: { productId, status: 'ACTIVE' }, orderBy: { expiresAt: 'asc' } });
  if (active) {
    await tx.productLot.update({ where: { id: active.id }, data: { quantity: active.quantity + quantity } });
    return;
  }
  const sold = await tx.productLot.findFirst({ where: { productId, status: 'SOLD' }, orderBy: { expiresAt: 'desc' } });
  if (sold) await tx.productLot.update({ where: { id: sold.id }, data: { quantity, status: 'ACTIVE' } });
}
