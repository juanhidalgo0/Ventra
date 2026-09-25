// ═══════════════════════════════════════════════════════════════════
// Anfitrión de cajas en la nube — Ventra en el navegador.
//
// Un solo servidor atiende a todos los comercios. Cada comercio tiene su "caja
// en la nube": la MISMA app de siempre (backend de Ventra con su propia base
// SQLite), que se sincroniza con las PCs del local por el motor de dos sentidos.
//
//  - Entrada con Google: la función ventraCloudAccess verifica la cuenta y, la
//    primera vez, da de alta la caja en la nube del comercio.
//  - Sesión en cookie firmada; cada pedido /api y /socket.io va a la caja del
//    comercio de esa sesión. Nunca a la de otro.
//  - Las cajas se levantan al primer pedido y se apagan tras IDLE_MINUTES sin uso.
//  - El resto (la app web) se sirve desde el build del frontend.
//
// Variables de entorno:
//   PORT, DATA_DIR, BACKEND_MAIN, FRONTEND_DIR, VENTRA_FUNCTIONS_URL,
//   CLOUD_HOST_SECRET (compartido con la función), SESSION_SECRET, IDLE_MINUTES,
//   DEV_TENANT (solo pruebas locales: entra sin Google con ese comercio)
// ═══════════════════════════════════════════════════════════════════
const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const CFG = {
  port: Number(process.env.PORT || 8080),
  dataDir: process.env.DATA_DIR || '/data/tenants',
  backendMain: process.env.BACKEND_MAIN || path.join(ROOT, 'apps/backend/dist/main.js'),
  backendCwdFallback: path.join(ROOT, 'apps/backend'),
  frontendDir: process.env.FRONTEND_DIR || path.join(ROOT, 'apps/frontend/dist'),
  functionsUrl: process.env.VENTRA_FUNCTIONS_URL || 'https://us-central1-ventra-9cba5.cloudfunctions.net',
  hostSecret: process.env.CLOUD_HOST_SECRET || '',
  sessionSecret: process.env.SESSION_SECRET || '',
  idleMs: Number(process.env.IDLE_MINUTES || 15) * 60 * 1000,
  devTenant: process.env.DEV_TENANT || '',
  portBase: Number(process.env.TENANT_PORT_BASE || 4100),
};
// El dueño entra una vez con Google en esa computadora y la sesión no se cierra más:
// dura el máximo que permiten los navegadores (400 días) y se renueva sola con el uso.
// Cada cajero después entra con su usuario del POS. Para cerrar todas las sesiones
// abiertas de todos los comercios, se cambia SESSION_SECRET.
const SESSION_DAYS = 400;
const RENEW_AFTER_MS = 24 * 60 * 60 * 1000;
const COOKIE = 'ventra_web';
// Soporte desde ventra.store/admin: la sesión dura una jornada y no se renueva sola
const SUPPORT_HOURS = 8;
// Llave con la que la caja acepta la entrada automática de soporte. Cada caja recibe
// una distinta al arrancar; solo la conoce este anfitrión y nunca llega al navegador.
const SUPPORT_HEADER = 'x-ventra-support-key';
// Sitios desde los que se puede entrar directo con la sesión de Google ya iniciada
const HANDOFF_ORIGINS = ['https://ventra.store', 'https://www.ventra.store', 'https://ventra-9cba5.web.app', 'https://ventra-9cba5.firebaseapp.com'];

if (!CFG.devTenant && (!CFG.hostSecret || CFG.sessionSecret.length < 32)) {
  console.error('[Host] Faltan CLOUD_HOST_SECRET y/o SESSION_SECRET (32+ caracteres).');
  process.exit(1);
}
const sessionKey = CFG.sessionSecret || crypto.randomBytes(32).toString('hex');
const log = (...a) => console.log(new Date().toISOString(), '[Host]', ...a);

// ── Sesión ─────────────────────────────────────────────
const b64 = (s) => Buffer.from(s).toString('base64url');
function signSession(data) {
  const body = b64(JSON.stringify(data));
  const mac = crypto.createHmac('sha256', sessionKey).update(body).digest('base64url');
  return `${body}.${mac}`;
}
function readSession(req) {
  if (CFG.devTenant) return { uid: CFG.devTenant, email: 'dev@local' };
  const raw = (req.headers.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(COOKIE + '='));
  if (!raw) return null;
  const [body, mac] = raw.slice(COOKIE.length + 1).split('.');
  if (!body || !mac) return null;
  const expected = crypto.createHmac('sha256', sessionKey).update(body).digest('base64url');
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString());
    return s.exp > Date.now() && /^[A-Za-z0-9_-]{6,128}$/.test(s.uid) ? s : null;
  } catch { return null; }
}
function setCookie(res, value, maxAgeSec) {
  res.setHeader('Set-Cookie', `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`);
}

// ── Cajas por comercio ─────────────────────────────────
const tenants = new Map(); // uid -> { proc, port, lastUsed, ready: Promise<number> }
const usedPorts = new Set();
const tenantDir = (uid) => path.join(CFG.dataDir, uid);
const credsFile = (uid) => path.join(tenantDir(uid), 'ventra-subscription.json');
// La caja terminó de bajar los datos del comercio (lo escribe su sincronización)
const isBootstrapped = (uid) => fs.existsSync(path.join(tenantDir(uid), 'ventra-sync.json'));
function tenantStatus(uid) {
  try { return JSON.parse(fs.readFileSync(path.join(tenantDir(uid), 'ventra-sync-status.json'), 'utf8')); } catch { return null; }
}

function freePort() {
  for (let p = CFG.portBase; p < CFG.portBase + 2000; p++) if (!usedPorts.has(p)) { usedPorts.add(p); return p; }
  throw new Error('Sin puertos libres');
}

function waitHttp(port, timeoutMs) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/api/system/info', timeout: 2000 }, (r) => {
        r.resume();
        if (r.statusCode && r.statusCode < 500) return resolve();
        retry();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => (Date.now() - start > timeoutMs ? reject(new Error('La caja no arrancó a tiempo')) : setTimeout(tryOnce, 500));
    tryOnce();
  });
}

/** Devuelve el puerto de la caja del comercio, levantándola si hace falta. */
function ensureTenant(uid) {
  const t = tenants.get(uid);
  if (t) { t.lastUsed = Date.now(); return t.ready; }
  if (!fs.existsSync(credsFile(uid))) return Promise.reject(Object.assign(new Error('Caja sin dar de alta'), { status: 401 }));
  const port = freePort();
  const supportKey = crypto.randomBytes(32).toString('hex');
  const dir = tenantDir(uid);
  const out = fs.openSync(path.join(dir, 'backend.log'), 'a');
  const proc = spawn(process.execPath, ['--max-old-space-size=384', CFG.backendMain], {
    cwd: dir,
    stdio: ['ignore', out, out],
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'production',
      DATABASE_URL: 'file:' + path.join(dir, 'dev.db').split(path.sep).join('/'),
      VENTRA_NODE_KIND: 'cloud',
      VENTRA_FUNCTIONS_URL: CFG.functionsUrl,
      VENTRA_SUPPORT_KEY: supportKey,
      // Secretos del anfitrión: la caja no los necesita
      CLOUD_HOST_SECRET: '', SESSION_SECRET: '',
    },
  });
  const entry = { proc, port, supportKey, lastUsed: Date.now() };
  entry.ready = waitHttp(port, 90000).then(() => { log(`Caja de ${uid} lista en :${port}`); return port; });
  entry.ready.catch((err) => { log(`Caja de ${uid} no arrancó: ${err.message}`); stopTenant(uid); });
  proc.on('exit', (code) => {
    if (tenants.get(uid) === entry) tenants.delete(uid);
    usedPorts.delete(port);
    log(`Caja de ${uid} detenida (código ${code})`);
  });
  tenants.set(uid, entry);
  log(`Levantando la caja de ${uid} en :${port}`);
  return entry.ready;
}

function stopTenant(uid) {
  const t = tenants.get(uid);
  if (!t) return;
  tenants.delete(uid);
  t.proc.kill();
}

// Apaga las cajas sin uso
setInterval(() => {
  for (const [uid, t] of tenants) if (Date.now() - t.lastUsed > CFG.idleMs) { log(`Apagando la caja de ${uid} (sin uso)`); stopTenant(uid); }
}, 60 * 1000).unref();

// ── Entrada con Google ─────────────────────────────────
/**
 * `auth` es { idToken } (el comercio entra con Google) o { supportTicket } (soporte
 * desde ventra.store/admin, pase de un solo uso).
 */
async function createSession(auth) {
  const cloudAccess = (needCredentials) => fetch(`${CFG.functionsUrl}/ventraCloudAccess`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cloud-secret': CFG.hostSecret },
    body: JSON.stringify({ ...auth, needCredentials }),
  });
  const probe = await cloudAccess(false);
  let data = await probe.json().catch(() => ({}));
  if (!probe.ok) throw Object.assign(new Error(data.error || 'No autorizado'), { status: probe.status });
  const uid = data.uid;
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) throw Object.assign(new Error('Cuenta inválida'), { status: 400 });
  if (auth.supportTicket) {
    // Comercio que nunca entró a web.ventra.store: el mismo pase (segundo y último uso)
    // da de alta su caja en la nube, así soporte puede entrar igual
    if (!fs.existsSync(credsFile(uid))) {
      const r = await cloudAccess(true);
      const setup = await r.json().catch(() => ({}));
      if (!r.ok || !setup.deviceId || setup.uid !== uid) {
        log(`Soporte: ${data.supportAdmin} no pudo dar de alta la caja de ${uid}: ${setup.error || r.status}`);
        throw Object.assign(new Error(setup.error || 'No se pudo preparar la caja en la nube de este comercio.'), { status: r.status || 500 });
      }
      fs.mkdirSync(tenantDir(uid), { recursive: true });
      fs.writeFileSync(credsFile(uid), JSON.stringify({ deviceId: setup.deviceId, deviceSecret: setup.deviceSecret }), { mode: 0o600 });
      log(`Soporte: ${data.supportAdmin} dio de alta la caja en la nube de ${uid}`);
    }
    log(`Soporte: ${data.supportAdmin} entró a la caja de ${uid}`);
    return { uid, email: data.email || null, support: data.supportAdmin, exp: Date.now() + SUPPORT_HOURS * 3600e3 };
  }

  // Primera vez: se da de alta la caja en la nube de este comercio
  if (!fs.existsSync(credsFile(uid))) {
    const r = await cloudAccess(true);
    data = await r.json().catch(() => ({}));
    if (!r.ok || !data.deviceId) throw Object.assign(new Error(data.error || 'No se pudo preparar tu caja'), { status: r.status || 500 });
    fs.mkdirSync(tenantDir(uid), { recursive: true });
    fs.writeFileSync(credsFile(uid), JSON.stringify({ deviceId: data.deviceId, deviceSecret: data.deviceSecret }), { mode: 0o600 });
    log(`Caja en la nube dada de alta para ${uid}`);
  }
  return { uid, email: data.email || null, exp: Date.now() + SESSION_DAYS * 864e5 };
}

// ── Proxy ──────────────────────────────────────────────
/** Encabezados hacia la caja: la llave de soporte solo la pone el anfitrión, nunca el navegador. */
function upstreamHeaders(req, port, supportKey) {
  const headers = { ...req.headers, host: `127.0.0.1:${port}` };
  delete headers[SUPPORT_HEADER];
  if (supportKey) headers[SUPPORT_HEADER] = supportKey;
  return headers;
}

function proxyHttp(req, res, port, supportKey) {
  const upstream = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers: upstreamHeaders(req, port, supportKey) }, (up) => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) sendJson(res, 502, { message: 'Tu caja se está reiniciando, probá de nuevo en unos segundos' }); else res.destroy(); });
  req.pipe(upstream);
}

function proxyUpgrade(req, socket, head, port) {
  const up = net.connect(port, '127.0.0.1', () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries(upstreamHeaders(req, port)).map(([k, v]) => `${k}: ${v}`), '', ''];
    up.write(lines.join('\r\n'));
    if (head && head.length) up.write(head);
    up.pipe(socket); socket.pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
}

// ── Archivos de la app web ─────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res, session) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let file = path.normalize(path.join(CFG.frontendDir, urlPath));
  if (!file.startsWith(path.normalize(CFG.frontendDir))) return sendJson(res, 400, { message: 'Ruta inválida' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(CFG.frontendDir, 'index.html');
  const ext = path.extname(file);
  if (session && session.support && ext === '.html') {
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
    return res.end(fs.readFileSync(file, 'utf8').replace('</body>', supportBanner(session) + '</body>'));
  }
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    // Los archivos con hash son inmutables; index.html siempre fresco
    'Cache-Control': /\/assets\//.test(urlPath) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
}

const escHtml = (v) => String(v || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/** Cartel fijo para que quede claro que se está dentro del sistema de un cliente. */
function supportBanner(session) {
  return `<div id="ventra-support-bar" style="position:fixed;left:50%;bottom:calc(env(safe-area-inset-bottom, 0px) + 88px);transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:10px;padding:7px 8px 7px 14px;border-radius:999px;background:#7c2d12;color:#fff;font:600 12px/1.2 system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.25);max-width:calc(100vw - 32px)"><span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Soporte Ventra · sistema de ${escHtml(session.email || session.uid)}</span><a href="/_ventra/support-exit" style="flex:none;padding:5px 10px;border-radius:999px;background:#fff;color:#7c2d12;text-decoration:none">Salir</a></div>`;
}

/** Página simple para los errores de la entrada de soporte (se abre en una pestaña nueva). */
function sendSupportError(res, code, message) {
  res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Soporte Ventra</title></head><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f8fafc;font:15px/1.5 system-ui,sans-serif;color:#0f172a;padding:16px;box-sizing:border-box"><div style="max-width:420px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px"><h1 style="margin:0 0 8px;font-size:18px">No se pudo entrar al sistema</h1><p style="margin:0 0 16px;color:#475569">${escHtml(message)}</p><a href="https://ventra.store/admin" style="display:inline-block;padding:10px 16px;border-radius:10px;background:#0E6E52;color:#fff;text-decoration:none;font-weight:600">Volver al panel</a></div></body></html>`);
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('Demasiado grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

// ── Servidor ───────────────────────────────────────────
const LOGIN_HTML = fs.readFileSync(path.join(__dirname, 'login.html'), 'utf8');
const PREPARING_HTML = fs.readFileSync(path.join(__dirname, 'preparing.html'), 'utf8');

/** Archivo público de la app (JS, CSS, íconos, manifest): se sirve sin sesión. */
function isPublicAsset(url) {
  const p = decodeURIComponent(url.split('?')[0]);
  if (p === '/' || p.endsWith('.html')) return false;
  const file = path.normalize(path.join(CFG.frontendDir, p));
  return file.startsWith(path.normalize(CFG.frontendDir)) && fs.existsSync(file) && fs.statSync(file).isFile();
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  try {
    if (url === '/_ventra/health') return sendJson(res, 200, { ok: true, cajas: tenants.size });
    if (url.startsWith('/_ventra/login')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(LOGIN_HTML); }
    if (url === '/_ventra/session' && req.method === 'POST') {
      const { idToken } = JSON.parse((await readBody(req)) || '{}');
      const session = await createSession({ idToken });
      setCookie(res, signSession(session), SESSION_DAYS * 86400);
      return sendJson(res, 200, { ok: true });
    }
    // Soporte: canjea el pase generado en ventra.store/admin. No se usa Clear-Site-Data:
    // Chrome puede quedarse colgado borrando el service worker y la pestaña no avanza.
    // Cada pestaña nueva de la app ya descarta la sesión anterior al arrancar.
    if (url.startsWith('/_ventra/support?')) {
      const ticket = new URL(url, 'http://x').searchParams.get('t') || '';
      try {
        if (!/^[a-f0-9]{64}$/.test(ticket)) throw Object.assign(new Error('Acceso de soporte inválido.'), { status: 400 });
        const session = await createSession({ supportTicket: ticket });
        setCookie(res, signSession(session), SUPPORT_HOURS * 3600);
        res.writeHead(302, { Location: '/#/login', 'Cache-Control': 'no-store' }); return res.end();
      } catch (err) {
        return sendSupportError(res, err.status || 500, err.message || 'No se pudo entrar al sistema del comercio.');
      }
    }
    // Entrada directa desde ventra.store ("Abrir mi Ventra"): la página, donde el dueño ya
    // entró con Google, manda su token en un formulario (nunca en la URL). Solo se acepta
    // desde ventra.store, así otro sitio no puede meter a alguien en una cuenta ajena.
    if (url === '/_ventra/handoff' && req.method === 'POST') {
      const origin = String(req.headers.origin || '');
      if (!HANDOFF_ORIGINS.includes(origin)) { res.writeHead(302, { Location: '/_ventra/login' }); return res.end(); }
      try {
        const idToken = new URLSearchParams(await readBody(req)).get('idToken') || '';
        const session = await createSession({ idToken });
        setCookie(res, signSession(session), SESSION_DAYS * 86400);
        res.writeHead(303, { Location: '/', 'Cache-Control': 'no-store' }); return res.end();
      } catch (err) {
        log('Entrada desde ventra.store rechazada:', err.message);
        res.writeHead(303, { Location: '/_ventra/login' }); return res.end();
      }
    }
    if (url === '/_ventra/support-exit') {
      setCookie(res, '', 0); res.writeHead(302, { Location: 'https://ventra.store/admin' }); return res.end();
    }
    if (url === '/_ventra/logout') { setCookie(res, '', 0); res.writeHead(302, { Location: '/_ventra/login' }); return res.end(); }

    if (!url.startsWith('/api/') && isPublicAsset(url)) return serveStatic(req, res);

    const session = readSession(req);
    // Renovación automática: una vez por día de uso vuelve a durar 400 días
    if (session && !session.support && !CFG.devTenant && session.exp - Date.now() < SESSION_DAYS * 864e5 - RENEW_AFTER_MS) {
      setCookie(res, signSession({ uid: session.uid, email: session.email, exp: Date.now() + SESSION_DAYS * 864e5 }), SESSION_DAYS * 86400);
    }
    const isApi = url.startsWith('/api/') || url.startsWith('/socket.io/') || url.startsWith('/uploads/');
    if (!session) {
      if (isApi) return sendJson(res, 401, { message: 'Iniciá sesión con Google' });
      res.writeHead(302, { Location: '/_ventra/login' }); return res.end();
    }
    // Estado de la caja mientras se prepara (lo consulta la pantalla "Preparando tu caja")
    // Sesión válida pero la caja no está dada de alta (por ejemplo, se borró): hay que entrar de nuevo
    if (!fs.existsSync(credsFile(session.uid))) {
      if (url === '/_ventra/status') return sendJson(res, 200, { ready: false, needLogin: true });
      if (isApi) return sendJson(res, 401, { message: 'Volvé a entrar con Google' });
      setCookie(res, '', 0); res.writeHead(302, { Location: '/_ventra/login' }); return res.end();
    }
    if (url === '/_ventra/status') {
      ensureTenant(session.uid).catch(() => {});
      const running = tenants.has(session.uid);
      return sendJson(res, 200, { ready: isBootstrapped(session.uid), running, status: tenantStatus(session.uid) });
    }
    if (!isBootstrapped(session.uid)) {
      // Hasta que la caja no tenga los datos del comercio, no se muestra la app
      // (evita, por ejemplo, la pantalla de "crear administrador" de una base vacía)
      ensureTenant(session.uid).catch(() => {});
      if (isApi) return sendJson(res, 503, { message: 'Preparando tu caja en la nube…' });
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      return res.end(PREPARING_HTML);
    }
    // La app pregunta si es una sesión de soporte para entrar sola como administrador
    if (url === '/_ventra/whoami') return sendJson(res, 200, { email: session.email || null, support: session.support || null });
    if (isApi) {
      const port = await ensureTenant(session.uid);
      return proxyHttp(req, res, port, session.support ? tenants.get(session.uid)?.supportKey : undefined);
    }
    return serveStatic(req, res, session);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) log('Error:', err.message);
    if (!res.headersSent) sendJson(res, status, { message: err.message || 'Error' });
  }
});

server.on('upgrade', async (req, socket, head) => {
  try {
    const session = readSession(req);
    if (!session || !req.url.startsWith('/socket.io/') || !isBootstrapped(session.uid)) return socket.destroy();
    proxyUpgrade(req, socket, head, await ensureTenant(session.uid));
  } catch { socket.destroy(); }
});

fs.mkdirSync(CFG.dataDir, { recursive: true });
server.listen(CFG.port, () => log(`Escuchando en :${CFG.port}${CFG.devTenant ? ` (modo prueba, comercio ${CFG.devTenant})` : ''}`));

const shutdown = () => { for (const uid of [...tenants.keys()]) stopTenant(uid); setTimeout(() => process.exit(0), 1500); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
