/**
 * Cruce de los pagos que Mercado Pago realmente recibió con las ventas cargadas como
 * Mercado Pago en una caja. Es una función pura (sin base ni red) para poder probarla.
 *
 * Cada pago real se empareja con un pago de venta del mismo monto y hora cercana (el más
 * cercano primero). Lo que queda suelto es lo que hay que mirar:
 *   - pago de MP sin venta  → casi siempre una venta cargada como efectivo/Clover (se
 *     sugieren las del mismo monto) o una venta anulada sin devolver el pago;
 *   - venta MP sin pago     → se cargó como MP pero se cobró de otra forma (o no se cobró).
 * Las ventas de OTRAS cajas del mismo horario también participan, para que sus pagos no
 * aparezcan como "sin venta" en esta caja; pero solo se informan las de esta.
 */

export interface MpPaymentLite {
  id: string;
  at: string | null;
  amount: number;
  channel: string;
  method: string | null;
  type: string | null;
  last4: string | null;
  installments: number | null;
}

export interface SaleLite {
  saleId: string;
  saleNumber: number;
  at: Date;
  payments: { id: string; method: string; amount: number; reference: string | null }[];
}

export interface Suggestion { saleId: string; saleNumber: number; paymentRowId: string; method: string; amount: number; at: string; minutes: number }

export interface ReconcileResult {
  real: { count: number; total: number };
  /** Lo cobrado por MP que corresponde a esta caja (emparejado + sin venta) */
  realForSession: number;
  registered: { count: number; total: number };
  matchedCount: number;
  otherTills: { count: number; total: number };
  unmatchedPayments: { payment: MpPaymentLite; suggestions: Suggestion[] }[];
  unmatchedSales: { saleId: string; saleNumber: number; paymentRowId: string; amount: number; at: string; reference: string | null; unconfirmed: boolean }[];
}

/** Hasta cuántos minutos de distancia se considera que un pago y una venta son el mismo */
export const MATCH_WINDOW_MIN = 30;
const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.01;
const round2 = (n: number) => Math.round(n * 100) / 100;

interface Entry { saleId: string; saleNumber: number; paymentRowId: string; amount: number; at: Date; reference: string | null; own: boolean }

export function reconcile(
  payments: MpPaymentLite[],
  sessionSales: SaleLite[],
  otherSales: SaleLite[],
  isMp: (method: string) => boolean,
): ReconcileResult {
  const entries: Entry[] = [];
  const pushEntries = (sales: SaleLite[], own: boolean) => {
    for (const s of sales) for (const p of s.payments) {
      if (isMp(p.method)) entries.push({ saleId: s.saleId, saleNumber: s.saleNumber, paymentRowId: p.id, amount: p.amount, at: s.at, reference: p.reference, own });
    }
  };
  pushEntries(sessionSales, true);
  pushEntries(otherSales, false);

  const payAt = (p: MpPaymentLite) => (p.at ? new Date(p.at).getTime() : NaN);
  const assigned = new Map<string, Entry>(); // payment id → entrada de venta
  const used = new Set<Entry>();

  // 1. Enlace exacto: ventas corregidas en un cierre guardan el número de pago
  for (const p of payments) {
    const e = entries.find((x) => !used.has(x) && x.reference && new RegExp(`\\b${p.id}\\b`).test(x.reference));
    if (e) { assigned.set(p.id, e); used.add(e); }
  }

  // 2. Mismo monto y hora más cercana primero
  const pairs: { p: MpPaymentLite; e: Entry; d: number }[] = [];
  for (const p of payments) {
    if (assigned.has(p.id)) continue;
    const t = payAt(p);
    for (const e of entries) {
      if (used.has(e) || !sameAmount(p.amount, e.amount)) continue;
      const d = Number.isNaN(t) ? MATCH_WINDOW_MIN * 60000 : Math.abs(e.at.getTime() - t);
      if (d <= MATCH_WINDOW_MIN * 60000) pairs.push({ p, e, d });
    }
  }
  pairs.sort((a, b) => a.d - b.d);
  for (const { p, e } of pairs) {
    if (assigned.has(p.id) || used.has(e)) continue;
    assigned.set(p.id, e);
    used.add(e);
  }

  // 3. Lo que quedó suelto
  const nonMpRows = sessionSales.flatMap((s) => s.payments
    .filter((p) => !isMp(p.method) && p.method !== 'DEBT')
    .map((p) => ({ saleId: s.saleId, saleNumber: s.saleNumber, paymentRowId: p.id, method: p.method, amount: p.amount, at: s.at })));

  const unmatchedPayments = payments.filter((p) => !assigned.has(p.id)).map((p) => {
    const t = payAt(p);
    const suggestions = nonMpRows
      .filter((r) => sameAmount(r.amount, p.amount))
      .map((r) => ({ ...r, d: Number.isNaN(t) ? Infinity : Math.abs(r.at.getTime() - t) }))
      .filter((r) => r.d <= MATCH_WINDOW_MIN * 60000)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .map(({ d, at, ...r }) => ({ ...r, at: at.toISOString(), minutes: Math.round(d / 60000) }));
    return { payment: p, suggestions };
  });

  const unmatchedSales = entries.filter((e) => e.own && !used.has(e)).map((e) => ({
    saleId: e.saleId,
    saleNumber: e.saleNumber,
    paymentRowId: e.paymentRowId,
    amount: e.amount,
    at: e.at.toISOString(),
    reference: e.reference,
    unconfirmed: /SIN CONFIRMAR/i.test(e.reference || ''),
  }));

  const own = [...assigned.entries()].filter(([, e]) => e.own);
  const other = [...assigned.entries()].filter(([, e]) => !e.own);
  const byId = new Map(payments.map((p) => [p.id, p]));
  const sumPays = (list: [string, Entry][]) => round2(list.reduce((t, [id]) => t + (byId.get(id)?.amount || 0), 0));
  const unmatchedTotal = round2(unmatchedPayments.reduce((t, u) => t + u.payment.amount, 0));
  const ownEntries = entries.filter((e) => e.own);

  return {
    real: { count: payments.length, total: round2(payments.reduce((t, p) => t + p.amount, 0)) },
    realForSession: round2(sumPays(own) + unmatchedTotal),
    registered: { count: ownEntries.length, total: round2(ownEntries.reduce((t, e) => t + e.amount, 0)) },
    matchedCount: own.length,
    otherTills: { count: other.length, total: sumPays(other) },
    unmatchedPayments,
    unmatchedSales,
  };
}
