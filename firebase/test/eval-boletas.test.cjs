// Banco de pruebas de boletas (functions/eval-boletas): comparación, informe y boletas fabricadas. Sin IA.
//   node firebase/test/eval-boletas.test.cjs
const assert = require("assert");
const cmp = require("../functions/eval-boletas/compare");
const fab = require("../functions/eval-boletas/fabricadas");

let ok = 0, bad = 0;
const t = (name, fn) => { try { fn(); ok++; console.log(`ok    ${name}`); } catch (e) { bad++; console.log(`FALLA ${name}\n      ${e.stack || e.message}`); } };

const exp = { supplierCuit: "30-71555123-9", invoiceNumber: "0004-00012877", date: "2026-10-14", total: 1210, items: [
  { code: "100", name: "YERBA MATE 1 KG", quantity: 20, unitsPerPack: 10, cost: 30 },
  { code: "200", name: "ARROZ LARGO 1 KG", quantity: 10, unitsPerPack: 1, cost: 40 },
] };
const read = (o = {}) => ({ supplierCuit: "30715551239", invoiceNumber: "4-12877", date: "2026-10-14", totalFacturaAPagar: "1.210,00", precios: "sin iva", items: [
  { sku: "100", barcode: "", name: "YERBA MATE SUAVE 1KG", packageQuantity: 2, unitsPerPack: 10, total: "600,00" },
  { sku: "200", barcode: "", name: "ARROZ LARGO FINO", packageQuantity: 10, unitsPerPack: 1, total: "400,00" },
], ...o });

t("lectura perfecta: número con otros ceros y CUIT sin guiones igual valen", () => {
  const r = cmp.comparePage(exp, read());
  assert.strictEqual(r.perfect, true, JSON.stringify(r));
  assert.deepStrictEqual(r.header, { cuit: true, number: true, date: true, total: true });
});
t("cantidad mal leída: no es perfecta y dice qué renglón", () => {
  const r = cmp.comparePage(exp, read({ items: [{ ...read().items[0], packageQuantity: 3, total: "600,00" }, read().items[1]] }));
  assert.strictEqual(r.perfect, false);
  assert.strictEqual(r.lines.wrong[0].name, "YERBA MATE 1 KG");
  assert.strictEqual(r.fields.quantity[0], 1);
});
t("renglón que falta, de más y total que no se leyó", () => {
  const r = cmp.comparePage(exp, read({ totalFacturaAPagar: "", items: [read().items[0], { sku: "999", name: "BOLSA", packageQuantity: 1, total: "5" }] }));
  assert.deepStrictEqual(r.lines.missing, ["ARROZ LARGO 1 KG"]);
  assert.deepStrictEqual(r.lines.extra, ["BOLSA"]);
  assert.strictEqual(r.header.total, false);
});
t("precios finales: el costo se compara sin IVA; los descuentos negativos se reparten como en la caja", () => {
  const e = { total: 0, items: [{ name: "GALLETITAS", quantity: 10, unitsPerPack: 1, cost: 95.87 }] };
  const r = cmp.comparePage(e, { precios: "finales", items: [{ name: "GALLETITAS", packageQuantity: 10, unitsPerPack: 1, total: "1.210" }, { name: "BONIF", packageQuantity: 1, total: "-50" }] });
  assert.strictEqual(r.perfect, true, JSON.stringify(r.lines));
});
t("remito en $0: los renglones cuentan por cantidad", () => {
  const e = fab.esperado(fab.BOLETAS.find((b) => b.tipo === "remito"));
  const r = cmp.comparePage(e, { supplierCuit: e.supplierCuit, invoiceNumber: e.invoiceNumber, date: e.date, items: e.items.map((it) => ({ sku: it.code, name: it.name, packageQuantity: it.quantity, unitsPerPack: 1, total: "0" })) });
  assert.strictEqual(r.perfect, true, JSON.stringify(r));
});
t("varias hojas del mismo comprobante se juntan antes de comparar", () => {
  const r = cmp.compareDocument(exp, [read({ totalFacturaAPagar: "", items: [read().items[0]] }), read({ items: [read().items[1]] })]);
  assert.strictEqual(r.perfect, true);
});
t("informe por proveedor y diferencia con la corrida anterior", () => {
  const a = cmp.comparePage(exp, read(), { supplier: "LOS ALAMOS", costUsd: 0.01, models: ["claude-haiku-5-5"] });
  const b = cmp.comparePage(exp, read({ totalFacturaAPagar: "" }), { supplier: "LOS ALAMOS", costUsd: 0.05, models: ["claude-haiku-5-5", "claude-sonnet-5-5"] });
  const s1 = cmp.summarize([a, a]), s2 = cmp.summarize([a, b]);
  assert.strictEqual(s1.overall.perfectPct, 100);
  assert.strictEqual(s2.overall.perfectPct, 50);
  assert.strictEqual(s2.overall.sonnet, 1);
  const d = cmp.diffSummaries(s1, s2);
  assert.strictEqual(d.worse, true);
  assert.ok(d.lines.some((l) => l.includes("boletas perfectas: 100% → 50%")));
  assert.strictEqual(cmp.diffSummaries(null, s1).first, true);
});
t("muestra confirmada → respuesta correcta (comprado por bulto: no se compara el costo por unidad)", () => {
  const e = cmp.expectedFromConfirmed({ supplierCuit: "30-71555123-9", invoiceNumber: "1-2", total: 100, items: [{ name: "A", code: "1", quantity: 2, cost: 50, buyFormat: "UNIT" }, { name: "B", quantity: 1, cost: 600, buyFormat: "PACK", unitsPerPack: 12 }, { name: "C", quantity: 0 }] });
  assert.strictEqual(e.items.length, 2);
  assert.strictEqual(e.items[1].cost, 0);
});
t("boletas fabricadas: totales coherentes, CUIT válidos y sin datos reales", () => {
  for (const b of fab.BOLETAS) {
    const e = fab.esperado(b);
    if (b.tipo !== "remito") assert.ok(e.total > 0, b.id);
    if (b.cuit) assert.ok(/^\d{2}-\d{8}-\d$/.test(b.cuit), b.cuit);
    assert.ok(fab.html(b).includes(b.proveedor));
    const t = fab.totales(b);
    if (b.precios === "sin iva") assert.ok(Math.abs(t.total - (t.neto + t.iva21 + t.iva105 + t.perc + t.internos)) < 0.01, b.id);
  }
  // "bultos,unidades": medio bulto de 8 son 4 unidades y se imprime 0,04
  const beb = fab.BOLETAS.find((b) => b.id === "bebidas-bultos-unidades");
  assert.ok(fab.html(beb).includes(">0,04<"));
  assert.strictEqual(fab.esperado(beb).items[2].quantity, 4);
});

console.log(`\n${ok} bien, ${bad} con falla`);
process.exit(bad ? 1 : 0);
