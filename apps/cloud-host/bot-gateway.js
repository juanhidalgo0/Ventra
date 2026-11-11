// ═══════════════════════════════════════════════════════════════════
// Entrada del bot de WhatsApp del dueño a la caja en la nube de su comercio.
//
// POST /_ventra/bot  (solo la función de Ventra: header x-cloud-secret = CLOUD_HOST_SECRET)
//   { uid, calls: [{ method, path, query?, body? }], provision? }
//   → { ok, results: [{ status, body }] }  ·  503 { preparing } mientras la caja baja los datos
//
// - La caja se levanta si estaba apagada y el bot entra como el administrador con la llave de
//   soporte que el anfitrión le dio a esa caja (nunca sale de este servidor).
// - Solo /api/…, sin lo que el bot no puede tocar (login, contraseñas, sincronización, sistema,
//   suscripción…). Lo mismo se filtra en la función, esto es la segunda barrera.
// - provision: si el comercio nunca abrió la caja en la nube, se da de alta (como cuando entra
//   por primera vez con Google) y queda preparándose.
// ═══════════════════════════════════════════════════════════════════
const http = require('http');
const crypto = require('crypto');

const DENY = [
  /^\/api\/auth(\/|$)/, /^\/api\/sync(\/|$)/, /^\/api\/system(\/|$)/, /^\/api\/demo(\/|$)/,
  /^\/api\/subscription(\/|$)/, /^\/api\/notifications(\/|$)/, /^\/api\/ai(\/|$)/,
  /^\/api\/users\/[^/]+\/password/, /^\/api\/settings\/license/, /^\/api\/mercadopago\/(credentials|connect|oauth)/,
  /^\/api\/pos-trail(\/|$)/, /^\/api\/product-images(\/|$)/,
];
const METHODS = new Set(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']);
const MAX_CALLS = 5;
const MAX_RESPONSE = 400 * 1024;
const TOKEN_MS = 10 * 60 * 1000;

/** Una ruta que el bot puede usar: /api/…, sin "..", sin lo bloqueado */
function allowedPath(p) {
  // Los filtros van aparte (query): una ruta con "?" no se acepta
  const path = String(p || '');
  if (!/^\/api\/[A-Za-z0-9_\-/.:%]+$/.test(path) || path.includes('..') || path.includes('//')) return false;
  return !DENY.some((d) => d.test(path));
}

function sameSecret(given, expected) {
  const a = Buffer.from(String(given || '').trim());
  const b = Buffer.from(String(expected || '').trim());
  return b.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Pedido a la caja local (127.0.0.1:port). Devuelve { status, body } (body: JSON si se puede) */
function localRequest(port, { method, path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    const data = body === undefined || body === null ? null : Buffer.from(JSON.stringify(body));
    const req = http.request({
      host: '127.0.0.1', port, method, path,
      headers: { Accept: 'application/json', ...(data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {}), ...headers },
      timeout: 60000,
    }, (res) => {
      const chunks = []; let size = 0; let cut = false;
      res.on('data', (c) => { size += c.length; if (size <= MAX_RESPONSE) chunks.push(c); else cut = true; });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = text;
        if (!cut) { try { parsed = JSON.parse(text); } catch { /* texto */ } }
        resolve({ status: res.statusCode || 502, body: cut ? `${text.slice(0, 2000)}…(respuesta demasiado grande, recortada)` : parsed });
      });
    });
    req.on('timeout', () => req.destroy(new Error('La caja tardó demasiado en responder')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/**
 * deps: { hostSecret, ensureTenant(uid) → port, supportKey(uid), hasCreds(uid), isBootstrapped(uid),
 *         provision(uid), log, request? (para las pruebas) }
 */
function createBotGateway(deps) {
  const request = deps.request || localRequest;
  const tokens = new Map();

  async function tokenFor(uid, port) {
    const t = tokens.get(uid);
    if (t && t.port === port && Date.now() < t.exp) return t.token;
    const r = await request(port, { method: 'POST', path: '/api/auth/support-login', headers: { 'x-ventra-support-key': deps.supportKey(uid) || '' } });
    if (r.status >= 300 || !r.body || !r.body.accessToken) throw Object.assign(new Error((r.body && r.body.message) || 'La caja no dejó entrar al bot'), { status: 502 });
    tokens.set(uid, { token: r.body.accessToken, port, exp: Date.now() + TOKEN_MS });
    return r.body.accessToken;
  }

  /** headers: los del pedido; raw: el cuerpo en texto. Devuelve { status, json } */
  async function handle(headers, raw) {
    if (!sameSecret(headers['x-cloud-secret'], deps.hostSecret)) return { status: 401, json: { error: 'No autorizado' } };
    let input;
    try { input = JSON.parse(raw || '{}'); } catch { return { status: 400, json: { error: 'Pedido inválido' } }; }
    const uid = String(input.uid || '');
    if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) return { status: 400, json: { error: 'Comercio inválido' } };
    const calls = Array.isArray(input.calls) ? input.calls : [];
    if (!calls.length || calls.length > MAX_CALLS) return { status: 400, json: { error: `Entre 1 y ${MAX_CALLS} operaciones por pedido` } };
    for (const c of calls) {
      const method = String(c && c.method || '').toUpperCase();
      if (!METHODS.has(method) || !allowedPath(c.path)) return { status: 403, json: { error: `Operación no permitida: ${method} ${c && c.path}` } };
    }
    if (!deps.hasCreds(uid)) {
      if (!input.provision) return { status: 409, json: { error: 'Este comercio todavía no tiene la caja en la nube', noCloud: true } };
      await deps.provision(uid);
      deps.ensureTenant(uid).catch(() => {});
      return { status: 503, json: { preparing: true, error: 'Estoy preparando la caja en la nube de este comercio (la primera vez tarda unos minutos).' } };
    }
    if (!deps.isBootstrapped(uid)) {
      deps.ensureTenant(uid).catch(() => {});
      return { status: 503, json: { preparing: true, error: 'La caja en la nube todavía está bajando los datos del comercio. Probá en unos minutos.' } };
    }
    const port = await deps.ensureTenant(uid);
    let token = await tokenFor(uid, port);
    const results = [];
    for (const c of calls) {
      const method = String(c.method).toUpperCase();
      const qs = c.query && typeof c.query === 'object'
        ? Object.entries(c.query).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join('&')
        : '';
      const path = `${c.path}${qs ? `?${qs}` : ''}`;
      const send = () => request(port, { method, path, headers: { Authorization: `Bearer ${token}`, 'x-ventra-via': 'whatsapp-bot' }, body: method === 'GET' || method === 'DELETE' ? undefined : (c.body || {}) });
      let r = await send();
      // Token vencido (la caja se reinició): se entra de nuevo una vez
      if (r.status === 401) { tokens.delete(uid); token = await tokenFor(uid, port); r = await send(); }
      if (deps.log) deps.log(`Bot: ${uid} ${method} ${path} → ${r.status}`);
      results.push(r);
    }
    return { status: 200, json: { ok: true, results } };
  }

  return { handle, allowedPath };
}

module.exports = { createBotGateway, allowedPath, DENY, localRequest };
