// ═══════════════════════════════════════════════════
// Cupo de recordatorios automáticos por WhatsApp (cada uno le cuesta a Ventra un mensaje de
// "utilidad" de Meta: ~USD 0,026 en Argentina).
//
// - Cada plan trae un cupo por mes calendario (hora de Argentina) que no se acumula.
// - Los paquetes que compra el comercio (Mercado Pago, se acreditan solos con packHook) se
//   suman a `extra` y no vencen: se usan cuando se termina el cupo del mes.
// - Sin cupo no se manda nada automático: la agenda sigue con el recordatorio de un toque.
//
// ventra_wa_quota/{uid} = { month, used, extra, warnedMonth, emptyMonth }  (uid = cuenta)
// Lo escriben solo las funciones; el dueño lo lee para ver cuánto le queda.
// ═══════════════════════════════════════════════════
const admin = require("firebase-admin");
const usage = require("./usage");

/** Recordatorios automáticos incluidos por mes en cada plan. Los que no están, no traen. */
const PLAN_REMINDERS = { agenda_pro: 200, full: 200, prueba: 200 };
/** Paquete extra: se compra solo desde la app o Mi cuenta y se acredita solo */
const PACK = { qty: 100, price: 7500 };
/** Aviso de "te quedan pocos" cuando queda este porcentaje del cupo del plan */
const WARN_SHARE = 0.2;

const ref = (db, uid) => db.collection("ventra_wa_quota").doc(String(uid));
const includedFor = (plan) => PLAN_REMINDERS[plan] || 0;

/** Estado del mes, con el mes nuevo ya reiniciado. Pura. */
function current(data, plan, month = usage.monthKey()) {
  const d = data || {};
  const used = d.month === month ? Number(d.used) || 0 : 0;
  const included = includedFor(plan);
  const extra = Math.max(0, Number(d.extra) || 0);
  return { month, used, included, extra, left: Math.max(0, included - used) + extra };
}

/** Lo que le queda a la cuenta este mes (sin reservar nada). */
async function status(db, uid, plan) {
  const snap = await ref(db, uid).get();
  return current(snap.exists ? snap.data() : null, plan);
}

/**
 * Reserva un recordatorio: primero del cupo del mes, después de los paquetes.
 * Devuelve { ok, source: 'plan'|'pack', month, left, warn, empty } o { ok: false }.
 * `warn` / `empty` salen una sola vez por mes, para avisarle al dueño.
 */
async function claim(db, uid, plan) {
  const r = ref(db, uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(r);
    const data = snap.exists ? snap.data() : {};
    const q = current(data, plan);
    let source = null;
    if (q.used < q.included) source = "plan";
    else if (q.extra > 0) source = "pack";
    if (!source) {
      const empty = data.emptyMonth !== q.month;
      if (empty) tx.set(r, { month: q.month, used: q.used, emptyMonth: q.month }, { merge: true });
      return { ok: false, month: q.month, left: 0, empty };
    }
    const used = source === "plan" ? q.used + 1 : q.used;
    const extra = source === "pack" ? q.extra - 1 : q.extra;
    const left = Math.max(0, q.included - used) + extra;
    const warnAt = Math.floor(q.included * WARN_SHARE);
    const warn = left > 0 && left <= warnAt && data.warnedMonth !== q.month;
    const empty = left === 0 && data.emptyMonth !== q.month;
    tx.set(r, {
      month: q.month, used, extra,
      ...(warn ? { warnedMonth: q.month } : {}),
      ...(empty ? { emptyMonth: q.month } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true, source, month: q.month, left, warn, empty };
  });
}

/** Devuelve un recordatorio que no se llegó a entregar (Meta no lo cobra). */
async function refund(db, uid, source, month) {
  const r = ref(db, uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(r);
    const d = snap.exists ? snap.data() : {};
    if (source === "pack") tx.set(r, { extra: (Number(d.extra) || 0) + 1 }, { merge: true });
    else if (source === "plan" && d.month === month && (Number(d.used) || 0) > 0) tx.set(r, { used: d.used - 1 }, { merge: true });
  });
}

/** Acredita un paquete pagado. Idempotente por pago: devuelve false si ya estaba acreditado. */
async function creditPack(db, uid, paymentId, qty, amount) {
  const payRef = db.collection("ventra_wa_packs").doc(String(paymentId));
  return db.runTransaction(async (tx) => {
    const [paid, cur] = await Promise.all([tx.get(payRef), tx.get(ref(db, uid))]);
    if (paid.exists) return false;
    const d = cur.exists ? cur.data() : {};
    tx.set(payRef, { uid, qty, amount, at: admin.firestore.FieldValue.serverTimestamp() });
    // Comprar un paquete vuelve a habilitar el aviso de "se terminaron" para cuando se acabe
    tx.set(ref(db, uid), { extra: (Number(d.extra) || 0) + qty, emptyMonth: null, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return true;
  });
}

module.exports = { PLAN_REMINDERS, PACK, includedFor, current, status, claim, refund, creditPack };
