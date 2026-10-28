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

/**
 * Un mensaje que llegó al número de Ventra. Devuelve true si era de alguien vinculado (o para
 * vincularse) y ya quedó atendido; false para que siga como antes (clientes de la agenda).
 */
async function onMessage(db, send, m, now = Date.now()) {
  const from = String(m.from || "");
  const text = m.type === "text" && m.text ? String(m.text.body || "").trim() : "";
  const id = String(m.id || `${from}-${now}`).replace(/[^\w.-]/g, "_").slice(0, 150);
  const enqueue = async (item) => {
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
  await owner.ref.set({ lastInboundAt: now }, { merge: true });
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
  if (!text) {
    await send(from, "Por ahora solo entiendo mensajes escritos. Escribime tu pregunta, por ejemplo: ¿cuánto vendí hoy?");
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
  const { from, uid } = item;
  const { ai, aiDeps, sql, send, logger } = deps;
  try {
    const ownerRef = db.collection(OWNERS).doc(from);
    const owner = await ownerRef.get();
    // Se desvinculó (o vinculó otro teléfono) entre que llegó el mensaje y ahora
    if (!owner.exists || owner.data().uid !== uid) return null;
    const o = owner.data();
    const acc = await account(db, uid, now);
    if (!acc || !acc.active) {
      return send(from, "El plan de Ventra de este comercio está vencido, así que no puedo leer los datos del negocio. Cuando se renueve, seguimos.");
    }
    if (o.role === "SUPERVISOR" && !(await supervisorsAllowed(db, uid))) {
      await ownerRef.delete();
      return send(from, "El dueño del comercio desactivó las preguntas por WhatsApp para los encargados.");
    }
    const info = await insights.storeInfo(sql, uid).catch(() => ({}));

    if (item.type === "welcome") {
      const hi = o.role === "SUPERVISOR" ? `¡Listo${o.name ? `, ${o.name}` : ""}! Ya podés preguntarme por ${info.name || "el negocio"}.` : `¡Listo! Ya podés preguntarme por ${info.name || "tu negocio"} cuando quieras.`;
      return send(from, `${hi}\n\n${agent.welcome({ plan: acc.plan, profile: info.profile, daily: ai.DAILY.ask, monthly: ai.LIMITS.ask })}\n\nSi querés, te mando el resumen del día: escribime *RESUMEN A LAS 21* (o la hora que quieras). Para dejar de usar esto, mandá *DESVINCULAR*.`);
    }

    // La pregunta anterior si fue hace poco: para "¿y ayer?"
    const history = o.lastQuestion && now - ms(o.lastAt) < 30 * 60 * 1000 ? [{ q: o.lastQuestion, a: o.lastAnswer || "" }] : [];
    const out = await ai.handle(aiDeps, uid, {
      kind: "agent", channel: "whatsapp", question: item.text, history, plan: acc.plan, role: o.role || "ADMIN", info,
    });
    const last = acc.plan === "agenda" || acc.plan === "agenda_pro" ? null : await insights.lastSync(sql, uid).catch(() => null);
    const answer = waFormat(out.result && out.result.answer);
    const note = acc.plan === "agenda" || acc.plan === "agenda_pro" ? "" : freshnessNote(last, now);
    await ownerRef.set({ lastQuestion: item.text, lastAnswer: answer.slice(0, 1200), lastAt: now, questions: (Number(o.questions) || 0) + 1 }, { merge: true });
    return send(from, (answer + note + leftNote(out.leftToday)).slice(0, 4000));
  } catch (err) {
    // Topes y errores de la IA: su mensaje ya está escrito para la persona
    if (ai && ai.AiError && err instanceof ai.AiError) return send(from, err.message);
    if (logger) logger.error(`Preguntas por WhatsApp: error (${uid})`, err);
    return send(from, "No pude responderte ahora. Probá de nuevo en un rato.");
  }
}

/** Texto del resumen del día (ventas, comparación con el mismo día de la semana pasada, caja) */
async function summaryText(sql, uid, now) {
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
      const s = await summaryText(deps.sql, o.uid, now);
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
