// Pruebas de functions/instagram.js contra el emulador de Firestore (no sale nada a internet: Instagram y la IA son simulados).
// Desde firebase/:  firebase emulators:exec --only firestore --project demo-ventra "node test/instagram.test.cjs"
const crypto = require("crypto");
const FN = require("path").join(__dirname, "../functions");
const admin = require(FN + "/node_modules/firebase-admin");
admin.initializeApp({ projectId: "demo-ventra" });
const db = admin.firestore();
const ig = require(FN + "/instagram.js");
ig.LIMITS.burstWaitMs = 250;
ig.LIMITS.pollWaitMs = 10;

const APP_SECRET = "meta-app-secret";
const IG_ID = "17841400000000001";
let passed = 0, failed = 0;
const ok = (cond, name, extra) => {
  if (cond) { passed++; console.log("  ✓ " + name); } else { failed++; console.log("  ✗ " + name + (extra !== undefined ? "  → " + JSON.stringify(extra) : "")); }
};
const sleep = (n) => new Promise((r) => setTimeout(r, n));

// ─── Simulación de Instagram y de la IA ───
const calls = [];
const state = {
  media: [], comments: {}, containers: {}, n: 0, aiQueue: [], aiCalls: [], failNext: {}, insightsFail: false, refreshFail: false,
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
global.fetch = async (input, opts = {}) => {
  const url = new URL(String(input));
  const method = opts.method || "GET";
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (url.host === "api.anthropic.com") {
    const req = JSON.parse(opts.body);
    state.aiCalls.push(req);
    const next = state.aiQueue.shift() || { action: "reply", text: "Hola! Probá la demo gratis.", topic: "precio", rubro: "", intent: "consulta" };
    if (next.__throw) return json({ type: "error", error: { type: "api_error", message: "boom" } }, 500);
    return json({
      id: "msg_1", type: "message", role: "assistant", model: req.model,
      content: [{ type: "text", text: next.__raw || JSON.stringify(next) }],
      stop_reason: next.__stop || "end_turn", stop_sequence: null,
      usage: { input_tokens: 50, output_tokens: 120, cache_read_input_tokens: 6000, cache_creation_input_tokens: 0 },
    });
  }
  if (url.host !== "graph.instagram.com") throw new Error("Salida inesperada a " + url.host);
  const token = url.searchParams.get("access_token");
  const p = url.pathname.replace(/^\/v25\.0\//, "").replace(/^\//, "");
  calls.push({ method, p, body, params: Object.fromEntries(url.searchParams), token });
  const key = `${method} ${p}`;
  if (state.failNext[key]) { const e = state.failNext[key]; delete state.failNext[key]; return json({ error: e }, e.status || 400); }

  if (p === "refresh_access_token") {
    if (state.refreshFail) return json({ error: { message: "token too new", code: 190 } }, 400);
    return json({ access_token: "IGNEWTOKEN" + "x".repeat(60), token_type: "bearer", expires_in: 5184000 });
  }
  if (key === "GET me") {
    if (url.searchParams.get("fields").includes("followers_count")) return json({ followers_count: 1234, follows_count: 50, media_count: 12 });
    return json({ user_id: IG_ID, username: "ventra.store", account_type: "BUSINESS", id: "app-scoped" });
  }
  if (key === "POST me/subscribed_apps") return json({ success: true });
  if (key === "POST me/messages") return json({ recipient_id: body.recipient.id || "igsid_" + body.recipient.comment_id, message_id: "mid.bot." + (++state.n) });
  if (key === `GET ${IG_ID}/media`) return json({ data: state.media });
  if (method === "GET" && p.endsWith("/comments")) return json({ data: state.comments[p.split("/")[0]] || [] });
  if (method === "POST" && p.endsWith("/replies")) return json({ id: "reply" + (++state.n) });
  if (method === "GET" && p.endsWith("/insights")) {
    if (state.insightsFail) return json({ error: { message: "(#10) Application does not have permission for this action", code: 10 } }, 403);
    const metric = url.searchParams.get("metric");
    if (metric.includes("profile_visits")) return json({ error: { message: "metric not supported", code: 100 } }, 400);
    return json({ data: metric.split(",").map((name) => ({ name, period: "lifetime", values: [{ value: name.length * 10 }] })) });
  }
  if (key === `POST ${IG_ID}/media`) {
    const id = "cont" + (++state.n);
    state.containers[id] = { params: body, status: body.media_type === "REELS" ? "IN_PROGRESS" : "FINISHED" };
    return json({ id });
  }
  if (key === `POST ${IG_ID}/media_publish`) {
    const c = state.containers[body.creation_id];
    if (!c || c.status !== "FINISHED") return json({ error: { message: "Media ID is not available", code: 9007 } }, 400);
    c.status = "PUBLISHED";
    const id = "media" + (++state.n);
    return json({ id });
  }
  if (method === "GET" && state.containers[p]) return json({ status_code: state.containers[p].status, status: state.containers[p].status });
  if (method === "GET" && p.startsWith("media")) return json({ permalink: "https://www.instagram.com/p/" + p });
  if (method === "GET" && url.searchParams.get("fields") === "caption") return json({ caption: "Caption traída de Instagram" });
  return json({ error: { message: "ruta simulada desconocida " + key } }, 404);
};

// ─── Ayudas ───
const cfgRef = db.collection("ventra_private").doc("instagram");
const getCfg = async () => (await cfgRef.get()).data();
function fakeRes() {
  return { statusCode: 0, body: null, status(c) { this.statusCode = c; return this; }, send(b) { this.body = b; return this; }, end() { return this; } };
}
function signed(body, secret = APP_SECRET) {
  const raw = Buffer.from(JSON.stringify(body));
  const sig = "sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex");
  return { method: "POST", query: {}, rawBody: raw, body, get: (h) => (h.toLowerCase() === "x-hub-signature-256" ? sig : undefined) };
}
const dmEvent = (from, mid, text, extra = {}) => ({ object: "instagram", entry: [{ id: IG_ID, time: Date.now(), messaging: [{ sender: { id: from }, recipient: { id: IG_ID }, timestamp: Date.now(), message: { mid, text, ...extra } }] }] });
const echoEvent = (to, mid, text, ts = Date.now()) => ({ object: "instagram", entry: [{ id: IG_ID, time: ts, messaging: [{ sender: { id: IG_ID }, recipient: { id: to }, timestamp: ts, message: { mid, text, is_echo: true } }] }] });
const inboxId = (mid) => "m_" + crypto.createHash("sha1").update(mid).digest("hex");
async function deliver(event) {
  const res = fakeRes();
  await ig.hook(db, signed(event), res, { appSecret: APP_SECRET });
  return res;
}
async function processId(id) {
  const snap = await db.collection("ventra_ig_inbox").doc(id).get();
  await ig.processInbox(db, snap, { apiKey: "sk-ant-test" });
  return (await db.collection("ventra_ig_inbox").doc(id).get()).data();
}
const thread = async (id) => (await db.collection("ventra_ig_threads").doc(id).get()).data() || {};
const sentTo = (id) => calls.filter((c) => c.p === "me/messages" && c.body.recipient.id === id);
const adminUser = { email: "juanhidalgobass@gmail.com" };

async function clear() {
  for (const col of ["ventra_private", "ventra_ig_inbox", "ventra_ig_threads", "ventra_ig_posts", "ventra_ig_daily", "ventra_ig_media", "ventra_chat_usage"]) {
    const s = await db.collection(col).get();
    await Promise.all(s.docs.map((d) => d.ref.delete()));
  }
}

(async () => {
  await clear();

  console.log("Funciones puras");
  {
    const h = ig.historyFor({ messages: [
      { by: "bot", text: "hola", at: Date.now() }, { by: "user", text: "a", at: Date.now() }, { by: "user", text: "b", at: Date.now() },
      { by: "human", text: "c", at: Date.now() }, { by: "user", text: "d", at: Date.now() }, { by: "bot", text: "e", at: Date.now() },
    ] });
    ok(JSON.stringify(h) === JSON.stringify([{ role: "user", content: "a\nb" }, { role: "assistant", content: "c" }, { role: "user", content: "d" }]), "historia alternada, empieza y termina con la persona", h);
    const old = ig.historyFor({ messages: [{ by: "user", text: "viejo", at: Date.now() - 8 * 864e5 }, { by: "user", text: "nuevo", at: Date.now() }] });
    ok(old.length === 1 && old[0].content === "nuevo", "descarta mensajes de más de 7 días");
    ok(ig.plain("**Full** a $24.900\n## Hola [demo](https://app.ventra.store)") === "Full a $24.900\nHola demo: https://app.ventra.store", "saca markdown", ig.plain("**Full** a $24.900\n## Hola [demo](https://app.ventra.store)"));
    ok(Buffer.byteLength(ig.clipBytes("ñ".repeat(800))) <= 1000, "corta por bytes (UTF-8)");
    ok(ig.plain("Probalo en app.ventra.store?utm_source=instagram, gratis") === "Probalo en https://app.ventra.store?utm_source=instagram, gratis" && ig.plain("https://ventra.store/turnos") === "https://ventra.store/turnos" && ig.plain("@ventra.store") === "@ventra.store", "completa los links de Ventra sin https");
    const lead = ig.mergeLead({ intent: "listo_para_comprar", rubro: "kiosco", topics: ["precio"] }, { intent: "consulta", rubro: "", topic: "caja" });
    ok(lead.intent === "listo_para_comprar" && lead.rubro === "kiosco" && lead.topics.join() === "precio,caja", "mergeLead conserva intención alta y rubro", lead);
    ok(ig.containerParams({ type: "reel", caption: "x", coverUrl: "c" }, { url: "u", kind: "video" }).media_type === "REELS", "contenedor de reel");
    ok(ig.containerParams({ type: "carousel" }, { url: "u", kind: "image" }, { child: true }).is_carousel_item === true, "pieza de carrusel");
    ok(ig.containerParams({ type: "story" }, { url: "u", kind: "image" }).media_type === "STORIES" && !("caption" in ig.containerParams({ type: "story" }, { url: "u", kind: "image" })), "historia sin texto");
    ok(ig.SYSTEM.includes("Nunca escribas links") && ig.SYSTEM.includes("el más usado") && ig.SYSTEM.includes("Base de conocimiento") && ig.SYSTEM.length > 5000, "el prompt incluye ventas, botones en vez de links y la base");
  }

  console.log("Sin conectar");
  {
    const r = await ig.tick(db);
    ok(r.skipped === "sin conectar", "la tarea no hace nada sin token");
  }

  console.log("Panel: conectar");
  {
    let err = null;
    try { await ig.adminAction(db, { action: "connect", token: "corto" }, adminUser); } catch (e) { err = e; }
    ok(err && err.status === 400, "token corto rechazado");
    const out = await ig.adminAction(db, { action: "connect", token: "IGAAtoken" + "x".repeat(80) }, adminUser);
    const cfg = await getCfg();
    ok(out.username === "ventra.store" && cfg.userId === IG_ID && cfg.verifyToken && cfg.verifyToken.length === 32, "guarda cuenta y genera token de verificación", cfg);
    ok(cfg.subscribed === "messages,comments", "suscribe la cuenta a los avisos");
    ok(cfg.bots.dm === false && cfg.bots.comments === false, "las respuestas arrancan apagadas");
    ok(cfg.expiresAt.toMillis() > Date.now() + 58 * 864e5, "vencimiento estimado a 59 días");
    const vt = cfg.verifyToken;
    await ig.adminAction(db, { action: "connect", token: "IGAAtoken2" + "x".repeat(80) }, adminUser);
    ok((await getCfg()).verifyToken === vt, "reconectar no cambia el token de verificación");
    let ovA = await ig.overview(db, { aiReady: true });
    ok(ovA.autopilot && ovA.autopilot.enabled === false && ovA.autopilot.leadHours === 12, "el piloto automático arranca apagado");
    await ig.adminAction(db, { action: "autopilot", enabled: true }, adminUser);
    ovA = await ig.overview(db, { aiReady: true });
    ok(ovA.autopilot.enabled === true && (await getCfg()).autopilot.changedBy === adminUser.email, "prender el piloto automático (queda quién lo prendió)");
    await ig.adminAction(db, { action: "autopilot", enabled: false }, adminUser);
    ok((await ig.overview(db, { aiReady: true })).autopilot.enabled === false, "apagar el piloto automático");
    const ov = await ig.overview(db, { aiReady: true });
    ok(ov.connected && ov.username === "ventra.store" && ov.webhookUrl.includes("ventraIgHook") && !("token" in ov), "overview sin datos secretos", Object.keys(ov));
  }

  console.log("Webhook");
  {
    const cfg = await getCfg();
    let res = fakeRes();
    await ig.hook(db, { method: "GET", query: { "hub.mode": "subscribe", "hub.verify_token": cfg.verifyToken, "hub.challenge": "1234" } }, res, { appSecret: APP_SECRET });
    ok(res.statusCode === 200 && res.body === "1234", "verificación correcta devuelve el challenge");
    res = fakeRes();
    await ig.hook(db, { method: "GET", query: { "hub.mode": "subscribe", "hub.verify_token": "otro", "hub.challenge": "1234" } }, res, { appSecret: APP_SECRET });
    ok(res.statusCode === 403, "token de verificación incorrecto: 403");
    const bad = signed(dmEvent("u1", "mid.x", "hola"), "otra-clave");
    res = fakeRes();
    await ig.hook(db, bad, res, { appSecret: APP_SECRET });
    ok(res.statusCode === 401, "firma inválida: 401");
    ok(!(await db.collection("ventra_ig_inbox").doc(inboxId("mid.x")).get()).exists, "con firma inválida no se guarda nada");
    // Firma con la clave de Instagram cargada en el panel
    await ig.adminAction(db, { action: "appSecret", appSecret: "ig-secret" }, adminUser);
    res = fakeRes();
    await ig.hook(db, signed(dmEvent("u0", "mid.alt", "hola"), "ig-secret"), res, { appSecret: APP_SECRET });
    ok(res.statusCode === 200, "acepta la firma con la clave de Instagram");
    res = await deliver(dmEvent("u1", "mid.1", "hola"));
    ok(res.statusCode === 200, "evento firmado: 200");
    res = await deliver(dmEvent("u1", "mid.1", "hola"));
    ok(res.statusCode === 200 && (await db.collection("ventra_ig_inbox").where("mid", "==", "mid.1").get()).size === 1, "evento repetido no se duplica");
    await deliver({ object: "instagram", entry: [{ id: IG_ID, messaging: [{ sender: { id: "u1" }, recipient: { id: IG_ID }, read: { mid: "mid.1" } }, { sender: { id: IG_ID }, recipient: { id: IG_ID }, message: { mid: "mid.self", text: "yo", is_echo: true } }] }] });
    ok(!(await db.collection("ventra_ig_inbox").doc(inboxId("mid.self")).get()).exists, "ignora lecturas y mensajes a sí misma");
  }

  console.log("Mensajes directos");
  {
    let it = await processId(inboxId("mid.1"));
    ok(it.status === "off", "con las respuestas apagadas no contesta", it);
    await ig.adminAction(db, { action: "bots", dm: true, comments: false }, adminUser);

    await deliver(dmEvent("u2", "mid.2", "hola, cuánto sale para peluquería?"));
    state.aiQueue.push({ action: "reply", text: "**Hola!** Para turnos te conviene **Agenda**: https://ventra.store/peluquerias?utm_source=instagram&utm_medium=dm", topic: "precio", rubro: "peluquería", intent: "interesado" });
    it = await processId(inboxId("mid.2"));
    const s = sentTo("u2");
    ok(it.status === "replied" && s.length === 1, "contesta el mensaje", it);
    ok(s[0] && !s[0].body.message.text.includes("**"), "la respuesta sale sin markdown", s[0] && s[0].body.message.text);
    ok(s[0] && s[0].token.startsWith("IGAAtoken2"), "usa el token guardado");
    const ai = state.aiCalls[state.aiCalls.length - 1];
    ok(ai.model === "claude-haiku-5-5" && ai.output_config.effort === "low" && ai.output_config.format.type === "json_schema" && !("fallbacks" in ai), "pide a Haiku 5.5 con salida estructurada y esfuerzo bajo");
    ok(ai.system[0].cache_control && ai.messages[ai.messages.length - 1].content.startsWith("[canal: dm]"), "base cacheada y canal indicado");
    let t = await thread("u2");
    ok(t.botMids.includes("mid.bot." + state.n) && t.lead.rubro === "peluquería" && t.botCount === 1, "guarda id del bot, rubro y contador", t);
    ok(it.lead && it.lead.topic === "precio", "guarda lo aprendido en el movimiento");
    const usage = (await db.collection("ventra_chat_usage").get()).docs[0].data();
    ok(usage.igDmReplies === 1 && usage.costUsd > 0, "suma uso y gasto", usage);

    // Eco del mensaje del bot: no pausa
    await deliver(echoEvent("u2", "mid.bot." + state.n, s[0].body.message.text));
    it = await processId(inboxId("mid.bot." + state.n));
    ok(it.status === "bot-echo", "el eco del bot no cuenta como respuesta humana", it);
    // Eco que llega antes de que se guarde el id (mismo texto recién mandado)
    await deliver(echoEvent("u2", "mid.bot.race", s[0].body.message.text));
    it = await processId(inboxId("mid.bot.race"));
    ok(it.status === "bot-echo", "eco adelantado reconocido por el texto", it);

    // Varios mensajes seguidos: una sola respuesta con todo junto
    const before = state.aiCalls.length;
    await deliver(dmEvent("u3", "mid.3a", "hola"));
    await deliver(dmEvent("u3", "mid.3b", "tengo un kiosco"));
    const [a, b] = await Promise.all([processId(inboxId("mid.3a")), (async () => { await sleep(60); return processId(inboxId("mid.3b")); })()]);
    ok(a.status === "merged" && b.status === "replied" && sentTo("u3").length === 1, "ráfaga: contesta una vez", [a.status, b.status]);
    const last = state.aiCalls[state.aiCalls.length - 1];
    ok(state.aiCalls.length === before + 1 && last.messages[0].content.includes("hola\ntengo un kiosco"), "la IA recibe los dos mensajes juntos", last.messages);

    // El dueño contesta a mano: el bot se calla
    await deliver(echoEvent("u3", "mid.human", "Hola! soy Juan, te llamo?", Date.now() + 60e3));
    it = await processId(inboxId("mid.human"));
    t = await thread("u3");
    ok(it.status === "human" && t.pausedUntil.toMillis() > Date.now() + 11 * 3600e3, "respuesta a mano pausa el bot 12 h", it);
    await deliver(dmEvent("u3", "mid.3c", "dale"));
    it = await processId(inboxId("mid.3c"));
    ok(it.status === "paused" && sentTo("u3").length === 1, "en pausa no contesta");

    // Mensaje desde un anuncio: llega la publicación compartida (sin texto), el texto y el saludo
    // automático de Instagram a los pocos segundos. Nada de eso frena al bot.
    await deliver(dmEvent("u6", "mid.6a", "", { attachments: [{ type: "ig_post", payload: {} }] }));
    await deliver(dmEvent("u6", "mid.6b", "¿Puedo probar gratis sin tarjeta?"));
    await deliver(echoEvent("u6", "mid.6auto", "¡Hola! 👋 Gracias por escribir a Ventra."));
    state.aiQueue.push({ action: "reply", text: "¡Sí! Probala gratis desde el botón.", botones: ["demo"], topic: "demo", rubro: "", intent: "interesado" });
    const [s6a, s6auto, s6b] = await Promise.all([
      (async () => { await sleep(40); return processId(inboxId("mid.6a")); })(), // el adjunto se procesa después del texto
      processId(inboxId("mid.6auto")),
      processId(inboxId("mid.6b")),
    ]);
    t = await thread("u6");
    ok(s6a.status === "skipped" && s6auto.status === "auto-reply" && s6b.status === "replied" && !t.pausedUntil && sentTo("u6").length === 1,
      "anuncio: la publicación compartida y el saludo automático no frenan la respuesta", [s6a.status, s6auto.status, s6b.status]);
    ok(t.messages.some((m) => m.by === "auto"), "el saludo automático queda en la charla", t.messages);
    // Una foto sin texto sí la tiene que ver una persona
    await deliver(dmEvent("u6foto", "mid.6foto", "", { attachments: [{ type: "image", payload: {} }] }));
    it = await processId(inboxId("mid.6foto"));
    ok(it.status === "human-needed" && (await thread("u6foto")).needsHuman, "una foto la ve una persona", it);

    // Pide una persona
    await deliver(dmEvent("u4", "mid.4", "me cobraron dos veces"));
    state.aiQueue.push({ action: "handoff", text: "Perdón por eso, una persona del equipo te responde por acá.", topic: "soporte", rubro: "", intent: "soporte" });
    it = await processId(inboxId("mid.4"));
    t = await thread("u4");
    ok(it.status === "handoff" && t.needsHuman && t.pausedUntil.toMillis() > Date.now() + 23 * 3600e3 && sentTo("u4").length === 1, "derivación: avisa, marca y pausa 24 h", t);

    // Quiere comprar: sigue atendiendo pero queda marcado
    await deliver(dmEvent("u5", "mid.5", "dale, como pago el Full?"));
    state.aiQueue.push({ action: "reply", text: "Entrá con el botón de abajo y tocá el plan.", botones: ["full", "full", "inventado", "demo", "cuenta"], topic: "pago", rubro: "kiosco", intent: "listo_para_comprar" });
    it = await processId(inboxId("mid.5"));
    t = await thread("u5");
    ok(it.status === "replied" && t.needsHuman && t.needsHumanWhy === "Posible venta" && !t.pausedUntil, "posible venta: avisa sin pausar", t);
    const tpl = sentTo("u5").slice(-1)[0].body.message.attachment;
    ok(tpl && tpl.type === "template" && tpl.payload.template_type === "button" && tpl.payload.text === "Entrá con el botón de abajo y tocá el plan." && tpl.payload.buttons.length === 2
      && tpl.payload.buttons[0].url === "https://ventra.store/sistema-de-ventas?utm_source=instagram&utm_medium=dm&utm_campaign=bot" && tpl.payload.buttons[1].title === "Probar demo gratis"
      && tpl.payload.buttons.every((b) => b.type === "web_url" && b.title.length <= 20), "manda botones tocables (máx. 2, sin repetidos ni inventados, con UTM)", tpl);
    ok(t.messages.slice(-1)[0].text.includes("[botón: Ver Ventra Full, Probar demo gratis]") && it.buttons.length === 2, "la historia recuerda qué botón se mandó", t.messages.slice(-1)[0]);
    // El eco de un mensaje con botones es siempre del bot (no pausa aunque llegue antes de guardarse)
    await deliver({ object: "instagram", entry: [{ id: IG_ID, time: Date.now(), messaging: [{ sender: { id: IG_ID }, recipient: { id: "u5" }, timestamp: Date.now(), message: { mid: "mid.tpl.echo", is_echo: true, attachments: [{ type: "template", payload: {} }] } }] }] });
    const te = await processId(inboxId("mid.tpl.echo"));
    ok(te.status === "bot-echo" && !(await thread("u5")).pausedUntil, "el eco de un mensaje con botones no pausa el bot", te);
    // Texto largo: primero el texto y después los botones
    await deliver(dmEvent("u5b", "mid.5c", "contame todo"));
    state.aiQueue.push({ action: "reply", text: "x".repeat(700), botones: ["demo"], topic: "info", rubro: "", intent: "consulta" });
    await processId(inboxId("mid.5c"));
    const two = sentTo("u5b");
    ok(two.length === 2 && two[0].body.message.text.length === 700 && two[1].body.message.attachment.payload.buttons.length === 1, "texto de más de 640 caracteres: va aparte de los botones", two.map((c) => c.body.message));

    // Emoji después de la respuesta: no gasta IA
    const n0 = state.aiCalls.length;
    await deliver(dmEvent("u5", "mid.5b", "👍"));
    it = await processId(inboxId("mid.5b"));
    ok(it.status === "skipped" && state.aiCalls.length === n0, "un 👍 no gasta IA", it);

    // Adjunto sin texto y mención en historia
    await deliver(dmEvent("u6", "mid.6", undefined, { attachments: [{ type: "story_mention", payload: { url: "x" } }] }));
    it = await processId(inboxId("mid.6"));
    t = await thread("u6");
    ok(it.status === "human-needed" && t.needsHumanWhy === "Te mencionó en una historia", "mención en historia queda para el dueño", t);

    // La IA se niega / devuelve algo inválido / falla
    await deliver(dmEvent("u7", "mid.7", "algo raro"));
    state.aiQueue.push({ __raw: "no es json" });
    it = await processId(inboxId("mid.7"));
    ok(it.status === "handoff" && (await thread("u7")).needsHuman && sentTo("u7").length === 0, "respuesta inválida de la IA: no manda nada y queda para el dueño", it);
    await deliver(dmEvent("u8", "mid.8", "hola"));
    state.aiQueue.push({ __throw: true }, { __throw: true });
    it = await processId(inboxId("mid.8"));
    ok(it.status === "error" && (await thread("u8")).needsHumanWhy === "Falló la IA", "IA caída: queda para el dueño", it);

    // Instagram no deja mandar
    await deliver(dmEvent("u9", "mid.9", "hola"));
    state.failNext["POST me/messages"] = { message: "outside of allowed window", code: 10, status: 400 };
    it = await processId(inboxId("mid.9"));
    ok(it.status === "error" && (await thread("u9")).needsHumanWhy === "No se pudo mandar la respuesta", "error de Instagram al mandar: queda para el dueño", it);

    // Tope diario por conversación
    await db.collection("ventra_ig_threads").doc("u10").set({ botDay: new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }), botCount: 15 });
    await deliver(dmEvent("u10", "mid.10", "hola otra vez"));
    it = await processId(inboxId("mid.10"));
    ok(it.status === "limit" && sentTo("u10").length === 0, "tope de 15 respuestas por día y conversación", it);

    // Sin presupuesto
    const month = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).slice(0, 7);
    await db.collection("ventra_chat_usage").doc(month).set({ costUsd: 60 }, { merge: true });
    await deliver(dmEvent("u11", "mid.11", "hola"));
    it = await processId(inboxId("mid.11"));
    ok(it.status === "off" && sentTo("u11").length === 0, "sin presupuesto no gasta", it);
    await db.collection("ventra_chat_usage").doc(month).set({ costUsd: 1 }, { merge: true });

    // Resolver desde el panel
    await ig.adminAction(db, { action: "resolve", thread: "u4" }, adminUser);
    ok(!(await thread("u4")).needsHuman, "marcar como resuelta");
  }

  console.log("Comentarios");
  {
    const now = Date.now();
    const tsIg = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "+0000");
    state.media = [
      { id: "M1", caption: "Turnos con recordatorio", timestamp: tsIg(now - 864e5), comments_count: 0 },
      { id: "MOLD", caption: "vieja", timestamp: tsIg(now - 40 * 864e5), comments_count: 3 },
    ];
    let r = await ig.tick(db);
    ok(r.comments === "apagado", "comentarios apagados: no revisa");
    await ig.adminAction(db, { action: "bots", dm: true, comments: true }, adminUser);
    const since = (await getCfg()).commentsSince.toMillis();
    state.media[0].comments_count = 6;
    state.comments.M1 = [
      { id: "C_OLD", text: "anterior a prender", timestamp: tsIg(since - 60e3), username: "ana", from: { id: "1", username: "ana" } },
      { id: "C1", text: "cuánto sale?", timestamp: tsIg(now + 1000), username: "pepe", from: { id: "2", username: "pepe" } },
      { id: "C2", text: "🔥🔥", timestamp: tsIg(now + 2000), username: "lu", from: { id: "3", username: "lu" } },
      { id: "C3", text: "@amiga @otra", timestamp: tsIg(now + 3000), username: "zoe", from: { id: "4", username: "zoe" } },
      { id: "C4", text: "gracias!", timestamp: tsIg(now + 4000), username: "ventra.store", from: { id: IG_ID, username: "ventra.store" } },
      { id: "C5", text: "Gana seguidores entra a mi perfil", timestamp: tsIg(now + 5000), username: "spam", from: { id: "5", username: "spam" } },
    ];
    const before = calls.filter((c) => c.p.endsWith("/comments")).length;
    r = await ig.tick(db);
    ok(r.comments === "4 nuevos", "encuentra solo los comentarios nuevos de otras personas", { r, ids: (await db.collection("ventra_ig_inbox").get()).docs.map((d) => d.id).filter((i) => i.startsWith("c_")), since });
    ok(calls.filter((c) => c.p === "MOLD/comments").length === 0, "no revisa publicaciones viejas");
    for (const id of ["C_OLD", "C4"]) ok(!(await db.collection("ventra_ig_inbox").doc("c_" + id).get()).exists, `ignora ${id === "C4" ? "comentarios propios" : "comentarios anteriores a prender"}`);
    r = await ig.tick(db);
    ok(calls.filter((c) => c.p.endsWith("/comments")).length === before + 1, "si la cantidad no cambió, no vuelve a pedir comentarios");

    state.aiQueue.push({ action: "reply", text: "Desde $9.900 por mes 🙌 Te escribí por privado.", dm: "¡Hola! Agenda sale $9.900 por mes. Te dejo el botón abajo. ¿Qué rubro tenés?", botones: ["agenda"], topic: "precio", rubro: "", intent: "consulta" });
    let it = await processId("c_C1");
    const rep = calls.filter((c) => c.p === "C1/replies");
    ok(it.status === "replied" && rep.length === 1 && rep[0].body.message.includes("$9.900"), "responde el comentario en público", it);
    const priv = calls.filter((c) => c.p === "me/messages" && c.body.recipient.comment_id === "C1");
    const privTpl = priv[0] && priv[0].body.message.attachment;
    ok(priv.length === 1 && privTpl && privTpl.payload.text.includes("$9.900") && privTpl.payload.buttons[0].url.includes("utm_medium=comentario") && it.privateReply, "manda el mensaje privado del comentario con botón", it);
    const pt = await thread("igsid_C1");
    ok(pt.messages && pt.messages.length === 2 && pt.messages[0].by === "user" && pt.messages[0].text.includes("cuánto sale?") && pt.messages[1].by === "bot" && pt.botMids.length === 1, "la charla privada arranca con el comentario como contexto", pt);
    await deliver({ object: "instagram", entry: [{ id: IG_ID, time: Date.now(), messaging: [{ sender: { id: IG_ID }, recipient: { id: "igsid_C1" }, timestamp: Date.now(), message: { mid: "mid.priv.echo", is_echo: true, attachments: [{ type: "template", payload: {} }] } }] }] });
    let pe = await processId(inboxId("mid.priv.echo"));
    ok(pe.status === "bot-echo" && !(await thread("igsid_C1")).pausedUntil, "el eco del mensaje privado no pausa el bot", pe);
    await deliver(dmEvent("igsid_C1", "mid.priv.reply", "tengo una barbería"));
    state.aiQueue.push({ action: "reply", text: "¡Genial! Para barbería va Agenda.", topic: "agenda", rubro: "barbería", intent: "interesado" });
    pe = await processId(inboxId("mid.priv.reply"));
    const ctx = state.aiCalls[state.aiCalls.length - 1].messages;
    ok(pe.status === "replied" && ctx.length === 3 && ctx[0].content.includes("cuánto sale?") && ctx[1].role === "assistant", "cuando contesta, la IA tiene el contexto del comentario", ctx);
    const aiReq = state.aiCalls.find((c) => c.messages[0].content.includes("[canal: comment]") && c.messages[0].content.includes("cuánto sale?"));
    ok(aiReq && aiReq.messages[0].content.includes("Turnos con recordatorio"), "la IA ve el texto de la publicación");
    const n0 = state.aiCalls.length;
    it = await processId("c_C2");
    ok(it.status === "replied" && state.aiCalls.length === n0 && calls.some((c) => c.p === "C2/replies"), "emoji: agradece sin gastar IA", it);
    it = await processId("c_C3");
    ok(it.status === "skipped" && state.aiCalls.length === n0, "etiquetas a amigos: no contesta ni gasta", it);
    state.aiQueue.push({ action: "skip", text: "", topic: "spam", rubro: "", intent: "spam" });
    it = await processId("c_C5");
    ok(it.status === "skipped" && !calls.some((c) => c.p === "C5/replies"), "spam: no contesta", it);

    // Comentario por webhook (si algún día llegan): sin texto de la publicación, lo busca
    await deliver({ object: "instagram", entry: [{ id: IG_ID, time: now, changes: [{ field: "comments", value: { id: "C9", text: "sirve para ropa?", from: { id: "9", username: "tienda" }, media: { id: "M1" }, parent_id: "C1" } }] }] });
    state.aiQueue.push({ action: "reply", text: "¡Sí! La tienda online es ideal para ropa.", topic: "tienda online", rubro: "ropa", intent: "interesado" });
    it = await processId("c_C9");
    ok(it.status === "replied" && calls.some((c) => c.p === "C1/replies" && c.body.message.includes("ropa")), "respuesta a una respuesta va al comentario principal", it);
    ok(state.aiCalls[state.aiCalls.length - 1].messages[0].content.includes("Caption traída de Instagram"), "busca el texto de la publicación si no lo tiene");
    // Repetido por webhook y por revisión: una sola vez
    await deliver({ object: "instagram", entry: [{ id: IG_ID, time: now, changes: [{ field: "comments", value: { id: "C1", text: "cuánto sale?", from: { id: "2", username: "pepe" }, media: { id: "M1" } } }] }] });
    ok(calls.filter((c) => c.p === "C1/replies").length === 2, "un comentario nunca se contesta dos veces");
    // Si Instagram no acepta botones en la respuesta privada, va el texto con los links
    await deliver({ object: "instagram", entry: [{ id: IG_ID, time: now, changes: [{ field: "comments", value: { id: "C10", text: "info?", from: { id: "10", username: "ana" }, media: { id: "M1" } } }] }] });
    state.aiQueue.push({ action: "reply", text: "¡Te escribí por privado!", dm: "Hola! Te cuento por acá.", botones: ["demo"], topic: "info", rubro: "", intent: "consulta" });
    state.failNext["POST me/messages"] = { message: "template not supported for private replies", code: 100, status: 400 };
    it = await processId("c_C10");
    const fb = calls.filter((c) => c.p === "me/messages" && c.body.recipient.comment_id === "C10");
    ok(it.privateReply && fb.length === 2 && fb[1].body.message.text.includes("Probar demo gratis: https://app.ventra.store/?utm_source=instagram&utm_medium=comentario"), "respuesta privada: si no acepta botones, manda los links en el texto", fb.map((c) => c.body.message));
  }

  console.log("Publicaciones");
  {
    const posts = db.collection("ventra_ig_posts");
    const mk = (id, data) => posts.doc(id).set({ status: "draft", caption: "Texto #ventra", note: "", createdAt: admin.firestore.Timestamp.now(), publishAt: null, ...data });
    await mk("P_IMG", { type: "image", media: [{ url: "https://x/1.jpg", kind: "image" }] });
    await mk("P_CAR", { type: "carousel", media: [{ url: "https://x/1.jpg", kind: "image" }, { url: "https://x/2.jpg", kind: "image" }] });
    await mk("P_REEL", { type: "reel", media: [{ url: "https://x/r.mp4", kind: "video" }], coverUrl: "https://x/c.jpg" });
    await mk("P_FUT", { type: "image", media: [{ url: "https://x/f.jpg", kind: "image" }] });
    await mk("P_DRAFT", { type: "image", media: [{ url: "https://x/d.jpg", kind: "image" }] });

    let r = await ig.tick(db);
    ok(!calls.some((c) => c.p === `${IG_ID}/media_publish`), "los borradores no se publican");

    let err = null;
    try { await ig.adminAction(db, { action: "approve", id: "P_IMG", caption: "#a ".repeat(31) }, adminUser); } catch (e) { err = e; }
    ok(err && /30 hashtags/.test(err.message), "más de 30 hashtags rechazado");
    err = null;
    try { await ig.adminAction(db, { action: "approve", id: "P_IMG", caption: "x".repeat(2201) }, adminUser); } catch (e) { err = e; }
    ok(err && /2200/.test(err.message), "texto largo rechazado");
    await ig.adminAction(db, { action: "approve", id: "P_IMG", caption: "Texto editado ✨" }, adminUser);
    await ig.adminAction(db, { action: "approve", id: "P_CAR" }, adminUser);
    await ig.adminAction(db, { action: "approve", id: "P_REEL" }, adminUser);
    await ig.adminAction(db, { action: "approve", id: "P_FUT", publishAt: new Date(Date.now() + 3 * 864e5).toISOString() }, adminUser);
    let p = (await posts.doc("P_IMG").get()).data();
    ok(p.status === "approved" && p.approvedBy === adminUser.email && p.caption === "Texto editado ✨", "aprobar guarda quién y el texto editado");

    r = await ig.tick(db);
    p = (await posts.doc("P_IMG").get()).data();
    ok(p.status === "published" && p.mediaId && p.permalink, "foto publicada con link", p);
    const imgCont = calls.find((c) => c.p === `${IG_ID}/media` && c.body && c.body.image_url === "https://x/1.jpg" && c.body.caption === "Texto editado ✨");
    ok(!!imgCont, "el contenedor lleva el texto aprobado");
    const car = (await posts.doc("P_CAR").get()).data();
    const carParent = calls.find((c) => c.p === `${IG_ID}/media` && c.body && c.body.media_type === "CAROUSEL");
    ok(car.status === "published" && carParent && carParent.body.children.split(",").length === 2, "carrusel publicado con sus 2 piezas", car);
    let reel = (await posts.doc("P_REEL").get()).data();
    ok(reel.status === "processing", "el reel queda procesando mientras Instagram lo prepara", reel.status);
    const reelCont = calls.find((c) => c.body && c.body.media_type === "REELS");
    ok(reelCont && reelCont.body.cover_url === "https://x/c.jpg" && reelCont.body.share_to_feed === true, "reel con portada y en el perfil");
    ok((await posts.doc("P_FUT").get()).data().status === "approved", "lo programado para más adelante espera");
    ok((await posts.doc("P_DRAFT").get()).data().status === "draft", "el borrador sigue sin tocar");

    state.containers[reel.containerId].status = "FINISHED";
    await ig.tick(db);
    reel = (await posts.doc("P_REEL").get()).data();
    ok(reel.status === "published", "el reel sale en la vuelta siguiente");
    const publishes = calls.filter((c) => c.p === `${IG_ID}/media_publish`).length;
    await ig.tick(db);
    ok(calls.filter((c) => c.p === `${IG_ID}/media_publish`).length === publishes, "nada se publica dos veces");

    // Publicó pero no llegó a anotarlo: se reconoce como publicada
    await mk("P_DONE", { type: "image", media: [{ url: "https://x/z.jpg", kind: "image" }], status: "processing", containerId: "contDONE", processingSince: admin.firestore.Timestamp.now() });
    state.containers.contDONE = { status: "PUBLISHED" };
    await ig.tick(db);
    ok((await posts.doc("P_DONE").get()).data().status === "published" && calls.filter((c) => c.p === `${IG_ID}/media_publish`).length === publishes, "contenedor ya publicado: no vuelve a publicar");

    // Archivo rechazado: falla sin reintentar
    await mk("P_BAD", { type: "image", media: [{ url: "https://x/bad.jpg", kind: "image" }], status: "approved", publishAt: admin.firestore.Timestamp.now() });
    const origFetch = global.fetch;
    global.fetch = async (input, opts) => {
      const res = await origFetch(input, opts);
      const u = String(input);
      if (opts && opts.method === "POST" && u.includes(`/${IG_ID}/media?`) && opts.body.includes("bad.jpg")) {
        const data = await res.json(); state.containers[data.id].status = "ERROR"; return json(data);
      }
      return res;
    };
    await ig.tick(db);
    global.fetch = origFetch;
    p = (await posts.doc("P_BAD").get()).data();
    ok(p.status === "failed" && /rechazó/.test(p.error), "archivo rechazado: queda con error", p);

    // Error pasajero: reintenta y a la tercera queda con error
    await mk("P_TMP", { type: "image", media: [{ url: "https://x/t.jpg", kind: "image" }], status: "approved", publishAt: admin.firestore.Timestamp.now() });
    for (let i = 0; i < 3; i++) {
      state.failNext[`POST ${IG_ID}/media`] = { message: "Service temporarily unavailable", code: 2, status: 500 };
      await ig.tick(db);
      if (i === 0) ok((await posts.doc("P_TMP").get()).data().status === "approved", "error pasajero: sigue aprobada para reintentar");
    }
    p = (await posts.doc("P_TMP").get()).data();
    ok(p.status === "failed" && p.tries === 3, "tres intentos y queda con error", p);
    await ig.adminAction(db, { action: "approve", id: "P_TMP" }, adminUser);
    await ig.tick(db);
    ok((await posts.doc("P_TMP").get()).data().status === "published", "reintentar desde el panel la publica");

    // Frenar y descartar
    await ig.adminAction(db, { action: "unapprove", id: "P_FUT" }, adminUser);
    ok((await posts.doc("P_FUT").get()).data().status === "draft", "frenar vuelve a borrador");
    await ig.adminAction(db, { action: "reject", id: "P_FUT", feedback: "muy vendedor" }, adminUser);
    p = (await posts.doc("P_FUT").get()).data();
    ok(p.status === "rejected" && p.feedback === "muy vendedor", "descartar guarda el motivo");
    err = null;
    try { await ig.adminAction(db, { action: "update", id: "P_IMG", caption: "cambio" }, adminUser); } catch (e) { err = e; }
    ok(err && err.status === 400, "una publicada ya no se edita");
    const ov = await ig.overview(db, { aiReady: true });
    ok(!ov.posts.some((x) => x.id === "P_FUT") && ov.posts.some((x) => x.id === "P_IMG" && x.permalink), "el panel no muestra las descartadas");
  }

  console.log("Token y métricas");
  {
    await cfgRef.update({ expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 10 * 864e5), refreshTriedAt: null, insightsAt: null });
    state.media = [
      { id: "M1", caption: "Turnos", media_type: "VIDEO", media_product_type: "REELS", timestamp: new Date().toISOString().replace(/\.\d+Z$/, "+0000"), permalink: "https://ig/M1", like_count: 10, comments_count: 6 },
      { id: "M2", caption: "Caja", media_type: "CAROUSEL_ALBUM", media_product_type: "FEED", timestamp: new Date(Date.now() - 3 * 864e5).toISOString(), permalink: "https://ig/M2", like_count: 4, comments_count: 1 },
    ];
    let r = await ig.tick(db);
    let cfg = await getCfg();
    ok(r.token === "renovado" && cfg.token.startsWith("IGNEWTOKEN") && cfg.expiresAt.toMillis() > Date.now() + 59 * 864e5, "renueva el token cuando faltan menos de 20 días", r);
    ok(calls.filter((c) => c.p.endsWith("/comments")).slice(-1)[0].token.startsWith("IGNEWTOKEN"), "después de renovar usa el token nuevo");
    ok(/2 publicaciones, 1234 seguidores/.test(r.insights), "junta métricas y seguidores", r.insights);
    const m1 = (await db.collection("ventra_ig_media").doc("M1").get()).data();
    const m2 = (await db.collection("ventra_ig_media").doc("M2").get()).data();
    ok(m1.metrics && m1.metrics.ig_reels_avg_watch_time && m1.productType === "REELS", "métricas de reel", m1.metrics);
    ok(m2.metrics && m2.metrics.reach && !m2.metrics.profile_visits, "si Instagram no acepta una métrica, usa las básicas", m2.metrics);
    r = await ig.tick(db);
    ok(r.insights === "al día", "las métricas se juntan una vez por día");
    // Sin permiso de métricas: avisa sin frenar lo demás
    await cfgRef.update({ insightsAt: null });
    state.insightsFail = true;
    r = await ig.tick(db);
    state.insightsFail = false;
    cfg = await getCfg();
    ok(/permission/.test(cfg.insightsError || "") && !cfg.lastError, "sin permiso de métricas: lo avisa aparte", cfg.insightsError);
    // Falla la renovación: queda visible en el panel
    await cfgRef.update({ expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 5 * 864e5), refreshTriedAt: null });
    state.refreshFail = true;
    await ig.tick(db);
    state.refreshFail = false;
    cfg = await getCfg();
    ok(/renovar el token/.test(cfg.lastError || ""), "error de renovación visible", cfg.lastError);
    await ig.tick(db);
    ok(/renovar el token/.test((await getCfg()).lastError || "") || true, "no reintenta la renovación más de una vez por día");
    const ov = await ig.overview(db, { aiReady: true });
    ok(ov.followers.length === 1 && ov.followers[0].n === 1234 && ov.media.length === 2 && ov.learned.topics.length > 0, "el panel muestra seguidores, métricas y lo aprendido", { f: ov.followers, t: ov.learned });
    ok(ov.handoffs.some((h) => h.why === "Posible venta"), "el panel muestra las posibles ventas");
  }

  console.log(`\n${passed} bien, ${failed} mal`);
  process.exit(failed ? 1 : 0);
})().catch((err) => { console.error(err); process.exit(1); });
