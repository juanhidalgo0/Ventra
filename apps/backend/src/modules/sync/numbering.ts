/**
 * Numeración por caja: cada caja de un comercio numera en su propio rango, así
 * dos cajas sin internet nunca repiten un número de venta, remito o presupuesto.
 *
 * La caja 0 (la original, o cualquier PC sin vincular) conserva su numeración
 * de siempre: 1, 2, 3… La caja 1 usa 1.000.001 en adelante, la 2 desde 2.000.001, etc.
 */
export const NUMBER_RANGE = 1_000_000;

type RawDb = { $queryRawUnsafe: (query: string, ...values: any[]) => Promise<any> };

export async function nodeIndex(db: RawDb): Promise<number> {
  try {
    const rows: any[] = await db.$queryRawUnsafe(`SELECT value FROM sync_state WHERE key = 'node_index'`);
    const n = Number(rows[0]?.value);
    return Number.isInteger(n) && n > 0 ? n : 0;
  } catch {
    return 0; // Sin sincronización: numeración de siempre
  }
}

/** Rango [desde, hasta) de números de esta caja. */
export async function numberRange(db: RawDb): Promise<{ from: number; to: number; index: number }> {
  const index = await nodeIndex(db);
  return { from: index * NUMBER_RANGE, to: (index + 1) * NUMBER_RANGE, index };
}

/**
 * Próximo número de venta o pedido de esta caja. Pedidos de preventa y ventas comparten la
 * numeración: así el pedido N° 1234 sale con el remito N° 1234 y queda como venta N° 1234.
 */
export async function nextDocNumber(tx: any): Promise<number> {
  const range = await numberRange(tx);
  const inRange = { gte: range.from, lt: range.to };
  const lastSale = await tx.sale.findFirst({ where: { saleNumber: inRange }, orderBy: { saleNumber: 'desc' }, select: { saleNumber: true } });
  const lastOrder = tx.preOrder
    ? await tx.preOrder.findFirst({ where: { orderNumber: inRange }, orderBy: { orderNumber: 'desc' }, select: { orderNumber: true } }).catch(() => null)
    : null;
  const floor = await saleNumberFloor(tx);
  return Math.max(range.from, lastSale?.saleNumber || 0, lastOrder?.orderNumber || 0, floor >= range.from && floor < range.to ? floor : 0) + 1;
}

/**
 * Último número de venta de esta caja según la nube al terminar la carga total. Las ventas
 * viejas bajan después (historia en segundo plano): sin esto, una caja que no vendió en el
 * último mes repetiría números.
 */
export async function saleNumberFloor(db: RawDb): Promise<number> {
  try {
    const rows: any[] = await db.$queryRawUnsafe(`SELECT value FROM sync_state WHERE key = 'sale_number_floor'`);
    const n = Number(rows[0]?.value);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0; // Sin sincronización
  }
}
