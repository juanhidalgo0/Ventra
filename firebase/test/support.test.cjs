// Soporte de Ventra por WhatsApp (functions/support.js), con una base falsa y WhatsApp simulado.
//   node firebase/test/support.test.cjs
const assert = require("assert");
const sp = require("../functions/support");
const { ts, fakeAdmin, fakeDb } = require("./fake-firestore.cjs");

const H = 3600 * 1000, D = 24 * H;
const NOW = Date.UTC(2026, 10, 11, 18, 0);
let ok = 0, bad = 0;
const t = async (name, fn) => {
  try { await fn(); ok++; console.log(`ok    ${name}`); } catch (e) { bad++; console.log(`FALLA ${name}\n      ${e.stack.split("\n").slice(0, 3).join("\n      ")}`); }
};
const wa = () => {
  const out = [];
  return { out, io: { admin: fakeAdmin, name: "Martina", sendText: async (to, text) => out.push({ to, text }), sendButtons: async (to, text, buttons) => out.push({ to, text, buttons: buttons.map((b) => b.id) }), notifyHuman: async () => out.push({ alert: true }) } };
};
let n = 0;
const txt = (body, from = "5491100000001") => ({ id: `wamid.${++n}`, from, type: "text", text: { body } });
const btn = (id, from = "5491100000001") => ({ id: `wamid.${++n}`, from, type: "interactive", interactive: { button_reply: { id, title: "Hablar con persona" } } });

(async () => {
  await t("detecta cuando piden una persona", () => {
    for (const s of ["Quiero hablar con una persona", "puedo hablar con alguien?", "necesito un asesor humano", "Quiero hablar con una persona de Ventra", "me atiende alguien del equipo?"]) assert.ok(sp.HUMAN_RE.test(s), s);
    for (const s of ["hola", "cuánto sale el plan full", "tengo un kiosco con 3 personas", "¿sirve para una persona sola?"]) assert.ok(!sp.HUMAN_RE.test(s), s);
  });
  await t("historia para la IA: alterna, empieza y termina por el usuario", () => {
    const h = sp.history([{ dir: "out", text: "hola" }, { dir: "in", text: "a" }, { dir: "in", text: "b" }, { dir: "out", text: "c" }, { dir: "in", text: "d" }, { dir: "out", text: "e" }]);
    assert.deepStrictEqual(h, [{ role: "user", content: "a\nb" }, { role: "assistant", content: "c" }, { role: "user", content: "d" }]);
  });
  await t("negrita de la IA al formato de WhatsApp", () => {
    assert.strictEqual(sp.waFormat("El **Ventra Full** sale $24.900"), "El *Ventra Full* sale $24.900");
  });

  await t("mensaje nuevo: se anota y se encola para la IA, sin contestar todavía", async () => {
    const db = fakeDb(), { out, io } = wa();
    assert.strictEqual(await sp.onMessage(db, txt("hola, cuánto sale?"), io, NOW), true);
    const conv = db.data.ventra_support["5491100000001"];
    assert.strictEqual(conv.name, "Martina");
    assert.strictEqual(conv.unread, 1);
    assert.strictEqual(Object.keys(db.data.ventra_support_inbox).length, 1);
    assert.strictEqual(Object.values(db.data.ventra_support_inbox)[0].first, true);
    assert.strictEqual(out.length, 0);
  });
  await t("Meta reintenta el mismo mensaje: no se duplica", async () => {
    const db = fakeDb(), { io } = wa();
    const m = txt("hola");
    await sp.onMessage(db, m, io, NOW);
    await sp.onMessage(db, m, io, NOW + 1000);
    assert.strictEqual(db.data.ventra_support["5491100000001"].unread, 1);
  });
  await t("cliente de un turno que nunca habló con soporte: no es de soporte", async () => {
    const db = fakeDb({ ventra_wa_contacts: { "5491100000001": { storeId: "s1" } } }), { io } = wa();
    assert.strictEqual(await sp.onMessage(db, txt("hola"), io, NOW), false);
    assert.strictEqual(await sp.onMessage(db, txt("quiero hablar con una persona"), io, NOW), true, "pero si pide persona, sí");
  });

  await t("la IA contesta con el botón de persona y saluda la primera vez", async () => {
    const db = fakeDb(), { out, io } = wa();
    await sp.onMessage(db, txt("¿sirve para un kiosco?"), io, NOW);
    const item = Object.values(db.data.ventra_support_inbox)[0];
    let asked = null;
    const r = await sp.processInbox(db, item, { ...io, now: NOW + 2000, answer: async (msgs) => { asked = msgs; return "Sí, **Ventra Full** es para tu kiosco."; } });
    assert.strictEqual(r, "answered");
    assert.deepStrictEqual(asked, [{ role: "user", content: "¿sirve para un kiosco?" }]);
    assert.ok(out[0].text.startsWith("¡Hola! Soy el asistente de Ventra.") && out[0].text.includes("*Ventra Full*"));
    assert.deepStrictEqual(out[0].buttons, ["sp|humano"]);
    assert.strictEqual(db.data.ventra_support["5491100000001"].daily.n, 1);
  });
  await t("ráfaga de mensajes: contesta solo el último", async () => {
    const db = fakeDb(), { out, io } = wa();
    await sp.onMessage(db, txt("hola"), io, NOW);
    await sp.onMessage(db, txt("tengo un kiosco"), io, NOW + 3000);
    const [first, second] = Object.values(db.data.ventra_support_inbox);
    const answer = async () => "Dale";
    assert.strictEqual(await sp.processInbox(db, first, { ...io, now: NOW + 4000, answer }), "superseded");
    assert.strictEqual(await sp.processInbox(db, second, { ...io, now: NOW + 4000, answer }), "answered");
    assert.strictEqual(out.length, 1);
  });
  await t("tope diario: avisa una vez y ofrece la persona", async () => {
    const db = fakeDb({ ventra_support: { "5491100000001": { lastInboundAt: ts(NOW), daily: { day: "2026-11-11", n: sp.DAILY_LIMIT } } } }), { out, io } = wa();
    const item = { phone: "5491100000001", at: NOW };
    assert.strictEqual(await sp.processInbox(db, item, { ...io, now: NOW + 1, answer: async () => "no" }), "limit");
    assert.strictEqual(await sp.processInbox(db, item, { ...io, now: NOW + 2, answer: async () => "no" }), "limit");
    assert.strictEqual(out.length, 1);
    assert.deepStrictEqual(out[0].buttons, ["sp|humano"]);
  });
  await t("al día siguiente el tope vuelve a cero", async () => {
    const db = fakeDb({ ventra_support: { "5491100000001": { lastInboundAt: ts(NOW + D), daily: { day: "2026-11-11", n: sp.DAILY_LIMIT } } } }), { io } = wa();
    await db.collection("ventra_support").doc("5491100000001").collection("messages").add({ dir: "in", text: "hola", at: ts(NOW + D) });
    assert.strictEqual(await sp.processInbox(db, { phone: "5491100000001", at: NOW + D }, { ...io, now: NOW + D + 1, answer: async () => "Hola" }), "answered");
  });
  await t("si la IA falla, ofrece una persona", async () => {
    const db = fakeDb(), { out, io } = wa();
    await sp.onMessage(db, txt("hola"), io, NOW);
    await sp.processInbox(db, Object.values(db.data.ventra_support_inbox)[0], { ...io, now: NOW + 1, answer: async () => null });
    assert.ok(out[0].text.includes("una persona") && out[0].buttons[0] === "sp|humano");
  });

  await t("botón persona: el bot se calla, avisa una sola vez y no encola más", async () => {
    const db = fakeDb(), { out, io } = wa();
    await sp.onMessage(db, btn("sp|humano"), io, NOW);
    const conv = db.data.ventra_support["5491100000001"];
    assert.strictEqual(conv.mode, "human");
    assert.strictEqual(conv.humanRequests, 1);
    assert.ok(out.some((o) => o.alert) && out.some((o) => o.text && o.text.includes("una persona del equipo")));
    const before = out.length;
    await sp.onMessage(db, txt("es por un pago"), io, NOW + 60000);
    await sp.onMessage(db, txt("quiero hablar con una persona"), io, NOW + 120000);
    assert.strictEqual(out.length, before, "no contesta ni vuelve a avisar");
    assert.ok(!db.data.ventra_support_inbox, "nada para la IA");
  });
  await t("modo persona vence a las 48 h sin movimiento; 'Seguir con el bot' lo devuelve", async () => {
    assert.ok(sp.isHuman({ mode: "human", humanAt: ts(NOW) }, NOW + 47 * H));
    assert.ok(!sp.isHuman({ mode: "human", humanAt: ts(NOW) }, NOW + 49 * H));
    const db = fakeDb({ ventra_support: { "5491100000001": { mode: "human", humanAt: ts(NOW) } } }), { out, io } = wa();
    await sp.onMessage(db, btn("sp|bot"), io, NOW + H);
    assert.strictEqual(db.data.ventra_support["5491100000001"].mode, "bot");
    assert.ok(out[0].text.includes("sigo yo"));
  });
  await t("audio o foto: pide que escriba y ofrece la persona", async () => {
    const db = fakeDb(), { out, io } = wa();
    await sp.onMessage(db, { id: "a1", from: "5491100000001", type: "audio", audio: { id: "x" } }, io, NOW);
    assert.ok(out[0].text.includes("solo mensajes escritos"));
    assert.ok(Object.values(db.data["ventra_support/5491100000001/messages"]).some((x) => x.dir === "in" && x.text === "[Audio]"));
  });

  // ─── Admin ───
  await t("admin: lista primero los que esperan, lee el hilo y responde dentro de las 24 h", async () => {
    const db = fakeDb(), { out, io } = wa();
    await sp.onMessage(db, txt("hola", "5491100000002"), io, NOW);
    await sp.onMessage(db, btn("sp|humano", "5491100000001"), io, NOW - H);
    const l = await sp.list(db, NOW + 1000);
    assert.deepStrictEqual(l.items.map((x) => [x.phone, x.waiting]), [["5491100000001", true], ["5491100000002", false]]);
    const th = await sp.thread(db, "5491100000001", NOW + 1000);
    assert.ok(th.messages.length >= 2 && th.waiting && th.canReply);
    assert.strictEqual(db.data.ventra_support["5491100000001"].unread, 0);
    await sp.reply(db, { phone: "5491100000001", text: "Hola, soy Juan de Ventra", adminEmail: "a@b.com", admin: fakeAdmin, sendText: io.sendText, now: NOW + 2000 });
    assert.strictEqual(out[out.length - 1].text, "Hola, soy Juan de Ventra");
    assert.strictEqual(db.data.ventra_support["5491100000001"].mode, "human");
    await assert.rejects(sp.reply(db, { phone: "5491100000001", text: "hola", admin: fakeAdmin, sendText: io.sendText, now: NOW + 25 * H }), /24 h/);
    await sp.setMode(db, { phone: "5491100000001", mode: "bot", admin: fakeAdmin, now: NOW + 3000 });
    assert.strictEqual(db.data.ventra_support["5491100000001"].mode, "bot");
  });

  // ─── 24 h ───
  await t("recordatorio: solo si espera persona, nadie respondió y quedan 4 h o menos, una vez", () => {
    const base = { phone: "1", mode: "human", lastInboundAt: ts(NOW - 21 * H) };
    assert.strictEqual(sp.dueReminders([base], NOW).length, 1);
    assert.strictEqual(sp.dueReminders([{ ...base, lastAdminAt: ts(NOW - 20 * H) }], NOW).length, 0, "ya le respondieron");
    assert.strictEqual(sp.dueReminders([{ ...base, lastInboundAt: ts(NOW - 10 * H) }], NOW).length, 0, "todavía hay tiempo");
    assert.strictEqual(sp.dueReminders([{ ...base, lastInboundAt: ts(NOW - 25 * H) }], NOW).length, 0, "ya vencido");
    assert.strictEqual(sp.dueReminders([{ ...base, mode: "bot" }], NOW).length, 0, "lo atiende el bot");
    assert.strictEqual(sp.dueReminders([{ ...base, remindedFor: ts(NOW - 21 * H) }], NOW).length, 0, "ya avisado");
    assert.ok(sp.alertText({ ...base, name: "Marcela" }, "remind", NOW).title.startsWith("Quedan 3 h para responderle a Marcela"));
  });
  await t("pasada de recordatorios: avisa y no repite", async () => {
    const db = fakeDb({ ventra_support: { "1": { mode: "human", lastInboundAt: ts(NOW - 21 * H), lastText: "hola" }, "2": { mode: "human", lastInboundAt: ts(NOW - 2 * H) } } });
    const alerts = [];
    const deps = { admin: fakeAdmin, now: NOW, alert: async (c, kind) => alerts.push([c.phone, kind]) };
    assert.strictEqual(await sp.remindersRun(db, deps), 1);
    assert.strictEqual(await sp.remindersRun(db, deps), 0);
    assert.deepStrictEqual(alerts, [["1", "remind"]]);
  });
  await t("retomar pasadas las 24 h: con la plantilla aprobada, una vez hasta que responda", async () => {
    const db = fakeDb({ ventra_support: { "1": { name: "Marcela Pérez", mode: "human", lastInboundAt: ts(NOW - 30 * H) } } });
    const sent = [];
    const args = { phone: "1", adminEmail: "a@b.com", admin: fakeAdmin, sendTemplate: async (to, tpl, params) => sent.push([to, tpl.name, params]), now: NOW };
    await assert.rejects(sp.reopen(db, args), /plantilla/, "sin aprobar no sale");
    sp.REOPEN_TEMPLATE.enabled = true;
    try {
      await sp.reopen(db, args);
      assert.deepStrictEqual(sent, [["1", "retomar_consulta", ["Marcela"]]]);
      await assert.rejects(sp.reopen(db, { ...args, now: NOW + H }), /esperá a que responda/);
      const th = await sp.thread(db, "1", NOW + H);
      assert.ok(th.reopenPending && !th.canReply);
    } finally { sp.REOPEN_TEMPLATE.enabled = false; }
  });

  await t("avisa por cada mensaje que entra, no solo cuando pide persona", async () => {
    const T = (m) => ({ toMillis: () => m });
    assert.strictEqual(sp.alertKind(null, { lastInboundAt: T(10) }), "first");
    assert.strictEqual(sp.alertKind({ lastInboundAt: T(10) }, { lastInboundAt: T(20) }), "msg");
    assert.strictEqual(sp.alertKind({ lastInboundAt: T(10), humanRequests: 0 }, { lastInboundAt: T(20), humanRequests: 1 }), "new");
    assert.strictEqual(sp.alertKind({ lastInboundAt: T(20) }, { lastInboundAt: T(20), lastText: "respuesta del bot" }), null, "la respuesta del bot no avisa");
    assert.strictEqual(sp.alertKind({ lastInboundAt: T(20) }, null), null);
    assert.ok(sp.alertText({ phone: "549111", name: "Ana", lastText: "hola" }, "msg").title.includes("Ana"));
  });

  console.log(`\n${ok} bien, ${bad} con falla`);
  process.exit(bad ? 1 : 0);
})();
