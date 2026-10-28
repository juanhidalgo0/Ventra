// El dueño pregunta por WhatsApp (functions/wa-owner.js + insights-cloud.js): Postgres en memoria
// (PGlite) con una réplica de ejemplo, Firestore, WhatsApp y Claude falsos. No sale nada a la red.
//   node firebase/test/wa-owner.test.cjs
const assert = require("assert");
const { PGlite } = require("../../tools/sync-sim/node_modules/@electric-sql/pglite");
const admin = require("../functions/node_modules/firebase-admin");
admin.firestore.FieldValue.increment = (n) => ({ operand: n });
admin.firestore.FieldValue.serverTimestamp = () => "ts";
const ai = require("../functions/ai");
const insights = require("../functions/insights-cloud");
const waOwner = require("../functions/wa-owner");

// Firestore falso: colecciones con get/set/create/delete y where("uid", "==", x)
const fakeDb = () => {
  const cols = {};
  const col = (name) => (cols[name] = cols[name] || {});
  const docRef = (name, id) => ({
    id,
    get: async () => ({ id, exists: id in col(name), data: () => col(name)[id], ref: docRef(name, id) }),
    set: async (v, opt) => {
      const cur = opt && opt.merge ? { ...(col(name)[id] || {}) } : {};
      for (const [k, x] of Object.entries(v)) cur[k] = x && x.operand !== undefined ? (cur[k] || 0) + x.operand : x;
      col(name)[id] = cur;
    },
    create: async (v) => { if (id in col(name)) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 }); col(name)[id] = v; },
    delete: async () => { delete col(name)[id]; },
  });
  return {
    cols,
    collection: (name) => ({
      doc: (id) => docRef(name, id),
      where: (field, _op, value) => ({ get: async () => ({ docs: Object.entries(col(name)).filter(([, v]) => v[field] === value).map(([id, v]) => ({ id, data: () => v, ref: docRef(name, id) })) }) }),
    }),
  };
};

// Claude falso: el paso "plan" devuelve las consultas pedidas; el paso "answer" repite los datos
const fakeClient = (queries) => {
  const calls = [];
  return {
    calls,
    messages: { create: async (req) => {
      calls.push(req);
      const isPlan = !!(req.output_config && req.output_config.format);
      const text = isPlan ? JSON.stringify({ queries, noSePuede: queries.length ? "" : "Eso no lo sé." }) : `**Respuesta** ${req.messages[0].content.split("(JSON):\n")[1]}`;
      return { stop_reason: "end_turn", content: [{ type: "text", text }], usage: { input_tokens: 500, output_tokens: 80 } };
    } },
  };
};
const logger = { warn() {}, error(...a) { console.log("   [error]", ...a); }, info() {} };

const T = "tenant1";
const NOW = Date.now();
const today = new Date(NOW).toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
const q = (k = {}) => ({ tipo: "", desde: "", hasta: "", agrupar: "", orden: "", buscar: "", limite: 0, dias: 0, ...k });

async function seed(pg) {
  await pg.exec(`CREATE TABLE sync_rows (tenant_id text, tbl text, id text, data jsonb, deleted boolean NOT NULL DEFAULT false, PRIMARY KEY (tenant_id, tbl, id));
    CREATE TABLE sync_tenants (tenant_id text PRIMARY KEY, last_push_at timestamptz);`);
  const rows = [];
  const add = (tbl, id, data, tenant = T, deleted = false) => rows.push([tenant, tbl, id, JSON.stringify(data), deleted]);
  const hourAgo = NOW - 3600e3;
  // Fecha como texto de SQLite (UTC), como en tablas viejas
  const sqliteText = new Date(hourAgo).toISOString().replace("T", " ").slice(0, 19);
  add("users", "u1", { username: "ANA", full_name: "Ana" });
  add("categories", "c1", { name: "Bebidas" });
  add("products", "coca15", { name: "COCA-COLA 1,5 L", stock: 3, min_stock: 6, cost_price: 1000, sale_price: 1800, is_active: 1, unlimited_stock: 0, barcode: "7790895000997", category_id: "c1" });
  add("products", "coca225", { name: "COCA-COLA 2,25 L", stock: 10, min_stock: 4, cost_price: 1500, sale_price: 2600, is_active: 1, unlimited_stock: 0, category_id: "c1" });
  add("products", "alfajor", { name: "ALFAJOR TRIPLE", stock: 0, min_stock: 0, cost_price: 400, sale_price: 900, is_active: 1, unlimited_stock: 0 });
  add("products", "viejo", { name: "PRODUCTO BORRADO", stock: 50, cost_price: 10, sale_price: 20, is_active: 0 });
  add("sales", "s1", { status: "COMPLETED", total: 3600, created_at: hourAgo, user_id: "u1", session_id: "cs1" });
  add("sales", "s2", { status: "COMPLETED", total: 900, created_at: sqliteText, user_id: "u1", client_id: "cl1", session_id: "cs1" });
  add("sales", "s3", { status: "CANCELLED", total: 99999, created_at: hourAgo, user_id: "u1", session_id: "cs1" });
  add("sales", "s4", { status: "COMPLETED", total: 5000, created_at: NOW - 40 * 864e5, user_id: "u1" });
  add("sales", "s5", { status: "COMPLETED", total: 777, created_at: hourAgo }, "otro"); // otro comercio
  add("sale_items", "i1", { sale_id: "s1", product_id: "coca15", product_name: "COCA-COLA 1,5 L", quantity: 2, total: 3600 });
  add("sale_items", "i2", { sale_id: "s2", product_id: "alfajor", product_name: "ALFAJOR TRIPLE", quantity: 1, total: 900 });
  add("payments", "p1", { sale_id: "s1", method: "CASH", amount: 3600 });
  add("payments", "p2", { sale_id: "s2", method: "MERCADOPAGO", amount: 900 });
  add("clients", "cl1", { name: "Don Tito", balance: 12500, credit_limit: 10000 });
  add("clients", "cl2", { name: "Marta", balance: 0 });
  add("cash_movements", "m1", { session_id: "cs1", type: "EXPENSE", amount: 2000, description: "Hielo [gasto-1]", created_at: hourAgo });
  add("suppliers", "sup1", { name: "Distribuidora Sur" });
  add("purchases", "pu1", { status: "COMPLETED", total: 30000, paymentStatus: "OWED", supplier_id: "sup1", created_at: hourAgo });
  add("cash_register_sessions", "cs1", { status: "OPEN", terminal_name: "Caja 1", user_id: "u1", opening_amount: 10000, opened_at: NOW - 5 * 3600e3 });
  for (const r of rows) await pg.query(`INSERT INTO sync_rows VALUES ($1, $2, $3, $4::jsonb, $5)`, r);
  await pg.query(`INSERT INTO sync_tenants VALUES ($1, $2)`, [T, new Date(NOW - 60e3).toISOString()]);
}

let ok = 0, bad = 0;
const t = async (name, fn) => { try { await fn(); ok++; console.log(`ok    ${name}`); } catch (e) { bad++; console.log(`FALLA ${name}\n      ${e.stack || e.message}`); } };

(async () => {
  const pg = new PGlite();
  await seed(pg);
  const sql = { query: async (text, params) => (await pg.query(text, params)).rows };
  const run1 = async (query) => (await insights.runQueries(sql, T, [query], logger))[0];

  await t("ventas de hoy: solo completadas, de este comercio, con fechas en número o texto", async () => {
    const r = await run1(q({ tipo: "ventas", desde: today, hasta: today }));
    assert.strictEqual(r.ventas, 2);
    assert.strictEqual(r.total, 4500);
    assert.strictEqual(r.ticketPromedio, 2250);
  });
  await t("ventas por medio de pago y por vendedor", async () => {
    const m = await run1(q({ tipo: "ventas", desde: today, hasta: today, agrupar: "medio_de_pago" }));
    assert.deepStrictEqual(m.porMedioDePago, [{ medio: "Efectivo", monto: 3600 }, { medio: "Mercado Pago", monto: 900 }]);
    const v = await run1(q({ tipo: "ventas", desde: today, hasta: today, agrupar: "vendedor" }));
    assert.strictEqual(v.grupos[0].grupo, "Ana");
  });
  await t("sin fechas: los últimos 30 días (la venta de hace 40 días no entra)", async () => {
    const r = await run1(q({ tipo: "ventas" }));
    assert.strictEqual(r.total, 4500);
  });
  await t("productos más vendidos con ganancia y categoría", async () => {
    const r = await run1(q({ tipo: "productos", desde: today, hasta: today, orden: "plata", limite: 5 }));
    assert.strictEqual(r.productos[0].producto, "COCA-COLA 1,5 L");
    assert.strictEqual(r.productos[0].gananciaEstimada, 1600);
    assert.strictEqual(r.productos[0].categoria, "Bebidas");
    const b = await run1(q({ tipo: "productos", desde: today, hasta: today, buscar: "bebida" }));
    assert.strictEqual(b.productosDistintos, 1);
  });
  await t("stock de un producto por nombre y por código", async () => {
    const r = await run1(q({ tipo: "stock", buscar: "coca 1,5" }));
    assert.strictEqual(r.encontrados, 1);
    assert.strictEqual(r.productos[0].stock, 3);
    const c = await run1(q({ tipo: "stock", buscar: "7790895000997" }));
    assert.strictEqual(c.productos[0].producto, "COCA-COLA 1,5 L");
    const all = await run1(q({ tipo: "stock", buscar: "coca" }));
    assert.strictEqual(all.encontrados, 2);
  });
  await t("stock bajo, valorizado y sin ventas (sin los inactivos)", async () => {
    const low = await run1(q({ tipo: "stock_bajo" }));
    assert.deepStrictEqual(low.productos.map((p) => p.producto), ["ALFAJOR TRIPLE", "COCA-COLA 1,5 L"]);
    const val = await run1(q({ tipo: "stock_valorizado" }));
    assert.strictEqual(val.alCosto, 3 * 1000 + 10 * 1500);
    const idle = await run1(q({ tipo: "sin_ventas", dias: 30 }));
    assert.deepStrictEqual(idle.productos.map((p) => p.producto), ["COCA-COLA 2,25 L"]);
  });
  await t("deudores, cliente, gastos y compras", async () => {
    const d = await run1(q({ tipo: "deudores" }));
    assert.strictEqual(d.clientesQueDeben, 1);
    assert.strictEqual(d.clientes[0].pasoElLimite, true);
    const c = await run1(q({ tipo: "cliente", buscar: "tito", desde: today, hasta: today }));
    assert.strictEqual(c.compras, 1);
    assert.strictEqual(c.productosMasComprados[0].producto, "ALFAJOR TRIPLE");
    assert.strictEqual(c.ultimaCompra, today);
    const g = await run1(q({ tipo: "gastos", desde: today, hasta: today }));
    assert.deepStrictEqual(g.porConcepto[0], { concepto: "Hielo", monto: 2000, veces: 1 });
    const p = await run1(q({ tipo: "compras", desde: today, hasta: today }));
    assert.strictEqual(p.porProveedor[0].impago, 30000);
  });
  await t("caja abierta: vendido y efectivo que debería haber", async () => {
    const r = await run1(q({ tipo: "caja" }));
    assert.strictEqual(r.cajasAbiertas.length, 1);
    assert.strictEqual(r.cajasAbiertas[0].vendido, 4500);
    assert.strictEqual(r.cajasAbiertas[0].efectivoQueDeberiaHaber, 10000 + 3600 - 2000);
    assert.strictEqual(r.cajasAbiertas[0].cajero, "Ana");
  });
  await t("una consulta que falla no tira las otras", async () => {
    const out = await insights.runQueries({ query: async (text, p) => { if (/cash_movements/.test(text)) throw new Error("x"); return sql.query(text, p); } }, T, [q({ tipo: "gastos" }), q({ tipo: "deudores" })]);
    assert.strictEqual(out[0].error, "No se pudo calcular");
    assert.strictEqual(out[1].clientesQueDeben, 1);
  });

  // ── Vincular y preguntar ──
  const sent = [];
  const send = async (to, text) => { sent.push({ to, text }); };
  const db = fakeDb();
  db.cols.ventra_accounts = { [T]: { paidUntil: NOW + 10 * 864e5 } };
  const msg = (from, body, id) => ({ from, id, type: "text", text: { body } });

  await t("vincular: con el código queda ese teléfono; uno vencido no", async () => {
    const { code, link } = await waOwner.linkCode(db, T, NOW);
    assert.match(code, /^[A-Z2-9]{6}$/);
    assert.ok(link.includes(encodeURIComponent(`VINCULAR ${code}`)));
    const expired = await waOwner.linkCode(db, T, NOW - 20 * 60e3);
    assert.strictEqual(await waOwner.onMessage(db, send, msg("5491100000000", `vincular ${expired.code.toLowerCase()}`), NOW), true);
    assert.match(sent.at(-1).text, /venció/);
    assert.ok(!db.cols.ventra_wa_owners || !db.cols.ventra_wa_owners["5491100000000"]);
    await waOwner.onMessage(db, send, msg("5491100000000", `VINCULAR ${code}`), NOW);
    assert.strictEqual(db.cols.ventra_wa_owners["5491100000000"].uid, T);
    assert.match(sent.at(-1).text, /Listo/);
    assert.ok(!db.cols.ventra_wa_links[code], "el código se usa una sola vez");
    const st = await waOwner.status(db, T);
    assert.strictEqual(st.linked, true);
    assert.strictEqual(st.phone, "•••• 0000");
  });
  await t("vincular otro teléfono reemplaza al anterior", async () => {
    const { code } = await waOwner.linkCode(db, T, NOW);
    await waOwner.onMessage(db, send, msg("5491122222222", `VINCULAR ${code}`), NOW);
    assert.deepStrictEqual(Object.keys(db.cols.ventra_wa_owners), ["5491122222222"]);
  });
  await t("un número que no es del dueño sigue como antes (clientes de la agenda)", async () => {
    assert.strictEqual(await waOwner.onMessage(db, send, msg("5491199999999", "hola, ¿cuánto vendí?"), NOW), false);
  });
  await t("la pregunta del dueño queda en la bandeja una sola vez aunque Meta reintente", async () => {
    const m = msg("5491122222222", "¿cuánto vendí hoy?", "wamid.ABC");
    assert.strictEqual(await waOwner.onMessage(db, send, m, NOW), true);
    assert.strictEqual(await waOwner.onMessage(db, send, m, NOW), true);
    assert.deepStrictEqual(Object.keys(db.cols.ventra_wa_owner_inbox), ["wamid.ABC"]);
    const audio = await waOwner.onMessage(db, send, { from: "5491122222222", id: "wamid.AUD", type: "audio" }, NOW);
    assert.strictEqual(audio, true);
    assert.match(sent.at(-1).text, /solo entiendo mensajes escritos/);
  });
  await t("responde con los datos de la nube, formato WhatsApp, y cuenta el uso", async () => {
    const client = fakeClient([q({ tipo: "ventas", desde: today, hasta: today })]);
    const item = db.cols.ventra_wa_owner_inbox["wamid.ABC"];
    await waOwner.processInbox(db, item, { ai, aiDeps: { db, logger, client }, sql, send, logger }, NOW);
    const last = sent.at(-1);
    assert.strictEqual(last.to, "5491122222222");
    assert.ok(last.text.startsWith("*Respuesta*"), "una sola estrella para la negrita");
    assert.ok(last.text.includes('"total":4500'));
    assert.ok(!/Datos hasta/.test(last.text), "datos frescos: sin aviso");
    // Plan con las consultas de WhatsApp (stock y caja) y respuesta con el formato de WhatsApp
    assert.ok(client.calls[0].output_config.format.schema.properties.queries.items.properties.tipo.enum.includes("caja"));
    assert.match(client.calls[1].system, /un asterisco/);
    const month = today.slice(0, 7);
    const usageDoc = Object.entries(db.cols.ventra_ai_usage || {}).find(([id]) => id === `${month}_${T}`);
    assert.ok(usageDoc && usageDoc[1].ask === 2, "una pregunta = dos usos");
    assert.strictEqual(db.cols.ventra_wa_owners["5491122222222"].questions, 1);
  });
  await t("la segunda pregunta lleva la anterior (para '¿y ayer?')", async () => {
    const client = fakeClient([q({ tipo: "ventas" })]);
    await waOwner.processInbox(db, { from: "5491122222222", uid: T, text: "¿y ayer?" }, { ai, aiDeps: { db, logger, client }, sql, send, logger }, NOW + 60e3);
    assert.match(client.calls[0].messages[0].content, /Pregunta anterior.*cuánto vendí hoy/);
  });
  await t("datos viejos: lo aclara; pregunta imposible: lo dice sin consultar", async () => {
    const client = fakeClient([q({ tipo: "ventas" })]);
    await waOwner.processInbox(db, { from: "5491122222222", uid: T, text: "ventas" }, { ai, aiDeps: { db, logger, client }, sql, send, logger }, NOW + 3 * 3600e3);
    assert.match(sent.at(-1).text, /Datos hasta el/);
    const none = fakeClient([]);
    await waOwner.processInbox(db, { from: "5491122222222", uid: T, text: "¿va a llover?" }, { ai, aiDeps: { db, logger, client: none }, sql, send, logger }, NOW);
    assert.strictEqual(sent.at(-1).text, "Eso no lo sé.");
    assert.strictEqual(none.calls.length, 1);
  });
  await t("plan vencido o tope del día: mensaje claro, sin consultar datos", async () => {
    db.cols.ventra_accounts[T] = { paidUntil: NOW - 30 * 864e5 };
    const client = fakeClient([q({ tipo: "ventas" })]);
    await waOwner.processInbox(db, { from: "5491122222222", uid: T, text: "ventas" }, { ai, aiDeps: { db, logger, client }, sql, send, logger }, NOW);
    assert.match(sent.at(-1).text, /vencido/);
    assert.strictEqual(client.calls.length, 0);
    db.cols.ventra_accounts[T] = { paidUntil: NOW + 864e5 };
    db.cols.ventra_ai_daily = { [`${today}_${T}`]: { ask: ai.DAILY.ask } };
    await waOwner.processInbox(db, { from: "5491122222222", uid: T, text: "ventas" }, { ai, aiDeps: { db, logger, client }, sql, send, logger }, NOW);
    assert.match(sent.at(-1).text, /tope de preguntas de hoy/);
    assert.strictEqual(client.calls.length, 0);
  });
  await t("desvincular por WhatsApp y desde la app", async () => {
    await waOwner.onMessage(db, send, msg("5491122222222", "desvincular"), NOW);
    assert.strictEqual((await waOwner.status(db, T)).linked, false);
    const { code } = await waOwner.linkCode(db, T, NOW);
    await waOwner.onMessage(db, send, msg("5491133333333", `VINCULAR ${code}`), NOW);
    await waOwner.unlink(db, T);
    assert.strictEqual(await waOwner.onMessage(db, send, msg("5491133333333", "¿cuánto vendí?"), NOW), false);
  });
  await t("negritas dobles de la IA quedan simples", async () => {
    assert.strictEqual(waOwner.waFormat("Vendiste **$ 4.500** hoy"), "Vendiste *$ 4.500* hoy");
  });

  console.log(`\n${ok} bien, ${bad} mal`);
  process.exit(bad ? 1 : 0);
})();
