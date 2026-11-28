// Recalcula YA el catálogo inicial (lo mismo que hace ventraInitialCatalogBuild cada lunes).
// Solo escribe en ventra_initial_catalog/{rubro}.
//   node scripts/construir-catalogo-inicial.js
const { execSync } = require("child_process");
const admin = require("firebase-admin");
const { neon } = require("@neondatabase/serverless");
const { build } = require("../catalog-initial");

const url = process.env.NEON_DATABASE_URL
  || execSync("firebase functions:secrets:access NEON_DATABASE_URL", { cwd: __dirname + "/../..", encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\r?\n/).pop();
admin.initializeApp({ projectId: "ventra-9cba5" });
build(neon(url), admin.firestore())
  .then((s) => { console.log("Catálogo inicial guardado:", s); process.exit(0); })
  .catch((e) => { console.error("Error:", e.message); process.exit(1); });
