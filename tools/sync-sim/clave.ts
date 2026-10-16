// Clave del administrador entre cajas (incidente Paulos 2026-10-16: la clave volvía a "1234").
// Nube falsa (PGlite + sync.js real) y dos cajas (SyncService real sobre copias SQLite). Nada toca la nube real.
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(__dirname, '../..');
const { PrismaClient } = require(path.join(ROOT, 'apps/backend/node_modules/@prisma/client'));
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const cs = require(`${ROOT}/firebase/functions/sync`);
const { SyncService } = require(`${ROOT}/apps/backend/src/modules/sync/sync.service`);

const DIR = path.join(__dirname, 'tmp', 'clave');
fs.mkdirSync(DIR, { recursive: true });
const T = 'tenant1';
let fails = 0;
const check = (ok: boolean, msg: string) => { console.log(ok ? '  ✓' : '  ✗', msg); if (!ok) fails++; };

async function main() {
  const src = new DatabaseSync(`${ROOT}/apps/backend/prisma/dev.db`, { readOnly: true });
  for (const n of ['a.db', 'b.db']) {
    try { fs.unlinkSync(path.join(DIR, n)); } catch {}
    src.exec(`VACUUM INTO '${DIR}/${n}'`);
    const db = new DatabaseSync(path.join(DIR, n));
    for (const r of db.prepare(`SELECT name, type FROM sqlite_master WHERE name LIKE 'ventra_sync%' OR (type='table' AND name LIKE 'sync_%')`).all())
      db.exec(`DROP ${r.type === 'trigger' ? 'TRIGGER' : 'TABLE'} IF EXISTS "${r.name}"`);
    // Lo que hace PrismaService al arrancar la versión nueva
    const cols = db.prepare(`PRAGMA table_info(users)`).all().map((c: any) => c.name);
    if (!cols.includes('password_changed_at')) db.exec(`ALTER TABLE users ADD COLUMN password_changed_at DATETIME DEFAULT NULL`);
    db.close();
  }
  src.close();

  const pg = new PGlite();
  const sql = { query: async (t: string, p: any[]) => (await pg.query(t, p)).rows };
  await cs.ensureSchema(sql);
  let cloudDown = false;
  const cloudCall = (deviceId: string) => async (action: string, body: any = {}) => {
    if (cloudDown) throw Object.assign(new Error('offline'), { code: 'ECONNREFUSED' });
    let r: any;
    if (action === 'register') r = await cs.register(sql, T, deviceId, body.kind || 'pc', body.v);
    else if (action === 'report') r = await cs.report(sql, T, deviceId, body.status);
    else if (action === 'claimLedger') r = await cs.claimLedger(sql, T);
    else if (action === 'push') r = await cs.push(sql, T, deviceId, body.rows, body.gen);
    else if (action === 'pull') r = await cs.pull(sql, T, deviceId, body.after, !!body.all, !!body.fresh, body.limit, body.part, body.cut, body.until);
    else if (action === 'fullStart') r = await cs.fullStart(sql, T);
    else if (action === 'pullTable') r = await cs.pullTable(sql, T, body);
    else if (action === 'archives') r = [];
    else if (action === 'archiveDeletes') r = { rows: [] };
    else r = { ok: true };
    return JSON.parse(JSON.stringify(r));
  };
  const mkCaja = (name: string) => {
    const dir = path.join(DIR, name); fs.mkdirSync(dir, { recursive: true });
    for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
    const prisma = new PrismaClient({ datasourceUrl: `file:${DIR}/${name}.db` });
    const cwd = process.cwd(); process.chdir(dir);
    const svc: any = new SyncService(prisma, { getDeviceCredentials: () => ({ deviceId: name, deviceSecret: 'x' }) });
    process.chdir(cwd);
    svc.call = cloudCall(name);
    const cycle = async (n = 1) => {
      for (let i = 0; i < n; i++) {
        svc.nextPullAt = 0; svc.retryAt = 0; svc.historyRetryAt = 0;
        await svc.cycle();
        if (svc.lastError && !cloudDown) throw new Error(`${name}: ${svc.lastError}`);
      }
    };
    return { svc, prisma, cycle };
  };
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const A = mkCaja('a');
  await A.cycle(3);
  const B = mkCaja('b');
  await B.cycle(4);
  const admin = ((await A.prisma.$queryRawUnsafe(`SELECT id FROM users WHERE role = 'ADMIN' LIMIT 1`)) as any[])[0].id;
  const hashOf = async (c: any) => ((await c.prisma.$queryRawUnsafe(`SELECT password_hash h, full_name f FROM users WHERE id = ?`, admin)) as any[])[0];
  const cloudHash = async () => (await pg.query(`SELECT data->>'password_hash' h, data->>'full_name' f, device_id FROM sync_rows WHERE tbl = 'users' AND id = $1`, [admin])).rows[0];
  const setPassword = (c: any, h: string) => c.prisma.$executeRawUnsafe(`UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?`, h, Date.now(), admin);
  const login = (c: any) => c.prisma.$executeRawUnsafe(`UPDATE users SET last_login = ?, updated_at = ? WHERE id = ?`, Date.now(), Date.now(), admin);
  const outboxUsers = async (c: any) => Number(((await c.prisma.$queryRawUnsafe(`SELECT count(*) n FROM sync_outbox WHERE tbl = 'users'`)) as any[])[0].n);
  await setPassword(A, 'clave-1234'); await A.cycle(2); await B.cycle(2);
  check((await hashOf(B)).h === 'clave-1234', 'arranque: las dos cajas con la misma clave');

  console.log('1) Caja B atrasada: el dueño cambia la clave en A, en B entran con la vieja');
  await setPassword(A, 'clave-nueva-1');
  await wait(5);
  await login(B);
  check(await outboxUsers(B) === 0, 'entrar no anota la fila del usuario para subir');
  await A.cycle(2); await B.cycle(2); await A.cycle(2);
  check((await hashOf(A)).h === 'clave-nueva-1', 'A conserva la clave nueva');
  check((await hashOf(B)).h === 'clave-nueva-1', 'B recibe la clave nueva');

  console.log('2) B atrasada edita al usuario (otro dato) después del cambio de clave en A');
  await setPassword(A, 'clave-nueva-2');
  await A.cycle(2);
  await wait(5);
  await B.prisma.$executeRawUnsafe(`UPDATE users SET full_name = 'DUEÑO' WHERE id = ?`, admin);
  // B sube sin haber bajado antes el cambio de A (su versión de la fila tiene la clave vieja)
  const pulledBefore = B.svc.pullChanges.bind(B.svc);
  B.svc.pullChanges = async () => 0;
  await B.cycle(1);
  B.svc.pullChanges = pulledBefore;
  const c2 = await cloudHash();
  check(c2.h === 'clave-nueva-2' && c2.f === 'DUEÑO', `la nube combina: clave de A + nombre de B (caja ${c2.device_id})`);
  await B.cycle(2); await A.cycle(2);
  check((await hashOf(B)).h === 'clave-nueva-2' && (await hashOf(B)).f === 'DUEÑO', 'B queda con la clave nueva y su cambio de nombre');
  check((await hashOf(A)).h === 'clave-nueva-2' && (await hashOf(A)).f === 'DUEÑO', 'A queda con la clave nueva y el nombre de B');

  console.log('3) A cambia la clave sin internet; B edita al usuario después y sube primero');
  cloudDown = true;
  await setPassword(A, 'clave-nueva-3');
  await A.cycle(1);
  cloudDown = false;
  await wait(5);
  await B.prisma.$executeRawUnsafe(`UPDATE users SET full_name = 'DUEÑO 2' WHERE id = ?`, admin);
  await B.cycle(2);
  await A.cycle(3); await B.cycle(2); await A.cycle(1);
  check((await cloudHash()).h === 'clave-nueva-3', 'la nube termina con la clave de A');
  check((await hashOf(A)).h === 'clave-nueva-3' && (await hashOf(A)).f === 'DUEÑO 2', 'A: clave suya, nombre de B');
  check((await hashOf(B)).h === 'clave-nueva-3' && (await hashOf(B)).f === 'DUEÑO 2', 'B: clave de A, nombre suyo');

  await A.prisma.$disconnect(); await B.prisma.$disconnect();
  console.log(fails ? `FALLARON ${fails}` : 'TODO BIEN');
  if (fails) process.exitCode = 1;
}
main().catch((e) => { console.error('ERROR', e); process.exit(1); });
