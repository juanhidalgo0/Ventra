// Uso del WhatsApp del dueño para el panel de admin (functions/wa-owner-stats.js), con Firestore falso.
//   node firebase/test/wa-owner-stats.test.cjs
const assert = require("assert");
const admin = require("../functions/node_modules/firebase-admin");
admin.firestore.FieldValue.increment = (n) => ({ operand: n });
const stats = require("../functions/wa-owner-stats");

const fakeDb = () => {
  const cols = {};
  const col = (n) => (cols[n] = cols[n] || {});
  const doc = (n, id) => ({
    id,
    get: async () => ({ id, exists: id in col(n), data: () => col(n)[id] }),
    set: async (v, opt) => {
      const cur = opt && opt.merge ? { ...(col(n)[id] || {}) } : {};
      for (const [k, x] of Object.entries(v)) cur[k] = x && x.operand !== undefined ? (cur[k] || 0) + x.operand : x;
      col(n)[id] = cur;
    },
  });
  const OPS = { "==": (a, b) => a === b, ">=": (a, b) => a >= b };
  const query = (n, f) => ({
    where: (k, op, v) => query(n, [...f, [k, op, v]]),
    get: async () => {
      const docs = Object.entries(col(n)).filter(([, d]) => f.every(([k, op, v]) => d[k] !== undefined && OPS[op](d[k], v))).map(([id, d]) => ({ id, data: () => d }));
      return { docs, forEach: (fn) => docs.forEach(fn) };
    },
  });
  return {
    cols,
    collection: (n) => ({ doc: (id) => doc(n, id), where: (k, op, v) => query(n, [[k, op, v]]), get: () => query(n, []).get() }),
    getAll: async (...refs) => Promise.all(refs.map((r) => r.get())),
  };
};

let ok = 0, bad = 0;
const t = async (name, fn) => { try { await fn(); ok++; console.log(`ok    ${name}`); } catch (e) { bad++; console.log(`MAL   ${name}\n      ${e.message}`); } };

(async () => {
  const now = Date.parse("2026-11-11T15:00:00-03:00");

  await t("suma contadores por comercio y mes, sin guardar texto", async () => {
    const db = fakeDb();
    await stats.track(db, "u1", ["msgs", "in_audio", "by_owner"], now);
    await stats.track(db, "u1", ["msgs", "in_question", "by_owner"], now);
    await stats.track(db, "u1", ["do_answer", "menu_ventas_hoy", "op_crear-producto"], now);
    const d = db.cols.ventra_wa_stats["2026-11_u1"];
    assert.strictEqual(d.msgs, 2);
    assert.strictEqual(d.in_audio, 1);
    assert.strictEqual(d.menu_ventas_hoy, 1);
    assert.strictEqual(d.op_crear_producto, 1, "los guiones pasan a guion bajo");
    assert.strictEqual(d.month, "2026-11");
    assert.ok(!Object.values(d).some((v) => typeof v === "string" && /hoy\?/.test(v)));
  });

  await t("el mes es el de Argentina (a las 23 h del 30 todavía es ese mes)", async () => {
    const db = fakeDb();
    await stats.track(db, "u1", ["msgs"], Date.parse("2026-11-30T23:30:00-03:00"));
    assert.ok(db.cols.ventra_wa_stats["2026-11_u1"]);
  });

  await t("si falla Firestore no rompe nada", async () => {
    const db = { collection: () => ({ doc: () => ({ set: () => Promise.reject(new Error("caído")) }) }) };
    await stats.track(db, "u1", ["msgs"], now);
  });

  await t("informe: teléfonos tapados, uso del mes, mes pasado y lo que no supo contestar", async () => {
    const db = fakeDb();
    db.cols.ventra_wa_owners = {
      "5492215551234": { uid: "u1", role: "ADMIN", lastInboundAt: now - 3600e3, questions: 40, summary: { enabled: true } },
      "5492215559999": { uid: "u1", role: "SUPERVISOR", lastInboundAt: now - 86400e3 },
      "5492214440000": { uid: "u2", role: "ADMIN", lastInboundAt: now - 20 * 86400e3 },
    };
    db.cols.ventra_accounts = { u1: { email: "kiosco@x.com", plan: "full" }, u2: { email: "pelu@x.com", plan: "agenda" } };
    await stats.track(db, "u1", ["msgs", "in_audio", "do_answer"], now);
    await stats.track(db, "u1", ["msgs", "do_prices"], now);
    await stats.track(db, "u2", ["msgs"], Date.parse("2026-10-10T12:00:00-03:00"));
    db.cols.ventra_ai_misses = {
      a: { uid: "u1", channel: "whatsapp", question: "¿Cuánto gané?", reasons: ["sin gastos"], at: now - 3600e3 },
      b: { uid: "u1", channel: "app", question: "de la app", at: now - 3600e3 },
      c: { uid: "u2", channel: "whatsapp", question: "vieja", at: now - 40 * 86400e3 },
    };
    const r = await stats.report(db, now);
    assert.strictEqual(r.month, "2026-11");
    assert.strictEqual(r.linkedShops, 2);
    assert.strictEqual(r.linkedPhones, 3);
    assert.strictEqual(r.activeShops, 1);
    assert.strictEqual(r.totals.msgs, 2);
    const u1 = r.shops[0];
    assert.strictEqual(u1.email, "kiosco@x.com");
    assert.strictEqual(u1.phones.length, 2);
    assert.ok(u1.phones.every((p) => /^•••• \d{4}$/.test(p.phone)), "el número completo no sale");
    assert.strictEqual(r.shops.find((s) => s.uid === "u2").prev, 1);
    assert.deepStrictEqual(r.misses.map((m) => m.question), ["¿Cuánto gané?"], "solo WhatsApp y de los últimos 30 días");
  });

  console.log(`\n${ok} bien, ${bad} mal`);
  process.exit(bad ? 1 : 0);
})();
