// Reglas de vencimiento de las suscripciones de Ventra.
//
// - La cuenta está paga hasta `paidUntil`.
// - Después hay GRACE_DAYS días de gracia en los que la app funciona normal.
// - Pasada la gracia, la app queda en solo lectura.
// - Al renovar dentro de la gracia, el mes nuevo se cuenta desde el vencimiento
//   original: los días de gracia usados se descuentan solos.
// - Al renovar ya en solo lectura, el mes arranca desde el pago (no se cobran
//   los días bloqueados).

const GRACE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Suma meses de calendario; si el día no existe (31 -> febrero) usa el último del mes. */
function addMonths(date, months) {
  const d = new Date(date.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

/** Nueva fecha de vencimiento al acreditarse un pago de `months` meses. */
function nextPaidUntil(currentPaidUntil, paymentDate, months = 1) {
  const paidAt = new Date(paymentDate);
  if (!currentPaidUntil) return addMonths(paidAt, months);
  const current = new Date(currentPaidUntil);
  const graceEnd = new Date(current.getTime() + GRACE_DAYS * DAY_MS);
  // Todavía vigente o en gracia: se extiende desde el vencimiento original
  if (paidAt.getTime() <= graceEnd.getTime()) return addMonths(current, months);
  // Ya estaba en solo lectura: arranca desde el pago
  return addMonths(paidAt, months);
}

module.exports = { GRACE_DAYS, DAY_MS, addMonths, nextPaidUntil };
