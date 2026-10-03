// ═══════════════════════════════════════════════════
// Facturación electrónica: la pasarela de Ventra hacia ARCA (ventraFiscal).
//
// Los comercios autorizan la CUIT de Ventra en ARCA ("delegación") y Ventra firma
// con un solo certificado propio. Ese certificado vive SOLO acá, como secreto:
// nunca viaja a una PC, porque con él cualquiera podría facturar en nombre de
// cualquier comercio que nos haya delegado.
//
// La caja arma el pedido a WSFEv1 con un marcador <Auth/> y lo manda con su
// vinculación. Acá:
//   1. se valida que el pedido sea uno de los métodos permitidos y que todo <Cuit>
//      que traiga sea el del comercio (que queda atado a esa cuenta de Ventra),
//   2. se pone el ticket de acceso (token + sign), que es uno solo para todos los
//      comercios y se comparte entre instancias por Firestore,
//   3. se manda a ARCA y se devuelve la respuesta tal cual: la caja la interpreta.
//
// Idempotencia: cada comprobante tiene un id propio (docId) que manda la caja. Si
// ARCA ya lo autorizó, un segundo pedido con el mismo docId devuelve la respuesta
// guardada en vez de emitir otro: un corte de internet a mitad de camino, o dos
// cajas facturando la misma venta, nunca terminan en dos facturas.
//
// Secreto: ARCA_CREDENTIALS = {"HOMOLOGACION":{"cert":"-----BEGIN...","key":"..."},
//                              "PRODUCCION":{"cert":"...","key":"..."}}
//   (ver scripts/arca-credenciales.js para armarlo desde los archivos).
// ═══════════════════════════════════════════════════
const https = require("https");
const forge = require("node-forge");

const ENDPOINTS = {
  HOMOLOGACION: {
    wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  },
  PRODUCCION: {
    wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  },
};

const FEV1_NS = "http://ar.gov.afip.dif.FEV1/";
/** Lo único que una caja puede pedirle a ARCA a través de Ventra. */
const METHODS = new Set(["FEDummy", "FECompUltimoAutorizado", "FECAESolicitar", "FECompConsultar", "FEParamGetPtosVenta"]);

/** Renovar el ticket diez minutos antes de que venza, no a mitad de una venta. */
const RENEW_MARGIN_MS = 10 * 60 * 1000;
/**
 * WSAA no entrega otro ticket para el mismo certificado hasta que pasan unos minutos
 * del anterior (2 en producción, 10 en homologación). Antes de eso, ni se intenta.
 */
const WSAA_COOLDOWN_MS = { PRODUCCION: 2 * 60 * 1000, HOMOLOGACION: 10 * 60 * 1000 };
const LEASE_MS = 40 * 1000;
const ARCA_TIMEOUT_MS = 25 * 1000;
/** Pasada la gracia de la suscripción, todavía un mes para emitir lo que quedó en cola. */
const AFTER_GRACE_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_MS = 10 * 60 * 1000;

// TLS: producción negocia una clave Diffie-Hellman que Node rechaza por defecto
// ("dh key too small"); SECLEVEL=1 la acepta y la conexión sigue cifrada y verificada.
const agent = new https.Agent({ keepAlive: true, minVersion: "TLSv1.2", ciphers: "DEFAULT:@SECLEVEL=1" });

class FiscalError extends Error {
  constructor(status, message, { code, retryable = false } = {}) {
    super(message);
    this.status = status;
    this.code = code || null;
    this.retryable = retryable;
  }
}

// ─── Utilidades XML ─────────────────────────────────────────────────
function pick(xml, tag) {
  const m = String(xml || "").match(new RegExp(`<(?:[\\w.-]+:)?${tag}[^>]*>([\\s\\S]*?)</(?:[\\w.-]+:)?${tag}>`, "i"));
  return m ? m[1].trim() : null;
}
const unescapeXml = (v) => String(v || "")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

function post(url, body, soapAction) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: "POST",
      agent,
      timeout: ARCA_TIMEOUT_MS,
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: soapAction,
        "Content-Length": Buffer.byteLength(body),
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("timeout", () => req.destroy(new Error("ARCA no respondió a tiempo")));
    req.on("error", reject);
    req.end(body);
  });
}

// ─── Certificados de Ventra ─────────────────────────────────────────
let credentialsCache = null;

/** Lee el secreto una vez por instancia. La CUIT sale del propio certificado. */
function loadCredentials(raw) {
  if (credentialsCache && credentialsCache.raw === raw) return credentialsCache.envs;
  const envs = {};
  let parsed = {};
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    parsed = {};
  }
  for (const env of Object.keys(ENDPOINTS)) {
    const c = parsed[env];
    if (!c || !c.cert || !c.key) continue;
    try {
      const certPem = String(c.cert).replace(/\\n/g, "\n");
      const keyPem = String(c.key).replace(/\\n/g, "\n");
      const cert = forge.pki.certificateFromPem(certPem);
      const key = forge.pki.privateKeyFromPem(keyPem);
      // ARCA pone la CUIT en el serialNumber del sujeto ("CUIT 20123456789"), OID 2.5.4.5
      const serial = (cert.subject.attributes.find((a) => a.type === "2.5.4.5") || {}).value || "";
      const cuit = String(serial).replace(/\D/g, "") || String(c.cuit || "").replace(/\D/g, "");
      envs[env] = { cert, key, cuit, expiresAt: cert.validity.notAfter };
    } catch (err) {
      console.error(`Ventra fiscal: el certificado de ${env} no se puede leer`, err.message);
    }
  }
  credentialsCache = { raw, envs };
  return envs;
}

// ─── WSAA: ticket de acceso compartido ──────────────────────────────
const ticketMemory = new Map();

function buildTra(service, now = new Date()) {
  // El reloj de ARCA puede estar corrido: la ventana se abre unos minutos para atrás
  const from = new Date(now.getTime() - 10 * 60 * 1000);
  const to = new Date(now.getTime() + 2 * 60 * 60 * 1000);
  return `<?xml version="1.0" encoding="UTF-8"?>
<loginTicketRequest version="1.0">
  <header>
    <uniqueId>${Math.floor(now.getTime() / 1000)}</uniqueId>
    <generationTime>${from.toISOString()}</generationTime>
    <expirationTime>${to.toISOString()}</expirationTime>
  </header>
  <service>${service}</service>
</loginTicketRequest>`;
}

function signTra(tra, creds) {
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(tra, "utf8");
  p7.addCertificate(creds.cert);
  p7.addSigner({
    key: creds.key,
    certificate: creds.cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign({ detached: false });
  return forge.util.encode64(forge.asn1.toDer(p7.toAsn1()).getBytes());
}

async function loginCms(env, creds) {
  const cms = signTra(buildTra("wsfe"), creds);
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov">
  <soapenv:Header/>
  <soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body>
</soapenv:Envelope>`;
  let res;
  try {
    res = await post(ENDPOINTS[env].wsaa, envelope, "");
  } catch (err) {
    // Falla antes de mandar el comprobante: la caja sabe que no se emitió nada
    throw new FiscalError(502, `No se pudo contactar a ARCA (autenticación): ${err.message}`, { code: "WSAA_UNREACHABLE", retryable: true });
  }
  const fault = pick(res.body, "faultstring");
  if (fault) {
    if (/alreadyAuthenticated|ya posee un TA valido/i.test(res.body)) {
      throw new FiscalError(503, "ARCA todavía no entrega un ticket de acceso nuevo. Se reintenta en unos minutos.", { code: "TA_COOLDOWN", retryable: true });
    }
    throw new FiscalError(502, `ARCA rechazó la autenticación de Ventra: ${fault}`, { code: "WSAA_ERROR", retryable: true });
  }
  const inner = unescapeXml(pick(res.body, "loginCmsReturn"));
  const token = pick(inner, "token");
  const sign = pick(inner, "sign");
  const expiration = pick(inner, "expirationTime");
  if (!token || !sign) {
    throw new FiscalError(502, "ARCA no devolvió el ticket de acceso", { code: "WSAA_ERROR", retryable: true });
  }
  return { token, sign, expiresAt: expiration ? new Date(expiration).getTime() : Date.now() + 11 * 60 * 60 * 1000 };
}

/**
 * Ticket vigente para el certificado de Ventra en ese entorno. Uno solo para todos los
 * comercios: se guarda en Firestore y una sola instancia lo renueva por vez (lease).
 *
 * `renewIfOlderThan`: el ticket lleva congelada la lista de comercios que delegaron al
 * momento de pedirlo. Si uno delegó después, ARCA contesta "No apareció CUIT en lista de
 * relaciones" hasta que se pida otro: con esto se fuerza la renovación (si WSAA ya lo permite).
 */
async function getTicket({ db, admin }, env, creds, { renewIfOlderThan = null } = {}) {
  const key = `${env}_${creds.cuit}_wsfe`;
  const now = () => Date.now();
  const usable = (t) => t && t.token && t.expiresAt - now() > RENEW_MARGIN_MS
    && !(renewIfOlderThan !== null && t.obtainedAt < renewIfOlderThan);

  const mem = ticketMemory.get(key);
  if (usable(mem)) return mem;

  const ref = db.collection("ventra_fiscal_tokens").doc(key);
  const Timestamp = admin.firestore.Timestamp;
  const ms = (v) => (v && v.toMillis ? v.toMillis() : Number(v) || 0);

  for (let i = 0; i < 30; i++) {
    const outcome = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.exists ? snap.data() : {};
      const stored = d.token ? { token: d.token, sign: d.sign, expiresAt: ms(d.expiresAt), obtainedAt: ms(d.obtainedAt) } : null;
      if (usable(stored)) return { state: "valid", ticket: stored };
      // Pedir uno nuevo antes de que WSAA lo permita solo trae un rechazo: se sigue con el que hay
      const cooling = stored && now() - stored.obtainedAt < WSAA_COOLDOWN_MS[env];
      if (cooling && stored.expiresAt > now()) return { state: "valid", ticket: stored };
      if (ms(d.leaseUntil) > now()) return { state: "busy" };
      tx.set(ref, { leaseUntil: Timestamp.fromMillis(now() + LEASE_MS) }, { merge: true });
      return { state: "mine", stored };
    });

    if (outcome.state === "valid") {
      ticketMemory.set(key, outcome.ticket);
      return outcome.ticket;
    }
    if (outcome.state === "busy") {
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }

    try {
      const fresh = await loginCms(env, creds);
      const ticket = { ...fresh, obtainedAt: now() };
      await ref.set({
        token: ticket.token,
        sign: ticket.sign,
        expiresAt: Timestamp.fromMillis(ticket.expiresAt),
        obtainedAt: Timestamp.fromMillis(ticket.obtainedAt),
        leaseUntil: null,
        cuit: creds.cuit,
        environment: env,
      });
      ticketMemory.set(key, ticket);
      console.log(`Ventra fiscal: ticket de ${env} renovado, vence ${new Date(ticket.expiresAt).toISOString()}`);
      return ticket;
    } catch (err) {
      await ref.set({ leaseUntil: null }, { merge: true }).catch(() => {});
      // No se pudo renovar pero el anterior todavía sirve: se usa ese
      if (outcome.stored && outcome.stored.expiresAt > now()) {
        ticketMemory.set(key, outcome.stored);
        return outcome.stored;
      }
      throw err;
    }
  }
  throw new FiscalError(503, "ARCA está tardando en entregar el ticket de acceso. Se reintenta en unos minutos.", { code: "TA_BUSY", retryable: true });
}

// ─── Validación del pedido de la caja ───────────────────────────────
/**
 * El cuerpo lo arma la caja: se acepta solo si es uno de los métodos permitidos, sin
 * construcciones raras de XML, con un único <Auth/> para completar acá, y con todo
 * <Cuit> igual al del comercio. Así una caja nunca puede facturar con otra CUIT.
 */
function validateBody(method, body, cuit) {
  if (typeof body !== "string" || body.length > 40000) throw new FiscalError(400, "Pedido inválido", { code: "BAD_BODY" });
  const open = new RegExp(`^\\s*<${method} xmlns="${FEV1_NS.replace(/[./]/g, "\\$&")}">`);
  const close = new RegExp(`</${method}>\\s*$`);
  if (!open.test(body) || !close.test(body)) throw new FiscalError(400, "Pedido inválido", { code: "BAD_BODY" });
  // Sin DOCTYPE, CDATA, comentarios ni instrucciones de procesamiento
  if (/<[!?]/.test(body)) throw new FiscalError(400, "Pedido inválido", { code: "BAD_BODY" });

  const placeholders = (body.match(/<Auth\/>/g) || []).length;
  if (placeholders !== (method === "FEDummy" ? 0 : 1)) throw new FiscalError(400, "Pedido inválido", { code: "BAD_BODY" });
  const rest = body.replace("<Auth/>", "");
  if (/<\/?(?:[\w.-]+:)?(?:Auth|Token|Sign)\b/i.test(rest)) throw new FiscalError(400, "Pedido inválido", { code: "BAD_BODY" });

  const cuitTags = /<(?:[\w.-]+:)?Cuit\b([^>]*)>([\s\S]*?)<\/(?:[\w.-]+:)?Cuit>/gi;
  const opened = (rest.match(/<(?:[\w.-]+:)?Cuit\b/gi) || []).length;
  let matched = 0;
  for (const m of rest.matchAll(cuitTags)) {
    matched++;
    if (m[1].trim() || m[2].trim() !== cuit) throw new FiscalError(403, "El pedido tiene una CUIT que no es la del comercio", { code: "CUIT_MISMATCH" });
  }
  if (opened !== matched) throw new FiscalError(400, "Pedido inválido", { code: "BAD_BODY" });
}

// ─── Comercio: suscripción y CUIT ───────────────────────────────────
const accountCache = new Map();
const bindingCache = new Map();

async function checkAccount({ db }, uid, graceDays) {
  const cached = accountCache.get(uid);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    if (cached.error) throw cached.error;
    return;
  }
  const snap = await db.collection("ventra_accounts").doc(uid).get();
  const acc = snap.exists ? snap.data() : null;
  let error = null;
  if (!acc) {
    error = new FiscalError(403, "Tu cuenta de Ventra no tiene una suscripción.", { code: "NO_ACCOUNT" });
  } else if (acc.plan === "tienda" || acc.plan === "agenda") {
    error = new FiscalError(403, `Tu plan ${acc.plan === "agenda" ? "Ventra Agenda" : "Ventra Tienda"} no incluye la facturación. Pasate al plan Full en ventra.store.`, { code: "PLAN_NO_CAJA" });
  } else {
    const paidUntil = acc.paidUntil && acc.paidUntil.toMillis ? acc.paidUntil.toMillis() : null;
    if (!paidUntil) {
      error = new FiscalError(403, "Tu cuenta de Ventra todavía no tiene una suscripción activa.", { code: "UNPAID" });
    } else if (Date.now() > paidUntil + (graceDays + AFTER_GRACE_DAYS) * DAY_MS) {
      error = new FiscalError(403, "Tu suscripción de Ventra está vencida: renovala en ventra.store para seguir facturando.", { code: "SUBSCRIPTION_EXPIRED" });
    }
  }
  accountCache.set(uid, { at: Date.now(), error });
  if (accountCache.size > 5000) accountCache.clear();
  if (error) throw error;
}

/**
 * Cada CUIT queda atada a una sola cuenta de Ventra, y recién factura cuando Ventra
 * confirma que esa cuenta es de verdad del titular (panel de administración → Facturación).
 * Sin la confirmación, cualquier suscriptor podía cargar la CUIT de otro comercio que nos
 * delegó, quedársela por usarla primero y facturar (o consultar facturas) a su nombre.
 * Si un comercio cambia de cuenta, se desata desde el panel.
 */
async function bindCuit({ db, admin }, uid, cuit) {
  const cached = bindingCache.get(cuit);
  if (cached && Date.now() - cached.at < CACHE_MS && cached.uid === uid && cached.approved) return;
  const ref = db.collection("ventra_fiscal_cuits").doc(cuit);
  const found = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists) {
      const d = snap.data();
      return { owner: d.uid, pending: !!d.delegationPendingSince, approved: d.approved === true };
    }
    tx.set(ref, {
      uid, cuit, approved: false,
      boundAt: admin.firestore.FieldValue.serverTimestamp(),
      approvalRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    return { owner: uid, pending: false, approved: false };
  });
  if (found.owner !== uid) {
    bindingCache.delete(cuit);
    throw new FiscalError(403, `La CUIT ${cuit} ya factura desde otra cuenta de Ventra. Si es tuya, escribinos para revisarlo.`, { code: "CUIT_TAKEN" });
  }
  if (!found.approved) {
    bindingCache.delete(cuit);
    throw new FiscalError(403, `Ventra tiene que confirmar que la CUIT ${cuit} es de tu comercio antes de facturar. Ya recibimos el pedido: escribinos por WhatsApp si necesitás acelerarlo.`, { code: "CUIT_PENDING" });
  }
  bindingCache.set(cuit, { at: Date.now(), uid, pending: found.pending, approved: true });
  if (bindingCache.size > 5000) bindingCache.clear();
}

/**
 * Del lado de Ventra, cada delegación nueva hay que aceptarla y asociarla al certificado en
 * ARCA. Se anota qué CUIT está esperando eso, así aparece en el panel de administración.
 */
async function markDelegation({ db, admin }, cuit, pending) {
  const cached = bindingCache.get(cuit);
  if (cached && Boolean(cached.pending) === pending) return;
  const ref = db.collection("ventra_fiscal_cuits").doc(cuit);
  const now = admin.firestore.FieldValue.serverTimestamp();
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() : {};
    if (pending) tx.set(ref, { delegationPendingSince: d.delegationPendingSince || now, lastRelationMissAt: now }, { merge: true });
    else tx.set(ref, { delegationPendingSince: null, delegationOkAt: now }, { merge: true });
  }).catch((err) => console.warn("Ventra fiscal: no se pudo anotar la delegación", err.message));
  if (cached) cached.pending = pending;
}

// ─── Llamada a WSFEv1 ───────────────────────────────────────────────
async function callWsfe(env, method, body) {
  const envelope = `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>${body}</soap:Body></soap:Envelope>`;
  let res;
  try {
    res = await post(ENDPOINTS[env].wsfe, envelope, `${FEV1_NS}${method}`);
  } catch (err) {
    throw new FiscalError(502, `No se pudo contactar a ARCA: ${err.message}`, { code: "ARCA_UNREACHABLE", retryable: true });
  }
  if (res.status >= 500 && !/<(?:\w+:)?Body/i.test(res.body)) {
    throw new FiscalError(502, `ARCA respondió con un error (${res.status})`, { code: "ARCA_UNREACHABLE", retryable: true });
  }
  const fault = pick(res.body, "faultstring");
  if (fault) throw new FiscalError(502, `ARCA respondió con un error: ${fault}`, { code: "ARCA_FAULT", retryable: true });
  return res.body;
}

/** El ticket no incluye todavía a este comercio (delegó después de que se pidió). */
const isRelationMiss = (xml) => /<Code>\s*600\s*<\/Code>/i.test(xml) && /relaci/i.test(pick(xml, "Errors") || "");

const SAFE_ID = /^[A-Za-z0-9:_-]{1,120}$/;

/** Resumen del comprobante para el registro (no se guarda nada que no sea del propio pedido). */
function summarize(requestBody, responseXml) {
  const det = pick(responseXml, "FECAEDetResponse") || "";
  return {
    cbteTipo: Number(pick(requestBody, "CbteTipo")) || null,
    ptoVta: Number(pick(requestBody, "PtoVta")) || null,
    numero: Number(pick(det, "CbteDesde") || pick(requestBody, "CbteDesde")) || null,
    fecha: pick(det, "CbteFch") || pick(requestBody, "CbteFch"),
    impTotal: Number(pick(requestBody, "ImpTotal")) || 0,
    docTipo: Number(pick(requestBody, "DocTipo")) || null,
    docNro: pick(requestBody, "DocNro"),
    resultado: pick(det, "Resultado") || pick(responseXml, "Resultado"),
    cae: pick(det, "CAE"),
    caeVto: pick(det, "CAEFchVto"),
  };
}

/**
 * Atiende un pedido de una caja ya autenticada (uid del comercio).
 * body: { action: "info" | "call", environment, cuit, method, body, ref: { docId, saleId, kind } }
 */
async function handle(ctx, uid, input) {
  const { db, admin, credentialsRaw, graceDays, usage, logger } = ctx;
  const envs = loadCredentials(credentialsRaw);
  const action = String(input.action || "");

  if (action === "info") {
    const out = {};
    for (const env of Object.keys(ENDPOINTS)) {
      const c = envs[env];
      out[env] = c ? { available: true, cuit: c.cuit, certExpiresAt: c.expiresAt.toISOString() } : { available: false, cuit: null };
    }
    return { environments: out };
  }
  if (action !== "call") throw new FiscalError(400, "Acción desconocida (actualizá Ventra)", { code: "BAD_ACTION" });

  const env = String(input.environment || "");
  if (!ENDPOINTS[env]) throw new FiscalError(400, "Entorno inválido", { code: "BAD_ENV" });
  const creds = envs[env];
  if (!creds) {
    throw new FiscalError(503, env === "PRODUCCION"
      ? "La facturación de Ventra en producción todavía no está habilitada."
      : "El entorno de pruebas de ARCA no está disponible en Ventra.", { code: "ENV_UNAVAILABLE", retryable: true });
  }

  const method = String(input.method || "");
  if (!METHODS.has(method)) throw new FiscalError(400, "Operación no permitida", { code: "BAD_METHOD" });
  const cuit = String(input.cuit || "").replace(/\D/g, "");
  if (method !== "FEDummy" && cuit.length !== 11) throw new FiscalError(400, "CUIT del comercio inválida", { code: "BAD_CUIT" });
  validateBody(method, input.body, cuit);

  if (method === "FEDummy") return { xml: await callWsfe(env, method, input.body) };

  await checkAccount(ctx, uid, graceDays);
  // En homologación los comprobantes no valen nada y todos prueban con la CUIT de Ventra
  if (env === "PRODUCCION") await bindCuit(ctx, uid, cuit);

  // ── Idempotencia de la emisión ──
  let docRef = null;
  if (method === "FECAESolicitar") {
    const docId = input.ref && String(input.ref.docId || "");
    if (!docId || !SAFE_ID.test(docId)) throw new FiscalError(400, "Falta el identificador del comprobante (actualizá Ventra)", { code: "NO_REF" });
    docRef = db.collection("ventra_fiscal_docs").doc(`${uid}_${docId}`);
    const Timestamp = admin.firestore.Timestamp;
    const prior = await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      const d = snap.exists ? snap.data() : null;
      if (d && d.resultado === "A" && d.xml) return { replay: d.xml };
      if (d && d.inFlightUntil && d.inFlightUntil.toMillis() > Date.now()) return { busy: true };
      tx.set(docRef, { uid, docId, inFlightUntil: Timestamp.fromMillis(Date.now() + 60 * 1000) }, { merge: true });
      return {};
    });
    if (prior.replay) {
      usage.track(uid, { fiscalCalls: 1, fiscalReplays: 1 });
      return { xml: prior.replay, replayed: true };
    }
    if (prior.busy) throw new FiscalError(409, "Este comprobante se está emitiendo desde otra caja. Se reintenta solo.", { code: "IN_FLIGHT", retryable: true });
  }

  const auth = (t) => `<Auth><Token>${t.token}</Token><Sign>${t.sign}</Sign><Cuit>${cuit}</Cuit></Auth>`;
  try {
    let ticket = await getTicket(ctx, env, creds);
    let xml = await callWsfe(env, method, input.body.replace("<Auth/>", auth(ticket)));

    // Comercio que delegó después de que se pidió el ticket: uno nuevo lo incluye
    if (isRelationMiss(xml)) {
      const renewed = await getTicket(ctx, env, creds, { renewIfOlderThan: Date.now() - WSAA_COOLDOWN_MS[env] }).catch(() => ticket);
      if (renewed.token !== ticket.token) {
        ticket = renewed;
        xml = await callWsfe(env, method, input.body.replace("<Auth/>", auth(ticket)));
      }
    }

    usage.track(uid, { fiscalCalls: 1 });
    // En producción, si ARCA todavía no reconoce la delegación queda anotada para Ventra
    if (env === "PRODUCCION") await markDelegation(ctx, cuit, isRelationMiss(xml));
    if (docRef) {
      const s = summarize(input.body, xml);
      const ref = input.ref || {};
      const record = {
        uid, docId: String(ref.docId), saleId: ref.saleId ? String(ref.saleId).slice(0, 80) : null, kind: ref.kind ? String(ref.kind).slice(0, 20) : null,
        environment: env, cuit, ...s, inFlightUntil: null, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (s.resultado === "A" && s.cae) {
        record.xml = xml;
        record.authorizedAt = admin.firestore.FieldValue.serverTimestamp();
        usage.track(uid, { fiscalCae: 1 });
        logger.info(`Ventra fiscal: CAE ${s.cae} para ${cuit} (${env}) tipo ${s.cbteTipo} ${s.ptoVta}-${s.numero} · cuenta ${uid}`);
      }
      // Si no se pudo guardar, la caja igual recibe la respuesta y la guarda ella
      await docRef.set(record, { merge: true }).catch((err) => logger.error("Ventra fiscal: no se pudo guardar el comprobante", err));
    }
    return { xml };
  } catch (err) {
    if (docRef) await docRef.set({ inFlightUntil: null }, { merge: true }).catch(() => {});
    throw err;
  }
}

module.exports = { handle, FiscalError, validateBody, loadCredentials, buildTra, summarize };
