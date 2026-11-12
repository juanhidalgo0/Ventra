// ═══════════════════════════════════════════════════
// Lecciones a prueba (plan-boletas-ia.md, tanda 4.1). Una lección nueva de un proveedor queda
// "a prueba". Con 3 o más boletas confirmadas de ese proveedor (muestras, invoice-samples.js) se leen
// esas boletas con y sin la lección y se compara contra lo confirmado (eval-boletas/compare.js):
//   - el acierto sube → "adopted" (la usan todos los comercios)
//   - baja → "discarded" (no la usa nadie)
//   - igual → sigue a prueba (y se anota el resultado)
// Con menos muestras sigue la regla de antes (dos comercios). Corre cada lunes y con el botón del admin
// (pestaña Boletas), con tope de gasto por corrida. Solo funciones y admin.
// ═══════════════════════════════════════════════════
const lessons = require("./supplier-lessons");
const samples = require("./invoice-samples");
const cmp = require("./eval-boletas/compare");

const MIN_DOCS = 3;        // boletas confirmadas de ese proveedor para poder probar
const MAX_DOCS = 4;        // como mucho, para que no se dispare el costo
const BUDGET_USD = 2;      // tope por corrida (cada lunes o el botón del admin)
const EST_PAGE_USD = 0.02; // estimado por hoja leída, para no pasarse del tope antes de empezar

/** Lo leído de varias boletas → un puntaje (boletas perfectas pesan más que cada campo). Pura. */
function score(results) {
  return results.reduce((s, r) => s + (r.perfect ? 10 : 0) + r.fields.quantity[0] + r.fields.unitsPerPack[0] + r.fields.cost[0] + r.fields.code[0]
    + Object.values(r.header).filter((v) => v === true).length - r.lines.missing.length - r.lines.extra.length, 0);
}

/** Con y sin → qué hacer con la lección. Pura. */
const decide = (withScore, withoutScore) => (withScore > withoutScore ? "adopted" : withScore < withoutScore ? "discarded" : "candidate");

/** Muestras confirmadas de un CUIT → boletas (hojas juntas), las más nuevas primero. Pura. */
function groupDocs(rows) {
  const docs = new Map();
  for (const s of rows) {
    if (!s.confirmed || !s.storagePath) continue;
    const key = `${s.uid}|${s.confirmedAt}|${s.confirmed.invoiceNumber || ""}`;
    const d = docs.get(key) || { key, at: s.confirmedAt, expected: cmp.expectedFromConfirmed(s.confirmed), pages: [] };
    d.pages.push({ path: s.storagePath, page: (s.read && s.read.pageNumber) || 0 });
    docs.set(key, d);
  }
  return [...docs.values()].sort((a, b) => b.at - a.at).map((d) => ({ ...d, pages: d.pages.sort((a, b) => (a.page || 99) - (b.page || 99)) }));
}

/**
 * Prueba las lecciones a prueba de los proveedores con muestras suficientes.
 * deps: { db, bucket, client (Claude), ai (ai.js: readInvoicePage, imageBlocks), logger }
 */
async function run(deps, { budgetUsd = BUDGET_USD, onlyCuit = null } = {}) {
  const { db, bucket, client, ai, logger } = deps;
  const snap = onlyCuit ? { docs: [await db.collection(lessons.COL).doc(String(onlyCuit)).get()].filter((d) => d.exists) } : await db.collection(lessons.COL).get();
  let spent = 0;
  const report = [];
  for (const sdoc of snap.docs) {
    const data = sdoc.data();
    const list = Array.isArray(data.lessons) ? data.lessons : [];
    const pending = list.map((l, i) => ({ l, i })).filter(({ l }) => (l.status || "candidate") === "candidate");
    if (!pending.length) continue;
    const rows = (await db.collection(samples.COL).where("cuit", "==", sdoc.id).limit(60).get()).docs.map((d) => d.data());
    const docs = groupDocs(rows).slice(0, MAX_DOCS);
    if (docs.length < MIN_DOCS) { report.push({ cuit: sdoc.id, skipped: `solo ${docs.length} boletas confirmadas` }); continue; }
    const pages = docs.reduce((s, d) => s + d.pages.length, 0);
    // Cada lección cuesta leer todas las boletas una vez más (la lectura "sin" se hace una sola vez)
    if (spent + pages * EST_PAGE_USD * (pending.length + 1) > budgetUsd) { report.push({ cuit: sdoc.id, skipped: "tope de gasto de esta corrida" }); continue; }
    const images = new Map();
    for (const d of docs) for (const p of d.pages) if (!images.has(p.path)) {
      const [buf] = await bucket.file(p.path).download();
      images.set(p.path, ai.imageBlocks([{ mediaType: "image/jpeg", data: buf.toString("base64") }])[0]);
    }
    const others = list.filter((l) => l.status === "adopted").map((l) => l.text);
    const baseHint = lessons.hintText(new Map([[sdoc.id, { name: data.name || "", lessons: others, profile: data.profile || null }]]));
    // Las boletas en paralelo (el botón del admin tiene 5 minutos)
    const readAll = (hint) => Promise.all(docs.map(async (d) => {
      const reads = await Promise.all(d.pages.map((p, i) => ai.readInvoicePage(client, images.get(p.path), i, hint, (u) => { spent += Number(u && u.costUsd) || 0; }, null)));
      return d.pages.length > 1 ? cmp.compareDocument(d.expected, reads) : cmp.comparePage(d.expected, reads[0]);
    }));
    const without = score(await readAll(baseHint));
    for (const { l, i } of pending) {
      const hint = lessons.hintText(new Map([[sdoc.id, { name: data.name || "", lessons: [...others, l.text], profile: data.profile || null }]]));
      const withScore = score(await readAll(hint));
      const decision = decide(withScore, without);
      list[i] = { ...l, status: decision, trial: { at: Date.now(), docs: docs.length, with: withScore, without, decision } };
      report.push({ cuit: sdoc.id, name: data.name || "", lesson: l.text, with: withScore, without, decision });
      if (logger && logger.info) logger.info(`Lección a prueba (${sdoc.id}): ${decision} — con ${withScore}, sin ${without}`);
    }
    await db.collection(lessons.COL).doc(sdoc.id).set({ lessons: list, trialAt: Date.now() }, { merge: true });
  }
  return { spentUsd: Math.round(spent * 1000) / 1000, report };
}

/** Para el admin: todas las lecciones con su estado y la última prueba */
async function list(db) {
  const snap = await db.collection(lessons.COL).get();
  return snap.docs.map((d) => {
    const x = d.data();
    return {
      cuit: d.id, name: x.name || "", profile: (x.profile && x.profile.fields) || null, shops: (x.profile && x.profile.shops) || 0,
      lessons: (x.lessons || []).map((l) => ({ text: l.text, status: l.status || "candidate", shops: (l.by || []).length, trial: l.trial || null })),
    };
  }).filter((s) => s.lessons.length || s.profile);
}

module.exports = { run, list, score, decide, groupDocs, MIN_DOCS, BUDGET_USD };
