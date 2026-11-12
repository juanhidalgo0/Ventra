// ═══════════════════════════════════════════════════
// Evaluación del lector de boletas (plan-boletas-ia.md, tanda 2.1).
// Corre el lector REAL (ai.js, con la IA de verdad) sobre boletas cuya respuesta se conoce y mide
// el acierto por hoja y por proveedor. Guarda cada corrida y muestra la diferencia con la anterior
// y con la línea de base. REGLA: ningún cambio a ai.js se publica si esto baja.
//
//   cd firebase/functions
//   node eval-boletas/eval.js --fabricadas            boletas fabricadas (se generan si faltan)
//   node eval-boletas/eval.js --muestras --bajar      baja las muestras confirmadas (solo lectura) y las evalúa
//   node eval-boletas/eval.js --muestras --leyo-mal   solo las marcadas "Leyó mal" (primero que nada)
//   opciones: --tope 20 (máximo de hojas), --solo factura-a (filtro), --si (no pregunta el costo),
//             --base (guarda esta corrida como línea de base)
//
// Clave de la IA: variable VENTRA_ANTHROPIC_KEY (o ANTHROPIC_API_KEY). Para sacarla:
//   npx firebase functions:secrets:access VENTRA_ANTHROPIC_KEY
// Producción se LEE (Firestore y Storage, con las credenciales de gcloud de esta PC): nunca se escribe.
// Todo lo bajado y los resultados quedan en .boletas-eval/ (fuera de git).
// ═══════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");
const readline = require("readline");
const ai = require("../ai");
const cmp = require("./compare");
const fab = require("./fabricadas");

const ROOT = path.resolve(__dirname, "../../../.boletas-eval");
const DIRS = { fabricadas: path.join(ROOT, "fabricadas"), muestras: path.join(ROOT, "muestras"), corridas: path.join(ROOT, "corridas") };
/** Costo estimado por hoja (dólares): Haiku casi siempre; las que no cierran escalan a Sonnet u Opus */
const EST = { usual: 0.01, worst: 0.12 };

const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };

async function ask(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = await new Promise((r) => rl.question(q, r));
  rl.close();
  return /^s/i.test(String(a).trim());
}

/** Boletas fabricadas: cada foto (limpia o arruinada) con su respuesta correcta */
async function fabricadas() {
  if (!fs.existsSync(DIRS.fabricadas) || !fs.readdirSync(DIRS.fabricadas).length) {
    console.log("Generando las fotos de las boletas fabricadas…");
    require("child_process").execFileSync(process.execPath, [path.join(__dirname, "generar.js")], { stdio: "inherit" });
  }
  const cases = [];
  for (const b of fab.BOLETAS) for (const kind of fab.ARRUINAR) {
    const file = path.join(DIRS.fabricadas, `${b.id}__${kind}.jpg`);
    if (fs.existsSync(file)) cases.push({ id: `${b.id}__${kind}`, files: [file], expected: fab.esperado(b), supplier: b.proveedor, kind });
  }
  return cases;
}

/**
 * Baja de producción las muestras CONFIRMADAS (solo lectura): foto + lo confirmado. Las hojas del mismo
 * comprobante (misma confirmación) quedan juntas. Las marcadas "Leyó mal" primero.
 */
async function bajarMuestras() {
  const admin = require("firebase-admin");
  if (!admin.apps.length) admin.initializeApp({ projectId: "ventra-9cba5", storageBucket: "ventra-9cba5.firebasestorage.app" });
  const db = admin.firestore();
  const bucket = admin.storage().bucket();
  fs.mkdirSync(DIRS.muestras, { recursive: true });
  const snap = await db.collection("ventra_invoice_samples").where("confirmedAt", ">", 0).get();
  let n = 0;
  for (const d of snap.docs) {
    const s = d.data();
    const img = path.join(DIRS.muestras, `${d.id}.jpg`);
    if (!fs.existsSync(img)) {
      const [buf] = await bucket.file(s.storagePath).download();
      fs.writeFileSync(img, buf);
    }
    fs.writeFileSync(path.join(DIRS.muestras, `${d.id}.json`), JSON.stringify({ id: d.id, uid: s.uid, cuit: s.cuit, supplierName: s.supplierName, confirmed: s.confirmed, confirmedAt: s.confirmedAt, flagged: !!s.flagged, page: s.read && s.read.pageNumber }, null, 1));
    n++;
  }
  console.log(`${n} muestras confirmadas en ${DIRS.muestras}`);
}

function muestras(onlyFlagged) {
  if (!fs.existsSync(DIRS.muestras)) return [];
  const metas = fs.readdirSync(DIRS.muestras).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(DIRS.muestras, f), "utf8")));
  const docs = new Map();
  for (const m of metas) {
    if (!m.confirmed) continue;
    const key = `${m.uid}|${m.confirmedAt}|${m.confirmed.invoiceNumber}`;
    const d = docs.get(key) || { id: key, files: [], expected: cmp.expectedFromConfirmed(m.confirmed), supplier: m.confirmed.supplierName || m.supplierName || m.cuit || "sin proveedor", flagged: false, pages: [] };
    d.pages.push({ file: path.join(DIRS.muestras, `${m.id}.jpg`), page: m.page || 0 });
    d.flagged = d.flagged || m.flagged;
    docs.set(key, d);
  }
  const list = [...docs.values()].map((d) => ({ ...d, files: d.pages.sort((a, b) => (a.page || 99) - (b.page || 99)).map((p) => p.file) }));
  return list.filter((d) => !onlyFlagged || d.flagged).sort((a, b) => Number(b.flagged) - Number(a.flagged));
}

/**
 * --simulada: una IA falsa que "lee" lo esperado (y en la foto cortada pierde el total y el último
 * renglón). Sirve para probar el comando entero sin gastar. Nunca para medir.
 */
function simulatedClient(c) {
  const e = c.expected;
  const cut = c.kind === "cortada";
  const items = (cut ? e.items.slice(0, -1) : e.items).map((it) => ({ sku: it.code || "", barcode: it.barcode || "", name: it.name, packageQuantity: it.quantity, unitsPerPack: 1, total: String(Math.round(it.cost * it.quantity * 100) / 100), unitPrice: String(it.cost), handPrice: "" }));
  const read = { rawTableTranscription: "", supplierName: e.supplierName || "", supplierCuit: e.supplierCuit || "", invoiceNumber: e.invoiceNumber || "", date: e.date || "", totalFacturaAPagar: cut ? "" : String(e.total || ""), subtotalNeto: "", docType: "factura", pageNumber: 0, pageCount: 0, ivaTotal: "", otrosImpuestos: "", impuestosInternos: "", condicionVenta: "", fotoLegible: "si", problemaFoto: "", precios: "sin iva", items };
  const msg = { stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(read) }], usage: { input_tokens: 3000, output_tokens: 800 } };
  return { messages: { stream: () => ({ finalMessage: async () => msg }) } };
}

/** Lee las hojas de un caso con el lector real. Devuelve lecturas, modelos y costo. */
async function readCase(client, c) {
  const models = [];
  let cost = 0;
  const track = (u) => { if (u && u.model) models.push(u.model); cost += Number(u && u.costUsd) || 0; };
  const reads = [];
  for (const [i, file] of c.files.entries()) {
    const [img] = ai.imageBlocks([{ mediaType: "image/jpeg", data: fs.readFileSync(file).toString("base64") }]);
    // Igual que en producción (invoicePage): el CUIT que no pasa el dígito verificador se corrige o se descarta
    reads.push(ai.fixCuit(await ai.readInvoicePage(client, img, i, "", track, null), []));
  }
  return { reads, models, cost };
}

async function main() {
  const set = (flag("--muestras") ? "muestras" : "fabricadas") + (flag("--simulada") ? "-simulada" : "");
  const real = set.replace("-simulada", "");
  if (real === "muestras" && flag("--bajar")) await bajarMuestras();
  let cases = real === "muestras" ? muestras(flag("--leyo-mal")) : await fabricadas();
  const solo = opt("--solo");
  if (solo) cases = cases.filter((c) => c.id.startsWith(solo));
  const tope = Number(opt("--tope")) || 0;
  if (tope) {
    const out = [];
    let pages = 0;
    for (const c of cases) { if (pages + c.files.length > tope) break; out.push(c); pages += c.files.length; }
    cases = out;
  }
  const pages = cases.reduce((s, c) => s + c.files.length, 0);
  // --recalcular: la última corrida con sus lecturas guardadas, sin IA ni costo (cuando cambia la comparación)
  if (flag("--recalcular")) {
    fs.mkdirSync(DIRS.corridas, { recursive: true });
    const last = fs.readdirSync(DIRS.corridas).filter((f) => f.startsWith(`${set}_`)).sort().pop();
    if (!last) return console.log("No hay corridas para recalcular.");
    const old = JSON.parse(fs.readFileSync(path.join(DIRS.corridas, last), "utf8"));
    const byId = new Map(cases.map((c) => [c.id, c]));
    const results = old.results.filter((r) => r.reads && byId.has(r.id)).map((r) => {
      const c = byId.get(r.id);
      const info = { id: c.id, supplier: c.supplier, models: r.models, costUsd: r.costUsd };
      const reads = r.reads.map((x) => ai.fixCuit(x, []));
      return { ...(c.files.length > 1 ? cmp.compareDocument(c.expected, reads, info) : cmp.comparePage(c.expected, reads[0], info)), kind: c.kind || null, reads: r.reads };
    });
    return report(set, real, results, `recalculada de ${last}`);
  }
  if (!pages) return console.log(real === "muestras" ? "No hay muestras confirmadas bajadas (usá --bajar; ¿está prendido ventra_config/invoiceSamples?)." : "No hay boletas fabricadas.");
  const simulated = flag("--simulada");
  const key = String(process.env.VENTRA_ANTHROPIC_KEY || process.env.ANTHROPIC_API_KEY || "").trim();
  if (!key && !simulated) {
    console.log("Falta la clave de la IA: VENTRA_ANTHROPIC_KEY (sacala con: npx firebase functions:secrets:access VENTRA_ANTHROPIC_KEY).");
    process.exit(2);
  }
  console.log(`${cases.length} boletas, ${pages} hojas (${set}). Costo estimado: US$ ${(pages * EST.usual).toFixed(2)} (como mucho US$ ${(pages * EST.worst).toFixed(2)} si todas escalan a Opus).`);
  if (simulated) console.log("IA SIMULADA: prueba del comando, los números no miden nada.");
  else if (!flag("--si") && !(await ask("¿Seguimos? (s/n) "))) return console.log("Cancelado.");

  const client = simulated ? null : ai.anthropicClient({ apiKey: key, maxRetries: 2, timeout: 180 * 1000 });
  const results = [];
  let next = 0, done = 0;
  const worker = async () => {
    while (next < cases.length) {
      const c = cases[next++];
      try {
        const { reads, models, cost } = await readCase(simulated ? simulatedClient(c) : client, c);
        const info = { id: c.id, supplier: c.supplier, models, costUsd: cost };
        const r = c.files.length > 1 ? cmp.compareDocument(c.expected, reads, info) : cmp.comparePage(c.expected, reads[0], info);
        // Las lecturas crudas quedan en la corrida: si cambia la comparación, se recalcula sin volver a pagar
        results.push({ ...r, kind: c.kind || null, flagged: !!c.flagged, reads });
      } catch (err) {
        results.push({ ...cmp.comparePage(c.expected, { error: err.message }, { id: c.id, supplier: c.supplier }), error: err.message });
      }
      done++;
      process.stdout.write(`\r${done}/${cases.length}`);
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  console.log("");
  report(set, real, results, solo || null);
}

/** Informe de una corrida: lo guarda, lo muestra y lo compara con la anterior y con la línea de base */
function report(set, real, results, note) {
  const summary = cmp.summarize(results);
  // Por forma de arruinar la foto (solo fabricadas)
  if (real === "fabricadas") summary.byKind = Object.fromEntries(fab.ARRUINAR.map((k) => [k, cmp.summarize(results.filter((r) => r.kind === k)).overall]));
  fs.mkdirSync(DIRS.corridas, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runs = fs.readdirSync(DIRS.corridas).filter((f) => f.startsWith(`${set}_`)).sort();
  const prev = runs.length ? JSON.parse(fs.readFileSync(path.join(DIRS.corridas, runs[runs.length - 1]), "utf8")).summary : null;
  const baseFile = path.join(ROOT, `base-${set}.json`);
  const base = fs.existsSync(baseFile) ? JSON.parse(fs.readFileSync(baseFile, "utf8")).summary : null;
  fs.writeFileSync(path.join(DIRS.corridas, `${set}_${stamp}.json`), JSON.stringify({ at: new Date().toISOString(), set, note, summary, results }, null, 1));
  if (flag("--base") || !base) fs.writeFileSync(baseFile, JSON.stringify({ at: new Date().toISOString(), summary }, null, 1));

  const o = summary.overall;
  console.log(`\nBoletas perfectas: ${o.perfect} de ${o.pages} (${o.perfectPct}%). Sin leer: ${o.failed}.`);
  console.log(`Encabezado: CUIT ${o.header.cuit}% · número ${o.header.number}% · fecha ${o.header.date}% · total ${o.header.total}%`);
  console.log(`Renglones: cantidad ${o.fields.quantity}% · unid. por bulto ${o.fields.unitsPerPack}% · costo ${o.fields.cost}% · código ${o.fields.code}% · faltan ${o.missingLines}% · de más ${o.extraLines}`);
  console.log(`Costo US$ ${o.costUsd} · escaló a Sonnet ${o.sonnet} veces, a Opus ${o.opus}`);
  if (summary.byKind) console.log(`Por foto: ${Object.entries(summary.byKind).map(([k, v]) => `${k} ${v.perfectPct}%`).join(" · ")}`);
  console.log("\nPor proveedor (peor primero):");
  for (const [s, v] of Object.entries(summary.bySupplier).sort((a, b) => a[1].perfectPct - b[1].perfectPct)) console.log(`  ${s}: ${v.perfect}/${v.pages} perfectas`);
  const dPrev = cmp.diffSummaries(prev, summary);
  console.log(`\nContra la corrida anterior:\n  ${dPrev.lines.join("\n  ")}`);
  if (base && !flag("--base")) {
    const dBase = cmp.diffSummaries(base, summary);
    console.log(`\nContra la línea de base:\n  ${dBase.lines.join("\n  ")}`);
    if (dBase.worse) { console.log("\n⚠ Bajó contra la línea de base: no publicar este cambio a ai.js."); process.exitCode = 1; }
  }
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { muestras, fabricadas };
