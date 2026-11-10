/**
 * Cuentas de la pantalla "Aumentar precios" (PriceEditorModal). Sin React: se pueden probar solas.
 *
 * Reglas:
 * - Cada tanda se calcula sobre el precio ORIGINAL del producto (el que tenía al abrir la pantalla),
 *   no sobre el que dejó una tanda anterior: aplicar +12 % dos veces deja +12 %, no +25,4 %.
 * - El redondeo ($10, $50, $100) es hacia arriba, como "Redondear precios" (bulkRoundPrices), y solo
 *   en los precios de venta. El costo nunca se redondea: inventaría una ganancia que no existe.
 * - Monto fijo: es por unidad; al precio del bulto se le suma el monto por las unidades del bulto.
 */

export type PriceField = 'salePrice' | 'costPrice' | 'wholesalePrice' | 'tradePrice' | 'packPrice';
export type Prices = Partial<Record<PriceField, number>>;

export interface EditorProduct {
  id: string;
  name: string;
  barcode?: string | null;
  sku?: string | null;
  brand?: string | null;
  category?: string | null;
  supplier?: string | null;
  costPrice: number;
  salePrice: number;
  wholesalePrice: number | null;
  tradePrice: number | null;
  packPrice: number | null;
  unitsPerPack: number;
  priceChangedAt: number | null;
}

export const FIELD_LABELS: Record<PriceField, string> = {
  salePrice: 'Venta',
  costPrice: 'Costo',
  wholesalePrice: 'Mayorista',
  tradePrice: 'Comercio',
  packPrice: 'Bulto',
};

/** Los precios de venta (los que se redondean y siguen al costo con "mantener la ganancia") */
export const SELL_FIELDS: PriceField[] = ['salePrice', 'wholesalePrice', 'tradePrice', 'packPrice'];
export const ALL_FIELDS: PriceField[] = ['salePrice', 'costPrice', 'wholesalePrice', 'tradePrice', 'packPrice'];

export interface Adjustment {
  direction: 'up' | 'down';
  mode: 'pct' | 'amount';
  value: number;
  fields: PriceField[];
  round: number; // 0 = sin redondeo
}

const cents = (n: number) => Math.round(n * 100) / 100;

/** Redondeo hacia arriba al múltiplo (igual que bulkRoundPrices). Con 0, solo a centavos. */
export function roundUp(n: number, multiple: number): number {
  if (!(multiple > 0)) return cents(n);
  // El - 1e-9 evita que 2800.0000001 (error de coma flotante) suba a 2810
  return Math.ceil(n / multiple - 1e-9) * multiple;
}

/** ¿El producto tiene este precio? (mayorista, comercio y bulto son opcionales) */
export function hasField(p: EditorProduct, f: PriceField): boolean {
  const v = p[f];
  return typeof v === 'number' && v > 0;
}

/** Precios nuevos de un producto al aplicarle una tanda (sobre los originales) */
export function adjust(p: EditorProduct, a: Adjustment): Prices {
  const out: Prices = {};
  const sign = a.direction === 'up' ? 1 : -1;
  for (const f of a.fields) {
    if (!hasField(p, f)) continue;
    const orig = p[f] as number;
    let n = a.mode === 'pct'
      ? orig * (1 + (sign * a.value) / 100)
      : orig + sign * a.value * (f === 'packPrice' ? Math.max(1, p.unitsPerPack || 1) : 1);
    n = f === 'costPrice' ? cents(n) : roundUp(n, a.round);
    out[f] = Math.max(0, n);
  }
  return out;
}

/**
 * El costo nuevo cargado a mano: si "mantener la ganancia" está prendido, los precios de venta se
 * mueven en la misma proporción que el costo (si el costo sube 8 %, la venta sube 8 %).
 */
export function followCost(p: EditorProduct, newCost: number, round: number): Prices {
  const out: Prices = { costPrice: cents(newCost) };
  if (!(p.costPrice > 0) || !(newCost > 0)) return out;
  const ratio = newCost / p.costPrice;
  for (const f of SELL_FIELDS) if (hasField(p, f)) out[f] = roundUp((p[f] as number) * ratio, round);
  return out;
}

/** Ganancia sobre el costo, como en la ficha del producto: (venta / costo − 1) × 100 */
export function marginPct(sale: number, cost: number): number | null {
  if (!(cost > 0) || !(sale > 0)) return null;
  return (sale / cost - 1) * 100;
}

/** Los precios que de verdad cambian respecto del original */
export function realChanges(p: EditorProduct, draft: Prices | undefined): Prices {
  const out: Prices = {};
  if (!draft) return out;
  for (const f of ALL_FIELDS) {
    const v = draft[f];
    if (v === undefined) continue;
    const orig = (p[f] ?? 0) as number;
    if (Math.abs(v - orig) >= 0.005) out[f] = v;
  }
  return out;
}

export function pctChange(orig: number, next: number): number | null {
  if (!(orig > 0)) return null;
  return (next / orig - 1) * 100;
}

export const money = (n: number | null | undefined) =>
  `$${Number(n || 0).toLocaleString('es-AR', { maximumFractionDigits: 2 })}`;

export const pctText = (n: number | null) =>
  n === null ? '' : `${n > 0 ? '+' : ''}${n.toLocaleString('es-AR', { maximumFractionDigits: 1 })}%`;
