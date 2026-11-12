// El dueño cambia precios por WhatsApp (functions/wa-owner-edits.js + wa-owner.js): Postgres en
// memoria (PGlite) con el esquema real de la sincronización, Firestore, WhatsApp y Claude falsos.
//   node firebase/test/wa-owner-edits.test.cjs
const assert = require("assert");
const { PGlite } = require("../../tools/sync-sim/node_modules/@electric-sql/pglite");
const admin = require("../functions/node_modules/firebase-admin");
admin.firestore.FieldValue.increment = (n) => ({ operand: n });
admin.firestore.FieldValue.serverTimestamp = () => "ts";
const ai = require("../functions/ai");
const cloudSync = require("../functions/sync");
const waOwner = require("../functions/wa-owner");
const edits = require("../functions/wa-owner-edits");
const agent = require("../functions/ai-agent");

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
  return { cols, collection: (name) => ({ doc: (id) => docRef(name, id), where: () => ({ get: async () => ({ docs: [], forEach() {} }) }) }) };
};

// Claude falso: la primera vuelta pide cambiar_productos con `input`; la segunda contesta
const editClient = (input, finalText = "Te paso los cambios para que los confirmes.") => {
  const reqs = [];
  return {
    reqs,
    messages: { create: async (req) => {
      reqs.push(JSON.parse(JSON.stringify(req)));
      if (reqs.length === 1 && input) return { stop_reason: "tool_use", usage: {}, content: [{ type: "tool_use", id: "t0", name: "cambiar_productos", input }] };
      return { stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: finalText }] };
    } },
  };
};
const logger = { warn() {}, error(...a) { console.log("   [error]", ...a); }, info() {} };

const T = "tenant1";
const PHONE = "5492215550000";
const NOW = Date.now();

async function seed(pg, sql) {
  await cloudSync.ensureSchema(sql);
  const rows = [];
  const add = (tbl, id, data) => rows.push({ t: tbl, id, d: { id, ...data }, ts: NOW - 86400e3 });
  add("users", "u-duenio", { username: "JUAN", full_name: "Juan" });
  add("categories", "c1", { name: "Gaseosas" });
  add("categories", "c2", { name: "Golosinas" });
  add("products", "coca15", { name: "COCA-COLA 1,5 L", stock: 3, sale_price: 1800, cost_price: 1000, is_active: 1, unit: "UNIT", category_id: "c1", updated_at: NOW - 86400e3, barcode: "7790895000997" });
  add("products", "coca225", { name: "COCA-COLA 2,25 L", stock: 10, sale_price: 2600, cost_price: 1500, is_active: 1, unit: "UNIT", category_id: "c1", updated_at: NOW - 86400e3 });
  add("products", "sprite", { name: "SPRITE 1,5 L", stock: 4, sale_price: 1555, is_active: 1, unit: "UNIT", category_id: "c1", updated_at: NOW - 86400e3 });
  add("products", "alfajor", { name: "ALFAJOR TRIPLE", stock: 0, sale_price: 900, is_active: 1, unit: "UNIT", category_id: "c2", updated_at: NOW - 86400e3 });
  add("products", "asado", { name: "ASADO", stock: 12.5, sale_price: 9000, is_active: 1, unit: "KG", updated_at: NOW - 86400e3 });
  add("products", "viejo", { name: "TURRON VIEJO", stock: 0, sale_price: 300, is_active: 0, unit: "UNIT", updated_at: NOW - 86400e3 });
  await cloudSync.push(sql, T, "pc-local", rows);
  // Otro comercio con un producto que se llama igual: nunca se toca
  await cloudSync.push(sql, "otro", "pc-otro", [{ t: "products", id: "coca15", d: { id: "coca15", name: "COCA-COLA 1,5 L", sale_price: 1, is_active: 1 }, ts: NOW - 86400e3 }]);
}

const product = async (sql, id, tenant = T) => {
  const r = await cloudSync.run(sql, `SELECT data, device_id FROM sync_rows WHERE tenant_id = $1 AND tbl = 'products' AND id = $2`, [tenant, id]);
  return { ...r[0].data, _device: r[0].device_id };
};

let ok = 0, bad = 0;
const t = async (name, fn) => { try { await fn(); ok++; console.log(`ok    ${name}`); } catch (e) { bad++; console.log(`FALLA ${name}\n      ${e.stack || e.message}`); } };

(async () => {
  const pg = new PGlite();
  const sql = { query: async (text, params) => (await pg.query(text, params)).rows };
  await seed(pg, sql);

  // ── La propuesta (sin tocar nada) ──
  await t("precio puntual por nombre o código: propuesta lista, sin escribir", async () => {
    const r = await edits.prepare(sql, T, { cambios: [{ buscar: "coca 1,5", precio: 2800 }] });
    assert.strictEqual(r.result.listo, true);
    assert.deepStrictEqual(r.plan.items.map((i) => [i.id, i.oldPrice, i.newPrice]), [["coca15", 1800, 2800]]);
    const b = await edits.prepare(sql, T, { cambios: [{ buscar: "7790895000997", precio: 2000 }] });
    assert.strictEqual(b.plan.items[0].id, "coca15");
    assert.strictEqual((await product(sql, "coca15")).sale_price, 1800);
  });
  await t("varios parecidos: devuelve las opciones con su id; ninguno: lo dice", async () => {
    const r = await edits.prepare(sql, T, { cambios: [{ buscar: "coca", precio: 3000 }] });
    assert.strictEqual(r.result.listo, false);
    assert.strictEqual(r.plan, undefined);
    assert.deepStrictEqual(r.result.dudas[0].opciones.map((o) => o.id).sort(), ["coca15", "coca225"]);
    const n = await edits.prepare(sql, T, { cambios: [{ buscar: "fernet", precio: 3000 }] });
    assert.match(n.result.dudas[0].problema, /No encontré/);
    // Con el id que devolvió, queda claro
    const c = await edits.prepare(sql, T, { cambios: [{ buscar: "coca225", precio: 3000 }] });
    assert.strictEqual(c.plan.items[0].id, "coca225");
  });
  await t("porcentaje: redondea de a $ 10 (o el múltiplo que diga); categoría entera", async () => {
    assert.strictEqual(edits.withPercent(1555, 10), 1710);
    assert.strictEqual(edits.withPercent(1555, 10, 50), 1700);
    assert.strictEqual(edits.withPercent(55, 10), 61);
    const r = await edits.prepare(sql, T, { categoria: "gaseosas", porcentaje: 10 });
    assert.deepStrictEqual(r.plan.items.map((i) => [i.id, i.newPrice]).sort(), [["coca15", 1980], ["coca225", 2860], ["sprite", 1710]]);
    const bad = await edits.prepare(sql, T, { categoria: "a", porcentaje: 10 });
    assert.strictEqual(bad.result.listo, false);
  });
  await t("ocultar y reactivar; lo que ya está así no es un cambio; precio 0 no", async () => {
    const r = await edits.prepare(sql, T, { cambios: [{ buscar: "alfajor triple", activo: false }, { buscar: "turron viejo", activo: true }] });
    assert.deepStrictEqual(r.plan.items.map((i) => [i.id, i.newActive]), [["alfajor", false], ["viejo", true]]);
    const same = await edits.prepare(sql, T, { cambios: [{ buscar: "coca 1,5", precio: 1800 }] });
    assert.strictEqual(same.result.listo, false);
    const zero = await edits.prepare(sql, T, { cambios: [{ buscar: "coca 1,5", precio: 0 }] });
    assert.match(zero.result.dudas[0].problema, /mayor a 0/);
  });
  await t("vista previa: por kilo, aviso de cambio grande y entra en un mensaje con botones", async () => {
    const r = await edits.prepare(sql, T, { cambios: [{ buscar: "asado", precio: 9900 }, { buscar: "coca 1,5", precio: 18000 }] });
    const text = edits.previewText(r.plan);
    assert.match(text, /ASADO: \$ 9\.000 → \*\$ 9\.900\* \/kg/);
    assert.match(text, /un precio cambia más del doble/);
    const many = { items: Array.from({ length: 200 }, (_, i) => ({ id: `p${i}`, name: `PRODUCTO DE NOMBRE LARGO ${i}`, unit: "", oldPrice: 1000, newPrice: 1100, oldActive: true, newActive: true })), category: "Todo", percent: 10 };
    const long = edits.previewText(many);
    assert.ok(long.length <= 1024, `largo ${long.length}`);
    assert.match(long, /…y \d+ más/);
  });
  await t("la herramienta: solo el dueño, solo por WhatsApp y con caja", async () => {
    const tools = async (ctx) => {
      const c = editClient(null);
      await agent.run({ client: c, sql, edits: edits.session(sql, T) }, { uid: T, plan: null, info: {}, ...ctx }, "hola");
      return c.reqs[0].tools.map((x) => x.name);
    };
    assert.ok((await tools({ role: "ADMIN", channel: "whatsapp" })).includes("cambiar_productos"));
    assert.ok(!(await tools({ role: "SUPERVISOR", channel: "whatsapp" })).includes("cambiar_productos"));
    assert.ok(!(await tools({ role: "ADMIN", channel: "app" })).includes("cambiar_productos"));
    assert.ok(!(await tools({ role: "ADMIN", channel: "whatsapp", plan: "agenda" })).includes("cambiar_productos"));
  });

  // ── Por WhatsApp: proponer, confirmar, deshacer ──
  const db = fakeDb();
  db.cols.ventra_accounts = { [T]: { plan: "full", paidUntil: NOW + 30 * 864e5 } };
  db.cols[waOwner.OWNERS] = { [PHONE]: { uid: T, userId: "u-duenio", role: "ADMIN", name: "Juan", lastInboundAt: NOW } };
  const sent = [];
  const heads = [];
  const deps = (client, extra = {}) => ({
    ai, aiDeps: { db, logger, sql, client }, sql, logger,
    send: async (to, text) => { sent.push({ to, text }); },
    sendButtons: async (to, text, buttons) => { sent.push({ to, text, buttons }); },
    afterWrite: async (uid, head) => { heads.push([uid, head]); },
    ...extra,
  });
  const inbox = () => db.cols[waOwner.INBOX] || {};
  const drain = async (client, now = NOW) => {
    for (const id of Object.keys(inbox())) { const item = inbox()[id]; delete inbox()[id]; await waOwner.processInbox(db, item, deps(client), now); }
  };
  const say = async (body, id, client, now = NOW) => {
    await waOwner.onMessage(db, async () => {}, { from: PHONE, id, type: "text", text: { body } }, now);
    await drain(client, now);
  };
  const tap = async (payload, id, from = PHONE, now = NOW) => {
    const handled = await waOwner.onMessage(db, async () => {}, { from, id, type: "interactive", interactive: { type: "button_reply", button_reply: { id: payload, title: "x" } } }, now);
    await drain(null, now);
    return handled;
  };
  const last = () => sent[sent.length - 1];

  await t("pide un cambio: llega la lista con Confirmar y Cancelar, y nada cambió todavía", async () => {
    await say("subí la coca 1,5 a 2800", "m1", editClient({ cambios: [{ buscar: "coca 1,5", precio: 2800 }] }));
    const m = last();
    assert.match(m.text, /COCA-COLA 1,5 L: \$ 1\.800 → \*\$ 2\.800\*/);
    assert.deepStrictEqual(m.buttons.map((b) => b.title), ["Confirmar", "Cancelar"]);
    assert.strictEqual((await product(sql, "coca15")).sale_price, 1800);
  });
  await t("otro teléfono no puede tocar el botón; un número sin vincular sigue como antes", async () => {
    const editId = last().buttons[0].id.split("|")[2];
    db.cols[waOwner.OWNERS]["5492219999999"] = { uid: "otro", role: "ADMIN" };
    db.cols.ventra_accounts.otro = { plan: "full", paidUntil: NOW + 864e5 };
    await waOwner.onMessage(db, async () => {}, { from: "5492219999999", id: "x1", type: "interactive", interactive: { button_reply: { id: `wo|ok|${editId}` } } }, NOW);
    for (const id of Object.keys(inbox())) { const item = inbox()[id]; delete inbox()[id]; await waOwner.processInbox(db, item, { ...deps(null), send: async (to, text) => sent.push({ to, text }) }, NOW); }
    assert.match(last().text, /no es tuyo/);
    assert.strictEqual(await waOwner.onMessage(db, async () => {}, { from: "5490000000000", id: "x2", type: "interactive", interactive: { button_reply: { id: `wo|ok|${editId}` } } }, NOW), false);
    assert.strictEqual((await product(sql, "coca15")).sale_price, 1800);
  });
  let undoPayload;
  await t("confirmar: escribe en la nube como otra caja, con historial y auditoría; el stock no se toca", async () => {
    const editId = sent.find((s) => s.buttons && s.buttons[0].title === "Confirmar").buttons[0].id.split("|")[2];
    await tap(`wo|ok|${editId}`, "b1", PHONE, NOW + 60e3);
    assert.match(last().text, /Listo, cambié COCA-COLA 1,5 L/);
    undoPayload = last().buttons[0].id;
    assert.strictEqual(last().buttons[0].title, "Deshacer");
    const p = await product(sql, "coca15");
    assert.strictEqual(p.sale_price, 2800);
    assert.strictEqual(p.stock, 3);
    assert.strictEqual(p._device, "whatsapp");
    assert.strictEqual(p.updated_at, NOW + 60e3);
    assert.strictEqual(p.cost_price, 1000);
    const hist = await cloudSync.run(sql, `SELECT data FROM sync_rows WHERE tenant_id = $1 AND tbl = 'price_history'`, [T]);
    assert.deepStrictEqual([hist[0].data.product_id, hist[0].data.user_id, hist[0].data.old_price, hist[0].data.new_price], ["coca15", "u-duenio", 1800, 2800]);
    const audit = await cloudSync.run(sql, `SELECT data FROM sync_rows WHERE tenant_id = $1 AND tbl = 'audit_logs'`, [T]);
    assert.strictEqual(audit[0].data.terminal, "WhatsApp");
    assert.ok(heads.length && heads[heads.length - 1][1] > 0, "sube el marcador de novedades");
    // El otro comercio, intacto
    assert.strictEqual((await product(sql, "coca15", "otro")).sale_price, 1);
  });
  await t("las cajas del local lo bajan (la PC no ve lo suyo, sí lo del WhatsApp)", async () => {
    const r = await cloudSync.pull(sql, T, "pc-local", "0", false, false);
    const row = r.rows.find((x) => x.t === "products" && x.id === "coca15");
    assert.ok(row, "la caja recibe el producto");
    assert.strictEqual(row.d.sale_price, 2800);
    assert.ok(!r.rows.some((x) => x.id === "coca225"), "lo que subió la propia caja no vuelve");
  });
  await t("el botón repetido no vuelve a escribir", async () => {
    const editId = undoPayload.split("|")[2];
    await tap(`wo|ok|${editId}`, "b2", PHONE, NOW + 61e3);
    assert.match(last().text, /ya está hecho/);
  });
  await t("deshacer: vuelve al precio anterior", async () => {
    await tap(undoPayload, "b3", PHONE, NOW + 120e3);
    assert.match(last().text, /volví COCA-COLA 1,5 L a como estaba/);
    assert.strictEqual((await product(sql, "coca15")).sale_price, 1800);
    await tap(undoPayload, "b4", PHONE, NOW + 121e3);
    assert.match(last().text, /ya lo deshice/);
  });
  await t("'sí' escrito confirma la propuesta pendiente; 'no' la cancela", async () => {
    await say("subí 10% las gaseosas", "m2", editClient({ categoria: "gaseosas", porcentaje: 10 }), NOW + 200e3);
    assert.match(last().text, /Gaseosas, \+10%/);
    await say("sí", "m3", null, NOW + 210e3);
    assert.match(last().text, /cambié 3 productos/);
    assert.strictEqual((await product(sql, "sprite")).sale_price, 1710);
    await say("ocultá el alfajor triple", "m4", editClient({ cambios: [{ buscar: "alfajor triple", activo: false }] }), NOW + 300e3);
    await say("no", "m5", null, NOW + 310e3);
    assert.match(last().text, /no cambié nada/);
    assert.strictEqual((await product(sql, "alfajor")).is_active, 1);
  });
  await t("si cambiaron el precio en la caja mientras tanto, no lo pisa", async () => {
    await say("asado a 9900", "m6", editClient({ cambios: [{ buscar: "asado", precio: 9900 }] }), NOW + 400e3);
    const editId = last().buttons[0].id.split("|")[2];
    // La carnicería lo cambió en la caja antes de que el dueño confirme
    const cur = await product(sql, "asado");
    delete cur._device;
    await cloudSync.push(sql, T, "pc-local", [{ t: "products", id: "asado", d: { ...cur, sale_price: 9500 }, ts: NOW + 405e3 }]);
    await tap(`wo|ok|${editId}`, "b5", PHONE, NOW + 410e3);
    assert.match(last().text, /No cambié nada: ASADO lo cambiaron mientras tanto/);
    assert.strictEqual((await product(sql, "asado")).sale_price, 9500);
  });
  await t("pasados 30 minutos la propuesta vence", async () => {
    await say("alfajor triple a 1000", "m7", editClient({ cambios: [{ buscar: "alfajor triple", precio: 1000 }] }), NOW + 500e3);
    const editId = last().buttons[0].id.split("|")[2];
    await tap(`wo|ok|${editId}`, "b6", PHONE, NOW + 500e3 + edits.PENDING_MS + 1000);
    assert.match(last().text, /Pasaron más de 30 minutos/);
    assert.strictEqual((await product(sql, "alfajor")).sale_price, 900);
  });
  await t("el encargado no tiene la herramienta ni puede confirmar", async () => {
    db.cols[waOwner.OWNERS][PHONE].role = "SUPERVISOR";
    db.cols.ventra_wa_settings = { [T]: { supervisors: true } };
    const c = editClient(null, "Eso lo cambia el dueño.");
    await say("subí la coca", "m8", c, NOW + 600e3);
    assert.ok(!c.reqs[0].tools.some((x) => x.name === "cambiar_productos"));
    assert.ok(!last().buttons);
    await tap(undoPayload, "b7", PHONE, NOW + 601e3);
    assert.match(last().text, /solo el dueño/);
    db.cols[waOwner.OWNERS][PHONE].role = "ADMIN";
  });
  // ── Audios ──
  const heard = {};
  const audioDeps = (client) => ({ ...deps(client), transcribe: async (mediaId) => (mediaId in heard ? { text: heard[mediaId], seconds: 4 } : null) });
  const voice = async (mediaId, id, client, now) => {
    await waOwner.onMessage(db, async () => {}, { from: PHONE, id, type: "audio", audio: { id: mediaId, mime_type: "audio/ogg; codecs=opus", voice: true } }, now);
    const item = inbox()[id];
    assert.deepStrictEqual([item.type, item.mediaId], ["audio", mediaId]);
    delete inbox()[id];
    await waOwner.processInbox(db, item, audioDeps(client), now);
  };
  await t("audio: la pregunta se transcribe, se responde y se muestra lo que entendió", async () => {
    heard.a1 = "¿Cuánto sale la Coca de un litro y medio?";
    const c = editClient(null, "La Coca 1,5 L sale *$ 1.800*.");
    await voice("a1", "v1", c, NOW + 700e3);
    assert.strictEqual(c.reqs[0].messages.at(-1).content, `[Audio] ${heard.a1}`, "la IA sabe que vino por audio");
    assert.match(c.reqs[0].system[0].text, /nunca digas que no te llegó el audio/);
    assert.match(last().text, /^🎤 _¿Cuánto sale la Coca de un litro y medio\?_\n\nLa Coca 1,5 L sale/);
  });
  await t("audio: pide un cambio y lo confirma con otro audio ('Sí, dale.')", async () => {
    heard.a2 = "Subí el alfajor triple a mil pesos";
    await voice("a2", "v2", editClient({ cambios: [{ buscar: "alfajor triple", precio: 1000 }] }), NOW + 800e3);
    assert.match(last().text, /^🎤 _Subí el alfajor triple a mil pesos_\n\nRevisá antes de confirmar/);
    assert.deepStrictEqual(last().buttons.map((b) => b.title), ["Confirmar", "Cancelar"]);
    heard.a3 = "Sí, dale.";
    await voice("a3", "v3", null, NOW + 810e3);
    assert.match(last().text, /🎤 _Sí, dale\._\n\nListo, cambié ALFAJOR TRIPLE/);
    assert.strictEqual((await product(sql, "alfajor")).sale_price, 1000);
  });
  await t("audio que no se pudo entender: lo dice y no llama a la IA", async () => {
    const c = editClient(null);
    await voice("nadie", "v4", c, NOW + 900e3);
    assert.match(last().text, /No pude entender el audio/);
    assert.strictEqual(c.reqs.length, 0);
  });
  await t("'sí' escrito con mayúscula, tilde o signos también confirma", async () => {
    for (const [i, x] of ["Sí", "si!", "SÍ, DALE", "dale", "Confirmo."].entries()) {
      db.cols[waOwner.OWNERS][PHONE].pendingEdit = "zz"; db.cols[waOwner.OWNERS][PHONE].pendingEditAt = NOW;
      await waOwner.onMessage(db, async () => {}, { from: PHONE, id: `y${i}`, type: "text", text: { body: x } }, NOW + 1000);
      assert.deepStrictEqual([inbox()[`y${i}`].type, inbox()[`y${i}`].action], ["edit", "ok"], x);
      delete inbox()[`y${i}`];
    }
    await waOwner.onMessage(db, async () => {}, { from: PHONE, id: "n1", type: "text", text: { body: "No, dejalo" } }, NOW + 1000);
    assert.strictEqual(inbox().n1.action, "no");
    delete inbox().n1;
    db.cols[waOwner.OWNERS][PHONE].pendingEdit = null;
  });

  // ── Costo ──
  await t("costo: cambia solo el costo (el precio de venta queda igual) y se puede deshacer", async () => {
    const r = await edits.prepare(sql, T, { cambios: [{ buscar: "coca 2,25", costo: 3000 }] });
    const price0 = (await product(sql, "coca225")).sale_price;
    assert.deepStrictEqual(r.plan.items.map((i) => [i.oldCost, i.newCost, i.oldPrice, i.newPrice]), [[1500, 3000, price0, price0]]);
    const text = edits.previewText(r.plan);
    assert.match(text, /COCA-COLA 2,25 L: costo \$ 1\.500 → \*\$ 3\.000\*, ⚠️ queda por debajo del costo/);
    assert.ok(!/: \$ [\d.]+ →/.test(text), "no muestra cambio de precio de venta");
    await say("el costo de la coca 2,25 ahora es 3000", "c1", editClient({ cambios: [{ buscar: "coca 2,25", costo: 3000 }] }), NOW + 1000e3);
    const editId = last().buttons[0].id.split("|")[2];
    await tap(`wo|ok|${editId}`, "cb1", PHONE, NOW + 1001e3);
    let p = await product(sql, "coca225");
    assert.deepStrictEqual([p.cost_price, p.sale_price], [3000, price0]);
    const audit = (await cloudSync.run(sql, `SELECT data FROM sync_rows WHERE tenant_id = $1 AND tbl = 'audit_logs' ORDER BY seq DESC LIMIT 1`, [T]))[0].data;
    assert.strictEqual(JSON.parse(audit.new_values).costPrice, 3000);
    await tap(last().buttons[0].id, "cb2", PHONE, NOW + 1002e3);
    p = await product(sql, "coca225");
    assert.deepStrictEqual([p.cost_price, p.sale_price], [1500, price0]);
  });
  await t("costo y precio juntos, y costo con porcentaje", async () => {
    const r = await edits.prepare(sql, T, { cambios: [{ buscar: "sprite", costo: 900, precio: 1800 }, { buscar: "alfajor triple", costo_porcentaje: 10 }] });
    const by = Object.fromEntries(r.plan.items.map((i) => [i.id, i]));
    assert.deepStrictEqual([by.sprite.newCost, by.sprite.newPrice], [900, 1800]);
    assert.strictEqual(by.alfajor, undefined, "sin costo cargado, el porcentaje no inventa uno");
  });
  await t("la IA recibe la regla: costo nunca es precio", async () => {
    const c = editClient(null);
    await agent.run({ client: c, sql, edits: edits.session(sql, T) }, { uid: T, plan: null, info: {}, role: "ADMIN", channel: "whatsapp" }, "hola");
    assert.match(c.reqs[0].system[0].text, /SIEMPRE costo, nunca precio/);
    const tool = c.reqs[0].tools.find((x) => x.name === "cambiar_productos");
    assert.ok(tool.input_schema.properties.cambios.items.properties.costo);
  });
  await t("propuestas guardadas antes del costo siguen funcionando (no tocan el costo)", async () => {
    const id = "viejaa1";
    db.cols[edits.EDITS][id] = { uid: T, from: PHONE, userId: "u-duenio", status: "pending", createdAt: NOW + 1100e3,
      items: [{ id: "sprite", name: "SPRITE 1,5 L", unit: "", oldPrice: 1710, newPrice: 1750, oldActive: true, newActive: true }] };
    const before = (await product(sql, "sprite")).cost_price;
    await tap(`wo|ok|${id}`, "old1", PHONE, NOW + 1101e3);
    assert.match(last().text, /Listo, cambié SPRITE/);
    const p = await product(sql, "sprite");
    assert.deepStrictEqual([p.sale_price, p.cost_price], [1750, before]);
  });

  // ── Audios: idioma ──
  await t("transcripción: si Google no acepta el idioma, prueba la siguiente combinación y la recuerda", async () => {
    const speech = require("../functions/speech-to-text");
    const tried = [];
    const fakeFetch = async (url, opts) => {
      const cfg = JSON.parse(opts.body).config;
      tried.push(`${cfg.model}/${cfg.languageCodes[0]}`);
      if (cfg.model === "long") return { ok: false, status: 400, text: async () => 'The language "es-US" is not supported by the model "long"' };
      return { ok: true, json: async () => ({ results: [{ alternatives: [{ transcript: "Subí la coca a dos mil" }] }], metadata: { totalBilledDuration: "3s" } }) };
    };
    const out = await speech.transcribeAudio(Buffer.from("x"), { fetchImpl: fakeFetch, token: "t", project: "p" });
    assert.deepStrictEqual([out.text, out.seconds, out.model], ["Subí la coca a dos mil", 3, "short/es-US"]);
    assert.deepStrictEqual(tried, ["long/es-US", "short/es-US"]);
    tried.length = 0;
    await speech.transcribeAudio(Buffer.from("x"), { fetchImpl: fakeFetch, token: "t", project: "p" });
    assert.deepStrictEqual(tried, ["short/es-US"], "la segunda vez va directo a la que anduvo");
    const fail = await speech.transcribeAudio(Buffer.from("x"), { fetchImpl: async () => ({ ok: false, status: 403, text: async () => "PERMISSION_DENIED" }), token: "t", project: "p", logger: { warn() {} } });
    assert.strictEqual(fail, null);
  });

  await t("bienvenida del dueño: cuenta que puede cambiar precios", async () => {
    await waOwner.processInbox(db, { from: PHONE, uid: T, type: "welcome" }, deps(null), NOW);
    assert.match(last().text, /También podés cambiar precios/);
  });

  console.log(`\n${ok} bien, ${bad} mal`);
  process.exit(bad ? 1 : 0);
})();
