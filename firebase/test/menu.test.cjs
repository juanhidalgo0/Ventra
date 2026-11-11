// Menú del WhatsApp del dueño (functions/wa-owner-menu.js + wa-owner.js): Firestore, WhatsApp,
// Claude y las consultas a la base falsos. Sin red.
//   node firebase/test/menu.test.cjs
const assert = require("assert");
const admin = require("../functions/node_modules/firebase-admin");
admin.firestore.FieldValue.increment = (n) => ({ operand: n });
admin.firestore.FieldValue.serverTimestamp = () => "ts";
const ai = require("../functions/ai");
const insights = require("../functions/insights-cloud");
const waOwner = require("../functions/wa-owner");
const menu = require("../functions/wa-owner-menu");

// Las consultas a la base: respuestas de ejemplo por tipo (y cuántas veces se pidieron)
const asked = [];
insights.runQueries = async (sql, uid, qs) => qs.map((q) => {
  asked.push(q.tipo);
  if (q.tipo === "ventas" && q.agrupar === "medio_de_pago") return { consulta: q.tipo, total: 4500, porMedioDePago: [{ medio: "Efectivo", monto: 3600 }, { medio: "Mercado Pago", monto: 900 }] };
  if (q.tipo === "ventas") return { consulta: q.tipo, total: 4500, ventas: 2, ticketPromedio: 2250 };
  if (q.tipo === "deudores") return { consulta: q.tipo, clientesQueDeben: 1, totalAdeudado: 12500, clientes: [{ cliente: "Don Tito", debe: 12500, limite: 10000, pasoElLimite: true }] };
  if (q.tipo === "caja") return { consulta: q.tipo, cajasAbiertas: [{ caja: "Caja 1", cajero: "Ana", abiertaDesde: "11/11, 08:00", ventas: 2, vendido: 4500, efectivoQueDeberiaHaber: 13600 }], ultimosCierres: [{ caja: "Caja 1", cajero: "Ana", cerrada: "10/11, 21:00", diferencia: -200 }] };
  if (q.tipo === "stock_bajo") return { consulta: q.tipo, sinStock: 1, enElMinimo: 1, productos: [{ producto: "ALFAJOR TRIPLE", stock: 0, minimo: 0 }, { producto: "COCA 1,5", stock: 3, minimo: 6 }] };
  if (q.tipo === "ultimas_ventas") return { consulta: q.tipo, ventas: [{ venta: 1532, total: 3600, cajero: "Ana", hora: "11/11, 10:05", productos: ["2 × COCA 1,5"] }] };
  if (q.tipo === "turnos") return { consulta: q.tipo, turnos: 1, cancelados: 0, detalle: [{ hora: "10:00", cliente: "Marta", servicio: "Corte", estado: "confirmado" }] };
  return { consulta: q.tipo, error: "Sin datos" };
});
insights.lastSync = async () => new Date().toISOString();

const fakeDb = () => {
  const cols = {};
  const col = (name) => (cols[name] = cols[name] || {});
  const docRef = (name, id) => ({
    id,
    get: async () => ({ id, exists: id in col(name), data: () => col(name)[id], ref: docRef(name, id) }),
    set: async (v, opt) => { const cur = opt && opt.merge ? { ...(col(name)[id] || {}) } : {}; for (const [k, x] of Object.entries(v)) cur[k] = x && x.operand !== undefined ? (cur[k] || 0) + x.operand : x; col(name)[id] = cur; },
    create: async (v) => { if (id in col(name)) throw Object.assign(new Error("ALREADY_EXISTS"), { code: 6 }); col(name)[id] = v; },
    delete: async () => { delete col(name)[id]; },
  });
  return { cols, collection: (name) => ({ doc: (id) => docRef(name, id), where() { return { where() { return this; }, get: async () => ({ docs: [], empty: true, forEach() {} }) }; } }) };
};
const client = (final = "Listo.") => {
  const reqs = [];
  return { reqs, messages: { create: async (req) => { reqs.push(JSON.parse(JSON.stringify(req))); return { stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: final }] }; } } };
};
const logger = { warn() {}, error(...a) { console.log("   [error]", ...a); }, info() {} };
const sql = { query: async () => [] };
const T = "tenant1", PHONE = "5492215550000", NOW = Date.now();
let ok = 0, bad = 0;
const t = async (name, fn) => { try { await fn(); ok++; console.log(`ok    ${name}`); } catch (e) { bad++; console.log(`FALLA ${name}\n      ${e.stack || e.message}`); } };

(async () => {
  const rowsOf = (secs) => secs.flatMap((s) => s.rows);
  await t("la lista nunca pasa de 10 renglones ni de los largos de WhatsApp", async () => {
    for (const plan of ["full", "caja", "tienda", "agenda", "agenda_pro", null]) for (const role of ["ADMIN", "SUPERVISOR"]) for (const page of ["main", "mas"]) {
      const rows = rowsOf(menu.sections({ plan, role, page }));
      assert.ok(rows.length >= 1 && rows.length <= 10, `${plan}/${role}/${page}: ${rows.length}`);
      for (const r of rows) assert.ok(r.title.length <= 24 && (r.description || "").length <= 72 && r.id.startsWith("m|"), r.title);
    }
  });
  await t("el encargado no ve las opciones que cambian cosas; la agenda ve sus turnos", async () => {
    const sup = rowsOf(menu.sections({ plan: "full", role: "SUPERVISOR" })).map((r) => r.id);
    assert.ok(sup.includes("m|ventas_hoy") && !sup.includes("m|crear_producto") && !sup.includes("m|fiado"));
    assert.deepStrictEqual(rowsOf(menu.sections({ plan: "agenda", role: "ADMIN" })).map((r) => r.id), ["m|turnos_hoy", "m|turnos_manana", "m|otra_cosa"]);
  });

  const db = fakeDb();
  db.cols.ventra_accounts = { [T]: { plan: "full", paidUntil: NOW + 864e5 } };
  db.cols[waOwner.OWNERS] = { [PHONE]: { uid: T, userId: "u1", role: "ADMIN", lastInboundAt: NOW } };
  const sent = [], lists = [], typing = [];
  const io = { typing: async (id) => typing.push(id), sendList: async (to, text, button, sections) => { lists.push({ to, text, button, sections }); } };
  const deps = (cl) => ({ ai, aiDeps: { db, logger, sql, client: cl }, sql, logger, send: async (to, text) => { sent.push(text); }, sendButtons: async (to, text) => { sent.push(text); }, sendList: io.sendList });
  const inbox = () => db.cols[waOwner.INBOX] || {};
  const drain = async (cl, now = NOW) => { for (const id of Object.keys(inbox())) { const item = inbox()[id]; delete inbox()[id]; await waOwner.processInbox(db, item, deps(cl), now); } };
  const say = async (body, id, cl, now = NOW, ioUsed = io) => { await waOwner.onMessage(db, async () => {}, { from: PHONE, id, type: "text", text: { body } }, now, ioUsed); await drain(cl, now); };
  const pick = async (option, id, cl, now = NOW) => { await waOwner.onMessage(db, async () => {}, { from: PHONE, id, type: "interactive", interactive: { type: "list_reply", list_reply: { id: `m|${option}`, title: "x" } } }, now, io); await drain(cl, now); };

  await t("'MENÚ' abre la lista al instante (desde el webhook) y marca 'escribiendo…'", async () => {
    const cl = client();
    await say("Menú", "wamid.M1", cl);
    assert.deepStrictEqual(typing, ["wamid.M1"]);
    assert.strictEqual(lists.length, 1);
    assert.strictEqual(lists[0].button, "Ver opciones");
    assert.ok(rowsOf(lists[0].sections).some((r) => r.id === "m|mas"));
    assert.strictEqual(cl.reqs.length, 0, "sin IA");
    await say("ayuda", "wamid.M2", cl);
    assert.strictEqual(lists.length, 2);
  });
  await t("'Más opciones' abre la segunda lista", async () => {
    await pick("mas", "l0");
    assert.strictEqual(lists.at(-1).button, "Más opciones");
    assert.ok(rowsOf(lists.at(-1).sections).some((r) => r.id === "m|compra"));
  });
  await t("ver: ventas de hoy, al instante y sin IA", async () => {
    const cl = client();
    await pick("ventas_hoy", "l1", cl);
    assert.strictEqual(cl.reqs.length, 0);
    assert.match(sent.at(-1), /\*Ventas de hoy: \$ 4\.500\* en 2 tickets \(promedio \$ 2\.250\)/);
    assert.match(sent.at(-1), /- Efectivo: \$ 3\.600\n- Mercado Pago: \$ 900/);
    assert.match(sent.at(-1), /Escribí \*MENÚ\* para ver más opciones/);
  });
  await t("ver: deudas, cajas, reponer y últimas ventas", async () => {
    await pick("deudas", "l2");
    assert.match(sent.at(-1), /\*Te deben \$ 12\.500\* entre 1 cliente\.\n- Don Tito: \*\$ 12\.500\* ⚠️ pasó su límite/);
    await pick("cajas", "l3");
    assert.match(sent.at(-1), /\*Caja 1\* \(Ana\), abierta desde 11\/11, 08:00: vendió \$ 4\.500 en 2; debería haber \$ 13\.600/);
    assert.match(sent.at(-1), /diferencia \*-\$ 200\*/);
    await pick("reponer", "l4");
    assert.match(sent.at(-1), /\*1 sin stock\* y \*1 en el mínimo\*/);
    await pick("ultimas_ventas", "l5");
    assert.match(sent.at(-1), /N° 1532 · \*\$ 3\.600\* · Ana\n  2 × COCA 1,5/);
  });
  await t("hacer: pide los datos y lo que contesta va a la IA con esa intención (una sola vez)", async () => {
    await pick("crear_producto", "l6");
    assert.match(sent.at(-1), /Decime el \*nombre\*, el \*precio de venta\*/);
    const cl = client("Te paso el producto para que lo confirmes.");
    await say("Alfajor Jorgito triple 1200", "m3", cl, NOW + 30e3);
    assert.strictEqual(cl.reqs[0].messages.at(-1).content, "[Eligió en el menú: Crear producto] Alfajor Jorgito triple 1200");
    const cl2 = client();
    await say("¿cuánto vendí ayer?", "m4", cl2, NOW + 60e3);
    assert.strictEqual(cl2.reqs[0].messages.at(-1).content, "¿cuánto vendí ayer?", "la intención ya se usó");
  });
  await t("la intención vence a los 15 minutos", async () => {
    await pick("fiado", "l7", null, NOW + 100e3);
    const cl = client();
    await say("Don Tito 3000", "m5", cl, NOW + 100e3 + menu.INTENT_MS + 1000);
    assert.strictEqual(cl.reqs[0].messages.at(-1).content, "Don Tito 3000");
  });
  await t("el encargado no puede elegir 'hacer' aunque mande el renglón", async () => {
    db.cols[waOwner.OWNERS][PHONE].role = "SUPERVISOR";
    db.cols.ventra_wa_settings = { [T]: { supervisors: true } };
    await pick("crear_producto", "l8");
    assert.match(sent.at(-1), /Eso lo hace el dueño/);
    db.cols[waOwner.OWNERS][PHONE].role = "ADMIN";
  });
  await t("la primera respuesta del día de la IA recuerda el menú; las siguientes no", async () => {
    db.cols[waOwner.OWNERS][PHONE].menuHintDay = null;
    await say("hola", "m6", client("¡Hola!"), NOW + 200e3);
    assert.match(sent.at(-1), /Escribí \*MENÚ\* para ver todo lo que puedo hacer/);
    await say("gracias", "m7", client("De nada."), NOW + 210e3);
    assert.ok(!/MENÚ/.test(sent.at(-1)));
  });
  await t("sin lista en el webhook, la bandeja la manda igual", async () => {
    const before = lists.length;
    await say("menu", "m8", client(), NOW + 300e3, {});
    assert.strictEqual(lists.length, before + 1);
  });
  await t("el despertador no hace nada (ni lee la cuenta)", async () => {
    const before = asked.length;
    assert.strictEqual(await waOwner.processInbox({ collection() { throw new Error("no debería leer"); } }, { type: "warm" }, deps(client())), null);
    assert.strictEqual(asked.length, before);
  });

  console.log(`\n${ok} bien, ${bad} mal`);
  process.exit(bad ? 1 : 0);
})();
