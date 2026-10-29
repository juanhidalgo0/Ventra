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
const agent = require("../functions/ai-agent");

// Firestore falso: colecciones (y subcolecciones) con get/set/create/delete y where encadenado
const fakeDb = () => {
  const cols = {};
  const col = (name) => (cols[name] = cols[name] || {});
  const get = (o, k) => k.split(".").reduce((a, x) => (a == null ? a : a[x]), o);
  const OPS = { "==": (a, b) => a === b, ">=": (a, b) => a >= b, "<=": (a, b) => a <= b, "<": (a, b) => a < b, ">": (a, b) => a > b };
  const val = (x) => (x instanceof Date ? x.getTime() : x);
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
    collection: (sub) => collection(`${name}/${id}/${sub}`),
  });
  const query = (name, filters) => ({
    where: (f, op, v) => query(name, [...filters, [f, op, v]]),
    limit: () => query(name, filters),
    get: async () => {
      const docs = Object.entries(col(name))
        .filter(([, d]) => filters.every(([f, op, v]) => { const x = get(d, f); return x !== undefined && OPS[op](val(x), val(v)); }))
        .map(([id, d]) => ({ id, data: () => d, ref: docRef(name, id) }));
      return { docs, size: docs.length, forEach: (fn) => docs.forEach(fn) };
    },
  });
  const collection = (name) => ({ doc: (id) => docRef(name, id), where: (f, op, v) => query(name, [[f, op, v]]) });
  return { cols, collection };
};

// Claude falso con herramientas: la primera vuelta pide las herramientas de "calls"; la segunda
// responde con lo que devolvieron (así se ve que la respuesta sale de los datos)
const agentClient = (calls = [], finalText) => {
  const reqs = [];
  return {
    calls: reqs,
    messages: { create: async (req) => {
      reqs.push(JSON.parse(JSON.stringify(req)));
      if (reqs.length === 1 && calls.length) {
        return { stop_reason: "tool_use", usage: { input_tokens: 800, output_tokens: 60 },
          content: [{ type: "thinking", thinking: "", signature: "x" }, ...calls.map((c, i) => ({ type: "tool_use", id: `t${i}`, name: c.name, input: c.input || {} }))] };
      }
      const lastUser = req.messages[req.messages.length - 1];
      const data = Array.isArray(lastUser.content) ? lastUser.content.map((r) => r.content).join(" | ") : "";
      return { stop_reason: "end_turn", usage: { input_tokens: 900, output_tokens: 80 }, content: [{ type: "text", text: finalText || `**Respuesta** ${data}` }] };
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
  add("store_settings", "business_profile", { value: JSON.stringify("KIOSKO") });
  add("store_settings", "store_name", { value: JSON.stringify("Kiosco Paulos") });
  add("work_orders", "w1", { number: 7, status: "PENDIENTE", due_at: NOW - 2 * 864e5, total: 10000, deposit: 4000, client_id: "cl1", notes: "Tarjetas" });
  add("work_orders", "w2", { number: 8, status: "ENTREGADO", due_at: NOW, total: 500, deposit: 500 });
  add("product_lots", "l1", { product_id: "coca225", quantity: 6, status: "ACTIVE", expires_at: NOW + 3 * 864e5 });
  add("product_lots", "l2", { product_id: "coca15", quantity: 2, status: "ACTIVE", expires_at: NOW + 90 * 864e5 });
  // Control de anulaciones (la PC ya les puso el nivel)
  add("audit_logs", "v1", { entity_type: "POS_VOID", action: "CART_CLEARED", created_at: hourAgo, new_values: JSON.stringify({ amount: 6000, level: "sospechoso", userName: "Ana" }) });
  add("audit_logs", "v2", { entity_type: "POS_VOID", action: "ITEM_REMOVED", created_at: hourAgo, new_values: JSON.stringify({ amount: 1200, level: "revisar", userName: "Ana" }) });
  add("audit_logs", "v3", { entity_type: "POS_VOID", action: "QTY_REDUCED", created_at: hourAgo, new_values: JSON.stringify({ amount: 900, level: "normal", userName: "Ana" }) });
  add("audit_logs", "a1", { entity_type: "SALE", action: "CREATE", created_at: hourAgo, new_values: "{}" });
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

  await t("consultas nuevas: producto, anuladas, encargos, vencimientos, margen y rubro", async () => {
    const p = await run1(q({ tipo: "producto", buscar: "coca 1,5" }));
    assert.strictEqual(p.productos[0].margen, "44.44%");
    assert.deepStrictEqual(p.productos[0].vendidoUltimos30Dias, { unidades: 2, plata: 3600 });
    const a = await run1(q({ tipo: "anuladas", desde: today, hasta: today }));
    assert.strictEqual(a.anuladas, 1);
    assert.strictEqual(a.porUsuario[0].usuario, "Ana");
    const w = await run1(q({ tipo: "encargos", buscar: "atrasados" }));
    assert.strictEqual(w.abiertos, 1);
    assert.strictEqual(w.atrasados, 1);
    assert.strictEqual(w.porCobrar, 6000);
    assert.strictEqual(w.encargos[0].cliente, "Don Tito");
    const v = await run1(q({ tipo: "vencimientos", dias: 15 }));
    assert.deepStrictEqual(v.lotes.map((l) => l.producto), ["COCA-COLA 2,25 L"]);
    const m = await run1(q({ tipo: "margen_bajo" }));
    assert.strictEqual(m.conMenosDe15PorCiento, 0);
    const info = await insights.storeInfo(sql, T);
    assert.deepStrictEqual(info, { profile: "KIOSKO", name: "Kiosco Paulos" });
  });

  // ── La IA con herramientas ──
  const db = fakeDb();
  db.cols.ventra_accounts = { [T]: { paidUntil: NOW + 10 * 864e5, plan: "full" } };
  const aiDeps = (client) => ({ db, logger, client, sql });

  await t("herramientas según el plan y quién pregunta", async () => {
    const names = (ctx) => agent.toolsFor(ctx).map((x) => x.name);
    assert.ok(names({ plan: "full", role: "ADMIN" }).includes("margen_bajo"));
    assert.ok(!names({ plan: "full", role: "SUPERVISOR" }).includes("margen_bajo"), "el encargado no ve márgenes");
    assert.deepStrictEqual(names({ plan: "agenda", role: "ADMIN" }), ["turnos", "ayuda_ventra", "sin_respuesta"]);
    assert.deepStrictEqual(agent.scrub({ productos: [{ producto: "X", costo: 10, margen: "5%", precio: 20 }] }), { productos: [{ producto: "X", precio: 20 }] });
  });
  await t("busca los datos con herramientas, responde y cuenta una pregunta", async () => {
    const client = agentClient([{ name: "ventas", input: { desde: today, hasta: today } }, { name: "producto", input: { buscar: "coca 1,5" } }]);
    const out = await ai.handle(aiDeps(client), T, { kind: "agent", channel: "app", question: "¿cuánto vendí hoy y cuánta coca me queda?", plan: "full", info: { name: "Kiosco Paulos", profile: "KIOSKO" } });
    assert.ok(out.result.answer.includes('"total":4500') && out.result.answer.includes('"stock":3'));
    assert.strictEqual(client.calls.length, 2);
    // La vuelta siguiente lleva el pensamiento y las herramientas tal cual, y los resultados juntos
    assert.strictEqual(client.calls[1].messages.at(-2).content[0].type, "thinking");
    assert.strictEqual(client.calls[1].messages.at(-1).content.length, 2);
    assert.match(client.calls[0].system[0].text, /Kiosco Paulos/);
    assert.match(client.calls[0].system[0].text, /kiosco \/ almacén/);
    assert.ok(client.calls[0].tools.at(-1).cache_control, "las herramientas quedan en caché");
    const month = today.slice(0, 7);
    assert.strictEqual(db.cols.ventra_ai_usage[`${month}_${T}`].ask, 1, "una pregunta = un uso");
    assert.strictEqual(out.leftToday, ai.DAILY.ask - 1);
    assert.deepStrictEqual(out.limits, { daily: 30, monthly: 300 });
  });
  await t("el encargado no recibe costos aunque la herramienta los traiga", async () => {
    const client = agentClient([{ name: "producto", input: { buscar: "coca 1,5" } }]);
    const out = await ai.handle(aiDeps(client), T, { kind: "agent", channel: "app", question: "¿cuánto me sale la coca?", plan: "full", role: "SUPERVISOR" });
    assert.ok(!/"costo"|"margen"/.test(out.result.answer));
    assert.match(client.calls[0].system[0].text, /encargado/);
  });
  await t("lo que no supo responder queda registrado para revisar", async () => {
    const client = agentClient([{ name: "sin_respuesta", input: { motivo: "no hay datos del clima" } }], "Eso no lo sé, pero puedo decirte tus ventas.");
    await ai.handle(aiDeps(client), T, { kind: "agent", channel: "whatsapp", question: "¿va a llover?", plan: "full" });
    const misses = Object.values(db.cols.ventra_ai_misses || {});
    assert.strictEqual(misses.length, 1);
    assert.deepStrictEqual(misses[0].reasons, ["no hay datos del clima"]);
    assert.strictEqual(misses[0].question, "¿va a llover?");
  });
  await t("no da más de 5 vueltas", async () => {
    const reqs = [];
    const loop = { messages: { create: async (req) => { reqs.push(req); return req.tool_choice.type === "none"
      ? { stop_reason: "end_turn", content: [{ type: "text", text: "Listo" }], usage: {} }
      : { stop_reason: "tool_use", content: [{ type: "tool_use", id: `x${reqs.length}`, name: "caja", input: {} }], usage: {} }; } } };
    const out = await ai.handle(aiDeps(loop), T, { kind: "agent", channel: "app", question: "caja", plan: "full" });
    assert.strictEqual(out.result.answer, "Listo");
    assert.strictEqual(reqs.length, agent.MAX_ROUNDS);
  });
  await t("turnos y pedidos de la tienda salen de la agenda (Firestore)", async () => {
    db.cols.ventra_stores = { st1: { ownerUid: T, subdomain: "paulos" } };
    db.cols["ventra_stores/st1/bookings"] = {
      b1: { kind: "booking", dateKey: today, startMin: 600, customerName: "Lu", serviceName: "Corte", status: "CONFIRMED", price: 8000, deposit: { amount: 2000, status: "paid" } },
      b2: { kind: "booking", dateKey: today, startMin: 660, customerName: "Mati", serviceName: "Corte", status: "CANCELLED", price: 8000 },
      b3: { kind: "block", dateKey: today, startMin: 700 },
    };
    db.cols["ventra_stores/st1/orders"] = { o1: { createdAt: new Date(NOW - 3600e3), total: 5000, stage: "NEW", customerName: "Ana", items: [{ name: "Alfajor", quantity: 3 }] } };
    const { one } = insights.makeQueries(sql, T, { db });
    const b = await one(q({ tipo: "turnos" }));
    assert.strictEqual(b.turnos, 1);
    assert.strictEqual(b.cancelados, 1);
    assert.strictEqual(b.cobradoOnline, 2000);
    assert.strictEqual(b.detalle[0].hora, "10:00");
    const o = await one(q({ tipo: "pedidos_tienda", desde: today, hasta: today }));
    assert.strictEqual(o.sinAtender, 1);
    assert.deepStrictEqual(o.masPedidos, [{ producto: "Alfajor", unidades: 3 }]);
  });
  await t("bienvenida según el plan y el rubro, con el límite", async () => {
    const kiosco = agent.welcome({ plan: "full", profile: "KIOSKO", daily: 30, monthly: 300 });
    assert.match(kiosco, /Coca/); assert.match(kiosco, /\*30 preguntas por día\* \(300 por mes\)/);
    assert.match(agent.welcome({ plan: "agenda", daily: 30, monthly: 300 }), /turnos tengo mañana/);
    assert.match(agent.welcome({ plan: "full", profile: "IMPRENTA", daily: 30, monthly: 300 }), /encargos/);
    assert.match(agent.welcome({ plan: "full", profile: "DISTRIBUIDORA", daily: 30, monthly: 300 }), /reparto/);
    assert.match(agent.welcome({ plan: "tienda", daily: 30, monthly: 300, channel: "app" }), /\*\*30 preguntas por día\*\*/);
  });

  // ── Vincular y preguntar por WhatsApp ──
  const sent = [];
  const send = async (to, text) => { sent.push({ to, text }); };
  const msg = (from, body, id) => ({ from, id, type: "text", text: { body } });
  const OWNER = { userId: "u-duenio", role: "ADMIN", name: "Juan" };
  const inbox = () => db.cols.ventra_wa_owner_inbox || {};
  const runItem = async (id, client, now = NOW) => { const item = inbox()[id]; delete inbox()[id]; return waOwner.processInbox(db, item, { ai, aiDeps: aiDeps(client), sql, send, logger }, now); };

  await t("vincular: con el código queda ese teléfono, con bienvenida del rubro; uno vencido no", async () => {
    const { code, link } = await waOwner.linkCode(db, T, OWNER, NOW);
    assert.match(code, /^[A-Z2-9]{6}$/);
    assert.ok(link.includes(encodeURIComponent(`VINCULAR ${code}`)));
    const expired = await waOwner.linkCode(db, T, OWNER, NOW - 20 * 60e3);
    await waOwner.onMessage(db, send, msg("5491100000000", `vincular ${expired.code.toLowerCase()}`, "m0"), NOW);
    assert.match(sent.at(-1).text, /venció/);
    await waOwner.onMessage(db, send, msg("5491100000000", `VINCULAR ${code}`, "m1"), NOW);
    assert.strictEqual(db.cols.ventra_wa_owners["5491100000000"].uid, T);
    assert.ok(!db.cols.ventra_wa_links[code], "el código se usa una sola vez");
    await runItem("m1", agentClient());
    assert.match(sent.at(-1).text, /Listo.*Kiosco Paulos/);
    assert.match(sent.at(-1).text, /30 preguntas por día/);
    assert.match(sent.at(-1).text, /RESUMEN A LAS 21/);
    const st = await waOwner.status(db, T, OWNER);
    assert.strictEqual(st.linked, true);
    assert.strictEqual(st.phone, "•••• 0000");
  });
  await t("vincular otro teléfono reemplaza al anterior", async () => {
    const { code } = await waOwner.linkCode(db, T, OWNER, NOW);
    await waOwner.onMessage(db, send, msg("5491122222222", `VINCULAR ${code}`, "m2"), NOW);
    delete inbox().m2;
    assert.deepStrictEqual(Object.keys(db.cols.ventra_wa_owners), ["5491122222222"]);
  });
  await t("un número que no está vinculado sigue como antes (clientes de la agenda)", async () => {
    assert.strictEqual(await waOwner.onMessage(db, send, msg("5491199999999", "hola, ¿cuánto vendí?"), NOW), false);
  });
  await t("la pregunta queda en la bandeja una sola vez aunque Meta reintente; audios no", async () => {
    const m = msg("5491122222222", "¿cuánto vendí hoy?", "wamid.ABC");
    assert.strictEqual(await waOwner.onMessage(db, send, m, NOW), true);
    assert.strictEqual(await waOwner.onMessage(db, send, m, NOW), true);
    assert.deepStrictEqual(Object.keys(inbox()), ["wamid.ABC"]);
    await waOwner.onMessage(db, send, { from: "5491122222222", id: "wamid.AUD", type: "audio" }, NOW);
    assert.match(sent.at(-1).text, /solo entiendo mensajes escritos/);
  });
  await t("responde con los datos, formato WhatsApp, sin aviso si los datos son frescos", async () => {
    const client = agentClient([{ name: "ventas", input: { desde: today, hasta: today } }]);
    await runItem("wamid.ABC", client);
    const last = sent.at(-1);
    assert.strictEqual(last.to, "5491122222222");
    assert.ok(last.text.startsWith("*Respuesta*"), "una sola estrella para la negrita");
    assert.ok(last.text.includes('"total":4500'));
    assert.ok(!/Datos hasta/.test(last.text));
    assert.match(client.calls[0].system[0].text, /WhatsApp/);
    assert.strictEqual(db.cols.ventra_wa_owners["5491122222222"].questions, 1);
  });
  await t("la pregunta siguiente lleva la anterior (para '¿y ayer?')", async () => {
    await waOwner.onMessage(db, send, msg("5491122222222", "¿y ayer?", "m3"), NOW + 60e3);
    const client = agentClient([]);
    await runItem("m3", client, NOW + 60e3);
    assert.strictEqual(client.calls[0].messages[0].content, "¿cuánto vendí hoy?");
    assert.strictEqual(client.calls[0].messages[2].content, "¿y ayer?");
  });
  await t("datos viejos: lo aclara; pocas preguntas: avisa cuántas quedan", async () => {
    db.cols.ventra_ai_daily[`${today}_${T}`].ask = ai.DAILY.ask - 3;
    await waOwner.onMessage(db, send, msg("5491122222222", "ventas", "m4"), NOW + 3 * 3600e3);
    await runItem("m4", agentClient(), NOW + 3 * 3600e3);
    assert.match(sent.at(-1).text, /Datos hasta el/);
    assert.match(sent.at(-1).text, /Te quedan 2 preguntas por hoy/);
  });
  await t("plan vencido o tope del día: mensaje claro, sin llamar a la IA", async () => {
    db.cols.ventra_accounts[T].paidUntil = NOW - 30 * 864e5;
    const client = agentClient();
    await waOwner.onMessage(db, send, msg("5491122222222", "ventas", "m5"), NOW);
    await runItem("m5", client);
    assert.match(sent.at(-1).text, /vencido/);
    db.cols.ventra_accounts[T].paidUntil = NOW + 864e5;
    db.cols.ventra_ai_daily[`${today}_${T}`].ask = ai.DAILY.ask;
    await waOwner.onMessage(db, send, msg("5491122222222", "ventas", "m6"), NOW);
    await runItem("m6", client);
    assert.match(sent.at(-1).text, /tope de preguntas de hoy/);
    assert.strictEqual(client.calls.length, 0);
    db.cols.ventra_ai_daily[`${today}_${T}`].ask = 0;
  });
  await t("encargados: solo con permiso del dueño, y se van si se lo saca", async () => {
    const ENC = { userId: "u-enc", role: "SUPERVISOR", name: "Ana" };
    await assert.rejects(() => waOwner.linkCode(db, T, ENC, NOW), /no habilitó/);
    await waOwner.setSupervisors(db, T, true);
    const { code } = await waOwner.linkCode(db, T, ENC, NOW);
    await waOwner.onMessage(db, send, msg("5491144444444", `VINCULAR ${code}`, "m7"), NOW);
    await runItem("m7", agentClient());
    assert.match(sent.at(-1).text, /Listo, Ana/);
    assert.deepStrictEqual(Object.keys(db.cols.ventra_wa_owners).sort(), ["5491122222222", "5491144444444"], "el del dueño sigue");
    const st = await waOwner.status(db, T, OWNER);
    assert.deepStrictEqual(st.supervisors, [{ id: "4444", name: "Ana", phone: "•••• 4444" }]);
    await waOwner.onMessage(db, send, msg("5491144444444", "¿cuánto cuesta la coca?", "m8"), NOW);
    const client = agentClient([{ name: "producto", input: { buscar: "coca 1,5" } }]);
    await runItem("m8", client);
    assert.ok(!client.calls[0].tools.some((x) => x.name === "margen_bajo"));
    assert.ok(!/"costo"/.test(sent.at(-1).text));
    await waOwner.unlink(db, T, OWNER, "4444");
    assert.deepStrictEqual(Object.keys(db.cols.ventra_wa_owners), ["5491122222222"], "el dueño desvincula al encargado");
    const again = await waOwner.linkCode(db, T, ENC, NOW);
    await waOwner.onMessage(db, send, msg("5491144444444", `VINCULAR ${again.code}`, "m9"), NOW);
    delete inbox().m9;
    await waOwner.setSupervisors(db, T, false);
    assert.deepStrictEqual(Object.keys(db.cols.ventra_wa_owners), ["5491122222222"], "al sacar el permiso se desvinculan");
  });
  await t("resumen del día: se pide por WhatsApp, gratis dentro de las 24 h y con plantilla después", async () => {
    await waOwner.onMessage(db, send, msg("5491122222222", "Resumen a las 21", "m10"), NOW);
    assert.match(sent.at(-1).text, /a las \*21 h\*/);
    assert.deepStrictEqual(db.cols.ventra_wa_owners["5491122222222"].summary, { enabled: true, hour: 21 });
    const at21 = new Date(`${today}T21:05:00-03:00`).getTime();
    const texts = [], templates = [];
    const deps = { sql, logger, sendText: async (to, x) => texts.push({ to, x }), sendTemplate: async (to, tpl, params) => templates.push({ to, tpl, params }) };
    db.cols.ventra_wa_owners["5491122222222"].lastInboundAt = at21 - 3600e3;
    assert.strictEqual(await waOwner.dailySummaries(db, deps, at21), 1);
    assert.match(texts[0].x, /Hoy vendiste \$ 4\.500\* en 2 ventas/);
    assert.match(texts[0].x, /caja abierta/);
    assert.match(texts[0].x, /Anulaciones: 3 \(\$ 8\.100 quitado de los tickets\), 1 sospechosa: Ana \(1\), 1 para revisar/);
    assert.ok(!/Anulaciones/.test((await waOwner.summaryText(sql, T, at21, false)).text), "el encargado no ve el control de anulaciones");
    db.cols.ventra_wa_owners["5491122222222"].lastInboundAt = at21 - 30 * 3600e3;
    await waOwner.dailySummaries(db, deps, at21);
    assert.strictEqual(templates[0].tpl.name, "resumen_diario");
    assert.deepStrictEqual(templates[0].params.slice(0, 2), ["$ 4.500", "2"]);
    assert.strictEqual(await waOwner.dailySummaries(db, deps, at21 + 3600e3), 0, "a las 22 no le toca");
    await waOwner.onMessage(db, send, msg("5491122222222", "sin resumen", "m11"), NOW);
    assert.strictEqual(db.cols.ventra_wa_owners["5491122222222"].summary.enabled, false);
  });
  await t("desvincular por WhatsApp y desde la app", async () => {
    await waOwner.onMessage(db, send, msg("5491122222222", "desvincular"), NOW);
    assert.strictEqual((await waOwner.status(db, T, OWNER)).linked, false);
    const { code } = await waOwner.linkCode(db, T, OWNER, NOW);
    await waOwner.onMessage(db, send, msg("5491133333333", `VINCULAR ${code}`, "m12"), NOW);
    await waOwner.unlink(db, T, OWNER);
    assert.strictEqual(await waOwner.onMessage(db, send, msg("5491133333333", "¿cuánto vendí?"), NOW), false);
  });
  await t("negritas dobles de la IA quedan simples", async () => {
    assert.strictEqual(waOwner.waFormat("Vendiste **$ 4.500** hoy"), "Vendiste *$ 4.500* hoy");
  });

  console.log(`\n${ok} bien, ${bad} mal`);
  process.exit(bad ? 1 : 0);
})();
