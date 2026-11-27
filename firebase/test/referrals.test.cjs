// "Invitá un comercio" (functions/referrals.js) con una base falsa en memoria. No toca la nube.
//   node firebase/test/referrals.test.cjs
const assert = require("assert");
const path = require("path");
const { fakeAdmin, fakeDb } = require("./fake-firestore.cjs");

// firebase-admin falso: referrals.js solo usa FieldValue
const adminPath = require.resolve("firebase-admin", { paths: [path.join(__dirname, "../functions")] });
require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: { firestore: fakeAdmin.firestore } };
const R = require("../functions/referrals");
const rules = require("../functions/subscription-rules");

let ok = 0, bad = 0;
const t = async (name, fn) => {
  try { await fn(); ok++; console.log(`ok    ${name}`); } catch (e) { bad++; console.log(`FALLA ${name}\n      ${e.stack.split("\n").slice(0, 3).join("\n      ")}`); }
};
const quiet = { info() {}, error() {}, warn() {} };

(async () => {
  await t("normalizeCode limpia y valida", () => {
    assert.strictEqual(R.normalizeCode(" ab-c2d3 "), "ABC2D3");
    assert.strictEqual(R.normalizeCode("ab"), null);
    assert.strictEqual(R.normalizeCode(null), null);
  });

  await t("canBeReferred: solo cuentas nuevas, no a uno mismo ni con el mismo correo", () => {
    const base = { invitedUid: "b", invitedAcc: {}, invitedEmails: ["b@gmail.com"], referrerUid: "a", referrerAcc: { email: "a@gmail.com" } };
    assert.strictEqual(R.canBeReferred(base), true);
    assert.strictEqual(R.canBeReferred({ ...base, referrerUid: "b" }), false);
    assert.strictEqual(R.canBeReferred({ ...base, invitedAcc: { paidUntil: 1 } }), false);
    assert.strictEqual(R.canBeReferred({ ...base, invitedAcc: { trialUsed: true } }), false);
    assert.strictEqual(R.canBeReferred({ ...base, invitedAcc: { referredBy: "z" } }), false);
    assert.strictEqual(R.canBeReferred({ ...base, invitedEmails: ["A@gmail.com "] }), false);
    assert.strictEqual(R.canBeReferred({ ...base, referrerAcc: null }), false);
  });

  await t("ensureCode crea un código una vez y lo reusa", async () => {
    const db = fakeDb({ ventra_accounts: { a: { email: "a@gmail.com" } } });
    const c1 = await R.ensureCode(db, "a");
    const c2 = await R.ensureCode(db, "a");
    assert.strictEqual(c1, c2);
    assert.strictEqual(c1.length, 6);
    assert.strictEqual(db.data.ventra_referral_codes[c1].uid, "a");
  });

  await t("attachReferral anota al invitado; código propio o inexistente no", async () => {
    const db = fakeDb({ ventra_accounts: { a: { email: "a@gmail.com" } } });
    const code = await R.ensureCode(db, "a");
    assert.strictEqual(await R.attachReferral(db, { rawCode: "NOEXISTE", invitedUid: "b", invitedAcc: {}, invitedEmails: [] }), null);
    assert.strictEqual(await R.attachReferral(db, { rawCode: code, invitedUid: "a", invitedAcc: {}, invitedEmails: [] }), null);
    const r = await R.attachReferral(db, { rawCode: code.toLowerCase(), invitedUid: "b", invitedAcc: {}, invitedEmails: ["b@gmail.com"], rubro: "kiosco" });
    assert.deepStrictEqual(r, { referredBy: "a", referredCode: code });
    assert.strictEqual(db.data["ventra_accounts/a/referrals"].b.status, "signed");
  });

  await t("rewardReferrer: un mes una sola vez por invitado", async () => {
    const db = fakeDb({ ventra_accounts: { a: { email: "a@gmail.com" }, b: { referredBy: "a" } } });
    assert.strictEqual(await R.rewardReferrer(db, "b"), "a");
    assert.strictEqual(await R.rewardReferrer(db, "b"), null);
    assert.strictEqual(db.data.ventra_accounts.a.referralCredits, 1);
    assert.strictEqual(db.data.ventra_accounts.a.referralEarned, 1);
    assert.strictEqual(db.data["ventra_accounts/a/referrals"].b.status, "paid");
  });

  await t("rewardReferrer: tope de meses por año", async () => {
    const year = new Date().getUTCFullYear();
    const db = fakeDb({ ventra_accounts: { a: { referralYear: { year, count: R.MAX_CREDITS_PER_YEAR } }, b: { referredBy: "a" } } });
    assert.strictEqual(await R.rewardReferrer(db, "b"), null);
    assert.strictEqual(db.data.ventra_accounts.a.referralCredits, undefined);
    const db2 = fakeDb({ ventra_accounts: { a: { referralYear: { year: year - 1, count: 12 } }, b: { referredBy: "a" } } });
    assert.strictEqual(await R.rewardReferrer(db2, "b"), "a");
    assert.deepStrictEqual(db2.data.ventra_accounts.a.referralYear, { year, count: 1 });
  });

  await t("useCredit devuelve el cobro y descuenta el mes, una sola vez por cobro", async () => {
    const db = fakeDb({ ventra_accounts: { a: { referralCredits: 1 } } });
    const calls = [];
    const fetchFn = async (url, opts) => { calls.push({ url, opts }); return { ok: true, json: async () => ({ id: 99 }) }; };
    assert.strictEqual(await R.useCredit(db, { uid: "a", authorizedPaymentId: "ap1", mpPaymentId: 555, amount: 24900, accessToken: "T", fetchFn, logger: quiet }), "done");
    assert.strictEqual(await R.useCredit(db, { uid: "a", authorizedPaymentId: "ap1", mpPaymentId: 555, accessToken: "T", fetchFn, logger: quiet }), null);
    assert.strictEqual(calls.length, 1);
    assert.ok(calls[0].url.endsWith("/v1/payments/555/refunds"));
    assert.strictEqual(calls[0].opts.headers["X-Idempotency-Key"], "ventra-referral-ap1");
    assert.strictEqual(db.data.ventra_accounts.a.referralCredits, 0);
    assert.strictEqual(db.data["ventra_accounts/a/payments"].ap1.referralRefund.status, "done");
  });

  await t("useCredit sin meses no devuelve nada", async () => {
    const db = fakeDb({ ventra_accounts: { a: {} } });
    let called = false;
    assert.strictEqual(await R.useCredit(db, { uid: "a", authorizedPaymentId: "x", mpPaymentId: 1, fetchFn: async () => { called = true; }, logger: quiet }), null);
    assert.strictEqual(called, false);
  });

  await t("useCredit: si Mercado Pago rechaza la devolución, el mes queda para el próximo cobro", async () => {
    const db = fakeDb({ ventra_accounts: { a: { referralCredits: 1 } } });
    const fetchFn = async () => ({ ok: false, status: 400, json: async () => ({ message: "no" }) });
    assert.strictEqual(await R.useCredit(db, { uid: "a", authorizedPaymentId: "ap2", mpPaymentId: 7, fetchFn, logger: quiet }), "failed");
    assert.strictEqual(db.data.ventra_accounts.a.referralCredits, 1);
    assert.strictEqual(db.data["ventra_accounts/a/payments"].ap2.referralRefund.status, "failed");
  });

  await t("stats cuenta invitados y los que ya pagan", async () => {
    const db = fakeDb({
      ventra_accounts: { a: { referralCredits: 1, referralEarned: 2 } },
      "ventra_accounts/a/referrals": { b: { status: "paid" }, c: { status: "signed" } },
    });
    const s = await R.stats(db, "a");
    assert.strictEqual(s.invited, 2);
    assert.strictEqual(s.paying, 1);
    assert.strictEqual(s.credits, 1);
    assert.strictEqual(s.earned, 2);
    assert.ok(s.link.endsWith(s.code));
  });

  await t("prueba del invitado: 30 días en las fechas y en el fin de la prueba", () => {
    const now = Date.UTC(2026, 11, 1);
    const d = rules.trialDates(now, rules.REFERRAL_TRIAL_DAYS);
    assert.strictEqual(Date.parse(d.start_date), now + 30 * rules.DAY_MS);
    const end = rules.trialEnd({ next_payment_date: d.start_date }, now, 30);
    assert.strictEqual(end.getTime(), now + 30 * rules.DAY_MS);
    // Con los 7 de siempre, una fecha a 30 días se considera rara
    assert.strictEqual(rules.trialEnd({ next_payment_date: d.start_date }, now).getTime(), now + 7 * rules.DAY_MS);
  });

  console.log(`\n${ok} ok, ${bad} con fallas`);
  process.exit(bad ? 1 : 0);
})();
