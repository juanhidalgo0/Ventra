// Banco de pruebas del lector de boletas con fotos REALES (las mismas funciones que usa ventraAi).
// Las fotos y lo esperado viven FUERA del repositorio (es público y las boletas tienen CUIT y nombres):
//
//   ANTHROPIC_KEY=sk-ant-… node firebase/scripts/eval-boletas.cjs <carpeta> [--juntas] [--salida informe.json]
//
// <carpeta>: fotos .jpg/.jpeg/.png. Opcional <carpeta>/esperado.json:
//   { "foto.jpg": { "numero": "0001-00059230", "renglones": 27, "total": 1523412.88 } }
//   (con --juntas, la clave es "*" y vale para el conjunto)
// Sin --juntas lee cada foto por separado; con --juntas, todas en un solo envío (como varias fotos a la vez).
// Cuesta lo mismo que leerlas en Ventra (Claude). No escribe nada en ningún lado salvo el informe.
const fs = require("fs");
const path = require("path");
const fnDir = path.join(__dirname, "..", "functions");
const ai = require(path.join(fnDir, "ai"));
const sharp = require(path.join(fnDir, "node_modules", "sharp"));

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith("--"));
const together = args.includes("--juntas");
const outIdx = args.indexOf("--salida");
const out = outIdx >= 0 ? args[outIdx + 1] : null;
if (!dir || !process.env.ANTHROPIC_KEY) { console.error("Uso: ANTHROPIC_KEY=… node eval-boletas.cjs <carpeta> [--juntas] [--salida informe.json]"); process.exit(1); }

const num = (s) => {
  let t = String(s == null ? "" : s).replace(/[^\d.,-]/g, "");
  if (!t) return 0;
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (t.includes(",")) t = /,\d{1,2}$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if ((t.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(t)) t = t.replace(/\./g, "");
  return parseFloat(t) || 0;
};
const money = (n) => Math.round(n).toLocaleString("es-AR");

(async () => {
  const SDK = require(path.join(fnDir, "node_modules", "@anthropic-ai/sdk"));
  const client = new (SDK.default || SDK)({ apiKey: process.env.ANTHROPIC_KEY, maxRetries: 2, timeout: 180000 });
  const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort();
  const expected = fs.existsSync(path.join(dir, "esperado.json")) ? JSON.parse(fs.readFileSync(path.join(dir, "esperado.json"), "utf8")) : {};
  // Igual que la caja (AiService.shrink): lado mayor 2000 px, JPEG
  const load = async (f) => ({ data: (await sharp(path.join(dir, f)).rotate().resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer()).toString("base64"), mediaType: "image/jpeg" });
  const runs = together ? [{ name: "*", files }] : files.map((f) => ({ name: f, files: [f] }));
  const report = [];
  let costIn = 0, costOut = 0;
  for (const run of runs) {
    const t0 = Date.now();
    let res;
    try {
      res = await ai.parseInvoices(client, { images: await Promise.all(run.files.map(load)), multi: true });
    } catch (err) { console.log(`\n✗ ${run.name}: ${err.message}`); report.push({ run: run.name, error: err.message }); continue; }
    costIn += res.usage.input_tokens || 0; costOut += res.usage.output_tokens || 0;
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(`\n━━ ${run.name}  (${run.files.length} foto${run.files.length > 1 ? "s" : ""}, ${secs} s) → ${res.result.documents.length} comprobante(s)${res.result.failedImages.length ? ` · sin leer: ${res.result.failedImages.join(", ")}` : ""}`);
    for (const d of res.result.documents) {
      const sum = d.items.reduce((s, it) => s + num(it.total), 0);
      const bad = d.items.filter((it) => it.lineOk === false);
      const exp = expected[run.name] && (together ? (expected[run.name][d.invoiceNumber] || null) : expected[run.name]);
      const checks = [];
      if (exp) {
        if (exp.renglones != null) checks.push(d.items.length === exp.renglones ? `✓ ${exp.renglones} renglones` : `✗ renglones ${d.items.length} (esperado ${exp.renglones})`);
        if (exp.total != null) checks.push(Math.abs(num(d.totalFacturaAPagar) - exp.total) < 1 ? "✓ total" : `✗ total ${d.totalFacturaAPagar} (esperado ${exp.total})`);
        if (exp.numero) checks.push(String(d.invoiceNumber).replace(/\D/g, "").endsWith(exp.numero.replace(/\D/g, "").replace(/^0+/, "")) ? "✓ número" : `✗ número ${d.invoiceNumber} (esperado ${exp.numero})`);
      }
      console.log(`  ${d.docType.toUpperCase()} ${d.supplierName || "?"} N° ${d.invoiceNumber || "?"} · fotos ${d.images.map((i) => i + 1).join("+")} · ${d.items.length} renglones`);
      console.log(`    suma ${money(sum)} · subtotal ${d.subtotalNeto || "-"} · total ${d.totalFacturaAPagar || "-"} → ${d.closes === true ? "CIERRA" : d.closes === false ? "NO CIERRA" : "sin total"} · verificada: ${d.verified}${d.missingPages ? ` · faltan ${d.missingPages} hojas` : ""}${d.unsureLines && d.unsureLines.length ? ` · en duda: ${d.unsureLines.join(", ")}` : ""}${d.reread ? " (releída)" : ""}${bad.length ? ` · ${bad.length} renglón(es) que no cierran` : ""}`);
      for (const it of bad) console.log(`      ✗ ${it.name}: ${it.packageQuantity} × ${it.unitPrice} ≠ ${it.total}`);
      if (checks.length) console.log(`    ${checks.join(" · ")}`);
      report.push({ run: run.name, ...d, sum, checks });
    }
  }
  // Precio aproximado de Haiku (entrada/salida por millón); la relectura con Sonnet ya viene x3 en usage
  console.log(`\nTokens: ${costIn} de entrada, ${costOut} de salida · costo aprox. US$ ${((costIn * 1 + costOut * 5) / 1e6).toFixed(3)}`);
  if (out) { fs.writeFileSync(out, JSON.stringify(report, null, 2)); console.log(`Informe: ${out}`); }
})().catch((e) => { console.error(e); process.exit(1); });
