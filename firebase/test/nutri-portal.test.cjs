// Pruebas del portal del paciente y del aviso de controles (functions/nutri-portal.js), con una
// base en memoria. node firebase/test/nutri-portal.test.cjs
const assert = require("node:assert/strict");
const portal = require("../functions/nutri-portal.js");

/** Firestore mínimo: documentos por ruta, subcolecciones, update y collectionGroup con where 'in'. */
function fakeDb(data) {
  const docs = new Map(Object.entries(data));
  const docRef = (path) => ({
    id: path.split("/").pop(),
    path,
    get parent() { const parts = path.split("/"); return { id: parts[parts.length - 2], parent: parts.length > 2 ? docRef(parts.slice(0, -2).join("/")) : null }; },
    get: async () => ({ id: path.split("/").pop(), exists: docs.has(path), data: () => docs.get(path), ref: docRef(path) }),
    update: async (patch) => { docs.set(path, { ...docs.get(path), ...patch }); },
    collection: (name) => colRef(`${path}/${name}`),
  });
  const list = (prefix) => [...docs.keys()].filter((k) => k.startsWith(prefix + "/") && !k.slice(prefix.length + 1).includes("/"));
  const colRef = (path) => ({
    doc: (id) => docRef(`${path}/${id}`),
    get: async () => ({ docs: list(path).map((k) => ({ id: k.split("/").pop(), data: () => docs.get(k), ref: docRef(k) })) }),
  });
  return {
    docs,
    collection: (name) => colRef(name),
    collectionGroup: (name) => ({
      where: (field, op, values) => ({
        get: async () => ({
          docs: [...docs.keys()].filter((k) => k.split("/").slice(-2)[0] === name && values.includes(docs.get(k)[field]))
            .map((k) => ({ id: k.split("/").pop(), data: () => docs.get(k), ref: docRef(k) })),
        }),
      }),
    }),
  };
}

const TOKEN = "abcdefghijkmnopqrstuvwx";
const today = portal.dateKeyOf();
const tomorrow = portal.addDaysKey(today, 1);
const seed = () => fakeDb({
  [`nutri_portal/${TOKEN}`]: { ownerUid: "dueña", storeId: "st1", patientId: "p1" },
  "nutri_portal/viejotokenviejotokenviejo": { ownerUid: "dueña", storeId: "st1", patientId: "p1" },
  "ventra_stores/st1": { ownerUid: "dueña", businessName: "Lic. Gómez", logoUrl: "data:image/png;base64,AAAA", whatsappNumber: "5491122334455", isPublished: true, subdomain: "lic-gomez" },
  "ventra_stores/st1/nutri_patients/p1": {
    name: "Ana María Pérez", portalToken: TOKEN, nextControl: tomorrow, goalWeight: 65, videoLink: "https://meet.jit.si/ventra-consulta-abc123",
    history: { pathologies: "Hipotiroidismo" },
  },
  "ventra_stores/st1/nutri_patients/p1/consultas/c1": { dateKey: "2026-09-01", weight: 80, height: 165, waist: 92, assessment: "Nota clínica privada" },
  "ventra_stores/st1/nutri_patients/p1/consultas/c2": { dateKey: "2026-10-01", weight: 77.5, assessment: "Otra nota privada" },
  "ventra_stores/st1/nutri_patients/p1/planes/viejo": { title: "Plan viejo", status: "old", meals: [] },
  "ventra_stores/st1/nutri_patients/p1/planes/a": { title: "Descenso", status: "active", kcalTarget: 1600, meals: [{ name: "Desayuno", time: "08:00", items: [{ name: "Leche", grams: 200, measure: "1 taza", unitGrams: 200, per100: { k: 35 } }] }] },
  "ventra_stores/st1/nutri_patients/p2": { name: "Beto", nextControl: tomorrow, remindedFor: tomorrow },
  "ventra_stores/st1/nutri_patients/p3": { name: "Caro Díaz", nextControl: portal.addDaysKey(today, 2) },
  "ventra_stores/st1/nutri_patients/p4": { name: "Archivado", nextControl: tomorrow, archived: true },
  "ventra_stores/st2": { ownerUid: "otro" },
  "ventra_stores/st2/nutri_patients/x": { name: "Lejano", nextControl: portal.addDaysKey(today, 5) },
});

let n = 0, bad = 0;
const t = async (name, fn) => {
  try { await fn(); n++; console.log("ok   ", name); } catch (err) { bad++; console.log("FALLA", name, "\n     ", err.message); }
};

/** Respuesta HTTP falsa */
const call = async (db, method, body, opts) => {
  const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
  await portal.handle(db, { method, body }, res, opts);
  return res;
};

(async () => {
  await t("el paciente ve su plan vigente, su evolución y lo que viene, sin notas clínicas", async () => {
    const v = await portal.view(seed(), TOKEN);
    assert.equal(v.patient.firstName, "Ana");
    assert.equal(v.business.name, "Lic. Gómez");
    assert.equal(v.business.logo, null); // los logos embebidos no se mandan
    assert.equal(v.business.bookingUrl, "https://ventra.store/lic-gomez/turnos");
    assert.equal(v.plan.title, "Descenso");
    assert.equal(v.plan.meals[0].items[0].measure, "1 taza");
    assert.equal(v.plan.meals[0].items[0].per100, undefined);
    assert.deepEqual(v.evolution.map((p) => p.w), [80, 77.5]);
    assert.equal(v.evolution[1].bmi, 28.5); // con la última talla medida
    assert.equal(v.nextControl, tomorrow);
    assert.ok(v.video.startsWith("https://meet.jit.si/"));
    assert.equal(JSON.stringify(v).includes("privada"), false);
    assert.equal(JSON.stringify(v).includes("Hipotiroidismo"), false);
    assert.deepEqual(v.intake, { done: false, reviewed: false, data: null });
  });

  await t("un link inventado, viejo o mal formado no muestra nada", async () => {
    const db = seed();
    await assert.rejects(portal.view(db, "noexisteniexistiranuncajamas"), { code: "not-found" });
    await assert.rejects(portal.view(db, "viejotokenviejotokenviejo"), { code: "not-found" });
    await assert.rejects(portal.view(db, "../ventra_stores"), { code: "bad-token" });
    assert.equal((await call(db, "POST", { t: "corto" })).code, 404);
    assert.equal((await call(db, "GET", {})).code, 405);
  });

  await t("la ficha previa se guarda limpia, avisa a la dueña y se puede corregir hasta que la revisa", async () => {
    const db = seed();
    const sent = [];
    const opts = { notifyOwner: async (uid, msg) => sent.push({ uid, msg }) };
    const long = "x".repeat(3000);
    const r = await call(db, "POST", { t: TOKEN, intake: { reason: "  Bajar de peso ", eating: long, history: "no va", allergies: 7 } }, opts);
    assert.equal(r.code, 200);
    const p = db.docs.get("ventra_stores/st1/nutri_patients/p1");
    assert.deepEqual(Object.keys(p.intake.data).sort(), ["eating", "reason"]);
    assert.equal(p.intake.data.reason, "Bajar de peso");
    assert.equal(p.intake.data.eating.length, 2000);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].uid, "dueña");
    assert.ok(sent[0].msg.title.startsWith("Ana María Pérez completó"));
    assert.equal((await portal.view(db, TOKEN)).intake.data.reason, "Bajar de peso");
    // Vacía no se guarda; revisada ya no se puede cambiar
    assert.equal((await call(db, "POST", { t: TOKEN, intake: { reason: "   " } }, opts)).code, 400);
    p.intake.reviewed = true;
    assert.equal((await call(db, "POST", { t: TOKEN, intake: { reason: "otra" } }, opts)).code, 409);
    assert.equal((await portal.view(db, TOKEN)).intake.data, null);
  });

  await t("aviso de controles: mañana y pasado, sin los ya recordados ni archivados, uno por consultorio", async () => {
    const due = await portal.controlsDue(seed(), today);
    assert.equal(due.length, 1);
    assert.equal(due[0].ownerUid, "dueña");
    assert.deepEqual(due[0].list.map((x) => x.name).sort(), ["Ana María Pérez", "Caro Díaz"]);
    const msg = portal.controlsMessage(due[0].list);
    assert.equal(msg.title, "2 controles en los próximos días");
    assert.ok(msg.body.includes("Ana (mañana)") && msg.body.includes("Caro (pasado mañana)"));
    assert.equal(portal.controlsMessage([{ name: "Ana Pérez", when: "mañana" }]).title, "Control de Ana mañana");
  });

  console.log(`\n${n} bien, ${bad} mal`);
  process.exit(bad ? 1 : 0);
})();
