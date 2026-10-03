// ═══════════════════════════════════════════════════
// Mercado Pago de cada comercio (vinculación OAuth)
//
// El comercio conecta SU cuenta de Mercado Pago a Ventra sin copiar claves:
//   1. La PC pide un intento (connect → start) y muestra un QR con el link corto.
//   2. El dueño lo abre en el celular (ventraMpOAuth?s=…), que lo manda a la
//      pantalla oficial de Mercado Pago, y toca "Autorizar".
//   3. Mercado Pago vuelve a ventraMpOAuth con ?code&state: se canjea por los
//      tokens del comercio y se guardan en ventra_mp_accounts/{uid}.
//   4. La PC consulta el estado (connect → status) hasta verlo conectado.
//
// La app de Mercado Pago es la de Ventra (client id + secret como secretos) y
// su "URL de redireccionamiento" tiene que ser exactamente REDIRECT_URI.
// Los tokens nunca salen de la nube: las PCs piden lo que necesitan acá.
// ═══════════════════════════════════════════════════
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");
const crypto = require("crypto");

const REDIRECT_URI = process.env.VENTRA_MP_REDIRECT_URI || "https://us-central1-ventra-9cba5.cloudfunctions.net/ventraMpOAuth";
const AUTH_URL = "https://auth.mercadopago.com.ar/authorization";
const API = "https://api.mercadopago.com";
const ATTEMPT_TTL_MS = 15 * 60 * 1000;
// Los tokens duran 180 días: se renuevan cuando les queda menos que esto
const REFRESH_BEFORE_MS = 30 * 24 * 60 * 60 * 1000;

const accounts = () => admin.firestore().collection("ventra_mp_accounts");
const attempts = () => admin.firestore().collection("ventra_mp_oauth");

async function mpPost(path, body) {
  const resp = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = new Error(data.message || data.error || `Mercado Pago respondió ${resp.status}`);
    err.status = resp.status;
    err.mp = data;
    throw err;
  }
  return data;
}

async function mpGet(path, accessToken) {
  return mpApi("GET", path, accessToken);
}

/** Llamada a la API con el token del comercio. */
async function mpApi(method, path, accessToken, body, extraHeaders = {}) {
  const resp = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...extraHeaders,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const cause = Array.isArray(data.errors) && data.errors[0] ? data.errors[0].message || data.errors[0].code : null;
    const err = new Error(cause || data.message || `Mercado Pago respondió ${resp.status}`);
    err.status = resp.status;
    err.mp = data;
    throw err;
  }
  return data;
}

const tokenFields = (t) => ({
  accessToken: t.access_token,
  refreshToken: t.refresh_token || null,
  expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + (Number(t.expires_in) || 15552000) * 1000),
  mpUserId: t.user_id ? String(t.user_id) : null,
  publicKey: t.public_key || null,
  liveMode: t.live_mode !== false,
  scope: t.scope || null,
});

/** Lo que la PC puede ver de la conexión (nunca los tokens). */
function publicStatus(doc) {
  if (!doc.exists) return { connected: false };
  const d = doc.data();
  return {
    connected: true,
    mpUserId: d.mpUserId || null,
    nickname: d.nickname || null,
    email: d.email || null,
    name: d.name || null,
    liveMode: d.liveMode !== false,
    connectedAt: d.connectedAt ? d.connectedAt.toDate().toISOString() : null,
    needsReconnect: !!d.needsReconnect,
    // Transferencias recibidas: cuentan solo si el comercio cobra así (en una cuenta
    // personal entran transferencias que no son del negocio)
    countTransfers: !!d.countTransfers,
  };
}

// ─── API para las PCs (autenticadas con su vinculación) ─────────────
async function connect(req, res, { uid, deviceId, clientId, clientSecret }) {
  const creds = { clientId, clientSecret };
  const action = String((req.body && req.body.action) || "status");

  if (action === "status") {
    return res.status(200).json(publicStatus(await accounts().doc(uid).get()));
  }

  if (action === "start") {
    if (!clientId) return res.status(503).json({ error: "La conexión con Mercado Pago todavía no está habilitada en Ventra." });
    const state = crypto.randomBytes(24).toString("hex");
    await attempts().doc(state).set({
      uid,
      deviceId,
      expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + ATTEMPT_TTL_MS),
      usedAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return res.status(200).json({
      url: `${REDIRECT_URI}?s=${state}`,
      expiresInSeconds: ATTEMPT_TTL_MS / 1000,
    });
  }

  if (action === "settings") {
    const ref = accounts().doc(uid);
    if (!(await ref.get()).exists) return res.status(409).json({ error: "Conectá la cuenta de Mercado Pago primero.", code: "MP_NOT_CONNECTED" });
    const patch = {};
    if (typeof (req.body || {}).countTransfers === "boolean") patch.countTransfers = req.body.countTransfers;
    // Medios de pago que son Mercado Pago en las cajas (para el control de pagos sin venta)
    if (Array.isArray((req.body || {}).mpMethods)) {
      patch.mpMethods = [...new Set(req.body.mpMethods.map((m) => String(m).slice(0, 40)).filter(Boolean))].slice(0, 30);
    }
    if (Object.keys(patch).length) await ref.update({ ...patch, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    tokenCache.delete(uid);
    return res.status(200).json(publicStatus(await ref.get()));
  }

  if (action === "disconnect") {
    await accounts().doc(uid).delete();
    tokenCache.delete(uid);
    logger.info(`Ventra MP: cuenta ${uid} desconectó Mercado Pago (desde ${deviceId})`);
    return res.status(200).json({ connected: false });
  }

  if (POINT_ACTIONS.has(action)) {
    const acc = await cachedAccount(uid, creds);
    const token = acc && acc.token;
    if (!token) return res.status(409).json({ error: "Conectá la cuenta de Mercado Pago en Configuración → Integraciones.", code: "MP_NOT_CONNECTED" });
    try {
      return res.status(200).json(await point(action, req.body || {}, token, acc));
    } catch (err) {
      if (err.status === 401) {
        tokenCache.delete(uid);
        await accounts().doc(uid).update({ needsReconnect: true }).catch(() => {});
        return res.status(409).json({ error: "Mercado Pago dejó de autorizar a Ventra. Volvé a conectar la cuenta.", code: "MP_NOT_CONNECTED" });
      }
      if (err.status && err.status < 500) {
        logger.warn(`Ventra MP: ${action} rechazado (${uid})`, err.message, err.mp || "");
        return res.status(400).json({ error: pointError(action, err) });
      }
      throw err;
    }
  }

  return res.status(400).json({ error: "Acción desconocida (actualizá Ventra)" });
}

// ─── Point (maquinita) en modo punto de venta, con la API de Orders ─────
// La PC manda el monto; la maquinita lo muestra y el cliente paga ahí. La venta se
// registra en la PC recién cuando la order queda "processed".
const POINT_ACTIONS = new Set(["terminals", "setPdv", "charge", "order", "cancel", "payments", "payment"]);

// Las cajas consultan el estado del cobro cada pocos segundos: el token se recuerda
// un rato por instancia en vez de leer Firestore en cada consulta.
const TOKEN_CACHE_MS = 5 * 60 * 1000;
const tokenCache = new Map();

/** Token vigente y usuario de Mercado Pago del comercio (null si no conectó). */
async function cachedAccount(uid, creds) {
  const hit = tokenCache.get(uid);
  if (hit && Date.now() - hit.at < TOKEN_CACHE_MS) return hit;
  const token = await accessTokenFor(uid, creds);
  if (!token) {
    tokenCache.delete(uid);
    return null;
  }
  const doc = await accounts().doc(uid).get();
  const d = doc.exists ? doc.data() : {};
  const acc = { at: Date.now(), uid, token, mpUserId: d.mpUserId || null, countTransfers: !!d.countTransfers };
  if (tokenCache.size > 2000) tokenCache.clear();
  tokenCache.set(uid, acc);
  return acc;
}

const cleanId = (v) => String(v || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);

function terminalView(t) {
  return {
    id: t.id,
    operatingMode: t.operating_mode || null,
    storeId: t.store_id || null,
    posId: t.pos_id || null,
    externalPosId: t.external_pos_id || null,
  };
}

/** Lo que la PC necesita saber de una order (sin datos de más del cliente). */
function orderView(o) {
  const pay = (o.transactions && o.transactions.payments && o.transactions.payments[0]) || {};
  const pm = pay.payment_method || {};
  const last4 = pay.card && pay.card.last_digits ? String(pay.card.last_digits) : null;
  const methodLabel = [pm.id, pm.type === "credit_card" ? "crédito" : pm.type === "debit_card" ? "débito" : pm.type === "prepaid_card" ? "prepaga" : pm.type]
    .filter(Boolean).join(" ");
  return {
    id: o.id,
    status: o.status || null,
    statusDetail: o.status_detail || null,
    externalReference: o.external_reference || null,
    payment: pay.id ? {
      id: pay.id,
      status: pay.status || null,
      statusDetail: pay.status_detail || null,
      amount: Number(pay.amount) || 0,
      paidAmount: pay.paid_amount !== undefined ? Number(pay.paid_amount) : null,
      method: pm.id || null,
      type: pm.type || null,
      installments: pm.installments || null,
      last4,
    } : null,
    // Lo que queda guardado en el pago de la venta: sirve para encontrarlo en Mercado Pago
    reference: `MP Point ${o.id}${methodLabel ? ` · ${methodLabel}` : ""}${last4 ? ` ****${last4}` : ""}${pm.installments > 1 ? ` · ${pm.installments} cuotas` : ""}`,
  };
}

/** Pago recibido, resumido para cruzarlo con las ventas de la caja. */
function paymentView(p) {
  const poi = (p.point_of_interaction && p.point_of_interaction.type) || "";
  const channel = /POINT/i.test(poi) || p.operation_type === "pos_payment" ? "point"
    : p.operation_type === "money_transfer" || p.payment_type_id === "bank_transfer" || p.payment_method_id === "cvu" ? "transfer"
    : /QR|INSTORE/i.test(poi) ? "qr"
    : "other";
  return {
    id: String(p.id),
    at: p.date_approved || p.date_created || null,
    amount: Number(p.transaction_amount) || 0,
    refunded: Number(p.transaction_amount_refunded) || 0,
    status: p.status || null,
    channel,
    method: p.payment_method_id || null,
    type: p.payment_type_id || null,
    installments: p.installments || null,
    last4: (p.card && p.card.last_four_digits) || null,
    externalReference: p.external_reference || null,
    description: p.description ? String(p.description).slice(0, 80) : null,
    operationType: p.operation_type || null,
  };
}

/**
 * ¿Es plata que ENTRÓ a la cuenta por una venta? La búsqueda de pagos también trae lo
 * que el comercio pagó con su cuenta (recargas, compras, suscripciones) y los movimientos
 * internos (reservas, préstamos): nada de eso es un cobro.
 */
const NOT_SALES = new Set(["account_fund", "investment", "recurring_payment", "cellphone_recharge", "payment_addition", "money_exchange"]);
function isIncomingSale(p, mpUserId) {
  if (!mpUserId) return false;
  const me = String(mpUserId);
  // Transferencia recibida en el CVU: Mercado Pago la registra como un ingreso de dinero
  // a la cuenta (cobra y "paga" el mismo comercio). Cuenta como transferencia; si las
  // transferencias cuentan o no lo decide el comercio (countTransfers).
  if (p.operation_type === "account_fund" && (p.payment_type_id === "bank_transfer" || p.payment_method_id === "cvu")) {
    const coll = p.collector_id != null ? String(p.collector_id) : null;
    return coll === null || coll === me;
  }
  const collector = p.collector_id != null ? String(p.collector_id) : p.collector && p.collector.id != null ? String(p.collector.id) : null;
  if (collector !== me) return false; // sin cobrador o lo cobró otro: lo pagó el comercio
  if (p.payer && p.payer.id != null && String(p.payer.id) === me) return false; // movimiento entre cuentas propias
  if (NOT_SALES.has(p.operation_type)) return false;
  const ref = String(p.external_reference || "");
  if (/^POTS/i.test(ref) || /^loan-/i.test(ref)) return false; // reservas y préstamos de Mercado Pago
  return true;
}

const isoOk = (v) => typeof v === "string" && !Number.isNaN(Date.parse(v));

async function point(action, body, token, acc = {}) {
  // Pagos aprobados que RECIBIÓ el comercio entre dos momentos (para el cierre de caja)
  if (action === "payments") {
    if (!isoOk(body.begin) || !isoOk(body.end)) throw Object.assign(new Error("Rango de fechas inválido"), { status: 400 });
    const begin = new Date(body.begin).toISOString();
    const end = new Date(body.end).toISOString();
    const out = [];
    for (let offset = 0; offset < 1000; offset += 100) {
      const q = new URLSearchParams({
        sort: "date_created", criteria: "asc", range: "date_created",
        begin_date: begin, end_date: end, status: "approved", limit: "100", offset: String(offset),
      });
      const data = await mpGet(`/v1/payments/search?${q}`, token);
      const results = data.results || [];
      for (const p of results) {
        // Solo lo cobrado por el comercio (no lo que pagó él con su cuenta)
        if (!isIncomingSale(p, acc.mpUserId)) continue;
        const view = paymentView(p);
        if (view.channel === "transfer" && !acc.countTransfers) continue;
        out.push(view);
      }
      const total = data.paging && Number(data.paging.total);
      if (results.length < 100 || (total && offset + 100 >= total)) break;
    }
    return { payments: out };
  }

  if (action === "payment") {
    const id = String(body.paymentId || "").replace(/[^0-9]/g, "");
    if (!id) throw Object.assign(new Error("Falta el pago"), { status: 400 });
    const p = await mpGet(`/v1/payments/${id}`, token);
    if (!isIncomingSale(p, acc.mpUserId)) {
      throw Object.assign(new Error("Ese pago no es de esta cuenta"), { status: 404 });
    }
    return paymentView(p);
  }

  if (action === "terminals") {
    const data = await mpGet("/terminals/v1/list?limit=50&offset=0", token);
    const list = (data.data && data.data.terminals) || data.terminals || [];
    return { terminals: list.map(terminalView) };
  }

  if (action === "setPdv") {
    const id = cleanId(body.terminalId);
    if (!id) throw Object.assign(new Error("Falta la maquinita"), { status: 400 });
    const data = await mpApi("PATCH", "/terminals/v1/setup", token, { terminals: [{ id, operating_mode: "PDV" }] });
    const t = (data.terminals && data.terminals[0]) || { id, operating_mode: "PDV" };
    return { terminal: terminalView(t) };
  }

  if (action === "charge") {
    const terminalId = cleanId(body.terminalId);
    const amount = Math.round(Number(body.amount) * 100) / 100;
    if (!terminalId) throw Object.assign(new Error("Falta la maquinita"), { status: 400 });
    if (!(amount > 0) || amount > 100000000) throw Object.assign(new Error("Monto inválido"), { status: 400 });
    const externalReference = cleanId(body.externalReference).slice(0, 64) || `ventra-${Date.now()}`;
    const order = await mpApi("POST", "/v1/orders", token, {
      type: "point",
      external_reference: externalReference,
      // Si nadie paga, la maquinita se libera sola a los 5 minutos
      expiration_time: "PT5M",
      transactions: { payments: [{ amount: amount.toFixed(2) }] },
      config: { point: { terminal_id: terminalId } },
      description: String(body.description || "Venta").slice(0, 150),
    }, { "X-Idempotency-Key": crypto.randomUUID() });
    const view = orderView(order);
    if (acc.uid) await saveOrderState(acc.uid, view);
    return view;
  }

  const orderId = cleanId(body.orderId);
  if (!orderId) throw Object.assign(new Error("Falta el cobro"), { status: 400 });

  if (action === "order") {
    const view = orderView(await mpGet(`/v1/orders/${orderId}`, token));
    if (acc.uid) await saveOrderState(acc.uid, view);
    return view;
  }

  if (action === "cancel") {
    return orderView(await mpApi("POST", `/v1/orders/${orderId}/cancel`, token, undefined, { "X-Idempotency-Key": crypto.randomUUID() }));
  }
}

/** Mensaje entendible para el cajero cuando Mercado Pago rechaza el pedido. */
function pointError(action, err) {
  const raw = `${err.message} ${JSON.stringify(err.mp || {})}`.toLowerCase();
  if (action === "charge") {
    if (raw.includes("already") || raw.includes("queued") || raw.includes("busy") || raw.includes("in_progress")) {
      return "La maquinita tiene otro cobro pendiente. Terminalo o cancelalo en la maquinita y probá de nuevo.";
    }
    if (raw.includes("operating") || raw.includes("pdv") || raw.includes("mode")) {
      return "La maquinita no está en modo punto de venta. Activalo en Configuración → Integraciones → Mercado Pago y reiniciala.";
    }
    if (raw.includes("terminal")) return "Mercado Pago no encuentra la maquinita. Revisá que esté encendida y con internet, o elegila de nuevo en Configuración.";
  }
  if (action === "cancel") return "Ese cobro ya está en la maquinita: cancelalo desde la maquinita.";
  return `Mercado Pago rechazó el pedido: ${err.message}`;
}

// ─── Link del QR y vuelta de Mercado Pago (los abre el celular) ─────
async function oauth(req, res, { clientId, clientSecret }) {
  const q = req.query || {};

  // Link del QR: lleva a la pantalla de autorización de Mercado Pago
  if (q.s && !q.code && !q.error) {
    const snap = await attempts().doc(String(q.s)).get();
    if (!snap.exists || snap.data().usedAt) return page(res, 400, "Este código ya no sirve", "Generá uno nuevo desde Ventra: Configuración → Integraciones → Mercado Pago.");
    if (snap.data().expiresAt.toMillis() < Date.now()) return page(res, 400, "El código venció", "Generá uno nuevo desde Ventra: Configuración → Integraciones → Mercado Pago.");
    const url = `${AUTH_URL}?${new URLSearchParams({
      client_id: clientId,
      response_type: "code",
      platform_id: "mp",
      state: String(q.s),
      redirect_uri: REDIRECT_URI,
    })}`;
    return res.redirect(302, url);
  }

  const state = String(q.state || "");
  if (!state) return page(res, 400, "Link incompleto", "Volvé a escanear el código desde Ventra.");
  const ref = attempts().doc(state);

  if (q.error || !q.code) {
    await ref.set({ usedAt: admin.firestore.FieldValue.serverTimestamp(), result: "denied" }, { merge: true }).catch(() => {});
    return page(res, 200, "No se conectó", "No autorizaste el acceso. Si fue sin querer, generá un código nuevo desde Ventra y volvé a intentar.");
  }

  // El intento se marca usado en una transacción: un mismo código no se canjea dos veces
  let attempt;
  try {
    attempt = await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("Este código no es válido. Generá uno nuevo desde Ventra.");
      const d = snap.data();
      if (d.usedAt) throw new Error("Este código ya se usó. Si no quedó conectado, generá uno nuevo desde Ventra.");
      if (d.expiresAt.toMillis() < Date.now()) throw new Error("El código venció. Generá uno nuevo desde Ventra.");
      tx.update(ref, { usedAt: admin.firestore.FieldValue.serverTimestamp() });
      return d;
    });
  } catch (err) {
    return page(res, 400, "No se pudo conectar", err.message);
  }

  try {
    const token = await mpPost("/oauth/token", {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code: String(q.code),
      redirect_uri: REDIRECT_URI,
    });
    const me = await mpGet("/users/me", token.access_token).catch(() => ({}));
    const name = [me.first_name, me.last_name].filter(Boolean).join(" ") || null;
    await accounts().doc(attempt.uid).set({
      ...tokenFields(token),
      nickname: me.nickname || null,
      email: me.email || null,
      name,
      siteId: me.site_id || null,
      needsReconnect: false,
      connectedAt: admin.firestore.FieldValue.serverTimestamp(),
      connectedFrom: attempt.deviceId || null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await ref.update({ result: "ok" });
    logger.info(`Ventra MP: cuenta ${attempt.uid} conectó Mercado Pago (usuario MP ${token.user_id})`);
    const who = me.nickname || me.email || "tu cuenta";
    return page(res, 200, "¡Mercado Pago conectado!", `Ventra quedó conectado a <b>${escapeHtml(who)}</b>. Ya podés cerrar esta página y volver a la PC.`, true);
  } catch (err) {
    logger.error(`Ventra MP: no se pudo canjear el código (${attempt.uid})`, err.message, err.mp || "");
    await ref.update({ result: "error", error: String(err.message).slice(0, 300) }).catch(() => {});
    return page(res, 502, "No se pudo conectar", "Mercado Pago no confirmó la conexión. Generá un código nuevo desde Ventra y probá otra vez.");
  }
}

// ─── Tokens para usar la cuenta del comercio (cobros, pagos recibidos) ──
/** Access token vigente del comercio, renovándolo si está por vencer. null si no conectó. */
async function accessTokenFor(uid, { clientId, clientSecret }) {
  const ref = accounts().doc(uid);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const d = snap.data();
  if (d.expiresAt && d.expiresAt.toMillis() - Date.now() > REFRESH_BEFORE_MS) return d.accessToken;
  return (await refresh(ref, d, { clientId, clientSecret })) || d.accessToken;
}

async function refresh(ref, d, { clientId, clientSecret }) {
  if (!d.refreshToken) return null;
  try {
    const token = await mpPost("/oauth/token", {
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: d.refreshToken,
    });
    await ref.update({ ...tokenFields(token), needsReconnect: false, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    return token.access_token;
  } catch (err) {
    logger.warn(`Ventra MP: no se pudo renovar el token de ${ref.id}`, err.message);
    // 400/401: el comercio revocó el acceso o el refresh venció → que vuelva a conectar
    if (err.status === 400 || err.status === 401) await ref.update({ needsReconnect: true }).catch(() => {});
    return null;
  }
}

/** Tarea programada: renueva los tokens que vencen en menos de 30 días. */
async function refreshExpiring(creds) {
  const limit = admin.firestore.Timestamp.fromMillis(Date.now() + REFRESH_BEFORE_MS);
  const snap = await accounts().where("expiresAt", "<", limit).get();
  let ok = 0;
  for (const doc of snap.docs) if (await refresh(doc.ref, doc.data(), creds)) ok++;
  // Limpieza de intentos de conexión viejos
  const old = await attempts().where("expiresAt", "<", admin.firestore.Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000)).limit(400).get();
  const batch = admin.firestore().batch();
  old.docs.forEach((doc) => batch.delete(doc.ref));
  if (!old.empty) await batch.commit();
  const oldOrders = await orderStates().where("updatedAt", "<", admin.firestore.Timestamp.fromMillis(Date.now() - 2 * 24 * 60 * 60 * 1000)).limit(400).get();
  if (!oldOrders.empty) {
    const b = admin.firestore().batch();
    oldOrders.docs.forEach((doc) => b.delete(doc.ref));
    await b.commit();
  }
  logger.info(`Ventra MP: ${ok}/${snap.size} tokens renovados, ${old.size} intentos y ${oldOrders.size} cobros viejos borrados`);
}

// ─── Página que ve el dueño en el celular ───────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function page(res, status, title, message, ok = false) {
  res.set("Cache-Control", "no-store");
  res.status(status).send(`<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#08362A"><title>${escapeHtml(title)} · Ventra</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#F3F6F4;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#10231C;padding:16px;box-sizing:border-box}
  .card{background:#fff;border-radius:20px;padding:32px 24px;max-width:380px;width:100%;text-align:center;box-shadow:0 10px 30px rgba(8,54,42,.08)}
  .icon{width:64px;height:64px;border-radius:50%;margin:0 auto 16px;display:grid;place-items:center;font-size:32px;font-weight:700;color:#fff;background:${ok ? "#0E6E52" : "#B4412F"}}
  h1{font-size:21px;margin:0 0 8px}
  p{font-size:15px;line-height:1.5;color:#4A5B54;margin:0}
  .brand{margin-top:24px;font-size:12px;color:#8A9A93;letter-spacing:.08em;text-transform:uppercase;font-weight:700}
</style></head>
<body><div class="card"><div class="icon">${ok ? "✓" : "!"}</div><h1>${escapeHtml(title)}</h1><p>${message}</p><div class="brand">Ventra</div></div></body></html>`);
}

module.exports = { isIncomingSale, mpMethodsFor, pollAccounts, connect, oauth, webhook, accessTokenFor, refreshExpiring, publicStatus, point, orderView, paymentView, verifySignature };

// ─── Webhooks: Mercado Pago avisa apenas cambia un cobro del Point ──────
// El aviso solo dice "cambió la order X del vendedor Y": el estado se vuelve a pedir
// a Mercado Pago con el token del comercio, así un aviso falso no puede marcar nada
// como pagado. La caja escucha ventra_mp_orders/{id} y deja de consultar seguido.
const orderStates = () => admin.firestore().collection("ventra_mp_orders");

async function saveOrderState(uid, view) {
  if (!view || !view.id) return;
  await orderStates().doc(String(view.id)).set({
    uid,
    status: view.status || null,
    view,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }).catch((err) => logger.warn("Ventra MP: no se pudo guardar el estado del cobro", err.message));
}

/**
 * Firma de Mercado Pago (cabecera x-signature "ts=…,v1=…"): HMAC-SHA256 con la clave
 * secreta del webhook sobre "id:<data.id>;request-id:<x-request-id>;ts:<ts>;".
 */
function verifySignature(req, secret) {
  if (!secret) return false;
  const parts = Object.fromEntries(String(req.headers["x-signature"] || "").split(",").map((kv) => kv.trim().split("=")));
  if (!parts.ts || !parts.v1) return false;
  let dataId = String((req.query && (req.query["data.id"] || req.query.id)) || (req.body && req.body.data && req.body.data.id) || "");
  if (/^[a-z0-9]+$/i.test(dataId)) dataId = dataId.toLowerCase();
  const requestId = req.headers["x-request-id"];
  let manifest = "";
  if (dataId) manifest += `id:${dataId};`;
  if (requestId) manifest += `request-id:${requestId};`;
  manifest += `ts:${parts.ts};`;
  const expected = crypto.createHmac("sha256", secret).update(manifest).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(String(parts.v1), "hex"));
  } catch {
    return false;
  }
}

async function webhook(req, res, { clientId, clientSecret, webhookSecret, onPayment }) {
  const body = req.body || {};
  const type = String(body.type || (req.query && (req.query.type || req.query.topic)) || "");
  if (type === "payment") return paymentWebhook(req, res, { clientId, clientSecret, webhookSecret, onPayment });
  // Mercado Pago reintenta si no recibe 200: lo que no se usa se confirma igual
  if (type !== "order") return res.status(200).json({ ok: true, ignored: type || "sin tipo" });
  if (!verifySignature(req, webhookSecret)) {
    logger.warn("Ventra MP: webhook con firma inválida");
    return res.status(401).json({ error: "Firma inválida" });
  }
  const orderId = cleanId(body.data && body.data.id);
  const sellerId = body.user_id ? String(body.user_id) : "";
  if (!orderId || !sellerId) return res.status(200).json({ ok: true, ignored: "incompleto" });

  const found = await accounts().where("mpUserId", "==", sellerId).limit(1).get();
  if (found.empty) return res.status(200).json({ ok: true, ignored: "cuenta desconocida" });
  const uid = found.docs[0].id;
  try {
    const acc = await cachedAccount(uid, { clientId, clientSecret });
    if (!acc) return res.status(200).json({ ok: true, ignored: "sin conexión" });
    const view = orderView(await mpGet(`/v1/orders/${orderId}`, acc.token));
    await saveOrderState(uid, view);
    return res.status(200).json({ ok: true });
  } catch (err) {
    logger.warn(`Ventra MP: webhook de la order ${orderId} (${uid})`, err.message);
    // 500: que Mercado Pago lo reintente más tarde
    return res.status(500).json({ error: "No se pudo consultar la order" });
  }
}

/**
 * Pago recibido (webhook "payment"): se pide el pago a Mercado Pago con el token del
 * comercio y, si es un cobro de verdad (y las transferencias cuentan o no lo es), queda
 * esperando el control de "pago sin venta" (ver mp-checks.js).
 */
async function paymentWebhook(req, res, { clientId, clientSecret, webhookSecret, onPayment }) {
  if (!verifySignature(req, webhookSecret)) {
    logger.warn("Ventra MP: webhook de pago con firma inválida");
    return res.status(401).json({ error: "Firma inválida" });
  }
  const body = req.body || {};
  const paymentId = String((body.data && body.data.id) || (req.query && req.query["data.id"]) || "").replace(/[^0-9]/g, "");
  const sellerId = body.user_id ? String(body.user_id) : "";
  if (!paymentId || !sellerId) return res.status(200).json({ ok: true, ignored: "incompleto" });
  const found = await accounts().where("mpUserId", "==", sellerId).limit(1).get();
  if (found.empty) return res.status(200).json({ ok: true, ignored: "cuenta desconocida" });
  const uid = found.docs[0].id;
  try {
    const acc = await cachedAccount(uid, { clientId, clientSecret });
    if (!acc) return res.status(200).json({ ok: true, ignored: "sin conexión" });
    const p = await mpGet(`/v1/payments/${paymentId}`, acc.token);
    if (p.status !== "approved" || !isIncomingSale(p, acc.mpUserId)) return res.status(200).json({ ok: true, ignored: "no es un cobro" });
    const view = paymentView(p);
    if (view.channel === "transfer" && !acc.countTransfers) return res.status(200).json({ ok: true, ignored: "transferencia" });
    if (onPayment) await onPayment(uid, view);
    return res.status(200).json({ ok: true });
  } catch (err) {
    logger.warn(`Ventra MP: webhook del pago ${paymentId} (${uid})`, err.message);
    return res.status(500).json({ error: "No se pudo consultar el pago" });
  }
}

/** Medios de pago que son Mercado Pago en las cajas del comercio. */
async function mpMethodsFor(uid) {
  const doc = await accounts().doc(uid).get();
  return doc.exists && Array.isArray(doc.data().mpMethods) ? doc.data().mpMethods : [];
}

/**
 * Pagos recibidos desde la última consulta, por cada cuenta conectada (sin depender de que
 * Mercado Pago mande el webhook: los pagos con el QR impreso pueden no avisarse a la app).
 * Solo usa la API de Mercado Pago, no la base de las cajas.
 */
async function pollAccounts(creds, onPayment) {
  const snap = await accounts().get();
  let found = 0;
  for (const doc of snap.docs) {
    const d = doc.data();
    if (d.needsReconnect || !d.mpUserId) continue;
    const now = Date.now();
    const last = d.paymentsPolledAt ? d.paymentsPolledAt.toMillis() : now - 15 * 60 * 1000;
    try {
      const acc = await cachedAccount(doc.id, creds);
      if (!acc) continue;
      // Un minuto de solapamiento: un pago que se aprueba justo en el corte no se pierde
      const { payments } = await point("payments", { begin: new Date(last - 60 * 1000).toISOString(), end: new Date(now).toISOString() }, acc.token, acc);
      for (const p of payments) { await onPayment(doc.id, p); found++; }
      await doc.ref.update({ paymentsPolledAt: admin.firestore.Timestamp.fromMillis(now) });
    } catch (err) {
      logger.warn(`Ventra MP: no se pudieron consultar los pagos de ${doc.id}`, err.message);
    }
  }
  return found;
}
