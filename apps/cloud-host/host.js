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
// El dueño entra una vez con Google en esa computadora; después cada cajero usa su usuario del POS
const SESSION_DAYS = 90;
const COOKIE = 'ventra_web';

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
      // Secretos del anfitrión: la caja no los necesita
      CLOUD_HOST_SECRET: '', SESSION_SECRET: '',
    },
  });
  const entry = { proc, port, lastUsed: Date.now() };
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
async function createSession(idToken) {
  const probe = await fetch(`${CFG.functionsUrl}/ventraCloudAccess`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cloud-secret': CFG.hostSecret },
    body: JSON.stringify({ idToken, needCredentials: false }),
  });
  let data = await probe.json().catch(() => ({}));
  if (!probe.ok) throw Object.assign(new Error(data.error || 'No autorizado'), { status: probe.status });
  const uid = data.uid;
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(uid)) throw Object.assign(new Error('Cuenta inválida'), { status: 400 });

  // Primera vez: se da de alta la caja en la nube de este comercio
  if (!fs.existsSync(credsFile(uid))) {
    const r = await fetch(`${CFG.functionsUrl}/ventraCloudAccess`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cloud-secret': CFG.hostSecret },
      body: JSON.stringify({ idToken, needCredentials: true }),
    });
    data = await r.json().catch(() => ({}));
    if (!r.ok || !data.deviceId) throw Object.assign(new Error(data.error || 'No se pudo preparar tu caja'), { status: r.status || 500 });
    fs.mkdirSync(tenantDir(uid), { recursive: true });
    fs.writeFileSync(credsFile(uid), JSON.stringify({ deviceId: data.deviceId, deviceSecret: data.deviceSecret }), { mode: 0o600 });
    log(`Caja en la nube dada de alta para ${uid}`);
  }
  return { uid, email: data.email || null, exp: Date.now() + SESSION_DAYS * 864e5 };
}

// ── Proxy ──────────────────────────────────────────────
function proxyHttp(req, res, port) {
  const upstream = http.request({ host: '127.0.0.1', port, method: req.method, path: req.url, headers: { ...req.headers, host: `127.0.0.1:${port}` } }, (up) => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) sendJson(res, 502, { message: 'Tu caja se está reiniciando, probá de nuevo en unos segundos' }); else res.destroy(); });
  req.pipe(upstream);
}

function proxyUpgrade(req, socket, head, port) {
  const up = net.connect(port, '127.0.0.1', () => {
    const lines = [`${req.method} ${req.url} HTTP/1.1`, ...Object.entries({ ...req.headers, host: `127.0.0.1:${port}` }).map(([k, v]) => `${k}: ${v}`), '', ''];
    up.write(lines.join('\r\n'));
    if (head && head.length) up.write(head);
    up.pipe(socket); socket.pipe(up);
  });
  up.on('error', () => socket.destroy());
  socket.on('error', () => up.destroy());
}

// ── Archivos de la app web ─────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.json': 'application/json', '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json' };
function serveStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  let file = path.normalize(path.join(CFG.frontendDir, urlPath));
  if (!file.startsWith(path.normalize(CFG.frontendDir))) return sendJson(res, 400, { message: 'Ruta inválida' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(CFG.frontendDir, 'index.html');
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    // Los archivos con hash son inmutables; index.html siempre fresco
    'Cache-Control': /\/assets\//.test(urlPath) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
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

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  try {
    if (url === '/_ventra/health') return sendJson(res, 200, { ok: true, cajas: tenants.size });
    if (url.startsWith('/_ventra/login')) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' }); return res.end(LOGIN_HTML); }
    if (url === '/_ventra/session' && req.method === 'POST') {
      const { idToken } = JSON.parse((await readBody(req)) || '{}');
      const session = await createSession(idToken);
      setCookie(res, signSession(session), SESSION_DAYS * 86400);
      return sendJson(res, 200, { ok: true });
    }
    if (url === '/_ventra/logout') { setCookie(res, '', 0); res.writeHead(302, { Location: '/_ventra/login' }); return res.end(); }

    const session = readSession(req);
    const isApi = url.startsWith('/api/') || url.startsWith('/socket.io/') || url.startsWith('/uploads/');
    if (!session) {
      if (isApi) return sendJson(res, 401, { message: 'Iniciá sesión con Google' });
      res.writeHead(302, { Location: '/_ventra/login' }); return res.end();
    }
    if (isApi) {
      const port = await ensureTenant(session.uid);
      return proxyHttp(req, res, port);
    }
    return serveStatic(req, res);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) log('Error:', err.message);
    if (!res.headersSent) sendJson(res, status, { message: err.message || 'Error' });
  }
});

server.on('upgrade', async (req, socket, head) => {
  try {
    const session = readSession(req);
    if (!session || !req.url.startsWith('/socket.io/')) return socket.destroy();
    proxyUpgrade(req, socket, head, await ensureTenant(session.uid));
  } catch { socket.destroy(); }
});

fs.mkdirSync(CFG.dataDir, { recursive: true });
server.listen(CFG.port, () => log(`Escuchando en :${CFG.port}${CFG.devTenant ? ` (modo prueba, comercio ${CFG.devTenant})` : ''}`));

const shutdown = () => { for (const uid of [...tenants.keys()]) stopTenant(uid); setTimeout(() => process.exit(0), 1500); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
