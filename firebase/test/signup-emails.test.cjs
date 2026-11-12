// Mails a registrados sin plan y avisos de gracia (functions/signup-emails.js), con una base falsa en memoria.
//   node firebase/test/signup-emails.test.cjs
const assert = require("assert");
const se = require("../functions/signup-emails");

const H = 3600 * 1000, D = 24 * H;
// 2026-11-11 15:00 en Argentina (18:00 UTC): dentro del horario de envío
const NOON = Date.UTC(2026, 10, 11, 18, 0);
const NIGHT = Date.UTC(2026, 10, 12, 4, 0); // 01:00 en Argentina

const { ts, fakeAdmin, fakeDb } = require("./fake-firestore.cjs");

let ok = 0, bad = 0;
const t = async (name, fn) => {
  try { await fn(); ok++; console.log(`ok    ${name}`); } catch (e) { bad++; console.log(`FALLA ${name}\n      ${e.stack.split("\n").slice(0, 3).join("\n      ")}`); }
};
const user = (uid, ageMs, extra = {}) => ({ uid, email: `${uid}@gmail.com`, name: "Martina Gómez", createdAt: new Date(NOON - ageMs).toISOString(), ...extra });

(async () => {
  // ─── Quién es "sin plan" ───
  await t("sin cuenta o con pago pendiente: sí; con plan pago o admin: no", () => {
    const list = se.prospects(
      [user("a", H), user("b", H), user("c", H), user("d", H), user("x", H, { email: "juanhidalgobass@gmail.com" })],
      { b: { status: "pending_payment", planName: "Ventra Full" }, c: { status: "active" }, d: { paidUntil: ts(NOON - D) } },
      { nowMs: NOON, exclude: ["juanhidalgobass@gmail.com"] },
    );
    assert.deepStrictEqual(list.map((p) => p.uid), ["a", "b"]);
    assert.strictEqual(list[1].pendingPlan, "Ventra Full");
  });
  await t("cuentas de más de 10 días: nada", () => {
    assert.strictEqual(se.prospects([user("a", 11 * D)], {}, { nowMs: NOON }).length, 0);
  });

  // ─── Qué mail toca ───
  const p = (ageMs) => ({ uid: "a", email: "a@gmail.com", createdMs: NOON - ageMs });
  await t("recién creada: bienvenida, aunque sea de noche", () => {
    assert.strictEqual(se.nextStep(p(5 * 60e3), {}, NOON), "bienvenida");
    assert.strictEqual(se.nextStep({ ...p(0), createdMs: NIGHT - 60e3 }, {}, NIGHT), "bienvenida");
  });
  await t("día 1, 3 y 7 en orden, cada uno una sola vez", () => {
    const sent = { bienvenida: ts(NOON - 30 * H) };
    assert.strictEqual(se.nextStep(p(30 * H), { sent, lastAt: sent.bienvenida }, NOON), "arrancar");
    assert.strictEqual(se.nextStep(p(3 * D + H), { sent: { ...sent, arrancar: 1 }, lastAt: ts(NOON - 2 * D) }, NOON), "paulos");
    assert.strictEqual(se.nextStep(p(7 * D + H), { sent: { ...sent, arrancar: 1, paulos: 1 }, lastAt: ts(NOON - 4 * D) }, NOON), "ayuda");
    assert.strictEqual(se.nextStep(p(9 * D), { sent: { ...sent, arrancar: 1, paulos: 1, ayuda: 1 }, lastAt: ts(NOON - 2 * D) }, NOON), null);
  });
  await t("los recordatorios no salen de noche", () => {
    assert.strictEqual(se.nextStep({ ...p(0), createdMs: NIGHT - 30 * H }, { sent: { bienvenida: 1 }, lastAt: ts(NIGHT - 30 * H) }, NIGHT), null);
  });
  await t("nunca dos mails en menos de 20 h", () => {
    assert.strictEqual(se.nextStep(p(3 * D), { sent: { bienvenida: 1, arrancar: 1 }, lastAt: ts(NOON - 10 * H) }, NOON), null);
  });
  await t("cuenta vieja sin nada mandado: solo el último que toca, sin bienvenida", () => {
    assert.strictEqual(se.nextStep(p(4 * D), {}, NOON), "paulos");
    assert.strictEqual(se.nextStep(p(2.5 * D), {}, NOON), "arrancar");
  });
  await t("dado de baja: nada", () => {
    assert.strictEqual(se.nextStep(p(H), { unsubscribed: true }, NOON), null);
  });

  // ─── Plantillas ───
  await t("cada mail: link a /empezar, WhatsApp, baja y sin HTML colado", () => {
    for (const { key } of se.STEPS) {
      const m = se.emailFor(key, { uid: "a", email: "a@gmail.com", name: "<b>martina</b>" }, { unsubUrl: "https://baja/x" });
      assert.ok(m.subject && m.html.includes("ventra.store/empezar?utm_source=email"), key);
      assert.ok(m.html.includes("wa.me/5492212048533") && !m.html.includes("5492212025603") && m.html.includes("https://baja/x") && m.text.includes("https://baja/x"), key);
      assert.ok(!m.html.includes("<b>martina</b>"), key);
      assert.ok(!/<[a-z]/i.test(m.text), `${key}: el texto plano tiene HTML`);
    }
    assert.ok(se.emailFor("bienvenida", { email: "a@gmail.com", name: "Martina Gómez" }).html.includes("¡Hola Martina!"));
    assert.ok(se.emailFor("bienvenida", { email: "a@gmail.com" }).html.includes("app.ventra.store"));
  });
  await t("pagó a medias: el mail le explica lo del correo de Mercado Pago", () => {
    const m = se.emailFor("bienvenida", { email: "a@gmail.com", pendingPlan: "Ventra Full" });
    assert.ok(m.html.includes("Ventra Full") && m.html.includes("correo de tu cuenta de Mercado Pago"));
  });

  // ─── Baja ───
  await t("la baja: token válido, GET no da de baja, POST sí", async () => {
    const db = fakeDb();
    const tok = se.unsubToken("re_k", "u1");
    assert.ok(se.validToken("re_k", "u1", tok) && !se.validToken("re_k", "u2", tok) && !se.validToken("re_otra", "u1", tok));
    const res = () => { const r = { code: 0, body: "" }; r.status = (c) => { r.code = c; return r; }; r.set = () => r; r.send = (b) => { r.body = b; return r; }; return r; };
    const r1 = res(); await se.handleUnsub(db, { method: "GET", query: { u: "u1", t: tok } }, r1, { secret: "re_k", admin: fakeAdmin });
    assert.ok(r1.body.includes("Darme de baja") && !(db.data.ventra_signup_emails || {}).u1);
    const r2 = res(); await se.handleUnsub(db, { method: "POST", query: { u: "u1", t: tok } }, r2, { secret: "re_k", admin: fakeAdmin });
    assert.strictEqual(db.data.ventra_signup_emails.u1.unsubscribed, true);
    const r3 = res(); await se.handleUnsub(db, { method: "POST", query: { u: "u2", t: tok } }, r3, { secret: "re_k", admin: fakeAdmin });
    assert.strictEqual(r3.code, 400);
    assert.ok(!db.data.ventra_signup_emails.u2);
  });

  // ─── Pasada completa ───
  await t("pasada: manda lo que toca, guarda y no repite; respeta pago y baja", async () => {
    const db = fakeDb({
      ventra_accounts: { pago: { status: "active", paidUntil: ts(NOON + 20 * D) } },
      ventra_signup_emails: { baja: { unsubscribed: true } },
    });
    const outbox = [];
    const deps = {
      apiKey: "re_test", admin: fakeAdmin, now: NOON, logger: { warn() {} },
      listUsers: async () => [user("nuevo", 10 * 60e3), user("pago", H), user("baja", H), user("viejo", 30 * D)],
      send: async (_k, msg) => { outbox.push(msg); return { id: `m${outbox.length}` }; },
    };
    const r = await se.signupEmailsRun(db, deps);
    assert.deepStrictEqual([r.sent, r.failed], [1, 0]);
    assert.strictEqual(outbox[0].to[0], "nuevo@gmail.com");
    assert.ok(outbox[0].headers["List-Unsubscribe"].includes("ventraEmailBaja?u=nuevo"));
    assert.ok(db.data.ventra_signup_emails.nuevo.sent.bienvenida && !db.data.ventra_signup_emails.nuevo.sending);
    assert.strictEqual((await se.signupEmailsRun(db, deps)).sent, 0, "la segunda pasada no repite");
    // Al día siguiente toca "arrancar"; si en el medio pagó, nada
    const next = { ...deps, now: NOON + 25 * H };
    db.data.ventra_accounts.nuevo = { paidUntil: ts(NOON + 30 * D), status: "active" };
    assert.strictEqual((await se.signupEmailsRun(db, next)).sent, 0);
    delete db.data.ventra_accounts.nuevo;
    assert.strictEqual((await se.signupEmailsRun(db, next)).sent, 1);
    assert.strictEqual(outbox[1].tags[1].value, "arrancar");
  });
  await t("pasada: error de Resend se reintenta hasta 3 veces; sin clave no manda", async () => {
    const db = fakeDb();
    let calls = 0;
    const deps = { apiKey: "re_test", admin: fakeAdmin, logger: { warn() {} }, listUsers: async () => [user("a", 10 * 60e3)], send: async () => { calls++; throw Object.assign(new Error("caído"), { status: 503 }); } };
    for (let i = 0; i < 5; i++) await se.signupEmailsRun(db, { ...deps, now: NOON + i * 20 * 60e3 });
    assert.strictEqual(calls, 3);
    assert.strictEqual((await se.signupEmailsRun(db, { ...deps, apiKey: "" })).skipped, "sin configurar");
  });

  // ─── Período de gracia ───
  const acc = (paidAgoMs, extra = {}) => ({ uid: "g", email: "dueno@gmail.com", name: "Ana", planName: "Ventra Full", paidUntil: ts(NOON - paidAgoMs), ...extra });
  await t("gracia: aviso al vencer, otro con 2 días o menos, nada antes ni después", () => {
    assert.strictEqual(se.graceStep(acc(-H), {}, NOON), null, "todavía vigente");
    assert.strictEqual(se.graceStep(acc(H), {}, NOON).step, "inicio");
    const key = se.graceStep(acc(2 * D), {}, NOON).key;
    assert.strictEqual(se.graceStep(acc(2 * D), { grace: { [key]: { inicio: 1 } } }, NOON), null);
    assert.strictEqual(se.graceStep(acc(2 * D), { grace: { "2020-01-01": { inicio: 1 } } }, NOON).step, "inicio", "otro vencimiento no cuenta");
    const k5 = se.graceStep(acc(5.5 * D), {}, NOON).key;
    assert.strictEqual(se.graceStep(acc(5.5 * D), { grace: { [k5]: { inicio: 1 } } }, NOON).step, "fin");
    assert.strictEqual(se.graceStep(acc(5.5 * D), { grace: { [k5]: { inicio: 1, fin: 1 } } }, NOON), null);
    assert.strictEqual(se.graceStep(acc(8 * D), {}, NOON).step, "bloqueo", "recién en solo lectura: aviso");
    const k8 = se.graceStep(acc(8 * D), {}, NOON).key;
    assert.strictEqual(se.graceStep(acc(8 * D), { grace: { [k8]: { bloqueo: 1 } } }, NOON), null, "una sola vez");
    assert.strictEqual(se.graceStep(acc(10 * D), {}, NOON), null, "solo lectura de hace días: nada");
    assert.strictEqual(se.graceStep({ ...acc(H), paidUntil: ts(NIGHT - H) }, {}, NIGHT), null, "de noche no");
  });
  await t("gracia: el mail dice el plan y los días, y lleva a Mi cuenta", () => {
    const m = se.graceEmailFor("inicio", acc(H), NOON);
    assert.ok(m.subject.includes("Ventra Full") && m.subject.includes("7 días") && m.html.includes("cuenta.html"), m.subject);
    const f = se.graceEmailFor("fin", acc(6 * D), NOON);
    assert.ok(f.subject.includes("1 día") && f.html.includes("solo lectura"), f.subject);
    assert.deepStrictEqual(se.graceWaParams(acc(6 * D), NOON), ["Ventra Full", "1 día"]);
  });
  await t("gracia: pasada completa, la baja de los mails de bienvenida no lo corta", async () => {
    const db = fakeDb({
      ventra_accounts: { g: acc(H), ok: acc(-5 * D), ro: acc(9 * D) },
      ventra_signup_emails: { g: { unsubscribed: true } },
    });
    const outbox = [];
    const deps = { apiKey: "re_test", admin: fakeAdmin, now: NOON, logger: { warn() {} }, send: async (_k, m) => { outbox.push(m); return { id: "x" }; } };
    const r = await se.graceEmailsRun(db, deps);
    assert.deepStrictEqual([r.sent, r.inGrace], [1, 1]);
    assert.strictEqual(outbox[0].to[0], "dueno@gmail.com");
    assert.strictEqual((await se.graceEmailsRun(db, deps)).sent, 0, "no repite");
    assert.strictEqual((await se.graceEmailsRun(db, { ...deps, now: NOON + 5 * D })).sent, 1, "el de faltan 2 días");
    assert.ok(outbox[1].subject.startsWith("Quedan"));
  });
  await t("gracia por WhatsApp: apagado hasta aprobar la plantilla; prendido va solo al dueño", async () => {
    const db = fakeDb({ ventra_accounts: { g: acc(H) }, ventra_wa_owners: { "5491100000001": { uid: "g", role: "OWNER" }, "5491100000002": { uid: "g", role: "SUPERVISOR" } } });
    const wa = [];
    const deps = { apiKey: "", admin: fakeAdmin, now: NOON, logger: { warn() {} }, sendWaTemplate: async (to, tpl, params) => { wa.push({ to, tpl, params }); } };
    assert.strictEqual((await se.graceEmailsRun(db, deps)).skipped, "sin configurar");
    se.GRACE_WA_TEMPLATE.enabled = true;
    try {
      const r = await se.graceEmailsRun(db, deps);
      assert.deepStrictEqual([r.sent, r.wa], [1, 1]);
      assert.deepStrictEqual(wa.map((w) => w.to), ["5491100000001"]);
      assert.strictEqual(wa[0].tpl.name, "suscripcion_vencida");
    } finally { se.GRACE_WA_TEMPLATE.enabled = false; }
  });

  // ─── Registro para el admin ───
  await t("sin clave no manda, pero cuenta a cuántos les toca", async () => {
    const db = fakeDb();
    const r = await se.signupEmailsRun(db, { apiKey: "PENDIENTE", admin: fakeAdmin, now: NOON, listUsers: async () => [user("a", H), user("b", 4 * D), user("c", 30 * D)] });
    assert.deepStrictEqual([r.skipped, r.sent, r.candidates, r.due], ["sin configurar", 0, 2, 2]);
    assert.ok(!db.data.ventra_signup_emails || !Object.keys(db.data.ventra_signup_emails).length, "no marca nada como mandado");
    const g = await se.graceEmailsRun(fakeDb({ ventra_accounts: { g: acc(H) } }), { apiKey: "", admin: fakeAdmin, now: NOON });
    assert.deepStrictEqual([g.skipped, g.due], ["sin configurar", 1]);
  });
  await t("cada envío queda registrado y el informe lo muestra", async () => {
    const db = fakeDb({ ventra_accounts: { g: acc(H) }, ventra_signup_emails: { z: { unsubscribed: true } } });
    let n = 0;
    const send = async () => { if (++n === 2) throw Object.assign(new Error("dominio no verificado"), { status: 403 }); return { id: `re_${n}` }; };
    const r = await se.signupEmailsRun(db, { apiKey: "re_x", admin: fakeAdmin, now: NOON, logger: { warn() {} }, send, listUsers: async () => [user("a", H), user("b", H)] });
    const g = await se.graceEmailsRun(db, { apiKey: "re_x", admin: fakeAdmin, now: NOON, logger: { warn() {} }, send });
    await se.saveRun(db, fakeAdmin, NOON, r, g);
    const rep = await se.report(db, { nowMs: NOON + H });
    assert.deepStrictEqual([rep.sent30, rep.failed30, rep.unsubscribed, rep.items.length], [2, 1, 1, 3]);
    assert.strictEqual(rep.lastRunAt, NOON);
    assert.strictEqual(rep.byStep["sin_plan:bienvenida"], 1);
    assert.strictEqual(rep.byStep["gracia:inicio"], 1);
    const bad = rep.items.find((x) => !x.ok);
    assert.ok(bad.error.includes("dominio") && bad.to.endsWith("@gmail.com"));
  });
  await t("dominio sin verificar (403): no quema el mail de nadie y corta la pasada", async () => {
    const db = fakeDb();
    let calls = 0;
    const send = async () => { calls++; throw Object.assign(new Error("The ventra.store domain is not verified"), { status: 403 }); };
    const r = await se.signupEmailsRun(db, { apiKey: "re_x", admin: fakeAdmin, now: NOON, logger: { warn() {} }, send, listUsers: async () => [user("a", H), user("b", H)] });
    assert.strictEqual(calls, 1, "corta en el primero");
    assert.ok(r.skipped.includes("not verified"));
    assert.ok(!db.data.ventra_signup_emails.a.tries, "sin intento contado");
    assert.strictEqual(se.nextStep({ uid: "a", createdMs: NOON - H }, db.data.ventra_signup_emails.a, NOON + 20 * 60e3), "bienvenida", "sale cuando se arregle");
  });
  await t("los registros de más de 120 días se borran", async () => {
    const db = fakeDb({ ventra_email_log: { viejo: { at: ts(NOON - 200 * D) }, nuevo: { at: ts(NOON - D) } } });
    assert.strictEqual(await se.pruneLog(db, fakeAdmin, NOON), 1);
  });

  await t("cada mail enviado se guarda completo y se puede ver tal cual", async () => {
    const db = fakeDb();
    const send = async () => ({ id: "re_1" });
    await se.signupEmailsRun(db, { apiKey: "re_x", admin: fakeAdmin, now: NOON, logger: { warn() {} }, send, listUsers: async () => [user("a", H)] });
    const rep = await se.report(db, { nowMs: NOON + H });
    assert.ok(rep.items[0].logId && rep.items[0].subject, "el registro trae id y asunto");
    const v = await se.viewEmail(db, { auth: () => ({ getUser: async () => null }) }, rep.items[0].logId);
    assert.strictEqual(v.exact, true);
    assert.ok(v.html.includes("<html") && v.subject === rep.items[0].subject);
  });
  await t("mail viejo sin guardar: se reconstruye con la plantilla", async () => {
    const db = fakeDb({ ventra_email_log: { L1: { at: ts(NOON), kind: "sin_plan", step: "ayuda", uid: "u9", to: "martina@gmail.com", ok: true } } });
    const fakeAuth = { auth: () => ({ getUser: async () => ({ email: "martina@gmail.com", displayName: "MARTINA GOMEZ", metadata: { creationTime: new Date(NOON - 7 * 24 * H).toUTCString() } }) }) };
    const v = await se.viewEmail(db, fakeAuth, "L1");
    assert.strictEqual(v.exact, false);
    assert.strictEqual(v.subject, "Te ayudamos a cargar tus productos");
    assert.ok(v.html.includes("¡Hola Martina!") && v.html.includes("último mail"), "igual que el que salió");
  });
  await t("día 7 como primer mail: no dice que es el último", async () => {
    const p = { uid: "a", email: "a@gmail.com", name: "Ana", createdMs: NOON - 8 * 24 * H };
    assert.ok(!se.emailFor("ayuda", p, { firstMail: true }).html.includes("último mail"));
    assert.ok(se.emailFor("ayuda", p, {}).html.includes("último mail"));
  });

  console.log(`\n${ok} bien, ${bad} con falla`);
  process.exit(bad ? 1 : 0);
})();
