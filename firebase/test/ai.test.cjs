// IA de los comercios (functions/ai.js) con un Claude falso: el catálogo manda, el tope se respeta.
//   node firebase/test/ai.test.cjs
const assert = require("assert");
const ai = require("../functions/ai");

const fakeDb = () => {
  const docs = {};
  return {
    docs,
    collection: () => ({ doc: (id) => ({
      get: async () => ({ exists: !!docs[id], data: () => docs[id] || {} }),
      set: async (v) => { const cur = docs[id] || {}; for (const [k, x] of Object.entries(v)) cur[k] = x && x.operand !== undefined ? (cur[k] || 0) + x.operand : x; docs[id] = cur; },
    }) }),
  };
};
// FieldValue.increment de firebase-admin sin inicializar: se simula
const admin = require("../functions/node_modules/firebase-admin");
admin.firestore.FieldValue.increment = (n) => ({ operand: n });
admin.firestore.FieldValue.serverTimestamp = () => "ts";

const fakeClient = (answer, stop = "end_turn") => {
  const calls = [];
  const msg = () => ({ stop_reason: stop, content: [{ type: "text", text: JSON.stringify(answer) }], usage: { input_tokens: 1000, output_tokens: 200 } });
  return { calls, messages: { create: async (req) => { calls.push(req); return msg(); }, stream: (req) => { calls.push(req); return { finalMessage: async () => msg() }; } } };
};
const logger = { warn() {}, error() {} };
const catalog = [{ id: "coca", name: "COCA-COLA 2,25 L", pack: 6 }, { id: "fideos", name: "FIDEOS SPAGHETTI 500 G", pack: 20 }];

let ok = 0, bad = 0;
const t = async (name, fn) => { try { await fn(); ok++; console.log(`ok    ${name}`); } catch (e) { bad++; console.log(`FALLA ${name}\n      ${e.stack || e.message}`); } };

(async () => {
  await t("pedido: los ids que no son del catálogo quedan como no encontrados", async () => {
    const client = fakeClient({ cliente: "Don Tito", aclaracion: "", items: [
      { productId: "coca", pedido: "3 cajas de coca", cantidad: 3, unidad: "bulto", confianza: "alta", nota: "" },
      { productId: "inventado", pedido: "2 de lavandina", cantidad: 2, unidad: "unidad", confianza: "alta", nota: "" },
      { productId: "", pedido: "lo de siempre", cantidad: 1, unidad: "unidad", confianza: "baja", nota: "no se sabe" },
    ] });
    const out = await ai.handle({ db: fakeDb(), logger, client }, "u1", { kind: "order", text: "3 cajas de coca y 2 lavandinas", catalog });
    assert.strictEqual(out.result.items[0].productId, "coca");
    assert.strictEqual(out.result.items[1].productId, null);
    assert.strictEqual(out.result.items[1].confianza, "baja");
    assert.strictEqual(out.result.items[2].productId, null);
    // El catálogo va con bultos y cacheado, antes del mensaje
    const content = client.calls[0].messages[0].content;
    assert.ok(content[0].text.includes('"bulto": 6') && content[0].cache_control);
    assert.strictEqual(client.calls[0].output_config.format.type, "json_schema");
  });
  await t("pedido vacío o sin catálogo: error claro, no cuenta", async () => {
    const db = fakeDb();
    await assert.rejects(() => ai.handle({ db, logger, client: fakeClient({}) }, "u1", { kind: "order", text: " ", catalog }), /Pegá el mensaje/);
    await assert.rejects(() => ai.handle({ db, logger, client: fakeClient({}) }, "u1", { kind: "order", text: "hola", catalog: [] }), /No hay productos/);
    assert.deepStrictEqual(Object.keys(db.docs), []);
  });
  await t("tope por mes: al llegar al límite no llama a la IA", async () => {
    const db = fakeDb();
    const month = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).slice(0, 7);
    db.docs[`${month}_u2`] = { invoice: ai.LIMITS.invoice };
    const client = fakeClient({ items: [] });
    await assert.rejects(() => ai.handle({ db, logger, client }, "u2", { kind: "invoice", images: [{ mediaType: "image/jpeg", data: "abc" }] }), /Llegaste a las 60 facturas/);
    assert.strictEqual(client.calls.length, 0);
  });
  await t("factura: cuenta el uso y el costo solo si salió bien", async () => {
    const db = fakeDb();
    const client = fakeClient({ rawTableTranscription: "", supplierName: "Prov", invoiceNumber: "A-1", date: "2026-10-23", totalFacturaAPagar: "100", items: [{ sku: "", barcode: "", name: "Fideos", packageQuantity: 1, unitsPerPack: 20, total: "100" }] });
    const out = await ai.handle({ db, logger, client }, "u3", { kind: "invoice", images: [{ mediaType: "image/jpeg", data: "abc" }], manualTotal: 121 });
    assert.strictEqual(out.result.items.length, 1);
    assert.strictEqual(out.left, ai.LIMITS.invoice - 1);
    const doc = Object.values(db.docs)[0];
    assert.strictEqual(doc.invoice, 1);
    assert.ok(doc.costUsd > 0);
    assert.ok(client.calls[0].messages[0].content.at(-1).text.includes("121"), "ancla el total");
  });
  await t("la IA se niega: error para cargarlo a mano, no cuenta", async () => {
    const db = fakeDb();
    await assert.rejects(() => ai.handle({ db, logger, client: fakeClient({}, "refusal") }, "u4", { kind: "order", text: "pedido", catalog }), /Cargalo a mano/);
    assert.deepStrictEqual(Object.keys(db.docs), []);
  });
  await t("fotos: solo imágenes y no muy pesadas", async () => {
    assert.throws(() => ai.imageBlocks([{ mediaType: "application/pdf", data: "x" }]), /JPG, PNG/);
    assert.throws(() => ai.imageBlocks([{ mediaType: "image/jpeg", data: "x".repeat(8_000_000) }]), /muy pesada/);
    assert.strictEqual(ai.imageBlocks([{ mediaType: "image/png", data: "data:image/png;base64,QUJD" }])[0].source.data, "QUJD");
  });
  console.log(`\n${ok} bien, ${bad} con falla`);
  process.exit(bad ? 1 : 0);
})();
