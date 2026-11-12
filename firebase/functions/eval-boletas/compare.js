// ═══════════════════════════════════════════════════
// Banco de pruebas del lector de boletas (plan-boletas-ia.md, tanda 2): compara lo que leyó la IA
// con la respuesta correcta y arma el informe. Todo puro (sin IA ni red): lo prueba firebase/test.
//
// Respuesta correcta ("esperado"), igual para boletas fabricadas y para muestras confirmadas:
//   { supplierCuit, invoiceNumber, date, total, items: [{ code, barcode, name, quantity (unidades),
//     unitsPerPack, cost (costo neto por unidad, sin IVA) }] }
// Lectura: lo que devuelve readInvoicePage de ai.js (items con packageQuantity, unitsPerPack, total…).
// ═══════════════════════════════════════════════════

const num = (s) => {
  let t = String(s == null ? "" : s).replace(/[^\d.,-]/g, "");
  if (!t) return 0;
  if (t.includes(",") && t.includes(".")) t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if (t.includes(",")) t = /,\d{1,2}$/.test(t) ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  else if ((t.match(/\./g) || []).length > 1 || /\.\d{3}$/.test(t)) t = t.replace(/\./g, "");
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : 0;
};
const digits = (s) => String(s || "").replace(/\D/g, "");
/** "0003-00004521" y "3-4521" son el mismo: punto de venta y número sin ceros */
function invoiceKey(s) {
  const parts = String(s || "").split(/\D+/).filter(Boolean);
  if (parts.length >= 2) return `${Number(parts[parts.length - 2])}-${Number(parts[parts.length - 1])}`;
  return digits(s).replace(/^0+/, "");
}
const words = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1);
function nameScore(a, b) {
  const wa = words(a), wb = words(b);
  if (!wa.length || !wb.length) return 0;
  let n = 0;
  for (const w of wa) if (wb.some((x) => x === w || (w.length >= 3 && x.length >= 3 && (x.startsWith(w) || w.startsWith(x))))) n++;
  return n / Math.max(wa.length, wb.length);
}
const near = (a, b, rel = 0.03, abs = 0.01) => Math.abs(a - b) <= Math.max(abs, Math.abs(b) * rel);

/** Un renglón leído → unidades y costo neto por unidad (precios finales: sin el 21%). Pura. */
function readLine(it, preciosFinales) {
  const upp = Number(it.unitsPerPack) > 0 ? Number(it.unitsPerPack) : 1;
  const units = (Number(it.packageQuantity) || 0) * upp;
  const total = num(it.total) / (preciosFinales ? 1.21 : 1);
  return { code: digits(it.sku) || "", barcode: digits(it.barcode) || "", name: String(it.name || ""), units, unitsPerPack: upp, cost: units > 0 ? total / units : 0, total: num(it.total) };
}

/**
 * Empareja renglones esperados con leídos: primero por código (interno o de barras), después por
 * nombre parecido. Cada leído se usa una vez. Pura.
 */
function pairLines(expected, read) {
  const used = new Set();
  const pairs = [];
  const byCode = (e) => read.findIndex((r, k) => !used.has(k) && ((e.code && (r.code === digits(e.code) || r.barcode === digits(e.code))) || (e.barcode && (r.barcode === digits(e.barcode) || r.code === digits(e.barcode)))));
  const order = expected.map((e, i) => ({ e, i }));
  for (const { e, i } of order) {
    const k = byCode(e);
    if (k >= 0) { used.add(k); pairs[i] = k; }
  }
  for (const { e, i } of order) {
    if (pairs[i] !== undefined) continue;
    let best = -1, score = 0.49;
    read.forEach((r, k) => { if (used.has(k)) return; const s = nameScore(e.name, r.name); if (s > score) { score = s; best = k; } });
    if (best >= 0) { used.add(best); pairs[i] = best; }
  }
  return { pairs, extra: read.map((_, k) => k).filter((k) => !used.has(k)) };
}

/**
 * Una lectura contra lo esperado → los aciertos de esa hoja. Si la hoja es parte de un comprobante
 * más largo, pasar solo los renglones esperados de esa hoja (o usar compareDocument). Pura.
 */
function comparePage(expected, read, info = {}) {
  const finales = read && read.precios === "finales";
  const lines = (read && !read.error ? read.items || [] : [])// Descuentos (negativos) no son productos; un remito trae los renglones en $0 pero con cantidad
    .filter((it) => num(it.total) > 0 || (num(it.total) === 0 && Number(it.packageQuantity) > 0)).map((it) => readLine(it, finales));
  // Como la caja (scanOne): los descuentos en negativo se reparten entre los renglones según su importe
  const gross = lines.reduce((t, l) => t + l.total, 0);
  const disc = (read && !read.error ? read.items || [] : []).filter((it) => num(it.total) < 0).reduce((t, it) => t - num(it.total), 0);
  if (gross > 0 && disc > 0 && disc < gross) { const f = (gross - disc) / gross; for (const l of lines) l.cost *= f; }
  const exp = (expected.items || []).map((e) => ({ ...e, quantity: Number(e.quantity) || 0, unitsPerPack: Number(e.unitsPerPack) || 1, cost: Number(e.cost) || 0 }));
  const { pairs, extra } = pairLines(exp, lines);
  const fields = { quantity: [0, 0], unitsPerPack: [0, 0], cost: [0, 0], code: [0, 0] };
  const wrong = [];
  exp.forEach((e, i) => {
    const k = pairs[i];
    if (k === undefined) return;
    const r = lines[k];
    // Como la caja (unitsInName): "AGUA 2 L X 6" leído como 3 bultos de 1 son 18 unidades de a 6
    const inName = Number((String(r.name).match(/\bx\s*(\d{1,3})\b/i) || [])[1]) || 0;
    const v = r.unitsPerPack <= 1 && inName > 1 && near(r.units * inName, e.quantity, 0, 0.01) ? { ...r, units: r.units * inName, unitsPerPack: inName, cost: r.cost / inName } : r;
    const q = near(v.units, e.quantity, 0, 0.01), u = v.unitsPerPack === e.unitsPerPack || e.unitsPerPack === 0;
    const c = e.cost > 0 ? near(v.cost, e.cost, 0.03, 0.5) : true;
    // El código vale en cualquiera de las dos columnas: la caja pone el EAN en barcode y el interno en SKU (splitInvoiceCodes)
    const codes = [e.code, e.barcode].map(digits).filter(Boolean);
    const hasCode = codes.length > 0;
    const cd = !hasCode || codes.some((x) => x === r.code || x === r.barcode);
    fields.quantity[0] += q; fields.quantity[1]++;
    fields.unitsPerPack[0] += u; fields.unitsPerPack[1]++;
    fields.cost[0] += c; fields.cost[1]++;
    if (hasCode) { fields.code[0] += !!cd; fields.code[1]++; }
    if (!q || !u || !c || !cd) wrong.push({ name: e.name, expected: { quantity: e.quantity, unitsPerPack: e.unitsPerPack, cost: round(e.cost), code: codes[0] || "" }, read: { quantity: v.units, unitsPerPack: v.unitsPerPack, cost: round(v.cost), code: r.code || r.barcode } });
  });
  const missing = exp.filter((_, i) => pairs[i] === undefined).map((e) => e.name);
  const header = {
    cuit: expected.supplierCuit ? digits(read && read.supplierCuit) === digits(expected.supplierCuit) : null,
    number: expected.invoiceNumber ? invoiceKey(read && read.invoiceNumber) === invoiceKey(expected.invoiceNumber) : null,
    date: expected.date ? String((read && read.date) || "") === expected.date : null,
    total: Number(expected.total) > 0 ? near(num(read && read.totalFacturaAPagar), Number(expected.total), 0.005, 1) : null,
  };
  const failed = !read || !!read.error || !lines.length;
  const perfect = !failed && Object.values(header).every((v) => v !== false) && !missing.length && !extra.length && !wrong.length;
  return {
    id: info.id || "", supplier: info.supplier || expected.supplierName || digits(expected.supplierCuit) || "sin proveedor",
    failed, perfect, header, lines: { expected: exp.length, read: lines.length, missing, extra: extra.map((k) => lines[k].name), wrong }, fields,
    costUsd: Number(info.costUsd) || 0, models: info.models || [],
    escalated: { sonnet: (info.models || []).filter((m) => /sonnet/.test(m)).length, opus: (info.models || []).filter((m) => /opus/.test(m)).length },
    verified: (read && read.verified) || null,
  };
}
const round = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Varias hojas del mismo comprobante (muestras confirmadas): se juntan los renglones leídos y se compara una vez. Pura. */
function compareDocument(expected, reads, info = {}) {
  const ok = reads.filter((r) => r && !r.error);
  const footer = ok.slice().reverse().find((r) => num(r.totalFacturaAPagar) > 0) || ok[ok.length - 1] || {};
  const pick = (k) => (ok.find((r) => String(r[k] || "").trim()) || {})[k] || "";
  const merged = { supplierCuit: pick("supplierCuit"), invoiceNumber: pick("invoiceNumber"), date: pick("date"), totalFacturaAPagar: footer.totalFacturaAPagar || "", precios: pick("precios"), verified: ok.every((r) => r.verified && r.verified !== "no") ? "si" : "no", items: ok.flatMap((r) => r.items || []), error: ok.length ? undefined : "sin lectura" };
  return comparePage(expected, merged, info);
}

/** Muestra confirmada (ventra_invoice_samples) → respuesta correcta. Pura. */
function expectedFromConfirmed(c) {
  return {
    supplierCuit: c.supplierCuit || "", supplierName: c.supplierName || "", invoiceNumber: c.invoiceNumber || "", date: c.date || "", total: Number(c.total) || 0,
    items: (c.items || []).filter((it) => Number(it.quantity) > 0).map((it) => ({
      code: /^\d{8,14}$/.test(String(it.barcode || "")) && String(it.barcode) === String(it.code) ? "" : it.code || "", barcode: "",
      name: it.name, quantity: Number(it.quantity) || 0, unitsPerPack: it.buyFormat === "PACK" ? Number(it.unitsPerPack) || 1 : 0, cost: it.buyFormat === "PACK" ? 0 : Number(it.cost) || 0,
    })),
  };
}

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : null);
/** Resultados por hoja → resumen general y por proveedor. Pura. */
function summarize(results) {
  const sum = (list) => {
    const f = { quantity: [0, 0], unitsPerPack: [0, 0], cost: [0, 0], code: [0, 0] };
    const h = { cuit: [0, 0], number: [0, 0], date: [0, 0], total: [0, 0] };
    for (const r of list) {
      for (const k of Object.keys(f)) { f[k][0] += r.fields[k][0]; f[k][1] += r.fields[k][1]; }
      for (const k of Object.keys(h)) if (r.header[k] !== null) { h[k][0] += r.header[k] ? 1 : 0; h[k][1]++; }
    }
    const lines = list.reduce((s, r) => s + r.lines.expected, 0);
    return {
      pages: list.length, perfect: list.filter((r) => r.perfect).length, perfectPct: pct(list.filter((r) => r.perfect).length, list.length),
      failed: list.filter((r) => r.failed).length,
      header: Object.fromEntries(Object.entries(h).map(([k, [a, b]]) => [k, pct(a, b)])),
      fields: Object.fromEntries(Object.entries(f).map(([k, [a, b]]) => [k, pct(a, b)])),
      missingLines: pct(list.reduce((s, r) => s + r.lines.missing.length, 0), lines), extraLines: list.reduce((s, r) => s + r.lines.extra.length, 0),
      costUsd: round(list.reduce((s, r) => s + r.costUsd, 0) * 100) / 100,
      sonnet: list.reduce((s, r) => s + r.escalated.sonnet, 0), opus: list.reduce((s, r) => s + r.escalated.opus, 0),
    };
  };
  const bySupplier = {};
  for (const r of results) (bySupplier[r.supplier] = bySupplier[r.supplier] || []).push(r);
  return { overall: sum(results), bySupplier: Object.fromEntries(Object.entries(bySupplier).map(([k, v]) => [k, sum(v)])) };
}

/** Diferencia con la corrida anterior: qué subió y qué bajó. Pura. */
function diffSummaries(prev, cur) {
  if (!prev) return { first: true, lines: ["Primera corrida: queda como línea de base."], worse: false };
  const lines = [];
  let worse = false;
  const cmp = (label, a, b) => {
    if (a === null || b === null || a === undefined || b === undefined || a === b) return;
    const d = Math.round((b - a) * 10) / 10;
    if (d < 0) worse = true;
    lines.push(`${d > 0 ? "▲" : "▼"} ${label}: ${a}% → ${b}%`);
  };
  cmp("boletas perfectas", prev.overall.perfectPct, cur.overall.perfectPct);
  for (const k of Object.keys(cur.overall.header)) cmp(`encabezado ${k}`, prev.overall.header[k], cur.overall.header[k]);
  for (const k of Object.keys(cur.overall.fields)) cmp(`renglón ${k}`, prev.overall.fields[k], cur.overall.fields[k]);
  for (const [s, v] of Object.entries(cur.bySupplier)) if (prev.bySupplier[s]) cmp(`${s} perfectas`, prev.bySupplier[s].perfectPct, v.perfectPct);
  lines.push(`costo: US$ ${prev.overall.costUsd} → US$ ${cur.overall.costUsd}`);
  return { first: false, lines, worse };
}

module.exports = { comparePage, compareDocument, expectedFromConfirmed, summarize, diffSummaries, invoiceKey, nameScore, readLine, pairLines };
