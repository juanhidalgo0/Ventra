// Registra la dirección de cada tienda online en ventra_store_slugs y avisa si hay
// direcciones repetidas (dos tiendas con la misma dirección = posible impostor).
// Ver functions/store-slugs.js.
//
// Uso (desde firebase/functions, con credenciales de Google del proyecto:
//   gcloud auth application-default login):
//   node scripts/registrar-direcciones.js              → solo muestra (no cambia nada)
//   node scripts/registrar-direcciones.js --ejecutar   → registra las direcciones
//
// Conviene correrlo con --ejecutar justo antes de desplegar las reglas y las funciones nuevas.
const admin = require("firebase-admin");
const { claim, slugOf } = require("../store-slugs");

admin.initializeApp({ projectId: "ventra-9cba5" });
const db = admin.firestore();
const RUN = process.argv.includes("--ejecutar");

const ms = (t) => (t && t.toMillis ? t.toMillis() : 0);
const fecha = (t) => (t && t.toDate ? t.toDate().toISOString().slice(0, 10) : "sin fecha");

(async () => {
  const snap = await db.collection("ventra_stores").where("claimed", "==", true).get();
  const bySlug = new Map();
  snap.docs.forEach((d) => {
    const slug = slugOf(d.data());
    if (!slug) return;
    if (!bySlug.has(slug)) bySlug.set(slug, []);
    bySlug.get(slug).push(d);
  });

  let repetidas = 0;
  for (const [slug, docs] of bySlug) {
    if (docs.length < 2) continue;
    repetidas++;
    console.log(`\n⚠ La dirección "${slug}" la usan ${docs.length} tiendas (se queda la más antigua):`);
    docs.sort((a, b) => ms(a.data().createdAt) - ms(b.data().createdAt)).forEach((d, i) => {
      const x = d.data();
      console.log(`   ${i === 0 ? "✓" : "✗"} ${d.id} · ${x.businessName || "(sin nombre)"} · dueño ${x.ownerUid} · creada ${fecha(x.createdAt)} · publicada ${!!x.isPublished}`);
    });
  }
  console.log(`\n${bySlug.size} direcciones en uso, ${repetidas} repetidas.`);

  if (!RUN) {
    console.log("Nada cambió. Para registrarlas: node scripts/registrar-direcciones.js --ejecutar");
    return;
  }
  let ok = 0;
  for (const [slug, docs] of bySlug) {
    const first = docs.sort((a, b) => ms(a.data().createdAt) - ms(b.data().createdAt))[0];
    if (await claim(db, slug, first.id)) ok++;
  }
  console.log(`${ok} direcciones registradas. Las tiendas repetidas pierden la dirección la próxima vez que se guarden.`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
