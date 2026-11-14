/**
 * Packs y kits (product.isKit): no tienen stock propio. El stock se cuenta en sus piezas
 * (un pack de 6 latas descuenta 6 latas al venderse, ver sales.service) y el del pack es
 * cuántos se pueden armar con lo que hay. Se calcula al leer, así nunca se desfasa.
 *
 * El costo del kit sí se guarda (lo usan los informes de ganancia): lo mantiene al día un
 * trigger de la base (ver prisma.service, "ventra_kit_cost_*").
 */

export interface KitPiece {
  childProductId: string;
  quantity: number;
  stock: number;
  unlimitedStock: boolean;
}

/** Cuántos kits alcanzan con estas piezas. null = ninguna pieza lleva stock (sin tope). */
export function kitStockFrom(pieces: KitPiece[]): number | null {
  let min: number | null = null;
  for (const p of pieces) {
    const per = Number(p.quantity);
    if (p.unlimitedStock || !(per > 0)) continue;
    const n = Math.max(0, Math.floor((Number(p.stock) || 0) / per + 1e-9));
    min = min === null ? n : Math.min(min, n);
  }
  return min;
}

type KitTx = { productKitItem: { findMany: (args: any) => Promise<any[]> } };

/** Las piezas de estos kits, con el stock de cada una, agrupadas por kit. */
export async function loadKitPieces(prisma: KitTx, kitIds: string[]): Promise<Map<string, KitPiece[]>> {
  const byKit = new Map<string, KitPiece[]>();
  if (!kitIds.length) return byKit;
  // Con muchos kits se traen todas las piezas (son pocas filas): evita el tope de variables de SQLite
  const rows = await prisma.productKitItem.findMany({
    where: kitIds.length > 500 ? undefined : { parentProductId: { in: kitIds } },
    select: { parentProductId: true, childProductId: true, quantity: true, childProduct: { select: { stock: true, unlimitedStock: true } } },
  });
  for (const r of rows) {
    const list = byKit.get(r.parentProductId) || [];
    list.push({
      childProductId: r.childProductId,
      quantity: Number(r.quantity) || 1,
      stock: Number(r.childProduct?.stock) || 0,
      unlimitedStock: !!r.childProduct?.unlimitedStock,
    });
    byKit.set(r.parentProductId, list);
  }
  return byKit;
}

/**
 * Cambia el `stock` de los kits por lo que alcanza con sus piezas. Con `pieces`, además agrega
 * `kitItems` ({ childProductId, quantity }) para que la caja lo recalcule sola después de cobrar.
 * Los productos que no son kit quedan igual.
 */
export async function withKitStock<T extends { id: string; isKit?: boolean | null; stock?: number | null }>(
  prisma: KitTx,
  products: T[],
  opts: { pieces?: boolean } = {},
): Promise<T[]> {
  const kitIds = products.filter((p) => p.isKit).map((p) => p.id);
  if (!kitIds.length) return products;
  const byKit = await loadKitPieces(prisma, kitIds);
  return products.map((p) => {
    if (!p.isKit) return p;
    const pieces = byKit.get(p.id);
    if (!pieces?.length) return p;
    const stock = kitStockFrom(pieces);
    return {
      ...p,
      ...(stock !== null ? { stock } : {}),
      ...(opts.pieces ? { kitItems: pieces.map((k) => ({ childProductId: k.childProductId, quantity: k.quantity })) } : {}),
    };
  });
}
