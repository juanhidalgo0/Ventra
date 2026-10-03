// Corre a mano el mantenimiento diario de Neon (el mismo que ventraSyncMaintenance).
//   node scripts/mantener-nube.js             -> solo muestra qué haría, por comercio
//   node scripts/mantener-nube.js --ejecutar  -> lo hace
// Toma NEON_DATABASE_URL de los secretos de Firebase (sin mostrarla).
const { execSync } = require("child_process");
const cloudSync = require("../sync");

const RUN = process.argv.includes("--ejecutar");
const url = process.env.NEON_DATABASE_URL
  || execSync("firebase functions:secrets:access NEON_DATABASE_URL", { cwd: __dirname + "/../..", encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\r?\n/).pop();
const mb = (b) => (Number(b) / 1024 / 1024).toFixed(1) + " MB";

(async () => {
  const sql = cloudSync.db(url);
  await cloudSync.ensureSchema(sql);
  const size = async () => mb((await cloudSync.run(sql, `SELECT pg_database_size(current_database()) AS b`, []))[0].b);
  console.log(`Base: ${await size()}${RUN ? "" : "  (modo prueba: no se cambia nada)"}`);
  for (const r of await cloudSync.maintainAll(sql, !RUN)) {
    if (r.error) { console.log(`  ${r.tenantId}: ERROR ${r.error}`); continue; }
    console.log(`  ${r.tenantId}: auditoría vieja ${r.retention}` + (r.skipped
      ? ` | compactación salteada: ${r.skipped}`
      : ` | contadores juntados ${r.merged} (se van ${r.removedDeltas} filas) | bajas ${r.tombstones}`));
  }
  if (RUN) console.log(`Base: ${await size()} (el espacio liberado se reusa para lo nuevo)`);
  else console.log("\nPara hacerlo, agregá --ejecutar");
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
