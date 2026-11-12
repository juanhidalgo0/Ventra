// Limpieza de repetidos y boletas por foto (functions/wa-owner-cleanup.js, wa-owner-invoice.js,
// wa-owner.js): Firestore, Storage, WhatsApp y la caja en la nube falsos. Sin red.
//   node firebase/test/boletas.test.cjs
const assert = require("assert");
const admin = require("../functions/node_modules/firebase-admin");
admin.firestore.FieldValue.increment = (n) => ({ operand: n });
admin.firestore.FieldValue.serverTimestamp = () => "ts";
const ai = require("../functions/ai");
const waOwner = require("../functions/wa-owner");
const invoice = require("../functions/wa-owner-invoice");

const fakeDb = () => {
  const cols = {};
  const col = (name) => (cols[name] = cols[name] || {});
  const docRef = (name, id) => ({
    id,
    get: async () => ({ id, exists: id in col(name), data: () => col(name)[id], ref: docRef(name, id) }),
    set: async (v, opt) => { const cur = opt && opt.merge ? { ...(col(name)[id] || {}) } : {}; for (const [k, x] of Object.entries(v)) cur[k] = x && x.operand !== undefined ? (cur[k] || 0) + x.operand : x; col(name)[id] = JSON.parse(JSON.stringify(cur)); },
    create: async (v) => { if (id in col(name)) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 }); col(name)[id] = v; },
    delete: async () => { delete col(name)[id]; },
  });
  const query = (name, filters) => ({
    where: (f, op, v) => query(name, [...filters, [f, v]]),
    get: async () => { const docs = Object.entries(col(name)).filter(([, d]) => filters.every(([f, v]) => d[f] === v)).map(([id, d]) => ({ id, data: () => d, ref: docRef(name, id) })); return { docs, empty: !docs.length, forEach: (fn) => docs.forEach(fn) }; },
  });
  return { cols, collection: (name) => ({ doc: (id) => docRef(name, id), where: (f, op, v) => query(name, [[f, v]]) }) };
};
const fakeBucket = () => { const files = {}; return { name: "b", files, file: (p) => ({ save: async (b) => { files[p] = Buffer.from(b); }, download: async () => { if (!(p in files)) throw new Error("no " + p); return [files[p]]; } }) }; };
const logger = { warn() {}, error(...a) { console.log("   [error]", ...a); }, info() {} };
const client = () => ({ reqs: [], messages: { create: async () => ({ stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: "ok" }] }) } });

// ── La caja en la nube simulada (como el backend) ──
function fakeCloud() {
  const state = { merges: [], distinct: [], purchases: [], suppliers: [], calls: [], scanned: null };
  const groups = [
    { key: "a|b", kind: "igual", looksDistinct: false, why: null, keepId: "rad1", products: [
      { id: "rad1", name: "RAD ENERGIZANTE X 500", barcode: "7798113300013", extraBarcodes: [], salePrice: 2700, stock: -125, sold: 34, lastSale: "2026-11-10T20:00:00Z" },
      { id: "rad2", name: "RAD ENERGIZANTE X 500", barcode: "7790070318312", extraBarcodes: [], salePrice: 2700, stock: -91, sold: 0, lastSale: null }] },
    { key: "c|d", kind: "parecido", looksDistinct: true, why: 'difieren en "M" (puede ser un talle, color o sabor)', keepId: "gm", products: [
      { id: "gm", name: "MAKE GUANTES M", barcode: null, extraBarcodes: [], salePrice: 2500, stock: 3, sold: 1, lastSale: null },
      { id: "gg", name: "MAKE GUANTES G", barcode: null, extraBarcodes: [], salePrice: 2500, stock: 2, sold: 0, lastSale: null }] },
    { key: "e|f", kind: "igual", looksDistinct: false, why: null, keepId: "sp1", products: [
      { id: "sp1", name: "SPRING POP", barcode: "1", extraBarcodes: [], salePrice: 300, stock: 1, sold: 0, lastSale: null },
      { id: "sp2", name: "SPRING POP", barcode: "2", extraBarcodes: [], salePrice: 300, stock: 1, sold: 0, lastSale: null }] },
  ];
  const scan = {
    supplierName: "DISTRIBUIDORA SUR SA", matchedSupplier: { id: "sup1", name: "Distribuidora Sur" }, invoiceNumber: "0001-00012345", date: "2026-11-11", duplicate: null,
    check: { ok: true, message: "Los renglones suman el total de la boleta." }, invoice: { totals: { total: 129000 } },
    items: [
      { name: "COCA COLA 2.25 X1", sku: "C225", barcode: null, quantity: 24, unitsPerPack: 1, cost: 3800, changePct: 15.2, suggestedSalePrice: 5990, doubtful: false, reasons: [], candidates: [], match: { by: "name", confidence: "alta" },
        product: { id: "coca225", name: "COCA COLA 2.25", costPrice: 3300, salePrice: 5200 } },
      { name: "RAD ENERG 500", sku: "R500", barcode: null, quantity: 12, unitsPerPack: 1, cost: 1600, changePct: 6.7, suggestedSalePrice: 2880, doubtful: false, reasons: [], candidates: [], match: { by: "name", confidence: "media" },
        product: { id: "rad1", name: "RAD ENERGIZANTE X 500", costPrice: 1500, salePrice: 2700 } },
      { name: "ALF TRIP BARR FR DDL", sku: "A1", barcode: null, quantity: 24, unitsPerPack: 1, cost: 1200, changePct: null, suggestedSalePrice: 1680, doubtful: true, reasons: ["puede que ya lo tengas (¿BARRIGON ALFAJOR TRIPLAZO FR Y DDL X 100 GR?)"], match: null, product: null,
        candidates: [{ id: "barfr", name: "BARRIGON ALFAJOR TRIPLAZO FR Y DDL X 100 GR", costPrice: 1100, salePrice: 2200 }, { id: "barcr", name: "BARRIGON ALFAJOR TRIPLAZO CR Y DDL X 100 GR", costPrice: 1100, salePrice: 2100 }] },
      { name: "PAPAS NUEVAS X 80", sku: "P80", barcode: "7791234567893", quantity: 6, unitsPerPack: 1, cost: 900, changePct: null, suggestedSalePrice: 1270, doubtful: true, reasons: [], match: null, product: null, candidates: [] },
      { name: "FERNET X 750", sku: "F750", barcode: null, quantity: 6, unitsPerPack: 1, cost: 16000, changePct: 80, suggestedSalePrice: 35100, doubtful: true, reasons: ["el costo cambia +80%"], candidates: [], match: { by: "ia", confidence: "baja" },
        product: { id: "fer", name: "FERNET BRANCA 750", costPrice: 8900, salePrice: 19500 } },
    ],
  };
  return {
    state,
    call: async (uid, list) => list.map((c) => {
      state.calls.push(`${c.method} ${c.path}`);
      if (c.path === "/api/products/duplicates") return { status: 200, body: { total: groups.length, groups: groups.filter((g) => !state.distinct.includes(g.key) && !state.merges.some((m) => m.key === g.key && !m.undone)) } };
      if (c.path === "/api/products/merge") {
        if (c.body.mergeIds.includes("sp2")) return { status: 400, body: { message: '"SPRING POP" está en la promo "2x1": juntalos desde Ventra o sacalo de la promo primero' } };
        const g = groups.find((x) => x.products.some((p) => p.id === c.body.keepId));
        const m = { mergeId: `m${state.merges.length + 1}`, key: g.key, keepId: c.body.keepId, mergeIds: c.body.mergeIds, undone: false };
        state.merges.push(m);
        return { status: 201, body: { mergeId: m.mergeId, kept: { id: c.body.keepId }, hidden: c.body.mergeIds.map((id) => ({ id })), barcodesMoved: 1, stockMoved: -91, backup: state.merges.length === 1 ? "seguridad.db" : null } };
      }
      const undo = /^\/api\/products\/merge\/(.+)\/undo$/.exec(c.path);
      if (undo) { const m = state.merges.find((x) => x.mergeId === undo[1]); if (m.undone) return { status: 201, body: { ok: true, already: true } }; m.undone = true; return { status: 201, body: { ok: true, restored: ["RAD ENERGIZANTE X 500"] } }; }
      if (c.path === "/api/products/merges") return { status: 200, body: state.merges.filter((m) => !m.undone).map((m) => ({ mergeId: m.mergeId, kept: "RAD ENERGIZANTE X 500", hidden: ["RAD ENERGIZANTE X 500"] })) };
      if (c.path === "/api/products/duplicates/distinct") { state.distinct.push(groups.find((g) => g.products.some((p) => p.id === c.body.ids[0])).key); return { status: 201, body: { ok: true } }; }
      if (c.path === "/api/purchases/scan-invoice-json") {
        state.scanned = c.body; state.scans = (state.scans || 0) + 1;
        const body = JSON.parse(JSON.stringify(scan));
        if (state.others) { body.others = state.others; state.others = null; }
        return { status: 201, body };
      }
      if (c.path === "/api/purchases") { state.purchases.push(c.body); return { status: 201, body: { id: "pur1" } }; }
      if (c.path === "/api/purchases/pending-from-preview") {
        state.pendings = state.pendings || [];
        if (state.dupNext) { state.dupNext = false; return { status: 201, body: { status: "DUPLICATE", purchaseId: "viejo" } }; }
        state.pendings.push(c.body); return { status: 201, body: { status: "PENDING", purchaseId: `pend${state.pendings.length}`, items: c.body.preview.items.length } };
      }
      return { status: 404, body: { message: "No existe" } };
    }),
  };
}

const T = "tenant1", PHONE = "5492215550000", NOW = Date.now();
let ok = 0, bad = 0;
const t = async (name, fn) => { try { await fn(); ok++; console.log(`ok    ${name}`); } catch (e) { bad++; console.log(`FALLA ${name}\n      ${e.stack || e.message}`); } };

(async () => {
  const sharp = require("../functions/node_modules/sharp");
  const jpg = await sharp({ create: { width: 40, height: 60, channels: 3, background: "#fff" } }).jpeg().toBuffer();
  const db = fakeDb();
  const bucket = fakeBucket();
  const cloud = fakeCloud();
  db.cols.ventra_accounts = { [T]: { plan: "full", paidUntil: NOW + 864e5 } };
  db.cols[waOwner.OWNERS] = { [PHONE]: { uid: T, userId: "u1", role: "ADMIN", lastInboundAt: NOW } };
  const sent = [];
  // La espera para juntar las fotos de un mismo envío: instantánea salvo en la prueba del álbum
  let photoWait = async () => {};
  const deps = () => ({
    ai, aiDeps: { db, logger, sql: { query: async () => [] }, client: client() }, sql: { query: async () => [] }, logger, bucket, ventraApi: cloud,
    send: async (to, text) => { sent.push({ text }); }, sendButtons: async (to, text, buttons) => { sent.push({ text, buttons }); },
    sendList: async (to, text, button, sections) => { sent.push({ text, list: sections.flatMap((s) => s.rows) }); }, sendImage: async () => {},
    download: async () => jpg, photoWait: (ms) => photoWait(ms),
  });
  const inbox = () => db.cols[waOwner.INBOX] || {};
  const drain = async (now = NOW) => { for (const id of Object.keys(inbox())) { const item = inbox()[id]; delete inbox()[id]; await waOwner.processInbox(db, item, deps(), now); } };
  let seq = 0;
  const say = async (body, now = NOW) => { await waOwner.onMessage(db, async () => {}, { from: PHONE, id: `m${++seq}`, type: "text", text: { body } }, now); await drain(now); };
  const tap = async (id, now = NOW) => { await waOwner.onMessage(db, async () => {}, { from: PHONE, id: `b${++seq}`, type: "interactive", interactive: { button_reply: { id } } }, now); await drain(now); };
  const pickList = async (id, now = NOW) => { await waOwner.onMessage(db, async () => {}, { from: PHONE, id: `l${++seq}`, type: "interactive", interactive: { list_reply: { id } } }, now); await drain(now); };
  const last = () => sent.at(-1);

  // ── Repetidos ──
  await t("menú → Productos repetidos: muestra el primer grupo con código, precio, stock y ventas", async () => {
    await pickList("m|repetidos");
    const card = last();
    assert.match(card.text, /\*RAD ENERGIZANTE X 500\* aparece 2 veces/);
    assert.match(card.text, /1️⃣ RAD ENERGIZANTE X 500\n    Código 7798113300013 · \$ 2\.700 · stock -125 · vendió 34/);
    assert.match(card.text, /2️⃣ RAD ENERGIZANTE X 500\n    Código 7790070318312 · \$ 2\.700 · stock -91 · sin ventas/);
    assert.match(card.text, /queda el 1️⃣ \(el que más vende\).*No se borra nada/s);
    assert.deepStrictEqual(card.buttons.map((b) => b.title), ["Juntar", "Son distintos", "Saltear"]);
  });
  await t("juntar: llama a la caja con el que queda y avisa que se puede separar", async () => {
    await tap(last().buttons[0].id);
    assert.deepStrictEqual(cloud.state.merges[0].mergeIds, ["rad2"]);
    assert.strictEqual(cloud.state.merges[0].keepId, "rad1");
    assert.match(last().text, /✅ Junté en \*RAD ENERGIZANTE X 500\* \(pasaron 1 código\) · hice una copia de seguridad antes\. _Si fue un error, escribí \*SEPARAR\*\._/);
  });
  await t("los que parecen distintos (talle) vienen marcados y el botón principal es 'Son distintos'", async () => {
    const card = last();
    assert.match(card.text, /⚠️ Ojo: difieren en "M"/);
    assert.deepStrictEqual(card.buttons.map((b) => b.title), ["Son distintos", "Juntar igual", "Saltear"]);
    await tap(card.buttons[0].id);
    assert.deepStrictEqual(cloud.state.distinct, ["c|d"]);
  });
  await t("si la caja no deja juntar (promo), lo dice y sigue; al final, el resumen", async () => {
    await tap(last().buttons[0].id);
    assert.match(last().text, /⚠️ No los junté: "SPRING POP" está en la promo "2x1"/);
    assert.match(last().text, /🎉 \*Terminamos\.\* Juntaste 1, 1 eran distintos y salteaste 1/);
  });
  await t("un botón viejo (de un grupo ya resuelto) no hace nada", async () => {
    const before = cloud.state.merges.length;
    await tap("wc|merge|0");
    assert.strictEqual(cloud.state.merges.length, before);
  });
  await t("SEPARAR deshace la última juntada; JUNTADOS lista y SEPARAR n separa esa", async () => {
    await say("separar");
    assert.match(last().text, /↩️ Listo, separé RAD ENERGIZANTE X 500/);
    assert.strictEqual(cloud.state.merges[0].undone, true);
    await say("Separar");
    assert.match(last().text, /No tengo ninguna juntada reciente/);
    // Otra vuelta: queda el 2 (elige cuál queda)
    await pickList("m|repetidos");
    await say("queda el 2");
    assert.strictEqual(cloud.state.merges.at(-1).keepId, "rad2");
    await say("juntados");
    assert.match(last().text, /\*Productos juntados\*.*1\. \*RAD ENERGIZANTE X 500\*/s);
    await say("separar 1");
    assert.match(last().text, /separé/);
    await say("PARAR");
    assert.match(last().text, /paramos/);
  });

  // ── Boletas ──
  await t("foto sin texto: pregunta qué es con botones", async () => {
    await waOwner.onMessage(db, async () => {}, { from: PHONE, id: "img1", type: "image", image: { id: "media1", mime_type: "image/jpeg" } }, NOW);
    await drain();
    assert.deepStrictEqual(last().buttons.map((b) => b.title), ["Boleta o factura", "Logo del comercio", "Otra cosa"]);
  });
  let invId;
  await t("es una boleta: la lee (vista previa), pasa lo seguro y pregunta lo dudoso; los repetidos también se preguntan", async () => {
    await tap("wf|invoice");
    assert.ok(cloud.state.scanned.images[0].data.length > 0, "mandó la foto");
    const intro = sent.find((s) => /leí \*5 renglones\*/.test(s.text || ""));
    assert.match(intro.text, /Distribuidora Sur\* · N° 0001-00012345/);
    assert.match(intro.text, /✅ 1 los reconocí seguro\n❓ 4 te los pregunto de a uno/);
    // Antes de preguntar: ¿acá o en la PC?
    const choose = last();
    assert.match(choose.text, /¿Dónde la querés revisar\?.*los 4 dudosos/s);
    assert.deepStrictEqual(choose.buttons.map((b) => b.title), ["Seguir por acá", "Revisar en la PC", "Cancelar"]);
    await tap(choose.buttons[0].id);
    // 1ª pregunta: el RAD tiene repetidos → lista con los iguales
    const q = last();
    assert.match(q.text, /RAD ENERG 500.*tenés 2 productos iguales/s);
    assert.deepStrictEqual(q.list.map((r) => r.title).slice(0, 2), ["RAD ENERGIZANTE X 500", "RAD ENERGIZANTE X 500"]);
    invId = q.list[0].id.split("|")[2];
    await pickList(q.list[0].id);
  });
  await t("no encontrado con candidatos: lista para elegir (FR o CR), nunca se crea solo", async () => {
    const q = last();
    assert.match(q.text, /ALF TRIP BARR FR DDL/);
    assert.ok(q.list.some((r) => /Es un producto nuevo/.test(r.title)));
    // El título se corta igual para los dos: lo que los distingue es la descripción
    assert.strictEqual(q.list[0].title, q.list[1].title);
    assert.match(q.list[0].description, /TRIPLAZO FR Y DDL/);
    assert.match(q.list[1].description, /TRIPLAZO CR Y DDL/);
    await pickList(q.list.find((r) => /FR Y DDL/.test(r.description)).id);
  });
  await t("no encontrado sin candidatos: ofrece crearlo o saltearlo", async () => {
    const q = last();
    assert.match(q.text, /PAPAS NUEVAS X 80.*No lo encontré en tu catálogo/s);
    assert.deepStrictEqual(q.buttons.map((b) => b.title), ["Crear nuevo", "Saltear"]);
    await tap(q.buttons[0].id);
  });
  await t("costo que cambia mucho: pregunta si es ese producto (y 'Es otro' sin candidatos ofrece crear o saltear)", async () => {
    const q = last();
    assert.match(q.text, /¿Es \*FERNET BRANCA 750\*\?\nCosto \$ 8\.900 → \$ 16\.000 \(\+80%\)/);
    await tap(q.buttons[1].id);
    assert.deepStrictEqual(last().buttons.map((b) => b.title), ["Crear nuevo", "Saltear"]);
    await tap(last().buttons[1].id);
  });
  await t("resumen: cambios de costo con el precio nuevo manteniendo el margen", async () => {
    const s = last();
    assert.match(s.text, /✅ 3 productos: suma stock y actualiza el costo/);
    assert.match(s.text, /🆕 1 nuevos: PAPAS NUEVAS X 80/);
    assert.match(s.text, /⏭️ 1 salteados/);
    assert.match(s.text, /- COCA COLA 2\.25: \$ 3\.300 → \$ 3\.800 \(\+15,2%\) · venta \$ 5\.200 → \$ 5\.990/);
    assert.deepStrictEqual(s.buttons.map((b) => b.title), ["Confirmar", "Sin cambiar precios", "Cancelar"]);
  });
  await t("confirmar: carga la compra con lo elegido, aprende del proveedor y crea solo lo aprobado", async () => {
    await tap(`wv|ok|${invId}`);
    const p = cloud.state.purchases[0];
    assert.strictEqual(p.supplierId, "sup1");
    assert.strictEqual(p.invoiceNumber, "0001-00012345");
    const byId = Object.fromEntries(p.items.filter((i) => i.productId).map((i) => [i.productId, i]));
    assert.deepStrictEqual(Object.keys(byId).sort(), ["barfr", "coca225", "rad1"]);
    assert.strictEqual(byId.coca225.salePrice, 5990, "precio sugerido que mantiene el margen");
    assert.strictEqual(byId.barfr.salePrice, 2400, "el elegido de la lista: margen sobre su propio costo (2200 × 1200/1100, redondeado)");
    assert.deepStrictEqual(byId.coca225.source, { code: "C225", name: "COCA COLA 2.25 X1" }, "aprende el código del proveedor");
    const created = p.items.filter((i) => i.newProductData);
    assert.strictEqual(created.length, 1);
    assert.deepStrictEqual([created[0].newProductData.name, created[0].newProductData.barcode], ["PAPAS NUEVAS X 80", "7791234567893"]);
    assert.ok(!p.items.some((i) => i.newProductData && /FERNET/.test(i.newProductData.name)), "lo salteado no se carga");
    assert.match(last().text, /✅ \*Compra cargada\.\* 3 productos.*1 productos nuevos/s);
    await tap(`wv|ok|${invId}`);
    assert.strictEqual(cloud.state.purchases.length, 1, "confirmar dos veces no la carga dos veces");
  });
  await t("'Sin cambiar precios' carga sin precio de venta; cancelar no carga nada", async () => {
    const flow = { db, api: cloud, bucket, uid: T, from: PHONE, send: async (to, text) => sent.push({ text }), sendButtons: async (to, text, buttons) => sent.push({ text, buttons }), sendList: async (to, text, b, s) => sent.push({ text, list: s.flatMap((x) => x.rows) }), now: NOW };
    bucket.files["tenants/x/boleta.jpg"] = Buffer.from([1, 2, 3]);
    await invoice.start(flow, "tenants/x/boleta.jpg");
    const id2 = Object.keys(db.cols[invoice.INVOICES]).find((k) => k !== invId);
    const inv = db.cols[invoice.INVOICES][id2];
    for (const [k, it] of inv.items.entries()) if (!it.decision) await invoice.act(flow, { action: "skip", id: id2, k });
    await invoice.act(flow, { action: "keep", id: id2 });
    const p = cloud.state.purchases.at(-1);
    assert.ok(p.items.every((i) => i.salePrice === undefined), "sin precios de venta");
    await invoice.start(flow, "tenants/x/boleta.jpg");
    const id3 = Object.keys(db.cols[invoice.INVOICES]).find((k) => ![invId, id2].includes(k));
    const before = cloud.state.purchases.length;
    await invoice.act(flow, { action: "no", id: id3 });
    assert.strictEqual(cloud.state.purchases.length, before);
    assert.match(sent.at(-1).text, /no cargué nada/);
  });
  await t("'Revisar en la PC': queda pendiente en la caja con lo leído, sin cargar nada ni volver a leerla", async () => {
    const flow = { db, api: cloud, bucket, uid: T, from: PHONE, send: async (to, text) => sent.push({ text }), sendButtons: async (to, text, buttons) => sent.push({ text, buttons }), sendList: async (to, text, b, s) => sent.push({ text, list: s.flatMap((x) => x.rows) }), now: NOW };
    const known = new Set(Object.keys(db.cols[invoice.INVOICES]));
    const scans = cloud.state.calls.filter((c) => /scan-invoice-json/.test(c)).length;
    await invoice.start(flow, "tenants/x/boleta.jpg");
    const id = Object.keys(db.cols[invoice.INVOICES]).find((k) => !known.has(k));
    const purchasesBefore = cloud.state.purchases.length;
    await invoice.act(flow, { action: "pc", id });
    const p = cloud.state.pendings.at(-1);
    assert.strictEqual(p.via, "WhatsApp");
    assert.strictEqual(p.preview.items.length, 5, "manda lo leído tal cual");
    assert.strictEqual(p.preview.matchedSupplier.id, "sup1");
    assert.strictEqual(cloud.state.calls.filter((c) => /scan-invoice-json/.test(c)).length, scans + 1, "no la vuelve a leer");
    assert.strictEqual(cloud.state.purchases.length, purchasesBefore, "no carga la compra");
    assert.strictEqual(db.cols[invoice.INVOICES][id].status, "pc");
    assert.match(sent.at(-1).text, /te la dejé en la PC.*Todavía no se cargó nada/s);
    // Tocar después Confirmar o PC de nuevo no hace nada
    const n = cloud.state.pendings.length;
    await invoice.act(flow, { action: "pc", id });
    await invoice.act(flow, { action: "ok", id });
    assert.strictEqual(cloud.state.pendings.length, n);
    assert.strictEqual(cloud.state.purchases.length, purchasesBefore);
    assert.match(sent.at(-1).text, /ya te la dejé en la PC/);
  });
  await t("'Revisar en la PC' con una boleta ya cargada: avisa y no la duplica", async () => {
    const flow = { db, api: cloud, bucket, uid: T, from: PHONE, send: async (to, text) => sent.push({ text }), sendButtons: async (to, text, buttons) => sent.push({ text, buttons }), sendList: async () => {}, now: NOW };
    const known = new Set(Object.keys(db.cols[invoice.INVOICES]));
    await invoice.start(flow, "tenants/x/boleta.jpg");
    const id = Object.keys(db.cols[invoice.INVOICES]).find((k) => !known.has(k));
    cloud.state.dupNext = true;
    await invoice.act(flow, { action: "pc", id });
    assert.match(sent.at(-1).text, /ya estaba cargada/);
    assert.strictEqual(db.cols[invoice.INVOICES][id].status, "cancelled");
  });
  await t("desde el menú 'Cargar una compra', la próxima foto va directo como boleta", async () => {
    await pickList("m|compra");
    assert.match(last().text, /foto de la boleta/);
    const before = Object.keys(db.cols[invoice.INVOICES]).length;
    await waOwner.onMessage(db, async () => {}, { from: PHONE, id: "img2", type: "image", image: { id: "media2" } }, NOW + 1000);
    await drain(NOW + 1000);
    assert.strictEqual(Object.keys(db.cols[invoice.INVOICES]).length, before + 1);
  });
  await t("varias fotos juntas (álbum): una sola respuesta y el botón lee todas, una sola vez", async () => {
    const before = sent.length;
    photoWait = () => new Promise((r) => setTimeout(r, 40));
    // Llegan casi juntas, como un álbum: se procesan a la vez
    await waOwner.onMessage(db, async () => {}, { from: PHONE, id: "alb1", type: "image", image: { id: "mA" } }, NOW + 5000);
    await waOwner.onMessage(db, async () => {}, { from: PHONE, id: "alb2", type: "image", image: { id: "mB" } }, NOW + 5001);
    const queued = Object.entries(inbox());
    for (const [id] of queued) delete inbox()[id];
    await Promise.all(queued.map(([, item], i) => waOwner.processInbox(db, item, deps(), NOW + 5000 + i)));
    photoWait = async () => {};
    const qs = sent.slice(before).filter((x) => /Recibí/.test(x.text || ""));
    assert.strictEqual(qs.length, 1, "una sola pregunta para las dos fotos");
    assert.match(qs[0].text, /Recibí 2 fotos/);
    assert.deepStrictEqual(qs[0].buttons.map((b) => b.title), ["Boletas o facturas", "Otra cosa"]);
    const scans = cloud.state.scans;
    await tap(qs[0].buttons[0].id, NOW + 6000);
    assert.strictEqual(cloud.state.scans, scans + 1);
    assert.strictEqual(cloud.state.scanned.images.length, 2, "manda las dos fotos, no solo la última");
    await tap(qs[0].buttons[0].id, NOW + 7000);
    assert.match(last().text, /ya las leí/);
    assert.strictEqual(cloud.state.scans, scans + 1, "un botón viejo no las vuelve a leer");
  });
  await t("las fotos traían varios comprobantes: van de a uno y al terminar uno sigue el otro", async () => {
    const flow = { db, api: cloud, bucket, uid: T, from: PHONE, send: async (to, text) => sent.push({ text }), sendButtons: async (to, text, buttons) => sent.push({ text, buttons }), sendList: async (to, text, b, s) => sent.push({ text, list: s.flatMap((x) => x.rows) }), now: NOW + 8000 };
    cloud.state.others = [{ supplierName: "PANADERIA PRUEBA", invoiceNumber: "0002-00000099", docType: "nota", matchedSupplier: null, check: null,
      items: [{ name: "PAN X6", sku: "P6", quantity: 2, unitsPerPack: 1, cost: 1000, changePct: 11, suggestedSalePrice: 1440, doubtful: false, reasons: [], candidates: [], product: { id: "pan", name: "PAN VIENA X6", costPrice: 900, salePrice: 1300 } }] }];
    const before = sent.length;
    await invoice.start(flow, ["tenants/x/boleta.jpg", "tenants/x/boleta.jpg"]);
    const out = sent.slice(before).map((x) => x.text).join("\n---\n");
    assert.match(out, /Leyendo 2 fotos/);
    assert.match(out, /encontré \*2 comprobantes\*:\n1\. Distribuidora Sur · N° 0001-00012345\n2\. PANADERIA PRUEBA · N° 0002-00000099 \(nota\)/);
    assert.match(out, /\*1 de 2\* · \*Distribuidora Sur\*/);
    assert.deepStrictEqual(last().buttons.map((b) => b.title), ["Seguir por acá", "Revisar en la PC", "Saltear"]);
    const first = last().buttons[0].id.split("|")[2];
    const second = Object.entries(db.cols[invoice.INVOICES]).find(([, v]) => v.status === "queued" && (v.batch || []).includes(first))[0];
    await invoice.act(flow, { action: "here", id: second });
    assert.match(last().text, /Primero terminemos el comprobante anterior/);
    await invoice.act(flow, { action: "no", id: first });
    assert.match(sent.at(-2).text, /\*2 de 2\* · \*PANADERIA PRUEBA\*.*\(nota\)/s);
    assert.deepStrictEqual(last().buttons.map((b) => b.title), ["Seguir por acá", "Revisar en la PC", "Saltear"]);
    await invoice.act(flow, { action: "pc", id: second });
    assert.strictEqual(cloud.state.pendings.at(-1).preview.supplierName, "PANADERIA PRUEBA");
    assert.match(last().text, /terminamos con todos los comprobantes/);
  });
  await t("el encargado no puede limpiar repetidos ni cargar boletas", async () => {
    db.cols[waOwner.OWNERS][PHONE].role = "SUPERVISOR";
    db.cols.ventra_wa_settings = { [T]: { supervisors: true } };
    await tap("wc|merge|0");
    assert.match(last().text, /Eso lo hace el dueño/);
    db.cols[waOwner.OWNERS][PHONE].role = "ADMIN";
  });

  console.log(`\n${ok} bien, ${bad} mal`);
  process.exit(bad ? 1 : 0);
})();
