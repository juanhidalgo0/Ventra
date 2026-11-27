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

// ─── Prueba gratis ───
// Las cuentas nuevas usan Ventra TRIAL_DAYS días sin pagar. La suscripción de Mercado Pago se crea
// con la tarjeta cargada y el primer cobro en TRIAL_DAYS días (start_date): ese día empieza el primer
// mes pago, así los días de prueba no se descuentan del plan. Mientras dura, `paidUntil` es el fin
// de la prueba; el primer cobro lo extiende un mes desde ahí (nextPaidUntil).
// Una sola prueba por cuenta de Google y por correo de Mercado Pago (colección ventra_trials).
const TRIAL_DAYS = 7;

/** ¿Le corresponde la prueba a esta cuenta? `usedEmails`: si alguno de sus correos ya la usó. Pura. */
function trialEligible(account, usedEmails) {
  const a = account || {};
  if (a.paidUntil || a.trialStartedAt || a.trialUsed) return false;
  return !usedEmails;
}

/** Quien llega invitado por otro comercio (referrals.js) prueba un mes entero */
const REFERRAL_TRIAL_DAYS = 30;

/** Fechas que se le mandan a Mercado Pago: primer cobro en `days` días. Pura. */
function trialDates(nowMs, days = TRIAL_DAYS) {
  const start = new Date(nowMs + days * DAY_MS);
  // start_date solo lo toma junto con end_date: se pone lejos (hay que renovar la suscripción en 10 años)
  return { start_date: start.toISOString(), end_date: addMonths(new Date(nowMs), 120).toISOString() };
}

/**
 * Fin de la prueba al autorizar la tarjeta: el primer cobro que informa Mercado Pago, acotado
 * entre 1 y `days` + 1 días desde ahora (si no lo informa o es raro, `days` días). Pura.
 */
function trialEnd(sub, nowMs, days = TRIAL_DAYS) {
  const s = sub || {};
  const ar = s.auto_recurring || {};
  const t = Date.parse(s.next_payment_date || ar.start_date || "");
  if (Number.isFinite(t) && t >= nowMs + DAY_MS && t <= nowMs + (days + 1) * DAY_MS) return new Date(t);
  return new Date(nowMs + days * DAY_MS);
}

/** Clave de ventra_trials para un correo (sin guardar el correo a la vista). */
const trialKey = (email) => require("crypto").createHash("sha256").update(String(email || "").trim().toLowerCase()).digest("hex").slice(0, 40);

module.exports = { GRACE_DAYS, DAY_MS, TRIAL_DAYS, REFERRAL_TRIAL_DAYS, addMonths, nextPaidUntil, trialEligible, trialDates, trialEnd, trialKey };
