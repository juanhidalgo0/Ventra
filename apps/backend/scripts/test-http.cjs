// Prueba de humo por HTTP: arranca el backend compilado (dist/main.js) con una base de prueba y
// hace pedidos de verdad. Las demás pruebas llaman a los servicios directo y no pasan por Express:
// así se escapó (2026-11-11) que un lector JSON de una sola ruta dejaba a TODOS los demás pedidos sin
// cuerpo y el login decía "username should not be empty". Correr ANTES de publicar:
//   npm run build && npm run test:http
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const main = path.join(root, 'dist', 'main.js');
if (!fs.existsSync(main)) { console.error('Falta dist/main.js: corré npm run build'); process.exit(1); }
const src = path.join(root, 'prisma', 'dev.db');
if (!fs.existsSync(src)) { console.error('Falta prisma/dev.db (base con el esquema) para copiar'); process.exit(1); }

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ventra-http-'));
fs.copyFileSync(src, path.join(dir, 'test.db'));
const PORT = String(3900 + Math.floor(Math.random() * 90));
const base = `http://127.0.0.1:${PORT}/api`;
const child = spawn(process.execPath, [main], {
  cwd: dir,
  env: {
    ...process.env, PORT, DATABASE_URL: `file:${path.join(dir, 'test.db').replace(/\\/g, '/')}`,
    VENTRA_SUBSCRIPTION_EXEMPT: 'true', VENTRA_FUNCTIONS_URL: 'http://127.0.0.1:9', FIREBASE_CREDENTIALS_JSON: 'x',
    FIREBASE_SERVICE_ACCOUNT_PATH: path.join(dir, 'no-existe.json'), DISABLE_TUNNEL: 'true', DEMO_MODE: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
child.stdout.on('data', (d) => { log += d; });
child.stderr.on('data', (d) => { log += d; });

const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  .then(async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) }));
const msg = (r) => [].concat(r.body.message || '').join(' ');

let ok = 0, bad = 0;
const check = (name, cond, extra = '') => { if (cond) { ok++; console.log(`ok    ${name}`); } else { bad++; console.log(`FALLA ${name} ${extra}`); } };

(async () => {
  let up = false;
  for (let i = 0; i < 90 && !up; i++) {
    up = await fetch(`${base}/sync-progress`).then((r) => r.ok).catch(() => false);
    if (!up) await new Promise((r) => setTimeout(r, 1000));
  }
  if (!up) { console.error('El backend no arrancó:\n' + log.slice(-3000)); child.kill(); process.exit(1); }

  const login = await post('/auth/login', { username: 'NO.EXISTE', password: 'clave-equivocada' });
  check('el login recibe usuario y contraseña (no "should not be empty")', !/should not be empty|must be a string/.test(msg(login)), JSON.stringify(login));
  check('usuario inexistente: 401', login.status === 401, `status ${login.status}`);

  const empty = await post('/auth/login', {});
  check('login vacío: 400 con el aviso de validación', empty.status === 400 && /should not be empty/.test(msg(empty)), JSON.stringify(empty));

  const extra = await post('/auth/login', { username: 'A', password: 'B', campoQueNoExiste: 1 });
  check('campos de más se rechazan (whitelist)', extra.status === 400, JSON.stringify(extra));

  // La ruta de boletas acepta cuerpos grandes (sin sesión da 401, pero NO 413)
  const big = await post('/purchases/scan-invoice-json', { images: [{ data: 'A'.repeat(3 * 1024 * 1024) }] });
  check('boleta grande por JSON: no la corta el tamaño (401 sin sesión)', big.status === 401, `status ${big.status}`);

  // "Revisar en la PC" (bot de WhatsApp): manda lo leído de una boleta larga, también grande
  const bigPrev = await post('/purchases/pending-from-preview', { preview: { items: [{ name: 'A'.repeat(600 * 1024) }] }, via: 'WhatsApp' });
  check('boleta para revisar en la PC: no la corta el tamaño (401 sin sesión)', bigPrev.status === 401, `status ${bigPrev.status}`);

  // Las demás rutas siguen con el tope normal
  const bigElse = await post('/auth/login', { username: 'A'.repeat(200 * 1024), password: 'x' });
  check('otras rutas mantienen el tope de tamaño (413)', bigElse.status === 413, `status ${bigElse.status}`);

  child.kill();
  console.log(`\n${ok} bien, ${bad} mal`);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* Windows puede tener la base abierta un momento */ }
  process.exit(bad ? 1 : 0);
})().catch((err) => { console.error(err); child.kill(); process.exit(1); });
