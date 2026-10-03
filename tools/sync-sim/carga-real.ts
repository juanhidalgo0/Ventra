// Carga total contra una COPIA real de un comercio (respaldo nocturno de Neon), todo local.
//   npm run carga-real -- <respaldo.ndjson.gz>               -> lista los comercios del respaldo
//   npm run carga-real -- <respaldo.ndjson.gz> <uid> [--viejo] [--archivar]
//     --viejo     : además corre la caja de la versión anterior (407fe63) para comparar
//     --archivar  : antes, archiva los meses viejos en la nube falsa (como si estuviera prendido)
// No se conecta a ningún servicio: lee el archivo y usa Postgres en memoria (PGlite).
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import * as readline from 'readline';

const ROOT = path.resolve(__dirname, '../..');
const DIR = path.join(__dirname, 'tmp');
fs.mkdirSync(DIR, { recursive: true });
const { PrismaClient } = require(path.join(ROOT, 'apps/backend/node_modules/@prisma/client'));
const { DatabaseSync } = require('node:sqlite');
const { PGlite } = require('@electric-sql/pglite');
const cs = require(`${ROOT}/firebase/functions/sync`);
const ar = require(`${ROOT}/firebase/functions/archive`);

const [file, tenant] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const OLD = process.argv.includes('--viejo');
const ARCHIVE = process.argv.includes('--archivar');
const log = (...a: any[]) => console.log('»', ...a);
const mb = (b: number) => (b / 1048576).toFixed(1) + ' MB';
const secs = (ms: number) => (ms / 1000).toFixed(1) + ' s';

const lines = () => readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });

async function listTenants() {
  const per = new Map<string, number>();
  for await (const line of lines()) {
    const o = JSON.parse(line);
    if (o.t === 'sync_rows' && !o.r.deleted) per.set(o.r.tenant_id, (per.get(o.r.tenant_id) || 0) + 1);
  }
  for (const [t, n] of [...per].sort((a, b) => b[1] - a[1])) console.log(`  ${t}  ${n} filas`);
}

async function loadCloud() {
  const pg = new PGlite();
  const sql = { query: async (t: string, p: any[]) => (await pg.query(t, p)).rows };
  await cs.ensureSchema(sql);
  const batch: Record<string, any[]> = { sync_tenants: [], sync_nodes: [], sync_rows: [], sync_archives: [] };
  const flush = async (t: string) => {
    if (!batch[t].length) return;
    await pg.query(`INSERT INTO ${t} SELECT * FROM jsonb_populate_recordset(null::${t}, $1::jsonb)`, [JSON.stringify(batch[t])]);
    batch[t] = [];
  };
  let n = 0;
  for await (const line of lines()) {
    const o = JSON.parse(line);
    if (!batch[o.t] || o.r.tenant_id !== tenant) continue;
    batch[o.t].push(o.r);
    if (batch[o.t].length >= 2000) await flush(o.t);
    n++;
  }
  for (const t of Object.keys(batch)) await flush(t);
  await pg.query(`SELECT setval('sync_seq', (SELECT COALESCE(max(seq), 1) FROM sync_rows))`);
  log(`copia cargada: ${n} filas del comercio ${tenant}`);
  return { pg, sql };
}

function emptyDb(name: string) {
  const p = path.join(DIR, name);
  try { fs.unlinkSync(p); } catch {}
  const src = new DatabaseSync(`${ROOT}/apps/backend/prisma/dev.db`, { readOnly: true });
  src.exec(`VACUUM INTO '${p.split(path.sep).join('/')}'`);
  src.close();
  const db = new DatabaseSync(p);
  for (const r of db.prepare(`SELECT name, type FROM sqlite_master WHERE name LIKE 'ventra_sync%' OR (type='table' AND name LIKE 'sync_%')`).all())
    db.exec(`DROP ${r.type === 'trigger' ? 'TRIGGER' : r.type === 'index' ? 'INDEX' : 'TABLE'} IF EXISTS "${r.name}"`);
  db.exec('PRAGMA foreign_keys = OFF');
  for (const r of db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'`).all()) db.exec(`DELETE FROM "${r.name}"`);
  db.close();
  return p;
}

async function runCaja(label: string, servicePath: string, sql: any, bucket: any) {
  const { SyncService } = require(servicePath);
  const dbPath = emptyDb(`${label}.db`);
  const prisma = new PrismaClient({ datasourceUrl: `file:${dbPath}` });
  const dir = path.join(DIR, label); fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
  const cwd = process.cwd(); process.chdir(dir);
  const svc: any = new SyncService(prisma, { getDeviceCredentials: () => ({ deviceId: `sim-${label}`, deviceSecret: 'x' }) });
  process.chdir(cwd);
  const stats = { calls: 0, rows: 0, json: 0, gz: 0 };
  const fail = (status: number, error: string) => Object.assign(new Error(error), { response: { status, data: { error } } });
  const T = tenant;
  svc.call = async (action: string, body: any = {}) => {
    let r: any;
    if (action === 'register') r = await cs.register(sql, T, `sim-${label}`, 'pc', body.v);
    else if (action === 'report') r = { ok: true };
    else if (action === 'claimLedger') r = await cs.claimLedger(sql, T);
    else if (action === 'push') r = await cs.push(sql, T, `sim-${label}`, body.rows, body.gen);
    else if (action === 'pull') r = await cs.pull(sql, T, `sim-${label}`, body.after, !!body.all, !!body.fresh, body.limit, body.part, body.cut, body.until);
    else if (action === 'fullStart') r = process.env.OLDCLOUD ? (() => { throw fail(400, 'Acción desconocida'); })() : await cs.fullStart(sql, T);
    else if (action === 'pullTable') r = await cs.pullTable(sql, T, body);
    else if (action === 'archives') r = await ar.list(sql, T);
    else if (action === 'archive') { const gz = await ar.read(sql, bucket, T, body.id); if (!gz) throw fail(404, 'x'); r = JSON.parse(zlib.gunzipSync(gz).toString()); }
    else if (action === 'archiveDeletes') r = await ar.deletes(sql, T, body.after);
    else if (action === 'getImage' || action === 'putImage') throw fail(404, 'sin fotos en la simulación');
    else throw fail(400, 'Acción desconocida');
    const json = JSON.stringify(r);
    stats.calls++; stats.rows += r.rows ? r.rows.length : 0; stats.json += json.length;
    if (json.length > 65536) stats.gz += zlib.gzipSync(json, { level: 6 }).length; else stats.gz += json.length;
    return JSON.parse(json);
  };
  const snap = () => ({ ...stats });
  const diff = (a: any, b: any) => `${b.calls - a.calls} pedidos, ${b.rows - a.rows} filas, ${mb(b.json - a.json)} JSON (${mb(b.gz - a.gz)} comprimido)`;

  // Primer ciclo: la carga total (en la versión nueva, solo lo necesario para vender)
  let s0 = snap(), t0 = Date.now();
  svc.nextPullAt = 0;
  await svc.cycle();
  if (svc.lastError) throw new Error(`${label}: ${svc.lastError}`);
  log(`[${label}] carga total / primer tiempo: ${secs(Date.now() - t0)} | ${diff(s0, snap())}`);

  // Historia y archivos (versión nueva)
  s0 = snap(); t0 = Date.now();
  let cycles = 0;
  for (; cycles < 5000; cycles++) {
    const left: any[] = await prisma.$queryRawUnsafe(`SELECT count(*) AS n FROM sync_state WHERE key LIKE 'history%' OR key LIKE 'archive%'`).catch(() => [{ n: 0 }]);
    if (!Number(left[0].n)) break;
    svc.nextPullAt = 0; svc.historyRetryAt = 0;
    await svc.cycle();
    if (svc.lastError) throw new Error(`${label}: ${svc.lastError}`);
  }
  if (cycles) log(`[${label}] historia en segundo plano: ${secs(Date.now() - t0)} en ${cycles} ciclos | ${diff(s0, snap())}`);
  return { prisma, svc };
}

/** Todo lo vigente de la nube tiene que estar en la caja, con los mismos valores; contadores = suma de diferencias. */
async function verify(label: string, prisma: any, pg: any, bucket: any, sql: any) {
  const synced: string[] = await (async () => {
    const r: any[] = await prisma.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table'`);
    return r.map((x) => x.name);
  })();
  // Lo vigente: Neon + archivos (sin lo que volvió a Neon)
  const cloud = new Map<string, any>();
  const pages = async (where: string, fn: (r: any) => void) => {
    for (let after = '0'; ;) {
      const rows = (await pg.query(`SELECT tbl, id, data, seq::text AS seq FROM sync_rows WHERE tenant_id = $1 AND seq > $2::bigint AND ${where} ORDER BY sync_rows.seq LIMIT 5000`, [tenant, after])).rows;
      if (!rows.length) break; rows.forEach(fn); after = rows[rows.length - 1].seq;
    }
  };
  let seen = 0;
  await pages(`NOT deleted AND tbl <> '_delta'`, (r) => { seen++; cloud.set(`${r.tbl}|${r.id}`, r.data); });
  if (process.env.DBG) console.log('   vigentes en Neon', (await pg.query(`SELECT count(*)::int n FROM sync_rows WHERE tenant_id = $1 AND NOT deleted AND tbl <> '_delta'`, [tenant])).rows[0].n, 'leídas', seen, 'mapa', cloud.size);
  for (const a of (await ar.list(sql, tenant)).archives) {
    const f = JSON.parse(zlib.gunzipSync(await ar.read(sql, bucket, tenant, a.id)).toString());
    for (const r of f.rows) cloud.set(`${r.t}|${r.id}`, r.d);
  }
  const sums = new Map<string, number>();
  await pages(`tbl = '_delta' AND NOT deleted`, (r) => {
    const k = `${r.data.t}|${r.data.id}|${r.data.c}`; sums.set(k, (sums.get(k) || 0) + Number(r.data.v || 0));
  });
  const counters: Record<string, string[]> = { products: ['stock'], clients: ['balance'], promotions: ['sold_stock'] };
  const byTable = new Map<string, Map<string, any>>();
  for (const [k, d] of cloud) { const [t, id] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)]; if (!byTable.has(t)) byTable.set(t, new Map()); byTable.get(t)!.set(id, d); }
  let missing = 0, differ = 0, counterBad = 0, extra = 0, checked = 0;
  const examples: string[] = [];
  for (const [t, rows] of byTable) {
    if (!synced.includes(t)) continue;
    const cols: string[] = ((await prisma.$queryRawUnsafe(`PRAGMA table_info("${t}")`)) as any[]).map((c) => c.name);
    const local = new Map<string, any>();
    for (const r of (await prisma.$queryRawUnsafe(`SELECT * FROM "${t}"`)) as any[]) local.set(String(r.id), r);
    extra += [...local.keys()].filter((id) => !rows.has(id)).length;
    for (const [id, d] of rows) {
      checked++;
      const l = local.get(id);
      if (!l) { missing++; if (examples.length < 5) examples.push(`falta ${t}/${id}`); continue; }
      for (const c of cols) {
        if (!(c in d) || (t === 'products' && c === 'image_url')) continue;
        if ((counters[t] || []).includes(c)) {
          const want = sums.get(`${t}|${id}|${c}`) || 0;
          if (Math.abs(Number(l[c] || 0) - want) > 1e-6) { counterBad++; if (examples.length < 5) examples.push(`${t}/${id}.${c}: caja ${l[c]} nube ${want}`); }
          continue;
        }
        const a = l[c] === null || l[c] === undefined ? null : typeof l[c] === 'bigint' ? Number(l[c]) : l[c] instanceof Date ? l[c].getTime() : l[c];
        let b = d[c]; if (typeof b === 'boolean') b = b ? 1 : 0;
        const same = a === b || (a !== null && b !== null && Number.isFinite(Number(a)) && typeof b === 'number' && Math.abs(Number(a) - b) < 1e-9) || (typeof a === 'string' && typeof b === 'string' && a === b);
        if (!same) { differ++; if (examples.length < 5) examples.push(`${t}/${id}.${c}: caja ${JSON.stringify(a)?.slice(0, 60)} nube ${JSON.stringify(b)?.slice(0, 60)}`); break; }
      }
    }
  }
  const parked: any[] = await prisma.$queryRawUnsafe(`SELECT tbl, count(*) AS n FROM sync_parked GROUP BY tbl`).catch(() => []);
  log(`[${label}] verificación: ${checked} filas de la nube | faltan ${missing} | distintas ${differ} | contadores mal ${counterBad} | de más en la caja ${extra} | apartadas ${JSON.stringify(parked.map((p) => [p.tbl, Number(p.n)]))}`);
  for (const e of examples) console.log('     ', e);
}

async function main() {
  if (!file) { console.log('Uso: npm run carga-real --  <respaldo.ndjson.gz> [<uid>] [--viejo] [--archivar]'); return; }
  if (!tenant) { console.log('Comercios en el respaldo (por filas vigentes):'); await listTenants(); return; }
  const { pg, sql } = await loadCloud();
  const files: Record<string, Buffer> = {};
  const bucket = { file: (p: string) => ({ save: async (b: Buffer) => { files[p] = b; }, download: async () => [files[p]] }), deleteFiles: async () => {} };
  const stat = (await pg.query(`SELECT tbl, count(*)::int n FROM sync_rows WHERE tenant_id = $1 AND NOT deleted GROUP BY tbl ORDER BY 2 DESC LIMIT 8`, [tenant])).rows;
  log('filas por tabla (las 8 más grandes):', stat.map((r: any) => `${r.tbl} ${r.n}`).join(', '));

  if (ARCHIVE) {
    // Solo en la copia: como si todas las cajas tuvieran la versión nueva y estuvieran al día
    await pg.query(`UPDATE sync_nodes SET client_v = 3, last_seen_at = now(), pulled_seq = (SELECT max(seq) FROM sync_rows WHERE tenant_id = $1) WHERE tenant_id = $1`, [tenant]);
    const t0 = Date.now();
    const r = await ar.archiveTenant(sql, bucket, tenant, false);
    const bytes = Object.values(files).reduce((a, b) => a + b.length, 0);
    log(`archivado (copia): ${r.archived} filas en ${r.files} archivos (${mb(bytes)}) en ${secs(Date.now() - t0)} | quedan en Neon ${(await pg.query(`SELECT count(*)::int n FROM sync_rows WHERE tenant_id = $1`, [tenant])).rows[0].n}`);
  }

  if (OLD) {
    const oldPath = `${ROOT}/apps/backend/src/modules/sync/sync.service.sim-viejo.ts`;
    fs.writeFileSync(oldPath, require('child_process').execSync(`git -C ${ROOT} show 407fe63:apps/backend/src/modules/sync/sync.service.ts`).toString());
    try {
      const old = await runCaja('vieja', oldPath, sql, bucket);
      await verify('vieja', old.prisma, pg, bucket, sql);
      await old.prisma.$disconnect();
    } finally { fs.unlinkSync(oldPath); }
  }
  const neu = await runCaja('nueva', `${ROOT}/apps/backend/src/modules/sync/sync.service`, sql, bucket);
  await verify('nueva', neu.prisma, pg, bucket, sql);
  await neu.prisma.$disconnect();
}
main().catch((e) => { console.error('ERROR', e); process.exit(1); });
