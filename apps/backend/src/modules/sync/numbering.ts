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
