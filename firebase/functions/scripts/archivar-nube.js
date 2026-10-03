// Corre a mano el archivo de la historia vieja fuera de Neon (ver archive.js).
//   node scripts/archivar-nube.js             -> solo muestra qué archivaría, por comercio y mes
//   node scripts/archivar-nube.js --ejecutar  -> lo hace
//   node scripts/archivar-nube.js --comercio=<uid> [--ejecutar]  -> un solo comercio
// Toma NEON_DATABASE_URL de los secretos de Firebase (sin mostrarla) y usa las credenciales
// de gcloud para Cloud Storage (gcloud auth application-default login).
const { execSync } = require("child_process");
const admin = require("firebase-admin");
const cloudSync = require("../sync");
const syncArchive = require("../archive");

const RUN = process.argv.includes("--ejecutar");
const only = (process.argv.find((a) => a.startsWith("--comercio=")) || "").split("=")[1];
const url = process.env.NEON_DATABASE_URL
  || execSync("firebase functions:secrets:access NEON_DATABASE_URL", { cwd: __dirname + "/../..", encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\r?\n/).pop();
const mb = (b) => (Number(b) / 1024 / 1024).toFixed(1) + " MB";

(async () => {
  admin.initializeApp({ storageBucket: "ventra-9cba5.firebasestorage.app" });
  const bucket = admin.storage().bucket();
  const sql = cloudSync.db(url);
  await cloudSync.ensureSchema(sql);
  const size = async () => mb((await cloudSync.run(sql, `SELECT pg_database_size(current_database()) AS b`, []))[0].b);
  console.log(`Base: ${await size()}${RUN ? "" : "  (modo prueba: no se cambia nada)"}`);
  const results = only
    ? [await syncArchive.archiveTenant(sql, bucket, only, !RUN)]
    : await syncArchive.archiveAll(sql, bucket, !RUN);
  for (const r of results) {
    if (r.error) { console.log(`  ${r.tenantId}: ERROR ${r.error}`); continue; }
    if (r.skipped) { console.log(`  ${r.tenantId}: salteado (${r.skipped})`); continue; }
    const months = Object.entries(r.months).map(([m, n]) => `${m}: ${n}`).join(", ") || "nada";
    console.log(`  ${r.tenantId}: ${RUN ? `archivadas ${r.archived} filas en ${r.files} archivo(s)` : `archivaría ${r.archived} filas`} | ${months}`);
  }
  if (RUN) console.log(`Base: ${await size()} (el espacio liberado se reusa para lo nuevo)`);
  else console.log("\nPara hacerlo, agregá --ejecutar");
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
