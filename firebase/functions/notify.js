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
  invoiceFail: true,   // factura rechazada por ARCA, o la cola trabada por la configuración
  lowStock: true,      // productos que llegaron al stock mínimo (agrupados)
  expiry: true,        // productos vencidos o por vencer (una vez por día)
  mpUnmatched: true,   // entró un pago a Mercado Pago y no hay venta de MP de ese monto
  saleCancel: false,   // venta anulada (solo importes grandes)
  employeeConsumption: true, // un empleado registró un consumo propio
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

/** Avisos que cayeron en el horario de silencio: esperan acá y salen cuando termina (flushDeferred) */
const DEFERRED = "pushDeferred";
const ms = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : Number(t) || 0);

/**
 * Manda un aviso a los celulares de la cuenta.
 * Devuelve { sent, reason } — reason: 'off' (apagado), 'deferred' (horario de silencio: se guarda
 * y sale al terminar), 'no-devices'. Antes se devolvía 'quiet' y el aviso se perdía (salvo los de
 * la PC, que lo reintentaba si seguía prendida).
 */
async function sendToAccount(db, uid, type, msg, opts = {}) {
  const prefs = await getPrefs(db, uid);
  if (prefs[type] === false) return { sent: 0, reason: "off" };
  const tokens = await tokenDocs(db, uid, opts.storeId);
  if (!tokens.length) return { sent: 0, reason: "no-devices" };
  if (!URGENT.has(type) && !opts.ignoreQuiet && inQuiet(prefs)) {
    await db.collection("ventra_push").doc(uid).collection(DEFERRED).add({
      type, storeId: opts.storeId || null, at: admin.firestore.Timestamp.now(),
      msg: { title: String(msg.title || ""), body: String(msg.body || ""), url: msg.url || "", tag: msg.tag || type },
    });
    return { sent: 0, reason: "deferred" };
  }

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

/**
 * Manda los avisos que esperaban el fin del horario de silencio (corre cada hora).
 * Por etiqueta queda el último (un solo "stock bajo", por ejemplo) y al título se le suma la hora
 * en que pasó. Si el dueño apagó ese tipo de aviso mientras tanto, no sale.
 */
async function flushDeferred(db) {
  const snap = await db.collectionGroup(DEFERRED).get();
  if (snap.empty) return 0;
  const byUid = new Map();
  for (const d of snap.docs) {
    const uid = d.ref.parent.parent.id;
    if (!byUid.has(uid)) byUid.set(uid, []);
    byUid.get(uid).push(d);
  }
  let sent = 0;
  for (const [uid, docs] of byUid) {
    try {
      const prefs = await getPrefs(db, uid);
      if (inQuiet(prefs)) continue;
      const fresh = docs.filter((d) => Date.now() - ms(d.data().at) < 36 * 3600000)
        .sort((a, b) => ms(a.data().at) - ms(b.data().at));
      // Misma etiqueta (p. ej. dos tandas de stock bajo): un solo aviso con todo, porque en el
      // celular uno taparía al otro
      const byTag = new Map();
      for (const d of fresh) { const x = d.data(); const k = x.msg.tag || x.type; if (!byTag.has(k)) byTag.set(k, []); byTag.get(k).push(x); }
      for (const group of [...byTag.values()].slice(-8)) {
        const x = group[group.length - 1];
        const when = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms(x.at)));
        const msg = group.length === 1
          ? { ...x.msg, title: `${x.msg.title} (${when})` }
          : { ...x.msg, title: `${x.msg.title} y ${group.length - 1} aviso${group.length > 2 ? "s" : ""} más`, body: group.map((g) => g.msg.title).reverse().join(" · ").slice(0, 300) };
        const r = await sendToAccount(db, uid, x.type, msg, { storeId: x.storeId || undefined, ignoreQuiet: true });
        sent += r.sent || 0;
      }
      await Promise.all(docs.map((d) => d.ref.delete()));
    } catch (err) {
      logger.warn(`Ventra avisos en espera: error (${uid})`, err.message);
    }
  }
  return sent;
}

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
    case "employeeConsumption": {
      const items = (Array.isArray(d.items) ? d.items : []).slice(0, 6).map((x) => String(x).slice(0, 60));
      const count = Number(d.count) || items.length;
      return {
        title: `Consumo de ${String(d.user || "un empleado").slice(0, 40)}: ${money(d.total)}`,
        body: items.slice(0, 4).join(", ") + (count > 4 ? ` y ${count - 4} más` : ""),
        url: "/#/employee-consumption", tag: "consumo-" + (d.saleId || Date.now()),
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
        title: "Una factura no se pudo emitir",
        body: `Ticket #${d.saleNumber || "—"} (${money(d.total)}): ${String(d.error || "sin detalle").slice(0, 140)}`,
        url: "/#/fiscal", tag: "invoice-" + (d.saleId || Date.now()),
      };
    case "mpUnmatched": {
      const hora = d.at ? new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(d.at)) : "";
      const canal = { point: "en la maquinita", qr: "con QR", transfer: "por transferencia" }[d.channel] || "";
      const metodo = d.method === "CASH" ? "efectivo" : d.method;
      return {
        title: `Entró ${money(d.amount)} a Mercado Pago sin venta de MP`,
        body: d.saleNumber
          ? `Pago ${canal} a las ${hora}: la venta #${d.saleNumber} de ese monto se cargó como ${metodo}.`
          : `Pago ${canal} a las ${hora}: no hay ninguna venta de ese monto cerca de esa hora.`,
        url: "/#/cash-control", tag: "mp-" + (d.paymentId || Date.now()),
      };
    }
    case "expiry": {
      const expired = Number(d.expired) || 0, soon = Number(d.soon) || 0;
      if (!expired && !soon) return null;
      const parts = [];
      if (expired) parts.push(`${expired} vencido${expired > 1 ? "s" : ""}`);
      if (soon) parts.push(`${soon} por vencer`);
      const items = Array.isArray(d.items) ? d.items : [];
      const when = (n) => (n < 0 ? `venció hace ${-n} d` : n === 0 ? "vence hoy" : `vence en ${n} d`);
      return {
        title: `Vencimientos: ${parts.join(" y ")}`,
        body: items.slice(0, 4).map((i) => `${i.name} (${when(Number(i.daysLeft))})`).join(", ") + (items.length > 4 ? ` y ${items.length - 4} más` : ""),
        url: "/#/products?ver=vencimientos", tag: "expiry",
      };
    }
    default:
      return null;
  }
}

module.exports = { DEFAULT_PREFS, sendToAccount, flushDeferred, messageFor, getPrefs, inQuiet, localHour, money, TZ };
