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
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const textClient = (text) => {
    const calls = [];
    return { calls, messages: { create: async (req) => { calls.push(req); return { stop_reason: "end_turn", content: [{ type: "text", text }], usage: { input_tokens: 10, output_tokens: 10 } }; } } };
  };
  await t("tope por día: al llegar no llama a la IA, aunque quede del mes", async () => {
    const db = fakeDb();
    db.docs[`${today}_u5`] = { help: ai.DAILY.help };
    const client = textClient("hola");
    await assert.rejects(() => ai.handle({ db, logger, client }, "u5", { kind: "help", messages: [{ role: "user", content: "¿cómo cierro la caja?" }] }), /tope de consultas a la ayuda de hoy/);
    assert.strictEqual(client.calls.length, 0);
  });
  await t("pregunta: cuenta una por pregunta (redactar no suma) y descarta consultas desconocidas", async () => {
    const db = fakeDb();
    db.docs[`${today}_u6`] = { ask: ai.DAILY.ask };
    await assert.rejects(() => ai.handle({ db, logger, client: fakeClient({ queries: [], noSePuede: "" }) }, "u6", { kind: "ask", question: "¿cuánto vendí?" }), /preguntas de hoy/);
    const db2 = fakeDb();
    const client = fakeClient({ queries: [{ tipo: "ventas", desde: "2026-10-01", hasta: "2026-10-23", agrupar: "ninguno", orden: "", buscar: "", limite: 0, dias: 0 }, { tipo: "borrar_todo", desde: "", hasta: "", agrupar: "", orden: "", buscar: "", limite: 0, dias: 0 }], noSePuede: "" });
    const out = await ai.handle({ db: db2, logger, client }, "u7", { kind: "ask", question: "¿cuánto vendí este mes?" });
    assert.deepStrictEqual(out.result.queries.map((q) => q.tipo), ["ventas"]);
    assert.ok(client.calls[0].system.includes(today), "le dice qué día es hoy");
    assert.strictEqual(out.leftToday, ai.DAILY.ask - 1);
    const answer = await ai.handle({ db: db2, logger, client: textClient("Vendiste **$ 100**.") }, "u7", { kind: "ask", step: "answer", question: "¿cuánto vendí?", data: [{ total: 100 }] });
    assert.strictEqual(answer.result.answer, "Vendiste **$ 100**.");
  });
  await t("lista de precios: el PDF largo va en partes y la IA solo empareja con ids del catálogo", async () => {
    const lines = Array.from({ length: 600 }, (_, i) => `${i} PRODUCTO ${i} $ ${100 + i},00`);
    const client = fakeClient({ priceIncludesIva: "no", items: [{ code: "1", barcode: "", name: "PRODUCTO", price: 100, packUnits: 0 }] });
    const out = await ai.handle({ db: fakeDb(), logger, client }, "u8", { kind: "pricelist", mode: "rows", lines });
    assert.strictEqual(client.calls.length, 3);
    assert.strictEqual(out.result.items.length, 3);
    assert.strictEqual(out.result.priceIncludesIva, "no");
    const match = fakeClient({ matches: [{ i: 0, productId: "coca", confianza: "alta" }, { i: 1, productId: "inventado", confianza: "alta" }] });
    const m = await ai.handle({ db: fakeDb(), logger, client: match }, "u8", { kind: "match", items: [{ name: "COCA 2.25" }, { name: "OTRA" }], catalog });
    assert.deepStrictEqual(m.result.matches.map((x) => x.productId), ["coca"]);
  });
  await t("ayuda: con la guía cacheada y la pantalla en la pregunta", async () => {
    const client = textClient("Tocá **F8**.");
    const out = await ai.handle({ db: fakeDb(), logger, client }, "u9", { kind: "help", screen: "/pos", messages: [{ role: "user", content: "¿cómo cierro la caja?" }] });
    assert.strictEqual(out.result.answer, "Tocá **F8**.");
    const req = client.calls[0];
    assert.ok(req.system[0].cache_control && req.system[0].text.includes("dónde está cada cosa"));
    assert.ok(req.messages[0].content.startsWith("[Pantalla: /pos]"));
  });
  await t("rubros de GO: solo de la lista, uno por producto y los que faltan van a Varios", async () => {
    // La IA numera cada tanda desde 0 (sin el nombre vacío): 0 = QUILMES, 1 = ALF JORGITO, 2 = COSA RARA
    const client = fakeClient({ items: [{ i: 0, producto: "cerveza en lata", rubro: "Cervezas › Latas" }, { i: 1, producto: "alfajor", rubro: "Golosinas › Alfajores" }] });
    const out = await ai.handle({ db: fakeDb(), logger, client }, "u10", { kind: "gocats", names: ["QUILMES LATA 473", "", "ALF JORGITO CHOC", "COSA RARA"] });
    assert.deepStrictEqual(out.result.items, [
      { i: 0, rubro: "Cervezas › Latas" }, { i: 2, rubro: "Golosinas › Alfajores" }, { i: 3, rubro: "Librería y varios › Varios" },
    ]);
    const enumList = client.calls[0].output_config.format.schema.properties.items.items.properties.rubro.enum;
    assert.ok(enumList.includes("Cervezas › Packs") && enumList.length === ai.GO_CATEGORIES.length, "la IA no puede inventar rubros");
    await assert.rejects(() => ai.handle({ db: fakeDb(), logger, client }, "u10", { kind: "gocats", names: [] }), /No hay productos/);
  });
  console.log(`\n${ok} bien, ${bad} con falla`);
  process.exit(bad ? 1 : 0);
})();
