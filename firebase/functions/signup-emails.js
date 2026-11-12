// ═══════════════════════════════════════════════════
// Mails a quienes entran con Google en ventra.store y no compran un plan.
//
// Secuencia (días desde que se creó la cuenta de Google):
//   bienvenida (día 0) → cómo arrancar (día 1) → caso real, Paulos (día 3) → te ayudamos a cargar (día 7)
//
// - A quién: el mismo criterio del panel ("Registrados sin plan"): usuarios de Google sin cuenta en
//   ventra_accounts. También los que eligieron un plan y no terminaron de pagar (cuenta sin paidUntil).
//   Se corta apenas paga (paidUntil o status "active") o si se da de baja.
// - Lo que se mandó vive en ventra_signup_emails/{uid}, NO en ventra_accounts: crear la cuenta
//   haría desaparecer a la persona de "Registrados sin plan" y la trataría como cliente.
// - Nunca más de un mail cada 20 h. Si alguien se saltea pasos (cuentas viejas al publicar), se
//   manda solo el último que toca, no todos juntos. Cuentas de más de MAX_AGE_DAYS: nada.
// - La bienvenida sale a cualquier hora (es la respuesta a lo que acaba de hacer); el resto, de 9 a 21.
// - Baja con un toque: link firmado en cada mail + List-Unsubscribe (Gmail y Outlook lo muestran).
// - Cada envío se "reclama" en una transacción: dos ejecuciones nunca mandan dos veces.
// Sin la clave de Resend no se manda nada.
// ═══════════════════════════════════════════════════
const crypto = require("crypto");
const kit = require("./mail-kit");
const { FROM, WA_HELP, ms, esc, firstName, sendEmail, isSetupError, logSend, LOG } = kit;

const DAY = 24 * 3600 * 1000;
const HOUR = 3600 * 1000;
const UNSUB_URL = "https://us-central1-ventra-9cba5.cloudfunctions.net/ventraEmailBaja";
const MAX_AGE_DAYS = 10;
const MIN_GAP_MS = 20 * HOUR;
const SEND_FROM_MIN = 9 * 60, SEND_TO_MIN = 21 * 60;
const MAX_TRIES = 3;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const COLLECTION = "ventra_signup_emails";

const STEPS = [
  { key: "bienvenida", day: 0 },
  { key: "arrancar", day: 1 },
  { key: "paulos", day: 3 },
  { key: "ayuda", day: 7 },
];
const STEP_INDEX = Object.fromEntries(STEPS.map((s, i) => [s.key, i]));

// Promo del último mail: apagada hasta que el dueño la decida (ver notas). Cuando exista un cupón
// real que createVentraSubscription respete, se pone acá { code, text, untilDays }.
const PROMO = null;

/** Minutos desde la medianoche en Argentina (UTC-3, sin horario de verano). */
const localMin = (nowMs) => { const d = new Date(nowMs - 3 * HOUR); return d.getUTCHours() * 60 + d.getUTCMinutes(); };

/** ¿Ya pagó alguna vez o tiene el plan andando? Entonces no es "sin plan". */
const hasPlan = (a) => !!(a && (a.paidUntil || a.status === "active" || a.status === "authorized"));

/**
 * Las personas a las que les puede tocar un mail: usuarios de Google (con email) sin plan pago,
 * creados hace menos de MAX_AGE_DAYS. Pura.
 *   authUsers: [{ uid, email, name, createdAt (ISO o ms) }]
 *   accounts:  { uid: datos de ventra_accounts } (solo los que existen)
 */
function prospects(authUsers, accounts, { nowMs = Date.now(), exclude = [] } = {}) {
  const skip = new Set(exclude.map((e) => String(e).toLowerCase()));
  return authUsers.flatMap((u) => {
    const email = String(u.email || "").trim().toLowerCase();
    const createdMs = typeof u.createdAt === "string" ? Date.parse(u.createdAt) : ms(u.createdAt);
    if (!EMAIL_RE.test(email) || skip.has(email) || u.disabled || !createdMs) return [];
    if (nowMs - createdMs > MAX_AGE_DAYS * DAY) return [];
    const a = accounts[u.uid];
    if (hasPlan(a)) return [];
    return [{
      uid: u.uid, email, name: u.name || u.displayName || "", createdMs,
      // Eligió un plan en /empezar pero el pago no se completó
      pendingPlan: a && a.planName && a.status === "pending_payment" ? a.planName : null,
    }];
  });
}

/** Qué mail le toca ahora a esta persona (o null). Pura. state = ventra_signup_emails/{uid}. */
function nextStep(p, state = {}, nowMs = Date.now()) {
  if (state.unsubscribed) return null;
  const age = nowMs - p.createdMs;
  if (age < 0 || age > MAX_AGE_DAYS * DAY) return null;
  const sent = state.sent || {};
  const lastSent = Math.max(-1, ...Object.keys(sent).map((k) => (k in STEP_INDEX ? STEP_INDEX[k] : -1)));
  if (state.lastAt && nowMs - ms(state.lastAt) < MIN_GAP_MS) return null;
  const s = state.sending;
  if (s && nowMs - ms(s.at) < 10 * 60 * 1000) return null; // otra ejecución lo está mandando
  // El último paso cuyo día ya llegó y que va después del último mandado
  let due = null;
  STEPS.forEach((st, i) => { if (i > lastSent && age >= st.day * DAY) due = st; });
  if (!due) return null;
  if ((state.tries && state.tries[due.key]) >= MAX_TRIES) return null;
  // La bienvenida, solo recién creada (a una cuenta vieja no se le da la bienvenida)
  if (due.key === "bienvenida" && age > 2 * DAY) return null;
  if (due.key !== "bienvenida") {
    const m = localMin(nowMs);
    if (m < SEND_FROM_MIN || m >= SEND_TO_MIN) return null;
  }
  return due.key;
}

// ─── Baja ───
// Dos listas: "promo" (bienvenida, recordatorios, volvé y la ayuda para arrancar) y "resumen"
// (el resumen mensual). Los avisos de cobro y de seguridad no tienen baja: son parte del servicio.
const LISTS = { promo: { field: "unsubscribed", what: "los mails para ayudarte a empezar con Ventra y las novedades" }, resumen: { field: "unsubscribedSummary", what: "el resumen mensual de tu negocio" } };
function unsubToken(secret, uid, list = "promo") {
  return crypto.createHmac("sha256", `ventra-baja:${secret}`).update(list === "promo" ? String(uid) : `${list}:${uid}`).digest("base64url").slice(0, 22);
}
function validToken(secret, uid, token, list = "promo") {
  if (!secret || !uid || typeof token !== "string") return false;
  const want = Buffer.from(unsubToken(secret, uid, list)), got = Buffer.from(token);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
const unsubLink = (secret, uid, list = "promo") => `${UNSUB_URL}?u=${encodeURIComponent(uid)}&t=${unsubToken(secret, uid, list)}${list === "promo" ? "" : `&l=${list}`}`;

// ─── Plantillas ───
const utm = (step) => kit.utm("sin_plan", step);

/** Contenido de cada paso: asunto, texto previo (preheader), párrafos y botón. */
function content(step, p, { firstMail = false } = {}) {
  const hola = firstName(p.name) ? `¡Hola ${firstName(p.name)}!` : "¡Hola!";
  const empezar = `https://ventra.store/empezar?${utm(step)}`;
  const demo = `https://app.ventra.store/?${utm(step)}`;
  const pending = p.pendingPlan
    ? [`Vimos que elegiste <b>${esc(p.pendingPlan)}</b> pero el pago en Mercado Pago no se terminó. Si te dio error con el correo: en el último paso poné el correo de tu cuenta de Mercado Pago, aunque sea distinto del de Google.`]
    : [];
  switch (step) {
    case "bienvenida":
      return {
        subject: "Ya tenés tu cuenta de Ventra",
        preheader: "Lo que sigue para empezar a vender con Ventra.",
        title: `${hola} Ya tenés tu cuenta de Ventra`,
        paras: [
          ...pending,
          "Para empezar a usarla solo falta elegir el plan. Se paga mes a mes con Mercado Pago, sin contrato: te das de baja cuando quieras.",
          `¿Querés verlo antes? Probá la <a href="${demo}">demo</a> con datos de ejemplo, sin tarjeta.`,
        ],
        cta: ["Elegir mi plan", empezar],
        help: "¿Alguna duda? Escribinos por WhatsApp y te responde una persona del equipo.",
      };
    case "arrancar":
      return {
        subject: "Cómo arrancar con Ventra, paso por paso",
        preheader: "Cuatro pasos y ya estás vendiendo.",
        title: `${hola} Así se arranca con Ventra`,
        paras: [
          ...pending,
          "<b>1.</b> Elegís qué negocio tenés.<br><b>2.</b> Elegís el plan: Full si tenés un local, Tienda si vendés por Instagram o WhatsApp, Agenda si trabajás con turnos.<br><b>3.</b> Entrás con tu cuenta de Google (no hay otra contraseña).<br><b>4.</b> Pagás con Mercado Pago, mes a mes.",
          "Después usás Ventra desde el navegador, en la compu o el celular. Si tenés local, también podés instalar la caja en la PC: sigue vendiendo aunque se corte internet.",
        ],
        cta: ["Empezar ahora", empezar],
        help: "Si te trabás en algún paso, mandanos un WhatsApp y lo hacemos juntos.",
      };
    case "paulos":
      return {
        subject: "Cómo lo usa Maxikiosco Paulos",
        preheader: "Más de 5.500 productos, todos los días con Ventra.",
        title: "Maxikiosco Paulos vende todos los días con Ventra",
        paras: [
          `${hola} Te contamos un caso real. Maxikiosco Paulos usa Ventra desde diciembre de 2025, con más de 5.500 productos.`,
          "Cobra en la caja con lector de código de barras y tiene el stock al día. Lo mismo te sirve a vos: la caja cierra con el detalle de efectivo, Mercado Pago y tarjetas, y si querés, la tienda online usa el mismo stock y los mismos precios.",
          `Podés verlos en Instagram: <a href="https://www.instagram.com/kiosco_paulos/">@kiosco_paulos</a>.`,
          ...pending,
        ],
        cta: ["Quiero lo mismo para mi negocio", empezar],
        help: "¿Querés saber si te sirve para tu rubro? Preguntanos por WhatsApp.",
      };
    case "ayuda":
      return {
        subject: "Te ayudamos a cargar tus productos",
        preheader: "Pasanos tu lista y la cargamos con vos.",
        title: `${hola} No arranques de cero: te ayudamos`,
        paras: [
          "Lo que más cuesta al empezar es cargar todo. Por eso te damos una mano: mandanos tu lista de productos y precios (un Excel, una planilla o la lista del proveedor) y la pasamos a Ventra con vos. Si trabajás con turnos, te ayudamos a armar tus servicios y horarios.",
          "Y una vez adentro, las boletas de los proveedores se cargan con una foto desde el celular: suma el stock y actualiza los costos.",
          ...pending,
          ...(PROMO ? [`<b>${esc(PROMO.text)}</b> Usá el código <b>${esc(PROMO.code)}</b> antes de que venza.`] : []),
          firstMail ? "Cuando quieras empezar, tu cuenta te espera." : "Este es el último mail que te mandamos sobre esto. Cuando quieras empezar, tu cuenta te espera.",
        ],
        cta: ["Elegir mi plan", empezar],
        help: "Para que te ayudemos a cargar, escribinos por WhatsApp.",
      };
    default:
      throw new Error(`Paso desconocido: ${step}`);
  }
}

/** Asunto, HTML y texto del mail. Pura. */
function emailFor(step, p, { unsubUrl, firstMail } = {}) {
  const c = content(step, p, { firstMail });
  const baja = unsubUrl || "#";
  return kit.render({
    ...c,
    footer: `Te escribimos porque creaste tu cuenta en <a href="https://ventra.store/?${utm(step)}" style="color:#8A958F">ventra.store</a> con ${esc(p.email)}.<br>¿No querés recibir más estos mails? <a href="${esc(baja)}" style="color:#8A958F">Darme de baja</a>.`,
    footerText: `Te escribimos porque creaste tu cuenta en ventra.store con ${p.email}.\nDarme de baja: ${baja}`,
  });
}

/**
 * Tarea programada: manda el mail que le toca a cada uno.
 * deps: { apiKey, listUsers: () => Promise<[{uid,email,name,createdAt}]>, send?, now?, exclude?, logger?, admin }
 */
async function signupEmailsRun(db, deps) {
  const { apiKey, listUsers, admin, exclude = [], logger = console } = deps;
  const send = deps.send || sendEmail;
  // Sin clave igual se cuenta a cuántos les toca un mail, para mostrarlo en el admin
  const keyOk = !!(apiKey && apiKey.startsWith("re_"));
  const now = deps.now || Date.now();
  const users = (await listUsers()).filter((u) => {
    const c = typeof u.createdAt === "string" ? Date.parse(u.createdAt) : ms(u.createdAt);
    return c && now - c <= MAX_AGE_DAYS * DAY;
  });
  const none = { sent: 0, failed: 0, candidates: 0, due: 0, ...(keyOk ? {} : { skipped: "sin configurar" }) };
  if (!users.length) return none;
  const accRefs = users.map((u) => db.collection("ventra_accounts").doc(u.uid));
  const accSnaps = await db.getAll(...accRefs);
  const accounts = {};
  accSnaps.forEach((s) => { if (s.exists) accounts[s.id] = s.data(); });
  const list = prospects(users, accounts, { nowMs: now, exclude });
  if (!list.length) return none;
  const stateSnaps = await db.getAll(...list.map((p) => db.collection(COLLECTION).doc(p.uid)));
  const states = {};
  stateSnaps.forEach((s) => { states[s.id] = s.exists ? s.data() : {}; });
  const due = list.filter((p) => nextStep(p, states[p.uid], now)).length;
  if (!keyOk) return { ...none, candidates: list.length, due };

  let sent = 0, failed = 0;
  for (const p of list) {
    if (!nextStep(p, states[p.uid], now)) continue;
    const ref = db.collection(COLLECTION).doc(p.uid);
    const step = await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      const st = cur.exists ? cur.data() : {};
      const k = nextStep(p, st, now);
      if (!k) return null;
      tx.set(ref, { email: p.email, sending: { step: k, at: admin.firestore.Timestamp.fromMillis(now) } }, { merge: true });
      return k;
    });
    if (!step) continue;
    const unsubUrl = unsubLink(apiKey, p.uid);
    let built = null;
    try {
      // Si es el primer mail que le llega (se saltearon pasos), el del día 7 no dice "este es el último"
      built = emailFor(step, p, { unsubUrl, firstMail: !Object.keys((states[p.uid] || {}).sent || {}).length });
      const { subject, html, text } = built;
      const data = await send(apiKey, {
        from: FROM, to: [p.email], subject, html, text,
        headers: { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        tags: [{ name: "kind", value: "sin_plan" }, { name: "step", value: step }],
      });
      await ref.set({
        sent: { [step]: admin.firestore.Timestamp.fromMillis(now) }, lastAt: admin.firestore.Timestamp.fromMillis(now),
        lastId: data.id || null, sending: admin.firestore.FieldValue.delete(),
      }, { merge: true });
      await logSend(db, admin, now, { kind: "sin_plan", step, uid: p.uid, to: p.email, channel: "mail", ok: true, id: data.id, msg: built });
      sent++;
    } catch (err) {
      // 401/403: problema de la cuenta de Resend (clave o dominio sin verificar), no de esta persona.
      // No se le cuenta el intento y se corta la pasada: sale todo cuando se arregle.
      const setup = isSetupError(err);
      const fatal = !setup && err.status && err.status < 500 && err.status !== 429;
      await ref.set({
        sending: admin.firestore.FieldValue.delete(),
        ...(setup ? {} : { tries: { [step]: admin.firestore.FieldValue.increment(fatal ? MAX_TRIES : 1) } }),
        lastError: String(err.message).slice(0, 200),
      }, { merge: true }).catch(() => {});
      logger.warn("Mails sin plan: no se pudo mandar", { uid: p.uid, step, error: err.message });
      await logSend(db, admin, now, { kind: "sin_plan", step, uid: p.uid, to: p.email, channel: "mail", ok: false, error: err.message, msg: built });
      failed++;
      if (setup) return { sent, failed, candidates: list.length, due, skipped: `Resend: ${String(err.message).slice(0, 120)}` };
    }
  }
  return { sent, failed, candidates: list.length, due };
}

// ─── Registro para el admin ───
// Cada envío (bien o con error) queda en ventra_email_log (mail-kit.logSend); cada pasada, en ventra_config/emailBot.
const LOG_KEEP_DAYS = 120;
async function saveRun(db, admin, nowMs, signup, grace, extra = {}) {
  // merge: daily y monthly los escriben otras tareas (index.js)
  await db.collection("ventra_config").doc("emailBot").set({ lastRunAt: admin.firestore.Timestamp.fromMillis(nowMs), signup, grace, ...extra }, { merge: true }).catch(() => {});
}

/** Lo que muestra el admin: estado de la última pasada, últimos envíos y bajas. */
async function report(db, { nowMs = Date.now() } = {}) {
  const t = (x) => ms(x) || null;
  const [run, logSnap, unsubSnap, unsubSummarySnap] = await Promise.all([
    db.collection("ventra_config").doc("emailBot").get(),
    db.collection(LOG).orderBy("at", "desc").limit(150).get(),
    db.collection(COLLECTION).where("unsubscribed", "==", true).get(),
    db.collection(COLLECTION).where("unsubscribedSummary", "==", true).get(),
  ]);
  const r = run.exists ? run.data() : {};
  const items = logSnap.docs.map((d) => { const x = d.data(); return { ...x, logId: d.id, at: t(x.at) }; });
  const since30 = nowMs - 30 * DAY;
  const last30 = items.filter((x) => x.at >= since30);
  const byStep = {};
  last30.filter((x) => x.ok).forEach((x) => { const k = `${x.kind}:${x.step}`; byStep[k] = (byStep[k] || 0) + 1; });
  return {
    lastRunAt: t(r.lastRunAt), signup: r.signup || null, grace: r.grace || null,
    sent30: last30.filter((x) => x.ok).length, failed30: last30.filter((x) => !x.ok).length, byStep,
    unsubscribed: unsubSnap.size, unsubscribedSummary: unsubSummarySnap.size, items: items.slice(0, 100),
    monthly: r.monthly ? { ...r.monthly, at: t(r.monthly.at) } : null, daily: r.daily ? { ...r.daily, at: t(r.daily.at) } : null,
    steps: STEPS.map((s) => s.key), waTemplateOn: GRACE_WA_TEMPLATE.enabled,
  };
}

/**
 * Un mail del registro, completo, para verlo en el admin tal cual le llegó.
 * Desde el 12/11/2026 cada envío guarda su asunto y HTML (kit.BODIES). Los de antes se reconstruyen con la
 * misma plantilla y los datos de la persona (solo el link de baja, que era personal, no se puede rehacer).
 */
async function viewEmail(db, admin, logId) {
  const logSnap = await db.collection(LOG).doc(String(logId || "")).get();
  if (!logSnap.exists) throw Object.assign(new Error("No existe ese mail"), { status: 404 });
  const x = logSnap.data();
  const base = { kind: x.kind, step: x.step, to: x.to, at: ms(x.at), ok: !!x.ok, error: x.error || null, channel: x.channel || "mail", from: FROM };
  const body = await db.collection(kit.BODIES).doc(logSnap.id).get();
  if (body.exists) { const b = body.data(); return { ...base, exact: true, subject: b.subject, html: b.html, text: b.text, from: b.from || FROM }; }
  if (base.channel !== "mail") return { ...base, exact: false, note: "Fue un mensaje de WhatsApp con una plantilla de Meta: no hay mail para mostrar." };
  const nowMs = ms(x.at);
  try {
    if (x.kind === "sin_plan" && x.uid) {
      const [u, acc] = await Promise.all([admin.auth().getUser(x.uid).catch(() => null), db.collection("ventra_accounts").doc(x.uid).get()]);
      const a = acc.exists ? acc.data() : null;
      const p = { uid: x.uid, email: x.to || (u && u.email) || "", name: (u && u.displayName) || "", createdMs: u ? Date.parse(u.metadata.creationTime) : 0,
        pendingPlan: a && a.planName && a.status === "pending_payment" ? a.planName : null };
      const m = emailFor(x.step, p, { unsubUrl: "#baja-personal" });
      return { ...base, ...m, exact: false, note: "Reconstruido con la misma plantilla y los datos de la persona: es el mismo texto que le llegó (el link para darse de baja era personal y acá no funciona)." };
    }
    if (x.kind === "gracia" && x.uid) {
      const acc = await db.collection("ventra_accounts").doc(x.uid).get();
      if (acc.exists) {
        const m = graceEmailFor(x.step, { uid: x.uid, ...acc.data() }, nowMs);
        return { ...base, ...m, exact: false, note: "Reconstruido con la plantilla y los datos actuales de la cuenta: si cambió el plan o la fecha de pago, puede diferir en eso." };
      }
    }
  } catch (err) { /* sigue abajo */ }
  return { ...base, exact: false, note: "Este mail salió antes de que se empezaran a guardar completos (12/11/2026) y no se puede reconstruir." };
}

/** Borra los registros de más de LOG_KEEP_DAYS días (se llama de vez en cuando desde la pasada). */
async function pruneLog(db, admin, nowMs) {
  const old = await db.collection(LOG).where("at", "<", admin.firestore.Timestamp.fromMillis(nowMs - LOG_KEEP_DAYS * DAY)).limit(200).get();
  await Promise.all(old.docs.map((d) => Promise.all([d.ref.delete(), db.collection(kit.BODIES).doc(d.id).delete().catch(() => {})])));
  return old.size;
}

/** Página de baja. GET muestra el botón (así los antivirus que abren links no dan de baja a nadie); POST da de baja. */
async function handleUnsub(db, req, res, { secret, admin }) {
  const uid = String((req.query && req.query.u) || "");
  const token = String((req.query && req.query.t) || "");
  const list = LISTS[String((req.query && req.query.l) || "promo")] ? String((req.query && req.query.l) || "promo") : "promo";
  const L = LISTS[list];
  const page = (title, body, status = 200) => res.status(status).set("Content-Type", "text/html; charset=utf-8").send(
    `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title></head><body style="margin:0;background:#F6F2EC;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0F1F1A"><div style="max-width:440px;margin:0 auto;padding:48px 16px"><div style="background:#fff;border-radius:20px;padding:28px 24px;border:1px solid #E4DDD1"><h1 style="margin:0 0 12px;font-size:21px">${esc(title)}</h1>${body}</div></div></body></html>`);
  if (!validToken(secret, uid, token, list)) return page("El link no es válido", `<p style="font-size:15px;line-height:1.5">Si querés dejar de recibir mails de Ventra, escribinos por <a href="${WA_HELP}" style="color:#167160">WhatsApp</a> y lo hacemos al instante.</p>`, 400);
  if (req.method === "POST") {
    await db.collection(COLLECTION).doc(uid).set({ [L.field]: true, [`${L.field}At`]: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    return page("Listo, te diste de baja", `<p style="font-size:15px;line-height:1.5">No te vamos a mandar más ${esc(L.what)}. Tu cuenta sigue igual, y los avisos de tu suscripción (pagos y vencimientos) te siguen llegando.</p>`);
  }
  return page("¿Dejar de recibir estos mails?", `<p style="font-size:15px;line-height:1.5">Vas a dejar de recibir ${esc(L.what)}.</p><form method="post"><button style="width:100%;border:0;background:#167160;color:#fff;font:600 15px inherit;border-radius:999px;padding:14px;cursor:pointer">Darme de baja</button></form>`);
}

// ═══ Aviso de pago: cuentas en período de gracia ═══
// Venció paidUntil y hay GRACE_DAYS días en los que todo anda; después, solo lectura.
// Dos avisos por vencimiento: "inicio" (apenas vence) y "fin" (faltan 2 días o menos).
// Es un aviso de la suscripción, no promoción: la baja de los mails de bienvenida no lo corta.
// Queda guardado por vencimiento en ventra_signup_emails/{uid}.grace["AAAA-MM-DD"]: el mes que viene
// vuelve a avisar si hace falta.
// WhatsApp: además del mail, a los teléfonos del dueño vinculados al bot (ventra_wa_owners, no los de
// los encargados), con una plantilla de Meta. Apagado hasta que la plantilla esté aprobada.
const { GRACE_DAYS } = require("./subscription-rules");
const GRACE_WA_TEMPLATE = { name: "suscripcion_vencida", lang: "es_AR", enabled: false };

/** Qué aviso de pago le toca a esta cuenta: { key, step } o null. Pura. */
function graceStep(account, state = {}, nowMs = Date.now()) {
  const until = ms(account && account.paidUntil);
  if (!until || nowMs <= until) return null;
  const graceEnd = until + GRACE_DAYS * DAY;
  // Pasada la gracia: un aviso de "solo lectura" dentro de los 2 días siguientes
  if (nowMs >= graceEnd + 2 * DAY) return null;
  const m = localMin(nowMs);
  if (m < SEND_FROM_MIN || m >= SEND_TO_MIN) return null;
  if (state.graceSending && nowMs - ms(state.graceSending.at) < 10 * 60 * 1000) return null;
  const key = new Date(until - 3 * HOUR).toISOString().slice(0, 10);
  const done = (state.grace && state.grace[key]) || {};
  const tries = done.tries || {};
  if (nowMs >= graceEnd) return done.bloqueo || tries.bloqueo >= MAX_TRIES ? null : { key, step: "bloqueo" };
  if (graceEnd - nowMs <= 2 * DAY) return done.fin || tries.fin >= MAX_TRIES ? null : { key, step: "fin" };
  if (done.inicio || done.fin || tries.inicio >= MAX_TRIES) return null;
  return { key, step: "inicio" };
}

const graceDaysLeft = (account, nowMs) => Math.max(1, Math.ceil((ms(account.paidUntil) + GRACE_DAYS * DAY - nowMs) / DAY));
const daysText = (n) => (n === 1 ? "1 día" : `${n} días`);

/** Mail del aviso de pago. Pura. */
function graceEmailFor(step, account, nowMs = Date.now()) {
  const dias = daysText(graceDaysLeft(account, nowMs));
  const plan = account.planName || "tu plan de Ventra";
  const hola = kit.hola(account.name);
  const cuenta = `https://ventra.store/cuenta.html?utm_source=email&utm_medium=gracia&utm_campaign=${step}`;
  const c = step === "bloqueo" ? {
    subject: `Ventra quedó en solo lectura: renová ${plan} para seguir vendiendo`,
    preheader: "Tus datos están a salvo. Apenas renovás, vuelve todo.",
    badge: ["Solo lectura", "danger"],
    title: `${hola} Ventra quedó en solo lectura`,
    paras: [
      `Pasaron los 7 días de gracia sin que llegara el pago de <b>${esc(plan)}</b>, así que Ventra quedó en <b>solo lectura</b>: podés ver tus datos, pero no vender ni cargar nada.`,
      "<b>Tus datos están a salvo:</b> productos, clientes, ventas y turnos quedan guardados tal cual. Apenas renovás, vuelve todo a la normalidad, y el mes nuevo arranca desde el día del pago (no se cobran los días bloqueados).",
    ],
    cta: ["Renovar y volver a vender", cuenta],
  } : step === "inicio" ? {
    subject: `Tu suscripción a ${plan} venció: tenés ${dias} para renovarla`,
    preheader: "Ventra sigue funcionando normal mientras tanto.",
    badge: ["Período de gracia", "warn"],
    title: `${hola} Tu suscripción venció`,
    paras: [
      `No nos llegó el pago de <b>${esc(plan)}</b>. Tranqui: Ventra sigue funcionando normal ${dias} más, y esos días se descuentan del próximo mes.`,
      "Para no cortar las ventas, renovala desde Mi cuenta. Si pagás con Mercado Pago, fijate que la tarjeta no esté vencida o sin saldo.",
      "Si ya pagaste, no hace falta que hagas nada: el pago puede tardar unas horas en aparecer.",
    ],
    cta: ["Renovar mi suscripción", cuenta],
  } : {
    subject: `Quedan ${dias} para renovar ${plan}`,
    preheader: "Después Ventra queda en solo lectura y no deja vender.",
    badge: [`Faltan ${dias}`, "warn"],
    title: `Quedan ${dias} para renovar`,
    paras: [
      `${hola} Seguimos sin recibir el pago de <b>${esc(plan)}</b>. En ${dias} Ventra pasa a <b>solo lectura</b>: vas a poder ver tus datos, pero no vender ni cargar nada.`,
      "No perdés nada: tus productos, clientes y ventas quedan guardados. Apenas renovás, vuelve todo a la normalidad.",
      "Si ya pagaste, no hace falta que hagas nada.",
    ],
    cta: ["Renovar ahora", cuenta],
  };
  return kit.render({
    ...c,
    helpHuman: true,
    help: "¿Pagás por transferencia o tenés algún problema con el pago? Escribinos por WhatsApp y lo resolvemos.",
    footer: `Es un aviso sobre tu suscripción a Ventra (${esc(account.email || "")}).`,
  });
}

/** Variables de la plantilla de WhatsApp: {{1}} plan, {{2}} días que quedan. Pura. */
const graceWaParams = (account, nowMs = Date.now()) => [account.planName || "Ventra", daysText(graceDaysLeft(account, nowMs))];

/**
 * Pasada de avisos de pago: cuentas con paidUntil entre hace GRACE_DAYS días y ahora.
 * deps: { apiKey, admin, send?, sendWaTemplate?(to, template, params), now?, exclude?, logger? }
 */
async function graceEmailsRun(db, deps) {
  const { apiKey, admin, exclude = [], logger = console } = deps;
  const send = deps.send || sendEmail;
  const mailOn = !!(apiKey && apiKey.startsWith("re_"));
  const waOn = !!(GRACE_WA_TEMPLATE.enabled && deps.sendWaTemplate);
  const now = deps.now || Date.now();
  const skip = new Set(exclude.map((e) => String(e).toLowerCase()));
  const snap = await db.collection("ventra_accounts")
    .where("paidUntil", ">", admin.firestore.Timestamp.fromMillis(now - (GRACE_DAYS + 2) * DAY))
    .where("paidUntil", "<", admin.firestore.Timestamp.fromMillis(now)).get();
  const accounts = snap.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((a) => !skip.has(String(a.email || "").toLowerCase()));
  const none = { sent: 0, failed: 0, wa: 0, inGrace: 0, due: 0, ...(mailOn || waOn ? {} : { skipped: "sin configurar" }) };
  if (!accounts.length) return none;
  const states = {};
  (await db.getAll(...accounts.map((a) => db.collection(COLLECTION).doc(a.uid)))).forEach((s) => { states[s.id] = s.exists ? s.data() : {}; });
  const due = accounts.filter((a) => graceStep(a, states[a.uid], now)).length;
  if (!mailOn && !waOn) return { ...none, inGrace: accounts.length, due };
  let sent = 0, failed = 0, wa = 0;
  for (const a of accounts) {
    if (!graceStep(a, states[a.uid], now)) continue;
    const ref = db.collection(COLLECTION).doc(a.uid);
    const due = await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      const g = graceStep(a, cur.exists ? cur.data() : {}, now);
      if (g) tx.set(ref, { graceSending: { ...g, at: admin.firestore.Timestamp.fromMillis(now) } }, { merge: true });
      return g;
    });
    if (!due) continue;
    const at = admin.firestore.Timestamp.fromMillis(now);
    let ok = false, error = null, built = null;
    if (mailOn && EMAIL_RE.test(String(a.email || ""))) {
      try {
        built = graceEmailFor(due.step, a, now);
        const { subject, html, text } = built;
        const data = await send(apiKey, { from: FROM, to: [String(a.email).toLowerCase()], subject, html, text, tags: [{ name: "kind", value: "gracia" }, { name: "step", value: due.step }] });
        ok = true;
        await logSend(db, admin, now, { kind: "gracia", step: due.step, uid: a.uid, to: a.email, channel: "mail", ok: true, id: data && data.id, msg: built });
      } catch (err) {
        error = err;
        await logSend(db, admin, now, { kind: "gracia", step: due.step, uid: a.uid, to: a.email, channel: "mail", ok: false, error: err.message, msg: built });
      }
    }
    if (waOn && due.step !== "bloqueo") {
      const phones = await db.collection("ventra_wa_owners").where("uid", "==", a.uid).get().catch(() => ({ docs: [] }));
      for (const d of phones.docs.filter((x) => x.data().role !== "SUPERVISOR")) {
        const to = `•••• ${d.id.slice(-4)}`;
        try {
          await deps.sendWaTemplate(d.id, GRACE_WA_TEMPLATE, graceWaParams(a, now)); ok = true; wa++;
          await logSend(db, admin, now, { kind: "gracia", step: due.step, uid: a.uid, to, channel: "whatsapp", ok: true });
        } catch (err) {
          error = error || err;
          await logSend(db, admin, now, { kind: "gracia", step: due.step, uid: a.uid, to, channel: "whatsapp", ok: false, error: err.message });
        }
      }
    }
    if (ok) {
      await ref.set({ grace: { [due.key]: { [due.step]: at } }, graceSending: admin.firestore.FieldValue.delete() }, { merge: true });
      sent++;
    } else {
      const setup = isSetupError(error);
      const fatal = !setup && (!error || (error.status && error.status < 500 && error.status !== 429));
      await ref.set({ graceSending: admin.firestore.FieldValue.delete(), ...(setup ? {} : { grace: { [due.key]: { tries: { [due.step]: admin.firestore.FieldValue.increment(fatal ? MAX_TRIES : 1) } } } }), lastError: String((error && error.message) || "sin mail ni WhatsApp").slice(0, 200) }, { merge: true }).catch(() => {});
      logger.warn("Aviso de gracia: no se pudo mandar", { uid: a.uid, step: due.step, error: error && error.message });
      failed++;
      if (setup) return { sent, failed, wa, inGrace: accounts.length, due, skipped: `Resend: ${String(error.message).slice(0, 120)}` };
    }
  }
  return { sent, failed, wa, inGrace: accounts.length, due };
}

module.exports = {
  STEPS, MAX_AGE_DAYS, COLLECTION, FROM, GRACE_WA_TEMPLATE,
  prospects, nextStep, emailFor, content, unsubToken, validToken, unsubLink, signupEmailsRun, handleUnsub, hasPlan, localMin,
  graceStep, graceEmailFor, graceWaParams, graceEmailsRun, report, saveRun, pruneLog, LOG, viewEmail,
};
