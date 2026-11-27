/**
 * "Cómo lo entendí" (2026-11-26): la cuenta de cada renglón escaneado, en palabras, para la revisión
 * visual de la boleta. Ej.: "38 bultos de 10 = 380 unidades · 38 × $ 11.343,51 = $ 431.053,38 ·
 * te sale $ 1.134,35 c/u". Pura: la usa PurchasesService.scanOne y la prueba test:boletas.
 */
import { parseArNumber } from './numbers';

const n = (v: any): number => parseArNumber(v) ?? 0;
const fmt = (v: number, dec = 2) => (Math.round(v * 10 ** dec) / 10 ** dec).toLocaleString('es-AR', { maximumFractionDigits: dec });
const money = (v: number) => `$ ${fmt(v)}`;

export type ExplainCtx = {
  /** Unidades que entran al stock (con el regalo) y por bulto, ya corregidas por la caja */
  quantity: number;
  unitsPerPack: number;
  freeUnits: number;
  /** Costo real por unidad con IVA (con el regalo) y sin el regalo */
  unitCostWithIva: number;
  listCostWithIva: number;
  /** Renglón en $ 0 de otro producto (regalo aparte) */
  gift?: boolean;
};

export function explainLine(it: any, c: ExplainCtx): string {
  const parts: string[] = [];
  const q = Number(it?.packageQuantity) || 0;
  const upp = c.unitsPerPack > 1 ? c.unitsPerPack : 1;
  if (c.gift) {
    parts.push(`renglón en $ 0 que dice ${/bonif|regalo|sin cargo|s\/c|obsequio/i.test(String(it?.name || '')) ? 'bonificación' : 'regalo'}: ${fmt(c.quantity)} de regalo, entran al stock sin cambiar el costo`);
    return parts.join(' · ');
  }
  const paidUnits = c.quantity - c.freeUnits;
  if (upp > 1 && q > 0) parts.push(`${fmt(q)} ${q === 1 ? 'bulto' : 'bultos'} de ${fmt(upp)} = ${fmt(paidUnits)} unidades`);
  const price = n(it?.unitPrice);
  const d = n(it?.discountPct);
  const total = n(it?.total);
  if (price > 0 && q > 0 && total) {
    const cuenta = `${fmt(q)} × ${money(price)}${d > 0 && d < 100 ? ` − ${fmt(d)}%` : ''} = ${money(total)}`;
    parts.push(it?.lineOk === false ? `${cuenta.replace(' = ', ' no da ')} (la boleta dice ${money(total)}): mirá la foto` : cuenta);
  } else if (total) {
    parts.push(`importe ${money(total)}`);
  }
  if (c.freeUnits > 0) parts.push(`+${fmt(c.freeUnits)} de regalo = ${fmt(c.quantity)} al stock`);
  if (c.unitCostWithIva > 0 && (upp > 1 || c.freeUnits > 0 || d > 0)) {
    parts.push(`te sale ${money(c.unitCostWithIva)} c/u${c.freeUnits > 0 ? ` (sin regalo ${money(c.listCostWithIva)})` : ''}`);
  }
  return parts.join(' · ');
}

/**
 * Rectángulo del renglón en la foto ([izq, arriba, der, abajo] en milésimos), o null si la IA no lo
 * pudo ubicar o vino roto (se muestra la foto entera).
 */
export function cleanBox(box: any): [number, number, number, number] | null {
  if (!Array.isArray(box) || box.length !== 4) return null;
  const b = box.map((v) => Math.max(0, Math.min(1000, Number(v))));
  if (b.some((v) => !Number.isFinite(v))) return null;
  const [x0, y0, x1, y1] = b;
  if (x1 - x0 < 5 || y1 - y0 < 3) return null;
  return [x0, y0, x1, y1];
}
