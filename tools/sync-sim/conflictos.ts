// Dos cajas que se pisan (auditoría nov-2026): CE-1 y CE-2. Nube falsa (PGlite + sync.js real) y dos
// cajas con el SyncService real sobre bases SQLite armadas de cero con el esquema de Prisma.
// Todo local: nada toca la nube real.  Correr:  npm run conflictos  (desde tools/sync-sim)
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { execSync } from 'child_process';

const ROOT = path.resolve(__dirname, '../..');
const BACK = path.join(ROOT, 'apps/backend');
const { PrismaClient } = require(path.join(BACK, 'node_modules/@prisma/client'));
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const cs = require(`${ROOT}/firebase/functions/sync`);
const { SyncService } = require(`${BACK}/src/modules/sync/sync.service`);

const DIR = path.join(__dirname, 'tmp', 'conflictos');
const T = 'tenant-conflictos';
let fallas = 0;
const ok = (cond: boolean, msg: string) => { console.log(`${cond ? 'ok   ' : 'FALLA'} ${msg}`); if (!cond) fallas++; };

async function main() {
  fs.rmSync(DIR, { recursive: true, force: true });
  fs.mkdirSync(DIR, { recursive: true });
  // Base con el esquema de hoy y datos mínimos: un usuario, una caja y dos productos
  execSync('npx prisma db push --skip-generate', { cwd: BACK, env: { ...process.env, DATABASE_URL: `file:${DIR}/base.db` }, stdio: 'ignore' });
  {
    const db = new DatabaseSync(path.join(DIR, 'base.db'));
    const now = Date.now();
    db.prepare(`INSERT INTO users (id, username, password_hash, full_name, role, created_at, updated_at) VALUES ('u1','ADMIN','x','Dueño','ADMIN',?,?)`).run(now, now);
    db.prepare(`INSERT INTO products (id, name, barcode, sale_price, cost_price, stock, created_at, updated_at) VALUES ('p1','COCA 2L','7790000000011',101,50,50,?,?)`).run(now, now);
    db.prepare(`INSERT INTO products (id, name, barcode, sale_price, cost_price, stock, created_at, updated_at) VALUES ('p2','AGUA 2L','7790000000028',101,50,50,?,?)`).run(now, now);
    db.close();
  }
  fs.copyFileSync(path.join(DIR, 'base.db'), path.join(DIR, 'a.db'));
  // B: mismo esquema, sin datos (una caja nueva que baja todo de la nube)
  {
    fs.copyFileSync(path.join(DIR, 'base.db'), path.join(DIR, 'b.db'));
    const db = new DatabaseSync(path.join(DIR, 'b.db'));
    db.exec('PRAGMA foreign_keys = OFF');
    for (const r of db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'`).all()) db.exec(`DELETE FROM "${r.name}"`);
    db.close();
  }

  // ── Nube falsa ─────────────────────────────────────
  const pg = new PGlite();
  const sql = { query: async (t: string, p: any[]) => (await pg.query(t, p)).rows };
  await cs.ensureSchema(sql);
  const fail = (status: number, error: string) => Object.assign(new Error(error), { response: { status, data: { error } } });
  const cloudCall = (deviceId: string) => async (action: string, body: any = {}) => {
    let r: any;
    if (action === 'register') r = await cs.register(sql, T, deviceId, body.kind || 'pc', body.v);
    else if (action === 'report') r = await cs.report(sql, T, deviceId, body.status);
    else if (action === 'claimLedger') r = await cs.claimLedger(sql, T);
    else if (action === 'push') { if (!cs.validRows(body.rows)) throw fail(400, 'Filas inválidas'); r = await cs.push(sql, T, deviceId, body.rows, body.gen); }
    else if (action === 'pull') r = await cs.pull(sql, T, deviceId, body.after, !!body.all, !!body.fresh, body.limit, body.part, body.cut, body.until);
    else if (action === 'fullStart') r = await cs.fullStart(sql, T);
    else if (action === 'pullTable') r = await cs.pullTable(sql, T, body);
    else if (action === 'archives') r = [];
    else if (action === 'archiveDeletes') r = { deletes: [] };
    else throw fail(400, 'Acción desconocida');
    return JSON.parse(JSON.stringify(r));
  };
  const mkCaja = (name: string) => {
    const dir = path.join(DIR, name); fs.mkdirSync(dir, { recursive: true });
    const prisma = new PrismaClient({ datasourceUrl: `file:${DIR}/${name}.db` });
    const cwd = process.cwd(); process.chdir(dir);
    const svc: any = new SyncService(prisma, { getDeviceCredentials: () => ({ deviceId: name, deviceSecret: 'x' }) });
    process.chdir(cwd);
    svc.call = cloudCall(name);
    // Un ciclo de sincronización (sube y baja). El error queda en svc.lastError: no se tira acá
    const cycle = async () => { svc.nextPullAt = 0; svc.retryAt = 0; svc.historyRetryAt = 0; await svc.cycle(); return svc.lastError as string | null; };
    return { svc, prisma, cycle, name };
  };
  const q = async (c: any, s: string, ...p: any[]) => (await c.prisma.$queryRawUnsafe(s, ...p)) as any[];
  const x = async (c: any, s: string, ...p: any[]) => c.prisma.$executeRawUnsafe(s, ...p);
  const price = async (c: any, id: string) => Number((await q(c, `SELECT sale_price AS v FROM products WHERE id = ?`, id))[0]?.v);
  const cloudPrice = async (id: string) => Number((await pg.query(`SELECT data->>'sale_price' v FROM sync_rows WHERE tbl = 'products' AND id = $1`, [id])).rows[0]?.v);
  const settle = async () => { for (let i = 0; i < 3; i++) { await A.cycle(); await B.cycle(); } };
  const tick = () => new Promise((r) => setTimeout(r, 15));

  const A = mkCaja('a');
  const B = mkCaja('b');
  for (let i = 0; i < 3; i++) await A.cycle();
  // PC que viene de una versión vieja: tenía el trigger que subía la fila entera con cualquier cambio
  {
    await x(A, `DROP TRIGGER IF EXISTS "ventra_sync2_updc_products_x"`);
    const now = await q(A, `SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'ventra_sync2_upd%products%'`);
    for (const r of now) await x(A, `DROP TRIGGER IF EXISTS "${r.name}"`);
    await x(A, `CREATE TRIGGER "ventra_sync2_upd_products" AFTER UPDATE ON "products" BEGIN SELECT 1; END`);
    const before = Number((await pg.query(`SELECT count(*)::int n FROM sync_rows`)).rows[0].n);
    await A.svc.ensureTriggers?.call?.(A.svc, ['products', 'clients', 'promotions']);
    const after = await q(A, `SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'ventra_sync2_upd%products%'`);
    const pend = Number((await q(A, `SELECT count(*) AS n FROM sync_outbox`))[0].n);
    ok(after.length === 1 && String(after[0].name).startsWith('ventra_sync2_updc_products_') && pend === 0,
      `una PC que se actualiza cambia el trigger viejo por el nuevo sin volver a subir los productos (${after.map((r) => r.name).join(', ')}, pendientes ${pend}, filas nube ${before})`);
  }
  for (let i = 0; i < 30; i++) {
    await B.cycle();
    const left = await q(B, `SELECT count(*) AS n FROM sync_state WHERE key LIKE 'history%' OR key LIKE 'archive%' OR key LIKE 'bootstrap%'`);
    if (!Number(left[0].n) && Number((await q(B, `SELECT count(*) AS n FROM products`))[0].n) === 2) break;
  }
  ok(Number((await q(B, `SELECT count(*) AS n FROM products`))[0].n) === 2, 'la caja B bajó los 2 productos de A');

  // ── CE-1: A sube el precio; B, sin haber bajado el aumento, vende ese producto ──
  await x(A, `UPDATE products SET sale_price = 999, updated_at = ? WHERE id = 'p1'`, Date.now());
  await tick();
  // La venta en B: Prisma baja el stock y renueva updated_at (lo mismo que hace sales.service)
  await x(B, `UPDATE products SET stock = stock - 1, updated_at = ? WHERE id = 'p1'`, Date.now());
  await A.cycle();   // A sube el aumento
  await B.cycle();   // B sube su venta (y baja lo de A)
  await settle();
  ok(await price(A, 'p1') === 999 && await price(B, 'p1') === 999 && await cloudPrice('p1') === 999,
    `CE-1 (A sube primero): el aumento queda en A, B y la nube (A=${await price(A, 'p1')} B=${await price(B, 'p1')} nube=${await cloudPrice('p1')})`);
  const stockA = Number((await q(A, `SELECT stock AS v FROM products WHERE id = 'p1'`))[0].v);
  const stockB = Number((await q(B, `SELECT stock AS v FROM products WHERE id = 'p1'`))[0].v);
  ok(stockA === 49 && stockB === 49, `CE-1: el stock de la venta llega a las dos cajas (A=${stockA} B=${stockB})`);

  // Al revés: B vende y sube primero; después sube el aumento de A
  await x(A, `UPDATE products SET sale_price = 1500, updated_at = ? WHERE id = 'p2'`, Date.now());
  await tick();
  await x(B, `UPDATE products SET stock = stock - 2, updated_at = ? WHERE id = 'p2'`, Date.now());
  await B.cycle();
  await A.cycle();
  await settle();
  ok(await price(A, 'p2') === 1500 && await price(B, 'p2') === 1500 && await cloudPrice('p2') === 1500,
    `CE-1 (B sube primero): el aumento queda en A, B y la nube (A=${await price(A, 'p2')} B=${await price(B, 'p2')} nube=${await cloudPrice('p2')})`);

  // Un cambio de verdad en B (nombre) sigue viajando
  await x(B, `UPDATE products SET name = 'AGUA 2L SIN GAS', updated_at = ? WHERE id = 'p2'`, Date.now());
  await settle();
  ok((await q(A, `SELECT name FROM products WHERE id = 'p2'`))[0].name === 'AGUA 2L SIN GAS', 'un cambio de nombre en B llega a A');

  // ── CE-2: las dos cajas dan de alta el mismo código de barras, cada una con su id ──
  const now = Date.now();
  await x(A, `INSERT INTO products (id, name, barcode, sale_price, cost_price, stock, created_at, updated_at) VALUES ('pa','FERNET 750','7791111111111',5000,3000,10,?,?)`, now, now);
  await x(B, `INSERT INTO products (id, name, barcode, sale_price, cost_price, stock, created_at, updated_at) VALUES ('pb','FERNET 750ML','7791111111111',5200,3000,6,?,?)`, now + 5, now + 5);
  await A.cycle();
  await B.cycle();
  await A.cycle();
  await x(A, `UPDATE products SET sale_price = 777, updated_at = ? WHERE id = 'p1'`, Date.now());
  const errs: string[] = [];
  for (let i = 0; i < 4; i++) { const ea = await A.cycle(); const eb = await B.cycle(); if (ea) errs.push(`A: ${ea}`); if (eb) errs.push(`B: ${eb}`); }
  ok(!errs.some((e) => /UNIQUE/i.test(e)), `CE-2: ninguna caja se traba con el código repetido${errs.length ? ` (${errs[0]})` : ''}`);
  ok(await price(B, 'p1') === 777, `CE-2: B sigue recibiendo novedades de A (precio ${await price(B, 'p1')})`);
  const fa = await q(A, `SELECT id, barcode FROM products WHERE barcode = '7791111111111' OR id IN ('pa','pb')`);
  const fb = await q(B, `SELECT id, barcode FROM products WHERE barcode = '7791111111111' OR id IN ('pa','pb')`);
  ok(fa.length === 2 && fb.length === 2, `CE-2: las dos cajas tienen los dos productos, ninguno se pierde (A=${fa.length} B=${fb.length})`);
  ok(fa.filter((r) => r.barcode === '7791111111111').length === 1 && fb.filter((r) => r.barcode === '7791111111111').length === 1, 'CE-2: en cada caja el código queda en uno solo');

  // Lo mismo con una categoría del mismo nombre (no puede quedar vacía: la otra queda marcada)
  await x(A, `INSERT INTO categories (id, name) VALUES ('ca','BEBIDAS')`);
  await x(B, `INSERT INTO categories (id, name) VALUES ('cb','BEBIDAS')`);
  const errs2: string[] = [];
  for (let i = 0; i < 4; i++) { const ea = await A.cycle(); const eb = await B.cycle(); if (ea) errs2.push(ea); if (eb) errs2.push(eb); }
  const ka = await q(A, `SELECT id, name FROM categories ORDER BY id`);
  const kb = await q(B, `SELECT id, name FROM categories ORDER BY id`);
  ok(!errs2.length && ka.length === 2 && kb.length === 2 && ka[0].name === 'BEBIDAS' && kb[0].name === 'BEBIDAS',
    `CE-2: dos categorías "BEBIDAS" no traban y quedan las dos (A: ${ka.map((r) => r.name).join(' / ')} · B: ${kb.map((r) => r.name).join(' / ')})`);

  // Una caja nueva (C) termina de bajar todo aunque haya filas repetidas en la nube
  {
    fs.copyFileSync(path.join(DIR, 'base.db'), path.join(DIR, 'c.db'));
    const db = new DatabaseSync(path.join(DIR, 'c.db'));
    db.exec('PRAGMA foreign_keys = OFF');
    for (const r of db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'`).all()) db.exec(`DELETE FROM "${r.name}"`);
    db.close();
  }
  const C = mkCaja('c');
  let errC: string | null = null;
  for (let i = 0; i < 30; i++) { errC = await C.cycle(); }
  ok(!errC && Number((await q(C, `SELECT count(*) AS n FROM products`))[0].n) === 4, `CE-2: una caja nueva baja todo (${Number((await q(C, `SELECT count(*) AS n FROM products`))[0].n)} productos${errC ? `, error: ${errC}` : ''})`);

  for (const c of [A, B, C]) await c.prisma.$disconnect();
  console.log(`\n${fallas ? `${fallas} con falla` : 'todo bien'}`);
  process.exit(fallas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
