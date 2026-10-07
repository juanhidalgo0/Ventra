// Simulación de punta a punta: nube falsa (PGlite + sync.js/archive.js reales) y dos cajas
// (SyncService real sobre copias SQLite). Todo local, nada toca la nube real.
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as crypto from 'crypto';

const ROOT = path.resolve(__dirname, '../..');
const { PrismaClient } = require(path.join(ROOT, 'apps/backend/node_modules/@prisma/client'));
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const cs = require(`${ROOT}/firebase/functions/sync`);
const ar = require(`${ROOT}/firebase/functions/archive`);
const { SyncService } = require(`${ROOT}/apps/backend/src/modules/sync/sync.service`);

const DIR = path.join(__dirname, 'tmp');
fs.mkdirSync(DIR, { recursive: true });
const T = 'tenant1';
const now = Date.now();
const D = 86400000;
const log = (...a: any[]) => console.log('»', ...a);

async function main() {
  // ── Bases de las cajas ─────────────────────────────
  const src = new DatabaseSync(`${ROOT}/apps/backend/prisma/dev.db`, { readOnly: true });
  for (const n of ['a.db', 'b.db']) { try { fs.unlinkSync(path.join(DIR, n)); } catch {} }
  src.exec(`VACUUM INTO '${DIR}/a.db'`);
  src.exec(`VACUUM INTO '${DIR}/b.db'`);
  src.close();
  const tables: string[] = [];
  for (const n of ['a.db', 'b.db']) {
    const db = new DatabaseSync(path.join(DIR, n));
    for (const r of db.prepare(`SELECT name, type FROM sqlite_master WHERE name LIKE 'ventra_sync%' OR (type='table' AND name LIKE 'sync_%')`).all())
      db.exec(`DROP ${r.type === 'trigger' ? 'TRIGGER' : r.type === 'index' ? 'INDEX' : 'TABLE'} IF EXISTS "${r.name}"`);
    if (!tables.length) for (const r of db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%' AND name NOT IN ('app_licenses','image_suggestions')`).all()) tables.push(r.name);
    if (n === 'a.db') {
      // Historia: 400 ventas de hace 200 días (2 renglones, 1 pago, 2 movimientos), 1 de acopio vieja, 60 de hace 10 días
      const user = db.prepare(`SELECT id FROM users LIMIT 1`).get().id;
      const sess = db.prepare(`SELECT id FROM cash_register_sessions LIMIT 1`).get().id;
      const prods = db.prepare(`SELECT id, name FROM products LIMIT 50`).all();
      let num = (db.prepare(`SELECT COALESCE(max(sale_number),0) m FROM sales WHERE sale_number < 1000000`).get().m as number);
      const ins = (days: number, acopio = 0) => {
        const id = crypto.randomUUID(); const at = now - days * D - Math.floor(Math.random() * D);
        db.prepare(`INSERT INTO sales (id, sale_number, user_id, session_id, subtotal, total, payment_method_summary, status, created_at, is_acopio, acopio_status) VALUES (?,?,?,?,100,100,'CASH','COMPLETED',?,?,?)`)
          .run(id, ++num, user, sess, at, acopio, acopio ? 'PENDING' : 'NONE');
        for (let k = 0; k < 2; k++) {
          const p = prods[Math.floor(Math.random() * prods.length)];
          db.prepare(`INSERT INTO sale_items (id, sale_id, product_id, product_name, unit_price, quantity, subtotal, total) VALUES (?,?,?,?,50,1,50,50)`).run(crypto.randomUUID(), id, p.id, p.name);
          db.prepare(`INSERT INTO inventory_movements (id, product_id, user_id, type, quantity, stock_before, stock_after, created_at) VALUES (?,?,?,'SALE',-1,10,9,?)`).run(crypto.randomUUID(), p.id, user, at);
        }
        db.prepare(`INSERT INTO payments (id, sale_id, method, amount, created_at) VALUES (?,?,'CASH',100,?)`).run(crypto.randomUUID(), id, at);
        return id;
      };
      db.exec('BEGIN');
      for (let i = 0; i < Number(process.env.OLD || 400); i++) ins(200);
      ins(200, 1);
      for (let i = 0; i < 60; i++) ins(10);
      db.exec('COMMIT');
    } else {
      // Caja nueva: base vacía (mismo esquema)
      db.exec('PRAGMA foreign_keys = OFF');
      for (const t of tables) db.exec(`DELETE FROM "${t}"`);
    }
    db.close();
  }
  log('tablas sincronizadas:', tables.length);

  // ── Nube falsa ─────────────────────────────────────
  const pg = new PGlite();
  const sql = { query: async (t: string, p: any[]) => (await pg.query(t, p)).rows };
  await cs.ensureSchema(sql);
  const files: Record<string, Buffer> = {};
  const bucket = { file: (p: string) => ({ save: async (b: Buffer) => { files[p] = b; }, download: async () => [files[p]] }), deleteFiles: async () => {} };
  const images: Record<string, string> = {};
  const fail = (status: number, error: string) => Object.assign(new Error(error), { response: { status, data: { error } } });
  const cloudCall = (deviceId: string) => async (action: string, body: any = {}) => {
    let r: any;
    if (action === 'register') r = await cs.register(sql, T, deviceId, body.kind || 'pc', body.v);
    else if (action === 'report') r = await cs.report(sql, T, deviceId, body.status);
    else if (action === 'claimLedger') r = await cs.claimLedger(sql, T);
    else if (action === 'push') { if (!cs.validRows(body.rows)) throw fail(400, 'Filas inválidas'); r = await cs.push(sql, T, deviceId, body.rows, body.gen); }
    else if (action === 'pull') r = await cs.pull(sql, T, deviceId, body.after, !!body.all, !!body.fresh, body.limit, body.part, body.cut, body.until);
    else if (action === 'fullStart') r = process.env.OLDCLOUD ? (() => { throw fail(400, 'Acción desconocida'); })() : await cs.fullStart(sql, T);
    else if (action === 'pullTable') r = await cs.pullTable(sql, T, body);
    else if (action === 'archives') r = await ar.list(sql, T);
    else if (action === 'archive') { const gz = await ar.read(sql, bucket, T, body.id); if (!gz) throw fail(404, 'Archivo inexistente'); r = JSON.parse(zlib.gunzipSync(gz).toString()); }
    else if (action === 'archiveDeletes') r = await ar.deletes(sql, T, body.after);
    else if (action === 'putImage') { images[body.productId] = body.dataUrl; r = { ok: true }; }
    else if (action === 'getImage') { if (!images[body.productId]) throw fail(404, 'Sin foto'); r = { ok: true, dataUrl: images[body.productId] }; }
    else throw fail(400, 'Acción desconocida');
    if (action === 'pull' && deviceId === 'b' && process.env.DBG) {
      const by: Record<string, number> = {}; for (const x of r.rows) by[x.t] = (by[x.t] || 0) + 1;
      console.log('   pull', body.part, 'after', body.after, '->', r.rows.length, 'more', r.more, 'last', r.last, JSON.stringify(by));
    }
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
    const cycle = async () => { svc.nextPullAt = 0; svc.retryAt = 0; svc.historyRetryAt = 0; await svc.cycle(); if (svc.lastError) throw new Error(`${name}: ${svc.lastError}`); };
    return { svc, prisma, cycle, name };
  };

  const A = mkCaja('a');
  const t0 = Date.now();
  for (let i = 0; i < 2; i++) await A.cycle();
  await pg.query(`UPDATE sync_rows SET updated_at = now() - interval '2 days'`);
  for (let i = 0; i < 3; i++) await A.cycle();
  log('pulled_seq de A:', (await pg.query(`SELECT pulled_seq::text p FROM sync_nodes`)).rows[0].p);
  log(`caja A arrancó y subió todo (${Date.now() - t0} ms), filas en la nube:`, (await pg.query(`SELECT count(*)::int n FROM sync_rows`)).rows[0].n);

  // Todo lo subido "hace 2 días" para que se pueda archivar; A ya bajó hasta el final
  await pg.query(`UPDATE sync_rows SET updated_at = now() - interval '2 days'`);
  if (process.env.DUMP) {
    const out: string[] = [JSON.stringify({ t: '_meta', version: 1 })];
    for (const t of ['sync_tenants', 'sync_nodes']) for (const r of (await pg.query(`SELECT * FROM ${t}`)).rows) out.push(JSON.stringify({ t, r }));
    for (let after = 0; ;) { const rows = (await pg.query(`SELECT * FROM sync_rows WHERE seq > $1 ORDER BY seq LIMIT 5000`, [after])).rows; if (!rows.length) break; for (const r of rows) out.push(JSON.stringify({ t: 'sync_rows', r })); after = Number(rows[rows.length - 1].seq); }
    fs.writeFileSync(process.env.DUMP, zlib.gzipSync(out.join(String.fromCharCode(10)) + String.fromCharCode(10)));
    log('respaldo de prueba escrito'); process.exit(0);
  }
  log('compactación:', JSON.stringify(await cs.maintain(sql, T, false)));
  const arch = process.env.ARCHIVE === '0' ? 'apagado' : await ar.archiveTenant(sql, bucket, T, false);
  log('archivado en la nube:', JSON.stringify(arch));

  // Después de archivar: A anula una venta vieja y borra un pago viejo (vuelven a Neon)
  const oldSale = (await A.prisma.$queryRawUnsafe(`SELECT id FROM sales WHERE created_at < ? AND is_acopio = 0 LIMIT 2`, now - 100 * D)) as any[];
  await A.prisma.$executeRawUnsafe(`UPDATE sales SET status = 'CANCELLED' WHERE id = ?`, oldSale[0].id);
  await A.prisma.$executeRawUnsafe(`DELETE FROM payments WHERE sale_id = ?`, oldSale[1].id);
  await A.cycle();
  await pg.query(`UPDATE sync_rows SET updated_at = now() - interval '1 minute' WHERE updated_at > now() - interval '1 minute'`);
  await A.cycle();

  // Caja B nueva: primer tiempo
  const B = mkCaja('b');
  const t1 = Date.now();
  await B.cycle();
  const stB: any[] = await B.prisma.$queryRawUnsafe(`SELECT key, value FROM sync_state WHERE key LIKE 'history%' OR key LIKE 'archive%' OR key = 'sale_number_floor' OR key = 'node_index'`);
  log(`caja B primer tiempo (${Date.now() - t1} ms):`, stB.map((r) => `${r.key}=${String(r.value).slice(0, 20)}`).join(' '));
  {
    const cloud = (await pg.query(`SELECT tbl, count(*)::int n FROM sync_rows WHERE NOT deleted GROUP BY tbl ORDER BY tbl`)).rows;
    for (const c of cloud) {
      if (c.tbl === '_delta') continue;
      const b = Number(((await B.prisma.$queryRawUnsafe(`SELECT count(*) AS n FROM "${c.tbl}"`)) as any[])[0].n);
      if (b !== c.n) console.log(`   nube ${c.tbl}=${c.n} B=${b}`);
    }
  }
  const salesAfterLive = ((await B.prisma.$queryRawUnsafe(`SELECT count(*) AS n FROM sales`)) as any[])[0].n;
  log('ventas en B tras el primer tiempo:', Number(salesAfterLive));

  // Mientras B baja la historia, A vende y edita
  const user = ((await A.prisma.$queryRawUnsafe(`SELECT id FROM users LIMIT 1`)) as any[])[0].id;
  const sess = ((await A.prisma.$queryRawUnsafe(`SELECT id FROM cash_register_sessions LIMIT 1`)) as any[])[0].id;
  const maxA = Number(((await A.prisma.$queryRawUnsafe(`SELECT max(sale_number) m FROM sales WHERE sale_number < 1000000`)) as any[])[0].m);
  await A.prisma.$executeRawUnsafe(`INSERT INTO sales (id, sale_number, user_id, session_id, subtotal, total, payment_method_summary, status, created_at) VALUES (?,?,?,?,1,1,'CASH','COMPLETED',?)`, crypto.randomUUID(), maxA + 1, user, sess, Date.now());
  await A.prisma.$executeRawUnsafe(`UPDATE products SET stock = stock - 3 WHERE id = (SELECT id FROM products ORDER BY id LIMIT 1)`);
  await A.cycle();

  let n = 0;
  while (n++ < 200) {
    await B.cycle();
    const left: any[] = await B.prisma.$queryRawUnsafe(`SELECT count(*) AS n FROM sync_state WHERE key LIKE 'history%' OR key LIKE 'archive%'`);
    if (!Number(left[0].n)) break;
  }
  await A.cycle(); await B.cycle(); await B.cycle();
  log(`caja B completa en ${n} ciclos (${Date.now() - t1} ms)`);

  // B vende: el número tiene que seguir al de su rango
  const nodeB = Number(((await B.prisma.$queryRawUnsafe(`SELECT value FROM sync_state WHERE key = 'node_index'`)) as any[])[0].value);
  log('B es la caja', nodeB, '| piso de numeración:', ((await B.prisma.$queryRawUnsafe(`SELECT value FROM sync_state WHERE key = 'sale_number_floor'`)) as any[])[0]?.value ?? '(no hay: nunca vendió)');

  // ── Comparación A vs B ─────────────────────────────
  const dump = async (prisma: any, t: string) => {
    const cols: any[] = await prisma.$queryRawUnsafe(`PRAGMA table_info("${t}")`);
    const names = cols.map((c) => c.name).filter((c) => !(t === 'products' && c === 'image_url'));
    const rows: any[] = await prisma.$queryRawUnsafe(`SELECT ${names.map((c) => `quote("${c}") AS "${c}"`).join(', ')} FROM "${t}"`);
    return rows.map((r) => JSON.stringify(names.map((c) => r[c])));
  };
  let bad = 0;
  const synced: string[] = await A.svc.syncedTables();
  log('comparando', synced.length, 'tablas sincronizadas');
  for (const t of synced) {
    const [a, b] = [await dump(A.prisma, t), await dump(B.prisma, t)];
    const sa = new Set(a), sb = new Set(b);
    const onlyA = a.filter((x) => !sb.has(x)), onlyB = b.filter((x) => !sa.has(x));
    if (onlyA.length || onlyB.length) {
      bad++;
      console.log(`  ✗ ${t}: A=${a.length} B=${b.length} | solo en A: ${onlyA.length}, solo en B: ${onlyB.length}`);
      if (onlyA[0]) console.log('     A:', onlyA[0].slice(0, 300));
      if (onlyB[0]) console.log('     B:', onlyB[0].slice(0, 300));
    }
  }
  // B vende después de la carga: número en su rango
  await B.prisma.$executeRawUnsafe(`INSERT INTO sales (id, sale_number, user_id, session_id, subtotal, total, payment_method_summary, status, created_at) VALUES (?,?,?,?,1,1,'CASH','COMPLETED',?)`, crypto.randomUUID(), 1000001, user, sess, Date.now());
  await B.cycle(); await pg.query(`UPDATE sync_rows SET updated_at = now() - interval '1 minute' WHERE updated_at > now() - interval '1 minute'`); await A.cycle();
  const parked: any[] = await B.prisma.$queryRawUnsafe(`SELECT tbl, count(*) AS n FROM sync_parked GROUP BY tbl`);
  log(bad ? `DIFERENCIAS en ${bad} tablas` : `A y B IDÉNTICAS en las ${synced.length} tablas sincronizadas`, '| apartadas en B:', JSON.stringify(parked.map((p) => [p.tbl, Number(p.n)])));
  // A se recupera desde la nube (base vaciada): numera bien antes de tener la historia
  const restored = await A.svc.restoreFromCloud();
  const salesA = Number(((await A.prisma.$queryRawUnsafe(`SELECT count(*) AS n FROM sales`)) as any[])[0].n);
  const floorA = ((await A.prisma.$queryRawUnsafe(`SELECT value FROM sync_state WHERE key = 'sale_number_floor'`)) as any[])[0]?.value;
  const maxLocal = Number(((await A.prisma.$queryRawUnsafe(`SELECT COALESCE(max(sale_number),0) m FROM sales WHERE sale_number < 1000000`)) as any[])[0].m);
  log(`A recuperada: ${restored.rows} filas; ventas ${salesAfterRestoreLabel(salesA)}; último número local ${maxLocal}; piso ${floorA} (real ${maxA + 1})`);
  let k = 0;
  while (k++ < 200) { await A.cycle(); const left: any[] = await A.prisma.$queryRawUnsafe(`SELECT count(*) AS n FROM sync_state WHERE key LIKE 'history%' OR key LIKE 'archive%'`); if (!Number(left[0].n)) break; }
  await A.cycle();
  let bad2 = 0;
  for (const t of synced) { const [a, b] = [await dump(A.prisma, t), await dump(B.prisma, t)]; const sb = new Set(b); const sa = new Set(a); if (a.some((x) => !sb.has(x)) || b.some((x) => !sa.has(x))) { bad2++; console.log(`  ✗ tras recuperar ${t}: A=${a.length} B=${b.length}`); } }
  log(bad2 ? `DIFERENCIAS tras recuperar A en ${bad2} tablas` : `A recuperada IDÉNTICA a B (${k} ciclos)`);
  // B queda inactiva >30 días; A carga ventas viejas que se archivan sin que B las baje; B vuelve
  await pg.query(`UPDATE sync_nodes SET last_seen_at = now() - interval '40 days' WHERE device_id = 'b'`);
  const pulledB = (await pg.query(`SELECT pulled_seq::text p FROM sync_nodes WHERE device_id = 'b'`)).rows[0].p;
  const prods2: any[] = await A.prisma.$queryRawUnsafe(`SELECT id, name FROM products LIMIT 5`);
  for (let i = 0; i < 30; i++) {
    const id = crypto.randomUUID(); const at = now - 300 * D;
    await A.prisma.$executeRawUnsafe(`INSERT INTO sales (id, sale_number, user_id, session_id, subtotal, total, payment_method_summary, status, created_at) VALUES (?,?,?,?,5,5,'CASH','COMPLETED',?)`, id, 500000 + i, user, sess, at);
    await A.prisma.$executeRawUnsafe(`INSERT INTO sale_items (id, sale_id, product_id, product_name, unit_price, quantity, subtotal, total) VALUES (?,?,?,?,5,1,5,5)`, crypto.randomUUID(), id, prods2[0].id, prods2[0].name);
  }
  await A.cycle();
  await pg.query(`UPDATE sync_rows SET updated_at = now() - interval '2 days'`);
  await A.cycle(); await A.cycle();
  const arch2 = await ar.archiveTenant(sql, bucket, T, false);
  log(`B inactiva (había bajado hasta ${pulledB}); archivado sin ella: ${arch2.archived} filas en ${arch2.files} archivo(s), compactado hasta`, (await pg.query(`SELECT compacted_seq::text c FROM sync_tenants`)).rows[0].c);
  B.svc.historyRetryAt = 0;
  let r = 0;
  while (r++ < 50) { await B.cycle(); console.log('   B pull_after', ((await B.prisma.$queryRawUnsafe(`SELECT value FROM sync_state WHERE key = 'pull_after'`)) as any[])[0]?.value); const left: any[] = await B.prisma.$queryRawUnsafe(`SELECT count(*) AS n FROM sync_state WHERE key LIKE 'history%' OR key LIKE 'archive%'`); if (r > 1 && !Number(left[0].n)) break; }
  let bad3 = 0;
  for (const t of synced) { const [a, b] = [await dump(A.prisma, t), await dump(B.prisma, t)]; const sb = new Set(b); const sa = new Set(a); if (a.some((x) => !sb.has(x)) || b.some((x) => !sa.has(x))) { bad3++; console.log(`  ✗ tras volver B ${t}: A=${a.length} B=${b.length}`); } }
  log(bad3 ? `DIFERENCIAS tras volver B en ${bad3} tablas` : `B volvió, se realineó y quedó IDÉNTICA a A (${r} ciclos)`);
  // Actualización de Ventra en B que rehace TODAS las tablas (las migraciones de SQLite recrean
  // la tabla y se llevan sus triggers): B no tiene que volver a bajar todo de la nube.
  const bootstrapOrig = B.svc.bootstrap.bind(B.svc);
  let boots = 0;
  B.svc.bootstrap = async (...args: any[]) => { boots++; return bootstrapOrig(...args); };
  for (const { name } of (await B.prisma.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'ventra_sync%'`)) as any[]) {
    await B.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${name}"`);
  }
  const prodU: any = ((await A.prisma.$queryRawUnsafe(`SELECT id FROM products LIMIT 1`)) as any[])[0];
  await A.prisma.$executeRawUnsafe(`UPDATE products SET stock = stock - 3 WHERE id = ?`, prodU.id);
  await A.cycle();
  await B.cycle(); await B.cycle();
  await pg.query(`UPDATE sync_rows SET updated_at = now() - interval '1 minute' WHERE updated_at > now() - interval '1 minute'`);
  B.svc.nextPullAt = 0; await B.cycle(); await A.cycle();
  const trigB = Number(((await B.prisma.$queryRawUnsafe(`SELECT count(*) AS n FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'ventra_sync%'`)) as any[])[0].n);
  let bad4 = 0;
  for (const t of synced) { const [a, b] = [await dump(A.prisma, t), await dump(B.prisma, t)]; const sb = new Set(b); const sa = new Set(a); if (a.some((x) => !sb.has(x)) || b.some((x) => !sa.has(x))) { bad4++; console.log(`  ✗ tras actualizar B ${t}: A=${a.length} B=${b.length}`); } }
  log(`actualización que rehace todas las tablas en B: bajadas completas=${boots} (tiene que ser 0), triggers repuestos=${trigB}`);
  log(bad4 ? `DIFERENCIAS tras actualizar B en ${bad4} tablas` : 'B sigue IDÉNTICA a A después de la actualización');
  if (boots !== 0 || bad4) process.exitCode = 1;
  log('filas en Neon:', (await pg.query(`SELECT count(*)::int n FROM sync_rows`)).rows[0].n, '| archivos:', Object.keys(files).length);
  await A.prisma.$disconnect(); await B.prisma.$disconnect();
}
function salesAfterRestoreLabel(n: number) { return `${n} antes de la historia`; }
main().catch((e) => { console.error('ERROR', e); process.exit(1); });
