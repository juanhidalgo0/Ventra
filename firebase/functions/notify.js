/**
 * Notificaciones al celular del dueño.
 *
 * - Los celulares se registran en ventra_push/{uid}/tokens (uid = la cuenta).
 * - Las preferencias están en ventra_push/{uid} (qué avisos y horario de silencio).
 * - Los eventos llegan de tres lados: la tienda (pedido nuevo), la PC del comercio
 *   (stock mínimo, cierre con diferencia, anulación, factura rechazada) y tareas
 *   programadas (pedido sin atender, resumen del día).
 */
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const TZ = "America/Argentina/Buenos_Aires";

/** Qué avisos vienen activados si el dueño no tocó nada */
const DEFAULT_PREFS = {
  orders: true,        // pedido online nuevo
  orderIdle: true,     // pedido sin atender hace 15 min
  bookings: true,      // turno reservado desde la tienda
  cashDiff: true,      // caja cerrada con diferencia
  invoiceFail: true,   // factura rechazada por ARCA
  lowStock: true,      // productos que llegaron al stock mínimo (agrupados)
  saleCancel: false,   // venta anulada (solo importes grandes)
  dailySummary: false, // resumen del día
  summaryHour: 21,
  quietFrom: 23,       // horario de silencio (salvo pedidos)
  quietTo: 8,
};

/** Tipos que no respetan el horario de silencio: un pedido no puede esperar */
const URGENT = new Set(["orders", "orderIdle"]);

function localHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }).format(date));
}

function inQuiet(prefs, hour = localHour()) {
  const f = Number(prefs.quietFrom), t = Number(prefs.quietTo);
  if (!Number.isFinite(f) || !Number.isFinite(t) || f === t) return false;
  return f < t ? hour >= f && hour < t : hour >= f || hour < t;
}

async function getPrefs(db, uid) {
  const snap = await db.collection("ventra_push").doc(uid).get();
  return { ...DEFAULT_PREFS, ...((snap.exists && snap.data().prefs) || {}) };
}

/** Tokens de la cuenta (y los viejos guardados en la tienda, de la primera versión) */
async function tokenDocs(db, uid, storeId) {
  const out = [];
  const seen = new Set();
  const add = (snap) => snap.docs.forEach((d) => {
    const t = d.data().token;
    if (t && !seen.has(t)) { seen.add(t); out.push({ token: t, ref: d.ref }); }
  });
  add(await db.collection("ventra_push").doc(uid).collection("tokens").get());
  if (storeId) add(await db.collection("ventra_stores").doc(storeId).collection("pushTokens").get());
  return out;
}

/**
 * Manda un aviso a los celulares de la cuenta.
 * Devuelve { sent, reason } — reason: 'off' (apagado), 'quiet' (silencio), 'no-devices'.
 */
async function sendToAccount(db, uid, type, msg, opts = {}) {
  const prefs = await getPrefs(db, uid);
  if (prefs[type] === false) return { sent: 0, reason: "off" };
  if (!URGENT.has(type) && !opts.ignoreQuiet && inQuiet(prefs)) return { sent: 0, reason: "quiet" };
  const tokens = await tokenDocs(db, uid, opts.storeId);
  if (!tokens.length) return { sent: 0, reason: "no-devices" };

  const res = await admin.messaging().sendEachForMulticast({
    tokens: tokens.map((t) => t.token),
    data: { title: String(msg.title).slice(0, 120), body: String(msg.body || "").slice(0, 300), url: msg.url || "/#/inicio", tag: msg.tag || type },
    webpush: { headers: { Urgency: URGENT.has(type) ? "high" : "normal", TTL: "86400" } },
  });
  const dead = [];
  res.responses.forEach((r, i) => {
    const code = r.error && r.error.code;
    if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") dead.push(tokens[i].ref);
  });
  await Promise.all(dead.map((ref) => ref.delete()));
  logger.info(`Ventra aviso ${type} → ${uid}: ${res.successCount} enviados`);
  return { sent: res.successCount };
}

const money = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");

/** Arma el mensaje de un evento que manda la PC. null = evento desconocido o incompleto. */
function messageFor(ev) {
  const d = ev.data || {};
  switch (ev.type) {
    case "lowStock": {
      const items = (Array.isArray(d.items) ? d.items : []).slice(0, 20);
      if (!items.length) return null;
      const names = items.slice(0, 4).map((i) => `${i.name} (quedan ${Math.max(0, Math.round(Number(i.stock) * 100) / 100)})`);
      const more = items.length > 4 ? ` y ${items.length - 4} más` : "";
      return {
        title: items.length === 1 ? `Stock bajo: ${items[0].name}` : `${items.length} productos llegaron al stock mínimo`,
        body: items.length === 1 ? `Quedan ${Math.max(0, Math.round(Number(items[0].stock) * 100) / 100)} (mínimo ${items[0].minStock}). Es momento de reponer.` : names.join(", ") + more,
        url: "/#/stock-control", tag: "low-stock",
      };
    }
    case "cashDiff": {
      const diff = Number(d.difference) || 0;
      if (!diff) return null;
      return {
        title: `${d.terminal || "Una caja"} cerró con ${diff < 0 ? "faltante" : "sobrante"} de ${money(Math.abs(diff))}`,
        body: `${d.user || "Sin usuario"} · esperado ${money(d.expected)} · declarado ${money(d.counted)}`,
        url: "/#/cash-control", tag: "cash-" + (d.sessionId || Date.now()),
      };
    }
    case "saleCancel":
      return {
        title: `Se anuló una venta de ${money(d.total)}`,
        body: `Ticket #${d.saleNumber || "—"} · ${d.user || "Sin usuario"}`,
        url: "/#/historial", tag: "cancel-" + (d.saleId || Date.now()),
      };
    case "invoiceFail":
      return {
        title: "ARCA rechazó una factura",
        body: `Ticket #${d.saleNumber || "—"} (${money(d.total)}): ${String(d.error || "sin detalle").slice(0, 140)}`,
        url: "/#/fiscal", tag: "invoice-" + (d.saleId || Date.now()),
      };
    default:
      return null;
  }
}

module.exports = { DEFAULT_PREFS, sendToAccount, messageFor, getPrefs, inQuiet, localHour, money, TZ };
