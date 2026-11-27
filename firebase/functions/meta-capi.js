// Conversions API de Meta: le avisa al Píxel de ventra.store lo que pasa en Mercado Pago,
// que el navegador no ve (la persona ya se fue de la web).
//   StartTrial → MP autorizó la tarjeta y arrancó la prueba gratis
//   Subscribe  → primer cobro aprobado de la cuenta (con monto)
//   Purchase   → cada cobro mensual siguiente (con monto)
// Con el secreto META_CAPI_TOKEN vacío no hace nada. Nunca tira error: un problema con Meta
// no puede frenar el webhook de Mercado Pago (de eso depende que la caja siga andando).
// Prueba: ventra_config/meta { testEventCode: "TEST123" } manda los eventos a "Eventos de prueba".
const crypto = require("crypto");
const admin = require("firebase-admin");
const { logger } = require("firebase-functions");

const PIXEL_ID = "1136922689314192"; // mismo píxel que firebase/web/medicion.js
const API = `https://graph.facebook.com/v21.0/${PIXEL_ID}/events`;

const hash = (v) => (v ? crypto.createHash("sha256").update(String(v).trim().toLowerCase()).digest("hex") : null);

// Lo que el navegador manda al elegir el plan (cookies del píxel), para que Meta reconozca a la persona
function cleanSignupMeta(meta, req) {
  if (!meta || typeof meta !== "object") return null;
  const str = (v, n) => String(v || "").trim().slice(0, n);
  const out = {};
  const fbp = str(meta.fbp, 120); if (/^fb\.\d\.\d+\.\d+$/.test(fbp)) out.fbp = fbp;
  const fbc = str(meta.fbc, 400); if (/^fb\.\d\.\d+\./.test(fbc)) out.fbc = fbc;
  const url = str(meta.url, 300); if (/^https:\/\/(www\.)?ventra\.store\//.test(url)) out.url = url;
  const ua = str(req && req.get && req.get("user-agent"), 400); if (ua) out.ua = ua;
  const ip = str(req && req.get && String(req.get("x-forwarded-for") || "").split(",")[0], 60) || str(req && req.ip, 60);
  if (ip) out.ip = ip;
  return Object.keys(out).length ? out : null;
}

async function send({ token, eventName, eventId, uid, acc, value, eventTime }) {
  token = String(token || "").trim();
  if (!token) return { skipped: "sin token" };
  try {
    acc = acc || {};
    const m = acc.signupMeta || {};
    const emails = [...new Set([acc.email, acc.mpEmail].filter(Boolean).map((e) => hash(e)))];
    const user_data = {
      external_id: [hash(uid)],
      ...(emails.length ? { em: emails } : {}),
      ...(m.fbp ? { fbp: m.fbp } : {}),
      ...(m.fbc ? { fbc: m.fbc } : {}),
      ...(m.ua ? { client_user_agent: m.ua } : {}),
      ...(m.ip ? { client_ip_address: m.ip } : {}),
      country: [hash("ar")],
    };
    const event = {
      event_name: eventName,
      event_time: Math.floor((eventTime ? eventTime.getTime() : Date.now()) / 1000),
      event_id: String(eventId), // Meta descarta repetidos con el mismo id (MP avisa varias veces)
      action_source: "website",
      event_source_url: m.url || "https://ventra.store/empezar",
      user_data,
      ...(value ? { custom_data: { value: Number(value), currency: "ARS", content_name: acc.planName || acc.plan || "Ventra" } } : {}),
    };
    const cfg = (await admin.firestore().collection("ventra_config").doc("meta").get().catch(() => null));
    const testCode = cfg && cfg.exists ? String(cfg.data().testEventCode || "").trim() : "";
    const resp = await fetch(`${API}?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: [event], ...(testCode ? { test_event_code: testCode } : {}) }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      logger.warn(`Meta CAPI: ${eventName} de ${uid} rechazado`, resp.status, body && body.error && body.error.message);
      return { ok: false, status: resp.status };
    }
    logger.info(`Meta CAPI: ${eventName} de ${uid} enviado${testCode ? " (prueba)" : ""}`);
    return { ok: true, received: body.events_received };
  } catch (err) {
    logger.warn("Meta CAPI: no se pudo enviar", eventName, uid, err.message);
    return { ok: false };
  }
}

module.exports = { send, cleanSignupMeta, PIXEL_ID };
