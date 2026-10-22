// Control de precios de los pedidos online (functions/order-check.js), con un catálogo falso en memoria.
//   node firebase/test/order-check.test.cjs
const assert = require("assert");
const { priceProblem } = require("../functions/order-check");

const fakeStore = (catalogItems, legacyDocs = null) => {
  const doc = (exists, data) => ({ exists, data: () => data });
  return {
    collection: (name) => ({
      doc: (id) => ({
        get: async () => {
          if (name === "catalog") {
            const i = Number(id.slice(1));
            return catalogItems && i < catalogItems.length ? doc(true, { items: catalogItems[i] }) : doc(false);
          }
          const d = legacyDocs && legacyDocs[id];
          return Object.assign(doc(!!d, d), { id });
        },
      }),
    }),
  };
};

const catalog = [[{ productId: "coca", price: 1500 }, { productId: "muzza", price: 9000 }], [{ productId: "napo", price: 11000 }]];
const ref = fakeStore(catalog);
const store = { catalogParts: 2 };

let ok = 0, bad = 0;
const t = async (name, fn) => {
  try { await fn(); ok++; console.log(`ok    ${name}`); } catch (e) { bad++; console.log(`FALLA ${name}\n      ${e.message}`); }
};

(async () => {
  await t("precios iguales a lo publicado: sin problema", async () => {
    assert.strictEqual(await priceProblem(ref, store, { items: [{ productId: "coca", name: "Coca", price: 1500, qty: 2 }] }), null);
  });
  await t("más barato que lo publicado: se marca", async () => {
    const p = await priceProblem(ref, store, { items: [{ productId: "coca", name: "Coca", price: 1, qty: 10 }] });
    assert.ok(p && p.includes("Coca") && p.includes("$1 ") && p.includes("1.500"), p);
  });
  await t("con agregados (más caro que el producto): sin problema", async () => {
    assert.strictEqual(await priceProblem(ref, store, { items: [{ productId: "muzza", name: "Muzza + borde", price: 10500, qty: 1, extras: [{ name: "borde", price: 1500 }] }] }), null);
  });
  await t("mitad y mitad: vale la más cara de las dos", async () => {
    assert.strictEqual(await priceProblem(ref, store, { items: [{ productId: "muzza", half: { productId: "napo" }, name: "Mitad", price: 11000, qty: 1 }] }), null);
    assert.ok(await priceProblem(ref, store, { items: [{ productId: "muzza", half: { productId: "napo" }, name: "Mitad", price: 9000, qty: 1 }] }));
  });
  await t("producto que ya no está publicado: no se marca", async () => {
    assert.strictEqual(await priceProblem(ref, store, { items: [{ productId: "viejo", name: "Viejo", price: 1, qty: 1 }] }), null);
  });
  await t("diferencia de redondeo de $1 o menos: no se marca", async () => {
    assert.strictEqual(await priceProblem(ref, store, { items: [{ productId: "coca", name: "Coca", price: 1499.5, qty: 1 }] }), null);
  });
  await t("precio que no es número: se marca", async () => {
    assert.ok(await priceProblem(ref, store, { items: [{ productId: "coca", name: "Coca", price: "gratis", qty: 1 }] }));
  });
  await t("tienda vieja sin catálogo agrupado: compara con sus productos sueltos", async () => {
    const legacy = fakeStore(null, { coca: { price: 1500 } });
    assert.ok(await priceProblem(legacy, {}, { items: [{ productId: "coca", name: "Coca", price: 100, qty: 1 }] }));
    assert.strictEqual(await priceProblem(legacy, {}, { items: [{ productId: "coca", name: "Coca", price: 1500, qty: 1 }] }), null);
  });
  // Venta a comercios: bulto x12 a $36.000 ($3.000 la unidad), suelta $3.600, oferta $2.800 llevando 48
  const ws = fakeStore([[{ productId: "galle", price: 3600, pack: { size: 12, price: 36000 }, wholesale: { price: 2800, minQty: 48 } }]]);
  const wsStore = { catalogParts: 1, wholesale: { enabled: true } };
  await t("comercios: el bulto vale lo publicado del bulto; una suelta, el precio de la unidad", async () => {
    assert.strictEqual(await priceProblem(ws, wsStore, { items: [{ productId: "galle", name: "Galletitas", price: 36000, qty: 2, packSize: 12 }] }), null);
    assert.strictEqual(await priceProblem(ws, wsStore, { items: [{ productId: "galle", name: "Galletitas", price: 3600, qty: 3 }] }), null);
    assert.ok(await priceProblem(ws, wsStore, { items: [{ productId: "galle", name: "Galletitas", price: 3000, qty: 3 }] }), "la suelta no va a precio de bulto");
    assert.ok(await priceProblem(ws, wsStore, { items: [{ productId: "galle", name: "Galletitas", price: 3600, qty: 1, packSize: 12 }] }), "un bulto a precio de una unidad");
  });
  await t("comercios: la oferta por cantidad vale solo llegando al mínimo entre bultos y sueltas", async () => {
    assert.strictEqual(await priceProblem(ws, wsStore, { items: [
      { productId: "galle", name: "Galletitas", price: 33600, qty: 3, packSize: 12 },
      { productId: "galle", name: "Galletitas", price: 2800, qty: 12 },
    ] }), null);
    assert.ok(await priceProblem(ws, wsStore, { items: [{ productId: "galle", name: "Galletitas", price: 33600, qty: 3, packSize: 12 }] }), "36 unidades no llegan a 48");
  });
  await t("pedido sin renglones válidos: sin problema", async () => {
    assert.strictEqual(await priceProblem(ref, store, { items: [] }), null);
    assert.strictEqual(await priceProblem(ref, store, {}), null);
  });
  console.log(`\n${ok} bien, ${bad} con falla`);
  process.exit(bad ? 1 : 0);
})();
