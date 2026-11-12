// ═══════════════════════════════════════════════════
// Soporte de Ventra por WhatsApp, en el número del bot (el mismo de los recordatorios y del dueño).
//
// - Le escribe alguien que no es un dueño vinculado ni cliente de un turno: contesta la IA con la base
//   de conocimiento de la web (chat.js) y cada respuesta trae el botón "Hablar con una persona".
// - Si toca el botón o escribe algo como "quiero hablar con una persona", la conversación pasa a modo
//   persona: el bot deja de contestar, se avisa por mail al administrador y se responde desde el admin.
//   Vuelve sola al bot a las 48 h sin movimiento, o cuando el admin la devuelve.
// - Tope de respuestas automáticas por número y por día (DAILY_LIMIT): al llegar, se ofrece la persona.
// - Todo queda en ventra_support/{teléfono} (+ messages): el admin ve y responde desde ahí. WhatsApp
//   solo deja escribirle a alguien dentro de las 24 h de su último mensaje.
// El webhook (whatsapp.js) solo anota y encola en ventra_support_inbox; la IA contesta en ventraSupportInbox.
// ═══════════════════════════════════════════════════
const SUPPORT = "ventra_support";
/** A quién se avisa (mail + notificación de la app de Ventra) cuando alguien pide una persona */
const ALERT_EMAILS = ["juanhidalgobass@gmail.com", "ventra.gestion@gmail.com"];
/** Para escribirle pasadas las 24 h WhatsApp exige una plantilla aprobada por Meta: {{1}} = nombre o "¿cómo estás?".
 *  Texto sugerido para crearla (categoría Utilidad, español de Argentina):
 *  "Hola {{1}}, te escribimos de Ventra por la consulta que nos dejaste. Respondé este mensaje y seguimos por acá."
 *  Apagada hasta que esté aprobada: enabled true. */
const REOPEN_TEMPLATE = { name: "retomar_consulta", lang: "es_AR", enabled: false };
/** Recordatorio si nadie respondió: cuando faltan 4 h para que se cierren las 24 h */
const REMIND_AFTER_MS = 20 * 3600 * 1000;
const INBOX = "ventra_support_inbox";
const DAILY_LIMIT = 15;
const HUMAN_TTL_MS = 48 * 3600 * 1000;
const WINDOW_MS = 24 * 3600 * 1000;
const HISTORY = 12;
const BTN_HUMAN = { id: "sp|humano", title: "Hablar con persona" };
const BTN_BOT = { id: "sp|bot", title: "Seguir con el bot" };
const HUMAN_RE = /\b(hablar|comunicarme|atender|atienda|atiende|contactar)\b.{0,30}\b(persona|humano|alguien|asesor|vendedor|equipo)\b|\b(persona real|un humano|asesor humano|atenci[oó]n humana)\b/i;
const HELLO = "¡Hola! Soy el asistente de Ventra. Contame qué negocio tenés o qué querés saber y te ayudo. Si preferís hablar con una persona del equipo, tocá el botón.";

const ms = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : Number(t) || 0);
const dayKey = (nowMs) => new Date(nowMs - 3 * 3600e3).toISOString().slice(0, 10);
const clip = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").trim().slice(0, n);
/** ¿Está esperando a una persona? (pidió persona hace menos de 48 h, o el admin la tomó) */
const isHuman = (conv, nowMs) => !!(conv && conv.mode === "human" && nowMs - Math.max(ms(conv.humanAt), ms(conv.lastAdminAt), ms(conv.lastInboundAt)) < HUMAN_TTL_MS);
/** WhatsApp usa *negrita* con un asterisco; la IA escribe **negrita**. */
const waFormat = (s) => String(s || "").replace(/\*\*(.+?)\*\*/g, "*$1*").replace(/^#+\s*/gm, "").trim();

/** Qué hacer con un mensaje entrante. Pura. → "human" | "bot" | "media" | "ignore" | "to_bot" */
function decide(m, conv, nowMs) {
  const payload = String((m.interactive && m.interactive.button_reply && m.interactive.button_reply.id) || (m.button && m.button.payload) || "");
  if (payload === BTN_HUMAN.id) return "human";
  if (payload === BTN_BOT.id) return "to_bot";
  const text = m.type === "text" && m.text ? String(m.text.body || "") : "";
  if (text && HUMAN_RE.test(text)) return "human";
  if (isHuman(conv, nowMs)) return "ignore";
  if (!text) return "media";
  return "bot";
}

/** Texto que se guarda de un mensaje entrante */
function inboundText(m) {
  if (m.type === "text" && m.text) return clip(m.text.body, 2000);
  const payload = (m.interactive && m.interactive.button_reply && m.interactive.button_reply.title) || (m.button && m.button.text);
  if (payload) return `[Botón] ${clip(payload, 60)}`;
  return { audio: "[Audio]", image: "[Foto]", video: "[Video]", document: "[Archivo]", sticker: "[Sticker]", location: "[Ubicación]" }[m.type] || `[${m.type || "mensaje"}]`;
}

async function addMessage(db, admin, phone, msg, id) {
  const col = db.collection(SUPPORT).doc(phone).collection("messages");
  const data = { ...msg, at: admin.firestore.Timestamp.fromMillis(msg.at) };
  if (!id) return col.add(data);
  try { await col.doc(id).create(data); return true; } catch (err) {
    if (/already exists|ALREADY_EXISTS/i.test(String(err && err.message)) || Number(err && err.code) === 6) return false;
    throw err;
  }
}

/**
 * Lo llama el webhook para alguien que no es dueño vinculado. false = no es de soporte (cliente de un turno:
 * sigue el aviso de siempre). io: { admin, sendText, sendButtons, name, notifyHuman?(conv) }
 */
async function onMessage(db, m, io, nowMs = Date.now()) {
  const phone = String(m.from || "");
  if (!phone) return false;
  const { admin } = io;
  const ref = db.collection(SUPPORT).doc(phone);
  const [convSnap, contact] = await Promise.all([ref.get(), db.collection("ventra_wa_contacts").doc(phone).get()]);
  const conv = convSnap.exists ? convSnap.data() : null;
  // Cliente de un comercio (le llegan los recordatorios de turnos) que nunca habló con soporte: no es nuestro
  const payload = String((m.interactive && m.interactive.button_reply && m.interactive.button_reply.id) || "");
  if (contact.exists && !conv && !payload.startsWith("sp|") && !(m.type === "text" && HUMAN_RE.test(String((m.text && m.text.body) || "")))) return false;
  const id = String(m.id || `${phone}-${nowMs}`).replace(/[^\w.-]/g, "_").slice(0, 150);
  const fresh = await addMessage(db, admin, phone, { dir: "in", text: inboundText(m), type: m.type || "text", at: nowMs }, id);
  if (!fresh) return true; // Meta reintentó un mensaje ya anotado
  const T = admin.firestore.Timestamp.fromMillis(nowMs);
  const base = { phone, lastAt: T, lastInboundAt: T, lastText: inboundText(m).slice(0, 160), lastDir: "in", unread: admin.firestore.FieldValue.increment(1), ...(io.name ? { name: clip(io.name, 60) } : {}), ...(conv ? {} : { createdAt: T, mode: "bot" }) };
  const action = decide(m, conv, nowMs);
  const say = async (text, buttons) => {
    if (buttons) await io.sendButtons(phone, text, buttons); else await io.sendText(phone, text);
    await addMessage(db, admin, phone, { dir: "out", by: "bot", text, at: nowMs + 1 });
    await ref.set({ lastAt: admin.firestore.Timestamp.fromMillis(nowMs + 1), lastText: text.slice(0, 160), lastDir: "out" }, { merge: true });
  };
  if (action === "human") {
    const already = isHuman(conv, nowMs);
    await ref.set({ ...base, mode: "human", humanAt: T, ...(already ? {} : { humanRequests: admin.firestore.FieldValue.increment(1) }) }, { merge: true });
    if (!already) {
      await say("Listo, ya le aviso a una persona del equipo de Ventra y te responde por acá lo antes posible. Mientras tanto, contanos tu consulta así ya la tenemos.");
      if (io.notifyHuman) await Promise.resolve(io.notifyHuman({ ...(conv || {}), ...base, phone })).catch(() => {});
    }
    return true;
  }
  if (action === "to_bot") {
    await ref.set({ ...base, mode: "bot" }, { merge: true });
    await say("Dale, sigo yo. ¿En qué te ayudo?");
    return true;
  }
  await ref.set(base, { merge: true });
  if (action === "ignore") return true;
  if (action === "media") {
    await say("Por ahora leo solo mensajes escritos. Contame por escrito qué necesitás, o tocá el botón y te atiende una persona del equipo.", [BTN_HUMAN]);
    return true;
  }
  // Primer mensaje: se saluda y la IA contesta igual (lo hace la bandeja, que tiene tiempo)
  await db.collection(INBOX).doc(id).set({ phone, at: nowMs, first: !conv });
  return true;
}

/** Historia para la IA: últimos mensajes, alternando usuario y asistente, empezando por el usuario. Pura. */
function history(messages) {
  const out = [];
  for (const x of messages) {
    const role = x.dir === "in" ? "user" : "assistant";
    const text = clip(x.text, role === "user" ? 1000 : 2000);
    if (!text) continue;
    if (out.length && out[out.length - 1].role === role) out[out.length - 1].content += `\n${text}`;
    else out.push({ role, content: text });
  }
  while (out.length && out[0].role !== "user") out.shift();
  while (out.length && out[out.length - 1].role !== "user") out.pop();
  return out;
}

/**
 * Contesta con la IA un mensaje encolado. deps: { admin, answer(messages) → Promise<string|null>, sendText, sendButtons, now? }
 */
async function processInbox(db, item, deps) {
  const now = deps.now || Date.now();
  const { admin } = deps;
  const ref = db.collection(SUPPORT).doc(item.phone);
  const snap = await ref.get();
  const conv = snap.exists ? snap.data() : {};
  if (isHuman(conv, now)) return "human";
  // Si ya llegó otro mensaje después, contesta ese (así una ráfaga de mensajes recibe una sola respuesta)
  if (ms(conv.lastInboundAt) > Number(item.at) + 500) return "superseded";
  const day = dayKey(now);
  const used = conv.daily && conv.daily.day === day ? Number(conv.daily.n) || 0 : 0;
  const say = async (text, buttons, by = "bot") => {
    if (buttons) await deps.sendButtons(item.phone, text, buttons); else await deps.sendText(item.phone, text);
    await addMessage(db, admin, item.phone, { dir: "out", by, text, at: now });
    await ref.set({ lastAt: admin.firestore.Timestamp.fromMillis(now), lastText: text.slice(0, 160), lastDir: "out" }, { merge: true });
  };
  if (used >= DAILY_LIMIT) {
    if (conv.limitNotified !== day) {
      await say("Por hoy llegamos al máximo de respuestas automáticas. Si querés seguir, tocá el botón y te atiende una persona del equipo, o escribime mañana.", [BTN_HUMAN]);
      await ref.set({ limitNotified: day }, { merge: true });
    }
    return "limit";
  }
  const msgs = await ref.collection("messages").orderBy("at", "desc").limit(HISTORY).get();
  const messages = history(msgs.docs.map((d) => d.data()).reverse());
  if (!messages.length) return "empty";
  let reply = null;
  try { reply = await deps.answer(messages); } catch { reply = null; }
  await ref.set({ daily: { day, n: used + 1 } }, { merge: true });
  if (!reply) {
    await say("Uy, ahora no pude responderte. Tocá el botón y te atiende una persona del equipo.", [BTN_HUMAN]);
    return "fallback";
  }
  reply = waFormat(reply);
  if (item.first) reply = `${HELLO.split(".")[0]}. ${reply}`;
  // El cuerpo de un mensaje con botones admite hasta 1024 caracteres
  if (reply.length <= 1000) await say(reply, [BTN_HUMAN]);
  else { await say(reply); await say("¿Querés hablar con una persona del equipo?", [BTN_HUMAN]); }
  return "answered";
}

// ─── Admin ───

const iso = (t) => (ms(t) ? new Date(ms(t)).toISOString() : null);
/** Conversaciones: primero las que esperan a una persona, después las más recientes. */
async function list(db, nowMs = Date.now()) {
  const snap = await db.collection(SUPPORT).orderBy("lastAt", "desc").limit(80).get();
  const items = snap.docs.map((d) => {
    const c = d.data();
    return {
      phone: d.id, name: c.name || null, lastText: c.lastText || "", lastDir: c.lastDir || "in", lastAt: iso(c.lastAt),
      unread: Number(c.unread) || 0, waiting: isHuman(c, nowMs), canReply: nowMs - ms(c.lastInboundAt) < WINDOW_MS,
      today: c.daily && c.daily.day === dayKey(nowMs) ? Number(c.daily.n) || 0 : 0,
    };
  });
  items.sort((a, b) => Number(b.waiting) - Number(a.waiting));
  return { items, dailyLimit: DAILY_LIMIT, waiting: items.filter((x) => x.waiting).length };
}

async function thread(db, phone, nowMs = Date.now()) {
  const ref = db.collection(SUPPORT).doc(String(phone));
  const [snap, msgs] = await Promise.all([ref.get(), ref.collection("messages").orderBy("at", "desc").limit(150).get()]);
  if (!snap.exists) return null;
  const c = snap.data();
  if (c.unread) await ref.set({ unread: 0 }, { merge: true });
  return {
    phone: snap.id, name: c.name || null, waiting: isHuman(c, nowMs), canReply: nowMs - ms(c.lastInboundAt) < WINDOW_MS, lastInboundAt: iso(c.lastInboundAt),
    // Pasadas las 24 h: retomar con la plantilla (si está aprobada) y si no se mandó ya
    reopenPending: ms(c.reopenAt) > ms(c.lastInboundAt), reopenReady: REOPEN_TEMPLATE.enabled,
    messages: msgs.docs.map((d) => { const x = d.data(); return { dir: x.dir, by: x.by || null, text: x.text, at: iso(x.at), admin: x.admin || null }; }).reverse(),
  };
}

/** Responder desde el admin. Toma la conversación (el bot no contesta hasta devolverla o 48 h). */
async function reply(db, { phone, text, adminEmail, admin, sendText, now = Date.now() }) {
  const body = clip(text, 4000);
  if (!body) throw Object.assign(new Error("Escribí un mensaje"), { status: 400 });
  const ref = db.collection(SUPPORT).doc(String(phone));
  const snap = await ref.get();
  if (!snap.exists) throw Object.assign(new Error("No existe esa conversación"), { status: 404 });
  if (now - ms(snap.data().lastInboundAt) >= WINDOW_MS) {
    throw Object.assign(new Error("Pasaron más de 24 h desde su último mensaje: WhatsApp no deja escribirle primero. Cuando te vuelva a escribir, le podés responder."), { status: 409 });
  }
  await sendText(String(phone), body);
  await addMessage(db, admin, String(phone), { dir: "out", by: "admin", admin: adminEmail || null, text: body, at: now });
  const T = admin.firestore.Timestamp.fromMillis(now);
  await ref.set({ mode: "human", lastAdminAt: T, lastAt: T, lastText: body.slice(0, 160), lastDir: "out", unread: 0 }, { merge: true });
  return { ok: true };
}

/** Pasadas las 24 h: le manda la plantilla para retomar. Cuando responde, se reabren las 24 h. */
async function reopen(db, { phone, adminEmail, admin, sendTemplate, now = Date.now() }) {
  if (!REOPEN_TEMPLATE.enabled) throw Object.assign(new Error("Falta que Meta apruebe la plantilla \"retomar_consulta\" para escribirle pasadas las 24 h."), { status: 409 });
  const ref = db.collection(SUPPORT).doc(String(phone));
  const snap = await ref.get();
  if (!snap.exists) throw Object.assign(new Error("No existe esa conversación"), { status: 404 });
  const c = snap.data();
  if (ms(c.reopenAt) > ms(c.lastInboundAt)) throw Object.assign(new Error("Ya le mandaste el mensaje para retomar: esperá a que responda."), { status: 409 });
  const first = String(c.name || "").trim().split(/\s+/)[0];
  await sendTemplate(String(phone), REOPEN_TEMPLATE, [first && first.length <= 20 ? first : "¿cómo estás?"]);
  const text = `[Plantilla] Hola ${first || "¿cómo estás?"}, te escribimos de Ventra por la consulta que nos dejaste. Respondé este mensaje y seguimos por acá.`;
  await addMessage(db, admin, String(phone), { dir: "out", by: "admin", admin: adminEmail || null, text, at: now });
  const T = admin.firestore.Timestamp.fromMillis(now);
  await ref.set({ mode: "human", reopenAt: T, lastAdminAt: T, lastAt: T, lastText: text.slice(0, 160), lastDir: "out" }, { merge: true });
  return { ok: true };
}

/** Conversaciones esperando a una persona sin respuesta, a las que les quedan 4 h o menos. Pura. */
function dueReminders(convs, nowMs) {
  return convs.filter((c) => {
    const inbound = ms(c.lastInboundAt);
    if (c.mode !== "human" || !inbound) return false;
    if (ms(c.lastAdminAt) >= inbound) return false; // ya le respondieron
    const age = nowMs - inbound;
    return age >= REMIND_AFTER_MS && age < WINDOW_MS && ms(c.remindedFor) !== inbound;
  });
}

/** Cada media hora: avisa de las que están por vencer. deps: { admin, alert(conv, kind), now? } */
async function remindersRun(db, deps) {
  const now = deps.now || Date.now();
  const snap = await db.collection(SUPPORT).where("mode", "==", "human").get();
  const due = dueReminders(snap.docs.map((d) => ({ phone: d.id, ...d.data() })), now);
  for (const c of due) {
    await db.collection(SUPPORT).doc(c.phone).set({ remindedFor: c.lastInboundAt }, { merge: true });
    await Promise.resolve(deps.alert(c, "remind")).catch(() => {});
  }
  return due.length;
}

/** Texto del aviso al equipo. kind: "new" (pidió persona) o "remind" (quedan 4 h). Pura. */
function alertText(c, kind, nowMs = Date.now()) {
  const who = c.name ? `${c.name} (+${c.phone})` : `+${c.phone}`;
  if (kind === "remind") {
    const left = Math.max(1, Math.round((ms(c.lastInboundAt) + WINDOW_MS - nowMs) / 3600e3));
    return { title: `Quedan ${left} h para responderle a ${who}`, body: `Pidió hablar con una persona y nadie le respondió. Último mensaje: “${String(c.lastText || "").slice(0, 120)}”` };
  }
  if (kind === "first") return { title: `Nuevo en el WhatsApp de Ventra: ${who}`, body: `“${String(c.lastText || "").slice(0, 160)}”` };
  if (kind === "msg") return { title: `${who} escribió al bot`, body: `“${String(c.lastText || "").slice(0, 160)}”` };
  if (kind === "test") return { title: "Prueba: así te llegan los avisos del bot", body: "Cada vez que alguien le escriba al WhatsApp de Ventra te llega un aviso como este, aunque no pida hablar con una persona." };
  return { title: `${who} quiere hablar con una persona`, body: `Último mensaje: “${String(c.lastText || "").slice(0, 120)}”` };
}

/**
 * Qué aviso corresponde a un cambio de ventra_support/{tel} (o null). Pura.
 * Se avisa SIEMPRE que entra un mensaje (no solo cuando pide una persona): "new" si además pidió una
 * persona, "first" si es la primera vez que escribe, "msg" en el resto. Las respuestas del bot o del admin
 * no cambian lastInboundAt, así que no avisan.
 */
function alertKind(before, after) {
  if (!after) return null;
  if ((Number(after.humanRequests) || 0) > (Number((before && before.humanRequests)) || 0)) return "new";
  const inAfter = ms(after.lastInboundAt), inBefore = ms(before && before.lastInboundAt);
  if (!inAfter || inAfter <= inBefore) return null;
  return inBefore ? "msg" : "first";
}

/** El admin devuelve la conversación al bot (o la toma sin escribir). */
async function setMode(db, { phone, mode, admin, now = Date.now() }) {
  if (mode !== "bot" && mode !== "human") throw Object.assign(new Error("Modo inválido"), { status: 400 });
  const T = admin.firestore.Timestamp.fromMillis(now);
  await db.collection(SUPPORT).doc(String(phone)).set(mode === "human" ? { mode, lastAdminAt: T } : { mode }, { merge: true });
  return { ok: true };
}

module.exports = {
  SUPPORT, INBOX, DAILY_LIMIT, BTN_HUMAN, BTN_BOT, HUMAN_RE, ALERT_EMAILS, REOPEN_TEMPLATE,
  decide, isHuman, history, waFormat, onMessage, processInbox, list, thread, reply, reopen, setMode, dueReminders, remindersRun, alertText, alertKind,
};
