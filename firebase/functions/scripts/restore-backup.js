// ═══════════════════════════════════════════════════
// Restaura una copia de seguridad de Neon (hecha por ventraNightlyBackup).
//
// 1. Bajar la copia: Firebase Console → Storage → backups/neon/AAAA-MM-DD.ndjson.gz
//    (o: gcloud storage cp gs://ventra-9cba5.firebasestorage.app/backups/neon/AAAA-MM-DD.ndjson.gz .)
// 2. Ver qué tiene (no toca ninguna base):
//      node scripts/restore-backup.js AAAA-MM-DD.ndjson.gz
// 3. Restaurar en una base (conviene una base o rama NUEVA de Neon y después
//    apuntar el secreto NEON_DATABASE_URL a esa):
//      RESTORE_DATABASE_URL="postgres://..." node scripts/restore-backup.js AAAA-MM-DD.ndjson.gz --apply
//    Solo un comercio:  ... --apply --tenant <uid>
//
// Por seguridad no pisa nada: si el destino ya tiene datos de un comercio que se
// va a restaurar, se detiene sin escribir.
// ═══════════════════════════════════════════════════
const fs = require("fs");
const zlib = require("zlib");
const readline = require("readline");
const cloudSync = require("../sync");
const { TABLES, FORMAT_VERSION } = require("../backup");

const BATCH = 500;
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--tenant");
const apply = args.includes("--apply");
const onlyTenant = args.includes("--tenant") ? args[args.indexOf("--tenant") + 1] : null;

if (!file || !fs.existsSync(file)) {
  console.error("Uso: node scripts/restore-backup.js <copia.ndjson.gz> [--apply] [--tenant <uid>]");
  process.exit(1);
}

function lines() {
  return readline.createInterface({ input: fs.createReadStream(file).pipe(zlib.createGunzip()), crlfDelay: Infinity });
}

async function summarize() {
  let meta = null, end = null;
  const perTenant = new Map();
  for await (const line of lines()) {
    if (!line) continue;
    const { t, r, ...rest } = JSON.parse(line);
    if (t === "_meta") { meta = rest; continue; }
    if (t === "_end") { end = rest; continue; }
    const c = perTenant.get(r.tenant_id) || { sync_tenants: 0, sync_nodes: 0, sync_rows: 0 };
    c[t]++;
    perTenant.set(r.tenant_id, c);
  }
  return { meta, end, perTenant };
}

async function main() {
  const { meta, end, perTenant } = await summarize();
  if (!meta) throw new Error("El archivo no es una copia de Ventra");
  if (meta.version > FORMAT_VERSION) throw new Error(`Copia en formato ${meta.version}; este script entiende hasta el ${FORMAT_VERSION}`);
  if (!end) throw new Error("La copia está incompleta (no tiene el cierre). Usá la de otro día.");

  console.log(`Copia del ${meta.createdAt} — ${perTenant.size} comercios`);
  for (const [uid, c] of perTenant) console.log(`  ${uid}: ${c.sync_rows} registros, ${c.sync_nodes} cajas`);

  const tenants = onlyTenant ? [onlyTenant] : [...perTenant.keys()];
  if (onlyTenant && !perTenant.has(onlyTenant)) throw new Error(`La copia no tiene el comercio ${onlyTenant}`);
  if (!apply) { console.log("\nNo se escribió nada. Agregá --apply (y RESTORE_DATABASE_URL) para restaurar."); return; }

  const url = String(process.env.RESTORE_DATABASE_URL || "").trim();
  if (!url) throw new Error("Falta RESTORE_DATABASE_URL (la base donde restaurar)");
  const sql = cloudSync.db(url);
  await cloudSync.ensureSchema(sql);

  const busy = await cloudSync.run(sql, `SELECT DISTINCT tenant_id FROM sync_rows WHERE tenant_id = ANY($1::text[])`, [tenants]);
  if (busy.length) throw new Error(`El destino ya tiene datos de: ${busy.map((b) => b.tenant_id).join(", ")}. No se escribió nada.`);

  const wanted = new Set(tenants);
  const pending = Object.fromEntries(TABLES.map((t) => [t.name, []]));
  const flush = async (name) => {
    const rows = pending[name];
    if (!rows.length) return;
    pending[name] = [];
    await cloudSync.run(sql, `INSERT INTO ${name} SELECT * FROM jsonb_populate_recordset(NULL::${name}, $1::jsonb) ON CONFLICT DO NOTHING`, [JSON.stringify(rows)]);
  };

  let total = 0;
  for await (const line of lines()) {
    if (!line) continue;
    const { t, r } = JSON.parse(line);
    if (!pending[t] || !wanted.has(r.tenant_id)) continue;
    pending[t].push(r);
    total++;
    if (pending[t].length >= BATCH) await flush(t);
    if (total % 20000 === 0) console.log(`  ${total} filas…`);
  }
  for (const t of TABLES) await flush(t.name);
  // Que los cambios nuevos sigan numerándose después de los restaurados
  await cloudSync.run(sql, `SELECT setval('sync_seq', GREATEST((SELECT COALESCE(MAX(seq), 0) FROM sync_rows), (SELECT last_value FROM sync_seq), 1))`, []);
  console.log(`\nListo: ${total} filas restauradas.`);
}

main().catch((err) => { console.error("Error:", err.message); process.exit(1); });
