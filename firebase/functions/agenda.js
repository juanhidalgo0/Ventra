/**
 * Agenda de turnos de la tienda online.
 *
 * Datos (Firestore):
 *  - ventra_stores/{storeId}.agenda: configuración pública (servicios, profesionales con
 *    sus horarios, intervalo entre turnos, anticipación). Sin datos de clientes.
 *  - ventra_stores/{storeId}/bookings/{id}: turnos y bloqueos. Solo los lee el dueño.
 *      { kind: 'booking'|'block', dateKey 'YYYY-MM-DD', startMin, endMin, startAt, staffId ('ALL' en
 *        bloqueos de todo el local), serviceId, serviceName, staffName, price, durationMin,
 *        customerName, customerPhone, customerNote, code, status, source: 'online'|'manual' }
 *  - ventra_stores/{storeId}/agenda_busy/{dateKey}: { items: [{ staffId, s, e }] } ocupado por día,
 *    público, para que la tienda muestre los horarios libres sin exponer a nadie.
 *
 * Horario: Argentina (UTC-3, sin horario de verano). Las horas se guardan como minutos del día.
 * La lógica de horarios libres está repetida en firebase/tienda/index.html y
 * apps/frontend/src/services/agenda.ts: si se cambia acá, cambiarla allá.
 */
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const crypto = require("crypto");

const TZ_OFFSET_MIN = -180;
/** Estados que ocupan el horario */
const ACTIVE = new Set(["PENDING", "CONFIRMED", "DONE", "BLOCK"]);

const toMin = (hhmm) => { const p = String(hhmm || "0:0").split(":"); return (+p[0]) * 60 + (+p[1] || 0); };
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/** Fecha y minuto actuales en Argentina */
function localNow(ms = Date.now()) {
  const d = new Date(ms + TZ_OFFSET_MIN * 60000);
  return { dateKey: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
function addDays(dateKey, n) {
  const d = new Date(`${dateKey}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const weekday = (dateKey) => new Date(`${dateKey}T12:00:00Z`).getUTCDay();
const startAtMs = (dateKey, min) => Date.parse(`${dateKey}T00:00:00Z`) + (min - TZ_OFFSET_MIN) * 60000;

function dayRanges(h) {
  if (!h || !h.open) return [];
  const r = (h.ranges && h.ranges.length) ? h.ranges : [{ from: h.from, to: h.to }];
  return r.filter((x) => x && x.from && x.to).map((x) => ({ s: toMin(x.from), e: toMin(x.to) })).filter((x) => x.e > x.s).sort((a, b) => a.s - b.s);
}

const canDo = (staff, service) => !service.staffIds || !service.staffIds.length || service.staffIds.includes(staff.id);

/**
 * Horarios de inicio libres de un profesional para un servicio en un día.
 * busy: [{ staffId, s, e }] (staffId 'ALL' bloquea a todos). minStart: minuto mínimo (anticipación).
 */
function freeStarts(agenda, staff, service, dateKey, busy, minStart = 0) {
  const step = Math.max(5, Number(agenda.slotStepMin) || 15);
  const buf = Math.max(0, Number(agenda.bufferMin) || 0);
  const dur = Math.max(5, Number(service.durationMin) || 30);
  const out = [];
  for (const r of dayRanges((staff.hours || [])[weekday(dateKey)])) {
    for (let t = r.s; t + dur <= r.e; t += step) {
      if (t < minStart) continue;
      const clash = busy.some((b) => (b.staffId === staff.id || b.staffId === "ALL") && t < b.e + buf && b.s < t + dur + buf);
      if (!clash) out.push(t);
    }
  }
  return out;
}

/** Minuto mínimo para reservar ese día según la anticipación configurada (Infinity = día no disponible) */
function minStartFor(agenda, dateKey, nowMs = Date.now()) {
  const now = localNow(nowMs);
  const maxDays = Math.max(1, Math.min(180, Number(agenda.maxDaysAhead) || 30));
  if (dateKey < now.dateKey || dateKey > addDays(now.dateKey, maxDays - 1)) return Infinity;
  const notice = Math.max(0, Number(agenda.minNoticeMin) || 0);
  const earliest = localNow(nowMs + notice * 60000);
  if (dateKey < earliest.dateKey) return Infinity;
  return dateKey === earliest.dateKey ? earliest.min : 0;
}

const busyOf = (docs) => docs
  .map((d) => (typeof d.data === "function" ? d.data() : d))
  .filter((b) => ACTIVE.has(b.status))
  .map((b) => ({ staffId: b.staffId, s: b.startMin, e: b.endMin }));

function code() {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = ""; for (let i = 0; i < 4; i++) s += a[crypto.randomInt(a.length)];
  return s;
}

const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

/** POST { storeId, serviceId, staffId ('ANY' = cualquiera), date 'YYYY-MM-DD', time 'HH:MM', name, phone, note } */
async function book(db, req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  const b = req.body || {};
  const storeId = clean(b.storeId, 80), serviceId = clean(b.serviceId, 60), staffId = clean(b.staffId, 60) || "ANY";
  const dateKey = clean(b.date, 10), time = clean(b.time, 5);
  const name = clean(b.name, 80), note = clean(b.note, 500);
  const phone = clean(b.phone, 40), phoneDigits = phone.replace(/\D/g, "");
  if (!/^store_[a-z0-9]{8,64}$|^[A-Za-z0-9_-]{6,80}$/.test(storeId)) return res.status(400).json({ error: "Tienda inválida" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: "Fecha u hora inválida" });
  if (name.length < 2) return res.status(400).json({ error: "Escribí tu nombre" });
  if (phoneDigits.length < 8 || phoneDigits.length > 15) return res.status(400).json({ error: "Escribí un WhatsApp válido" });

  const storeRef = db.collection("ventra_stores").doc(storeId);
  const store = await storeRef.get();
  const cfg = store.exists ? store.data() : null;
  const agenda = cfg && cfg.agenda;
  if (!cfg || !cfg.claimed || !cfg.isPublished || !agenda || !agenda.enabled) return res.status(404).json({ error: "Este comercio no está tomando turnos online" });
  if (cfg.ownerUid) {
    const acc = await db.collection("ventra_accounts").doc(cfg.ownerUid).get();
    if (acc.exists && acc.data().plan === "caja") return res.status(403).json({ error: "Este comercio no está tomando turnos online" });
  }
  const service = (agenda.services || []).find((s) => s.id === serviceId && s.active !== false);
  if (!service) return res.status(400).json({ error: "Ese servicio ya no está disponible" });
  const staffList = (agenda.staff || []).filter((s) => s.active !== false && canDo(s, service) && (staffId === "ANY" || s.id === staffId));
  if (!staffList.length) return res.status(400).json({ error: "Ese profesional ya no está disponible" });

  const startMin = toMin(time), dur = Math.max(5, Number(service.durationMin) || 30);
  const minStart = minStartFor(agenda, dateKey);
  if (startMin < minStart) return res.status(409).json({ error: "Ese horario ya no se puede reservar. Elegí otro." });

  // Límites contra abusos: por IP (10 por hora) y por teléfono (3 turnos a futuro en el comercio)
  const ip = String(req.get("x-forwarded-for") || req.ip || "").split(",")[0].trim();
  const rateRef = db.collection("ventra_agenda_rate").doc(crypto.createHash("sha256").update(storeId + "|" + ip).digest("hex").slice(0, 40));
  const hourAgo = Date.now() - 3600000;
  const recent = ((await rateRef.get()).data() || {}).at || [];
  if (recent.filter((t) => t > hourAgo).length >= 10) return res.status(429).json({ error: "Demasiadas reservas seguidas. Probá de nuevo en un rato." });
  const mine = await storeRef.collection("bookings").where("customerPhoneKey", "==", phoneDigits.slice(-10)).get();
  const upcoming = mine.docs.filter((d) => ACTIVE.has(d.data().status) && d.data().status !== "DONE" && (d.data().startAt && d.data().startAt.toMillis() > Date.now()));
  if (upcoming.length >= 3) return res.status(429).json({ error: "Ya tenés 3 turnos reservados en este comercio. Para otro, escribiles por WhatsApp." });

  const bookingRef = storeRef.collection("bookings").doc();
  const bookingCode = code();
  let chosen;
  try {
    chosen = await db.runTransaction(async (tx) => {
      const day = await tx.get(storeRef.collection("bookings").where("dateKey", "==", dateKey));
      const busy = busyOf(day.docs);
      // Con "cualquiera", el que menos turnos tiene ese día
      const load = (s) => day.docs.filter((d) => d.data().staffId === s.id && ACTIVE.has(d.data().status)).length;
      const free = staffList.filter((s) => freeStarts(agenda, s, service, dateKey, busy, minStart).includes(startMin)).sort((x, y) => load(x) - load(y));
      if (!free.length) return null;
      const s = free[0];
      tx.set(bookingRef, {
        kind: "booking",
        dateKey, startMin, endMin: startMin + dur,
        startAt: admin.firestore.Timestamp.fromMillis(startAtMs(dateKey, startMin)),
        staffId: s.id, staffName: s.name || "",
        serviceId: service.id, serviceName: service.name || "", durationMin: dur, price: Number(service.price) || 0,
        customerName: name, customerPhone: phone, customerPhoneKey: phoneDigits.slice(-10), customerNote: note,
        code: bookingCode,
        status: agenda.autoConfirm === false ? "PENDING" : "CONFIRMED",
        source: "online",
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return s;
    });
  } catch (err) {
    logger.error("Agenda: no se pudo reservar", storeId, err);
    return res.status(500).json({ error: "No se pudo reservar. Probá de nuevo." });
  }
  if (!chosen) return res.status(409).json({ error: "Ese horario se acaba de ocupar. Elegí otro." });
  await rateRef.set({ at: recent.filter((t) => t > hourAgo).concat(Date.now()).slice(-20) }).catch(() => {});
  return res.status(200).json({
    ok: true, id: bookingRef.id, code: bookingCode,
    staffName: chosen.name || "", serviceName: service.name || "",
    date: dateKey, time: hhmm(startMin), status: agenda.autoConfirm === false ? "PENDING" : "CONFIRMED",
  });
}

/** Recalcula lo ocupado del día (público, sin datos personales) */
async function refreshBusy(db, storeId, dateKey) {
  const storeRef = db.collection("ventra_stores").doc(storeId);
  const day = await storeRef.collection("bookings").where("dateKey", "==", dateKey).get();
  const items = busyOf(day.docs);
  const ref = storeRef.collection("agenda_busy").doc(dateKey);
  if (!items.length) return ref.delete().catch(() => {});
  return ref.set({ items, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
}

const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const fmtDay = (dateKey) => { const [, m, d] = dateKey.split("-"); return `${DAYS[weekday(dateKey)]} ${+d}/${+m}`; };

module.exports = { book, refreshBusy, hhmm, fmtDay, freeStarts, minStartFor, dayRanges };
