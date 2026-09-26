// ═══════════════════════════════════════════════════
// VENTRA — Cloud Functions (proyecto propio: ventra-9cba5)
//
// Deploy:   firebase deploy --only functions      (desde Kiosco/firebase)
// Secretos: firebase functions:secrets:set VENTRA_MP_ACCESS_TOKEN
//           firebase functions:secrets:set RELEASE_PUSH_SECRET
//           firebase functions:secrets:set VENTRA_LICENSE_PRIVATE_KEY < license-private.pem
//           firebase functions:secrets:set NEON_DATABASE_URL
//           firebase functions:secrets:set CLOUD_HOST_SECRET   (el mismo valor va en fly: fly secrets set CLOUD_HOST_SECRET=...)
// ═══════════════════════════════════════════════════
const { onRequest } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const crypto = require("crypto");
const { MercadoPagoConfig, PreApproval } = require("mercadopago");
const { GRACE_DAYS, nextPaidUntil } = require("./subscription-rules");
const cloudSync = require("./sync");
const dashboard = require("./dashboard");

setGlobalOptions({ maxInstances: 20, memory: "512Mi", region: "us-central1" });

admin.initializeApp();
const db = admin.firestore();

const VENTRA_MP_ACCESS_TOKEN = defineSecret("VENTRA_MP_ACCESS_TOKEN");
const RELEASE_PUSH_SECRET = defineSecret("RELEASE_PUSH_SECRET");
// Clave privada Ed25519 (PEM) con la que se firma el estado que recibe cada PC.
// La app solo tiene la clave pública: puede verificar, nunca falsificar.
const VENTRA_LICENSE_PRIVATE_KEY = defineSecret("VENTRA_LICENSE_PRIVATE_KEY");

const VENTRA_PLANS = {
  caja: { name: "Ventra Caja", amount: 14900 },
  full: { name: "Ventra Full", amount: 24900 },
  tienda: { name: "Ventra Tienda", amount: 9900 },
  // Plan oculto para probar cobros reales de punta a punta: solo para administradores.
  prueba: { name: "Ventra Prueba", amount: 100, adminOnly: true },
};

// Cuentas de Google con acceso a lo administrativo (plan de prueba, panel).
const ADMIN_EMAILS = ["juanhidalgobass@gmail.com"];
const isAdmin = (user) => !!user && !!user.email && user.email_verified !== false && ADMIN_EMAILS.includes(user.email.toLowerCase());

// Verifica el token de Firebase Auth del usuario (Authorization: Bearer <idToken>).
// Nunca se confía en uid/email enviados en el body.
async function verifyUser(req) {
  const header = req.get("Authorization") || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) return null;
  try {
    return await admin.auth().verifyIdToken(match[1]);
  } catch (err) {
    logger.warn("Ventra: token inválido", err.message);
    return null;
  }
}

// La landing lo llama cuando el usuario (logueado con Google) elige un plan.
// Crea/actualiza su cuenta y una suscripción recurrente de Mercado Pago, y
// devuelve la URL de pago.
exports.createVentraSubscription = onRequest(
  { cors: [/ventra\.store$/, /ventra-9cba5\.(web\.app|firebaseapp\.com)$/], secrets: [VENTRA_MP_ACCESS_TOKEN] },
  async (req, res) => {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const user = await verifyUser(req);
    if (!user || !user.email) return res.status(401).json({ error: "Iniciá sesión para suscribirte" });

    const { plan, payerEmail } = req.body || {};
    const planInfo = VENTRA_PLANS[plan];
    if (!planInfo || (planInfo.adminOnly && !isAdmin(user))) return res.status(400).json({ error: "Plan inválido" });

    // Mercado Pago ata la suscripción a un correo y después exige que quien paga
    // entre con la cuenta de MP registrada con ESE correo. El de Google casi nunca
    // es el mismo, y el checkout rechaza con "el correo no coincide con la
    // suscripción". Por eso se pregunta cuál usa en Mercado Pago; si no lo indica,
    // se cae al de Google, que es lo que hacíamos siempre.
    const correoMp = String(payerEmail || "").trim().toLowerCase();
    if (correoMp && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correoMp)) {
      return res.status(400).json({ error: "El correo de Mercado Pago no es válido" });
    }
    const correoPagador = correoMp || user.email;

    try {
      const client = new MercadoPagoConfig({ accessToken: String(VENTRA_MP_ACCESS_TOKEN.value() || "").trim() });
      const preapproval = new PreApproval(client);
      const response = await preapproval.create({
        body: {
          reason: `Suscripción ${planInfo.name}`,
          external_reference: user.uid,
          payer_email: correoPagador,
          back_url: "https://ventra.store/cuenta.html",
          auto_recurring: {
            frequency: 1,
            frequency_type: "months",
            transaction_amount: planInfo.amount,
            currency_id: "ARS",
          },
          status: "pending",
        },
      });

      await db.collection("ventra_accounts").doc(user.uid).set({
        email: user.email,
        mpEmail: correoPagador,
        plan,
        planName: planInfo.name,
        status: "pending_payment",
        mpPreapprovalId: response.id,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      // MP viene agregando `activation=true` al init_point desde agosto de 2026 y con
      // ese parámetro el checkout abre "Esta página no existe" (bug abierto en su SDK).
      // Se quita antes de mandárselo a la persona; sin él, el link abre normal.
      const initPoint = String(response.init_point || "").replace(/([?&])activation=true&?/, "$1").replace(/[?&]$/, "");
      res.status(200).json({ initPoint });
    } catch (err) {
      logger.error("Ventra: error creando la suscripción:", err);
      res.status(500).json({ error: "No se pudo iniciar la suscripción" });
    }
  },
);

// Mercado Pago avisa cada cambio de una suscripción y cada cobro mensual.
// Siempre se consulta el dato real en la API (nunca se confía en el payload).
exports.ventraMercadopagoWebhook = onRequest({ secrets: [VENTRA_MP_ACCESS_TOKEN] }, async (req, res) => {
  const { query, body } = req;
  const type = query.type || query.topic || (body && (body.type || body.topic));
  const id = query["data.id"] || query.id || (body && body.data && body.data.id);
  const accessToken = String(VENTRA_MP_ACCESS_TOKEN.value() || "").trim();

  try {
    if (type === "subscription_preapproval" && id) {
      const preapproval = new PreApproval(new MercadoPagoConfig({ accessToken }));
      const sub = await preapproval.get({ id });
      const uid = sub.external_reference;
      if (uid) {
        await db.collection("ventra_accounts").doc(uid).set({
          status: sub.status === "authorized" ? "active" : sub.status,
          mpPreapprovalId: id,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        logger.info(`Ventra: cuenta ${uid} -> ${sub.status}`);
      }
    } else if (type === "subscription_authorized_payment" && id) {
      await creditAuthorizedPayment(String(id), accessToken);
    }
  } catch (err) {
    logger.error("Ventra: error procesando webhook:", err);
  }

  res.status(200).send("OK");
});

// Un cobro mensual aprobado extiende `paidUntil` según las reglas de gracia.
// Es idempotente: cada cobro se acredita una sola vez aunque MP avise varias.
async function creditAuthorizedPayment(authorizedPaymentId, accessToken) {
  const resp = await fetch(`https://api.mercadopago.com/authorized_payments/${authorizedPaymentId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!resp.ok) throw new Error(`MP authorized_payments ${resp.status}`);
  const ap = await resp.json();
  const paymentStatus = ap.payment && ap.payment.status;
  if (paymentStatus !== "approved") {
    logger.info(`Ventra: cobro ${authorizedPaymentId} en estado ${paymentStatus || ap.status}, no se acredita`);
    return;
  }

  const preapproval = new PreApproval(new MercadoPagoConfig({ accessToken }));
  const sub = await preapproval.get({ id: ap.preapproval_id });
  const uid = sub.external_reference;
  if (!uid) return;

  const accountRef = db.collection("ventra_accounts").doc(uid);
  const paymentRef = accountRef.collection("payments").doc(authorizedPaymentId);
  const paidAt = new Date(ap.date_created || ap.debit_date || Date.now());

  await db.runTransaction(async (tx) => {
    const [account, already] = await Promise.all([tx.get(accountRef), tx.get(paymentRef)]);
    if (already.exists) return;
    const current = account.exists && account.data().paidUntil ? account.data().paidUntil.toDate() : null;
    const paidUntil = nextPaidUntil(current, paidAt, 1);
    tx.set(paymentRef, {
      amount: ap.transaction_amount || null,
      paidAt: admin.firestore.Timestamp.fromDate(paidAt),
      previousPaidUntil: current ? admin.firestore.Timestamp.fromDate(current) : null,
      newPaidUntil: admin.firestore.Timestamp.fromDate(paidUntil),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.set(accountRef, {
      paidUntil: admin.firestore.Timestamp.fromDate(paidUntil),
      status: "active",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    logger.info(`Ventra: cuenta ${uid} paga hasta ${paidUntil.toISOString()}`);
  });
}

// ─── Vinculación de PCs (como un Smart TV) ──────────────────────────
// 1. La app pide un código (ventraLinkStart) y lo muestra.
// 2. El cliente, logueado con Google en ventra.store/cuenta.html, lo ingresa
//    (ventraLinkConfirm) y la PC queda asociada a su cuenta.
// 3. La app consulta su estado firmado (ventraDeviceStatus) con su secreto.

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sin 0/O ni 1/I/L
const CODE_TTL_MS = 15 * 60 * 1000;

function randomCode() {
  const bytes = crypto.randomBytes(8);
  const chars = Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

const sha256 = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");

exports.ventraLinkStart = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  const deviceName = String((req.body && req.body.deviceName) || "PC").slice(0, 80);

  const deviceId = crypto.randomUUID();
  const deviceSecret = crypto.randomBytes(32).toString("hex");
  let code = randomCode();
  for (let i = 0; i < 5 && (await db.collection("ventra_link_codes").doc(code).get()).exists; i++) {
    code = randomCode();
  }

  await db.collection("ventra_link_codes").doc(code).set({
    deviceId,
    secretHash: sha256(deviceSecret),
    deviceName,
    expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + CODE_TTL_MS),
    usedBy: null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  res.status(200).json({ code, deviceId, deviceSecret, expiresInSeconds: CODE_TTL_MS / 1000 });
});

exports.ventraLinkConfirm = onRequest(
  { cors: [/ventra\.store$/, /ventra-9cba5\.(web\.app|firebaseapp\.com)$/] },
  async (req, res) => {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    const user = await verifyUser(req);
    if (!user) return res.status(401).json({ error: "Iniciá sesión para vincular la PC" });

    const code = String((req.body && req.body.code) || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const formatted = code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : "";
    if (!formatted) return res.status(400).json({ error: "El código tiene 8 caracteres, por ejemplo K7P4-QX9M" });

    const account = await db.collection("ventra_accounts").doc(user.uid).get();
    if (!account.exists) return res.status(403).json({ error: "Tu cuenta no tiene una suscripción. Elegí un plan primero." });

    const codeRef = db.collection("ventra_link_codes").doc(formatted);
    try {
      const deviceName = await db.runTransaction(async (tx) => {
        const snap = await tx.get(codeRef);
        if (!snap.exists) throw new Error("Código inexistente. Revisalo o generá uno nuevo en la app.");
        const data = snap.data();
        if (data.usedBy) throw new Error("Ese código ya se usó. Generá uno nuevo en la app.");
        if (data.expiresAt.toMillis() < Date.now()) throw new Error("El código venció. Generá uno nuevo en la app.");
        tx.update(codeRef, { usedBy: user.uid, usedAt: admin.firestore.FieldValue.serverTimestamp() });
        tx.set(db.collection("ventra_devices").doc(data.deviceId), {
          uid: user.uid,
          secretHash: data.secretHash,
          name: data.deviceName,
          linkedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        return data.deviceName;
      });
      res.status(200).json({ ok: true, deviceName });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  },
);

// Estado de la suscripción de una PC, firmado con Ed25519. La app guarda la
// última respuesta y aplica las fechas aunque después se quede sin internet.
exports.ventraDeviceStatus = onRequest({ cors: true, secrets: [VENTRA_LICENSE_PRIVATE_KEY] }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  const { deviceId, deviceSecret } = req.body || {};
  if (!deviceId || !deviceSecret) return res.status(400).json({ error: "Faltan datos del equipo" });

  const device = await db.collection("ventra_devices").doc(String(deviceId)).get();
  if (!device.exists) return res.status(200).json({ linked: false });
  if (device.data().secretHash !== sha256(deviceSecret)) return res.status(401).json({ error: "Equipo no autorizado" });

  const uid = device.data().uid;
  const account = await db.collection("ventra_accounts").doc(uid).get();
  const acc = account.exists ? account.data() : {};

  const license = JSON.stringify({
    v: 1,
    deviceId: String(deviceId),
    email: acc.email || null,
    plan: acc.plan || null,
    planName: acc.planName || null,
    status: acc.status || null,
    paidUntil: acc.paidUntil ? acc.paidUntil.toDate().toISOString() : null,
    graceDays: GRACE_DAYS,
    issuedAt: new Date().toISOString(),
  });
  const privateKey = crypto.createPrivateKey(String(VENTRA_LICENSE_PRIVATE_KEY.value() || "").trim());
  const signature = crypto.sign(null, Buffer.from(license), privateKey).toString("base64");

  await device.ref.set({ lastSeenAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
  res.status(200).json({ linked: true, license, signature });
});

// ─── Sesión de la tienda online ─────────────────────────────────────
// La tienda online pertenece a la CUENTA del comercio, no a un equipo: así se
// administra igual desde la PC, el celular o la caja en la nube. Un equipo
// vinculado pide acá una sesión de Firebase de su cuenta (custom token con el uid
// de la cuenta; las reglas comparan ownerUid con ese uid).
// Migración: las tiendas creadas antes tienen como dueño la sesión anónima de la
// PC. Si el equipo manda esa sesión (idToken) y el id de su tienda, se pasa a la
// cuenta, siempre que la cuenta todavía no tenga otra tienda.
exports.ventraStoreSession = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  const { deviceId, deviceSecret, legacyStoreId, legacyIdToken } = req.body || {};
  const uid = await deviceTenant(deviceId, deviceSecret);
  if (!uid) return res.status(401).json({ error: "Equipo no vinculado" });

  // El plan Caja no incluye la tienda online (Tienda y Full sí)
  const account = await db.collection("ventra_accounts").doc(uid).get();
  if (account.exists && account.data().plan === "caja") {
    return res.status(403).json({ error: "Tu plan Ventra Caja no incluye la tienda online. Pasate al plan Full en ventra.store para usarla.", code: "PLAN_NO_TIENDA" });
  }

  try {
    // Primero la sesión: si no se puede crear (permisos de la cuenta de servicio),
    // no se toca nada y el equipo sigue usando su sesión anónima con su tienda.
    const customToken = await admin.auth().createCustomToken(uid, { ventraStore: true });

    const stores = db.collection("ventra_stores");
    // Una tienda "configurada" tiene dirección web: es la que el comercio usa de verdad.
    const isSetUp = (data) => !!(data && data.subdomain);
    const ownedSnap = await stores.where("ownerUid", "==", uid).get();
    const updatedMs = (d) => { const t = d.data().updatedAt; return t && t.toMillis ? t.toMillis() : 0; };
    // Siempre la misma tienda para la cuenta: la configurada y, entre esas, la más reciente
    const ownedDocs = ownedSnap.docs.sort((a, b) => (Number(isSetUp(b.data())) - Number(isSetUp(a.data()))) || (updatedMs(b) - updatedMs(a)));
    let storeId = ownedDocs.length ? ownedDocs[0].id : null;
    const accountHasSetUpStore = ownedDocs.some((d) => isSetUp(d.data()));

    // Se pasa a la cuenta la tienda de este equipo si la cuenta todavía no tiene una
    // configurada. Una tienda vacía (sin dirección web) nunca desplaza a una configurada.
    if (!accountHasSetUpStore && legacyStoreId && legacyIdToken) {
      try {
        const anon = await admin.auth().verifyIdToken(String(legacyIdToken));
        const ref = stores.doc(String(legacyStoreId));
        const moved = await db.runTransaction(async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists || snap.data().ownerUid !== anon.uid) return false;
          if (storeId && !isSetUp(snap.data())) return false; // vacía y la cuenta ya tiene una: no hace falta
          tx.update(ref, { ownerUid: uid, claimed: true, previousOwnerUid: anon.uid, movedToAccountAt: admin.firestore.FieldValue.serverTimestamp() });
          return true;
        });
        if (moved) {
          logger.info(`Ventra: tienda ${legacyStoreId} pasada a la cuenta ${uid}`);
          storeId = String(legacyStoreId);
        }
      } catch (err) {
        logger.warn("Ventra: no se pudo migrar la tienda", err.message);
      }
    }

    res.status(200).json({ uid, customToken, storeId });
  } catch (err) {
    logger.error("Ventra: error en la sesión de la tienda", err);
    res.status(500).json({ error: "No se pudo abrir la tienda online" });
  }
});

// ─── Réplica en la nube (Neon) ──────────────────────────────────────
// La PC vinculada sube sus cambios y, al recuperar, baja todo. Se autentica
// con la vinculación (deviceId + secreto); el comercio sale de ahí.
const NEON_DATABASE_URL = defineSecret("NEON_DATABASE_URL");
const IMAGE_MAX_BYTES = 3 * 1024 * 1024;

// Las cajas consultan seguido: el equipo se recuerda 5 minutos por instancia en vez de
// leerlo de Firestore en cada llamada (un equipo desvinculado deja de andar en ese lapso).
// Si lo recordado no coincide (equipo recién vinculado o con secreto nuevo) se vuelve a leer.
const DEVICE_CACHE_MS = 5 * 60 * 1000;
const deviceCache = new Map();

async function deviceTenant(deviceId, deviceSecret) {
  if (!deviceId || !deviceSecret) return null;
  const id = String(deviceId);
  const hash = sha256(deviceSecret);
  const cached = deviceCache.get(id);
  if (cached && Date.now() - cached.at < DEVICE_CACHE_MS && cached.secretHash === hash) return cached.uid;
  const device = await db.collection("ventra_devices").doc(id).get();
  if (!device.exists || device.data().secretHash !== hash) {
    deviceCache.delete(id);
    return null;
  }
  if (deviceCache.size > 5000) deviceCache.clear();
  deviceCache.set(id, { at: Date.now(), secretHash: hash, uid: device.data().uid });
  return device.data().uid;
}

const imagePath = (uid, productId) => `tenants/${uid}/products/${String(productId).replace(/[^A-Za-z0-9_-]/g, "_")}`;

exports.ventraSync = onRequest(
  { cors: true, secrets: [NEON_DATABASE_URL], memory: "512MiB", timeoutSeconds: 120, maxInstances: 20 },
  async (req, res) => {
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
    const { deviceId, deviceSecret, action } = req.body || {};
    const uid = await deviceTenant(deviceId, deviceSecret);
    if (!uid) return res.status(401).json({ error: "Equipo no vinculado" });

    try {
      if (action === "putImage" || action === "getImage") {
        const { productId, dataUrl } = req.body;
        if (!productId) return res.status(400).json({ error: "Falta el producto" });
        const file = admin.storage().bucket().file(imagePath(uid, productId));
        if (action === "getImage") {
          const [exists] = await file.exists();
          if (!exists) return res.status(404).json({ error: "Sin foto" });
          const [[buffer], [meta]] = await Promise.all([file.download(), file.getMetadata()]);
          return res.status(200).json({ ok: true, dataUrl: `data:${meta.contentType || "image/jpeg"};base64,${buffer.toString("base64")}` });
        }
        const m = /^data:([^;,]+);base64,(.+)$/s.exec(String(dataUrl || ""));
        if (!m) return res.status(400).json({ error: "Foto inválida" });
        const buffer = Buffer.from(m[2], "base64");
        if (buffer.length > IMAGE_MAX_BYTES) return res.status(413).json({ error: "Foto demasiado grande" });
        await file.save(buffer, { contentType: m[1], resumable: false });
        return res.status(200).json({ ok: true });
      }

      const sql = cloudSync.db(String(NEON_DATABASE_URL.value() || "").trim());
      await cloudSync.ensureSchema(sql);
      let result;
      if (action === "register") {
        result = await cloudSync.register(sql, uid, String(deviceId), String(req.body.kind || "pc").slice(0, 20));
      } else if (action === "report") {
        result = await cloudSync.report(sql, uid, String(deviceId), req.body.status);
      } else if (action === "claimLedger") {
        result = await cloudSync.claimLedger(sql, uid);
      } else if (action === "push") {
        if (!cloudSync.validRows(req.body.rows)) return res.status(400).json({ error: "Filas inválidas" });
        result = await cloudSync.push(sql, uid, String(deviceId), req.body.rows, req.body.gen);
      } else if (action === "pull") {
        result = await cloudSync.pull(sql, uid, String(deviceId), req.body.after, !!req.body.all);
      } else if (action === "reset") {
        result = await cloudSync.reset(sql, uid);
        logger.warn(`Ventra: reinicio de fábrica de la cuenta ${uid} (desde ${deviceId})`);
      } else if (action === "status") {
        result = await cloudSync.status(sql, uid);
      } else {
        return res.status(400).json({ error: "Acción desconocida (actualizá Ventra)" });
      }
      return res.status(200).json(result);
    } catch (err) {
      logger.error(`Ventra sync: error en ${action} (${uid})`, err);
      return res.status(500).json({ error: "Error del servidor de sincronización" });
    }
  },
);

// ─── Panel web del comercio (ventra.store/panel) ────────────────────
// Solo lectura sobre la réplica en Neon. El comercio sale del login de Google;
// un administrador puede ver el de cualquier cliente (?tenant=uid) para soporte.
exports.ventraDashboard = onRequest(
  { cors: [/ventra\.store$/, /ventra-9cba5\.(web\.app|firebaseapp\.com)$/, /^http:\/\/localhost:\d+$/], secrets: [NEON_DATABASE_URL] },
  async (req, res) => {
    if (req.method !== "GET") return res.status(405).send("Method Not Allowed");
    const user = await verifyUser(req);
    if (!user) return res.status(401).json({ error: "Iniciá sesión" });

    let tenantId = user.uid;
    if (req.query.tenant && isAdmin(user)) tenantId = String(req.query.tenant);
    const account = await db.collection("ventra_accounts").doc(tenantId).get();
    if (!account.exists) return res.status(404).json({ error: "Tu cuenta no tiene un plan de Ventra" });

    try {
      const sql = cloudSync.db(String(NEON_DATABASE_URL.value() || "").trim());
      await cloudSync.ensureSchema(sql);
      const view = String(req.query.view || "all");
      let result;
      if (view === "sale") {
        result = await dashboard.saleDetail(sql, tenantId, String(req.query.id || ""));
      } else if (view === "overview") {
        result = await dashboard.overview(sql, tenantId, req.query.from, req.query.to);
      } else {
        const [overview, cash, lowStock] = await Promise.all([
          dashboard.overview(sql, tenantId, req.query.from, req.query.to),
          dashboard.cash(sql, tenantId),
          dashboard.lowStock(sql, tenantId),
        ]);
        result = { overview, cash, lowStock };
      }
      const acc = account.data();
      return res.status(200).json({ ok: true, account: { email: acc.email, planName: acc.planName || null }, ...result });
    } catch (err) {
      logger.error(`Ventra panel: error (${tenantId})`, err);
      return res.status(500).json({ error: "No se pudieron cargar los datos" });
    }
  },
);

// ─── Caja en la nube (POS en el navegador) ──────────────────────────
// El anfitrión de cajas (servidor en fly.io) llama a esta función cuando alguien
// entra con Google: verifica la cuenta y, si hace falta, da de alta la "caja en
// la nube" de ese comercio (un equipo vinculado más, igual que una PC).
// Solo el anfitrión puede llamarla: comparte el secreto CLOUD_HOST_SECRET.
const CLOUD_HOST_SECRET = defineSecret("CLOUD_HOST_SECRET");
const CLOUD_APP_URL = "https://web.ventra.store";

exports.ventraCloudAccess = onRequest({ secrets: [CLOUD_HOST_SECRET] }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  const given = Buffer.from(String(req.get("x-cloud-secret") || "").trim());
  const expected = Buffer.from(String(CLOUD_HOST_SECRET.value() || "").trim());
  if (!expected.length || given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return res.status(401).json({ error: "Anfitrión no autorizado" });
  }

  const { idToken, supportTicket, needCredentials } = req.body || {};
  let user;
  let supportAdmin = null;
  if (supportTicket) {
    // Entrada de soporte desde ventra.store/admin: pase de un solo uso y 2 minutos
    const ref = db.collection("ventra_support_tickets").doc(sha256(String(supportTicket)));
    try {
      const ticket = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const t = snap.exists ? snap.data() : null;
        if (!t || t.expiresAt.toMillis() < Date.now()) return null;
        if (!t.usedAt) {
          tx.update(ref, { usedAt: admin.firestore.FieldValue.serverTimestamp() });
          return t;
        }
        // Segundo y último uso, enseguida del primero: el anfitrión da de alta la caja en la
        // nube de un comercio que nunca entró a web.ventra.store
        if (needCredentials && !t.setupAt && t.usedAt.toMillis && Date.now() - t.usedAt.toMillis() < 60 * 1000) {
          tx.update(ref, { setupAt: admin.firestore.FieldValue.serverTimestamp() });
          return t;
        }
        return null;
      });
      if (!ticket) return res.status(401).json({ error: "El acceso de soporte venció o ya se usó. Generá otro desde el panel." });
      supportAdmin = ticket.admin;
      const account = await db.collection("ventra_accounts").doc(ticket.uid).get();
      user = { uid: ticket.uid, email: (account.exists && account.data().email) || null };
    } catch (err) {
      logger.error("Ventra: no se pudo validar el acceso de soporte", err);
      return res.status(500).json({ error: "No se pudo validar el acceso de soporte" });
    }
  } else {
    try {
      user = await admin.auth().verifyIdToken(String(idToken || ""));
    } catch {
      return res.status(401).json({ error: "Sesión de Google inválida" });
    }
  }
  const account = await db.collection("ventra_accounts").doc(user.uid).get();
  if (!account.exists) return res.status(403).json({ error: "Esta cuenta no tiene un plan de Ventra" });

  const result = { ok: true, uid: user.uid, email: user.email || null, planName: account.data().planName || null, supportAdmin };
  if (needCredentials) {
    // Una sola caja en la nube por comercio: la anterior se reemplaza
    const old = await db.collection("ventra_devices").where("uid", "==", user.uid).where("kind", "==", "cloud").get();
    await Promise.all(old.docs.map((d) => d.ref.delete()));
    const deviceId = crypto.randomUUID();
    const deviceSecret = crypto.randomBytes(32).toString("hex");
    await db.collection("ventra_devices").doc(deviceId).set({
      uid: user.uid,
      secretHash: sha256(deviceSecret),
      name: "Caja en la nube",
      kind: "cloud",
      linkedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    Object.assign(result, { deviceId, deviceSecret });
    logger.info(`Ventra: caja en la nube para ${user.uid}`);
  }
  return res.status(200).json(result);
});

// ─── Panel de administración (ventra.store/admin) ───────────────────
// Una sola función: devuelve el resumen del negocio y aplica acciones sobre
// cuentas y PCs. Solo responde a las cuentas de ADMIN_EMAILS; cada acción
// queda registrada en ventra_admin_log.

const DAY = 24 * 60 * 60 * 1000;

function accountState(paidUntil, now) {
  if (!paidUntil) return { state: "UNPAID", daysLeft: null };
  const until = paidUntil.getTime();
  const graceEnd = until + GRACE_DAYS * DAY;
  if (now <= until) return { state: "ACTIVE", daysLeft: Math.ceil((until - now) / DAY) };
  if (now <= graceEnd) return { state: "GRACE", daysLeft: Math.ceil((graceEnd - now) / DAY) };
  return { state: "READ_ONLY", daysLeft: -Math.floor((now - graceEnd) / DAY) };
}

const tsToIso = (ts) => (ts && ts.toDate ? ts.toDate().toISOString() : null);

/**
 * La tienda online de cada cuenta (si armó una), con el mismo criterio que usa la app:
 * la que tiene dirección web y, entre esas, la más reciente.
 */
async function adminStoresByOwner() {
  const snap = await db.collection("ventra_stores").where("claimed", "==", true).get();
  const ms = (t) => (t && t.toMillis ? t.toMillis() : 0);
  const best = {};
  snap.forEach((doc) => {
    const x = doc.data();
    if (!x.ownerUid) return;
    const cur = best[x.ownerUid];
    const score = (d) => [Number(!!d.data().subdomain), ms(d.data().updatedAt)];
    if (!cur) { best[x.ownerUid] = doc; return; }
    const [a1, a2] = score(doc), [b1, b2] = score(cur);
    if (a1 > b1 || (a1 === b1 && a2 > b2)) best[x.ownerUid] = doc;
  });
  const out = {};
  await Promise.all(Object.entries(best).map(async ([uid, doc]) => {
    const x = doc.data();
    const [products, orders] = await Promise.all([
      doc.ref.collection("products").count().get().then((r) => r.data().count).catch(() => null),
      doc.ref.collection("orders").count().get().then((r) => r.data().count).catch(() => null),
    ]);
    out[uid] = {
      id: doc.id,
      name: x.businessName || null,
      subdomain: x.subdomain || null,
      published: !!x.isPublished,
      url: x.subdomain ? `https://tienda.ventra.store/${x.subdomain}` : null,
      logoUrl: x.logoUrl || null,
      primaryColor: x.primaryColor || null,
      products,
      orders,
      updatedAt: tsToIso(x.updatedAt),
    };
  }));
  return out;
}

/** Usuarios de Firebase Auth con email (los anónimos de las tiendas y PCs no cuentan). */
async function listAuthUsersWithEmail() {
  const out = [];
  let pageToken;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    page.users.forEach((u) => {
      if (!u.email || u.disabled) return;
      out.push({
        uid: u.uid,
        email: u.email.toLowerCase(),
        name: u.displayName || null,
        photoUrl: u.photoURL || null,
        createdAt: u.metadata.creationTime ? new Date(u.metadata.creationTime).toISOString() : null,
        lastSignInAt: u.metadata.lastSignInTime ? new Date(u.metadata.lastSignInTime).toISOString() : null,
      });
    });
    pageToken = page.pageToken;
  } while (pageToken && out.length < 20000);
  return out;
}

async function buildAdminOverview() {
  const now = Date.now();
  const [accountsSnap, devicesSnap, paymentsSnap, cloudByUid, storeByUid, authUsers] = await Promise.all([
    db.collection("ventra_accounts").get(),
    db.collection("ventra_devices").get(),
    db.collectionGroup("payments").get(),
    // Datos replicados en Neon: si la base no responde, el panel igual carga
    cloudSync.adminSummary(String(NEON_DATABASE_URL.value() || "").trim()).catch((err) => {
      logger.warn("Ventra admin: sin resumen de la nube", err.message);
      return {};
    }),
    adminStoresByOwner().catch((err) => {
      logger.warn("Ventra admin: sin tiendas online", err.message);
      return {};
    }),
    listAuthUsersWithEmail().catch((err) => {
      logger.warn("Ventra admin: sin lista de usuarios", err.message);
      return [];
    }),
  ]);

  const devicesByUid = {};
  devicesSnap.forEach((d) => {
    const data = d.data();
    (devicesByUid[data.uid] = devicesByUid[data.uid] || []).push({
      deviceId: d.id,
      name: data.name || "PC",
      linkedAt: tsToIso(data.linkedAt),
      lastSeenAt: tsToIso(data.lastSeenAt),
    });
  });

  const paymentsByUid = {};
  const monthly = {};
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  let totalRevenue = 0, monthRevenue = 0;
  paymentsSnap.forEach((p) => {
    const uid = p.ref.parent.parent && p.ref.parent.parent.id;
    if (!uid) return;
    const data = p.data();
    const amount = Number(data.amount) || 0;
    const paidAt = data.paidAt ? data.paidAt.toDate() : null;
    (paymentsByUid[uid] = paymentsByUid[uid] || []).push({ id: p.id, amount, paidAt: paidAt ? paidAt.toISOString() : null, method: data.manual ? (data.method || "manual") : "mercadopago", months: data.months || 1 });
    totalRevenue += amount;
    if (paidAt) {
      const key = paidAt.toISOString().slice(0, 7);
      monthly[key] = (monthly[key] || 0) + amount;
      if (paidAt >= monthStart) monthRevenue += amount;
    }
  });

  let mrr = 0;
  const byPlan = {};
  const byState = { ACTIVE: 0, GRACE: 0, READ_ONLY: 0, UNPAID: 0 };
  const accounts = accountsSnap.docs.map((doc) => {
    const a = doc.data();
    const paidUntil = a.paidUntil ? a.paidUntil.toDate() : null;
    const { state, daysLeft } = accountState(paidUntil, now);
    const payments = (paymentsByUid[doc.id] || []).sort((x, y) => String(y.paidAt).localeCompare(String(x.paidAt)));
    const planInfo = VENTRA_PLANS[a.plan];
    const renewing = a.status === "active" && (state === "ACTIVE" || state === "GRACE");
    if (renewing && planInfo) mrr += planInfo.amount;
    byState[state] = (byState[state] || 0) + 1;
    if (a.plan) byPlan[a.plan] = (byPlan[a.plan] || 0) + 1;
    return {
      uid: doc.id,
      email: a.email || null,
      plan: a.plan || null,
      planName: a.planName || (planInfo && planInfo.name) || a.plan || null,
      planAmount: planInfo ? planInfo.amount : null,
      mpStatus: a.status || null,
      paidUntil: paidUntil ? paidUntil.toISOString() : null,
      state,
      daysLeft,
      totalPaid: payments.reduce((s, p) => s + p.amount, 0),
      payments: payments.slice(0, 24),
      devices: devicesByUid[doc.id] || [],
      cloud: cloudByUid[doc.id] || null,
      store: storeByUid[doc.id] || null,
      createdAt: tsToIso(a.createdAt) || tsToIso(a.updatedAt),
      notes: a.adminNotes || "",
    };
  });

  // Registrados (entraron con Google) que todavía no tienen cuenta: no eligieron plan
  const withAccount = new Set(accountsSnap.docs.map((d) => d.id));
  const registered = authUsers
    .filter((u) => !withAccount.has(u.uid))
    .map((u) => ({ ...u, store: storeByUid[u.uid] || null, devices: (devicesByUid[u.uid] || []).length }))
    .sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)));

  const stateOrder = { GRACE: 0, READ_ONLY: 1, UNPAID: 2, ACTIVE: 3 };
  accounts.sort((x, y) => (stateOrder[x.state] - stateOrder[y.state]) || String(x.email).localeCompare(String(y.email)));

  return {
    generatedAt: new Date(now).toISOString(),
    graceDays: GRACE_DAYS,
    plans: Object.fromEntries(Object.entries(VENTRA_PLANS).map(([k, v]) => [k, { name: v.name, amount: v.amount }])),
    metrics: {
      mrr, totalRevenue, monthRevenue,
      accounts: accounts.length,
      devices: devicesSnap.size,
      byState, byPlan,
      monthly: Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b)).slice(-12).map(([month, amount]) => ({ month, amount })),
    },
    accounts,
    registered,
  };
}

exports.ventraAdmin = onRequest(
  { cors: [/ventra\.store$/, /ventra-9cba5\.(web\.app|firebaseapp\.com)$/], secrets: [NEON_DATABASE_URL] },
  async (req, res) => {
    const user = await verifyUser(req);
    if (!isAdmin(user)) return res.status(403).json({ error: "Sin acceso" });

    if (req.method === "GET") {
      try {
        return res.status(200).json(await buildAdminOverview());
      } catch (err) {
        logger.error("Ventra admin: error armando el resumen", err);
        return res.status(500).json({ error: "No se pudo cargar el panel" });
      }
    }
    if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

    const { action, uid, days, date, deviceId, notes, plan, amount, months, email, method } = req.body || {};
    const log = (details) => db.collection("ventra_admin_log").add({
      admin: user.email, action, ...details, at: admin.firestore.FieldValue.serverTimestamp(),
    });

    try {
      // Entrar al sistema del cliente en app.ventra.store como su administrador.
      // Se entrega un pase de un solo uso que vence en 2 minutos; lo canjea el
      // anfitrión de cajas por medio de ventraCloudAccess.
      if (action === "supportAccess") {
        if (!uid) return res.status(400).json({ error: "Falta el cliente" });
        const account = await db.collection("ventra_accounts").doc(String(uid)).get();
        if (!account.exists) return res.status(404).json({ error: "Cliente inexistente" });
        const ticket = crypto.randomBytes(32).toString("hex");
        await db.collection("ventra_support_tickets").doc(sha256(ticket)).set({
          uid: String(uid),
          admin: user.email,
          expiresAt: admin.firestore.Timestamp.fromMillis(Date.now() + 2 * 60 * 1000),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await log({ uid: String(uid) });
        return res.status(200).json({ url: `${CLOUD_APP_URL}/_ventra/support?t=${ticket}` });
      }

      // Tienda online armada por Ventra para el comercio (planes Tienda y Full). Nace a nombre
      // de su cuenta: cuando el comercio entra a la app, la sesión la encuentra por ownerUid.
      if (action === "createStore") {
        if (!uid) return res.status(400).json({ error: "Falta el cliente" });
        const acc = await db.collection("ventra_accounts").doc(String(uid)).get();
        if (!acc.exists) return res.status(404).json({ error: "Cliente inexistente" });
        if (acc.data().plan === "caja") return res.status(400).json({ error: "Su plan (Ventra Caja) no incluye tienda online" });
        const name = String((req.body && req.body.name) || "").trim().slice(0, 80);
        const slug = String((req.body && req.body.subdomain) || "").trim().toLowerCase();
        const wa = String((req.body && req.body.whatsapp) || "").replace(/\D/g, "").slice(0, 20);
        if (name.length < 2) return res.status(400).json({ error: "Poné el nombre de la tienda" });
        if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug)) return res.status(400).json({ error: "Dirección web inválida: solo minúsculas, números y guiones (3 a 40)" });
        const stores = db.collection("ventra_stores");
        const owned = await stores.where("ownerUid", "==", String(uid)).get();
        if (owned.docs.some((d) => d.data().subdomain)) return res.status(409).json({ error: "Ya tiene una tienda con dirección web" });
        const taken = await stores.where("subdomain", "==", slug).limit(1).get();
        if (!taken.empty) return res.status(409).json({ error: `La dirección tienda.ventra.store/${slug} ya está en uso` });
        // Si empezó a armarla (sin dirección) se completa esa; si no, una nueva
        const ref = owned.docs[0] ? owned.docs[0].ref : stores.doc(`store_${crypto.randomUUID().replace(/-/g, "")}`);
        const base = owned.docs[0] ? {} : {
          rubro: "OTRO", primaryColor: "#0E6E52", secondaryColor: "#1e293b", logoUrl: "", bannerUrl: "", address: "", instagram: "",
          description: "", announcement: "",
          hours: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: d !== 0, from: "09:00", to: "20:00" })),
          pickupEnabled: true, deliveryEnabled: false, goDeliveryEnabled: false, deliveryCost: 0, freeDeliveryFrom: 0, deliveryZone: "",
          minOrder: 0, paymentMethods: ["Efectivo", "Transferencia"], transferAlias: "", showOutOfStock: true, isPublished: false,
          createdAt: admin.firestore.FieldValue.serverTimestamp(), createdByAdmin: user.email,
        };
        await ref.set({
          ...base,
          businessName: name, subdomain: slug, ...(wa ? { whatsappNumber: wa } : {}),
          ownerUid: String(uid), claimed: true, updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
        await log({ uid: String(uid), storeId: ref.id, subdomain: slug });
        return res.status(200).json({ ok: true, storeId: ref.id, url: `https://tienda.ventra.store/${slug}` });
      }

      if (action === "setStorePublished") {
        if (!uid) return res.status(400).json({ error: "Falta el cliente" });
        const storeId = String((req.body && req.body.storeId) || "");
        const ref = db.collection("ventra_stores").doc(storeId);
        const snap = storeId ? await ref.get() : null;
        if (!snap || !snap.exists || snap.data().ownerUid !== String(uid)) return res.status(404).json({ error: "Tienda inexistente" });
        if (!snap.data().subdomain) return res.status(400).json({ error: "La tienda no tiene dirección web" });
        const published = !!(req.body && req.body.published);
        await ref.update({ isPublished: published, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
        await log({ uid: String(uid), storeId, published });
        return res.status(200).json({ ok: true });
      }

      if (action === "unlinkDevice") {
        if (!deviceId) return res.status(400).json({ error: "Falta la PC" });
        const ref = db.collection("ventra_devices").doc(String(deviceId));
        const snap = await ref.get();
        if (!snap.exists) return res.status(404).json({ error: "La PC ya no está vinculada" });
        await ref.delete();
        await log({ uid: snap.data().uid, deviceId });
        return res.status(200).json({ ok: true });
      }

      // Cliente nuevo que pagó por fuera de la web: se crea por email. Si todavía no
      // entró nunca con Google, se le reserva la cuenta; al entrar con ese mismo
      // email Google queda asociado a ella y ya la ve activa.
      if (action === "createAccount") {
        const mail = String(email || "").trim().toLowerCase();
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) return res.status(400).json({ error: "Email inválido" });
        if (!VENTRA_PLANS[plan]) return res.status(400).json({ error: "Elegí un plan" });
        const n = Number(days);
        if (!Number.isFinite(n) || n < 0 || n > 3650) return res.status(400).json({ error: "Cantidad de días inválida" });
        let authUser;
        try { authUser = await admin.auth().getUserByEmail(mail); } catch { authUser = await admin.auth().createUser({ email: mail, emailVerified: true }); }
        const ref = db.collection("ventra_accounts").doc(authUser.uid);
        if ((await ref.get()).exists) return res.status(409).json({ error: "Ese email ya tiene una cuenta: buscala en la lista" });
        await ref.set({
          email: mail,
          plan,
          planName: VENTRA_PLANS[plan].name,
          status: "manual",
          paidUntil: n > 0 ? admin.firestore.Timestamp.fromMillis(Date.now() + n * DAY) : null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        await log({ uid: authUser.uid, email: mail, plan, days: n });
        return res.status(200).json({ ok: true, uid: authUser.uid });
      }

      if (!uid) return res.status(400).json({ error: "Falta el cliente" });
      const ref = db.collection("ventra_accounts").doc(String(uid));
      const snap = await ref.get();
      if (!snap.exists) return res.status(404).json({ error: "Cliente inexistente" });
      const current = snap.data().paidUntil ? snap.data().paidUntil.toDate() : null;
      let paidUntil = null;

      if (action === "extend") {
        const n = Number(days);
        if (!Number.isFinite(n) || n === 0 || Math.abs(n) > 3650) return res.status(400).json({ error: "Cantidad de días inválida" });
        // Si ya estaba vencido, los días se suman desde hoy
        const base = current && current.getTime() > Date.now() ? current : new Date();
        paidUntil = new Date(base.getTime() + n * DAY);
      } else if (action === "setPaidUntil") {
        const d = new Date(date);
        if (isNaN(d.getTime())) return res.status(400).json({ error: "Fecha inválida" });
        paidUntil = d;
      } else if (action === "readOnly") {
        paidUntil = new Date(Date.now() - (GRACE_DAYS + 1) * DAY);
      } else if (action === "setPlan") {
        if (!VENTRA_PLANS[plan]) return res.status(400).json({ error: "Plan inválido" });
        await ref.set({ plan, planName: VENTRA_PLANS[plan].name, updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
        await log({ uid, plan });
        return res.status(200).json({ ok: true });
      } else if (action === "manualPayment") {
        // Pago por fuera de Mercado Pago: mismas reglas de gracia y queda en los cobros
        const m = Number(months), amt = Number(amount);
        if (!Number.isInteger(m) || m < 1 || m > 36) return res.status(400).json({ error: "Meses inválidos (1 a 36)" });
        if (!Number.isFinite(amt) || amt < 0) return res.status(400).json({ error: "Monto inválido" });
        const paidAt = new Date();
        const newUntil = nextPaidUntil(current, paidAt, m);
        await ref.collection("payments").doc(`manual-${paidAt.getTime()}`).set({
          amount: amt,
          months: m,
          method: String(method || "manual").slice(0, 40),
          manual: true,
          paidAt: admin.firestore.Timestamp.fromDate(paidAt),
          previousPaidUntil: current ? admin.firestore.Timestamp.fromDate(current) : null,
          newPaidUntil: admin.firestore.Timestamp.fromDate(newUntil),
          registeredBy: user.email,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        const updates = { paidUntil: admin.firestore.Timestamp.fromDate(newUntil), updatedAt: admin.firestore.FieldValue.serverTimestamp() };
        if (VENTRA_PLANS[plan]) Object.assign(updates, { plan, planName: VENTRA_PLANS[plan].name });
        // Si nunca pasó por Mercado Pago, queda marcado como cliente manual
        if (!snap.data().mpPreapprovalId) updates.status = "manual";
        await ref.set(updates, { merge: true });
        await log({ uid, amount: amt, months: m, to: newUntil.toISOString() });
        return res.status(200).json({ ok: true, paidUntil: newUntil.toISOString() });
      } else if (action === "notes") {
        await ref.set({ adminNotes: String(notes || "").slice(0, 2000) }, { merge: true });
        await log({ uid });
        return res.status(200).json({ ok: true });
      } else {
        return res.status(400).json({ error: "Acción desconocida" });
      }

      await ref.set({
        paidUntil: admin.firestore.Timestamp.fromDate(paidUntil),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      await log({ uid, from: current ? current.toISOString() : null, to: paidUntil.toISOString() });
      return res.status(200).json({ ok: true, paidUntil: paidUntil.toISOString() });
    } catch (err) {
      logger.error("Ventra admin: error en acción", action, err);
      return res.status(500).json({ error: "No se pudo aplicar el cambio" });
    }
  },
);

// El workflow de releases de GitHub lo llama al publicar una versión nueva,
// así cada POS abierto se entera al instante. Protegido con un secreto
// compartido (header x-release-secret) — el documento es de solo lectura
// para los clientes según firestore.rules.
exports.publishDesktopVersion = onRequest({ secrets: [RELEASE_PUSH_SECRET] }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");

  // trim(): al cargar el secreto desde Windows puede quedar un salto de línea al final
  const given = Buffer.from(String(req.get("x-release-secret") || "").trim());
  const expected = Buffer.from(String(RELEASE_PUSH_SECRET.value() || "").trim());
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return res.status(401).send("Unauthorized");
  }

  const version = String((req.body && req.body.version) || "").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+([-.][\w.]+)?$/.test(version)) return res.status(400).send("Versión inválida");

  await db.collection("ventra_desktop").doc("latest_version").set({
    version,
    publishedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  res.status(200).json({ ok: true, version });
});


// ─── Avisos al celular del dueño (ver notify.js) ───
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const notify = require("./notify");

/** Pedido online nuevo */
exports.ventraOrderPush = onDocumentCreated("ventra_stores/{storeId}/orders/{orderId}", async (event) => {
  const order = event.data && event.data.data();
  if (!order) return;
  const storeId = event.params.storeId;
  const store = await db.collection("ventra_stores").doc(storeId).get();
  const uid = store.exists && store.data().ownerUid;
  if (!uid) return;
  const count = (order.items || []).reduce((s, i) => s + (Number(i.qty) || 0), 0);
  const how = order.delivery === "DELIVERY" || order.delivery === "GODELIVERY" ? "envío" : "retiro";
  await notify.sendToAccount(db, uid, "orders", {
    title: `Nuevo pedido${order.orderCode ? " #" + order.orderCode : ""}: ${notify.money(order.total)}`,
    body: `${order.customerName || "Un cliente"} · ${count} ${count === 1 ? "producto" : "productos"} · ${how}`,
    url: "/#/pedidos", tag: "order-" + event.params.orderId,
  }, { storeId });
});

/**
 * Eventos que manda la PC del comercio (stock mínimo, cierre con diferencia, anulación,
 * factura rechazada). Se autentica con la vinculación del equipo.
 * Responde { ok, sent, reason }: con reason 'quiet' la PC lo guarda y lo reintenta después.
 */
exports.ventraNotify = onRequest({ cors: true }, async (req, res) => {
  if (req.method !== "POST") return res.status(405).send("Method Not Allowed");
  const { deviceId, deviceSecret, event } = req.body || {};
  const uid = await deviceTenant(deviceId, deviceSecret);
  if (!uid) return res.status(401).json({ error: "Equipo no vinculado" });
  if (event && event.type === "lowStock" && event.data && Array.isArray(event.data.items)) {
    // Con varias cajas, cada una detecta lo suyo: el mismo producto no avisa dos veces en 24 h
    const ref = db.collection("ventra_push").doc(uid);
    const seen = ((await ref.get()).data() || {}).lowStockSeen || {};
    const now = Date.now();
    event.data.items = event.data.items.filter((i) => i && i.id && now - (Number(seen[i.id]) || 0) > 24 * 3600000).slice(0, 50);
    if (!event.data.items.length) return res.status(200).json({ ok: true, sent: 0, reason: "repeated" });
  }
  const msg = event && notify.messageFor(event);
  if (!msg) return res.status(400).json({ error: "Evento inválido" });
  try {
    const r = await notify.sendToAccount(db, uid, String(event.type), msg);
    if (event.type === "lowStock" && r.reason !== "quiet") {
      const patch = {};
      event.data.items.forEach((i) => { patch["lowStockSeen." + i.id] = Date.now(); });
      await db.collection("ventra_push").doc(uid).set({}, { merge: true });
      await db.collection("ventra_push").doc(uid).update(patch);
    }
    return res.status(200).json({ ok: true, ...r });
  } catch (err) {
    logger.error("Ventra aviso: error", err);
    return res.status(500).json({ error: "No se pudo enviar" });
  }
});

/** Pedido que nadie empezó a preparar en 15 minutos (se avisa una sola vez) */
exports.ventraOrderIdle = onSchedule({ schedule: "every 5 minutes", timeZone: notify.TZ }, async () => {
  const now = Date.now();
  const stores = await db.collection("ventra_stores").where("isPublished", "==", true).get();
  for (const store of stores.docs) {
    const uid = store.data().ownerUid;
    if (!uid || String(uid).startsWith("archived:")) continue;
    const recent = await store.ref.collection("orders")
      .where("createdAt", ">=", admin.firestore.Timestamp.fromMillis(now - 3 * 3600000)).get();
    const idle = recent.docs.filter((d) => {
      const o = d.data();
      const at = o.createdAt && o.createdAt.toMillis ? o.createdAt.toMillis() : now;
      return (!o.stage || o.stage === "NEW") && !o.idleNotified && now - at >= 15 * 60000;
    });
    if (!idle.length) continue;
    const first = idle[0].data();
    await notify.sendToAccount(db, uid, "orderIdle", {
      title: idle.length === 1 ? `El pedido${first.orderCode ? " #" + first.orderCode : ""} lleva 15 min sin atender` : `${idle.length} pedidos llevan más de 15 min sin atender`,
      body: idle.length === 1 ? `${first.customerName || "Un cliente"} · ${notify.money(first.total)} · tocá para verlo` : "Tus clientes están esperando: tocá para verlos",
      url: "/#/pedidos", tag: "order-idle",
    }, { storeId: store.id });
    await Promise.all(idle.map((d) => d.ref.update({ idleNotified: true })));
  }
});

/** Resumen del día, a la hora que eligió cada dueño */
exports.ventraDailySummary = onSchedule({ schedule: "0 * * * *", timeZone: notify.TZ, secrets: [NEON_DATABASE_URL] }, async () => {
  const hour = notify.localHour();
  const wanted = await db.collection("ventra_push").where("prefs.dailySummary", "==", true).get();
  if (wanted.empty) return;
  const sql = cloudSync.db(String(NEON_DATABASE_URL.value() || "").trim());
  await cloudSync.ensureSchema(sql);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: notify.TZ });
  const lastWeek = new Date(Date.parse(today) - 7 * 86400000).toISOString().slice(0, 10);
  for (const doc of wanted.docs) {
    const prefs = { ...notify.DEFAULT_PREFS, ...(doc.data().prefs || {}) };
    if (Number(prefs.summaryHour) !== hour) continue;
    try {
      const [day, prev] = await Promise.all([
        dashboard.overview(sql, doc.id, today, today),
        dashboard.overview(sql, doc.id, lastWeek, lastWeek),
      ]);
      const total = Number(day.summary.total) || 0, count = Number(day.summary.count) || 0;
      const before = Number(prev.summary.total) || 0;
      const pct = before > 0 ? Math.round(((total - before) / before) * 100) : null;
      const weekday = new Intl.DateTimeFormat("es-AR", { weekday: "long", timeZone: notify.TZ }).format(new Date());
      await notify.sendToAccount(db, doc.id, "dailySummary", {
        title: `Hoy vendiste ${notify.money(total)}`,
        body: `${count} ${count === 1 ? "venta" : "ventas"}` + (pct === null ? "" : ` · ${pct >= 0 ? "+" : ""}${pct}% vs. el ${weekday} pasado`),
        url: "/#/inicio", tag: "daily-summary",
      }, { ignoreQuiet: true });
    } catch (err) {
      logger.error(`Ventra resumen: error (${doc.id})`, err);
    }
  }
});

// ─── Copia de seguridad nocturna de Neon ────────────────────────────
// Todas las noches vuelca la base de sincronización completa (todos los comercios)
// a Cloud Storage y borra las copias de más de 30 días. Ver backup.js.
const backup = require("./backup");

exports.ventraNightlyBackup = onSchedule(
  { schedule: "30 4 * * *", timeZone: notify.TZ, secrets: [NEON_DATABASE_URL], memory: "1GiB", timeoutSeconds: 540, retryCount: 2 },
  async () => {
    const started = Date.now();
    const today = new Date().toLocaleDateString("en-CA", { timeZone: notify.TZ });
    const sql = cloudSync.db(String(NEON_DATABASE_URL.value() || "").trim());
    await cloudSync.ensureSchema(sql);
    const bucket = admin.storage().bucket();
    const file = bucket.file(`${backup.PREFIX}${today}.ndjson.gz`);
    const counts = await backup.dumpToFile(sql, file, { day: today });
    const [meta] = await file.getMetadata();
    const pruned = await backup.pruneOld(bucket, today);
    logger.info("Ventra copia de seguridad lista", { file: file.name, bytes: Number(meta.size), counts, pruned, ms: Date.now() - started });
  }
);

// ─── Agenda de turnos (ver agenda.js) ───
const agenda = require("./agenda");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");

/** Reserva pública desde la tienda: valida y crea el turno sin superponerse con otro. */
exports.agendaBook = onRequest({ cors: true, maxInstances: 10 }, (req, res) => agenda.book(db, req, res));

/** Cada cambio de un turno: actualiza lo ocupado del día y avisa al dueño si es una reserva online nueva. */
exports.ventraBookingWritten = onDocumentWritten("ventra_stores/{storeId}/bookings/{bookingId}", async (event) => {
  const before = event.data && event.data.before.exists ? event.data.before.data() : null;
  const after = event.data && event.data.after.exists ? event.data.after.data() : null;
  const { storeId } = event.params;
  const days = new Set([before && before.dateKey, after && after.dateKey].filter(Boolean));
  const changed = !before || !after || before.dateKey !== after.dateKey || before.startMin !== after.startMin || before.endMin !== after.endMin
    || before.staffId !== after.staffId || before.status !== after.status;
  if (changed) await Promise.all([...days].map((d) => agenda.refreshBusy(db, storeId, d)));

  if (!before && after && after.kind === "booking" && after.source === "online") {
    const store = await db.collection("ventra_stores").doc(storeId).get();
    const uid = store.exists && store.data().ownerUid;
    if (!uid) return;
    await notify.sendToAccount(db, uid, "bookings", {
      title: `Nuevo turno: ${after.serviceName || "turno"} · ${agenda.fmtDay(after.dateKey)} ${agenda.hhmm(after.startMin)}`,
      body: `${after.customerName || "Un cliente"}${after.staffName ? " con " + after.staffName : ""}${after.status === "PENDING" ? " · para confirmar" : ""}`,
      url: "/#/agenda", tag: "booking-" + event.params.bookingId,
    }, { storeId });
  }
});

// ─── Tienda: vista previa del link (WhatsApp, Instagram, Facebook) ───
// Los que arman la vista previa no ejecutan JavaScript: la página de cada tienda sale del
// servidor con su nombre, descripción y portada ya puestos. El resto lo sigue haciendo la tienda.
let tiendaHtml = { at: 0, html: "" };
const attr = (v) => String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const findStore = async (slug) => {
  if (!slug || !/^[a-z0-9-]{2,60}$/.test(slug)) return null;
  const snap = await db.collection("ventra_stores").where("claimed", "==", true).where("subdomain", "==", slug).limit(1).get();
  return snap.empty ? null : snap.docs[0].data();
};
exports.storePage = onRequest({ maxInstances: 20, memory: "256MiB" }, async (req, res) => {
  // /_og/<tienda>: la portada (o el logo) como imagen, para las tiendas que la tienen guardada embebida
  const og = String(req.path || "").match(/^\/_og\/([a-z0-9-]{2,60})/);
  if (og) {
    const c = await findStore(og[1]).catch(() => null);
    const src = c && (c.bannerUrl || c.logoUrl) || "";
    const m = src.match(/^data:(image\/[a-z+]+);base64,(.+)$/);
    if (m) { res.set("Cache-Control", "public, max-age=3600, s-maxage=86400"); return res.status(200).type(m[1]).send(Buffer.from(m[2], "base64")); }
    if (/^https:\/\//.test(src)) return res.redirect(302, src);
    return res.status(404).send("Sin imagen");
  }
  if (Date.now() - tiendaHtml.at > 5 * 60 * 1000 || !tiendaHtml.html) {
    // index.html existe como archivo: el hosting lo sirve directo, sin volver a pasar por esta función
    const r = await fetch("https://ventra-9cba5-tienda.web.app/index.html");
    if (r.ok) tiendaHtml = { at: Date.now(), html: await r.text() };
  }
  let html = tiendaHtml.html;
  if (!html) return res.status(503).send("La tienda no está disponible en este momento. Probá de nuevo en un rato.");
  const slug = decodeURIComponent(String(req.path || "").replace(/^\/+|\/+$/g, "").split("/")[0] || "");
  try {
    if (slug && /^[a-z0-9-]{2,60}$/.test(slug)) {
      const c = await findStore(slug);
      if (c && c.isPublished) {
        const name = c.businessName || "Tienda online";
        const title = `${name} · Pedí online`;
        const desc = c.description || `Mirá la carta de ${name} y hacé tu pedido online.`;
        const src = c.bannerUrl || c.logoUrl || "";
        // Las imágenes embebidas se sirven desde /_og/<tienda> (una vista previa necesita una dirección https)
        const img = !src ? "" : /^https:\/\//.test(src) ? src : `https://tienda.ventra.store/_og/${slug}`;
        const url = `https://tienda.ventra.store/${slug}`;
        html = html
          .replace(/<title id="pageTitle">[^<]*<\/title>/, `<title id="pageTitle">${attr(title)}</title>`)
          .replace(/(<meta name="description" id="metaDesc" content=")[^"]*"/, `$1${attr(desc)}"`)
          .replace(/(<meta property="og:title" id="ogTitle" content=")[^"]*"/, `$1${attr(title)}"`)
          .replace(/(<meta property="og:description" id="ogDesc" content=")[^"]*"/, `$1${attr(desc)}"`)
          .replace(/(<meta property="og:image" id="ogImage" content=")[^"]*"/, `$1${attr(img)}"`)
          .replace("</head>", `<meta property="og:url" content="${attr(url)}">\n<meta property="og:site_name" content="${attr(name)}">\n<meta name="twitter:card" content="${img ? "summary_large_image" : "summary"}">\n<link rel="canonical" href="${attr(url)}">\n</head>`);
      }
    }
  } catch (err) {
    logger.warn("storePage: sin datos de la tienda", slug, err.message);
  }
  res.set("Cache-Control", "public, max-age=60, s-maxage=300");
  res.status(200).type("html").send(html);
});
