// Fotos de la caja (catálogo PDF) compartidas en el catálogo de códigos (functions/barcodes.js share).
//   node firebase/test/barcodes-share.test.cjs
const assert = require("assert");
const barcodes = require("../functions/barcodes");
const { fakeDb } = require("./fake-firestore.cjs");

let ok = 0, bad = 0;
const t = async (name, fn) => {
  try { await fn(); ok++; console.log(`ok    ${name}`); } catch (e) { bad++; console.log(`FALLA ${name}\n      ${e.stack.split("\n").slice(0, 3).join("\n      ")}`); }
};
const fakeBucket = () => {
  const files = {};
  return { name: "ventra-test.appspot.com", files, file: (path) => ({ save: async (buf, opts) => { files[path] = { buf, opts }; } }) };
};
const jpeg = (bytes = 10) => `data:image/jpeg;base64,${Buffer.alloc(bytes, 7).toString("base64")}`;
const EAN = "7790070012050";

(async () => {
  await t("guarda la foto y vota con su enlace de descarga", async () => {
    const data = {}; const db = fakeDb(data); const bucket = fakeBucket();
    const r = await barcodes.share(db, bucket, "limp1", [{ barcode: EAN, name: "Lavandina 1 L", dataUrl: jpeg() }]);
    assert.strictEqual(r.saved, 1);
    const path = barcodes.sharePath(EAN, "limp1");
    assert.ok(bucket.files[path], "subió la foto");
    const token = bucket.files[path].opts.metadata.metadata.firebaseStorageDownloadTokens;
    const doc = data.ventra_barcodes[EAN];
    assert.strictEqual(doc.imageUrl, `https://firebasestorage.googleapis.com/v0/b/ventra-test.appspot.com/o/${encodeURIComponent(path)}?alt=media&token=${token}`);
    assert.strictEqual(doc.name, "Lavandina 1 L");
    assert.strictEqual(doc.votes, 1);
  });

  await t("con un solo comercio queda con 1 voto (opción); con dos, 2 votos", async () => {
    const data = {}; const db = fakeDb(data); const bucket = fakeBucket();
    await barcodes.share(db, bucket, "limp1", [{ barcode: EAN, name: "Lavandina", dataUrl: jpeg() }]);
    await barcodes.confirm(db, "otro", [{ barcode: EAN, name: "Lavandina", imageUrl: data.ventra_barcodes[EAN].imageUrl }]);
    assert.strictEqual(data.ventra_barcodes[EAN].votes, 2);
  });

  await t("ignora códigos internos, fotos que no son imagen y fotos enormes", async () => {
    const data = {}; const db = fakeDb(data); const bucket = fakeBucket();
    const r = await barcodes.share(db, bucket, "limp1", [
      { barcode: "A-123", dataUrl: jpeg() },
      { barcode: EAN, dataUrl: "data:text/html;base64,PGI+" },
      { barcode: "7790070012051", dataUrl: jpeg(500 * 1024) },
    ]);
    assert.strictEqual(r.saved, 0);
    assert.deepStrictEqual(Object.keys(bucket.files), []);
  });

  await t("de a 10 por llamada como máximo", async () => {
    const db = fakeDb({}); const bucket = fakeBucket();
    const items = Array.from({ length: 15 }, (_, i) => ({ barcode: String(77900700120 + i).padStart(13, "0"), dataUrl: jpeg() }));
    const r = await barcodes.share(db, bucket, "limp1", items);
    assert.strictEqual(r.saved, 10);
  });

  console.log(`\n${ok} bien, ${bad} mal`);
  process.exit(bad ? 1 : 0);
})();
