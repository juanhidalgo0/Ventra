// ═══════════════════════════════════════════════════
// El dueño (y, si él lo permite, sus encargados) le pregunta a Ventra por WhatsApp.
//
// - Vincular: desde la app se pide un código (linkCode) y se manda "VINCULAR ABC123" al número
//   de Ventra. Ese mensaje prueba que el teléfono es de esa persona: queda en
//   ventra_wa_owners/{teléfono} = { uid, userId, role, name }. Un teléfono por usuario.
//   Los encargados solo pueden si el dueño lo habilitó (ventra_wa_settings/{uid}.supervisors).
// - Preguntar: el webhook (whatsapp.hook) deja cada mensaje en ventra_wa_owner_inbox y contesta
//   enseguida a Meta; processInbox responde con la IA con herramientas (ai-agent.js, mismo cupo
//   que "Preguntale a tu negocio") sobre la réplica en Neon. Las respuestas dentro de las 24 h
//   de un mensaje de la persona no las cobra Meta.
// - Resumen del día a pedido ("resumen a las 21"): dailySummaries, cada hora. Fuera de las 24 h
//   va con la plantilla resumen_diario (Meta la cobra, ~USD 0,026).
// ═══════════════════════════════════════════════════
const crypto = require("crypto");
const insights = require("./insights-cloud");
const agent = require("./ai-agent");
const dashboard = require("./dashboard");
const { GRACE_DAYS, DAY_MS } = require("./subscription-rules");
const edits = require("./wa-owner-edits");
const menu = require("./wa-owner-menu");
const cleanup = require("./wa-owner-cleanup");
const invoice = require("./wa-owner-invoice");
// Comandos de la limpieza de repetidos
const SEPARAR_RE = /^separar(?:\s+(\d{1,2}))?[.!]*$/i;
const JUNTADOS_RE = /^(?:juntados|productos juntados|ver juntados|ocultos)[.!]*$/i;
const PARAR_RE = /^(?:parar|para|basta|despues|después|despues sigo|después sigo|frenar)[.!]*$/i;
const KEEP_RE = /^(?:queda|que quede|dej[aá]|dejá)\s+(?:el\s+)?(\d)[.!]*$/i;
const BOLETA_RE = /\b(boleta|factura|remito|compra|proveedor)\b/i;
// Imágenes (sharp, Chromium): se cargan recién cuando se usan, así una pregunta común arranca rápido
let promoMod = null, brandMod = null;
const promo = new Proxy({}, { get: (t, k) => (promoMod || (promoMod = require("./promo-images")))[k] });
const brandKit = new Proxy({}, { get: (t, k) => (brandMod || (brandMod = require("./promo-images/brand")))[k] });
const ventraApi = require("./ventra-api");
const stats = require("./wa-owner-stats");

/** Cuánto tiempo después de mandar imágenes se puede elegir escribiendo "la 2" */
const PICK_MS = 3 * 60 * 60 * 1000;
/** Cuánto vale una foto que mandó como "la última foto" (para usarla de logo o de producto) */
const PHOTO_MS = 2 * 60 * 60 * 1000;
/** Fotos que llegan seguidas: se espera este rato a que lleguen las demás del mismo envío */
const PHOTO_BATCH_WAIT_MS = 8000;
/** Una foto nueva se suma al envío anterior si llegó dentro de este rato y todavía no se leyó */
const PHOTO_BATCH_GAP_MS = 90 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Suma la foto al envío en curso (o arranca uno nuevo). boleta: el texto de alguna dice "boleta", "factura"… */
async function addToPhotoBatch(db, ownerRef, path, boleta, now) {
  const apply = (cur) => {
    const open = cur && !cur.done && now - Number(cur.lastAt || 0) < PHOTO_BATCH_GAP_MS;
    const base = open ? cur : { id: `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`, paths: [], boleta: false };
    return { ...base, paths: [...base.paths.filter((p) => p !== path), path], lastPath: path, lastAt: now, boleta: !!(base.boleta || boleta), done: false };
  };
  // Las fotos de un álbum llegan casi juntas: con transacción no se pisa ninguna
  if (db.runTransaction) {
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ownerRef);
      const next = apply(((snap.exists ? snap.data() : {}) || {}).photoBatch);
      tx.set(ownerRef, { photoBatch: next }, { merge: true });
      return next;
    });
  }
  const next = apply(((await ownerRef.get()).data() || {}).photoBatch);
  await ownerRef.set({ photoBatch: next }, { merge: true });
  return next;
}

/** Número de WhatsApp de Ventra (el de los recordatorios de turnos) */
const VENTRA_WA = "5492212048533";
const CODE_TTL_MS = 15 * 60 * 1000;
// Sin letras que se confunden (0/O, 1/I/L)
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** Si la última sincronización es más vieja que esto, la respuesta lo aclara */
const STALE_MS = 15 * 60 * 1000;
/** Meta deja responder gratis y sin plantilla hasta 24 h después del último mensaje de la persona */
const WINDOW_MS = 23.5 * 60 * 60 * 1000;
const SUMMARY_TEMPLATE = { name: "resumen_diario", lang: "es_AR" };
const TZ = "America/Argentina/Buenos_Aires";

const OWNERS = "ventra_wa_owners";
const LINKS = "ventra_wa_links";
const INBOX = "ventra_wa_owner_inbox";
const SETTINGS = "ventra_wa_settings";

const ms = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : Number(t) || 0);
const masked = (phone) => { const d = String(phone || ""); return d.length > 4 ? `•••• ${d.slice(-4)}` : d; };
const money = (n) => `$ ${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;
const localHour = (now) => Number(new Date(now).toLocaleString("en-US", { timeZone: TZ, hour: "numeric", hourCycle: "h23" }));

async function supervisorsAllowed(db, uid) {
  const s = await db.collection(SETTINGS).doc(uid).get();
  return !!(s.exists && s.data().supervisors);
}

/**
 * Código para vincular un WhatsApp (vale 15 minutos) y el link que lo manda solo.
 * who: { userId, role, name } de quien lo pide en la app.
 */
async function linkCode(db, uid, who = {}, now = Date.now()) {
  const role = who.role === "SUPERVISOR" ? "SUPERVISOR" : "ADMIN";
  if (role === "SUPERVISOR" && !(await supervisorsAllowed(db, uid))) {
    throw Object.assign(new Error("El dueño todavía no habilitó que los encargados le pregunten a Ventra por WhatsApp."), { status: 403 });
  }
  let code = "";
  for (let i = 0; i < 6; i++) code += ALPHABET[crypto.randomInt(ALPHABET.length)];
  await db.collection(LINKS).doc(code).set({ uid, userId: who.userId || null, role, name: who.name || null, expiresAt: now + CODE_TTL_MS });
  return { code, number: VENTRA_WA, link: `https://wa.me/${VENTRA_WA}?text=${encodeURIComponent(`VINCULAR ${code}`)}`, expiresInMin: CODE_TTL_MS / 60000 };
}

async function phonesOf(db, uid) {
  const snap = await db.collection(OWNERS).where("uid", "==", uid).get();
  return snap.docs;
}
// Vinculaciones viejas (antes de los encargados) no tienen userId: son del dueño
const isMine = (d, who) => (who.role === "SUPERVISOR" ? d.data().userId === who.userId : d.data().role !== "SUPERVISOR" && (!d.data().userId || !who.userId || d.data().userId === who.userId));

/** Lo que ve cada uno en la app: su teléfono; el dueño, además, los encargados y el permiso */
async function status(db, uid, who = {}) {
  const docs = await phonesOf(db, uid);
  const mine = docs.find((d) => isMine(d, who));
  const d = mine ? mine.data() : null;
  const out = {
    linked: !!mine, number: VENTRA_WA,
    ...(mine ? { phone: masked(mine.id), linkedAt: ms(d.linkedAt) || null, questions: Number(d.questions) || 0, summary: d.summary || { enabled: false, hour: 21 } } : {}),
    supervisorsAllowed: await supervisorsAllowed(db, uid),
  };
  if (who.role !== "SUPERVISOR") {
    out.supervisors = docs.filter((x) => x.data().role === "SUPERVISOR").map((x) => ({ id: x.id.slice(-4), name: x.data().name || "Encargado", phone: masked(x.id) }));
  }
  return out;
}

/** Desvincula el propio teléfono, o (el dueño) el de un encargado: target = últimos 4 dígitos */
async function unlink(db, uid, who = {}, target) {
  const docs = await phonesOf(db, uid);
  const pick = target && who.role !== "SUPERVISOR"
    ? docs.filter((d) => d.data().role === "SUPERVISOR" && d.id.endsWith(String(target)))
    : docs.filter((d) => isMine(d, who));
  await Promise.all(pick.map((d) => d.ref.delete()));
  return status(db, uid, who);
}

/** El dueño habilita o no a los encargados. Al sacarlo, se desvinculan los que estaban. */
async function setSupervisors(db, uid, allowed) {
  await db.collection(SETTINGS).doc(uid).set({ supervisors: !!allowed }, { merge: true });
  if (!allowed) for (const d of await phonesOf(db, uid)) if (d.data().role === "SUPERVISOR") await d.ref.delete();
  return { supervisorsAllowed: !!allowed };
}

/** Resumen del día por WhatsApp: prendido o no, y a qué hora (de 8 a 23) */
async function setSummary(db, uid, who, summary) {
  const hour = Math.min(23, Math.max(8, Math.round(Number(summary && summary.hour) || 21)));
  const mine = (await phonesOf(db, uid)).find((d) => isMine(d, who));
  if (!mine) throw Object.assign(new Error("Primero vinculá tu WhatsApp."), { status: 400 });
  await mine.ref.set({ summary: { enabled: !!(summary && summary.enabled), hour } }, { merge: true });
  return status(db, uid, who);
}

/** Cuenta con plan vigente (o en los días de gracia) */
async function account(db, uid, now) {
  const acc = await db.collection("ventra_accounts").doc(uid).get();
  if (!acc.exists) return null;
  const a = acc.data();
  return { plan: a.plan || null, active: ms(a.paidUntil) + GRACE_DAYS * DAY_MS >= now };
}

const SUMMARY_ON = /^(?:mandame (?:el )?)?resumen(?: del d[ií]a| diario)?(?: todos los d[ií]as)?(?: a las)?\s*(\d{1,2})\s*(?:h|hs|horas)?$/i;
const SUMMARY_OFF = /^(?:sin|sacar|cancelar|parar|desactivar|no quiero(?: el)?|basta de(?:l)?)\s+(?:el\s+)?resumen/i;

// "sí" / "no" para un cambio pendiente, escrito o dicho en un audio ("Sí, dale.")
const EDIT_YES = /^(?:si+|dale|ok|okey|confirmo|confirmar|confirmado|de una|hacelo|si dale|dale si|si confirmo|si hacelo|si por favor)$/;
const EDIT_NO = /^(?:no|cancelo|cancelar|cancelalo|deja|dejalo|nada|no gracias|no cancelalo|no dejalo)$/;
const plainWords = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const editAnswer = (s) => { const w = plainWords(s); return EDIT_YES.test(w) ? "ok" : EDIT_NO.test(w) ? "no" : null; };
// "la 2", "la segunda", "2", "la 1 me gusta" → número de opción
const PICK_RE = /^(?:la\s+|opcion\s+|quiero\s+la\s+|me\s+quedo\s+con\s+la\s+)?(1|2|3|uno|dos|tres|primera|segunda|tercera)(?:\s+(?:me gusta|va|esa|dale|porfa|por favor))?$/;
const PICK_N = { 1: 1, 2: 2, 3: 3, uno: 1, dos: 2, tres: 3, primera: 1, segunda: 2, tercera: 3 };
/** Lo último que quedó esperando "sí"/"no": un cambio de precios o una operación del sistema */
function pendingOf(o, now) {
  const edit = o.pendingEdit && now - Number(o.pendingEditAt || 0) < edits.PENDING_MS ? { kind: "edit", id: o.pendingEdit, at: Number(o.pendingEditAt) } : null;
  const op = o.pendingOp && now - Number(o.pendingOpAt || 0) < ventraApi.PENDING_MS ? { kind: "op", id: o.pendingOp, at: Number(o.pendingOpAt) } : null;
  if (edit && op) return edit.at > op.at ? edit : op;
  return edit || op;
}
const pickAnswer = (s) => { const m = PICK_RE.exec(plainWords(s)); return m ? PICK_N[m[1]] : null; };

/**
 * Un mensaje que llegó al número de Ventra. Devuelve true si era de alguien vinculado (o para
 * vincularse) y ya quedó atendido; false para que siga como antes (clientes de la agenda).
 */
async function onMessage(db, send, m, now = Date.now(), io = {}) {
  const from = String(m.from || "");
  const text = m.type === "text" && m.text ? String(m.text.body || "").trim() : "";
  const id = String(m.id || `${from}-${now}`).replace(/[^\w.-]/g, "_").slice(0, 150);
  const IN = { question: "in_question", audio: "in_audio", image: "in_image", menu: "in_menu" };
  let role = null;
  const enqueue = async (item) => {
    if (item.uid && item.type !== "welcome") {
      await stats.track(db, item.uid, ["msgs", IN[item.type] || "in_button", role === "SUPERVISOR" ? "by_supervisor" : "by_owner"], now);
    }
    try {
      await db.collection(INBOX).doc(id).create({ from, at: now, ...item });
    } catch (err) {
      // El id es el del mensaje de Meta: si reintenta, no se responde dos veces
      if (!/already exists|ALREADY_EXISTS/i.test(String(err && err.message)) && Number(err && err.code) !== 6) throw err;
    }
  };

  const link = /^vincular\s+([a-z0-9]{6})\b/i.exec(text);
  if (link) {
    const ref = db.collection(LINKS).doc(link[1].toUpperCase());
    const snap = await ref.get();
    if (!snap.exists || Number(snap.data().expiresAt) < now) {
      await send(from, "Ese código ya venció o no es válido. Pedí uno nuevo en Ventra: *Preguntale a tu negocio → Preguntale por WhatsApp*.");
      return true;
    }
    const c = snap.data();
    if (c.role === "SUPERVISOR" && !(await supervisorsAllowed(db, c.uid))) {
      await send(from, "El dueño del comercio no tiene habilitado que los encargados usen Ventra por WhatsApp.");
      return true;
    }
    // Un teléfono por usuario: el nuevo reemplaza al anterior
    const who = { userId: c.userId, role: c.role };
    for (const old of await phonesOf(db, c.uid)) if (old.id !== from && isMine(old, who)) await old.ref.delete();
    await db.collection(OWNERS).doc(from).set({ uid: c.uid, userId: c.userId || null, role: c.role || "ADMIN", name: c.name || null, linkedAt: now, lastInboundAt: now, questions: 0 });
    await ref.delete();
    // La bienvenida depende del plan y del rubro (están en la nube): la arma processInbox
    await enqueue({ uid: c.uid, type: "welcome" });
    return true;
  }

  const owner = await db.collection(OWNERS).doc(from).get();
  if (!owner.exists) return false;
  const o = owner.data();
  role = o.role || "ADMIN";
  // "Escribiendo…" enseguida: el dueño ve que el bot ya está en eso
  if (io.typing && m.id) io.typing(m.id);
  const listId = String((m.interactive && m.interactive.list_reply && m.interactive.list_reply.id) || "");
  await owner.ref.set({ lastInboundAt: now }, { merge: true });

  // Menú: "MENÚ" abre la lista; elegir un renglón la atiende la bandeja (o abre "Más opciones")
  const openMenu = async (page = "main") => {
    if (!io.sendList) { await enqueue({ uid: o.uid, type: "menu", option: page === "mas" ? "mas" : "__open" }); return true; }
    await stats.track(db, o.uid, ["msgs", "in_menu", role === "SUPERVISOR" ? "by_supervisor" : "by_owner"], now);
    const acc = await account(db, o.uid, now);
    await io.sendList(from, page === "mas" ? "Más opciones:" : menu.MENU_TEXT, page === "mas" ? "Más opciones" : "Ver opciones", menu.sections({ plan: acc && acc.plan, role: o.role, page }));
    return true;
  };
  if (listId.startsWith("m|")) {
    const option = listId.slice(2);
    if (option === "mas") return openMenu("mas");
    await enqueue({ uid: o.uid, type: "menu", option });
    return true;
  }
  if (menu.MENU_RE.test(text)) return openMenu();
  // Botones de un cambio de precios (Confirmar / Cancelar / Deshacer): payload "wo|acción|id"
  const button = String((m.interactive && m.interactive.button_reply && m.interactive.button_reply.id) || "");
  if (button.startsWith("wo|")) {
    const [, action, editId] = button.split("|");
    await enqueue({ uid: o.uid, type: "edit", action, editId });
    return true;
  }
  // Repetidos ("wc|merge|i"), boletas ("wv|…", también en listas) y "¿qué es esta foto?" ("wf|tipo")
  const anyId = button || listId;
  if (anyId.startsWith("wc|")) {
    const [, action, i] = anyId.split("|");
    await enqueue({ uid: o.uid, type: "cleanup", action, i: Number(i) });
    return true;
  }
  if (anyId.startsWith("wv|")) {
    const [, action, invId, k, productId] = anyId.split("|");
    await enqueue({ uid: o.uid, type: "invoice", action, invId, k: k === undefined ? null : Number(k), productId: productId || null });
    return true;
  }
  if (anyId.startsWith("wf|")) {
    const [, kind, batch] = anyId.split("|");
    await enqueue({ uid: o.uid, type: "photo", kind, batch: batch || null });
    return true;
  }
  // Comandos de la limpieza de repetidos
  const sep = SEPARAR_RE.exec(text);
  if (sep || JUNTADOS_RE.test(text) || /^repetidos de nuevo[.!]*$/i.test(text)) {
    await enqueue({ uid: o.uid, type: "cleanup_cmd", cmd: sep ? "undo" : JUNTADOS_RE.test(text) ? "list" : "restart", n: sep && sep[1] ? Number(sep[1]) : null });
    return true;
  }
  if ((o.cleanupAt && now - Number(o.cleanupAt) < 2 * 60 * 60 * 1000) && (PARAR_RE.test(text) || KEEP_RE.test(text))) {
    const keep = KEEP_RE.exec(text);
    await enqueue({ uid: o.uid, type: "cleanup_cmd", cmd: keep ? "keep" : "stop", n: keep ? Number(keep[1]) : null });
    return true;
  }
  // Operación del sistema (Confirmar / Cancelar): "wx|ok|id"
  if (button.startsWith("wx|")) {
    const [, action, opId] = button.split("|");
    await enqueue({ uid: o.uid, type: "op", action, opId });
    return true;
  }
  // Elegir una de las imágenes de promo: botón "wi|pick|id|n" o "la 2" escrito
  if (button.startsWith("wi|")) {
    const [, , jobId, n] = button.split("|");
    await enqueue({ uid: o.uid, type: "pick", jobId, n: Number(n) });
    return true;
  }
  const pickN = o.lastImage && o.lastImage.id && now - Number(o.lastImage.at || 0) < PICK_MS ? pickAnswer(text) : null;
  if (pickN) {
    await enqueue({ uid: o.uid, type: "pick", jobId: o.lastImage.id, n: pickN });
    return true;
  }
  // "sí" / "no" escrito con algo esperando confirmación: lo último que se propuso
  const pend = pendingOf(o, now);
  if (pend) {
    const answer = editAnswer(text);
    if (answer) {
      await enqueue(pend.kind === "op" ? { uid: o.uid, type: "op", action: answer, opId: pend.id } : { uid: o.uid, type: "edit", action: answer, editId: pend.id });
      return true;
    }
  }
  if (/^desvincular$/i.test(text)) {
    await owner.ref.delete();
    await send(from, "Listo, este WhatsApp ya no está vinculado a tu negocio. Para volver a usarlo, vinculalo de nuevo desde Ventra.");
    return true;
  }
  const on = SUMMARY_ON.exec(text);
  if (on || SUMMARY_OFF.test(text)) {
    const hour = on ? Math.min(23, Math.max(8, Number(on[1]))) : (o.summary && o.summary.hour) || 21;
    await owner.ref.set({ summary: { enabled: !!on, hour } }, { merge: true });
    await send(from, on
      ? `Listo: todos los días a las *${hour} h* te mando el resumen del día. Para dejar de recibirlo, mandá *SIN RESUMEN*.`
      : "Listo, ya no te mando el resumen del día. Para volver a recibirlo, mandá por ejemplo *RESUMEN A LAS 21*.");
    return true;
  }
  // Audios (notas de voz): se transcriben en processInbox, que tiene tiempo y las claves
  if (m.type === "audio" && m.audio && m.audio.id) {
    await enqueue({ uid: o.uid, type: "audio", mediaId: String(m.audio.id), mime: String(m.audio.mime_type || "") });
    return true;
  }
  // PDF, Excel o CSV de la factura que manda el proveedor: se lee sin IA, como en la PC (tanda 7.3 de boletas)
  if (m.type === "document" && m.document && m.document.id) {
    const mime = String(m.document.mime_type || "").toLowerCase();
    const name = String(m.document.filename || "factura").slice(0, 120);
    if (/pdf|spreadsheet|excel|csv/.test(mime) || /\.(pdf|xlsx?|csv)$/i.test(name)) {
      await enqueue({ uid: o.uid, type: "document", mediaId: String(m.document.id), mime, filename: name });
      return true;
    }
    await send(from, "Ese archivo no lo puedo leer. Mandame la factura en PDF, Excel o una foto.");
    return true;
  }
  // Fotos: el logo del comercio o la foto de un producto para las imágenes de promos
  if (m.type === "image" && m.image && m.image.id) {
    await enqueue({ uid: o.uid, type: "image", mediaId: String(m.image.id), mime: String(m.image.mime_type || ""), caption: String(m.image.caption || "").slice(0, 500) });
    return true;
  }
  if (!text) {
    await send(from, "Por ahora entiendo mensajes escritos, audios y fotos. Escribime o mandame un audio con tu pregunta, por ejemplo: ¿cuánto vendí hoy?");
    return true;
  }
  await enqueue({ uid: o.uid, type: "question", text: text.slice(0, 500) });
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

const leftNote = (leftToday) => (typeof leftToday === "number" && leftToday <= 5
  ? `\n\n_${leftToday > 0 ? `Te ${leftToday === 1 ? "queda 1 pregunta" : `quedan ${leftToday} preguntas`} por hoy.` : "Por hoy no te quedan preguntas: mañana seguimos."}_` : "");

/**
 * Responde lo que dejó onMessage en la bandeja. deps: { ai, aiDeps (lo que pide ai.handle,
 * con sql), sql, send, logger }. Si algo falla, la persona recibe un mensaje claro.
 */
async function processInbox(db, item, deps, now = Date.now()) {
  // El aviso que mantiene la función despierta (ventraWaWarm): no hace nada
  if (item.type === "warm") return null;
  const { from, uid } = item;
  const { ai, aiDeps, sql, send, logger } = deps;
  try {
    const ownerRef = db.collection(OWNERS).doc(from);
    const owner = await ownerRef.get();
    // Se desvinculó (o vinculó otro teléfono) entre que llegó el mensaje y ahora
    if (!owner.exists || owner.data().uid !== uid) return null;
    const o = owner.data();
    const [acc, supervisorOk] = await Promise.all([account(db, uid, now), o.role === "SUPERVISOR" ? supervisorsAllowed(db, uid) : true]);
    if (!acc || !acc.active) {
      return send(from, "El plan de Ventra de este comercio está vencido, así que no puedo leer los datos del negocio. Cuando se renueve, seguimos.");
    }
    if (o.role === "SUPERVISOR" && !supervisorOk) {
      await ownerRef.delete();
      return send(from, "El dueño del comercio desactivó las preguntas por WhatsApp para los encargados.");
    }
    // Confirmar, cancelar o deshacer un cambio de precios (solo el dueño)
    const doEdit = async (action, editId, prefix = "") => {
      if (o.role === "SUPERVISOR") return send(from, "Los cambios de precios por WhatsApp los hace solo el dueño.");
      const r = await edits.act(db, { action, id: editId, from, uid, sql, afterWrite: deps.afterWrite }, now);
      if (action === "ok") await stats.track(db, uid, ["do_prices_ok"], now);
      if (o.pendingEdit === editId && action !== "undo") await ownerRef.set({ pendingEdit: null }, { merge: true });
      if (r.undo && deps.sendButtons) return deps.sendButtons(from, prefix + r.text, [{ id: `wo|undo|${r.undo}`, title: "Deshacer" }]);
      return send(from, prefix + r.text);
    };
    if (item.type === "edit") return doEdit(item.action, item.editId);

    // Operación del sistema (en la caja en la nube): confirmar o cancelar
    const doOp = async (action, opId, prefix = "") => {
      if (o.role === "SUPERVISOR") return send(from, "Las operaciones del sistema por WhatsApp las hace solo el dueño.");
      if (!deps.ventraApi) return send(from, "Por ahora no puedo hacer operaciones del sistema por acá.");
      if (action === "ok") await send(from, `${prefix}⏳ Haciéndolo en tu caja…`);
      const r = await ventraApi.act(db, deps.ventraApi, { action, id: opId, from, uid }, now);
      if (action === "ok") await stats.track(db, uid, ["do_op_ok"], now);
      if (o.pendingOp === opId) await ownerRef.set({ pendingOp: null }, { merge: true });
      return send(from, (action === "ok" ? "" : prefix) + r.text);
    };
    if (item.type === "op") return doOp(item.action, item.opId);

    // ── Repetidos y boletas (en la caja en la nube) ──
    const flow = { db, api: deps.ventraApi, bucket: deps.bucket, uid, from, send, sendButtons: deps.sendButtons, sendList: deps.sendList, now };
    const needCloud = () => send(from, "Por ahora no puedo hacer eso por acá.");
    if (["cleanup", "cleanup_cmd", "invoice", "photo"].includes(item.type) && o.role === "SUPERVISOR") return send(from, "Eso lo hace el dueño.");
    if (item.type === "cleanup") {
      if (!deps.ventraApi) return needCloud();
      await ownerRef.set({ cleanupAt: now }, { merge: true });
      return cleanup.act(flow, item.action, item.i);
    }
    if (item.type === "cleanup_cmd") {
      if (!deps.ventraApi) return needCloud();
      if (item.cmd === "undo") return cleanup.undo(flow, item.n);
      if (item.cmd === "list") return cleanup.list(flow);
      if (item.cmd === "stop") { await ownerRef.set({ cleanupAt: null }, { merge: true }); return cleanup.stop(flow); }
      if (item.cmd === "restart") { await cleanup.resetSkipped(db, uid, from); await ownerRef.set({ cleanupAt: now }, { merge: true }); return cleanup.start(flow); }
      if (item.cmd === "keep") {
        const c = await cleanup.active(db, uid, from, now);
        if (!c) return send(from, "No hay una revisión de repetidos en curso.");
        const g = c.groups[c.i];
        if (!g.products[item.n - 1]) return send(from, `Ese grupo tiene ${g.products.length} productos: elegí un número del 1 al ${g.products.length}.`);
        return cleanup.act(flow, "merge", c.i, item.n - 1);
      }
    }
    if (item.type === "invoice") {
      if (!deps.ventraApi) return needCloud();
      return invoice.act(flow, { action: item.action, id: item.invId, k: item.k, productId: item.productId });
    }
    if (item.type === "photo") {
      const path = o.lastPhoto && o.lastPhoto.path;
      if (!path) return send(from, "No encontré la foto. Mandala de nuevo.");
      if (item.kind === "invoice") {
        if (!deps.ventraApi) return needCloud();
        // Las fotos de ese envío (no solo la última); un botón viejo no vuelve a cargarlas
        const b = o.photoBatch;
        if (item.batch && b && b.id === item.batch && b.done) return send(from, "Esas fotos ya las leí. Si querés cargarlas de nuevo, mandalas otra vez.");
        const photos = item.batch && b && b.id === item.batch ? b.paths : [path];
        if (b && b.id === item.batch) await ownerRef.set({ photoBatch: { ...b, done: true } }, { merge: true });
        await stats.track(db, uid, ["do_invoice"], now);
        return invoice.start(flow, photos);
      }
      if (item.kind === "logo") {
        await brandKit.save(db, uid, await promo.saveLogo({ db, bucket: deps.bucket, uid }, path));
        return send(from, "¡Gracias! Guardé el logo para las imágenes de tus promos.");
      }
      return send(from, "Dale. Decime qué hago con la foto (por ejemplo: *usala para el Fernet Branca*).");
    }

    // ── Menú ──
    if (item.type === "menu") {
      const option = item.option;
      if (option === "__open" || option === "mas") {
        if (!deps.sendList) return send(from, "Escribime o mandame un audio con lo que necesites.");
        return deps.sendList(from, option === "mas" ? "Más opciones:" : menu.MENU_TEXT, option === "mas" ? "Más opciones" : "Ver opciones", menu.sections({ plan: acc.plan, role: o.role, page: option === "mas" ? "mas" : "main" }));
      }
      const opt = menu.OPTIONS[option];
      if (!opt) return send(from, "No entendí esa opción. Escribí *MENÚ* para verlas de nuevo.");
      await stats.track(db, uid, [`menu_${option}`], now);
      if (opt.write && o.role === "SUPERVISOR") return send(from, "Eso lo hace el dueño. Podés pedirme cualquier dato del negocio.");
      if (option === "repetidos") {
        if (!deps.ventraApi) return needCloud();
        await ownerRef.set({ cleanupAt: now }, { merge: true });
        return cleanup.start(flow);
      }
      if (opt.kind === "hacer") {
        await ownerRef.set({ menuIntent: { id: option, at: now } }, { merge: true });
        return send(from, opt.ask);
      }
      const text = await menu.quick(option, { sql, db, uid, role: o.role, now, summaryText }).catch((err) => { if (logger) logger.warn(`Menú (${uid}, ${option}): ${err && err.message}`); return null; });
      const last = await insights.lastSync(sql, uid).catch(() => null);
      return send(from, `${text || "No pude traer ese dato ahora. Probá de nuevo en un rato."}${freshnessNote(last, now)}\n\n_Escribí *MENÚ* para ver más opciones._`.slice(0, 4000));
    }

    // ── Imágenes de promos (solo el dueño, y si este despliegue puede mandar imágenes) ──
    const imagesOn = o.role !== "SUPERVISOR" && !!(deps.sendImage && deps.bucket && deps.sendButtons);
    const loadKit = () => brandKit.load({ sql, db, bucket: deps.bucket }, uid);
    let lastPhoto = o.lastPhoto && now - Number(o.lastPhoto.at || 0) < PHOTO_MS ? o.lastPhoto.path : null;

    /** Arma las imágenes del pedido y las manda, con los botones para elegir */
    const sendImages = async (plan, kit, prefix = "") => {
      const n = plan.style ? 1 : brandKit.STYLES.length;
      if (!(await promo.allow(db, uid, n, now))) return send(from, `${prefix}Llegaste al tope de ${promo.DAILY_LIMIT} imágenes por hoy. Mañana seguimos.`);
      await send(from, `${prefix}🎨 ${n > 1 ? `Armando ${n} opciones con el estilo de *${kit.name}*` : "Armando la imagen"}… tardo unos segundos.`);
      const r = await promo.generate({ db, bucket: deps.bucket, uid, kit, logger, renderImpl: deps.renderImpl }, plan, { from, now });
      if (r.missing) return send(from, `No tengo foto de ${r.missing.join(" ni de ")}. Mandame una foto y decime *usala para ${r.missing[0]}*.`);
      for (const [i, v] of r.variants.entries()) await deps.sendImage(from, v.url, n > 1 ? `Opción ${i + 1} · ${promo.STYLE_NAMES[v.style]}` : "");
      await ownerRef.set({ lastImage: { id: r.id, at: now, productos: plan.products.map((p) => p.name), precio: plan.price || null, estilos: r.variants.map((v) => v.style), formato: plan.format, textos: plan.texts || {}, elegido: plan.style || null } }, { merge: true });
      if (n > 1) {
        return deps.sendButtons(from, "¿Cuál te gusta? Elegí una y te la mando también para historias. Si querés cambios, decímelos (por ejemplo: *la 1 pero con el precio más grande*).",
          r.variants.map((v, i) => ({ id: `wi|pick|${r.id}|${i + 1}`, title: `La ${i + 1}` })));
      }
      return send(from, "¿Te sirve? Si querés cambios, decímelos y la ajusto.");
    };
    /** El pedido que quedó esperando el nombre o el logo: si ya está todo, lo arma */
    const continuePending = async (kit, pending) => {
      if (!pending || !pending.input || kit.needs.length) return null;
      await brandKit.save(db, uid, { pendingRequest: null });
      const r = await promo.prepare({ sql }, uid, kit, pending.input, lastPhoto);
      if (!r.plan) return send(from, "Ya tengo todo lo de tu marca. Pedime de nuevo la imagen y te la armo.");
      return sendImages(r.plan, kit, "Ahora sí, ");
    };

    if (item.type === "pick") {
      if (!imagesOn) return null;
      const kit = await loadKit();
      const r = await promo.pick({ db, bucket: deps.bucket, uid, kit, logger, renderImpl: deps.renderImpl }, item.jobId, item.n, { from, now });
      if (r.error) return send(from, r.error);
      if (r.already) return send(from, "Esa ya la elegiste 👍 Si querés cambios, decímelos.");
      await ownerRef.set({ lastImage: { ...(o.lastImage || {}), elegido: r.style } }, { merge: true });
      await send(from, `¡Buenísimo! Anoto que te gusta el estilo *${promo.STYLE_NAMES[r.style]}*: las próximas te lo muestro primero.${r.extra ? ` Acá la tenés también para ${r.extra.format === "story" ? "historias y estados" : "publicar"}.` : ""}`);
      if (r.extra) await deps.sendImage(from, r.extra.url, "");
      return null;
    }

    // Audio → texto. Se le muestra lo que se entendió, así sabe qué se respondió (o qué se va a cambiar)
    let text = String(item.text || "");
    let heardNote = "";
    if (item.type === "audio") {
      const out = deps.transcribe
        ? await deps.transcribe(item.mediaId, item.mime, uid).catch((err) => { if (logger) logger.warn(`Audio por WhatsApp (${uid}): ${err && err.message}`); return null; })
        : null;
      if (!out || !out.text) return send(from, "No pude entender el audio. Probá de nuevo hablando cerca del teléfono (hasta un minuto) o escribímelo.");
      text = out.text.slice(0, 500);
      heardNote = `🎤 _${text.length > 160 ? `${text.slice(0, 160)}…` : text}_\n\n`;
      const pend = pendingOf(o, now);
      const answer = pend ? editAnswer(text) : null;
      if (answer) return pend.kind === "op" ? doOp(answer, pend.id, heardNote) : doEdit(answer, pend.id, heardNote);
    }

    // La factura del proveedor en PDF o Excel: va derecho a la carga de la boleta, sin IA (tanda 7.3)
    if (item.type === "document") {
      if (!deps.ventraApi) return send(from, "Por ahora no puedo cargar facturas por acá. Subila desde la PC, en Compras.");
      const buf = deps.download ? await deps.download(item.mediaId).catch(() => null) : null;
      if (!buf) return send(from, "No pude abrir el archivo. Probá mandarlo de nuevo.");
      const ext = (String(item.filename || "").match(/\.(pdf|xlsx?|csv)$/i) || [])[1] || (/pdf/.test(item.mime) ? "pdf" : "xlsx");
      const path = `wa_docs/${uid}/${now}.${ext.toLowerCase()}`;
      await deps.bucket.file(path).save(buf, { contentType: item.mime || "application/octet-stream", resumable: false });
      await stats.track(db, uid, ["do_invoice"], now);
      return invoice.start({ db, api: deps.ventraApi, bucket: deps.bucket, uid, from, send, sendButtons: deps.sendButtons, sendList: deps.sendList, now }, [{ path, mime: item.mime || "application/pdf", name: item.filename || `factura.${ext}` }]);
    }

    // Foto: si estaba esperando el logo, es el logo; si no, queda como "la última foto"
    if (item.type === "image") {
      if (!imagesOn) return send(from, "Por ahora no puedo usar fotos por acá. Escribime o mandame un audio.");
      const buf = deps.download ? await deps.download(item.mediaId).catch(() => null) : null;
      if (!buf) return send(from, "No pude abrir la foto. Probá mandarla de nuevo.");
      const path = await promo.savePhoto(deps.bucket, uid, buf, now);
      await ownerRef.set({ lastPhoto: { path, at: now } }, { merge: true });
      lastPhoto = path;
      // Varias fotos seguidas (un álbum, o varias boletas de una): se juntan y las atiende la última
      // en llegar, con una sola respuesta. Antes cada una preguntaba "¿qué es?" y cualquier botón leía
      // solo la última foto.
      const batch = await addToPhotoBatch(db, ownerRef, path, BOLETA_RE.test(item.caption || ""), now);
      await (deps.photoWait || sleep)(PHOTO_BATCH_WAIT_MS);
      const cur = ((await ownerRef.get()).data() || {}).photoBatch;
      if (!cur || cur.id !== batch.id || cur.lastPath !== path) return null; // llegó otra después: responde esa
      const photos = cur.paths || [path];
      const known = await brandKit.learned(db, uid);
      if (known.awaitingLogo && !item.caption && photos.length === 1) {
        await brandKit.save(db, uid, await promo.saveLogo({ db, bucket: deps.bucket, uid }, path));
        const kit = await loadKit();
        const vivid = (kit.logoColors && kit.logoColors.vivid) || [];
        await send(from, `¡Gracias! Guardé el logo${vivid.length ? " y saqué sus colores para las imágenes" : ""}. Si querés otros colores, decime cuáles.`);
        if (kit.needs.includes("nombre")) return send(from, "¿Cómo se llama el comercio? Así lo pongo en las imágenes.");
        return continuePending(kit, known.pendingRequest);
      }
      const intent = ((await ownerRef.get()).data() || {}).menuIntent || o.menuIntent;
      const wantsInvoice = (intent && intent.id === "compra" && now - Number(intent.at || 0) < menu.INTENT_MS) || BOLETA_RE.test(item.caption || "") || cur.boleta;
      if (wantsInvoice && deps.ventraApi) {
        await ownerRef.set({ menuIntent: null, photoBatch: { ...cur, done: true } }, { merge: true });
        await stats.track(db, uid, ["do_invoice"], now);
        return invoice.start({ db, api: deps.ventraApi, bucket: deps.bucket, uid, from, send, sendButtons: deps.sendButtons, sendList: deps.sendList, now }, photos);
      }
      if (!item.caption || photos.length > 1) {
        return photos.length > 1
          ? deps.sendButtons(from, `📷 Recibí ${photos.length} fotos. ¿Qué son?`, [
            { id: `wf|invoice|${cur.id}`, title: "Boletas o facturas" }, { id: `wf|other|${cur.id}`, title: "Otra cosa" },
          ])
          : deps.sendButtons(from, "📷 Recibí la foto. ¿Qué es?", [
            { id: `wf|invoice|${cur.id}`, title: "Boleta o factura" }, { id: "wf|logo", title: "Logo del comercio" }, { id: "wf|other", title: "Otra cosa" },
          ]);
      }
      text = item.caption;
    }

    const info = await insights.storeInfo(sql, uid).catch(() => ({}));

    if (item.type === "welcome") {
      const hi = o.role === "SUPERVISOR" ? `¡Listo${o.name ? `, ${o.name}` : ""}! Ya podés preguntarme por ${info.name || "el negocio"}.` : `¡Listo! Ya podés preguntarme por ${info.name || "tu negocio"} cuando quieras.`;
      const canEdit = o.role !== "SUPERVISOR" && !["agenda", "agenda_pro", "tienda"].includes(acc.plan) && !!deps.sendButtons;
      const editTip = canEdit ? "\n\nTambién podés cambiar precios y costos: por ejemplo *subí la Coca 1,5 a 2800*, *el costo del alfajor ahora es 650* o *subí 10% las gaseosas*. Antes de tocar nada te pido que confirmes." : "";
      const imageTip = canEdit && deps.sendImage ? "\n\nY te armo imágenes para tus promos con tu logo y tus colores: *haceme una imagen del Fernet con precio* o *armá la promo de un Fernet más una Coca a 22900*." : "";
      return send(from, `${hi}\n\n${agent.welcome({ plan: acc.plan, profile: info.profile, daily: ai.DAILY.ask, monthly: ai.LIMITS.ask })}${editTip}${imageTip}\n\nEscribí *MENÚ* cuando quieras para ver las opciones.\n\nSi querés, te mando el resumen del día: escribime *RESUMEN A LAS 21* (o la hora que quieras). Para dejar de usar esto, mandá *DESVINCULAR*.`);
    }

    // Venía de elegir una opción "hacer" del menú: lo que escribe va con esa intención
    if (o.menuIntent && o.menuIntent.id && now - Number(o.menuIntent.at || 0) < menu.INTENT_MS && item.type !== "welcome") {
      text = menu.withIntent(o.menuIntent.id, text);
      await ownerRef.set({ menuIntent: null }, { merge: true });
    }
    // La pregunta anterior si fue hace poco: para "¿y ayer?"
    const history = o.lastQuestion && now - ms(o.lastAt) < 30 * 60 * 1000 ? [{ q: o.lastQuestion, a: o.lastAnswer || "" }] : [];
    // El dueño puede pedir cambios de precios (si este despliegue manda botones)
    const editing = o.role !== "SUPERVISOR" && deps.sendButtons ? edits.session(sql, uid) : null;
    const known = imagesOn ? await brandKit.learned(db, uid).catch(() => null) : null;
    const imaging = imagesOn
      ? promo.session({ sql, db, bucket: deps.bucket, uid, from, lastPhoto, last: o.lastImage || null, kit: known ? { ...known, name: known.name || info.name || null, needs: [] } : {}, loadKit })
      : null;
    const operating = o.role !== "SUPERVISOR" && deps.ventraApi && deps.sendButtons ? ventraApi.session({ api: deps.ventraApi, uid }) : null;
    const out = await ai.handle({ ...aiDeps, edits: editing, images: imaging, api: operating }, uid, {
      // Un audio llega ya pasado a texto: la IA tiene que saber que vino por voz (si no, ante
      // "¿me escuchás?" contesta que no le llegó ningún audio)
      kind: "agent", channel: "whatsapp", question: item.type === "audio" ? `[Audio] ${text}` : text, history, plan: acc.plan, role: o.role || "ADMIN", info,
    });
    if (editing && editing.plan) {
      const editId = await edits.save(db, { uid, from, userId: o.userId, plan: editing.plan }, now);
      await stats.track(db, uid, ["do_prices"], now);
      await ownerRef.set({ lastQuestion: text, lastAnswer: "(propuesta de cambio de precios)", lastAt: now, questions: (Number(o.questions) || 0) + 1, pendingEdit: editId, pendingEditAt: now }, { merge: true });
      return deps.sendButtons(from, edits.previewText(editing.plan, heardNote), [{ id: `wo|ok|${editId}`, title: "Confirmar" }, { id: `wo|no|${editId}`, title: "Cancelar" }]);
    }
    if (operating && operating.op) {
      const opId = await ventraApi.save(db, { uid, from, op: operating.op }, now);
      await stats.track(db, uid, ["do_op", `op_${operating.op.id}`], now);
      await ownerRef.set({ lastQuestion: text, lastAnswer: `(propuesta: ${operating.op.summary})`.slice(0, 1200), lastAt: now, questions: (Number(o.questions) || 0) + 1, pendingOp: opId, pendingOpAt: now }, { merge: true });
      return deps.sendButtons(from, ventraApi.confirmText(operating.op, heardNote), [{ id: `wx|ok|${opId}`, title: "Confirmar" }, { id: `wx|no|${opId}`, title: "Cancelar" }]);
    }
    if (imaging && imaging.plan) {
      await ownerRef.set({ lastQuestion: text, lastAnswer: "(le armé imágenes de promo)", lastAt: now, questions: (Number(o.questions) || 0) + 1 }, { merge: true });
      await stats.track(db, uid, ["do_promo"], now);
      if (known && known.pendingRequest) await brandKit.save(db, uid, { pendingRequest: null });
      // "La 1 pero con…": pedir cambios sobre una opción también es elegirla (cuenta el voto una vez)
      const prev = o.lastImage;
      if (imaging.plan.style && prev && !prev.elegido && (prev.estilos || []).includes(imaging.plan.style) && now - Number(prev.at || 0) < PICK_MS) {
        await brandKit.recordPick(db, uid, imaging.kit, imaging.plan.style);
        await ownerRef.set({ lastImage: { ...prev, elegido: imaging.plan.style } }, { merge: true });
      }
      return sendImages(imaging.plan, imaging.kit, heardNote);
    }
    const last = acc.plan === "agenda" || acc.plan === "agenda_pro" ? null : await insights.lastSync(sql, uid).catch(() => null);
    const answer = waFormat(out.result && out.result.answer);
    const note = acc.plan === "agenda" || acc.plan === "agenda_pro" ? "" : freshnessNote(last, now);
    await ownerRef.set({ lastQuestion: text, lastAnswer: answer.slice(0, 1200), lastAt: now, questions: (Number(o.questions) || 0) + 1 }, { merge: true });
    await stats.track(db, uid, ["do_answer"], now);
    const day = new Date(now).toLocaleDateString("en-CA", { timeZone: TZ });
    const menuHint = o.menuHintDay !== day ? "\n\n_Escribí *MENÚ* para ver todo lo que puedo hacer._" : "";
    if (menuHint) await ownerRef.set({ menuHintDay: day }, { merge: true });
    await send(from, (heardNote + answer + note + menuHint + leftNote(out.leftToday)).slice(0, 4000));
    // Completó el nombre o el logo con un pedido de imagen esperando: lo arma ahora
    if (imaging && imaging.brandSaved && known && known.pendingRequest) return continuePending(imaging.kit, known.pendingRequest);
    return null;
  } catch (err) {
    // Topes y errores de la IA: su mensaje ya está escrito para la persona
    if (ai && ai.AiError && err instanceof ai.AiError) return send(from, err.message);
    if (logger) logger.error(`Preguntas por WhatsApp: error (${uid})`, err);
    return send(from, "No pude responderte ahora. Probá de nuevo en un rato.");
  }
}

/**
 * Texto del resumen del día (ventas, comparación con el mismo día de la semana pasada, caja).
 * `owner`: lo recibe el dueño (no un encargado): suma el control de anulaciones.
 */
async function summaryText(sql, uid, now, owner = false) {
  const today = new Date(now).toLocaleDateString("en-CA", { timeZone: TZ });
  const lastWeek = new Date(Date.parse(today) - 7 * DAY_MS).toISOString().slice(0, 10);
  const [day, prev, cash, low] = await Promise.all([
    dashboard.overview(sql, uid, today, today), dashboard.overview(sql, uid, lastWeek, lastWeek),
    dashboard.cash(sql, uid), dashboard.lowStock(sql, uid),
  ]);
  const total = Number(day.summary.total) || 0, count = Number(day.summary.count) || 0, before = Number(prev.summary.total) || 0;
  const weekday = new Intl.DateTimeFormat("es-AR", { weekday: "long", timeZone: TZ }).format(new Date(now));
  const pct = before > 0 ? Math.round(((total - before) / before) * 100) : null;
  const lines = [`*Hoy vendiste ${money(total)}* en ${count} ${count === 1 ? "venta" : "ventas"}${pct === null ? "" : ` (${pct >= 0 ? "+" : ""}${pct}% vs. el ${weekday} pasado)`}.`];
  const top = (day.topProducts || []).slice(0, 3).map((p) => p.name).filter(Boolean);
  if (top.length) lines.push(`- Lo más vendido: ${top.join(", ")}`);
  if (cash.open.length) lines.push(`- ${cash.open.length === 1 ? "Hay 1 caja abierta" : `Hay ${cash.open.length} cajas abiertas`}`);
  const closedToday = cash.closed.filter((c) => c.closed_at && c.closed_at.slice(0, 10) >= lastWeek && new Date(c.closed_at).toLocaleDateString("en-CA", { timeZone: TZ }) === today);
  for (const c of closedToday.slice(0, 2)) if (c.difference !== null && Math.abs(c.difference) >= 1) lines.push(`- Cierre de ${c.cashier || "una caja"} con diferencia de ${money(c.difference)}`);
  if (low.length) lines.push(`- ${low.length} ${low.length === 1 ? "producto quedó" : "productos quedaron"} en el mínimo de stock`);
  if (owner) {
    const v = await dashboard.voids(sql, uid, today).catch(() => null);
    if (v && (v.suspicious || v.review)) {
      const who = Object.entries(v.byUser).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n, c]) => `${n} (${c})`).join(", ");
      lines.push(`- Anulaciones: ${v.count} (${money(v.amount)} quitado de los tickets)${v.suspicious ? `, ${v.suspicious} sospechosa${v.suspicious > 1 ? "s" : ""}${who ? `: ${who}` : ""}` : ""}${v.review ? `, ${v.review} para revisar` : ""}. Miralas en Control de anulaciones.`);
    }
  }
  return { text: lines.join("\n"), total, count, pct, weekday };
}

/**
 * Cada hora: el resumen a quien lo pidió para esta hora. deps: { sql, sendText, sendTemplate,
 * logger, track }. Dentro de las 24 h va como mensaje común (gratis); si no, con la plantilla.
 */
async function dailySummaries(db, deps, now = Date.now()) {
  const hour = localHour(now);
  const snap = await db.collection(OWNERS).where("summary.hour", "==", hour).get();
  let sent = 0;
  for (const doc of snap.docs) {
    const o = doc.data();
    if (!o.summary || !o.summary.enabled) continue;
    const acc = await account(db, o.uid, now).catch(() => null);
    if (!acc || !acc.active || acc.plan === "agenda" || acc.plan === "agenda_pro") continue;
    if (o.role === "SUPERVISOR" && !(await supervisorsAllowed(db, o.uid))) continue;
    try {
      const s = await summaryText(deps.sql, o.uid, now, o.role !== "SUPERVISOR");
      if (now - ms(o.lastInboundAt) < WINDOW_MS) {
        await deps.sendText(doc.id, `${s.text}\n\n_Para dejar de recibirlo, mandá SIN RESUMEN._`);
      } else {
        const cmp = s.pct === null ? "sin datos del mismo día de la semana pasada" : `${s.pct >= 0 ? "+" : ""}${s.pct}% vs. el ${s.weekday} pasado`;
        await deps.sendTemplate(doc.id, SUMMARY_TEMPLATE, [money(s.total), String(s.count), cmp]);
        if (deps.track) deps.track(o.uid, { waSummaryTemplates: 1 });
      }
      sent++;
    } catch (err) {
      if (deps.logger) deps.logger.warn(`Resumen por WhatsApp (${o.uid}): ${err && err.message}`);
    }
  }
  return sent;
}

module.exports = { linkCode, status, unlink, setSupervisors, setSummary, onMessage, processInbox, dailySummaries, summaryText, waFormat, VENTRA_WA, OWNERS, LINKS, INBOX, SETTINGS, SUMMARY_TEMPLATE };
