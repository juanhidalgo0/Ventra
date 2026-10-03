// Mide cuánto ocupa la réplica en Neon, por comercio y por tipo de fila. Solo lee.
//   node scripts/medir-neon.js   (toma NEON_DATABASE_URL de los secretos de Firebase, sin mostrarla)
const { execSync } = require("child_process");
const { neon } = require("@neondatabase/serverless");

const url = process.env.NEON_DATABASE_URL
  || execSync("firebase functions:secrets:access NEON_DATABASE_URL", { cwd: __dirname + "/../..", encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\r?\n/).pop();
const sql = neon(url);
const q = (t, p = []) => (typeof sql.query === "function" ? sql.query(t, p) : sql(t, p));
const mb = (b) => (Number(b) / 1024 / 1024).toFixed(1) + " MB";

(async () => {
  const [db] = await q(`SELECT pg_database_size(current_database()) AS b`);
  console.log("Base completa:", mb(db.b));
  const tables = await q(`SELECT relname, pg_total_relation_size(relid) AS b FROM pg_catalog.pg_statio_user_tables ORDER BY 2 DESC LIMIT 8`);
  for (const t of tables) console.log("  tabla", t.relname, mb(t.b));

  const kinds = await q(`SELECT CASE WHEN tbl = '_delta' THEN 'deltas' WHEN deleted THEN 'borradas' ELSE 'vigentes' END AS k,
      count(*)::int AS n, coalesce(sum(pg_column_size(data)), 0)::bigint AS b FROM sync_rows GROUP BY 1 ORDER BY 1`);
  console.log("Filas por tipo:");
  for (const k of kinds) console.log(`  ${k.k}: ${k.n.toLocaleString("es-AR")} filas, ${mb(k.b)} de datos`);

  const tenants = await q(`SELECT tenant_id,
      count(*) FILTER (WHERE tbl <> '_delta' AND NOT deleted)::int AS vigentes,
      count(*) FILTER (WHERE tbl = '_delta')::int AS deltas,
      count(*) FILTER (WHERE deleted)::int AS borradas,
      coalesce(sum(pg_column_size(data)), 0)::bigint AS b
    FROM sync_rows GROUP BY tenant_id ORDER BY b DESC`);
  console.log(`Comercios (${tenants.length}):`);
  for (const t of tenants) console.log(`  ${t.tenant_id}  ${mb(t.b)}  vigentes ${t.vigentes}  deltas ${t.deltas}  borradas ${t.borradas}`);

  const top = await q(`SELECT tbl, count(*)::int AS n, coalesce(sum(pg_column_size(data)), 0)::bigint AS b
    FROM sync_rows WHERE tbl <> '_delta' AND NOT deleted GROUP BY tbl ORDER BY b DESC LIMIT 10`);
  console.log("Tablas del comercio que más pesan (todas juntas):");
  for (const t of top) console.log(`  ${t.tbl}: ${t.n.toLocaleString("es-AR")} filas, ${mb(t.b)}`);

  const nodes = await q(`SELECT tenant_id, count(*)::int AS cajas, min(pulled_seq)::text AS min_pulled, min(client_v)::int AS min_v,
      max(last_seen_at) AS visto FROM sync_nodes GROUP BY tenant_id`);
  const [seq] = await q(`SELECT max(seq)::text AS s FROM sync_rows`);
  console.log("Seq actual:", seq.s);
  for (const n of nodes) console.log(`  cajas ${n.tenant_id}: ${n.cajas}, la más atrasada bajó hasta ${n.min_pulled}, protocolo mín ${n.min_v}`);
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
