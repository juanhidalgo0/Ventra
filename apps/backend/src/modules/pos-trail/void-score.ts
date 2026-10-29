/**
 * Puntaje de sospecha de lo que se quitó del ticket (o se borró del catálogo).
 * Reglas simples y explicables: cada una suma o resta y deja su motivo escrito, así el dueño
 * ve POR QUÉ algo es sospechoso. Función pura: la prueba está en scripts/test-void-score.ts.
 */

export type VoidAction = 'ITEM_REMOVED' | 'QTY_REDUCED' | 'CART_CLEARED' | 'HELD_CART_DELETED' | 'PRODUCT_DELETED' | 'PRODUCTS_BULK_DELETED';
export type VoidLevel = 'normal' | 'revisar' | 'sospechoso';

export interface VoidFacts {
  action: VoidAction;
  amount: number;
  totalAfter?: number | null;
  totalShown?: boolean;
  items?: { productId: string; secondsInCart?: number | null }[];
  /** Borrar del catálogo: cuántos productos, con cuánto stock y si lo hizo alguien que no es el dueño */
  count?: number;
  stock?: number;
  byAdmin?: boolean;
}

/** Lo que pasó en esa caja en los 3 minutos siguientes. undefined: todavía no se sabe. */
export interface FollowUp { saleAfter: boolean; sameProductResold: boolean }

export interface VoidScore { score: number; level: VoidLevel; reasons: string[]; pending: boolean }

export const DEFAULT_BIG_AMOUNT = 10000;
export const FOLLOW_UP_MS = 3 * 60 * 1000;
const SLOW_REMOVAL_S = 60;
const QUICK_REMOVAL_S = 10;
export const LEVEL_REVIEW = 30;
export const LEVEL_SUSPICIOUS = 60;

const money = (n: number) => '$' + Math.round(n).toLocaleString('es-AR');
const fmtWait = (s: number) => (s < 120 ? `${s} s` : `${Math.round(s / 60)} min`);

export function scoreVoid(f: VoidFacts, follow: FollowUp | undefined, bigAmount = DEFAULT_BIG_AMOUNT): VoidScore {
  const reasons: string[] = [];
  let score = 0;
  const add = (n: number, why: string) => { score += n; reasons.push(why); };
  const amount = Number(f.amount) || 0;
  const big = bigAmount > 0 ? bigAmount : DEFAULT_BIG_AMOUNT;

  if (f.action === 'PRODUCT_DELETED' || f.action === 'PRODUCTS_BULK_DELETED') {
    const count = Number(f.count) || 1;
    add(count > 1 ? 40 : 30, count > 1 ? `Borró ${count} productos del catálogo` : 'Borró un producto del catálogo');
    if (!f.byAdmin) add(20, 'Lo borró alguien que no es el dueño');
    if ((Number(f.stock) || 0) > 0) add(10, 'Tenía stock');
    return finish(score, reasons, false);
  }

  if (f.totalShown) add(50, 'Lo quitó después de abrir el cobro (ya le estaba cobrando al cliente)');

  const ticketEmptied = f.action === 'CART_CLEARED' || (f.action === 'ITEM_REMOVED' && Number(f.totalAfter) <= 0);
  if (f.action === 'HELD_CART_DELETED') add(30, 'Borró un ticket en espera sin cobrarlo');

  if (amount >= big * 3) add(30, `Monto muy grande (${money(amount)})`);
  else if (amount >= big) add(20, `Monto grande (${money(amount)})`);

  const waits = (f.items || []).filter((i) => i.secondsInCart != null).map((i) => Number(i.secondsInCart)).filter((s) => Number.isFinite(s) && s >= 0);
  const longest = waits.length ? Math.max(...waits) : null;
  if (longest !== null && longest > SLOW_REMOVAL_S) add(15, `Lo quitó ${fmtWait(longest)} después de escanearlo`);
  else if (longest !== null && longest <= QUICK_REMOVAL_S && !f.totalShown && f.action !== 'CART_CLEARED') {
    add(-10, 'Lo quitó al instante (parece un error al escanear)');
  }

  if (follow) {
    // Un ticket en espera ya no estaba en pantalla: que no siga una venta no dice nada
    if (ticketEmptied && !follow.saleAfter) add(35, 'No hubo ninguna venta en esa caja en los 3 minutos siguientes');
    if (follow.sameProductResold) add(-40, 'Lo volvió a cobrar enseguida (era una corrección)');
  }

  return finish(score, reasons, !follow && (ticketEmptied || f.totalShown === true));
}

function finish(score: number, reasons: string[], pending: boolean): VoidScore {
  const s = Math.max(0, score);
  return { score: s, level: s >= LEVEL_SUSPICIOUS ? 'sospechoso' : s >= LEVEL_REVIEW ? 'revisar' : 'normal', reasons, pending };
}

export interface CashierRate { userId: string; sales: number; voids: number }

/**
 * Cajeros que quitan el doble (o más) que el promedio del comercio cada 100 ventas.
 * Con pocas ventas no se marca a nadie: hacen falta al menos 20 ventas y 5 quitas.
 */
export function flagCashiers(rows: CashierRate[]): Set<string> {
  const totalSales = rows.reduce((s, r) => s + r.sales, 0);
  const totalVoids = rows.reduce((s, r) => s + r.voids, 0);
  const out = new Set<string>();
  if (totalSales < 20 || rows.length < 2) return out;
  for (const r of rows) {
    if (r.voids < 5 || r.sales < 1) continue;
    const othersSales = totalSales - r.sales, othersVoids = totalVoids - r.voids;
    // Se compara contra el resto (si se incluye a sí mismo, un solo cajero malo sube el promedio)
    const avg = othersSales > 0 ? othersVoids / othersSales : 0;
    const rate = r.voids / r.sales;
    if (rate >= 2 * avg && rate > 0) out.add(r.userId);
  }
  return out;
}
