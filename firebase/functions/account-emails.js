// ═══════════════════════════════════════════════════
// Mails a los clientes que pagan (los de quienes no tienen plan y los de gracia están en signup-emails.js).
//
// Al momento (disparados por cambios en Firestore):
//   pago        un cobro acreditado (ventra_accounts/{uid}/payments): comprobante; si es el primero,
//               la bienvenida con los primeros pasos de su plan
//   rechazo     Mercado Pago no pudo cobrar (ventra_accounts/{uid}/payment_issues, lo escribe el webhook)
//   pc          se vinculó una PC (ventra_devices)
//   plan        cambió de plan (ventra_accounts)
// Una vez por día (10 h):
//   aviso       3 días antes del próximo cobro de Mercado Pago
//   arranque    a los 3 días del primer pago, si todavía no usó nada (sin caja sincronizada ni tienda/agenda)
//   volve       a los 30 días de quedar en solo lectura, una sola vez
// El 1° de cada mes:
//   resumen     lo que vendió el mes anterior (caja, turnos, pedidos online)
//
// - Cada mail se manda una sola vez: se "reclama" en ventra_signup_emails/{uid}.once[clave] en una transacción.
// - Los de cobro, seguridad y plan no tienen baja (son del servicio). "arranque" y "volve" respetan la baja
//   de promociones; "resumen" tiene su propia baja.
// - Todos quedan en ventra_email_log y se ven en el admin.
// ═══════════════════════════════════════════════════
const kit = require("./mail-kit");
const { esc, ms, money, longDate, shortDate, hola } = kit;
// Clientes que pagan: su WhatsApp va directo a una persona (no al asistente)
const render = (c) => kit.render({ helpHuman: true, ...c });
const { GRACE_DAYS } = require("./subscription-rules");

const DAY = 24 * 3600 * 1000;
const COLLECTION = "ventra_signup_emails";
const MAX_TRIES = 3;
const APP = "https://web.ventra.store";
const CUENTA = (campaign) => `https://ventra.store/cuenta.html?${kit.utm("cuenta", campaign)}`;
const isAgenda = (plan) => plan === "agenda" || plan === "agenda_pro";
const pct = (now, before) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

const footerAccount = (a) => `Es un aviso sobre tu cuenta de Ventra (${esc(a.email || "")}).`;

// ─── Plantillas (puras) ───

/** Primeros pasos según el plan, para la bienvenida al pagar. */
function firstSteps(plan) {
  if (isAgenda(plan)) {
    return [
      `<b>1. Cargá tus servicios y horarios.</b> Entrá a <a href="${APP}">web.ventra.store</a> desde la compu o el celular: servicios, duración, precio y quién atiende.`,
      "<b>2. Compartí tu link de turnos</b> en Instagram, WhatsApp o Google, así tus clientes reservan solos.",
      plan === "agenda_pro" ? "<b>3. Listo:</b> el recordatorio por WhatsApp sale solo antes de cada turno (200 por mes incluidos)." : "<b>3. Recordá los turnos</b> por WhatsApp con un toque, desde la agenda.",
    ];
  }
  if (plan === "tienda") {
    return [
      `<b>1. Armá tu tienda.</b> En <a href="${APP}">web.ventra.store</a> cargá el logo, los colores y los productos con fotos y precios.`,
      "<b>2. Compartí el link</b> en tu Instagram y tu WhatsApp. Los pedidos te llegan ordenados al celular.",
      "<b>3. Probá un pedido</b> vos mismo para ver cómo lo recibe el cliente.",
    ];
  }
  return [
    `<b>1. Instalá la caja.</b> Bajala desde <a href="${CUENTA("bienvenida_pago")}">Mi cuenta</a> y vinculá la PC con el código de 8 caracteres que muestra. También podés usarla desde el navegador, en <a href="${APP}">web.ventra.store</a>.`,
    "<b>2. Cargá tus productos.</b> Con el lector de código de barras, desde un Excel, o mandanos la lista por WhatsApp y te ayudamos.",
    "<b>3. Abrí la caja y vendé.</b> Tu tienda online usa el mismo stock y los mismos precios: activala cuando quieras.",
  ];
}

/** Comprobante de un pago; el primero es además la bienvenida. */
function paymentEmail(p, a) {
  const plan = a.planName || "Ventra";
  const rows = [
    ["Plan", plan],
    ["Monto", money(p.amount)],
    ["Fecha", shortDate(p.paidAt)],
    ["Medio", p.manual ? (p.method && p.method !== "manual" ? p.method : "Pago directo") : "Mercado Pago"],
    ...(p.months > 1 ? [["Meses", String(p.months)]] : []),
    ["Tu plan sigue hasta", shortDate(p.newPaidUntil)],
  ];
  const first = !p.previousPaidUntil;
  if (first) {
    return render({
      subject: `¡Ya tenés ${plan}! Tus primeros pasos`,
      preheader: "Recibimos tu pago. Así arrancás hoy mismo.",
      badge: ["Pago recibido", "ok"],
      title: `${hola(a.name)} Ya sos parte de Ventra`,
      paras: ["Recibimos tu pago y tu plan ya está activo. Así arrancás hoy mismo:", ...firstSteps(a.plan)],
      rows,
      cta: isAgenda(a.plan) || a.plan === "tienda" ? ["Entrar a Ventra", APP] : ["Ir a Mi cuenta", CUENTA("bienvenida_pago")],
      help: "¿Querés que te ayudemos a cargar todo? Escribinos por WhatsApp y lo hacemos juntos.",
      footer: `${footerAccount(a)} Guardá este mail como comprobante del pago.`,
    });
  }
  return render({
    subject: `Recibimos tu pago de ${plan}`,
    preheader: `Tu plan sigue hasta el ${longDate(p.newPaidUntil)}.`,
    badge: ["Pago recibido", "ok"],
    title: `${hola(a.name)} Recibimos tu pago`,
    paras: [`Gracias por seguir con Ventra. Tu plan <b>${esc(plan)}</b> sigue activo hasta el <b>${esc(longDate(p.newPaidUntil))}</b>.`],
    rows,
    cta: ["Ver mi cuenta", CUENTA("pago")],
    help: "¿Necesitás factura o tenés alguna duda con el pago? Escribinos por WhatsApp.",
    footer: `${footerAccount(a)} Guardá este mail como comprobante del pago.`,
  });
}

/** 3 días antes del cobro automático. */
function preChargeEmail(a, amount) {
  const plan = a.planName || "Ventra";
  return render({
    subject: `El ${longDate(a.paidUntil)} se renueva ${plan}`,
    preheader: `Te cobramos ${money(amount)} con Mercado Pago, como todos los meses.`,
    badge: ["Próximo cobro", "info"],
    title: `${hola(a.name)} Se renueva tu plan`,
    paras: [
      `El <b>${esc(longDate(a.paidUntil))}</b> se renueva <b>${esc(plan)}</b> y Mercado Pago te cobra <b>${esc(money(amount))}</b>, como todos los meses. No tenés que hacer nada.`,
      "Para que no falle, fijate que la tarjeta que usás en Mercado Pago no esté vencida y tenga saldo. Si querés cambiar de plan o darte de baja, lo hacés desde Mi cuenta.",
    ],
    rows: [["Plan", plan], ["Monto", money(amount)], ["Fecha", shortDate(a.paidUntil)]],
    cta: ["Ver mi cuenta", CUENTA("aviso_cobro")],
    footer: footerAccount(a),
  });
}

/** Mercado Pago no pudo cobrar. */
function paymentFailedEmail(issue, a) {
  const plan = a.planName || "Ventra";
  return render({
    subject: `No pudimos cobrar ${plan}: revisá tu tarjeta`,
    preheader: "Actualizá el medio de pago para que Ventra no se corte.",
    badge: ["Pago rechazado", "danger"],
    title: `${hola(a.name)} No pudimos cobrar tu plan`,
    paras: [
      `Mercado Pago intentó cobrar <b>${esc(plan)}</b>${issue.amount ? ` (${esc(money(issue.amount))})` : ""} y el pago fue rechazado. Suele pasar con una tarjeta vencida, sin saldo o con un límite.`,
      "<b>Qué hacer:</b> en la app de Mercado Pago entrá a <b>Suscripciones</b>, elegí Ventra y cambiá la tarjeta. Mercado Pago lo vuelve a intentar solo en los próximos días.",
      "Mientras tanto Ventra sigue funcionando normal. Si querés pagar de otra forma, escribinos.",
    ],
    cta: ["Ver mi cuenta", CUENTA("rechazo")],
    help: "¿Preferís pagar por transferencia? Escribinos por WhatsApp.",
    footer: footerAccount(a),
  });
}

/** 30 días después de quedar en solo lectura. */
function winbackEmail(a, { unsubUrl } = {}) {
  const baja = unsubUrl || "#";
  return render({
    subject: "Tus datos siguen en Ventra (y hay cosas nuevas)",
    preheader: "Volvé cuando quieras: todo está como lo dejaste.",
    title: `${hola(a.name)} Tu Ventra te está esperando`,
    paras: [
      "Hace un mes que tu cuenta quedó en solo lectura. Tus productos, clientes y ventas siguen guardados tal cual: si volvés, arrancás donde lo dejaste.",
      "Desde entonces sumamos cosas que ahorran horas:<br>• <b>Boletas con una foto:</b> sacale una foto a la boleta del proveedor y se carga el stock y los costos.<br>• <b>Ventra por WhatsApp:</b> preguntale cuánto vendiste o cambiale un precio con un audio.<br>• <b>Aumentos en un toque:</b> subí los precios por grupos, con deshacer.",
    ],
    cta: ["Volver a Ventra", CUENTA("volve")],
    help: "¿Algo no te convenció? Contanos por WhatsApp: lo leemos todo.",
    footer: `${footerAccount(a)}<br>¿No querés recibir más novedades? <a href="${esc(baja)}" style="color:#8A958F">Darme de baja</a>.`,
    footerText: `Es un aviso sobre tu cuenta de Ventra (${a.email || ""}).\nDarme de baja: ${baja}`,
  });
}

/** A los 3 días de pagar, si todavía no arrancó. */
function nudgeEmail(a, { unsubUrl } = {}) {
  const baja = unsubUrl || "#";
  return render({
    subject: "¿Te ayudamos a arrancar con Ventra?",
    preheader: "En 15 minutos por WhatsApp lo dejamos andando.",
    title: `${hola(a.name)} ¿Arrancamos juntos?`,
    paras: [
      `Vimos que todavía no empezaste a usar <b>${esc(a.planName || "Ventra")}</b>. Es normal: lo que más cuesta es el primer paso.`,
      "Te proponemos algo: escribinos por WhatsApp y en 15 minutos lo dejamos andando con vos. Si tenés tus productos en un Excel o en una lista, mandala y los cargamos.",
      ...firstSteps(a.plan).slice(0, 1),
    ],
    cta: ["Quiero que me ayuden", `https://wa.me/${kit.WA_NUMBER}?text=${encodeURIComponent("Quiero hablar con una persona de Ventra: necesito ayuda para arrancar")}`],
    footer: `${footerAccount(a)}<br>¿No querés recibir más estos mails? <a href="${esc(baja)}" style="color:#8A958F">Darme de baja</a>.`,
    footerText: `Es un aviso sobre tu cuenta de Ventra (${a.email || ""}).\nDarme de baja: ${baja}`,
  });
}

/** Se vinculó una PC a la cuenta. */
function deviceEmail(d, a) {
  return render({
    subject: `Se vinculó una PC a tu cuenta de Ventra: ${d.name || "PC"}`,
    preheader: "Si fuiste vos, no hace falta que hagas nada.",
    badge: ["Seguridad", "info"],
    title: "Se vinculó una PC a tu cuenta",
    paras: [
      `${hola(a.name)} La PC <b>${esc(d.name || "sin nombre")}</b> quedó vinculada a tu cuenta de Ventra el ${esc(longDate(d.linkedAt))}.`,
      "<b>Si fuiste vos (o alguien de tu equipo), no hace falta que hagas nada.</b>",
      "Si no la reconocés, entrá a Mi cuenta y desvinculala, y escribinos por WhatsApp así lo revisamos.",
    ],
    rows: [["PC", d.name || "Sin nombre"], ["Fecha", shortDate(d.linkedAt)]],
    cta: ["Ver mis PCs", CUENTA("pc")],
    footer: footerAccount(a),
  });
}

/** Cambio de plan confirmado. */
function planChangeEmail(before, a, newAmount) {
  return render({
    subject: `Cambiaste a ${a.planName}`,
    preheader: "El plan nuevo ya está activo.",
    badge: ["Cambio de plan", "ok"],
    title: `${hola(a.name)} Ya tenés ${a.planName}`,
    paras: [
      `Cambiaste de <b>${esc(before.planName || "tu plan anterior")}</b> a <b>${esc(a.planName)}</b>. El plan nuevo ya está activo y tus productos, clientes y turnos siguen igual.`,
      newAmount ? `Desde el próximo cobro${a.paidUntil ? `, el ${esc(longDate(a.paidUntil))},` : ""} Mercado Pago te cobra <b>${esc(money(newAmount))}</b> por mes.` : "",
    ].filter(Boolean),
    cta: ["Ver mi cuenta", CUENTA("plan")],
    help: "¿No fuiste vos o tenés dudas? Escribinos por WhatsApp.",
    footer: footerAccount(a),
  });
}

/** Resumen del mes. s = { month: "AAAA-MM", sales: {total,count,prevTotal}, top: [nombres], bookings, orders: {count,total} } */
function summaryEmail(s, a, { unsubUrl } = {}) {
  const baja = unsubUrl || "#";
  const monthName = MONTHS[+s.month.slice(5, 7) - 1];
  const rows = [];
  const sales = s.sales || {};
  if (sales.count) {
    const p = pct(sales.total, sales.prevTotal);
    rows.push(["Ventas en el local", money(sales.total)], ["Cantidad de ventas", Number(sales.count).toLocaleString("es-AR")], ["Ticket promedio", money(sales.total / sales.count)]);
    if (p !== null) rows.push(["Contra el mes anterior", `${p >= 0 ? "+" : ""}${p}%`]);
  }
  if (s.orders && s.orders.count) rows.push(["Pedidos online", `${s.orders.count}${s.orders.total ? ` · ${money(s.orders.total)}` : ""}`]);
  if (s.bookings) rows.push(["Turnos atendidos", String(s.bookings)]);
  const head = sales.count
    ? `En ${monthName} vendiste <b>${esc(money(sales.total))}</b> en el local${pct(sales.total, sales.prevTotal) !== null ? `, un <b>${pct(sales.total, sales.prevTotal) >= 0 ? "+" : ""}${pct(sales.total, sales.prevTotal)}%</b> contra el mes anterior` : ""}.`
    : `Así te fue en ${monthName}.`;
  return render({
    subject: `Tu ${monthName} en Ventra${sales.count ? `: ${money(sales.total)} vendidos` : ""}`,
    preheader: "El resumen de tu negocio del mes pasado.",
    badge: [`Resumen de ${monthName}`, "info"],
    title: `${hola(a.name)} Así te fue en ${monthName}`,
    paras: [head, ...(s.top && s.top.length ? [`<b>Lo más vendido:</b> ${s.top.slice(0, 3).map(esc).join(", ")}.`] : [])],
    rows,
    cta: ["Ver el detalle", APP],
    footer: `Te mandamos este resumen el primer día de cada mes (${esc(a.email || "")}).<br>¿No lo querés recibir más? <a href="${esc(baja)}" style="color:#8A958F">Darme de baja del resumen</a>.`,
    footerText: `Te mandamos este resumen el primer día de cada mes (${a.email || ""}).\nDarme de baja del resumen: ${baja}`,
  });
}

// ─── Envío una sola vez ───

/**
 * Manda un mail una sola vez por clave. build() → { subject, html, text } o null para no mandar.
 * deps: { apiKey, admin, send?, now?, logger?, unsubUrl? }. Devuelve "sent" | "skip" | "failed" | "setup".
 */
async function sendOnce(db, deps, { uid, to, kind, step, key, build, list }) {
  const { admin, apiKey } = deps;
  const send = deps.send || kit.sendEmail;
  const now = deps.now || Date.now();
  if (!kit.keyOk(apiKey) || !to) return "skip";
  const ref = db.collection(COLLECTION).doc(uid);
  const claimed = await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    const st = cur.exists ? cur.data() : {};
    if (list === "promo" && st.unsubscribed) return false;
    if (list === "resumen" && st.unsubscribedSummary) return false;
    const o = (st.once && st.once[key]) || {};
    if (o.sent || (o.tries || 0) >= MAX_TRIES) return false;
    if (o.sending && now - ms(o.sending) < 10 * 60 * 1000) return false;
    tx.set(ref, { once: { [key]: { sending: admin.firestore.Timestamp.fromMillis(now) } } }, { merge: true });
    return true;
  });
  if (!claimed) return "skip";
  const msg = build();
  if (!msg) { await ref.set({ once: { [key]: { sending: admin.firestore.FieldValue.delete() } } }, { merge: true }); return "skip"; }
  try {
    const headers = deps.unsubUrl ? { "List-Unsubscribe": `<${deps.unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : undefined;
    const data = await send(apiKey, { from: kit.FROM, to: [String(to).toLowerCase()], subject: msg.subject, html: msg.html, text: msg.text, ...(headers ? { headers } : {}), tags: [{ name: "kind", value: kind }, { name: "step", value: step }] });
    await ref.set({ once: { [key]: { sent: admin.firestore.Timestamp.fromMillis(now), sending: admin.firestore.FieldValue.delete(), id: data.id || null } } }, { merge: true });
    await kit.logSend(db, admin, now, { kind, step, uid, to, ok: true, id: data.id, msg });
    return "sent";
  } catch (err) {
    const setup = kit.isSetupError(err);
    const fatal = !setup && err.status && err.status < 500 && err.status !== 429;
    await ref.set({ once: { [key]: { sending: admin.firestore.FieldValue.delete(), ...(setup ? {} : { tries: admin.firestore.FieldValue.increment(fatal ? MAX_TRIES : 1) }), error: String(err.message).slice(0, 200) } } }, { merge: true }).catch(() => {});
    await kit.logSend(db, admin, now, { kind, step, uid, to, ok: false, error: err.message, msg });
    if (deps.logger) deps.logger.warn(`Mail ${kind}/${step} a ${uid}: ${err.message}`);
    return setup ? "setup" : "failed";
  }
}

const accountOf = async (db, uid) => {
  const s = await db.collection("ventra_accounts").doc(uid).get();
  return s.exists ? { uid, ...s.data() } : null;
};
const excluded = (deps, a) => (deps.exclude || []).map((e) => String(e).toLowerCase()).includes(String(a.email || "").toLowerCase());

// ─── Disparados por Firestore ───

/** Nuevo cobro acreditado. */
async function onPayment(db, deps, { uid, paymentId, payment }) {
  const a = await accountOf(db, uid);
  if (!a || !a.email || excluded(deps, a)) return "skip";
  const first = !payment.previousPaidUntil;
  const r = await sendOnce(db, deps, { uid, to: a.email, kind: "cuenta", step: first ? "bienvenida_pago" : "pago", key: `pago_${paymentId}`, build: () => paymentEmail(payment, a) });
  if (first && r === "sent") await db.collection(COLLECTION).doc(uid).set({ firstPaidAt: deps.admin.firestore.Timestamp.fromMillis(ms(payment.paidAt) || deps.now || Date.now()) }, { merge: true });
  return r;
}

/** Cobro rechazado por Mercado Pago. */
async function onPaymentIssue(db, deps, { uid, issueId, issue }) {
  const a = await accountOf(db, uid);
  if (!a || !a.email || excluded(deps, a)) return "skip";
  return sendOnce(db, deps, { uid, to: a.email, kind: "cobro", step: "rechazo", key: `rechazo_${issueId}`, build: () => paymentFailedEmail(issue, a) });
}

/** Se vinculó (o se volvió a vincular) una PC. */
async function onDevice(db, deps, { deviceId, before, after }) {
  if (!after || !after.uid || !after.linkedAt) return "skip";
  if (before && before.uid === after.uid && ms(before.linkedAt) === ms(after.linkedAt)) return "skip";
  const a = await accountOf(db, after.uid);
  if (!a || !a.email || excluded(deps, a)) return "skip";
  return sendOnce(db, deps, { uid: after.uid, to: a.email, kind: "seguridad", step: "pc", key: `pc_${deviceId}_${ms(after.linkedAt)}`, build: () => deviceEmail(after, a) });
}

/** Cambio de plan de una cuenta que ya pagaba (no el alta). */
async function onAccountUpdate(db, deps, { uid, before, after }) {
  if (!before || !after || !before.plan || !after.plan || before.plan === after.plan) return "skip";
  if (!before.paidUntil || !after.email || excluded(deps, after)) return "skip";
  const amount = deps.plans && deps.plans[after.plan] ? deps.plans[after.plan].amount : null;
  const day = new Date((deps.now || Date.now()) - 3 * 3600e3).toISOString().slice(0, 10);
  return sendOnce(db, deps, { uid, to: after.email, kind: "cuenta", step: "plan", key: `plan_${after.plan}_${day}`, build: () => planChangeEmail(before, { uid, ...after }, after.mpPreapprovalId ? amount : null) });
}

// ─── Pasada diaria ───

/** ¿Qué toca hoy para esta cuenta? Pura. Devuelve [{ step, key, list? }]. */
function dailySteps(a, state = {}, nowMs = Date.now()) {
  const out = [];
  const until = ms(a.paidUntil);
  if (!until) return out;
  const key = new Date(until - 3 * 3600e3).toISOString().slice(0, 10);
  // Aviso de cobro: suscripción de Mercado Pago andando y el vencimiento entre 2 y 3 días
  const left = until - nowMs;
  if (a.mpPreapprovalId && a.status === "active" && left > 2 * DAY && left <= 3 * DAY) out.push({ step: "aviso_cobro", key: `aviso_${key}` });
  // Volvé: entre 30 y 37 días de solo lectura, sin haber vuelto a pagar
  const ro = nowMs - (until + GRACE_DAYS * DAY);
  if (ro >= 30 * DAY && ro < 37 * DAY && !state.unsubscribed) out.push({ step: "volve", key: `volve_${key}`, list: "promo" });
  // Arranque: entre 3 y 6 días del primer pago, con el plan vigente
  const first = ms(state.firstPaidAt);
  if (first && nowMs - first >= 3 * DAY && nowMs - first < 6 * DAY && until > nowMs && !state.unsubscribed) out.push({ step: "arranque", key: "arranque", list: "promo" });
  return out;
}

/**
 * Pasada diaria. deps: { apiKey, admin, plans, unsub(uid, list), used(uid, account) → Promise<bool>, now?, exclude?, logger? }
 * Lee las cuentas con paidUntil en una ventana que cubre todo lo que puede tocar.
 */
async function dailyRun(db, deps) {
  const now = deps.now || Date.now();
  if (!kit.keyOk(deps.apiKey)) return { skipped: "sin configurar" };
  const T = deps.admin.firestore.Timestamp;
  const snap = await db.collection("ventra_accounts")
    .where("paidUntil", ">", T.fromMillis(now - (GRACE_DAYS + 37) * DAY))
    .where("paidUntil", "<", T.fromMillis(now + 40 * DAY)).get();
  const accounts = snap.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((a) => a.email && !excluded(deps, a));
  if (!accounts.length) return { sent: 0, failed: 0 };
  const states = {};
  (await db.getAll(...accounts.map((a) => db.collection(COLLECTION).doc(a.uid)))).forEach((s) => { states[s.id] = s.exists ? s.data() : {}; });
  let sent = 0, failed = 0;
  for (const a of accounts) {
    for (const s of dailySteps(a, states[a.uid], now)) {
      if (s.step === "arranque" && (await deps.used(a.uid, a).catch(() => true))) continue;
      const unsubUrl = s.list ? deps.unsub(a.uid, s.list) : undefined;
      const amount = deps.plans && deps.plans[a.plan] ? deps.plans[a.plan].amount : null;
      const build = s.step === "aviso_cobro" ? () => (amount ? preChargeEmail(a, amount) : null)
        : s.step === "volve" ? () => winbackEmail(a, { unsubUrl }) : () => nudgeEmail(a, { unsubUrl });
      const r = await sendOnce(db, { ...deps, unsubUrl }, { uid: a.uid, to: a.email, kind: s.step === "aviso_cobro" ? "cobro" : "cuenta", step: s.step, key: s.key, build, list: s.list });
      if (r === "sent") sent++;
      if (r === "failed") failed++;
      if (r === "setup") return { sent, failed: failed + 1, skipped: "Resend rechaza" };
    }
  }
  return { sent, failed };
}

// ─── Resumen mensual ───

/** "AAAA-MM" del mes anterior a nowMs (en Argentina) y sus días. Pura. */
function prevMonth(nowMs) {
  const d = new Date(nowMs - 3 * 3600e3);
  const y = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
  const m = d.getUTCMonth() === 0 ? 12 : d.getUTCMonth();
  const month = `${y}-${String(m).padStart(2, "0")}`;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { month, from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}
const hasActivity = (s) => !!((s.sales && s.sales.count) || (s.orders && s.orders.count) || s.bookings);

/** deps: { apiKey, admin, unsub, stats(uid, account, range) → Promise<s>, now?, exclude?, logger? } */
async function monthlyRun(db, deps) {
  const now = deps.now || Date.now();
  if (!kit.keyOk(deps.apiKey)) return { skipped: "sin configurar" };
  const range = prevMonth(now);
  const snap = await db.collection("ventra_accounts").where("paidUntil", ">", deps.admin.firestore.Timestamp.fromMillis(now - GRACE_DAYS * DAY)).get();
  let sent = 0, failed = 0, quiet = 0;
  for (const doc of snap.docs) {
    const a = { uid: doc.id, ...doc.data() };
    if (!a.email || excluded(deps, a)) continue;
    let s;
    try { s = { month: range.month, ...(await deps.stats(a.uid, a, range)) }; } catch (err) { if (deps.logger) deps.logger.warn(`Resumen ${a.uid}: ${err.message}`); continue; }
    if (!hasActivity(s)) { quiet++; continue; }
    const unsubUrl = deps.unsub(a.uid, "resumen");
    const r = await sendOnce(db, { ...deps, unsubUrl }, { uid: a.uid, to: a.email, kind: "resumen", step: range.month, key: `resumen_${range.month}`, list: "resumen", build: () => summaryEmail(s, a, { unsubUrl }) });
    if (r === "sent") sent++;
    if (r === "failed") failed++;
    if (r === "setup") return { sent, failed: failed + 1, quiet, skipped: "Resend rechaza" };
  }
  return { sent, failed, quiet, month: range.month };
}

module.exports = {
  paymentEmail, preChargeEmail, paymentFailedEmail, winbackEmail, nudgeEmail, deviceEmail, planChangeEmail, summaryEmail, firstSteps,
  sendOnce, onPayment, onPaymentIssue, onDevice, onAccountUpdate, dailySteps, dailyRun, prevMonth, monthlyRun, hasActivity,
};
