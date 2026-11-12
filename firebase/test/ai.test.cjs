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
  await t("factura: la IA sabe que el código del mayorista (ARTICULO de Nini) va en sku, no en barcode", async () => {
    const client = fakeClient({ rawTableTranscription: "", supplierName: "Prov", invoiceNumber: "A-1", date: "2026-10-23", totalFacturaAPagar: "100", items: [] });
    await ai.handle({ db: fakeDb(), logger, client }, "u9", { kind: "invoice", images: [{ mediaType: "image/jpeg", data: "abc" }] }).catch(() => {});
    const system = JSON.stringify(client.calls[0].system);
    assert.ok(/ARTICULO/.test(system) && /1000014274/.test(system) && /nunca en \\"barcode\\"/.test(system), "regla del código interno en el prompt");
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
  // ── Varias fotos: comprobantes distintos (datos inventados, con la forma de boletas reales) ──
  const read = (o) => ({ rawTableTranscription: "", supplierName: "", supplierCuit: "", invoiceNumber: "", date: "2026-11-11", totalFacturaAPagar: "", subtotalNeto: "", docType: "factura", pageNumber: 0, pageCount: 0, items: [], ...o });
  const it = (name, qty, total) => ({ sku: "", barcode: "", name, packageQuantity: qty, unitsPerPack: 1, total });
  const pics = (n) => Array.from({ length: n }, (_, i) => ({ data: `FOTO${i}`, mediaType: "image/jpeg" }));
  // Cliente falso que contesta según la foto (y según el modelo, para la relectura)
  const byPhoto = (answers, strong = {}) => {
    const calls = [];
    const pick = (req) => {
      const imgs = req.messages[0].content.filter((b) => b.type === "image").map((b) => b.source.data);
      const key = imgs.join("+");
      return req.model.includes("sonnet") && strong[key] ? strong[key] : answers[key];
    };
    const msg = (req) => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(pick(req)) }], usage: { input_tokens: 1000, output_tokens: 200 } });
    return { calls, messages: { stream: (req) => { calls.push(req); return { finalMessage: async () => msg(req) }; } } };
  };
  await t("4 fotos de 4 comprobantes distintos: devuelve 4, cada uno con su foto, y cuenta 4 facturas", async () => {
    const client = byPhoto({
      FOTO0: read({ supplierName: "BEBIDAS DEL NORTE SA", supplierCuit: "30-11111111-1", invoiceNumber: "0001-00000100", subtotalNeto: "1.200,00", totalFacturaAPagar: "1.452,00",
        items: [it("GASEOSA 2500*8", 3, "900,00"), it("VASO PROMO X12", 1, "300,00")] }),
      FOTO1: read({ supplierName: "BEBIDAS DEL NORTE SA", supplierCuit: "30-11111111-1", invoiceNumber: "0002-00000555", docType: "remito", totalFacturaAPagar: "0,00", items: [it("ENERGIZANTE 473*6", 1, "4.132,76")] }),
      FOTO2: read({ supplierName: "BEBIDAS DEL NORTE SA", supplierCuit: "30-11111111-1", invoiceNumber: "0001-00000101", totalFacturaAPagar: "2.000,00", items: [it("GASEOSA 600*12", 2, "1.000,00"), it("GASEOSA 1500*8", 1, "1.000,00")] }),
      FOTO3: read({ supplierName: "PANIFICADORA SUR", invoiceNumber: "0002-00019258", docType: "nota", totalFacturaAPagar: "22.560,00", items: [it("PAN VIENA X6", 4, "5.360,00"), it("PAN LACTAL X350", 8, "17.200,00")] }),
    });
    const db = fakeDb();
    const out = await ai.handle({ db, logger, client }, "u9", { kind: "invoice", multi: true, images: pics(4) });
    const docs = out.result.documents;
    assert.strictEqual(docs.length, 4);
    assert.deepStrictEqual(docs.map((d) => d.images), [[0], [1], [2], [3]]);
    assert.deepStrictEqual(docs.map((d) => d.docType), ["factura", "remito", "factura", "nota"]);
    assert.strictEqual(docs[0].items.length + docs[2].items.length + docs[3].items.length, 6, "no se pierde ningún renglón");
    assert.deepStrictEqual(docs.map((d) => d.closes), [true, null, true, true], "remito en $0: no hay con qué comparar");
    assert.strictEqual(client.calls.length, 5, "una lectura por foto, y el remito (sin total para comparar) dos veces");
    assert.deepStrictEqual(docs.map((d) => d.verified), ["total", "hojas", "total", "total"], "el remito se verifica con dos lecturas que coinciden");
    assert.ok(client.calls.every((c) => c.model === "claude-haiku-5-5"));
    assert.strictEqual(db.docs[Object.keys(db.docs).find((k) => /_u9$/.test(k))].invoice, 4, "cuenta uno por comprobante");
  });
  await t("dos fotos de la misma factura (páginas 1 y 2): un solo comprobante con los renglones de las dos", async () => {
    const client = byPhoto({
      FOTO0: read({ supplierName: "MAYORISTA X", invoiceNumber: "0003-00000777", pageNumber: 1, pageCount: 2, items: [it("ARROZ 1KG", 10, "10.000,00")] }),
      FOTO1: read({ supplierName: "MAYORISTA X", invoiceNumber: "", pageNumber: 2, pageCount: 2, subtotalNeto: "15.000,00", totalFacturaAPagar: "18.150,00", items: [it("FIDEOS 500G", 10, "5.000,00")] }),
    });
    const out = await ai.handle({ db: fakeDb(), logger, client }, "u8", { kind: "invoice", multi: true, images: pics(2) });
    const [d] = out.result.documents;
    assert.strictEqual(out.result.documents.length, 1);
    assert.deepStrictEqual(d.images, [0, 1]);
    assert.strictEqual(d.items.length, 2);
    assert.strictEqual(d.totalFacturaAPagar, "18.150,00", "el total de la última página");
    assert.strictEqual(d.closes, true);
  });
  await t("no cierra: se relee solo ese comprobante con el modelo fuerte y se queda con la lectura que cierra", async () => {
    const mal = read({ supplierName: "DISTRI", invoiceNumber: "0001-00000009", totalFacturaAPagar: "12.100,00", items: [it("YERBA 1KG", 5, "5.000,00")] });
    const bien = read({ supplierName: "DISTRI", invoiceNumber: "0001-00000009", totalFacturaAPagar: "12.100,00", items: [it("YERBA 1KG", 5, "5.000,00"), it("AZUCAR 1KG", 10, "5.000,00")] });
    const otra = read({ supplierName: "OTRO", invoiceNumber: "0001-00000010", totalFacturaAPagar: "1.210,00", items: [it("SAL", 1, "1.000,00")] });
    const client = byPhoto({ FOTO0: mal, FOTO1: otra }, { FOTO0: bien });
    const out = await ai.handle({ db: fakeDb(), logger, client }, "u7", { kind: "invoice", multi: true, images: pics(2) });
    const [d, e] = out.result.documents;
    assert.strictEqual(d.items.length, 2);
    assert.strictEqual(d.closes, true);
    assert.strictEqual(d.reread, true);
    assert.ok(!e.reread, "el que cerraba no se relee");
    assert.strictEqual(client.calls.filter((c) => c.model.includes("sonnet")).length, 1);
    assert.match(client.calls.find((c) => c.model.includes("sonnet")).messages[0].content.at(-1).text, /sumaron 5000/);
  });
  await t("una foto que no se puede leer no tira abajo las demás", async () => {
    const client = byPhoto({ FOTO0: read({ invoiceNumber: "0001-00000001", totalFacturaAPagar: "1.210,00", items: [it("SAL", 1, "1.000,00")] }), FOTO1: read({ items: [] }) });
    const out = await ai.handle({ db: fakeDb(), logger, client }, "u6", { kind: "invoice", multi: true, images: pics(2) });
    assert.strictEqual(out.result.documents.length, 1);
    assert.deepStrictEqual(out.result.failedImages, [1]);
  });
  await t("sin multi (PCs con la versión vieja): sigue siendo una sola lectura con todas las fotos", async () => {
    const client = fakeClient(read({ items: [it("SAL", 1, "1.000,00")] }));
    const out = await ai.handle({ db: fakeDb(), logger, client }, "u5", { kind: "invoice", images: pics(3) });
    assert.strictEqual(client.calls.length, 1);
    assert.strictEqual(client.calls[0].messages[0].content.filter((b) => b.type === "image").length, 3);
    assert.ok(Array.isArray(out.result.items) && !out.result.documents);
  });

  await t("hojas del mismo comprobante con el proveedor escrito distinto: se juntan; faltan hojas: no se controla el total", async () => {
    const lines = (n, p) => Array.from({ length: n }, (_, i) => ({ ...it(`PROD ${p}-${i}`, 1, "100,00"), unitPrice: "100,00" }));
    const client = byPhoto({
      FOTO0: read({ supplierName: "RICARDO NINI S.A.", supplierCuit: "", invoiceNumber: "1124-00000250", pageNumber: 1, pageCount: 6, items: lines(28, 1) }),
      FOTO1: read({ supplierName: "Ricardo Nini S.A.", supplierCuit: "30-99999999-9", invoiceNumber: "1124-00000250", pageNumber: 2, pageCount: 6, items: lines(27, 2) }),
      FOTO2: read({ supplierName: "OTRO PROVEEDOR", invoiceNumber: "1124-00000250", items: [{ ...it("X", 1, "50,00"), unitPrice: "50,00" }], totalFacturaAPagar: "60,50" }),
    });
    const out = await ai.handle({ db: fakeDb(), logger, client }, "u4", { kind: "invoice", multi: true, images: pics(3) });
    const [nini, otro] = out.result.documents;
    assert.strictEqual(out.result.documents.length, 2, "mismo número pero otro proveedor: aparte");
    assert.deepStrictEqual(nini.images, [0, 1]);
    assert.strictEqual(nini.items.length, 55);
    assert.strictEqual(nini.missingPages, 4);
    assert.strictEqual(nini.closes, null, "faltan hojas: no se puede saber si cierra");
    assert.strictEqual(otro.items.length, 1);
  });
  await t("una relectura que pierde renglones no se acepta (aunque no tenga renglones mal)", async () => {
    const good = Array.from({ length: 21 }, (_, i) => ({ ...it(`P${i}`, 1, "100,00"), unitPrice: "100,00" }));
    const first = read({ invoiceNumber: "1", pageNumber: 3, pageCount: 6, items: [...good.slice(0, 20), { ...it("MAL", 2, "100,00"), unitPrice: "100,00" }] });
    const strong = read({ invoiceNumber: "1", pageNumber: 3, pageCount: 6, items: good.slice(0, 10) });
    const client = byPhoto({ FOTO0: first }, { FOTO0: strong });
    const out = await ai.handle({ db: fakeDb(), logger, client }, "u3", { kind: "invoice", multi: true, images: pics(1) });
    const [d] = out.result.documents;
    assert.strictEqual(client.calls.filter((c) => c.model.includes("sonnet")).length, 1, "se releyó");
    assert.strictEqual(d.items.length, 21, "se queda con la que tiene todos los renglones");
    assert.strictEqual(d.badLines, 1, "y el renglón que no cierra queda marcado");
  });
  await t("control de cada renglón: cantidad × precio = total (también por unidad dentro del bulto)", async () => {
    assert.strictEqual(ai.lineOk({ packageQuantity: 6, unitPrice: "1.900,00", total: "11.400,00" }), true);
    assert.strictEqual(ai.lineOk({ packageQuantity: 1, unitsPerPack: 6, unitPrice: "1.245,69", total: "7.474,14" }), true);
    assert.strictEqual(ai.lineOk({ packageQuantity: 3, unitPrice: "17.813,42", total: "35.626,84" }), false, "3 piezas pero se cobra por 2 kg");
    assert.strictEqual(ai.lineOk({ packageQuantity: 2, unitPrice: "", total: "100" }), null);
  });

  await t("hoja sin total y dos lecturas distintas (fila corrida): decide el modelo fuerte; si no coincide con ninguna, queda marcada", async () => {
    const L = (name, q, p) => ({ ...it(name, q, `${q * p}`), unitPrice: `${p}` });
    const bien = read({ invoiceNumber: "", items: [L("ANDES RUBIA", 3, 43500), L("ANDES IPA", 3, 43500), L("PORRON", 2, 28000)] });
    const corrida = read({ invoiceNumber: "", items: [L("ANDES RUBIA", 3, 43500), L("ANDES IPA", 2, 28000)] }); // se perdió una fila
    const otra = read({ invoiceNumber: "", items: [L("ANDES RUBIA", 3, 43500), L("ANDES IPA", 3, 43500), L("PORRON", 2, 28000), L("EXTRA", 1, 5)] });
    const mk = (seq) => {
      const calls = []; let n = 0;
      return { calls, messages: { stream: (req) => { calls.push(req); const ans = req.model.includes("opus") ? (seq.top || seq.strong) : req.model.includes("sonnet") ? seq.strong : (n++ === 0 ? seq.a : seq.b); return { finalMessage: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(ans) }], usage: { input_tokens: 10, output_tokens: 10 } }) }; } } };
    };
    // El fuerte coincide con una de las dos: verificada por tres lecturas
    let client = mk({ a: corrida, b: bien, strong: bien });
    let out = await ai.handle({ db: fakeDb(), logger, client }, "u2", { kind: "invoice", multi: true, images: pics(1) });
    let [d] = out.result.documents;
    assert.strictEqual(d.items.length, 3);
    assert.strictEqual(d.verified, "hojas");
    assert.match(client.calls.at(-1).messages[0].content.at(-1).text, /no coinciden.*desalineados/s);
    assert.ok(!client.calls.some((c) => c.model.includes("opus")), "si Sonnet coincide, Opus no se llama");
    // Sonnet no coincide con ninguna: decide Opus; si coincide con alguna, queda verificada
    client = mk({ a: corrida, b: bien, strong: otra, top: bien });
    out = await ai.handle({ db: fakeDb(), logger, client }, "u2c", { kind: "invoice", multi: true, images: pics(1) });
    [d] = out.result.documents;
    assert.strictEqual(client.calls.at(-1).model, "claude-opus-5-5");
    assert.strictEqual(d.items.length, 3);
    assert.strictEqual(d.verified, "hojas");
    // Opus tampoco coincide: se usa la de Opus y lo distinto queda en duda
    const otraMas = read({ invoiceNumber: "", items: [L("ANDES RUBIA", 3, 43500), L("ANDES IPA", 3, 43500), L("PORRON", 2, 28000), L("EXTRA", 1, 7)] });
    client = mk({ a: corrida, b: bien, strong: otra, top: otraMas });
    out = await ai.handle({ db: fakeDb(), logger, client }, "u2b", { kind: "invoice", multi: true, images: pics(1) });
    [d] = out.result.documents;
    assert.strictEqual(d.verified, "no");
    assert.ok(d.unsureLines.includes("EXTRA"), d.unsureLines.join(","));
    assert.ok(d.items.find((x) => x.name === "EXTRA").unsure);
  });

  await t("no cierra con Haiku ni con Sonnet: relee Opus y se queda con la que cierra", async () => {
    const L = (name, q, p) => ({ ...it(name, q, `${q * p}`), unitPrice: `${p}` });
    const total = `${3 * 43500 + 2 * 28000}`;
    const mal = read({ totalFacturaAPagar: total, items: [L("ANDES RUBIA", 3, 43500)] });
    const bien = read({ totalFacturaAPagar: total, items: [L("ANDES RUBIA", 3, 43500), L("PORRON", 2, 28000)] });
    const calls = [];
    const client = { messages: { stream: (req) => { calls.push(req); const ans = req.model.includes("opus") ? bien : mal;
      return { finalMessage: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(ans) }], usage: { input_tokens: 4000, output_tokens: 4500 } }) }; } } };
    const db = fakeDb();
    const out = await ai.handle({ db, logger, client }, "u-opus", { kind: "invoice", stage: "page", image: pics(1)[0] });
    assert.deepStrictEqual(calls.map((c) => c.model), ["claude-haiku-5-5", "claude-sonnet-5-5", "claude-opus-5-5"]);
    assert.strictEqual(out.result.read.items.length, 2);
    assert.strictEqual(out.result.read.verified, "total");
    const cost = (4000 * 0.1 + 4500 * 0.5 + 4000 * 2 + 4500 * 10 + 4000 * 4 + 4500 * 20) / 1e6;
    const doc = Object.values(db.docs).find((x) => x.costUsd !== undefined);
    assert.ok(Math.abs(doc.costUsd - cost) < 1e-9, `${doc.costUsd} ≠ ${cost}`);
  });

  await t("cuenta del dueño de Ventra (unlimited): pasa los topes del día y del mes, y el uso se anota igual", async () => {
    const db = fakeDb();
    const month = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).slice(0, 7);
    const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
    db.docs[`${month}_dueno`] = { invoice: ai.LIMITS.invoice, invoicePages: 9999 };
    db.docs[`${day}_dueno`] = { invoice: ai.DAILY.invoice, invoicePages: 9999 };
    const client = fakeClient(read({ totalFacturaAPagar: "100", items: [it("Fideos", 1, "100")] }));
    const out = await ai.handle({ db, logger, client, unlimited: true }, "dueno", { kind: "invoice", stage: "page", image: pics(1)[0] });
    assert.ok(out.result.read.items.length);
    assert.strictEqual(out.leftToday, 9999);
    assert.strictEqual(db.docs[`${month}_dueno`].invoicePages, 10000);
    // Otro comercio con lo mismo usado sigue frenado
    db.docs[`${month}_otro`] = { invoice: 0 }; db.docs[`${day}_otro`] = { invoice: ai.DAILY.invoice };
    await assert.rejects(() => ai.handle({ db, logger, client }, "otro", { kind: "invoice", stage: "page", image: pics(1)[0] }), /tope de facturas leídas con IA de hoy/);
  });

  await t("costo: cada lectura se cobra con el precio de su modelo (la relectura de Sonnet no se anota como Haiku)", async () => {
    const L = (name, q, p) => ({ ...it(name, q, `${q * p}`), unitPrice: `${p}` });
    const noCierra = read({ totalFacturaAPagar: "999999", items: [L("ANDES RUBIA", 3, 43500), L("PORRON", 2, 28000)] });
    const cierra = read({ totalFacturaAPagar: `${3 * 43500 + 2 * 28000}`, items: [L("ANDES RUBIA", 3, 43500), L("PORRON", 2, 28000)] });
    const calls = [];
    const client = { messages: { stream: (req) => { calls.push(req); const strong = req.model.includes("sonnet");
      return { finalMessage: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(strong ? cierra : noCierra) }], usage: { input_tokens: 4000, output_tokens: 4500 } }) }; } } };
    const db = fakeDb();
    await ai.handle({ db, logger, client }, "u-costo", { kind: "invoice", stage: "page", image: pics(1)[0] });
    assert.deepStrictEqual(calls.map((c) => c.model), ["claude-haiku-5-5", "claude-sonnet-5-5"]);
    const haiku = (4000 * 0.1 + 4500 * 0.5) / 1e6, sonnet = (4000 * 2 + 4500 * 10) / 1e6;
    const doc = Object.values(db.docs).find((x) => x.costUsd !== undefined);
    assert.ok(Math.abs(doc.costUsd - (haiku + sonnet)) < 1e-9, `${doc.costUsd} ≠ ${haiku + sonnet}`);
  });

  // ── Boletas reales del 2026-11-12 (datos con la misma forma, nombres inventados) ──
  await t("una hoja sin 'hoja X de N' que tomó el número de la factura de atrás va aparte, y el total de esa hoja no es de la factura", async () => {
    const nini = (n, items) => read({ supplierName: "MAYORISTA NORTE SA", invoiceNumber: "1124-00000250", pageNumber: n, pageCount: 6, items });
    const reads = [
      { image: 0, ...nini(1, [it("A", 1, "100,00")]) },
      { image: 1, ...nini(2, [it("B", 1, "200,00")]) },
      // La lista de cervezas: atrás asomaba la factura, tomó su número y trae su propio total
      { image: 2, ...read({ supplierName: "MAYORISTA NORTE SA", invoiceNumber: "1124-00000250", totalFacturaAPagar: "2.793.498,08", items: [it("CERVEZA X24", 5, "214.500,00")] }) },
      { image: 3, ...nini(3, [it("C", 1, "300,00")]) },
    ];
    const docs = ai.groupInvoicePages(reads);
    assert.strictEqual(docs.length, 2);
    const [f, lista] = docs;
    assert.deepStrictEqual(f.images, [0, 1, 3]);
    assert.deepStrictEqual(f.missingPageNumbers, [4, 5, 6]);
    assert.strictEqual(f.missingPages, 3);
    assert.strictEqual(f.totalFacturaAPagar, "", "sin la última hoja no hay total");
    assert.deepStrictEqual(lista.images, [2]);
    assert.strictEqual(lista.invoiceNumber, "", "el número era de la factura de atrás");
    assert.strictEqual(lista.strayNumber, "1124-00000250");
    assert.strictEqual(lista.totalFacturaAPagar, "2.793.498,08");
  });
  await t("una hoja movida del mismo proveedor donde no se lee 'hoja 2 de 6' se queda en la factura: faltan 3, sin decir cuáles", async () => {
    const nini = (n, items, extra = {}) => read({ supplierName: "MAYORISTA NORTE SA", invoiceNumber: "1124-00000250", pageNumber: n, pageCount: n ? 6 : 0, items, ...extra });
    const reads = [
      { image: 0, ...nini(1, [it("A", 1, "100,00")]) },
      { image: 1, ...nini(0, [it("B", 1, "200,00")], { supplierName: "Mayorista Norte S.A." }) },
      { image: 2, ...nini(3, [it("C", 1, "300,00")]) },
    ];
    const docs = ai.groupInvoicePages(reads);
    assert.strictEqual(docs.length, 1);
    const [f] = docs;
    assert.deepStrictEqual(f.images, [0, 2, 1], "la hoja sin número va al final");
    assert.strictEqual(f.strayNumber, "");
    assert.strictEqual(f.unnumberedPages, 1);
    assert.strictEqual(f.missingPages, 3);
    assert.deepStrictEqual(f.missingPageNumbers, [], "no se sabe cuáles faltan");
    assert.strictEqual(f.totalFacturaAPagar, "", "sin la última hoja no hay total");
  });
  await t("descuento del pie olvidado: ya no 'cierra' por las percepciones; con el descuento como renglón negativo, sí", async () => {
    const base = { supplierName: "SUPERMAYORISTA", invoiceNumber: "00984-00010043", ivaTotal: "12.047,22", otrosImpuestos: "4015.75", totalFacturaAPagar: "73.430,67" };
    const lines = [it("DURAZNO", 6, "11.400,00"), it("JABON LIQ", 4, "10.905,80"), it("LUSTRAMUEBLES", 3, "12.979,35"), it("PAPEL ALUMINIO", 4, "9.451,24"),
      it("PROT COLALESS", 10, "8.917,40"), it("PROT MULTI", 6, "4.953,72"), it("TOA NOCTURNA", 3, "2.342,97")];
    assert.strictEqual(ai.invoiceCloses({ ...base, items: lines }), false, "sin el descuento de 3.582,77 no tiene que cerrar");
    assert.strictEqual(ai.invoiceCloses({ ...base, items: [...lines, it("LIMPIEZA DEL HOGAR 15%", 1, "-1.635,87"), it("LIMPIEZA DEL HOGAR 15%", 1, "-1.946,90")] }), true);
    // Renglones con IVA e impuestos internos adentro (bebidas): cierra contra el total aunque haya subtotal neto
    assert.strictEqual(ai.invoiceCloses({ subtotalNeto: "16.528,93", totalFacturaAPagar: "20.000,00", items: [it("GASEOSA", 8, "20.000,00")] }), true);
  });
  await t("de a una foto: 'page' no cuenta facturas (sí la hoja) y 'group' cuenta una por comprobante, sin IA", async () => {
    const client = byPhoto({
      FOTO0: read({ supplierName: "BAMBU SRL", invoiceNumber: "0004-00180153", subtotalNeto: "300,00", totalFacturaAPagar: "363,00", fotoLegible: "si", items: [it("QUESO", 1, "100,00"), it("SALAME", 1, "200,00")] }),
      FOTO1: read({ supplierName: "OTRO SA", invoiceNumber: "0001-00000009", totalFacturaAPagar: "121,00", fotoLegible: "en partes", problemaFoto: "la parte de abajo está movida", items: [it("PAN", 1, "100,00")] }),
    });
    const db = fakeDb();
    const p0 = await ai.handle({ db, logger, client }, "u7", { kind: "invoice", stage: "page", image: { data: "FOTO0", mediaType: "image/jpeg" }, index: 0 });
    const p1 = await ai.handle({ db, logger, client }, "u7", { kind: "invoice", stage: "page", image: { data: "FOTO1", mediaType: "image/jpeg" }, index: 1 });
    assert.strictEqual(p0.result.read.verified, "total");
    assert.strictEqual(p1.result.read.image, 1);
    assert.strictEqual(p1.result.read.photoIssue, "la parte de abajo está movida");
    const month = () => db.docs[Object.keys(db.docs).find((k) => /^\d{4}-\d{2}_u7$/.test(k))];
    assert.strictEqual(month().invoice, 0, "leer hojas no gasta facturas");
    assert.strictEqual(month().invoicePages, 2);
    const calls = client.calls.length;
    const g = await ai.handle({ db, logger, client }, "u7", { kind: "invoice", stage: "group", reads: [p0.result.read, p1.result.read] });
    assert.strictEqual(client.calls.length, calls, "juntar no llama a la IA");
    assert.strictEqual(g.result.documents.length, 2);
    assert.deepStrictEqual(g.result.documents[1].photoIssues, [{ image: 1, issue: "la parte de abajo está movida" }]);
    assert.strictEqual(month().invoice, 2);
    assert.strictEqual(g.left, ai.LIMITS.invoice - 2);
  });
  await t("una foto ilegible no se inventa: vuelve el motivo para pedir otra", async () => {
    const client = byPhoto({ FOTO0: read({ fotoLegible: "no", problemaFoto: "está muy oscura", items: [it("???", 1, "10,00")] }) });
    const p = await ai.handle({ db: fakeDb(), logger, client }, "u8", { kind: "invoice", stage: "page", image: { data: "FOTO0", mediaType: "image/jpeg" }, index: 0 });
    assert.strictEqual(p.result.read.unreadable, true);
    assert.strictEqual(p.result.read.error, "está muy oscura");
    await assert.rejects(() => ai.handle({ db: fakeDb(), logger, client }, "u8", { kind: "invoice", stage: "group", reads: [p.result.read] }), /está muy oscura/);
  });
  await t("con el mes agotado no se lee ninguna hoja más", async () => {
    const db = fakeDb();
    const client = byPhoto({ FOTO0: read({ items: [it("X", 1, "1,00")] }) });
    const k = new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).slice(0, 7);
    db.docs[`${k}_u6`] = { invoice: ai.LIMITS.invoice };
    await assert.rejects(() => ai.handle({ db, logger, client }, "u6", { kind: "invoice", stage: "page", image: { data: "FOTO0", mediaType: "image/jpeg" } }), /facturas leídas/);
    assert.strictEqual(client.calls.length, 0);
  });

  await t("memoria por proveedor: aprende de las correcciones, la usa ese comercio y, confirmada por otro, todos", async () => {
    const lessonsMod = require("../functions/supplier-lessons");
    const db = fakeDb();
    // fakeDb guarda por id de documento sin colección: alcanza para estas pruebas
    const CUIT = "30-11111111-1".replace(/\D/g, "");
    const learnClient = (lessons) => fakeClient({ lessons });
    const diffs = [{ renglon: "BILLIKEN 35 G", leido: "1 u. a $ 3756", corregido: "12 u. a $ 313 c/u, la cantidad x12" }];
    await ai.handle({ db, logger, client: learnClient([{ text: "La columna U.B. son unidades por bulto: la cantidad en unidades es CANTIDAD × U.B.", basedOn: -1 }]) }, "u1", { kind: "lesson", supplierCuit: "30-11111111-1", supplierName: "MAYORISTA", diffs });
    assert.strictEqual(db.docs[CUIT].lessons[0].by.join(), "u1");
    assert.strictEqual((await lessonsMod.forCuits(db, "u1", [CUIT])).size, 1, "el que la escribió la usa");
    assert.strictEqual((await lessonsMod.forCuits(db, "u2", [CUIT])).size, 0, "otro comercio todavía no");
    // Otro comercio corrige lo mismo: la lección queda confirmada para todos
    await ai.handle({ db, logger, client: learnClient([{ text: "La columna U.B. son unidades por bulto: la cantidad en unidades es CANTIDAD × U.B.", basedOn: 0 }]) }, "u2", { kind: "lesson", supplierCuit: CUIT, supplierName: "MAYORISTA", diffs });
    assert.deepStrictEqual(db.docs[CUIT].lessons[0].by, ["u1", "u2"]);
    assert.strictEqual((await lessonsMod.forCuits(db, "u3", [CUIT])).size, 1, "un comercio nuevo ya la tiene");
    // Sin CUIT o sin diferencias no gasta IA
    const c = fakeClient({ lessons: [] });
    await ai.handle({ db, logger, client: c }, "u1", { kind: "lesson", supplierCuit: "", diffs });
    await ai.handle({ db, logger, client: c }, "u1", { kind: "lesson", supplierCuit: CUIT, diffs: [] });
    assert.strictEqual(c.calls.length, 0);
    // Al leer una foto de ese proveedor, la lección va en el pedido a la IA
    const reader = byPhoto({ FOTO0: read({ supplierCuit: "30-11111111-1", invoiceNumber: "0001-00000001", subtotalNeto: "100,00", totalFacturaAPagar: "121,00", items: [it("X", 1, "100,00")] }) });
    await ai.handle({ db, logger, client: reader }, "u3", { kind: "invoice", stage: "page", image: { data: "FOTO0", mediaType: "image/jpeg" }, index: 0, supplierCuits: [CUIT] });
    const asked = reader.calls[0].messages[0].content.find((b) => b.type === "text").text;
    assert.ok(asked.includes("unidades por bulto"), asked);
  });

  // ── Tanda 1 del plan de boletas: QR de ARCA y muestras ──
  const samples = require("../functions/invoice-samples");
  const fakeBucket = () => { const files = {}; return { files, file: (p) => ({ save: async (buf, o) => { files[p] = { size: buf.length, type: o.contentType }; } }) }; };
  const QR = { ver: 1, fecha: "2026-11-10", cuit: 30712345675, ptoVta: 3, tipoCmp: 1, nroCmp: 4521, importe: 12100, moneda: "PES", ctz: 1, tipoDocRec: 80, nroDocRec: 20111111112, tipoCodAut: "E", codAut: 1 };

  await t("QR de ARCA: con el total impreso tapado, la hoja cierra contra el importe del QR", async () => {
    samples.resetCache();
    // La IA no ve el total (tapado) ni el CUIT; los renglones dan 10.000 + IVA = 12.100
    const client = byPhoto({ FOTO0: read({ supplierName: "DISTRI SUR", invoiceNumber: "0003-00004521", totalFacturaAPagar: "", ivaTotal: "2100,00", items: [it("YERBA", 10, "10.000,00")] }) });
    const db = fakeDb();
    const page = await ai.handle({ db, logger, client }, "u20", { kind: "invoice", stage: "page", image: { data: "FOTO0", mediaType: "image/jpeg" }, index: 0, qr: QR });
    const r = page.result.read;
    assert.strictEqual(r.totalFacturaAPagar, "12100.00");
    assert.strictEqual(r.supplierCuit, "30-71234567-5");
    assert.strictEqual(r.invoiceNumber, "0003-00004521", "mismo número con otros ceros: queda el leído");
    assert.strictEqual(r.date, "2026-11-10");
    const g = await ai.handle({ db, logger, client }, "u20", { kind: "invoice", stage: "group", reads: [r] });
    assert.strictEqual(g.result.documents[0].closes, true);
    assert.strictEqual(g.result.documents[0].qr.kind, "factura");
    const nc = ai.applyQr(read({ items: [it("X", 1, "1,00")] }), { ...QR, tipoCmp: 8 });
    assert.strictEqual(nc.qr.kind, "nota de crédito");
    assert.strictEqual(ai.applyQr(read({}), { cuit: "123" }).qr, undefined, "QR inválido: no toca nada");
  });

  await t("muestras: con el interruptor apagado no se guarda nada", async () => {
    samples.resetCache();
    const client = byPhoto({ FOTO0: read({ supplierCuit: "30-71234567-5", totalFacturaAPagar: "121,00", subtotalNeto: "100,00", items: [it("SAL", 1, "100,00")] }) });
    const db = fakeDb(), bucket = fakeBucket();
    const out = await ai.handle({ db, logger, client, bucket }, "u21", { kind: "invoice", stage: "page", image: { data: "FOTO0", mediaType: "image/jpeg" }, index: 0 });
    assert.strictEqual(out.result.read.sampleId, undefined);
    assert.deepStrictEqual(Object.keys(bucket.files), []);
    assert.ok(!Object.values(db.docs).some((d) => d.storagePath), "sin documento de muestra");
  });

  await t("muestras: prendido para esa cuenta guarda foto + lectura + modelos, y al confirmar el resultado", async () => {
    samples.resetCache();
    const client = byPhoto({ FOTO0: read({ supplierCuit: "30-71234567-5", supplierName: "DISTRI SUR", invoiceNumber: "0003-00004521", totalFacturaAPagar: "121,00", subtotalNeto: "100,00", items: [it("SAL", 1, "100,00")] }) });
    const db = fakeDb(), bucket = fakeBucket();
    db.docs.invoiceSamples = { enabled: false, uids: ["u22"] };
    const out = await ai.handle({ db, logger, client, bucket }, "u22", { kind: "invoice", stage: "page", image: { data: "FOTO0", mediaType: "image/jpeg" }, index: 0 });
    const id = out.result.read.sampleId;
    assert.ok(id, "devuelve el sampleId");
    const doc = db.docs[id];
    assert.strictEqual(doc.uid, "u22");
    assert.strictEqual(doc.cuit, "30712345675");
    assert.deepStrictEqual(doc.models, ["claude-haiku-5-5"]);
    assert.strictEqual(doc.read.items[0].name, "SAL");
    assert.ok(doc.storagePath.startsWith("invoice_samples/u22/") && bucket.files[doc.storagePath], "la foto quedó en Storage");
    const g = await ai.handle({ db, logger, client }, "u22", { kind: "invoice", stage: "group", reads: [out.result.read] });
    assert.deepStrictEqual(g.result.documents[0].sampleIds, [id]);
    // Confirmar: sin IA; otro comercio no puede tocar la muestra
    const other = await ai.handle({ db, logger }, "u99", { kind: "invoice", stage: "confirm", sampleIds: [id], confirmed: { items: [] } });
    assert.strictEqual(other.result.updated, 0);
    assert.strictEqual(db.docs[id].confirmed, null);
    const mine = await ai.handle({ db, logger }, "u22", { kind: "invoice", stage: "confirm", sampleIds: [id], confirmed: { supplierCuit: "30-71234567-5", total: 121, untouched: true, items: [{ name: "SAL", quantity: 1, cost: 100, productId: "sal" }] } });
    assert.strictEqual(mine.result.updated, 1);
    assert.strictEqual(db.docs[id].confirmed.items[0].cost, 100);
    assert.strictEqual(db.docs[id].confirmed.untouched, true);
  });

  await t("Leyó mal: marca solo las muestras propias y deja el aviso para el admin, sin cupo", async () => {
    const db = fakeDb();
    db.docs.sample001 = { uid: "u30", read: {} };
    db.docs.sample002 = { uid: "otro", read: {} };
    const out = await ai.handle({ db, logger }, "u30", { kind: "invoice", stage: "misread", sampleIds: ["sample001", "sample002"], note: "faltó un renglón", info: { supplierName: "DISTRI", invoiceNumber: "1-2", items: 5, why: ["1 renglón dudoso"] } });
    assert.strictEqual(out.result.flagged, 1);
    assert.strictEqual(db.docs.sample001.flagged, true);
    assert.ok(!db.docs.sample002.flagged);
    const aviso = db.docs[out.result.id];
    assert.strictEqual(aviso.note, "faltó un renglón");
    assert.strictEqual(aviso.seen, false);
    // Sin muestras (interruptor apagado) el aviso llega igual
    const sin = await ai.handle({ db, logger }, "u30", { kind: "invoice", stage: "misread", sampleIds: [], info: { supplierName: "OTRO" } });
    assert.strictEqual(db.docs[sin.result.id].supplierName, "OTRO");
  });

  await t("admin Boletas: sin tocar por proveedor, escaladas, costo y los que peor se leen", async () => {
    const stats = require("../functions/invoice-admin").stats;
    const row = (uid, at, sup, untouched, models, extra = {}) => ({ uid, cuit: "30", costUsd: 0.02, models, read: { items: [{ total: "1" }, { total: "2" }] }, confirmedAt: at, confirmed: { supplierName: sup, invoiceNumber: String(at), untouched, items: [{}, {}] }, ...extra });
    const s = stats([
      row("a", 1, "MALO", false, ["claude-haiku-5-5", "claude-sonnet-5-5"]), row("a", 2, "MALO", false, ["claude-haiku-5-5"], { flagged: true }),
      row("a", 3, "BUENO", true, ["claude-haiku-5-5"]), row("b", 4, "BUENO", true, ["claude-haiku-5-5"]),
      { uid: "a", read: {}, confirmed: null },
    ]);
    assert.strictEqual(s.invoices, 4);
    assert.strictEqual(s.untouchedPct, 50);
    assert.strictEqual(s.escalatedPct, 25);
    assert.strictEqual(s.suppliers[0].supplier, "MALO");
    assert.strictEqual(s.suppliers[0].flagged, 1);
    assert.deepStrictEqual(s.worst.map((w) => w.supplier), ["MALO"]);
  });

  // ── Tanda 4: lecciones a prueba y ficha del proveedor ──
  const lessonsMod = require("../functions/supplier-lessons");
  const trials = require("../functions/lesson-trials");
  /** Firestore falso con colecciones, where("campo","==",v) y limit */
  const colDb = () => {
    const cols = {};
    const col = (name) => {
      cols[name] = cols[name] || {};
      const docs = cols[name];
      const ref = (id) => ({ id, get: async () => ({ id, exists: !!docs[id], data: () => docs[id] }), set: async (v, o) => { docs[id] = o && o.merge ? { ...(docs[id] || {}), ...v } : v; } });
      const query = (filters = []) => ({
        where: (f, op, v) => query([...filters, [f, v]]), limit: () => query(filters), orderBy: () => query(filters),
        get: async () => ({ docs: Object.entries(docs).filter(([, d]) => filters.every(([f, v]) => d[f] === v)).map(([id, d]) => ({ id, exists: true, data: () => d })) }),
      });
      return { doc: ref, ...query() };
    };
    return { cols, collection: col, getAll: (...refs) => Promise.all(refs.map((r) => r.get())) };
  };

  await t("lección que empeora la lectura: queda descartada sola y el admin la ve así", async () => {
    const db = colDb();
    const CUIT = "30714446785";
    const BAD = "La columna CANT. viene en docenas.";
    await db.collection("ventra_supplier_lessons").doc(CUIT).set({ name: "BEBIDAS DEL VALLE", lessons: [{ text: BAD, by: ["a"], at: 1, status: "candidate" }] });
    // 3 boletas confirmadas de ese proveedor: 10 aguas a $ 100 c/u
    for (const k of [1, 2, 3]) {
      await db.collection("ventra_invoice_samples").doc(`smp00${k}`).set({ uid: "a", cuit: CUIT, storagePath: `invoice_samples/a/${k}.jpg`, confirmedAt: k, read: { pageNumber: 0 },
        confirmed: { supplierCuit: CUIT, invoiceNumber: `1-${k}`, total: 1210, items: [{ name: "AGUA 2 L", code: "5001", quantity: 10, cost: 100, buyFormat: "UNIT" }] } });
    }
    const bucket = { file: () => ({ download: async () => [Buffer.from("FOTO")] }) };
    // La IA lee bien sin la lección; con la lección, multiplica por 12
    const client = { messages: { stream: (req) => {
      const bad = JSON.stringify(req.messages).includes("docenas");
      const r = read({ supplierCuit: "30-71444678-5", invoiceNumber: "1-1", totalFacturaAPagar: "1.210,00", ivaTotal: "210,00", items: [{ ...it("AGUA 2 L", bad ? 120 : 10, "1.000,00"), sku: "5001" }] });
      return { finalMessage: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(r) }], usage: { input_tokens: 100, output_tokens: 50 } }) };
    } } };
    const out = await trials.run({ db, bucket, client, ai, logger });
    assert.strictEqual(out.report[0].decision, "discarded", JSON.stringify(out.report));
    const saved = (await db.collection("ventra_supplier_lessons").doc(CUIT).get()).data().lessons[0];
    assert.strictEqual(saved.status, "discarded");
    assert.ok(saved.trial.without > saved.trial.with);
    // Descartada: ya no la usa nadie, ni el comercio que la escribió
    assert.strictEqual(lessonsMod.usable(saved, "a"), false);
    // El admin la ve descartada
    const adm = await trials.list(db);
    assert.strictEqual(adm[0].lessons[0].status, "discarded");
    // Con menos de 3 boletas no se prueba (sigue la regla de los dos comercios)
    const db2 = colDb();
    await db2.collection("ventra_supplier_lessons").doc(CUIT).set({ lessons: [{ text: BAD, by: ["a"], status: "candidate" }] });
    const out2 = await trials.run({ db: db2, bucket, client, ai, logger });
    assert.ok(out2.report[0].skipped, "sin muestras suficientes");
    assert.strictEqual(lessonsMod.usable({ text: "x", by: ["a"], status: "candidate" }, "a"), true);
    assert.strictEqual(lessonsMod.usable({ text: "x", by: ["a"], status: "adopted" }, "b"), true, "adoptada: la usan todos");
  });

  await t("ficha del proveedor: se arma con las boletas confirmadas y entra en la primera lectura", async () => {
    const r1 = { precios: "sin iva", verified: "total", items: [
      { name: "AGUA SIN GAS 2 L X 6", sku: "5001", packageQuantity: 3, unitsPerPack: 1, total: "21.600" },
      { name: "CERVEZA RUBIA LATA X 24", sku: "5007", packageQuantity: 2, unitsPerPack: 1, total: "57.600" },
      { name: "GASEOSA LIMA X 8", sku: "5013", packageQuantity: 0.5, unitsPerPack: 1, total: "5.600" } ] };
    const conf = { items: [{ name: "AGUA SIN GAS 2 L X 6", code: "5001", quantity: 18, buyFormat: "UNIT" }, { name: "CERVEZA RUBIA LATA X 24", code: "5007", quantity: 48, buyFormat: "UNIT" }, { name: "GASEOSA LIMA X 8", code: "5013", quantity: 4, buyFormat: "UNIT" }] };
    const obs = lessonsMod.profileFrom(r1, conf);
    assert.deepStrictEqual(obs, { precios: "sin iva", columnaUB: false, cantidad: "bultos", formatoCantidad: "bultos,unidades", codigoInterno: true });
    // Un voto por comercio, gana la mayoría
    const db = colDb();
    await lessonsMod.updateProfile(db, "30714446785", "a", obs);
    await lessonsMod.updateProfile(db, "30714446785", "b", { ...obs, precios: "finales" });
    const p = await lessonsMod.updateProfile(db, "30714446785", "c", obs);
    assert.strictEqual(p.fields.precios, "sin iva");
    assert.strictEqual(p.shops, 3);
    // Entra en la lectura aunque no haya lecciones
    const m = await lessonsMod.forCuits(db, "z", ["30714446785"]);
    const hint = lessonsMod.hintText(m);
    assert.ok(hint.includes("SIN IVA") && hint.includes("bultos,unidades") && hint.includes("va en sku"), hint);
  });

  await t("ticket largo en tramos: se juntan y los renglones repetidos entre fotos van una vez", async () => {
    const tramo1 = read({ supplierName: "SUPERMAYORISTA RUTA 2", invoiceNumber: "0045-00334129", docType: "ticket", totalFacturaAPagar: "", items: [it("LECHE 1L", 12, "13.800,00"), it("YOGUR 1L", 6, "11.340,00"), it("MANTECA 200G", 4, "9.240,00")] });
    // La segunda foto repite los 2 últimos renglones y no tiene encabezado
    const tramo2 = read({ docType: "ticket", totalFacturaAPagar: "42.720,00", items: [it("YOGUR 1L", 6, "11.340,00"), it("MANTECA 200G", 4, "9.240,00"), it("QUESO CREMA", 3, "8.340,00")] });
    const g = ai.finishInvoices([{ image: 0, ...tramo1 }, { image: 1, ...tramo2 }]);
    const doc = g.result.documents;
    assert.strictEqual(doc.length, 1, "un solo ticket");
    assert.deepStrictEqual(doc[0].items.map((x) => x.name), ["LECHE 1L", "YOGUR 1L", "MANTECA 200G", "QUESO CREMA"]);
    assert.strictEqual(doc[0].tramos, 1);
    assert.strictEqual(doc[0].closes, true, "con los tramos juntos cierra el total");
    // Una factura distinta sin número no se pega a un ticket que ya tiene su total
    const otro = ai.finishInvoices([{ image: 0, ...tramo1, totalFacturaAPagar: "34.380,00" }, { image: 1, ...tramo2 }]);
    assert.strictEqual(otro.result.documents.length, 2);
  });

  await t("nota de crédito: la IA la puede marcar y el QR la reconoce", async () => {
    assert.ok(ai.INVOICE_ONE_PROMPT.includes('"nota de credito"'));
    const nc = ai.applyQr(read({ items: [it("X", 1, "1,00")] }), { ver: 1, fecha: "2026-11-10", cuit: 30712345675, ptoVta: 3, tipoCmp: 3, nroCmp: 12, importe: 121, moneda: "PES", ctz: 1 });
    assert.strictEqual(nc.docType, "nota de credito");
  });

  await t("impuestos internos: la IA los informa aparte y llegan al comprobante", async () => {
    assert.ok(ai.INVOICE_ONE_PROMPT.includes("impuestosInternos"));
    const g = ai.finishInvoices([{ image: 0, ...read({ invoiceNumber: "0001-00000001", totalFacturaAPagar: "1.331,00", ivaTotal: "210,00", otrosImpuestos: "121", impuestosInternos: "121", items: [it("CERVEZA", 1, "1.000,00")] }) }]);
    assert.strictEqual(g.result.documents[0].impuestosInternos, "121");
  });

  console.log(`\n${ok} bien, ${bad} con falla`);
  process.exit(bad ? 1 : 0);
})();
