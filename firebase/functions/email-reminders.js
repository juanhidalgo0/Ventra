// ═══════════════════════════════════════════════════
// Recordatorio de turnos por email: gratis en todos los planes (el de WhatsApp automático es
// de Agenda Pro y Full, ver whatsapp.js). Lo manda Ventra desde turnos@ventra.store con el
// nombre del comercio, con el link para ver o cancelar el turno y el turno para el calendario.
//
// - Solo turnos con customerEmail (opcional en la reserva online).
// - Sale en el mismo momento que el de WhatsApp (agenda.reminders.when, o el día anterior a las 18).
// - El comercio lo puede apagar: agenda.emailReminders.enabled === false.
// - Cada turno se "reclama" en una transacción: dos ejecuciones nunca mandan dos veces.
// Sin la clave de Resend no se manda nada (el resto sigue igual).
// ═══════════════════════════════════════════════════
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const agenda = require("./agenda");
const usage = require("./usage");
const { reminderMoment, waNumber } = require("./whatsapp");

const FROM_ADDRESS = "turnos@ventra.store";
const STORE_URL = "https://tienda.ventra.store";
const QUIET_FROM = 22 * 60, QUIET_TO = 8 * 60;
const MIN_LEAD_MS = 30 * 60 * 1000;
const MAX_TRIES = 3;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const DAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const ms = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : Number(t) || 0);
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const enabledFor = (store) => !!(store.agenda && store.agenda.enabled && !(store.agenda.emailReminders && store.agenda.emailReminders.enabled === false));

/** Turnos a los que hay que mandarles el email ahora. Pura (se prueba sola). */
function dueEmails(cfg, bookings, nowMs = Date.now()) {
  const local = agenda.localNow(nowMs).min;
  if (local < QUIET_TO || local >= QUIET_FROM) return [];
  return bookings.filter((b) => {
    if (b.kind !== "booking" || (b.status !== "PENDING" && b.status !== "CONFIRMED")) return false;
    if (b.emailRemindedAt || !EMAIL_RE.test(String(b.customerEmail || ""))) return false;
    const r = b.emailReminder || {};
    if (r.status === "sent" || r.status === "failed") return false;
    if (r.status === "sending" && nowMs - ms(r.at) < 10 * 60 * 1000) return false;
    if ((r.tries || 0) >= MAX_TRIES) return false;
    const start = ms(b.startAt) || agenda.startAtMs(b.dateKey, b.startMin);
    if (start - nowMs < MIN_LEAD_MS) return false;
    const moment = reminderMoment(cfg, b);
    const created = ms(b.createdAt);
    if (created && created >= moment) return false;
    return nowMs >= moment;
  });
}

/** "mañana, jueves 9 de octubre" / "hoy, jueves 9 de octubre" / "el jueves 9 de octubre" */
function longDay(dateKey, nowMs = Date.now()) {
  const today = agenda.localNow(nowMs).dateKey;
  const full = `${DAY_NAMES[agenda.weekday(dateKey)]} ${+dateKey.slice(8)} de ${MONTHS[+dateKey.slice(5, 7) - 1]}`;
  if (dateKey === today) return `hoy, ${full}`;
  if (dateKey === agenda.addDays(today, 1)) return `mañana, ${full}`;
  return `el ${full}`;
}

/** Evento de calendario (.ics) del turno, en hora de Argentina. */
function icsFor(b, store) {
  // En UTC: sin depender de que el calendario conozca la zona horaria de Argentina
  const stamp = (dateKey, min) => new Date(agenda.startAtMs(dateKey, min)).toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const end = b.endMin || b.startMin + (Number(b.durationMin) || 30);
  const txt = (s) => String(s || "").replace(/[\\;,]/g, (c) => "\\" + c).replace(/\r?\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Ventra//Turnos//ES", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${b.id}@ventra.store`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART:${stamp(b.dateKey, b.startMin)}`,
    `DTEND:${stamp(b.dateKey, end)}`,
    `SUMMARY:${txt(`${b.serviceName || "Turno"} · ${store.businessName || ""}`)}`,
    ...(store.address ? [`LOCATION:${txt(store.address)}`] : []),
    `DESCRIPTION:${txt(`Turno #${b.code || ""}${b.staffName ? ` con ${b.staffName}` : ""}`)}`,
    "BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", "DESCRIPTION:Turno", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
}

/** Asunto, HTML y texto del email. Pura. */
function emailFor(b, store, nowMs = Date.now()) {
  const biz = store.businessName || "tu turno";
  const when = `${longDay(b.dateKey, nowMs)} a las ${agenda.hhmm(b.startMin)} hs`;
  const what = `${b.serviceName || "Turno"}${b.staffName ? ` con ${b.staffName}` : ""}`;
  const slug = encodeURIComponent(store.subdomain || "");
  const manage = b.code ? `${STORE_URL}/${slug}#turno=${b.id}.${b.code}` : `${STORE_URL}/${slug}`;
  const wa = waNumber(store.whatsappNumber);
  const first = String(b.customerName || "").split(" ")[0];
  const brand = /^#[0-9a-f]{6}$/i.test(store.brandColor || "") ? store.brandColor : "#167160";
  const subject = `Recordatorio: tu turno en ${biz}, ${longDay(b.dateKey, nowMs).split(",")[0]} ${agenda.hhmm(b.startMin)} hs`;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(subject)}</title></head><body style="margin:0;background:#F6F2EC;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0F1F1A">
<div style="max-width:480px;margin:0 auto;padding:28px 16px">
  <div style="background:#fff;border-radius:20px;padding:28px 24px;border:1px solid #E4DDD1">
    <p style="margin:0 0 6px;font-size:13px;color:#56655F">${esc(biz)}</p>
    <h1 style="margin:0 0 18px;font-size:22px;line-height:1.25">${first ? `Hola ${esc(first)}, ` : ""}te esperamos ${esc(when)}</h1>
    <p style="margin:0 0 4px;font-size:16px"><b>${esc(what)}</b></p>
    ${store.address ? `<p style="margin:0 0 4px;font-size:14px;color:#56655F">${esc(store.address)}</p>` : ""}
    ${b.code ? `<p style="margin:0 0 20px;font-size:13px;color:#8A958F">Turno #${esc(b.code)}</p>` : ""}
    <a href="${esc(manage)}" style="display:block;text-align:center;background:${brand};color:#fff;text-decoration:none;font-weight:600;border-radius:999px;padding:14px">Ver o cancelar mi turno</a>
    ${wa ? `<a href="https://wa.me/${wa}" style="display:block;text-align:center;color:${brand};text-decoration:none;font-weight:600;padding:14px 0 0">Escribirle a ${esc(biz)} por WhatsApp</a>` : ""}
    <p style="margin:20px 0 0;font-size:13px;color:#56655F">Si no podés ir, cancelalo desde el link así el horario le queda a otra persona. Adjuntamos el turno para que lo agregues a tu calendario.</p>
  </div>
  <p style="margin:16px 0 0;font-size:11.5px;color:#8A958F;text-align:center">Recibís este email porque reservaste un turno en ${esc(biz)}. Turnos online con <a href="https://ventra.store/peluquerias?utm_source=email&utm_medium=recordatorio" style="color:#8A958F">Ventra</a>.</p>
</div></body></html>`;
  const text = `${first ? `Hola ${first}, ` : ""}te esperamos ${when} en ${biz}.\n\n${what}${store.address ? `\n${store.address}` : ""}${b.code ? `\nTurno #${b.code}` : ""}\n\nVer o cancelar mi turno: ${manage}${wa ? `\nWhatsApp de ${biz}: https://wa.me/${wa}` : ""}`;
  return { subject, html, text };
}

async function sendEmail(apiKey, msg) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(msg),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.message || `Resend respondió ${res.status}`), { status: res.status });
  return data;
}

const configured = (apiKey) => !!(apiKey && apiKey.startsWith("re_"));

/** Tarea programada: manda los emails que tocan. */
async function emailRemindersRun(db, { apiKey }) {
  if (!configured(apiKey)) return { sent: 0, skipped: "sin configurar" };
  const now = Date.now();
  const { dateKey: today } = agenda.localNow(now);
  const stores = await db.collection("ventra_stores").where("agenda.enabled", "==", true).get();
  let sent = 0, failed = 0;
  for (const storeDoc of stores.docs) {
    const store = storeDoc.data();
    if (!enabledFor(store)) continue;
    const cfg = store.agenda.reminders || {};
    const snap = await storeDoc.ref.collection("bookings").where("dateKey", "in", [today, agenda.addDays(today, 1)]).get();
    const due = dueEmails(cfg, snap.docs.map((d) => ({ id: d.id, ...d.data() })), now);
    for (const b of due) {
      const ref = storeDoc.ref.collection("bookings").doc(b.id);
      const tries = await db.runTransaction(async (tx) => {
        const cur = await tx.get(ref);
        const t = cur.exists ? { id: cur.id, ...cur.data() } : null;
        if (!t || !dueEmails(cfg, [t], now).length) return 0;
        const n = ((t.emailReminder && t.emailReminder.tries) || 0) + 1;
        tx.update(ref, { emailReminder: { status: "sending", at: admin.firestore.Timestamp.now(), tries: n } });
        return n;
      });
      if (!tries) continue;
      try {
        const { subject, html, text } = emailFor(b, store, now);
        const fromName = `${String(store.businessName || "Turnos").replace(/["<>\r\n]/g, "").slice(0, 60)} vía Ventra`;
        const data = await sendEmail(apiKey, {
          from: `${fromName} <${FROM_ADDRESS}>`, to: [b.customerEmail], subject, html, text,
          attachments: [{ filename: "turno.ics", content: Buffer.from(icsFor(b, store)).toString("base64") }],
          tags: [{ name: "kind", value: "turno_recordatorio" }],
        });
        await ref.update({ emailRemindedAt: admin.firestore.FieldValue.serverTimestamp(), emailReminder: { status: "sent", at: admin.firestore.Timestamp.now(), tries, id: data.id || null } });
        usage.track(store.ownerUid, { emailReminders: 1 });
        sent++;
      } catch (err) {
        const retry = !err.status || err.status >= 500 || err.status === 429;
        await ref.update({ emailReminder: { status: retry && tries < MAX_TRIES ? "retry" : "failed", at: admin.firestore.Timestamp.now(), tries, error: String(err.message).slice(0, 200) } }).catch(() => {});
        logger.warn("Email: no se pudo mandar el recordatorio", { storeId: storeDoc.id, bookingId: b.id, error: err.message });
        failed++;
      }
    }
  }
  await usage.flush(true);
  return { sent, failed };
}

module.exports = { emailRemindersRun, dueEmails, emailFor, icsFor, longDay };
