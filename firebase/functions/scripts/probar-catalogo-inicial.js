// Prueba el catálogo inicial SIN guardar nada: corre la consulta, elige los productos y muestra
// cuántos quedarían por rubro y los primeros de cada uno. Solo lee.
//   node scripts/probar-catalogo-inicial.js
const { execSync } = require("child_process");
const { neon } = require("@neondatabase/serverless");
const { QUERY, DAYS, pick } = require("../catalog-initial");

const url = process.env.NEON_DATABASE_URL
  || execSync("firebase functions:secrets:access NEON_DATABASE_URL", { cwd: __dirname + "/../..", encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split(/\r?\n/).pop();
const sql = neon(url);
const q = (t, p = []) => (typeof sql.query === "function" ? sql.query(t, p) : sql(t, p));

(async () => {
  const rows = await q(QUERY, [String(DAYS)]);
  const cats = pick(rows);
  for (const [rubro, items] of Object.entries(cats)) {
    const conCodigo = items.filter((i) => i.barcode).length;
    const conCat = items.filter((i) => i.category).length;
    console.log(`${rubro}: ${items.length} productos (${conCodigo} con código, ${conCat} con categoría)`);
    for (const i of items.slice(0, 8)) console.log(`   ${i.rank}. ${i.name}${i.category ? ` [${i.category}]` : ""}`);
  }
})().catch((e) => { console.error("Error:", e.message); process.exit(1); });
