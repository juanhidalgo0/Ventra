// ═══════════════════════════════════════════════════
// Cupones de descuento de la tienda online.
//
// Los cupones viven en ventra_stores/{id}/coupons/{CÓDIGO}, solo para el dueño: nunca en la
// configuración pública, así nadie puede leer la lista de códigos.
// - check (público): el cliente escribe un código en la tienda y se valida acá (con freno a quien
//   prueba códigos al azar). Devuelve cómo se calcula el descuento.
// - redeem (al crearse el pedido): se vuelve a validar, se cuenta el uso y, si el descuento del
//   pedido no corresponde (alguien lo tocó desde el navegador), el pedido queda marcado para
//   que el comercio lo vea antes de cobrar.
// El cálculo (discountFor) es el mismo que couponDiscount() en firebase/tienda/index.html: mantener iguales.
// ═══════════════════════════════════════════════════
const admin = require("firebase-admin");

const TZ_OFFSET_MIN = -180;
const CHECKS_PER_WINDOW = 15;
const CHECK_WINDOW_MS = 10 * 60 * 1000;
const checks = new Map();

const normCode = (c) => String(c || "").toUpperCase().replace(/\s+/g, "").slice(0, 24);
const validCode = (c) => /^[A-Z0-9_-]{3,20}$/.test(c);
const phoneKey = (p) => String(p || "").replace(/\D/g, "").slice(-10);
const todayKey = (ms = Date.now()) => new Date(ms + TZ_OFFSET_MIN * 60000).toISOString().slice(0, 10);
const round = (n) => Math.round(Number(n) || 0);

/**
 * Descuento de un cupón. itemsTotal = productos menos promos; deliveryCost = costo del envío
 * (solo cuenta si el pedido es con envío). Devuelve { discount } o { error }.
 */
function discountFor(c, itemsTotal, deliveryCost, delivery) {
  const items = Math.max(0, Number(itemsTotal) || 0);
  if (c.minOrder > 0 && items < c.minOrder) return { error: `Este cupón es para compras desde $${round(c.minOrder).toLocaleString("es-AR")}` };
  if (c.type === "shipping") {
    if (delivery !== "DELIVERY") return { error: "Este cupón es de envío gratis: elegí envío a domicilio" };
    return { discount: round(Math.max(0, Number(deliveryCost) || 0)) };
  }
  let d = c.type === "percent" ? (items * Math.min(100, Math.max(0, Number(c.value) || 0))) / 100 : Number(c.value) || 0;
  if (c.type === "percent" && c.maxDiscount > 0) d = Math.min(d, c.maxDiscount);
  return { discount: round(Math.min(items, Math.max(0, d))) };
}

/** Problemas del cupón en sí (no del pedido): apagado, fechas, usos agotados. */
function couponProblem(c, nowMs = Date.now()) {
  if (!c || c.active === false) return "Cupón inválido o vencido";
  const today = todayKey(nowMs);
  if (c.validFrom && today < c.validFrom) return "Este cupón todavía no está vigente";
  if (c.validUntil && today > c.validUntil) return "Cupón inválido o vencido";
  if (c.maxUses > 0 && (Number(c.uses) || 0) >= c.maxUses) return "Este cupón ya se usó todas las veces";
  return null;
}

/** Lo que la tienda necesita para calcular el descuento (sin datos internos como los usos). */
const publicView = (c) => ({
  code: c.code, type: c.type, value: Number(c.value) || 0, minOrder: Number(c.minOrder) || 0,
  maxDiscount: Number(c.maxDiscount) || 0, label: c.label || "",
});

/** POST { storeId, code, itemsTotal, deliveryCost, delivery, phone } desde la tienda. */
async function check(db, req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  const b = req.body || {};
  const storeId = String(b.storeId || "").slice(0, 80);
  const code = normCode(b.code);
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(storeId) || !validCode(code)) return res.status(400).json({ error: "Cupón inválido o vencido" });

  // Freno por IP y tienda: probar códigos al azar se corta enseguida
  const ip = String(req.get("x-forwarded-for") || req.ip || "").split(",")[0].trim();
  const key = `${ip}|${storeId}`, now = Date.now();
  const cur = checks.get(key);
  const hits = cur && now - cur.at < CHECK_WINDOW_MS ? cur.n + 1 : 1;
  checks.set(key, { at: cur && now - cur.at < CHECK_WINDOW_MS ? cur.at : now, n: hits });
  if (checks.size > 20000) for (const [k, v] of checks) if (now - v.at > CHECK_WINDOW_MS) checks.delete(k);
  if (hits > CHECKS_PER_WINDOW) return res.status(429).json({ error: "Probaste muchos cupones. Esperá unos minutos." });

  const ref = db.collection("ventra_stores").doc(storeId).collection("coupons").doc(code);
  const snap = await ref.get();
  const c = snap.exists ? { code, ...snap.data() } : null;
  const problem = couponProblem(c, now);
  if (problem) return res.status(404).json({ error: problem });
  if (c.oncePerCustomer && phoneKey(b.phone).length >= 6) {
    const used = await ref.collection("redemptions").doc(phoneKey(b.phone)).get();
    if (used.exists) return res.status(409).json({ error: "Ya usaste este cupón" });
  }
  const r = discountFor(c, b.itemsTotal, b.deliveryCost, b.delivery);
  // Compra mínima o envío: se devuelve igual el cupón (la tienda lo guarda y avisa qué falta)
  return res.json({ ok: !r.error, coupon: publicView(c), discount: r.discount || 0, ...(r.error ? { hint: r.error } : {}) });
}

/**
 * Pedido nuevo con cupón: se valida de nuevo, se cuenta el uso y se anota el resultado en el
 * pedido (coupon.valid o couponProblem). Nunca tira error: el pedido llega igual.
 */
async function redeem(db, orderRef, storeId, order) {
  const sent = order && order.coupon;
  if (!sent || !sent.code) return null;
  const code = normCode(sent.code);
  const couponRef = db.collection("ventra_stores").doc(storeId).collection("coupons").doc(code);
  const items = (order.items || []).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0) - (Number(order.discount) || 0);
  const pk = phoneKey(order.customerPhone);
  const result = await db.runTransaction(async (tx) => {
    const snap = validCode(code) ? await tx.get(couponRef) : null;
    const c = snap && snap.exists ? { code, ...snap.data() } : null;
    let problem = couponProblem(c);
    let redemption = null;
    if (!problem && c.oncePerCustomer && pk.length >= 6) {
      redemption = couponRef.collection("redemptions").doc(pk);
      if ((await tx.get(redemption)).exists) problem = "Este cliente ya había usado el cupón";
    }
    if (!problem) {
      const r = discountFor(c, items, order.deliveryCost, order.delivery);
      if (r.error) problem = r.error;
      else if (Math.abs(r.discount - (Number(sent.discount) || 0)) > 1) problem = `El descuento no coincide con el cupón (corresponde $${r.discount.toLocaleString("es-AR")})`;
    }
    if (problem) {
      tx.update(orderRef, { couponProblem: problem });
      return { ok: false, problem };
    }
    tx.update(couponRef, { uses: admin.firestore.FieldValue.increment(1), lastUsedAt: admin.firestore.FieldValue.serverTimestamp() });
    if (redemption) tx.set(redemption, { orderId: orderRef.id, at: admin.firestore.FieldValue.serverTimestamp() });
    tx.update(orderRef, { "coupon.valid": true });
    return { ok: true };
  });
  return result;
}

module.exports = { check, redeem, discountFor, couponProblem, normCode, validCode };
