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
 * La lógica de horarios libres (dayRanges, freeStarts), depositFor y phoneKeyOf está repetida en
 * firebase/tienda/index.html y apps/frontend/src/services/agendaCore.ts: si se cambia acá, cambiarla allá.
 *
 * Seña (agenda.deposit percent/fixed): no se devuelve nunca si el cliente cancela, para eso es.
 * El turno completo pagado online sí queda para devolver (deposit.refundNeeded) si el cliente cancela.
 */
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const crypto = require("crypto");
const storeSlugs = require("./store-slugs");

const TZ_OFFSET_MIN = -180;
/** Estados que ocupan el horario */
const ACTIVE = new Set(["PENDING", "CONFIRMED", "DONE", "BLOCK", "AWAITING_PAYMENT"]);
/** Minutos que se aparta el horario mientras el cliente paga. Si vuelve de Mercado Pago sin pagar se libera
 * enseguida (manage "abandon"); este plazo es para el que cierra la pestaña y no vuelve. */
const HOLD_MIN = 10;
/** Esperando seña con el plazo vencido: ya no ocupa (aunque la tarea que lo cancela no haya pasado) */
const holdExpired = (b) => b.status === "AWAITING_PAYMENT" && b.holdUntil && b.holdUntil.toMillis() < Date.now();

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

/**
 * Rangos de atención del día en minutos, ordenados y juntados si se pisan o se tocan (9 a 13 y 12 a 18 = 9 a 18).
 * Un rango que termina a las 00:00 (o antes de empezar, ej. 18 a 2) va hasta la medianoche: el resto no se reserva.
 */
function dayRanges(h) {
  if (!h || !h.open) return [];
  const r = (h.ranges && h.ranges.length) ? h.ranges : [{ from: h.from, to: h.to }];
  const list = r.filter((x) => x && x.from && x.to).map((x) => { const s = toMin(x.from), e = toMin(x.to); return { s, e: e <= s ? 24 * 60 : e }; })
    .filter((x) => x.s < 24 * 60).sort((a, b) => a.s - b.s);
  const out = [];
  for (const x of list) {
    const last = out[out.length - 1];
    if (last && x.s <= last.e) last.e = Math.max(last.e, x.e);
    else out.push({ ...x });
  }
  return out;
}

/**
 * Número argentino sin país, sin 0 y sin 15 (10 dígitos: código de área + número). Los clientes lo escriben de mil
 * maneras: "+54 9 11 2345-6789", "011 15 2345 6789", "0351 15 234 5678". Si no parece argentino, quedan los dígitos.
 */
function arNational(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("54") && d.length >= 12) { d = d.slice(2); if (d.startsWith("9") && d.length === 11) d = d.slice(1); }
  if (d.startsWith("0")) d = d.slice(1);
  // Código de área de 2 a 4 dígitos y el 15 de los celulares en el medio
  if (d.length === 12) for (const p of [2, 3, 4]) if (d.substr(p, 2) === "15") { d = d.slice(0, p) + d.slice(p + 2); break; }
  return d;
}
/** Clave del teléfono del cliente (customerPhoneKey): los 10 dígitos del número argentino */
const phoneKeyOf = (phone) => arNational(phone).slice(-10);

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
  .filter((b) => ACTIVE.has(b.status) && !holdExpired(b))
  .map((b) => ({ staffId: b.staffId, s: b.startMin, e: b.endMin }));

/**
 * Pago online del turno según la agenda: agenda.deposit = { enabled, mode: 'full' | 'percent' | 'fixed', value }.
 * 'full' (o sin modo): el turno completo, al precio del servicio; sin precio no se cobra.
 * 'percent' / 'fixed': seña (% del precio o monto fijo). Nunca más que el precio. 0 = sin cobro.
 */
function depositFor(agenda, service) {
  const d = agenda && agenda.deposit;
  if (!d || !d.enabled) return 0;
  const price = Number(service.price) || 0;
  if (d.mode !== "percent" && d.mode !== "fixed") return price >= 1 ? Math.round(price) : 0;
  let amount = d.mode === "fixed" ? Number(d.value) || 0 : Math.round(price * (Number(d.value) || 0) / 100);
  if (price > 0) amount = Math.min(amount, price);
  return amount >= 1 ? Math.round(amount) : 0;
}

/** La seña es obligatoria para reservar; con el turno completo el cliente puede elegir pagar en el local */
const depositRequired = (agenda) => {
  const d = agenda && agenda.deposit;
  return !!(d && (d.mode === "percent" || d.mode === "fixed"));
};

function code(n = 4) {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = ""; for (let i = 0; i < n; i++) s += a[crypto.randomInt(a.length)];
  return s;
}
/** Código del link corto del turno (ventra.store/<comercio>/turno/<código>): 8 caracteres, imposible de adivinar */
const shortCode = () => code(8);
/** Link del turno para el cliente: el corto si el turno lo tiene; si no, el de siempre (#turno=<id>.<código>) */
function manageLink(slug, id, b) {
  if (b.shortCode && !storeSlugs.RESERVED.has(slug)) return storeSlugs.publicUrl(slug, "turno/" + b.shortCode);
  return `https://tienda.ventra.store/${encodeURIComponent(slug || "")}#turno=${id}.${b.code}`;
}

const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

/** Reservas online por hora que acepta un comercio (más que esto huele a turnos inventados) */
const STORE_PER_HOUR = 40;

/**
 * IP del cliente. X-Forwarded-For la arma cada salto agregando al final: lo de la izquierda lo puede inventar
 * el propio cliente, así que se toma la última que no sea de Google ni de una red interna.
 */
function clientIp(req) {
  const hops = String(req.get("x-forwarded-for") || "").split(",").map((x) => x.trim()).filter(Boolean);
  const internal = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|35\.191\.|130\.211\.|::1$|f[cd][0-9a-f]{2}:)/i;
  for (let i = hops.length - 1; i >= 0; i--) if (!internal.test(hops[i])) return hops[i];
  return hops[hops.length - 1] || String(req.ip || "");
}

/**
 * POST { storeId, serviceId, staffId ('ANY' = cualquiera), date 'YYYY-MM-DD', time 'HH:MM', name, phone, email?, note,
 *        pay?: 'mp' | 'local' } — con el cobro online prendido, 'local' = paga en el local (sin pago online)
 */
async function book(db, req, res, { tokenFor } = {}) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  const b = req.body || {};
  const storeId = clean(b.storeId, 80), serviceId = clean(b.serviceId, 60), staffId = clean(b.staffId, 60) || "ANY";
  const dateKey = clean(b.date, 10), time = clean(b.time, 5);
  const name = clean(b.name, 80), note = clean(b.note, 500);
  const phone = clean(b.phone, 40), phoneDigits = phone.replace(/\D/g, "");
  // Email opcional: recordatorio por email, gratis en todos los planes (ver email-reminders.js)
  const email = clean(b.email, 120).toLowerCase();
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: "Revisá tu email" });
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

  // Límites contra abusos: por IP (10 por hora), por comercio (STORE_PER_HOUR reservas online por hora, para que
  // nadie le llene la agenda con turnos inventados) y por teléfono (3 turnos a futuro en el comercio)
  const ip = clientIp(req);
  const rateRef = db.collection("ventra_agenda_rate").doc(crypto.createHash("sha256").update(storeId + "|" + ip).digest("hex").slice(0, 40));
  const storeRateRef = db.collection("ventra_agenda_rate").doc("store_" + crypto.createHash("sha256").update(storeId).digest("hex").slice(0, 34));
  const hourAgo = Date.now() - 3600000;
  const [recentSnap, storeRecentSnap] = await Promise.all([rateRef.get(), storeRateRef.get()]);
  const recent = (recentSnap.data() || {}).at || [];
  const storeRecent = (storeRecentSnap.data() || {}).at || [];
  if (recent.filter((t) => t > hourAgo).length >= 10) return res.status(429).json({ error: "Demasiadas reservas seguidas. Probá de nuevo en un rato." });
  if (storeRecent.filter((t) => t > hourAgo).length >= STORE_PER_HOUR) {
    logger.warn("Agenda: tope de reservas online por hora del comercio", storeId);
    return res.status(429).json({ error: "El comercio recibió muchas reservas en la última hora. Probá en un rato o escribiles por WhatsApp." });
  }
  const phoneKey = phoneKeyOf(phone);
  const mine = await storeRef.collection("bookings").where("customerPhoneKey", "==", phoneKey).get();
  const upcoming = mine.docs.filter((d) => ACTIVE.has(d.data().status) && d.data().status !== "DONE" && (d.data().startAt && d.data().startAt.toMillis() > Date.now()));
  if (upcoming.length >= 3) return res.status(429).json({ error: "Ya tenés 3 turnos reservados en este comercio. Para otro, escribiles por WhatsApp." });

  const bookingRef = storeRef.collection("bookings").doc();
  const bookingCode = code();
  const bookingLink = shortCode();

  // Pago online con Mercado Pago (seña o turno completo): solo si el comercio lo pidió y tiene su cuenta de MP conectada
  let deposit = depositFor(agenda, service);
  // El cliente eligió pagar en el local: se reserva como siempre, sin pago online (con seña no se puede)
  const payLocal = clean(b.pay, 10) === "local" && deposit > 0 && !depositRequired(agenda);
  if (payLocal) deposit = 0;
  let mpToken = null;
  if (deposit && cfg.ownerUid && tokenFor) mpToken = await tokenFor(cfg.ownerUid).catch(() => null);
  if (!mpToken) deposit = 0;
  const holdUntil = deposit ? admin.firestore.Timestamp.fromMillis(Date.now() + HOLD_MIN * 60000) : null;
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
        customerName: name, customerNameKey: nameKeyOf(name), customerPhone: phone, customerPhoneKey: phoneKey, customerNote: note,
        ...(email ? { customerEmail: email } : {}),
        code: bookingCode, shortCode: bookingLink,
        status: deposit ? "AWAITING_PAYMENT" : agenda.autoConfirm === false ? "PENDING" : "CONFIRMED",
        ...(deposit ? { holdUntil, deposit: { amount: deposit, status: "pending", full: deposit >= (Number(service.price) || 0) } } : {}),
        ...(payLocal ? { payAt: "local" } : {}),
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
  await Promise.all([
    rateRef.set({ at: recent.filter((t) => t > hourAgo).concat(Date.now()).slice(-20) }),
    storeRateRef.set({ at: storeRecent.filter((t) => t > hourAgo).concat(Date.now()).slice(-STORE_PER_HOUR) }),
  ]).catch(() => {});

  let status = agenda.autoConfirm === false ? "PENDING" : "CONFIRMED";
  let payUrl = null;
  if (deposit) {
    // Link de pago de Mercado Pago a nombre del comercio. Si falla, el turno sigue sin pago online
    // (mejor un turno sin cobrar que un cliente trabado sin poder reservar).
    try {
      // La vuelta va en la dirección (?turno=), no en el #: Mercado Pago le suma sus datos atrás.
      // La tienda sabe así si volvió pagado (mp=ok) o sin pagar (mp=fail: el horario se libera enseguida)
      const back = `https://tienda.ventra.store/${encodeURIComponent(cfg.subdomain || "")}?turno=${bookingRef.id}.${bookingCode}&mp=`;
      const pref = await mpPreference(mpToken, {
        items: [{ title: `${deposit >= (Number(service.price) || 0) ? "Turno" : "Seña"} · ${service.name} · ${cfg.businessName || "turno"}`.slice(0, 250), quantity: 1, unit_price: deposit, currency_id: "ARS" }],
        external_reference: `agenda|${storeId}|${bookingRef.id}`,
        notification_url: `https://us-central1-ventra-9cba5.cloudfunctions.net/agendaPayHook?s=${encodeURIComponent(storeId)}`,
        back_urls: { success: `${back}ok`, pending: `${back}pending`, failure: `${back}fail` },
        auto_return: "approved",
        // Solo medios que se acreditan al momento: un ticket para pagar en efectivo no llega antes de que se libere el horario
        payment_methods: { excluded_payment_types: [{ id: "ticket" }, { id: "atm" }] },
        expires: true,
        expiration_date_to: new Date(holdUntil.toMillis()).toISOString(),
        statement_descriptor: String(cfg.businessName || "VENTRA").slice(0, 22),
      });
      payUrl = pref.init_point;
      status = "AWAITING_PAYMENT";
      await bookingRef.update({ "deposit.payUrl": payUrl, "deposit.preferenceId": pref.id || null });
    } catch (err) {
      // Con seña obligatoria no se reserva sin seña: se borra el turno (nadie lo vio todavía) y el cliente reintenta
      if (depositRequired(agenda)) {
        logger.warn("Agenda: no se pudo crear el link de pago de la seña, no se reserva", storeId, err.message);
        await bookingRef.delete().catch(() => {});
        return res.status(503).json({ error: "No se pudo abrir el pago de la seña. Probá de nuevo en un momento." });
      }
      logger.warn("Agenda: no se pudo crear el link de pago, el turno queda sin cobro online", storeId, err.message);
      // payFallback: ventraBookingWritten avisa al dueño del turno nuevo (al crearse esperaba el pago y no avisó)
      await bookingRef.update({ status, payFallback: true, holdUntil: admin.firestore.FieldValue.delete(), deposit: admin.firestore.FieldValue.delete() }).catch(() => {});
    }
  }
  return res.status(200).json({
    ok: true, id: bookingRef.id, code: bookingCode, link: bookingLink, manageUrl: manageLink(cfg.subdomain, bookingRef.id, { code: bookingCode, shortCode: bookingLink }),
    staffName: chosen.name || "", serviceName: service.name || "",
    date: dateKey, time: hhmm(startMin), status,
    ...(payUrl ? { payUrl, deposit, holdMin: HOLD_MIN } : {}),
  });
}

async function mpPreference(token, body) {
  const r = await fetch("https://api.mercadopago.com/checkout/preferences", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || !data.init_point) throw new Error(data.message || `Mercado Pago respondió ${r.status}`);
  return data;
}

/**
 * Aviso de Mercado Pago de un pago de turno (notification_url de la preferencia, ?s=<storeId>).
 * No se confía en el aviso: se consulta el pago a MP con el token del comercio. Idempotente.
 * Devuelve la info del turno para que index.js avise al dueño, o null.
 */
async function payHook(db, req, { tokenFor }) {
  const storeId = clean(req.query.s, 80);
  const q = req.query, b = req.body || {};
  const topic = q.type || q.topic || b.type || b.topic;
  const paymentId = clean(q["data.id"] || (b.data && b.data.id) || (topic === "payment" ? q.id : ""), 40);
  if (!storeId || topic !== "payment" || !/^\d+$/.test(paymentId)) return null;
  const storeRef = db.collection("ventra_stores").doc(storeId);
  const store = await storeRef.get();
  const ownerUid = store.exists && store.data().ownerUid;
  if (!ownerUid) return null;
  const token = await tokenFor(ownerUid);
  if (!token) return null;
  const r = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Mercado Pago respondió ${r.status} al consultar el pago ${paymentId}`);
  const p = await r.json();
  const [tag, refStore, bookingId] = String(p.external_reference || "").split("|");
  if (tag !== "agenda" || refStore !== storeId || !bookingId || p.status !== "approved") return null;
  const agenda = store.data().agenda || {};
  const ref = storeRef.collection("bookings").doc(bookingId);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const t = snap.data();
    if (t.deposit && t.deposit.status === "paid") return null; // ya acreditada
    const paid = { ...(t.deposit || {}), status: "paid", paymentId: String(p.id), paidAmount: Number(p.transaction_amount) || 0, paidAt: admin.firestore.Timestamp.now() };
    const del = admin.firestore.FieldValue.delete();
    const patch = { deposit: paid, holdUntil: del };
    const outcome = await paidOutcome(tx, storeRef, bookingId, t);
    if (outcome === "confirmed" || outcome === "late-ok") {
      // Pagado = confirmado, aunque el comercio confirme a mano los turnos sin pagar
      patch.status = "CONFIRMED";
      if (t.cancelledBy) { patch.cancelledBy = del; patch.cancelVia = del; }
    } else if (outcome === "late-clash" || outcome === "paid-cancelled") {
      // No fue culpa del cliente (el horario se ocupó o el comercio lo canceló): se le devuelve, sea seña o turno completo
      paid.refundNeeded = true;
      // Seguía esperando el pago con el plazo vencido: queda cancelado (expireHolds ya no toca los pagados)
      if (t.status === "AWAITING_PAYMENT") { patch.status = "CANCELLED"; patch.cancelledBy = "expired"; }
    }
    patch.statusAt = admin.firestore.FieldValue.serverTimestamp();
    tx.update(ref, patch);
    return { ownerUid, booking: { ...t, id: bookingId }, amount: paid.paidAmount, outcome };
  });
}

/**
 * Qué pasa con un turno cuando llega su pago (dentro de la transacción de payHook):
 *  - confirmed: esperaba el pago a tiempo (o el comercio ya lo había confirmado) → queda confirmado.
 *  - late-ok / late-clash: el plazo ya había vencido, o el cliente lo abandonó o lo canceló mientras el pago se acreditaba.
 *    Si el horario sigue libre se reactiva; si se ocupó, queda para devolver.
 *  - paid-cancelled: lo canceló el comercio → queda cancelado y para devolver.
 *  - paid: otro estado (atendido, no vino): solo se registra el pago.
 */
async function paidOutcome(tx, storeRef, bookingId, t) {
  const lateHold = t.status === "AWAITING_PAYMENT" && holdExpired(t);
  if (t.status === "AWAITING_PAYMENT" && !lateHold) return "confirmed";
  if (t.status === "PENDING" || t.status === "CONFIRMED") return "confirmed";
  const byClient = t.status === "CANCELLED" && ["expired", "unpaid", "client"].includes(t.cancelledBy);
  if (lateHold || byClient) {
    const day = await tx.get(storeRef.collection("bookings").where("dateKey", "==", t.dateKey));
    const clash = busyOf(day.docs.filter((d) => d.id !== bookingId)).some((x) => (x.staffId === t.staffId || x.staffId === "ALL") && x.s < t.endMin && t.startMin < x.e);
    return clash ? "late-clash" : "late-ok";
  }
  return t.status === "CANCELLED" ? "paid-cancelled" : "paid";
}

/** Tarea programada: libera los horarios de los turnos que no se pagaron a tiempo. */
async function expireHolds(db) {
  const snap = await db.collectionGroup("bookings").where("status", "==", "AWAITING_PAYMENT").get();
  const now = Date.now();
  const late = snap.docs.filter((d) => { const h = d.data().holdUntil; return !h || h.toMillis() < now; });
  // Cada uno en su transacción: si justo se acreditó el pago (payHook), no se lo pisa
  const done = await Promise.all(late.map((d) => db.runTransaction(async (tx) => {
    const cur = await tx.get(d.ref);
    const t = cur.exists ? cur.data() : null;
    if (!t || t.status !== "AWAITING_PAYMENT" || (t.deposit && t.deposit.status === "paid")) return 0;
    if (t.holdUntil && t.holdUntil.toMillis() >= Date.now()) return 0;
    tx.update(d.ref, { status: "CANCELLED", cancelledBy: "expired", statusAt: admin.firestore.FieldValue.serverTimestamp() });
    return 1;
  }).catch((err) => { logger.warn("Agenda: no se pudo liberar un turno sin pagar", d.ref.path, err.message); return 0; })));
  return done.reduce((s, n) => s + n, 0);
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

// ─── Clientes de la agenda ───
// Resumen por cliente (visitas, faltas, gastado, próximo turno) en agenda_clients, armado con
// sus turnos. Misma lógica que clientKeyOf / aggregateClient en apps/frontend/src/services/agendaCore.ts:
// mantener las dos iguales. La nota del cliente la escribe el dueño y acá no se toca.
// phoneKeyOf: arriba, junto a arNational
const nameKeyOf =(name) => String(name || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);

/** Clave del cliente de un turno: el teléfono si tiene, si no el nombre. null para bloqueos. */
function clientKeyOf(b) {
  if (!b || b.kind !== "booking") return null;
  const phone = b.customerPhoneKey || phoneKeyOf(b.customerPhone);
  if (phone.length >= 6) return "p" + phone;
  const name = nameKeyOf(b.customerName);
  return name ? "n_" + name : null;
}

function aggregateClient(bookings, todayKey) {
  const list = bookings.filter((b) => b.kind === "booking").sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.startMin - b.startMin);
  if (!list.length) return null;
  const last = list[list.length - 1];
  const withPhone = list.filter((b) => b.customerPhone).pop();
  const done = list.filter((b) => b.status === "DONE" || b.payment);
  const coming = list.filter((b) => (b.status === "PENDING" || b.status === "CONFIRMED") && b.dateKey >= todayKey)
    .slice(0, 5).map((b) => ({ dateKey: b.dateKey, startMin: b.startMin, serviceName: b.serviceName || "" }));
  return {
    name: last.customerName || "",
    phone: withPhone ? withPhone.customerPhone : "",
    visits: done.length,
    noShows: list.filter((b) => b.status === "NO_SHOW").length,
    cancelled: list.filter((b) => b.status === "CANCELLED").length,
    // Lo cobrado más lo pagado online por Mercado Pago que quedó para el comercio (una seña de un cancelado también)
    spent: list.reduce((s, b) => s + (b.payment ? Number(b.payment.amount) || 0 : 0) + depositKept(b), 0),
    firstDate: list[0].dateKey,
    lastVisit: done.length ? done[done.length - 1].dateKey : null,
    lastService: (done.length ? done[done.length - 1] : last).serviceName || "",
    next: coming[0] || null,
    // Los próximos: cuando pasa el primero, la app muestra el siguiente sin esperar a que se recalcule
    upcoming: coming,
  };
}

/** Lo pagado online que quedó para el comercio (sin lo que hay que devolver) */
const depositKept = (b) => (b.deposit && b.deposit.status === "paid" && !b.deposit.refundNeeded ? Number(b.deposit.paidAmount != null ? b.deposit.paidAmount : b.deposit.amount) || 0 : 0);

/** Recalcula el resumen de un cliente con todos sus turnos. */
async function refreshClient(db, storeId, key, sample) {
  if (!key) return;
  const storeRef = db.collection("ventra_stores").doc(storeId);
  const col = storeRef.collection("bookings");
  // Sin teléfono: por la clave del nombre ("Ana Pérez" y "ana perez" son la misma) y, para los turnos
  // anteriores a customerNameKey, por el nombre tal cual
  const snaps = key.startsWith("p")
    ? [await col.where("customerPhoneKey", "==", key.slice(1)).get()]
    : await Promise.all([col.where("customerNameKey", "==", key.slice(2)).get(), col.where("customerName", "==", (sample && sample.customerName) || "").get()]);
  const byId = new Map();
  for (const s of snaps) for (const d of s.docs) byId.set(d.id, d.data());
  const mine = [...byId.values()].filter((b) => clientKeyOf(b) === key);
  const ref = storeRef.collection("agenda_clients").doc(key);
  const agg = aggregateClient(mine, localNow().dateKey);
  if (!agg) {
    // Sin turnos: se borra, salvo que el dueño le haya dejado una nota
    const cur = await ref.get();
    if (cur.exists && cur.data().note) return ref.set({ visits: 0, noShows: 0, cancelled: 0, spent: 0, next: null, upcoming: [], updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return ref.delete().catch(() => {});
  }
  return ref.set({ ...agg, key, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
}

const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const fmtDay = (dateKey) => { const [, m, d] = dateKey.split("-"); return `${DAYS[weekday(dateKey)]} ${+d}/${+m}`; };

/**
 * Link del turno para el cliente: ver su turno, cambiarlo o cancelarlo él mismo. El corto es
 * ventra.store/<comercio>/turno/<shortCode> (8 caracteres al azar); el de siempre,
 * tienda.ventra.store/<comercio>#turno=<id>.<código>, sigue andando (el id es largo y el código tiene que coincidir).
 * POST { storeId, id, code, action: 'get' | 'cancel' }
 */
async function manage(db, req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Método no permitido" });
  const b = req.body || {};
  const storeId = clean(b.storeId, 80), action = clean(b.action, 10);
  // Link corto (ventra.store/<comercio>/turno/<código de 8>) o el de siempre (#turno=<id>.<código de 4>)
  const link = clean(b.link, 12).toUpperCase();
  let id = clean(b.id, 40), bookingCode = clean(b.code, 8).toUpperCase();
  const bad = () => res.status(400).json({ error: "El link del turno no es válido" });
  if (!/^store_[a-z0-9]{8,64}$|^[A-Za-z0-9_-]{6,80}$/.test(storeId)) return bad();
  const notFound = () => res.status(404).json({ error: "No encontramos ese turno. Revisá el link o escribile al comercio." });
  const bookings = db.collection("ventra_stores").doc(storeId).collection("bookings");
  if (link) {
    if (!/^[A-Z0-9]{8}$/.test(link)) return bad();
    const found = await bookings.where("shortCode", "==", link).limit(1).get();
    if (found.empty) return notFound();
    id = found.docs[0].id; bookingCode = found.docs[0].data().code || "";
  } else if (!/^[A-Za-z0-9]{10,40}$/.test(id) || !/^[A-Z0-9]{4}$/.test(bookingCode)) return bad();
  const ref = bookings.doc(id);
  const snap = await ref.get();
  const t = snap.exists ? snap.data() : null;
  if (!t || t.kind !== "booking" || t.code !== bookingCode) return notFound();
  let awaiting = t.status === "AWAITING_PAYMENT" && !holdExpired(t);
  const upcoming = (t.status === "PENDING" || t.status === "CONFIRMED" || awaiting) && t.startAt && t.startAt.toMillis() > Date.now();
  const view = () => ({
    // Para que la tienda siga con el link de siempre (cancelar, cambiar) aunque haya entrado por el corto
    id: ref.id, code: t.code, ...(t.shortCode ? { link: t.shortCode } : {}),
    serviceId: t.serviceId || "", serviceName: t.serviceName || "", staffId: t.staffId || "", staffName: t.staffName || "", date: t.dateKey, time: hhmm(t.startMin),
    durationMin: Math.max(5, (t.endMin - t.startMin) || Number(t.durationMin) || 30),
    status: holdExpired(t) ? "CANCELLED" : t.status, canCancel: upcoming,
    // Cambiar de horario desde el link: turnos confirmados o por confirmar (no mientras espera el pago)
    canMove: upcoming && (t.status === "PENDING" || t.status === "CONFIRMED"),
    ...(t.deposit ? { deposit: { amount: t.deposit.amount, status: t.deposit.status, full: t.deposit.full !== false, refund: !!t.deposit.refundNeeded }, ...(awaiting && t.deposit.payUrl ? { payUrl: t.deposit.payUrl, holdUntil: t.holdUntil ? t.holdUntil.toMillis() : null } : {}) } : {}),
  });
  if (action === "get") return res.json(view());
  // Volvió de Mercado Pago sin pagar (o salió de la ventana de pago): el horario se libera ya, sin esperar el plazo.
  // Si justo se estaba acreditando, payHook lo reactiva (cancelledBy "unpaid"). No se avisa al dueño: nunca supo de este turno.
  if (action === "abandon") {
    // En una transacción: si payHook acreditó el pago en el medio, no se cancela un turno pagado
    const gone = await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      const c = cur.exists ? cur.data() : null;
      if (!c || c.status !== "AWAITING_PAYMENT" || (c.deposit && c.deposit.status === "paid")) return false;
      tx.update(ref, { status: "CANCELLED", cancelledBy: "unpaid", holdUntil: admin.firestore.FieldValue.delete(), statusAt: admin.firestore.FieldValue.serverTimestamp() });
      return true;
    });
    if (!gone) { const fresh = await ref.get(); Object.assign(t, fresh.data() || {}); awaiting = t.status === "AWAITING_PAYMENT" && !holdExpired(t); return res.json(view()); }
    t.status = "CANCELLED"; delete t.holdUntil; awaiting = false;
    return res.json({ ...view(), canCancel: false, abandoned: true });
  }
  if (action === "reschedule") return reschedule(db, res, storeId, ref, t, b, view);
  if (action !== "cancel") return res.status(400).json({ error: "Acción inválida" });
  if (!upcoming) return res.status(409).json({ error: "Este turno ya no se puede cancelar desde acá. Escribile al comercio." });
  const result = await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    const c = cur.exists ? cur.data() : null;
    if (!c || !(c.status === "PENDING" || c.status === "CONFIRMED" || (c.status === "AWAITING_PAYMENT" && !holdExpired(c)))) return null;
    tx.update(ref, { status: "CANCELLED", cancelledBy: "client", statusAt: admin.firestore.FieldValue.serverTimestamp(), ...cancelRefundPatch(c) });
    return c;
  });
  if (!result) return res.status(409).json({ error: "El turno cambió mientras tanto. Volvé a abrir el link." });
  Object.assign(t, result, { status: "CANCELLED" });
  return res.json({ ...view(), canCancel: false });
}

/**
 * Cancela el cliente (link o WhatsApp): la seña no se devuelve, para eso es; el turno completo pagado online sí
 * queda para devolver (deposit.refundNeeded) y el dueño lo hace desde su Mercado Pago.
 */
function cancelRefundPatch(t) {
  const d = t.deposit;
  return d && d.status === "paid" && d.full !== false ? { "deposit.refundNeeded": true } : {};
}

/**
 * El cliente cambia el horario desde el link de su turno (manage "reschedule", { date, time }).
 * Mismo profesional y servicio; mismas reglas que una reserva nueva (anticipación, días para adelante, horario libre).
 * El recordatorio vuelve a salir para el horario nuevo. El dueño se entera por ventraBookingWritten (movedBy "client").
 */
async function reschedule(db, res, storeId, ref, t, b, view) {
  const upcoming = (t.status === "PENDING" || t.status === "CONFIRMED") && t.startAt && t.startAt.toMillis() > Date.now();
  if (!upcoming) return res.status(409).json({ error: "Este turno ya no se puede cambiar desde acá. Escribile al comercio." });
  const dateKey = clean(b.date, 10), time = clean(b.time, 5);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey) || !/^\d{2}:\d{2}$/.test(time)) return res.status(400).json({ error: "Fecha u hora inválida" });
  const storeRef = db.collection("ventra_stores").doc(storeId);
  const store = await storeRef.get();
  const agenda = store.exists && store.data().agenda;
  if (!agenda || !agenda.enabled) return res.status(409).json({ error: "El comercio no está tomando turnos online. Escribile para cambiarlo." });
  const staff = (agenda.staff || []).find((s) => s.id === t.staffId && s.active !== false);
  if (!staff) return res.status(409).json({ error: "Ese profesional ya no atiende online. Escribile al comercio para cambiarlo." });
  const dur = Math.max(5, (t.endMin - t.startMin) || Number(t.durationMin) || 30);
  const service = { ...((agenda.services || []).find((s) => s.id === t.serviceId) || {}), durationMin: dur };
  const startMin = toMin(time);
  if (dateKey === t.dateKey && startMin === t.startMin) return res.json(view());
  const minStart = minStartFor(agenda, dateKey);
  if (startMin < minStart) return res.status(409).json({ error: "Ese horario ya no se puede reservar. Elegí otro." });
  const moved = await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    const c = cur.exists ? cur.data() : null;
    if (!c || (c.status !== "PENDING" && c.status !== "CONFIRMED") || c.dateKey !== t.dateKey || c.startMin !== t.startMin) return "changed";
    const day = await tx.get(storeRef.collection("bookings").where("dateKey", "==", dateKey));
    const busy = busyOf(day.docs.filter((d) => d.id !== ref.id));
    if (!freeStarts(agenda, staff, service, dateKey, busy, minStart).includes(startMin)) return "busy";
    const del = admin.firestore.FieldValue.delete();
    tx.update(ref, {
      dateKey, startMin, endMin: startMin + dur, startAt: admin.firestore.Timestamp.fromMillis(startAtMs(dateKey, startMin)),
      movedFrom: { dateKey: t.dateKey, startMin: t.startMin }, movedBy: "client", movedAt: admin.firestore.FieldValue.serverTimestamp(),
      // El recordatorio (WhatsApp y email) vuelve a salir para el horario nuevo
      remindedAt: del, reminder: del, emailRemindedAt: del, emailReminder: del, clientConfirmedAt: del,
      statusAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return "ok";
  });
  if (moved === "busy") return res.status(409).json({ error: "Ese horario se acaba de ocupar. Elegí otro." });
  if (moved === "changed") return res.status(409).json({ error: "El turno cambió mientras tanto. Volvé a abrir el link." });
  Object.assign(t, { dateKey, startMin, endMin: startMin + dur });
  return res.json({ ...view(), moved: true });
}

module.exports = { manageLink, shortCode, book, manage, payHook, expireHolds, refreshBusy, refreshClient, clientKeyOf, aggregateClient, hhmm, fmtDay, freeStarts, minStartFor, dayRanges, localNow, addDays, weekday, startAtMs, arNational, phoneKeyOf, cancelRefundPatch, paidOutcome, clientIp, depositFor };
