/**
 * Comprobante de una compra (pedido de Limpissimo, 2026-11-26, como lo cargaba en Fidel):
 * qué tipo es (Factura A/B/C o presupuesto en negro), el IVA de cada producto, el descuento general,
 * las percepciones y el redondeo. Lo más importante para el dueño: saber si la compra es en blanco o
 * en negro, para decidir si al proveedor se le puede transferir o dar cheque.
 *
 * Sin comprobante elegido la compra se carga como siempre (el "Calcular IVA 21%" de antes).
 */

export type DocKind = '' | 'A' | 'B' | 'C' | 'X';

export const DOC_KINDS: { id: Exclude<DocKind, ''>; label: string; short: string; blanco: boolean; hint: string }[] = [
  { id: 'A', label: 'Factura A', short: 'Fact. A', blanco: true, hint: 'Precios sin IVA: se suma el IVA de cada producto' },
  { id: 'B', label: 'Factura B', short: 'Fact. B', blanco: true, hint: 'Precios con el IVA incluido' },
  { id: 'C', label: 'Factura C', short: 'Fact. C', blanco: true, hint: 'Monotributista: sin IVA' },
  { id: 'X', label: 'Presupuesto (en negro)', short: 'Presup.', blanco: false, hint: 'Sin factura: sin IVA ni percepciones' },
];

export const IVA_RATES = [21, 10.5, 27, 5, 2.5, 0];

export const docKindInfo = (k?: string | null) => DOC_KINDS.find((d) => d.id === k) || null;

/** IVA de un renglón: el elegido, o el del producto, o 21 */
export const rateOf = (i?: { ivaRate?: any } | null) => {
  const r = Number(i?.ivaRate);
  return Number.isFinite(r) && r >= 0 ? r : 21;
};

/**
 * Por cuánto se multiplica el costo cargado para llegar al costo final del producto.
 * Factura A: + el IVA del renglón. B, C y presupuesto: el precio ya es el final.
 * Sin comprobante: como antes, + 21% si "Calcular IVA" está prendido.
 */
export const ivaMulFor = (kind: DocKind, useIvaGlobal: boolean, item?: { ivaRate?: any } | null) =>
  kind === 'A' ? 1 + rateOf(item) / 100 : kind ? 1 : useIvaGlobal ? 1.21 : 1;

export interface FiscalExtras {
  /** Descuento general sobre el subtotal */
  discountPct: number;
  discountAmt: number;
  percIva: number;
  percGanancias: number;
  /** Percepción de Ingresos Brutos por provincia */
  iibb: { province: string; amount: number }[];
  /** Redondeo de la factura (puede ser negativo) */
  rounding: number;
}

export const EMPTY_EXTRAS: FiscalExtras = { discountPct: 0, discountAmt: 0, percIva: 0, percGanancias: 0, iibb: [], rounding: 0 };

export const PROVINCES = [
  'Santa Fe', 'Buenos Aires', 'CABA', 'Córdoba', 'Entre Ríos', 'Mendoza', 'Tucumán', 'Salta', 'Misiones', 'Corrientes',
  'Chaco', 'Santiago del Estero', 'San Juan', 'San Luis', 'La Pampa', 'Neuquén', 'Río Negro', 'Chubut', 'Santa Cruz',
  'Tierra del Fuego', 'Jujuy', 'Catamarca', 'La Rioja', 'Formosa',
];

const n = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

export interface FiscalTotals {
  /** Suma de los renglones (en Factura A, sin IVA) */
  subtotal: number;
  discount: number;
  /** Lo que queda de cada peso después del descuento general (1 = sin descuento) */
  factor: number;
  /** Neto gravado (A) o subtotal con el descuento (B, C, presupuesto) */
  net: number;
  ivaDetail: { rate: number; base: number; amount: number }[];
  iva: number;
  perceptions: number;
  total: number;
}

/** Las cuentas de la factura. `lines`: el subtotal de cada renglón (cantidad × costo con bonificación) y su IVA. */
export function fiscalTotals(kind: DocKind, lines: { amount: number; rate: number }[], extras: FiscalExtras): FiscalTotals {
  const subtotal = r2(lines.reduce((s, l) => s + n(l.amount), 0));
  const pct = Math.min(100, Math.max(0, n(extras.discountPct)));
  const discount = r2(Math.min(subtotal, subtotal * pct / 100 + Math.max(0, n(extras.discountAmt))));
  const factor = subtotal > 0 ? (subtotal - discount) / subtotal : 1;
  const net = r2(subtotal - discount);
  const byRate = new Map<number, number>();
  if (kind === 'A') for (const l of lines) byRate.set(l.rate, (byRate.get(l.rate) || 0) + n(l.amount) * factor);
  const ivaDetail = [...byRate.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, base]) => ({ rate, base: r2(base), amount: r2(base * rate / 100) }));
  const iva = r2(ivaDetail.reduce((s, d) => s + d.amount, 0));
  const perceptions = kind && kind !== 'X'
    ? r2(n(extras.percIva) + n(extras.percGanancias) + (extras.iibb || []).reduce((s, p) => s + n(p.amount), 0))
    : 0;
  const total = r2(net + iva + perceptions + n(extras.rounding));
  return { subtotal, discount, factor, net, ivaDetail, iva, perceptions, total };
}

/** Lo que se guarda con la compra (columna purchases.fiscal) */
export function fiscalRecord(kind: Exclude<DocKind, ''>, t: FiscalTotals, extras: FiscalExtras) {
  const iibb = kind === 'X' ? [] : (extras.iibb || []).filter((p) => n(p.amount) !== 0).map((p) => ({ province: String(p.province || ''), amount: r2(n(p.amount)) }));
  return {
    v: 1,
    kind,
    blanco: kind !== 'X',
    subtotal: t.subtotal,
    discountPct: n(extras.discountPct),
    discount: t.discount,
    net: t.net,
    ivaDetail: t.ivaDetail,
    iva: t.iva,
    percIva: kind === 'X' ? 0 : r2(n(extras.percIva)),
    percGanancias: kind === 'X' ? 0 : r2(n(extras.percGanancias)),
    iibb,
    rounding: r2(n(extras.rounding)),
    total: t.total,
  };
}
