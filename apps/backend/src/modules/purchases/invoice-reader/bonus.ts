/**
 * Bonificaciones en mercadería, correcciones a mano y boletas viejas (2026-11-26).
 *
 * Cómo lo hace el comerciante: si le vienen 24 + 2 de regalo, suma las 26 y divide lo que pagó.
 * Ventra hace lo mismo con el STOCK y el costo de la compra, pero el costo del producto (el de
 * reposición, el que mantiene el margen) sale de lo que se paga sin regalo: si no, al bajar el costo
 * por el regalo, "mantener margen" bajaría también el precio de venta y se regalaría la ganancia;
 * y la compra siguiente sin regalo haría saltar el precio de más.
 *
 * Todo puro: lo usan PurchasesService.scanOne y las pruebas (npm run test:boletas).
 */
import { parseArNumber } from './numbers';

const parseArgentineNumber = (v: any): number => parseArNumber(v) ?? 0;

const BONUS_WORDS = /\b(bonif\w*|sin cargo|s\/c|regalo|obsequio|gratis)\b/i;

const norm = (s: any) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(BONUS_WORDS, ' ').replace(/[^a-z0-9]+/g, ' ').trim();

/**
 * Regalo escrito en el nombre: "TULIPAN EXHIBIDOR 24+2u" → { paid: 24, free: 2 }, "COCA 2,25 12+1" →
 * { paid: 12, free: 1 }. El regalo tiene que ser menor que lo pagado (no confunde "2+2" ni "1+1 = 2x1").
 */
export function bonusInName(name: any): { paid: number; free: number } | null {
  const m = /(?:^|[^\d.,x*])(\d{1,3})\s*\+\s*(\d{1,2})\s*(?:u\b|un\b|unid\w*|uni\b|(?=\s|$|\)))/i.exec(String(name || ''));
  if (!m) return null;
  const paid = Number(m[1]), free = Number(m[2]);
  return paid >= 2 && free >= 1 && free < paid ? { paid, free } : null;
}

/** ¿Este renglón en $ 0 es mercadería de regalo? (lo dice la IA o el nombre) */
export function isBonusLine(it: any): boolean {
  if (parseArgentineNumber(it?.total) !== 0) return false;
  if (it?.isBonus === 'si') return true;
  if (it?.isBonus === 'no') return false;
  return BONUS_WORDS.test(String(it?.name || ''));
}

export type BonusResult = {
  /** Renglones que se pagan, con `bonusUnits` (regalo en unidades sueltas, sumado de todos lados) */
  paid: any[];
  /** Renglones en $ 0 de OTRO producto (te regalan algo distinto): entran al stock sin tocar el costo */
  gifts: any[];
  /** Renglones en $ 0 que no son mercadería (un cambio, "PEDIDO AC DIGITAL"): no se cargan */
  skipped: string[];
  /** Regalos de un renglón aparte que se sumaron a su producto (para avisarlo en la revisión) */
  merged: { name: string; units: number; into: string }[];
};

/**
 * Separa los renglones de la boleta y junta cada regalo con su producto:
 * - "24+2u" en el nombre (si la IA no lo marcó): unitsPerPack 24 y 2 de regalo por bulto.
 * - Renglón aparte en $ 0 del mismo producto (por "bonusOf", el código o el nombre): sus unidades se
 *   suman como regalo al renglón que se paga.
 * - Renglón en $ 0 de otro producto: regalo aparte (gifts).
 * Los descuentos en negativo y los renglones con importe no se tocan (siguen en `paid`).
 */
export function applyBonuses(items: any[]): BonusResult {
  const all = Array.isArray(items) ? items : [];
  const paid: any[] = [];
  const zero: any[] = [];
  for (const it of all) {
    const total = parseArgentineNumber(it?.total);
    if (total === 0) { zero.push(it); continue; }
    const q = Number(it.packageQuantity) || 0;
    let upp = Number(it.unitsPerPack) || 1;
    let bonus = Math.max(0, Number(it.bonusUnits) || 0);
    // La IA no lo marcó pero el nombre lo dice: "24+2u" x 1 = 24 que se pagan + 2 de regalo
    const inName = total > 0 ? bonusInName(it.name) : null;
    if (!bonus && inName && q > 0 && (upp === 1 || upp === inName.paid)) {
      if (upp === 1 && q >= inName.paid && Number.isInteger(q / inName.paid)) {
        // La cantidad ya vino en unidades (48 de "24+2u" = 2 exhibidores): 4 de regalo, sin tocar los bultos
        bonus = (q / inName.paid) * inName.free;
      } else {
        upp = inName.paid;
        bonus = q * inName.free;
      }
    }
    paid.push({ ...it, unitsPerPack: total > 0 ? upp : it.unitsPerPack, bonusUnits: total > 0 ? bonus : 0 });
  }
  const gifts: any[] = [];
  const skipped: string[] = [];
  const merged: BonusResult['merged'] = [];
  const goods = paid.filter((p) => parseArgentineNumber(p.total) > 0);
  for (const z of zero) {
    if (!isBonusLine(z)) { const n = String(z?.name || '').trim(); if (n) skipped.push(n); continue; }
    const units = (Number(z.packageQuantity) || 0) * (Number(z.unitsPerPack) || 1);
    if (!(units > 0)) { const n = String(z?.name || '').trim(); if (n) skipped.push(n); continue; }
    const of = norm(z.bonusOf);
    const own = norm(z.name);
    const sku = String(z.sku || '').trim();
    const target = (of && goods.find((g) => norm(g.name) === of))
      || (of && of.length >= 6 && goods.find((g) => { const n = norm(g.name); return n.includes(of) || of.includes(n); }))
      || (sku && goods.find((g) => String(g.sku || '').trim() === sku))
      || (own.length >= 6 && goods.find((g) => norm(g.name) === own))
      || null;
    if (target) {
      target.bonusUnits = (Number(target.bonusUnits) || 0) + units;
      merged.push({ name: String(z.name || '').trim(), units, into: String(target.name || '').trim() });
    } else {
      gifts.push({ ...z, gift: true, bonusUnits: 0 });
    }
  }
  return { paid, gifts, skipped, merged };
}

/**
 * Corrección a mano de un renglón (faltó mercadería): la cantidad que quedaría, en la unidad de la
 * cantidad del renglón (packageQuantity). Con "handQty" de la IA, o deducida de un importe restado
 * ("-28860" en un renglón de 20 a 2.888,60 → faltaron 10 → quedan 10). null si no hay corrección clara.
 */
export function handQtyOf(it: any): number | null {
  const q = Number(it?.packageQuantity) || 0;
  if (!(q > 0)) return null;
  const hq = Number(it?.handQty) || 0;
  if (hq > 0 && Math.abs(hq - q) > 1e-9 && hq < q * 20) return hq;
  // "Faltó" sin número: no vino nada de ese renglón
  const note = String(it?.handNote || '');
  if (!hq && /(^|[^a-z])(falt[oóa]|no vino|no lleg[oó])([^a-z]|$)/i.test(note) && !/\d/.test(note)) return 0;
  const m = /-\s*\$?\s*([\d.,]+)/.exec(String(it?.handNote || ''));
  if (m) {
    const amount = parseArgentineNumber(m[1]);
    const d = parseArgentineNumber(it?.discountPct);
    const f = d > 0 && d < 100 ? 1 - d / 100 : 1;
    const price = parseArgentineNumber(it?.unitPrice) * f || parseArgentineNumber(it?.total) / q;
    if (amount > 0 && price > 0) {
      const k = amount / price;
      const r = Math.round(k);
      if (r > 0 && r < q && Math.abs(k - r) < 0.02) return q - r;
    }
  }
  return null;
}

/**
 * ¿La boleta es más vieja que la última compra de este producto? Entonces suma stock pero no pisa el
 * costo ni el precio de venta (una boleta de mayo con las papas a $ 1.400 bajaría lo que hoy cuesta
 * $ 1.700). Fechas AAAA-MM-DD. Un día de margen: dos boletas del mismo día no se frenan entre sí.
 */
export function olderThanLast(invoiceDate: string | null | undefined, lastDate: string | null | undefined): boolean {
  const a = Date.parse(String(invoiceDate || '').slice(0, 10));
  const b = Date.parse(String(lastDate || '').slice(0, 10));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  return a < b - 864e5;
}

/** Días entre la fecha de la boleta y hoy (para el aviso de "boleta de hace 6 meses"). null si no hay fecha. */
export function daysOld(invoiceDate: string | null | undefined, today = new Date()): number | null {
  const a = Date.parse(String(invoiceDate || '').slice(0, 10));
  if (!Number.isFinite(a)) return null;
  return Math.floor((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - a) / 864e5);
}

/**
 * Proveedor de una boleta que no dice quién la emite (las de cigarrillos: solo "Comprobante N°" y el
 * cliente): el proveedor de la mayoría de los productos que se reconocieron. Hace falta que sean al
 * menos 3 y que 2 de cada 3 coincidan. supplierIds: el proveedor de cada producto reconocido (o null).
 */
export function supplierByProducts(supplierIds: (string | null | undefined)[]): string | null {
  const known = supplierIds.filter((s): s is string => !!s);
  if (known.length < 3) return null;
  const count = new Map<string, number>();
  for (const s of known) count.set(s, (count.get(s) || 0) + 1);
  const [best, n] = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
  return n / known.length >= 2 / 3 ? best : null;
}

/**
 * Los productos que subieron con esta boleta, en resumen: cuántos, el promedio y los que más.
 * rows: { name, changePct } de los productos que ya existían (changePct en %, null si no se sabe).
 */
export function raiseSummary(rows: { name: string; changePct: number | null }[]) {
  const up = rows.filter((r) => r.changePct !== null && r.changePct >= 2 && r.changePct <= 80);
  const down = rows.filter((r) => r.changePct !== null && r.changePct <= -2 && r.changePct >= -50);
  if (!up.length && !down.length) return null;
  const avg = up.length ? Math.round((up.reduce((s, r) => s + (r.changePct as number), 0) / up.length) * 10) / 10 : 0;
  const top = up.slice().sort((a, b) => (b.changePct as number) - (a.changePct as number)).slice(0, 3);
  return { up: up.length, down: down.length, avgUp: avg, top: top.map((r) => ({ name: r.name, pct: r.changePct as number })) };
}
