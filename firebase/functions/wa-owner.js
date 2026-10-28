// ═══════════════════════════════════════════════════
// El dueño le pregunta a Ventra por WhatsApp ("¿cuánto vendí hoy?", "¿me quedan Coca?").
//
// - Vincular: desde la app el dueño pide un código (linkCode) y manda "VINCULAR ABC123" al
//   número de Ventra. Ese mensaje prueba que el teléfono es suyo: queda en
//   ventra_wa_owners/{teléfono} = { uid }. Solo ese teléfono recibe datos del comercio.
// - Preguntar: el webhook (whatsapp.hook) deja cada mensaje del dueño en ventra_wa_owner_inbox
//   y contesta enseguida a Meta; processInbox elige las consultas con la IA (ai.js, mismo tope
//   que "Preguntale a tu negocio"), las corre sobre la réplica en Neon (insights-cloud.js) y
//   responde. Si el dueño escribió, la respuesta dentro de las 24 h no la cobra Meta.
// ═══════════════════════════════════════════════════
const crypto = require("crypto");
const insights = require("./insights-cloud");
const { GRACE_DAYS, DAY_MS } = require("./subscription-rules");

/** Número de WhatsApp de Ventra (el de los recordatorios de turnos) */
const VENTRA_WA = "5492212048533";
const CODE_TTL_MS = 15 * 60 * 1000;
// Sin letras que se confunden (0/O, 1/I/L)
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** Si la última sincronización es más vieja que esto, la respuesta lo aclara */
const STALE_MS = 15 * 60 * 1000;
const TZ = "America/Argentina/Buenos_Aires";

const OWNERS = "ventra_wa_owners";
const LINKS = "ventra_wa_links";
const INBOX = "ventra_wa_owner_inbox";

const ms = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : Number(t) || 0);
const masked = (phone) => { const d = String(phone || ""); return d.length > 4 ? `•••• ${d.slice(-4)}` : d; };
const EXAMPLES = "Por ejemplo:\n- ¿Cuánto vendí hoy?\n- ¿Cuántas Coca de 1,5 me quedan?\n- ¿Qué tengo que reponer?\n- ¿Quién me debe plata?\n- ¿Cómo viene la caja?";

/** Código para vincular el WhatsApp del dueño (vale 15 minutos) y el link que lo manda solo */
async function linkCode(db, uid, now = Date.now()) {
  let code = "";
  for (let i = 0; i < 6; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  await db.collection(LINKS).doc(code).set({ uid, expiresAt: now + CODE_TTL_MS });
  return { code, number: VENTRA_WA, link: `https://wa.me/${VENTRA_WA}?text=${encodeURIComponent(`VINCULAR ${code}`)}`, expiresInMin: CODE_TTL_MS / 60000 };
}

async function ownersOf(db, uid) {
  const snap = await db.collection(OWNERS).where("uid", "==", uid).get();
  return snap.docs;
}

async function status(db, uid) {
  const docs = await ownersOf(db, uid);
  if (!docs.length) return { linked: false, number: VENTRA_WA };
  const d = docs[0].data();
  return { linked: true, phone: masked(docs[0].id), linkedAt: ms(d.linkedAt) || null, questions: Number(d.questions) || 0, number: VENTRA_WA };
}

async function unlink(db, uid) {
  const docs = await ownersOf(db, uid);
  await Promise.all(docs.map((d) => d.ref.delete()));
  return { linked: false };
}

/** Cuenta con plan vigente (o en los días de gracia) */
async function planActive(db, uid, now) {
  const acc = await db.collection("ventra_accounts").doc(uid).get();
  if (!acc.exists) return false;
  const paidUntil = ms(acc.data().paidUntil);
  return paidUntil + GRACE_DAYS * DAY_MS >= now;
}

/**
 * Un mensaje que llegó al número de Ventra. Devuelve true si era del dueño (o para vincularlo)
 * y ya quedó atendido; false para que siga como antes (clientes de la agenda).
 */
async function onMessage(db, send, m, now = Date.now()) {
  const from = String(m.from || "");
  const text = m.type === "text" && m.text ? String(m.text.body || "").trim() : "";
  const link = /^vincular\s+([a-z0-9]{6})\b/i.exec(text);
  if (link) {
    const ref = db.collection(LINKS).doc(link[1].toUpperCase());
    const snap = await ref.get();
    if (!snap.exists || Number(snap.data().expiresAt) < now) {
      await send(from, "Ese código ya venció o no es válido. Pedí uno nuevo en Ventra: *Preguntale a tu negocio → Preguntar por WhatsApp*.");
      return true;
    }
    const { uid } = snap.data();
    // Un teléfono por cuenta: el nuevo reemplaza al anterior
    for (const old of await ownersOf(db, uid)) if (old.id !== from) await old.ref.delete();
    await db.collection(OWNERS).doc(from).set({ uid, linkedAt: now, questions: 0 });
    await ref.delete();
    await send(from, `¡Listo! Ya podés preguntarme por tu negocio cuando quieras.\n\n${EXAMPLES}\n\nPara dejar de usarlo, mandá *DESVINCULAR*.`);
    return true;
  }

  const owner = await db.collection(OWNERS).doc(from).get();
  if (!owner.exists) return false;
  if (/^desvincular$/i.test(text)) {
    await owner.ref.delete();
    await send(from, "Listo, este WhatsApp ya no está vinculado a tu negocio. Para volver a usarlo, vinculalo de nuevo desde Ventra.");
    return true;
  }
  if (!text) {
    await send(from, "Por ahora solo entiendo mensajes escritos. Escribime tu pregunta, por ejemplo: ¿cuánto vendí hoy?");
    return true;
  }
  // Se contesta en processInbox: Meta pide la respuesta del webhook en pocos segundos.
  // El id es el del mensaje: si Meta reintenta, no se responde dos veces.
  const id = String(m.id || `${from}-${now}`).replace(/[^\w.-]/g, "_").slice(0, 150);
  try {
    await db.collection(INBOX).doc(id).create({ from, uid: owner.data().uid, text: text.slice(0, 500), at: now });
  } catch (err) {
    if (!/already exists|ALREADY_EXISTS/i.test(String(err && err.message)) && Number(err && err.code) !== 6) throw err;
  }
  return true;
}

/** WhatsApp usa un asterisco para la negrita: lo que llegue con dos se corrige */
const waFormat = (s) => String(s || "").replace(/\*\*(.+?)\*\*/g, "*$1*").replace(/^#+\s*/gm, "").trim();

function freshnessNote(lastSyncIso, now) {
  if (!lastSyncIso) return "\n\n_Todavía no llegaron datos de tu caja a la nube: revisá que la PC esté vinculada y con internet._";
  const t = Date.parse(lastSyncIso);
  if (now - t < STALE_MS) return "";
  const when = new Date(t).toLocaleString("es-AR", { timeZone: TZ, day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" });
  return `\n\n_Datos hasta el ${when}, lo último que mandó tu caja (si la PC está sin internet, lo nuevo llega cuando vuelva)._`;
}

/**
 * Responde una pregunta del dueño. deps: { ai, aiDeps (lo que pide ai.handle), sql, send, logger }.
 * Si algo falla, el dueño recibe un mensaje claro en vez de silencio.
 */
async function processInbox(db, item, deps, now = Date.now()) {
  const { from, uid, text } = item;
  const { ai, aiDeps, sql, send, logger } = deps;
  try {
    if (!(await planActive(db, uid, now))) {
      return send(from, "Tu plan de Ventra está vencido, así que no puedo leer los datos de tu negocio. Renovalo desde Ventra y seguimos.");
    }
    const ownerRef = db.collection(OWNERS).doc(from);
    const owner = await ownerRef.get();
    // Se desvinculó (o vinculó otro teléfono) entre que llegó el mensaje y ahora
    if (!owner.exists || owner.data().uid !== uid) return null;
    const prev = owner.data();
    const previous = prev.lastQuestion && now - ms(prev.lastAt) < 30 * 60 * 1000 ? prev.lastQuestion : "";

    const plan = await ai.handle(aiDeps, uid, { kind: "ask", step: "plan", channel: "whatsapp", question: text, previous });
    const queries = (plan.result && plan.result.queries) || [];
    let answer;
    if (!queries.length) {
      answer = String((plan.result && plan.result.noSePuede) || "Eso no lo puedo responder con los datos de tu negocio.");
    } else {
      const [data, last] = await Promise.all([insights.runQueries(sql, uid, queries, logger), insights.lastSync(sql, uid)]);
      const out = await ai.handle(aiDeps, uid, { kind: "ask", step: "answer", channel: "whatsapp", question: text, previous, data });
      answer = waFormat(out.result && out.result.answer) + freshnessNote(last, now);
    }
    await ownerRef.set({ lastQuestion: text, lastAt: now, questions: (Number(prev.questions) || 0) + 1 }, { merge: true });
    return send(from, answer.slice(0, 4000));
  } catch (err) {
    // Topes y errores de la IA: su mensaje ya está escrito para el dueño
    if (ai && ai.AiError && err instanceof ai.AiError) return send(from, err.message);
    if (logger) logger.error(`Preguntas por WhatsApp: error (${uid})`, err);
    return send(from, "No pude responderte ahora. Probá de nuevo en un rato.");
  }
}

module.exports = { linkCode, status, unlink, onMessage, processInbox, waFormat, VENTRA_WA, OWNERS, LINKS, INBOX };
