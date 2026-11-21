// Panel del admin: salud de clientes, embudo, altas y bajas, avisos (functions/admin-insights.js).
//   node firebase/test/admin-insights.test.cjs
const assert = require("assert");
const ins = require("../functions/admin-insights");

let ok = 0, bad = 0;
const t = (name, fn) => {
  try { fn(); ok++; console.log(`ok    ${name}`); } catch (e) { bad++; console.log(`FALLA ${name}\n      ${e.stack.split("\n").slice(0, 3).join("\n      ")}`); }
};
const NOW = Date.parse("2026-11-21T15:00:00Z");
const ago = (d) => new Date(NOW - d * 864e5).toISOString();
const pc = (seenDaysAgo) => ({ kind: "pc", lastSeenAt: ago(seenDaysAgo) });

t("cliente que vende todos los días y usa funciones: sano", () => {
  const feats = ins.features({ purchases: [10, 3], daily_z_reports: [30, 7] });
  const h = ins.health({ plan: "full", state: "ACTIVE", createdAt: ago(90), devices: [pc(0)] },
    { activity: { s7: 120, s28: 450, last: ago(0) }, sync: { lastPushAt: ago(0) }, feats, now: NOW });
  assert.strictEqual(h.score, 100);
  assert.strictEqual(h.level, "ok");
});

t("dejó de vender hace 8 días y no renovó: en riesgo con los dos motivos", () => {
  const h = ins.health({ plan: "full", state: "GRACE", createdAt: ago(120), devices: [pc(8)] },
    { activity: { s7: 0, s28: 200, last: ago(8) }, now: NOW });
  assert.strictEqual(h.level, "risk");
  assert.ok(h.reasons.some((r) => /no vende/.test(r.text)));
  assert.ok(h.reasons.some((r) => /gracia/.test(r.text)));
});

t("vende menos de la mitad que su promedio", () => {
  const h = ins.health({ plan: "full", state: "ACTIVE", createdAt: ago(60), devices: [pc(0)] },
    { activity: { s7: 20, s28: 400, last: ago(0) }, now: NOW });
  assert.ok(h.reasons.some((r) => /mitad/.test(r.text)));
  assert.strictEqual(h.level, "ok"); // 85: para mirar en la lista, todavía no en riesgo
});

t("PC prendida que no sincroniza", () => {
  const h = ins.health({ plan: "full", state: "ACTIVE", createdAt: ago(60), devices: [pc(0)] },
    { activity: { s7: 50, s28: 200, last: ago(0) }, sync: { lastPushAt: ago(3) }, now: NOW });
  assert.ok(h.reasons.some((r) => /no sincroniza/.test(r.text)));
});

t("plan de turnos: no se le pide vender con la caja, sí que entre", () => {
  const h = ins.health({ plan: "agenda", state: "ACTIVE", createdAt: ago(60), devices: [] }, { lastSignInAt: ago(20), now: NOW });
  assert.ok(!h.reasons.some((r) => /vend/.test(r.text)));
  assert.ok(h.reasons.some((r) => /No entra hace 20/.test(r.text)));
});

t("recién dado de alta (1 día) no se castiga por no vender todavía", () => {
  const h = ins.health({ plan: "full", state: "ACTIVE", trial: true, createdAt: ago(1), devices: [] }, { now: NOW });
  assert.strictEqual(h.score, 100);
  assert.strictEqual(h.trial, true);
});

t("funciones: tienda publicada e IA cuentan", () => {
  const f = ins.features({}, { store: { subdomain: "x", published: true }, aiThisMonth: 4 });
  assert.ok(f.find((x) => x.key === "store").recent);
  assert.ok(f.find((x) => x.key === "ai").used);
  assert.ok(!f.find((x) => x.key === "quotes").used);
});

t("embudo por mes: visitas, registro, plan, pago y segundo pago", () => {
  const f = ins.funnel({
    site: { "2026-11": { view_home: 100, view_peluquerias: 20, view_empezar: 30, signup_google: 9 } },
    authUsers: [{ createdAt: "2026-11-02T10:00:00Z" }, { createdAt: "2026-11-05T10:00:00Z" }, { createdAt: "2026-10-05T10:00:00Z" }],
    accounts: [{ createdAt: "2026-11-02T11:00:00Z", trialUsed: true, payments: 2 }, { createdAt: "2026-11-06T11:00:00Z", payments: 0 }],
    months: 2, now: NOW,
  });
  assert.deepStrictEqual(f.map((x) => x.month), ["2026-10", "2026-11"]);
  const nov = f[1];
  assert.strictEqual(nov.visits, 120);
  assert.strictEqual(nov.empezar, 30);
  assert.strictEqual(nov.registered, 2);
  assert.strictEqual(nov.accounts, 2);
  assert.strictEqual(nov.trial, 1);
  assert.strictEqual(nov.paid, 1);
  assert.strictEqual(nov.renewed, 1);
});

t("altas y bajas: baja en el mes en que se terminó la gracia", () => {
  const r = ins.revenueMonths({
    accounts: [
      { payments: [{ paidAt: "2026-08-03T00:00:00Z", amount: 24900 }, { paidAt: "2026-09-03T00:00:00Z", amount: 24900 }], paidUntil: "2026-10-03T00:00:00Z", state: "READ_ONLY" },
      { payments: [{ paidAt: "2026-09-10T00:00:00Z", amount: 9900 }, { paidAt: "2026-10-10T00:00:00Z", amount: 9900 }, { paidAt: "2026-11-10T00:00:00Z", amount: 9900 }], paidUntil: "2026-12-10T00:00:00Z", state: "ACTIVE" },
      { payments: [], paidUntil: null, state: "UNPAID" },
    ],
    graceDays: 7, months: 4, now: NOW,
  });
  const by = Object.fromEntries(r.map((x) => [x.month, x]));
  assert.strictEqual(by["2026-08"].newPaying, 1);
  assert.strictEqual(by["2026-09"].newPaying, 1);
  assert.strictEqual(by["2026-09"].revenue, 24900 + 9900);
  assert.strictEqual(by["2026-10"].churned, 1);
  assert.strictEqual(by["2026-09"].payingEnd, 2);
  assert.strictEqual(by["2026-10"].payingEnd, 1);
  assert.strictEqual(by["2026-10"].churnPct, 50);
});

t("avisos: dejó de vender, caja trabada, gracia, IA alta y seguimiento", () => {
  const a = { uid: "u1", email: "kiosco@x.com", plan: "full", planName: "Ventra Full", planAmount: 24900, state: "GRACE", daysLeft: 3, paidUntil: ago(4), devices: [pc(0)] };
  const list = ins.alerts({
    rows: [{ a, activity: { s7: 0, s28: 80, last: ago(5) }, sync: { lastPushAt: ago(3) }, aiUsd: 6, followUp: { date: "2026-11-20", text: "Llamarlo por la balanza" } }],
    errors: [{ message: "TypeError: x is undefined", firstAt: ago(0.2) }],
    now: NOW, fx: 1500,
  });
  const keys = list.map((x) => x.key.split(":")[0]);
  assert.deepStrictEqual(keys.sort(), ["ai", "errors", "follow", "grace", "nosales", "stuck"].sort());
  assert.ok(list.find((x) => x.key.startsWith("ai")).title.includes("36%"));
});

t("avisos: un cliente que nunca vendió no dispara 'dejó de vender'", () => {
  const a = { uid: "u2", email: "n@x.com", plan: "full", state: "ACTIVE", devices: [] };
  assert.strictEqual(ins.alerts({ rows: [{ a, activity: null }], now: NOW }).length, 0);
});

t("versiones: 1.0.118 es más nueva que 1.0.99", () => {
  assert.ok(ins.cmpVersion("1.0.118", "1.0.99") > 0);
  assert.strictEqual(ins.cmpVersion("1.0.118", "1.0.118"), 0);
});

t("resumen del lunes", () => {
  const w = ins.weekly({
    accounts: [{ createdAt: ago(2), payments: [{ paidAt: ago(1), amount: 24900 }], state: "ACTIVE" }, { createdAt: ago(40), payments: [{ paidAt: ago(30), amount: 9900 }], state: "ACTIVE" }],
    rows: [{ a: { email: "r@x.com", state: "ACTIVE" }, h: { level: "risk", score: 20, reasons: [{ text: "Hace 9 días que no vende" }] } }],
    authUsers: [{ createdAt: ago(3) }], mrr: 34800, now: NOW,
  });
  assert.strictEqual(w.paid, 24900);
  assert.strictEqual(w.newAccounts, 1);
  assert.strictEqual(w.newPaying, 1);
  assert.strictEqual(w.riskCount, 1);
  assert.strictEqual(w.risk[0].why, "Hace 9 días que no vende");
});

console.log(`\n${ok} bien, ${bad} con falla`);
process.exit(bad ? 1 : 0);
