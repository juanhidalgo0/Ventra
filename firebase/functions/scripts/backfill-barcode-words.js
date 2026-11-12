// ═══════════════════════════════════════════════════
// Completa el índice por palabras (campo "words") de los códigos que ya estaban en el catálogo compartido
// (ventra_barcodes), para que la búsqueda por nombre de las boletas (tanda 7.1) también los encuentre.
// Los códigos nuevos o confirmados de nuevo ya lo guardan solos (barcodes.js).
//
// ESCRIBE EN PRODUCCIÓN: sin --aplicar solo cuenta (no cambia nada). Correr solo con el OK del dueño.
//   cd firebase/functions
//   node scripts/backfill-barcode-words.js            (cuenta)
//   node scripts/backfill-barcode-words.js --aplicar  (escribe)
// ═══════════════════════════════════════════════════
const admin = require("firebase-admin");
const { indexKeys } = require("../barcodes");

(async () => {
  const apply = process.argv.includes("--aplicar");
  admin.initializeApp({ projectId: "ventra-9cba5" });
  const db = admin.firestore();
  let last = null, seen = 0, missing = 0, written = 0;
  for (;;) {
    let q = db.collection("ventra_barcodes").orderBy(admin.firestore.FieldPath.documentId()).limit(400);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    const batch = db.batch();
    for (const d of snap.docs) {
      seen++;
      const x = d.data();
      if (Array.isArray(x.words) && x.words.length) continue;
      if (!x.name) continue;
      missing++;
      if (apply) { batch.update(d.ref, { words: indexKeys(x.name) }); written++; }
    }
    if (apply) await batch.commit();
    last = snap.docs[snap.docs.length - 1];
  }
  console.log(`${seen} códigos, ${missing} sin índice${apply ? `, ${written} actualizados` : " (sin --aplicar no se cambió nada)"}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
