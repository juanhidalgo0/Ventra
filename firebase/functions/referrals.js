// "Invitá un comercio": cada cuenta tiene un código propio (ventra.store/empezar?ref=CODIGO).
//
// - Quien llega con el link y no usó nunca la prueba gratis prueba Ventra REFERRAL_TRIAL_DAYS días
//   (en vez de los 7 de siempre). Eso lo decide createVentraSubscription.
// - Cuando el invitado paga su primer mes, quien lo invitó suma un mes gratis (referralCredits).
//   No hay forma limpia de saltear un cobro de una suscripción de Mercado Pago, así que el mes gratis
//   se aplica en el próximo cobro aprobado: Mercado Pago cobra y Ventra devuelve ese cobro en el acto.
// - Tope: MAX_CREDITS_PER_YEAR meses ganados por año calendario.
//
// Datos: ventra_referral_codes/{CODIGO} = { uid }, y en la cuenta: referralCode, referredBy,
// referredCode, referralRewardedAt (del invitado), referralCredits / referralEarned (de quien invita).
// Cada invitado queda en ventra_accounts/{quien invita}/referrals/{uid del invitado}.

const admin = require("firebase-admin");

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sin 0/O ni 1/I/L
const CODE_LENGTH = 6;
const MAX_CREDITS_PER_YEAR = 12;
const LINK_BASE = "https://ventra.store/empezar?ref=";

/** Código limpio o null. Puro. */
function normalizeCode(raw) {
  const c = String(raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length >= 4 && c.length <= 12 ? c : null;
}

function randomCode(rand = Math.random) {
  let s = "";
  for (let i = 0; i < CODE_LENGTH; i++) s += CODE_ALPHABET[Math.floor(rand() * CODE_ALPHABET.length)];
  return s;
}

/** Puro: ¿esta cuenta puede quedar como invitada por `referrer`? */
function canBeReferred({ invitedUid, invitedAcc, invitedEmails, referrerUid, referrerAcc }) {
  if (!referrerUid || referrerUid === invitedUid) return false;
  const a = invitedAcc || {};
  // Solo cuentas nuevas: nunca pagaron, nunca probaron y no vinieron ya invitadas
  if (a.paidUntil || a.trialStartedAt || a.trialUsed || a.referredBy) return false;
  if (!referrerAcc) return false;
  const mine = new Set([referrerAcc.email, referrerAcc.mpEmail].filter(Boolean).map((e) => String(e).trim().toLowerCase()));
  return !(invitedEmails || []).some((e) => e && mine.has(String(e).trim().toLowerCase()));
}

/** Puro: cuántos meses ganó este año (el contador se reinicia con el año). */
function creditsThisYear(acc, now = new Date()) {
  const y = (acc && acc.referralYear) || {};
  return y.year === now.getUTCFullYear() ? Number(y.count || 0) : 0;
}

/** Código de la cuenta: lo crea la primera vez. */
async function ensureCode(db, uid) {
  const accRef = db.collection("ventra_accounts").doc(uid);
  const acc = (await accRef.get()).data() || {};
  if (acc.referralCode) return acc.referralCode;
  for (let i = 0; i < 8; i++) {
    const code = randomCode();
    const codeRef = db.collection("ventra_referral_codes").doc(code);
    const ok = await db.runTransaction(async (tx) => {
      const [c, a] = await Promise.all([tx.get(codeRef), tx.get(accRef)]);
      if (a.exists && a.data().referralCode) return a.data().referralCode;
      if (c.exists) return null;
      tx.set(codeRef, { uid, createdAt: admin.firestore.FieldValue.serverTimestamp() });
      tx.set(accRef, { referralCode: code }, { merge: true });
      return code;
    });
    if (ok) return ok;
  }
  throw new Error("No se pudo crear el código de invitación");
}

/** Lo que ve el comercio en "Invitá un comercio". */
async function stats(db, uid) {
  const code = await ensureCode(db, uid);
  const accRef = db.collection("ventra_accounts").doc(uid);
  const [acc, list] = await Promise.all([accRef.get(), accRef.collection("referrals").limit(500).get()]);
  const a = acc.data() || {};
  const invites = list.docs.map((d) => d.data());
  return {
    code,
    link: `${LINK_BASE}${code}`,
    invited: invites.length,
    paying: invites.filter((x) => x.status === "paid").length,
    credits: Number(a.referralCredits || 0),
    earned: Number(a.referralEarned || 0),
    maxPerYear: MAX_CREDITS_PER_YEAR,
    leftThisYear: Math.max(0, MAX_CREDITS_PER_YEAR - creditsThisYear(a)),
  };
}

/**
 * Al suscribirse con ?ref=: devuelve los campos para la cuenta nueva ({ referredBy, referredCode })
 * o null si el código no existe, es propio o la cuenta no es nueva. Anota al invitado en la lista.
 */
async function attachReferral(db, { rawCode, invitedUid, invitedAcc, invitedEmails, rubro }) {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  const codeSnap = await db.collection("ventra_referral_codes").doc(code).get();
  if (!codeSnap.exists) return null;
  const referrerUid = codeSnap.data().uid;
  const referrerAcc = referrerUid ? (await db.collection("ventra_accounts").doc(referrerUid).get()).data() : null;
  if (!canBeReferred({ invitedUid, invitedAcc, invitedEmails, referrerUid, referrerAcc })) return null;
  await db.collection("ventra_accounts").doc(referrerUid).collection("referrals").doc(invitedUid).set({
    status: "signed", rubro: rubro || null, createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return { referredBy: referrerUid, referredCode: code };
}

/** ¿El código existe? Para que /empezar muestre "te invitó un comercio: 30 días gratis". */
async function codeExists(db, rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) return false;
  return (await db.collection("ventra_referral_codes").doc(code).get()).exists;
}

/**
 * Primer cobro aprobado de una cuenta invitada: quien la invitó gana un mes (una sola vez por invitado).
 * Devuelve el uid premiado o null.
 */
async function rewardReferrer(db, invitedUid) {
  const invitedRef = db.collection("ventra_accounts").doc(invitedUid);
  return db.runTransaction(async (tx) => {
    const inv = (await tx.get(invitedRef)).data() || {};
    if (!inv.referredBy || inv.referralRewardedAt) return null;
    const refRef = db.collection("ventra_accounts").doc(inv.referredBy);
    const listRef = refRef.collection("referrals").doc(invitedUid);
    const ref = (await tx.get(refRef)).data();
    tx.set(invitedRef, { referralRewardedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    tx.set(listRef, { status: "paid", paidAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    if (!ref) return null;
    const now = new Date();
    const used = creditsThisYear(ref, now);
    if (used >= MAX_CREDITS_PER_YEAR) return null;
    tx.set(refRef, {
      referralCredits: admin.firestore.FieldValue.increment(1),
      referralEarned: admin.firestore.FieldValue.increment(1),
      referralYear: { year: now.getUTCFullYear(), count: used + 1 },
    }, { merge: true });
    return inv.referredBy;
  });
}

/**
 * Un cobro aprobado de una cuenta con meses ganados: se devuelve ese cobro y se descuenta un mes.
 * Idempotente por cobro (el aviso de Mercado Pago puede llegar varias veces). Si la devolución falla,
 * el mes vuelve a quedar disponible para el próximo cobro.
 */
async function useCredit(db, { uid, authorizedPaymentId, mpPaymentId, amount, accessToken, fetchFn = fetch, logger = console }) {
  if (!mpPaymentId) return null;
  const accRef = db.collection("ventra_accounts").doc(uid);
  const payRef = accRef.collection("payments").doc(String(authorizedPaymentId));
  const take = await db.runTransaction(async (tx) => {
    const [acc, pay] = await Promise.all([tx.get(accRef), tx.get(payRef)]);
    if (!acc.exists || Number(acc.data().referralCredits || 0) <= 0) return false;
    if (pay.exists && pay.data().referralRefund) return false;
    tx.set(accRef, { referralCredits: admin.firestore.FieldValue.increment(-1) }, { merge: true });
    tx.set(payRef, { referralRefund: { status: "pending", at: admin.firestore.FieldValue.serverTimestamp() } }, { merge: true });
    return true;
  });
  if (!take) return null;
  try {
    const r = await fetchFn(`https://api.mercadopago.com/v1/payments/${mpPaymentId}/refunds`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", "X-Idempotency-Key": `ventra-referral-${authorizedPaymentId}` },
      body: JSON.stringify({}),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`MP refund ${r.status}: ${body.message || ""}`);
    await payRef.set({ referralRefund: { status: "done", refundId: body.id || null, amount: amount || null, at: admin.firestore.FieldValue.serverTimestamp() } }, { merge: true });
    logger.info(`Ventra: mes gratis por invitar aplicado a ${uid} (cobro ${authorizedPaymentId} devuelto)`);
    return "done";
  } catch (err) {
    logger.error(`Ventra: no se pudo devolver el cobro ${authorizedPaymentId} de ${uid} por invitar`, err.message);
    await db.runTransaction(async (tx) => {
      tx.set(accRef, { referralCredits: admin.firestore.FieldValue.increment(1) }, { merge: true });
      tx.set(payRef, { referralRefund: { status: "failed", error: String(err.message).slice(0, 200), at: admin.firestore.FieldValue.serverTimestamp() } }, { merge: true });
    });
    return "failed";
  }
}

module.exports = {
  MAX_CREDITS_PER_YEAR, LINK_BASE, normalizeCode, randomCode, canBeReferred, creditsThisYear,
  ensureCode, stats, attachReferral, codeExists, rewardReferrer, useCredit,
};
