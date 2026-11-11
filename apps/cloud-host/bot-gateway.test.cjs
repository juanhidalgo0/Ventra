// Entrada del bot a la caja en la nube (bot-gateway.js), con una caja falsa. Sin red.
//   node apps/cloud-host/bot-gateway.test.cjs
const assert = require('assert');
const { createBotGateway, allowedPath } = require('./bot-gateway');

const SECRET = 's'.repeat(40);
const UID = 'tenant123';
let ok = 0, bad = 0;
const t = async (name, fn) => { try { await fn(); ok++; console.log(`ok    ${name}`); } catch (e) { bad++; console.log(`FALLA ${name}\n      ${e.stack || e.message}`); } };

function setup({ creds = true, booted = true } = {}) {
  const seen = [];
  const state = { creds, booted, provisioned: 0, started: 0, logins: 0, expireNext: false };
  const request = async (port, req) => {
    seen.push({ port, ...req });
    if (req.path === '/api/auth/support-login') {
      assert.strictEqual(req.headers['x-ventra-support-key'], 'clave-de-la-caja');
      state.logins++;
      return { status: 201, body: { accessToken: `tok${state.logins}` } };
    }
    if (state.expireNext) { state.expireNext = false; return { status: 401, body: { message: 'Unauthorized' } }; }
    if (req.path.startsWith('/api/clients') && req.method === 'POST') return { status: 201, body: { id: 'm1', ok: true, got: req.body } };
    return { status: 200, body: { path: req.path, auth: req.headers.Authorization } };
  };
  const gw = createBotGateway({
    hostSecret: SECRET, request,
    ensureTenant: async () => { state.started++; return 4100; },
    supportKey: () => 'clave-de-la-caja',
    hasCreds: () => state.creds,
    isBootstrapped: () => state.booted,
    provision: async () => { state.provisioned++; state.creds = true; },
  });
  const call = (body, secret = SECRET) => gw.handle({ 'x-cloud-secret': secret }, JSON.stringify(body));
  return { gw, call, seen, state };
}

(async () => {
  await t('sin el secreto, o con otro, no entra', async () => {
    const { call } = setup();
    assert.strictEqual((await call({ uid: UID, calls: [{ method: 'GET', path: '/api/clients' }] }, 'otro')).status, 401);
    assert.strictEqual((await call({ uid: UID, calls: [{ method: 'GET', path: '/api/clients' }] }, '')).status, 401);
  });
  await t('rutas: solo /api/, sin lo protegido ni trucos', async () => {
    for (const p of ['/api/clients', '/api/clients/abc/movement', '/api/products/7790895000997']) assert.ok(allowedPath(p), p);
    for (const p of ['/api/auth/login', '/api/auth/support-login', '/api/sync/push', '/api/system/backup/restore', '/api/subscription', '/api/users/u1/password', '/api/ai/ask', '/_ventra/health', '/api/../auth/login', '/api//auth', 'http://x/api/clients', '/api/clients?x=<script>'])
      assert.ok(!allowedPath(p), p);
    const { call } = setup();
    const r = await call({ uid: UID, calls: [{ method: 'POST', path: '/api/auth/register-first-admin', body: {} }] });
    assert.strictEqual(r.status, 403);
    assert.strictEqual((await call({ uid: UID, calls: [{ method: 'TRACE', path: '/api/clients' }] })).status, 403);
  });
  await t('entra como administrador con la llave de la caja y ejecuta (con filtros y cuerpo)', async () => {
    const { call, seen } = setup();
    const r = await call({ uid: UID, calls: [{ method: 'GET', path: '/api/clients', query: { search: 'Don Tito', vacio: '' } }, { method: 'POST', path: '/api/clients/c1/movement', body: { type: 'DEBT', amount: 3000 } }] });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.json.results[0].body.path, '/api/clients?search=Don%20Tito');
    assert.strictEqual(r.json.results[0].body.auth, 'Bearer tok1');
    assert.deepStrictEqual(r.json.results[1].body.got, { type: 'DEBT', amount: 3000 });
    assert.strictEqual(seen.filter((s) => s.path === '/api/auth/support-login').length, 1, 'una sola entrada');
    assert.strictEqual(seen.at(-1).headers['x-ventra-via'], 'whatsapp-bot');
  });
  await t('el token se reusa; si la caja se reinició (401), entra de nuevo una vez', async () => {
    const { call, state } = setup();
    await call({ uid: UID, calls: [{ method: 'GET', path: '/api/clients' }] });
    await call({ uid: UID, calls: [{ method: 'GET', path: '/api/clients' }] });
    assert.strictEqual(state.logins, 1);
    state.expireNext = true;
    const r = await call({ uid: UID, calls: [{ method: 'GET', path: '/api/clients' }] });
    assert.strictEqual(r.json.results[0].body.auth, 'Bearer tok2');
  });
  await t('comercio sin caja en la nube: sin provision avisa; con provision la da de alta y queda preparándose', async () => {
    const { call, state } = setup({ creds: false, booted: false });
    const no = await call({ uid: UID, calls: [{ method: 'GET', path: '/api/clients' }] });
    assert.deepStrictEqual([no.status, no.json.noCloud], [409, true]);
    const yes = await call({ uid: UID, calls: [{ method: 'GET', path: '/api/clients' }], provision: true });
    assert.deepStrictEqual([yes.status, yes.json.preparing], [503, true]);
    assert.strictEqual(state.provisioned, 1);
    const still = await call({ uid: UID, calls: [{ method: 'GET', path: '/api/clients' }] });
    assert.strictEqual(still.status, 503, 'mientras baja los datos');
  });
  await t('pedidos mal armados', async () => {
    const { gw, call } = setup();
    assert.strictEqual((await gw.handle({ 'x-cloud-secret': SECRET }, '{no es json')).status, 400);
    assert.strictEqual((await call({ uid: '../x', calls: [{ method: 'GET', path: '/api/clients' }] })).status, 400);
    assert.strictEqual((await call({ uid: UID, calls: [] })).status, 400);
    assert.strictEqual((await call({ uid: UID, calls: Array(6).fill({ method: 'GET', path: '/api/clients' }) })).status, 400);
  });
  console.log(`\n${ok} bien, ${bad} mal`);
  process.exit(bad ? 1 : 0);
})();
