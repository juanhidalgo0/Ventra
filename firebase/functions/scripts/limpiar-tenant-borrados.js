// Limpia de Neon los registros BORRADOS de un comercio de prueba y recupera el espacio.
//   node scripts/limpiar-tenant-borrados.js <tenantId>            -> solo muestra qué haría
//   node scripts/limpiar-tenant-borrados.js <tenantId> --ejecutar -> lo hace
// Toma NEON_DATABASE_URL de los secretos de Firebase (sin mostrarla).
//
// Pasos:
//  1. Borra las filas marcadas como borradas (deleted) de ese comercio. Las vigentes no se tocan.
//  2. Da de baja sus cajas abandonadas: nunca bajaron nada (pulled_seq 0), protocolo viejo y
//     sin conectarse hace más de 4 días. Si vuelven, se registran con un número nuevo.
//  3. VACUUM (sin bloquear) y reconstruye los índices de a uno, que achica lo que ocupan.
//  4. VACUUM FULL (compacta la tabla) solo si hay lugar de sobra en el plan: necesita espacio
//     para la copia nueva y bloquea la sincronización de todos los comercios mientras dura
//     (segundos a un minuto; las cajas reintentan solas).
const { execSync } = require("child_process");
const { neon } = require("@neondatabase/serverless");

const T = process.argv[2];
const RUN = process.argv.includes("--ejecutar");
const LIMIT_MB = 512;
if (!T || T.startsWith("--")) { console.error("Falta el tenantId"); process.exit(1); }

const url = process.env.NEON_DATABASE_URL
  || execSync("firebase functions:secrets:access NEON_DATABASE_URL", { cwd: __dirname + "/../..", encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\r?\n/).pop();
const sql = neon(url);
const q = (t, p = []) => (typeof sql.query === "function" ? sql.query(t, p) : sql(t, p));
const mb = (b) => Number(b) / 1024 / 1024;
const size = async () => mb((await q(`SELECT pg_database_size(current_database()) AS b`))[0].b);

(async () => {
  console.log(`Base: ${(await size()).toFixed(1)} MB de ${LIMIT_MB} MB`);
  const [c] = await q(`SELECT count(*) FILTER (WHERE deleted)::int AS borradas, count(*) FILTER (WHERE NOT deleted)::int AS vigentes FROM sync_rows WHERE tenant_id = $1`, [T]);
  const stale = await q(`SELECT idx, kind, last_seen_at FROM sync_nodes WHERE tenant_id = $1 AND pulled_seq = 0 AND client_v = 1 AND last_seen_at < now() - interval '4 days'`, [T]);
  console.log(`Comercio ${T}: ${c.borradas} filas borradas para limpiar, ${c.vigentes} vigentes (no se tocan)`);
  console.log(`Cajas abandonadas: ${JSON.stringify(stale)}`);
  if (!RUN) { console.log("\nNo se hizo nada. Para hacerlo, agregá --ejecutar"); return; }

  const [d] = await q(`WITH d AS (DELETE FROM sync_rows WHERE tenant_id = $1 AND deleted RETURNING 1) SELECT count(*)::int AS n FROM d`, [T]);
  console.log(`1. Filas borradas eliminadas: ${d.n}`);
  const n = await q(`DELETE FROM sync_nodes WHERE tenant_id = $1 AND pulled_seq = 0 AND client_v = 1 AND last_seen_at < now() - interval '4 days' RETURNING idx`, [T]);
  console.log(`2. Cajas dadas de baja: ${n.map((r) => r.idx).join(", ") || "ninguna"}`);

  await q(`VACUUM (ANALYZE) sync_rows`);
  console.log(`3. VACUUM listo. Base: ${(await size()).toFixed(1)} MB`);
  const idx = await q(`SELECT indexrelname AS name FROM pg_stat_user_indexes WHERE relname = 'sync_rows' ORDER BY pg_relation_size(indexrelid)`);
  for (const { name } of idx) {
    await q(`REINDEX INDEX "${name}"`);
    console.log(`   índice ${name} reconstruido. Base: ${(await size()).toFixed(1)} MB`);
  }

  const now = await size();
  const [live] = await q(`SELECT sum(pg_column_size(s.*))::bigint AS b FROM sync_rows s`);
  const [ix] = await q(`SELECT pg_indexes_size('sync_rows') AS b`);
  const need = mb(live.b) * 1.15 + mb(ix.b);
  if (now + need < LIMIT_MB * 0.9) {
    console.log(`4. VACUUM FULL (necesita ~${need.toFixed(0)} MB libres temporalmente)...`);
    await q(`VACUUM FULL sync_rows`);
    console.log(`   Listo. Base: ${(await size()).toFixed(1)} MB`);
  } else {
    console.log(`4. VACUUM FULL salteado: necesita ~${need.toFixed(0)} MB y no hay lugar de sobra (${now.toFixed(0)} MB usados). El espacio liberado igual se reusa para lo nuevo.`);
  }
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
