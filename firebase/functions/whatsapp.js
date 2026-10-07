// ═══════════════════════════════════════════════════
// Recordatorios de turnos por WhatsApp (Cloud API de Meta), desde el número de Ventra.
//
// - remindersRun (cada 15 min): por cada comercio con agenda.reminders.enabled, manda la
//   plantilla aprobada a los turnos que toca recordar. Cada turno se "reclama" en una
//   transacción antes de mandar, así dos ejecuciones nunca mandan dos veces.
// - hook (webhook de Meta, firmado): estados de entrega, botones Confirmo / Necesito
//   cambiarlo y mensajes de texto (se contesta con el WhatsApp del comercio).
//
// Sin PHONE_ID o sin token no se manda nada: el resto de la agenda sigue igual.
// Cuando todo está listo, ventra_desktop/whatsapp = { reminders: true } y la app muestra la opción.
// ═══════════════════════════════════════════════════
const crypto = require("crypto");
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const agenda = require("./agenda");
const usage = require("./usage");
const quota = require("./reminder-quota");
const notify = require("./notify");
const { GRACE_DAYS, DAY_MS } = require("./subscription-rules");

const GRAPH = "https://graph.facebook.com/v21.0";
/**
 * Identificador del número de Ventra (WhatsApp → Configuración de la API). Vacío: no se manda nada.
 * App "Ventra" del portfolio "Ventra | Sistema de ventas"; cuenta de WhatsApp Business 1116867764202620.
 * Número real +54 9 221 204 8533 (cuenta de WhatsApp Business 1135959985533409).
 */
const PHONE_ID = process.env.VENTRA_WA_PHONE_ID || "1422338734288548";
const TEMPLATE = { name: "turno_recordatorio", lang: "es_AR" };
/** No se escribe de noche (hora de Argentina) */
const QUIET_FROM = 22 * 60, QUIET_TO = 8 * 60;
/** Un turno que empieza en menos de esto ya no se recuerda */
const MIN_LEAD_MS = 30 * 60 * 1000;
const MAX_TRIES = 3;
/** Respuesta automática a mensajes de texto: una cada tantas horas por cliente */
const AUTO_REPLY_EVERY_MS = 12 * 60 * 60 * 1000;
const STORE_URL = "https://tienda.ventra.store";

/** Cuándo recordar: el día anterior a cierta hora, o unas horas antes. */
const WHEN = {
  dayBefore18: { dayBefore: 18 },
  dayBefore20: { dayBefore: 20 },
  hours3: { hours: 3 },
  hours2: { hours: 2 },
  // Lo revisa la nube cada 15 minutos: sale entre 60 y 45 minutos antes del turno
  hours1: { hours: 1 },
};

const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const ms = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : Number(t) || 0);
/** Texto para un parámetro de plantilla: sin saltos de línea ni espacios de más (Meta lo rechaza) */
const param = (s, max = 60) => String(s == null ? "" : s).replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim().slice(0, max);

/** Número para WhatsApp (solo dígitos, con 549 si es argentino sin código de país). null si no sirve. */
function waNumber(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = d.slice(1);
  if (d.length === 10) d = "549" + d;
  else if (d.length === 12 && d.startsWith("54") && !d.startsWith("549")) d = "549" + d.slice(2);
  return d.length >= 11 && d.length <= 15 ? d : null;
}
const samePhone = (a, b) => !!a && !!b && String(a).replace(/\D/g, "").slice(-10) === String(b).replace(/\D/g, "").slice(-10);

/** Momento en que toca recordar un turno (ms) según la configuración. */
function reminderMoment(cfg, b) {
  const w = WHEN[cfg && cfg.when] || WHEN.dayBefore18;
  const start = ms(b.startAt) || agenda.startAtMs(b.dateKey, b.startMin);
  if (w.hours) return start - w.hours * 3600 * 1000;
  return agenda.startAtMs(agenda.addDays(b.dateKey, -1), w.dayBefore * 60);
}

/**
 * Turnos que hay que recordar ahora. Pura (se prueba sola): recibe la configuración de
 * recordatorios, los turnos de hoy y mañana, y la hora.
 */
function dueReminders(cfg, bookings, nowMs = Date.now()) {
  const local = agenda.localNow(nowMs).min;
  if (local < QUIET_TO || local >= QUIET_FROM) return [];
  return bookings.filter((b) => {
    if (b.kind !== "booking" || (b.status !== "PENDING" && b.status !== "CONFIRMED")) return false;
    if (b.remindedAt || !waNumber(b.customerPhone)) return false;
    const r = b.reminder || {};
    if (r.status === "sent" || r.status === "delivered" || r.status === "read" || r.status === "failed") return false;
    if (r.status === "sending" && nowMs - ms(r.at) < 10 * 60 * 1000) return false;
    if ((r.tries || 0) >= MAX_TRIES) return false;
    const start = ms(b.startAt) || agenda.startAtMs(b.dateKey, b.startMin);
    if (start - nowMs < MIN_LEAD_MS) return false;
    const moment = reminderMoment(cfg, b);
    // Reservado después del momento del recordatorio: lo acaba de sacar, no hace falta
    const created = ms(b.createdAt);
    if (created && created >= moment) return false;
    return nowMs >= moment;
  });
}

/** "mañana martes 7", "hoy" o "el jueves 9" */
function dayText(dateKey, nowMs = Date.now()) {
  const today = agenda.localNow(nowMs).dateKey;
  const name = `${DAY_NAMES[agenda.weekday(dateKey)]} ${+dateKey.slice(8)}`;
  if (dateKey === today) return "hoy";
  if (dateKey === agenda.addDays(today, 1)) return `mañana ${name}`;
  return `el ${name}`;
}

async function graph(token, path, body) {
  const res = await fetch(`${GRAPH}/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const e = data && data.error ? data.error : {};
    throw Object.assign(new Error(e.error_user_msg || e.message || `WhatsApp respondió ${res.status}`), { status: res.status, code: e.code });
  }
  return data;
}

const sendText = (token, to, text) => graph(token, `${PHONE_ID}/messages`, {
  messaging_product: "whatsapp", to, type: "text", text: { body: text, preview_url: true },
});

/** Link para que el cliente saque otro turno o hable con el comercio. */
function storeLinks(store) {
  const slug = store && store.subdomain;
  const wa = waNumber(store && store.whatsappNumber);
  return { book: slug ? `${STORE_URL}/${encodeURIComponent(slug)}#turnos` : "", chat: wa ? `https://wa.me/${wa}` : "" };
}

const configured = (token) => !!(PHONE_ID && token && token.length > 20);

/** Tarea programada: manda los recordatorios que tocan. Devuelve cuántos mandó. */
async function remindersRun(db, { token }) {
  if (!configured(token)) {
    logger.warn("WhatsApp: recordatorios sin configurar", { phoneId: !!PHONE_ID, tokenLength: (token || "").length });
    return { sent: 0, skipped: "sin configurar" };
  }
  await db.collection("ventra_desktop").doc("whatsapp").set({ reminders: true, checkedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  const now = Date.now();
  const { dateKey: today } = agenda.localNow(now);
  const stores = await db.collection("ventra_stores").where("agenda.reminders.enabled", "==", true).get();
  let sent = 0, failed = 0, noPlan = 0, noQuota = 0;
  const accounts = new Map();
  for (const storeDoc of stores.docs) {
    const store = storeDoc.data();
    const cfg = store.agenda.reminders;
    // Solo los planes que traen recordatorios automáticos, al día (o en los días de gracia)
    const uid = store.ownerUid;
    if (!uid) continue;
    if (!accounts.has(uid)) accounts.set(uid, await db.collection("ventra_accounts").doc(uid).get().then((d) => (d.exists ? d.data() : null)).catch(() => null));
    const acc = accounts.get(uid);
    const paidUntil = acc && acc.paidUntil && acc.paidUntil.toMillis ? acc.paidUntil.toMillis() : 0;
    if (!acc || !quota.includedFor(acc.plan) || paidUntil + GRACE_DAYS * DAY_MS < now) { noPlan++; continue; }
    if ((await quota.status(db, uid, acc.plan)).left <= 0) { noQuota++; continue; }
    const snap = await storeDoc.ref.collection("bookings").where("dateKey", "in", [today, agenda.addDays(today, 1)]).get();
    const due = dueReminders(cfg, snap.docs.map((d) => ({ id: d.id, ...d.data() })), now);
    for (const b of due) {
      const ref = storeDoc.ref.collection("bookings").doc(b.id);
      // Se reclama el turno: si otra ejecución ya lo tomó, no se manda de nuevo
      const tries = await db.runTransaction(async (tx) => {
        const cur = await tx.get(ref);
        const t = cur.exists ? { id: cur.id, ...cur.data() } : null;
        if (!t || !dueReminders(cfg, [t], now).length) return 0;
        const n = ((t.reminder && t.reminder.tries) || 0) + 1;
        tx.update(ref, { reminder: { status: "sending", at: admin.firestore.Timestamp.now(), tries: n } });
        return n;
      });
      if (!tries) continue;
      // Un recordatorio del cupo del mes o de un paquete. Sin cupo, el turno vuelve a la lista a mano
      const q = await quota.claim(db, uid, acc.plan);
      await quotaNotice(db, uid, q, storeDoc.id);
      if (!q.ok) {
        await ref.update({ reminder: { status: "noquota", at: admin.firestore.Timestamp.now(), tries: tries - 1 } }).catch(() => {});
        noQuota++;
        break;
      }
      const to = waNumber(b.customerPhone);
      try {
        const data = await graph(token, `${PHONE_ID}/messages`, {
          messaging_product: "whatsapp", to, type: "template",
          template: {
            name: TEMPLATE.name, language: { code: TEMPLATE.lang },
            components: [
              { type: "body", parameters: [
                param(String(b.customerName || "").split(" ")[0] || "cliente", 30),
                param(store.businessName || "tu turno", 60),
                param(`${b.serviceName || "Turno"}${b.staffName ? ` con ${b.staffName}` : ""}`, 80),
                param(dayText(b.dateKey, now), 40),
                param(agenda.hhmm(b.startMin), 5),
              ].map((text) => ({ type: "text", text })) },
              { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: `c|${storeDoc.id}|${b.id}` }] },
              { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: `x|${storeDoc.id}|${b.id}` }] },
            ],
          },
        });
        const waId = data.messages && data.messages[0] && data.messages[0].id;
        const at = admin.firestore.FieldValue.serverTimestamp();
        await ref.update({ remindedAt: at, remindedBy: "auto", reminder: { status: "sent", at: admin.firestore.Timestamp.now(), tries, waId: waId || null, quota: { source: q.source, month: q.month, uid } } });
        await Promise.all([
          waId && db.collection("ventra_wa_messages").doc(waId).set({ storeId: storeDoc.id, bookingId: b.id, at }),
          db.collection("ventra_wa_contacts").doc(to).set({ storeId: storeDoc.id, bookingId: b.id, at }, { merge: true }),
        ]);
        usage.track(store.ownerUid, { waReminders: 1 });
        sent++;
      } catch (err) {
        // No salió: no se cobra (si se reintenta, el próximo intento vuelve a reservar)
        await quota.refund(db, uid, q.source, q.month).catch(() => {});
        // Error de Meta (número inválido, plantilla, etc.): no se insiste. Red o caída: se reintenta
        const retry = !err.status || err.status >= 500 || err.status === 429;
        const status = retry && tries < MAX_TRIES ? "retry" : "failed";
        await ref.update({ reminder: { status, at: admin.firestore.Timestamp.now(), tries, error: param(err.message, 200) } }).catch(() => {});
        logger.warn("WhatsApp: no se pudo mandar el recordatorio", { storeId: storeDoc.id, bookingId: b.id, error: err.message, code: err.code });
        failed++;
      }
    }
  }
  await usage.flush(true);
  return { sent, failed, noPlan, noQuota };
}

/** Le avisa al dueño cuando le quedan pocos recordatorios o se le terminaron (una vez por mes). */
async function quotaNotice(db, uid, q, storeId) {
  const pack = `${quota.PACK.qty} por $${quota.PACK.price.toLocaleString("es-AR")}`;
  let msg = null;
  if (q.empty) {
    msg = {
      title: "Se terminaron tus recordatorios automáticos",
      body: `Sumá ${pack} desde Agenda → Configurar y siguen saliendo solos. Mientras tanto, mandalos con un toque desde la agenda.`,
    };
  } else if (q.warn) {
    msg = {
      title: `Te quedan ${q.left} recordatorios automáticos`,
      body: `Si se terminan, mandalos con un toque o sumá ${pack} desde Agenda → Configurar.`,
    };
  }
  if (!msg) return;
  await notify.sendToAccount(db, uid, "reminderQuota", { ...msg, url: "/#/agenda", tag: "wa-quota" }, { storeId }).catch((err) => logger.warn("WhatsApp: no se pudo avisar el cupo", err.message));
}

/** Firma de Meta (X-Hub-Signature-256) sobre el cuerpo tal cual llegó. */
function validSignature(req, appSecret) {
  const given = String(req.get("x-hub-signature-256") || "");
  if (!appSecret || !given.startsWith("sha256=") || !req.rawBody) return false;
  const expected = "sha256=" + crypto.createHmac("sha256", appSecret).update(req.rawBody).digest("hex");
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

const ORDER = { sending: 0, retry: 0, sent: 1, delivered: 2, read: 3 };

async function onStatus(db, s) {
  const map = await db.collection("ventra_wa_messages").doc(String(s.id || "")).get();
  if (!map.exists) return;
  const { storeId, bookingId } = map.data();
  const ref = db.collection("ventra_stores").doc(storeId).collection("bookings").doc(bookingId);
  let refundAfter = null;
  await db.runTransaction(async (tx) => {
    refundAfter = null;
    const cur = await tx.get(ref);
    if (!cur.exists) return;
    const r = cur.data().reminder || {};
    if (s.status === "failed") {
      const e = (s.errors && s.errors[0]) || {};
      // No llegó: vuelve a la lista de recordatorios a mano (y Meta no lo cobra: se devuelve al cupo)
      tx.update(ref, { reminder: { ...r, status: "failed", quota: null, error: param(e.title || e.message || "No se pudo entregar", 200) }, remindedAt: admin.firestore.FieldValue.delete() });
      refundAfter = r.quota && r.status !== "failed" ? r.quota : null;
    } else if (ORDER[s.status] != null && ORDER[s.status] > (ORDER[r.status] ?? -1) && r.status !== "failed") {
      tx.update(ref, { "reminder.status": s.status });
    }
  });
  if (refundAfter && refundAfter.uid) await quota.refund(db, refundAfter.uid, refundAfter.source, refundAfter.month).catch(() => {});
}

async function onButton(db, token, from, payload) {
  const [action, storeId, bookingId] = String(payload || "").split("|");
  if (!["c", "x"].includes(action) || !storeId || !bookingId) return;
  const storeRef = db.collection("ventra_stores").doc(storeId);
  const ref = storeRef.collection("bookings").doc(bookingId);
  const [storeSnap, cur] = await Promise.all([storeRef.get(), ref.get()]);
  if (!cur.exists || !storeSnap.exists) return;
  const b = cur.data(), store = storeSnap.data();
  // Solo el cliente del turno puede tocar sus botones
  if (!samePhone(b.customerPhone, from)) return;
  const when = `${dayText(b.dateKey)} a las ${agenda.hhmm(b.startMin)}`;
  const links = storeLinks(store);
  const upcoming = (b.status === "PENDING" || b.status === "CONFIRMED") && ms(b.startAt) > Date.now();
  if (!upcoming) {
    if (b.status === "CANCELLED") return sendText(token, from, `Ese turno ya estaba cancelado.${links.book ? ` Para sacar otro: ${links.book}` : ""}`);
    return sendText(token, from, `Ese turno ya no se puede cambiar desde acá.${links.chat ? ` Escribile a ${store.businessName || "el comercio"}: ${links.chat}` : ""}`);
  }
  if (action === "c") {
    await ref.update({ status: "CONFIRMED", clientConfirmedAt: admin.firestore.FieldValue.serverTimestamp(), statusAt: admin.firestore.FieldValue.serverTimestamp() });
    return sendText(token, from, `¡Gracias! Te esperamos ${when} en ${store.businessName || "el local"}.`);
  }
  await ref.update({ status: "CANCELLED", cancelledBy: "client", cancelVia: "whatsapp", statusAt: admin.firestore.FieldValue.serverTimestamp() });
  return sendText(token, from, `Listo, cancelamos tu turno de ${when}.${links.book ? ` Para elegir otro horario: ${links.book}` : links.chat ? ` Para elegir otro horario, escribile a ${store.businessName || "el comercio"}: ${links.chat}` : ""}`);
}

async function onText(db, token, from) {
  const ref = db.collection("ventra_wa_contacts").doc(String(from));
  const contact = await ref.get();
  if (!contact.exists) return;
  const c = contact.data();
  if (c.autoReplyAt && Date.now() - ms(c.autoReplyAt) < AUTO_REPLY_EVERY_MS) return;
  const store = await db.collection("ventra_stores").doc(c.storeId).get();
  const links = storeLinks(store.exists ? store.data() : null);
  const name = (store.exists && store.data().businessName) || "el comercio";
  await ref.set({ autoReplyAt: admin.firestore.Timestamp.now() }, { merge: true });
  return sendText(token, from, `¡Hola! Este número solo manda avisos de turnos y no lee mensajes. ${links.chat ? `Para hablar con ${name}, escribile acá: ${links.chat}` : `Para cualquier consulta, comunicate con ${name}.`}`);
}

/** Webhook de Meta: verificación (GET) y novedades (POST). */
async function hook(db, req, res, { token, appSecret, verifyToken }) {
  if (req.method === "GET") {
    const ok = req.query["hub.mode"] === "subscribe" && verifyToken && req.query["hub.verify_token"] === verifyToken;
    return ok ? res.status(200).send(String(req.query["hub.challenge"] || "")) : res.status(403).send("Forbidden");
  }
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  if (!validSignature(req, appSecret)) return res.status(401).send("Firma inválida");
  const jobs = [];
  for (const entry of (req.body && req.body.entry) || []) {
    for (const change of entry.changes || []) {
      const v = change.value || {};
      for (const s of v.statuses || []) jobs.push(onStatus(db, s));
      for (const m of v.messages || []) {
        const payload = (m.button && m.button.payload) || (m.interactive && m.interactive.button_reply && m.interactive.button_reply.id);
        if (payload) jobs.push(onButton(db, token, m.from, payload));
        else if (configured(token)) jobs.push(onText(db, token, m.from));
      }
    }
  }
  const results = await Promise.allSettled(jobs);
  for (const r of results) if (r.status === "rejected") logger.warn("WhatsApp: error procesando una novedad", r.reason && r.reason.message);
  res.status(200).send("OK");
}

module.exports = { remindersRun, hook, dueReminders, reminderMoment, dayText, waNumber, WHEN };
