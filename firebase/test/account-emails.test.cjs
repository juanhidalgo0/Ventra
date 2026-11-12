// Mails a los clientes que pagan (functions/account-emails.js), con una base falsa en memoria.
//   node firebase/test/account-emails.test.cjs
const assert = require("assert");
const ae = require("../functions/account-emails");
const { ts, fakeAdmin, fakeDb } = require("./fake-firestore.cjs");

const H = 3600 * 1000, D = 24 * H;
const NOW = Date.UTC(2026, 10, 11, 13, 0); // 10:00 en Argentina
const PLANS = { full: { name: "Ventra Full", amount: 24900 }, agenda_pro: { name: "Ventra Agenda Pro", amount: 19900 }, agenda: { name: "Ventra Agenda", amount: 9900 } };

let ok = 0, bad = 0;
const t = async (name, fn) => {
  try { await fn(); ok++; console.log(`ok    ${name}`); } catch (e) { bad++; console.log(`FALLA ${name}\n      ${e.stack.split("\n").slice(0, 3).join("\n      ")}`); }
};
const account = (extra = {}) => ({ email: "Dueno@Gmail.com", name: "Ana López", plan: "full", planName: "Ventra Full", status: "active", mpPreapprovalId: "pre1", paidUntil: ts(NOW + 20 * D), ...extra });
const outbox = () => { const box = []; box.send = async (_k, m) => { box.push(m); return { id: `re_${box.length}` }; }; return box; };
const deps = (box, extra = {}) => ({ apiKey: "re_x", admin: fakeAdmin, now: NOW, plans: PLANS, logger: { warn() {} }, send: box.send, unsub: (uid, list) => `https://baja/${list}/${uid}`, exclude: ["juanhidalgobass@gmail.com"], ...extra });

(async () => {
  // ─── Plantillas ───
  await t("primer pago: bienvenida con los pasos de su plan y el comprobante", () => {
    const pay = { amount: 24900, paidAt: ts(NOW), newPaidUntil: ts(NOW + 30 * D), previousPaidUntil: null };
    const m = ae.paymentEmail(pay, account());
    assert.ok(m.subject.includes("Ya tenés Ventra Full") && m.html.includes("Instalá la caja") && m.html.includes("$24.900") && m.html.includes("11/12/2026"), m.subject);
    const ag = ae.paymentEmail(pay, account({ plan: "agenda_pro", planName: "Ventra Agenda Pro" }));
    assert.ok(ag.html.includes("servicios y horarios") && ag.html.includes("sale solo") && !ag.html.includes("Instalá la caja"));
    assert.ok(ae.paymentEmail(pay, account({ plan: "tienda", planName: "Ventra Tienda" })).html.includes("Armá tu tienda"));
  });
  await t("pagos siguientes: comprobante; pago a mano dice el medio y los meses", () => {
    const m = ae.paymentEmail({ amount: 74700, months: 3, manual: true, method: "Transferencia", paidAt: ts(NOW), newPaidUntil: ts(NOW + 90 * D), previousPaidUntil: ts(NOW) }, account());
    assert.ok(m.subject.startsWith("Recibimos tu pago") && m.html.includes("Transferencia") && m.text.includes("Meses: 3"), m.text);
  });
  await t("todos los mails: sin HTML en el texto plano, con logo y sin datos sin escapar", () => {
    const a = account({ name: "<script>x</script>" });
    const all = [
      ae.paymentEmail({ amount: 1, paidAt: ts(NOW), newPaidUntil: ts(NOW), previousPaidUntil: null }, a), ae.preChargeEmail(a, 24900), ae.paymentFailedEmail({ amount: 24900 }, a),
      ae.winbackEmail(a, { unsubUrl: "u" }), ae.nudgeEmail(a, { unsubUrl: "u" }), ae.deviceEmail({ name: "<b>PC</b>", linkedAt: ts(NOW) }, a),
      ae.planChangeEmail({ planName: "Ventra Agenda" }, { ...a, planName: "Ventra Agenda Pro" }, 19900),
      ae.summaryEmail({ month: "2026-10", sales: { total: 1000, count: 2, prevTotal: 500 }, top: ["<i>Coca</i>"], bookings: 3, orders: { count: 1, total: 100 } }, a, { unsubUrl: "u" }),
    ];
    for (const m of all) {
      // El texto plano puede mostrar lo que escribió el usuario tal cual (no es HTML): se quita antes de mirar
      assert.ok(!/<[a-z]/i.test(m.text.split("<b>PC</b>").join("").split("<i>Coca</i>").join("")), `texto con HTML: ${m.subject}`);
      assert.ok(m.html.includes("ventra-icon-192.png"), m.subject);
      assert.ok(!m.html.includes("<script>") && !m.html.includes("<b>PC</b>") && !m.html.includes("<i>Coca</i>"), m.subject);
    }
  });
  await t("resumen: comparación con el mes anterior y lo más vendido", () => {
    const m = ae.summaryEmail({ month: "2026-10", sales: { total: 4823500, count: 1912, prevTotal: 4410000 }, top: ["Coca", "Alfajor"], orders: { count: 38, total: 612400 }, bookings: 0 }, account(), { unsubUrl: "https://baja/x" });
    assert.ok(m.subject.includes("octubre") && m.subject.includes("$4.823.500") && m.html.includes("+9%") && m.html.includes("1.912") && m.html.includes("Coca"), m.subject);
    assert.ok(m.html.includes("https://baja/x") && !m.html.includes("Turnos atendidos"));
  });

  // ─── Disparados por Firestore ───
  await t("pago: manda una sola vez aunque el disparador se repita, y anota el primer pago", async () => {
    const db = fakeDb({ ventra_accounts: { u1: account() } }), box = outbox();
    const payment = { amount: 24900, paidAt: ts(NOW), newPaidUntil: ts(NOW + 30 * D), previousPaidUntil: null };
    assert.strictEqual(await ae.onPayment(db, deps(box), { uid: "u1", paymentId: "p1", payment }), "sent");
    assert.strictEqual(await ae.onPayment(db, deps(box), { uid: "u1", paymentId: "p1", payment }), "skip");
    assert.strictEqual(box.length, 1);
    assert.strictEqual(box[0].to[0], "dueno@gmail.com");
    assert.strictEqual(db.data.ventra_signup_emails.u1.firstPaidAt.toMillis(), NOW);
    assert.strictEqual(db.data.ventra_email_log && Object.values(db.data.ventra_email_log)[0].step, "bienvenida_pago");
  });
  await t("pago del admin (cuenta excluida) o sin clave: nada", async () => {
    const db = fakeDb({ ventra_accounts: { a: account({ email: "juanhidalgobass@gmail.com" }), b: account() } }), box = outbox();
    const payment = { amount: 1, paidAt: ts(NOW), newPaidUntil: ts(NOW), previousPaidUntil: ts(NOW) };
    assert.strictEqual(await ae.onPayment(db, deps(box), { uid: "a", paymentId: "p", payment }), "skip");
    assert.strictEqual(await ae.onPayment(db, deps(box, { apiKey: "PENDIENTE" }), { uid: "b", paymentId: "p", payment }), "skip");
    assert.strictEqual(box.length, 0);
  });
  await t("cobro rechazado: un mail por cobro", async () => {
    const db = fakeDb({ ventra_accounts: { u1: account() } }), box = outbox();
    await ae.onPaymentIssue(db, deps(box), { uid: "u1", issueId: "ap9", issue: { amount: 24900 } });
    await ae.onPaymentIssue(db, deps(box), { uid: "u1", issueId: "ap9", issue: { amount: 24900 } });
    assert.strictEqual(box.length, 1);
    assert.ok(box[0].subject.includes("No pudimos cobrar"));
  });
  await t("PC: avisa al vincular y al volver a vincular, no en otros cambios", async () => {
    const db = fakeDb({ ventra_accounts: { u1: account() } }), box = outbox();
    const after = { uid: "u1", name: "Caja 2", linkedAt: ts(NOW) };
    assert.strictEqual(await ae.onDevice(db, deps(box), { deviceId: "d1", before: null, after }), "sent");
    assert.strictEqual(await ae.onDevice(db, deps(box), { deviceId: "d1", before: after, after: { ...after, lastSeenAt: ts(NOW + H) } }), "skip");
    assert.strictEqual(await ae.onDevice(db, deps(box), { deviceId: "d1", before: after, after: { ...after, linkedAt: ts(NOW + D) } }), "sent");
    assert.strictEqual(await ae.onDevice(db, deps(box), { deviceId: "d1", before: after, after: null }), "skip");
    assert.strictEqual(box.length, 2);
  });
  await t("cambio de plan: solo si ya pagaba y el plan cambió; con el monto nuevo", async () => {
    const db = fakeDb(), box = outbox();
    const before = account({ plan: "agenda", planName: "Ventra Agenda" });
    assert.strictEqual(await ae.onAccountUpdate(db, deps(box), { uid: "u1", before, after: { ...before, status: "active" } }), "skip");
    assert.strictEqual(await ae.onAccountUpdate(db, deps(box), { uid: "u1", before: { plan: "full", email: "x@y.com" }, after: { plan: "agenda", email: "x@y.com" } }), "skip", "alta: todavía no pagaba");
    assert.strictEqual(await ae.onAccountUpdate(db, deps(box), { uid: "u1", before, after: { ...before, plan: "agenda_pro", planName: "Ventra Agenda Pro" } }), "sent");
    assert.ok(box[0].html.includes("$19.900") && box[0].subject.includes("Agenda Pro"));
  });

  // ─── Pasada diaria ───
  await t("qué toca cada día: aviso de cobro, arranque y volvé", () => {
    assert.deepStrictEqual(ae.dailySteps(account({ paidUntil: ts(NOW + 2.5 * D) }), {}, NOW).map((s) => s.step), ["aviso_cobro"]);
    assert.deepStrictEqual(ae.dailySteps(account({ paidUntil: ts(NOW + 5 * D) }), {}, NOW), []);
    assert.deepStrictEqual(ae.dailySteps(account({ paidUntil: ts(NOW + 2.5 * D), mpPreapprovalId: null, status: "manual" }), {}, NOW), [], "pago a mano: sin aviso de cobro");
    assert.deepStrictEqual(ae.dailySteps(account({ paidUntil: ts(NOW - 40 * D), status: "cancelled" }), {}, NOW).map((s) => s.step), ["volve"]);
    assert.deepStrictEqual(ae.dailySteps(account({ paidUntil: ts(NOW - 40 * D) }), { unsubscribed: true }, NOW), [], "dado de baja: sin volvé");
    assert.deepStrictEqual(ae.dailySteps(account(), { firstPaidAt: ts(NOW - 3.5 * D) }, NOW).map((s) => s.step), ["arranque"]);
    assert.deepStrictEqual(ae.dailySteps(account(), { firstPaidAt: ts(NOW - 8 * D) }, NOW), []);
  });
  await t("pasada diaria: manda, no repite y el arranque solo si no lo usó", async () => {
    const db = fakeDb({
      ventra_accounts: { cobro: account({ paidUntil: ts(NOW + 2.5 * D) }), nuevo: account(), usado: account(), viejo: account({ paidUntil: ts(NOW - 40 * D), status: "cancelled" }) },
      ventra_signup_emails: { nuevo: { firstPaidAt: ts(NOW - 3.5 * D) }, usado: { firstPaidAt: ts(NOW - 3.5 * D) } },
    });
    const box = outbox();
    const d = deps(box, { used: async (uid) => uid === "usado" });
    const r = await ae.dailyRun(db, d);
    assert.deepStrictEqual([r.sent, r.failed], [3, 0]);
    assert.deepStrictEqual(box.map((m) => m.tags[1].value).sort(), ["arranque", "aviso_cobro", "volve"]);
    assert.ok(box.find((m) => m.tags[1].value === "volve").headers["List-Unsubscribe"].includes("baja/promo/viejo"));
    assert.strictEqual((await ae.dailyRun(db, d)).sent, 0, "no repite");
  });
  await t("Resend rechaza (dominio sin verificar): corta sin gastar el mail", async () => {
    const db = fakeDb({ ventra_accounts: { a: account({ paidUntil: ts(NOW + 2.5 * D) }), b: account({ paidUntil: ts(NOW + 2.5 * D) }) } });
    let calls = 0;
    const r = await ae.dailyRun(db, deps(outbox(), { send: async () => { calls++; throw Object.assign(new Error("domain not verified"), { status: 403 }); } }));
    assert.strictEqual(calls, 1);
    assert.strictEqual(r.skipped, "Resend rechaza");
    const once = db.data.ventra_signup_emails.a.once;
    assert.ok(!Object.values(once)[0].tries && !Object.values(once)[0].sent, "queda para la próxima");
  });

  // ─── Resumen mensual ───
  await t("mes anterior: noviembre → octubre, enero → diciembre del año anterior", () => {
    assert.deepStrictEqual(ae.prevMonth(NOW), { month: "2026-10", from: "2026-10-01", to: "2026-10-31" });
    assert.deepStrictEqual(ae.prevMonth(Date.UTC(2027, 0, 1, 13)), { month: "2026-12", from: "2026-12-01", to: "2026-12-31" });
    assert.strictEqual(ae.prevMonth(Date.UTC(2026, 2, 1, 13)).to, "2026-02-28");
  });
  await t("resumen: solo a los que tuvieron movimiento, una vez, respetando su baja", async () => {
    const db = fakeDb({
      ventra_accounts: { a: account(), quieto: account(), baja: account(), vencido: account({ paidUntil: ts(NOW - 30 * D) }) },
      ventra_signup_emails: { baja: { unsubscribedSummary: true } },
    });
    const box = outbox();
    const stats = async (uid) => (uid === "quieto" ? { sales: { count: 0 }, bookings: 0 } : { sales: { total: 5000, count: 3, prevTotal: 4000 }, top: ["Coca"], bookings: 2 });
    const r = await ae.monthlyRun(db, deps(box, { stats }));
    assert.deepStrictEqual([r.sent, r.quiet, r.month], [1, 1, "2026-10"]);
    assert.strictEqual(box[0].to[0], "dueno@gmail.com");
    assert.ok(box[0].headers["List-Unsubscribe"].includes("baja/resumen/a"));
    assert.strictEqual((await ae.monthlyRun(db, deps(box, { stats }))).sent, 0, "no repite");
  });

  console.log(`\n${ok} bien, ${bad} con falla`);
  process.exit(bad ? 1 : 0);
})();
