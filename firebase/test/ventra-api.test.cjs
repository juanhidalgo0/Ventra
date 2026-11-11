// El bot hace cualquier operación del sistema (functions/ventra-api + wa-owner.js): Firestore,
// WhatsApp, Claude y la caja en la nube falsos. Sin red.
//   node firebase/test/ventra-api.test.cjs
const assert = require("assert");
const admin = require("../functions/node_modules/firebase-admin");
admin.firestore.FieldValue.increment = (n) => ({ operand: n });
admin.firestore.FieldValue.serverTimestamp = () => "ts";
const ai = require("../functions/ai");
const waOwner = require("../functions/wa-owner");
const api = require("../functions/ventra-api");

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
  const query = () => ({ where() { return this; }, get: async () => ({ docs: [], empty: true, forEach() {} }) });
  return { cols, collection: (name) => ({ doc: (id) => docRef(name, id), where: query }) };
};
// Claude falso: cada vuelta pide las herramientas de la lista que toca; al final contesta
const client = (rounds = [], final = "Te paso la operación para que la confirmes.") => {
  const reqs = [];
  return {
    reqs,
    messages: { create: async (req) => {
      reqs.push(JSON.parse(JSON.stringify(req)));
      const calls = rounds[reqs.length - 1];
      if (calls && calls.length) return { stop_reason: "tool_use", usage: {}, content: calls.map((c, i) => ({ type: "tool_use", id: `t${reqs.length}_${i}`, name: c.name, input: c.input || {} })) };
      return { stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: final }] };
    } },
  };
};
// La caja en la nube falsa: guarda lo que le piden
const fakeCloud = (handler) => {
  const calls = [];
  return { calls, call: async (uid, list) => { calls.push({ uid, list }); return list.map((c) => handler(c)); } };
};
const logger = { warn() {}, error(...a) { console.log("   [error]", ...a); }, info() {} };
const sqlNone = { query: async () => [] };

const T = "tenant1", PHONE = "5492215550000", NOW = Date.now();
let ok = 0, bad = 0;
const t = async (name, fn) => { try { await fn(); ok++; console.log(`ok    ${name}`); } catch (e) { bad++; console.log(`FALLA ${name}\n      ${e.stack || e.message}`); } };

(async () => {
  // ── Catálogo ──
  await t("catálogo: tiene las operaciones del sistema y no ofrece lo protegido", async () => {
    const c = api.loadCatalog();
    assert.ok(c.entries.length > 200);
    assert.ok(c.entries.find((e) => e.id === "POST /api/cash/open").code.includes("openingAmount"));
    assert.match(api.detail("POST /api/auth/login").error, /protegida/);
    assert.match(api.detail("GET /api/product-images/:id").error, /archivo/);
    assert.ok(!api.search("cambiar la contraseña del usuario").some((r) => r.id.startsWith("POST /api/auth")));
  });
  await t("búsqueda: lo que pide el dueño con sus palabras", async () => {
    const top = (q) => api.search(q, 3).map((r) => r.id);
    assert.ok(top("abrir la caja con 5000").includes("POST /api/cash/open"));
    assert.ok(top("anotale una deuda a Don Tito de 3000").includes("POST /api/clients/:id/movement"));
    assert.ok(top("dar de alta un producto nuevo").includes("POST /api/products"));
    assert.ok(top("borrar la categoria golosinas").includes("DELETE /api/categories/:id"));
    assert.ok(top("crear un presupuesto para Juan").includes("POST /api/quotes"));
  });

  // ── Por WhatsApp ──
  const db = fakeDb();
  db.cols.ventra_accounts = { [T]: { plan: "full", paidUntil: NOW + 864e5 } };
  db.cols[waOwner.OWNERS] = { [PHONE]: { uid: T, userId: "u1", role: "ADMIN", lastInboundAt: NOW } };
  const sent = [];
  const cloud = fakeCloud((c) => {
    if (c.method === "GET" && c.path === "/api/clients") return { status: 200, body: [{ id: "cl-tito", name: "Don Tito", balance: 12500 }] };
    if (c.method === "POST" && c.path === "/api/clients/cl-tito/movement") return { status: 201, body: { id: "mov1", balance: 15500 } };
    if (c.method === "POST" && c.path === "/api/cash/open") return { status: 400, body: { message: "Ya tenés una caja abierta" } };
    return { status: 404, body: { message: "No existe" } };
  });
  const deps = (cl) => ({
    ai, aiDeps: { db, logger, sql: sqlNone, client: cl }, sql: sqlNone, logger, ventraApi: cloud,
    send: async (to, text) => { sent.push({ to, text }); },
    sendButtons: async (to, text, buttons) => { sent.push({ to, text, buttons }); },
  });
  const inbox = () => db.cols[waOwner.INBOX] || {};
  const drain = async (cl, now = NOW) => { for (const id of Object.keys(inbox())) { const item = inbox()[id]; delete inbox()[id]; await waOwner.processInbox(db, item, deps(cl), now); } };
  const say = async (body, id, cl, now = NOW) => { await waOwner.onMessage(db, async () => {}, { from: PHONE, id, type: "text", text: { body } }, now); await drain(cl, now); };
  const tap = async (payload, id, now = NOW) => { await waOwner.onMessage(db, async () => {}, { from: PHONE, id, type: "interactive", interactive: { button_reply: { id: payload } } }, now); await drain(null, now); };

  const deudaRounds = [
    [{ name: "buscar_operacion", input: { texto: "anotar deuda cliente" } }],
    [{ name: "ver_operacion", input: { id: "POST /api/clients/:id/movement" } }, { name: "consultar", input: { id: "GET /api/clients", filtros: {} } }],
    [{ name: "operar", input: { id: "POST /api/clients/:id/movement", parametros: { id: "cl-tito" }, datos: { type: "DEBT", amount: 3000, description: "Fiado" }, resumen: "Anotarle a Don Tito una deuda de $ 3.000 (Fiado)" } }],
  ];

  await t("pide algo del sistema: busca, mira, consulta y propone; no ejecuta nada sin confirmar", async () => {
    const cl = client(deudaRounds);
    await say("anotale a Don Tito una deuda de 3000", "m1", cl);
    const names = cl.reqs[0].tools.map((x) => x.name);
    for (const n of ["buscar_operacion", "ver_operacion", "consultar", "operar"]) assert.ok(names.includes(n), n);
    // El detalle de la operación le llegó a la IA con el código (campos type/amount)
    const toolResults = cl.reqs[2].messages.at(-1).content.map((r) => r.content).join(" ");
    assert.match(toolResults, /DEBT/);
    assert.match(toolResults, /Don Tito/, "consultó el cliente de verdad");
    assert.deepStrictEqual(cloud.calls.map((c) => c.list[0].method), ["GET"], "solo leyó");
    const m = sent.at(-1);
    assert.match(m.text, /Anotarle a Don Tito una deuda de \$ 3\.000/);
    assert.deepStrictEqual(m.buttons.map((b) => b.title), ["Confirmar", "Cancelar"]);
    assert.ok(db.cols[waOwner.OWNERS][PHONE].pendingOp);
  });
  await t("confirma: lo hace en la caja con la ruta y los datos exactos", async () => {
    const payload = sent.at(-1).buttons[0].id;
    await tap(payload, "b1", NOW + 30e3);
    const last = cloud.calls.at(-1).list[0];
    assert.deepStrictEqual([last.method, last.path, last.body], ["POST", "/api/clients/cl-tito/movement", { type: "DEBT", amount: 3000, description: "Fiado" }]);
    assert.match(sent.at(-2).text, /Haciéndolo/);
    assert.match(sent.at(-1).text, /✅ Listo: Anotarle a Don Tito una deuda de \$ 3\.000 \(Fiado\) \(saldo \$15\.500\)/);
    await tap(payload, "b2", NOW + 31e3);
    assert.match(sent.at(-1).text, /ya está hecha/);
    assert.strictEqual(cloud.calls.filter((c) => c.list[0].method === "POST").length, 1, "el botón repetido no la hace dos veces");
  });
  await t("'sí' escrito confirma lo último propuesto; 'no' lo cancela", async () => {
    await say("anotale otra deuda igual", "m2", client(deudaRounds), NOW + 60e3);
    const before = cloud.calls.length;
    await say("Sí, dale", "m3", null, NOW + 70e3);
    assert.strictEqual(cloud.calls.length, before + 1);
    await say("anotale otra más", "m4", client(deudaRounds), NOW + 80e3);
    await say("no", "m5", null, NOW + 90e3);
    assert.match(sent.at(-1).text, /no hice nada/);
  });
  await t("si la caja dice que no, le llega el motivo del sistema", async () => {
    await say("abrí la caja con 5000", "m6", client([[{ name: "operar", input: { id: "POST /api/cash/open", datos: { terminalName: "Caja 1", openingAmount: 5000 }, resumen: "Abrir la Caja 1 con $ 5.000" } }]]), NOW + 100e3);
    await tap(sent.at(-1).buttons[0].id, "b3", NOW + 110e3);
    assert.match(sent.at(-1).text, /No se pudo: Ya tenés una caja abierta/);
  });
  await t("borrar avisa que no se puede deshacer; consultar no escribe; operar no lee", async () => {
    await say("borrá la categoría golosinas", "m7", client([[{ name: "operar", input: { id: "DELETE /api/categories/:id", parametros: { id: "cat1" }, resumen: "Borrar la categoría Golosinas" } }]]), NOW + 120e3);
    assert.match(sent.at(-1).text, /no se puede deshacer/);
    const s = api.session({ api: cloud, uid: T });
    assert.match((await s.call("consultar", { id: "POST /api/clients" })).error, /solo para leer/);
    assert.match((await s.call("operar", { id: "GET /api/clients", resumen: "x" })).error, /solo lee/);
    assert.match((await s.call("operar", { id: "POST /api/clients/:id/movement", resumen: "x" })).error, /Falta id/);
    assert.match((await s.call("operar", { id: "POST /api/auth/login", resumen: "x" })).error, /protegida/);
  });
  await t("caja en la nube preparándose: avisa y la propuesta sigue en pie", async () => {
    const prep = { calls: [], call: async () => { throw Object.assign(new Error("Estoy preparando la caja en la nube de este comercio."), { preparing: true }); } };
    const db2 = fakeDb();
    const id = await api.save(db2, { uid: T, from: PHONE, op: { id: "POST /api/cash/open", method: "POST", path: "/api/cash/open", body: {}, summary: "Abrir caja" } }, NOW);
    const r = await api.act(db2, prep, { action: "ok", id, from: PHONE, uid: T }, NOW + 1000);
    assert.match(r.text, /preparando.*Confirmar/);
    assert.strictEqual(db2.cols[api.OPS][id].status, "pending");
  });
  await t("vencida o de otro teléfono: no se hace", async () => {
    const db2 = fakeDb();
    const id = await api.save(db2, { uid: T, from: PHONE, op: { id: "x", method: "POST", path: "/api/clients", body: {}, summary: "x" } }, NOW);
    assert.match((await api.act(db2, cloud, { action: "ok", id, from: "otro", uid: T }, NOW)).text, /no es tuya/);
    assert.match((await api.act(db2, cloud, { action: "ok", id, from: PHONE, uid: T }, NOW + api.PENDING_MS + 1)).text, /Pasaron más de 30 minutos/);
  });
  await t("el encargado no tiene estas herramientas", async () => {
    db.cols[waOwner.OWNERS][PHONE].role = "SUPERVISOR";
    db.cols.ventra_wa_settings = { [T]: { supervisors: true } };
    const cl = client([], "Eso lo hace el dueño.");
    await say("abrí la caja", "m8", cl, NOW + 200e3);
    assert.ok(!cl.reqs[0].tools.some((x) => x.name === "operar"));
    db.cols[waOwner.OWNERS][PHONE].role = "ADMIN";
  });
  await t("sin la caja en la nube configurada, el bot sigue como antes", async () => {
    const cl = client([], "Hola");
    const item = { from: PHONE, uid: T, type: "question", text: "hola" };
    await waOwner.processInbox(db, item, { ...deps(cl), ventraApi: null }, NOW + 300e3);
    assert.ok(!cl.reqs[0].tools.some((x) => x.name === "operar"));
  });

  console.log(`\n${ok} bien, ${bad} mal`);
  process.exit(bad ? 1 : 0);
})();
