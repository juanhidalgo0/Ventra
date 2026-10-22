// ═══════════════════════════════════════════════════
// Control de precios de los pedidos de la tienda online.
//
// El pedido lo arma el navegador del cliente: las reglas validan el formato, pero no los
// precios. Al llegar se compara cada renglón con el catálogo publicado y, si alguno vino más
// barato, el pedido queda marcado (priceProblem) para que el comercio lo vea antes de cobrar.
//
// Un renglón nunca puede valer menos que su producto: la tienda cobra el precio del producto
// (en mitad y mitad, el mayor de las dos) más los agregados (unitOf en firebase/tienda/index.html).
// Puede pasar sin trampa: si el comercio subió un precio después de que el cliente abrió la
// tienda. Por eso solo se marca, nunca se cambia nada del pedido.
// ═══════════════════════════════════════════════════

/** Producto publicado (precio, bulto y oferta por cantidad) de cada id pedido. */
async function publishedProducts(storeRef, store, ids) {
  const out = new Map();
  const n = Number(store.catalogParts) || 0;
  if (n > 0) {
    const parts = await Promise.all(Array.from({ length: n }, (_, i) => storeRef.collection("catalog").doc(`p${i}`).get()));
    if (parts.every((p) => p.exists)) {
      for (const p of parts) for (const x of p.data().items || []) if (ids.has(String(x.productId))) out.set(String(x.productId), x);
      return out;
    }
  }
  // Tiendas sin el catálogo agrupado: un documento por producto (solo los pedidos)
  const docs = await Promise.all([...ids].map((id) => storeRef.collection("products").doc(id).get()));
  docs.forEach((d) => { if (d.exists) out.set(d.id, d.data()); });
  return out;
}

/** Precio publicado de cada producto (productId → precio) para los ids pedidos. */
async function publishedPrices(storeRef, store, ids) {
  const prices = new Map();
  for (const [id, x] of await publishedProducts(storeRef, store, ids)) prices.set(id, Number(x.price));
  return prices;
}

/**
 * Lo mínimo que puede valer un renglón de venta a comercios (wholesale): el bulto a su precio, o
 * la unidad, y si entre todos los renglones del producto se llega a la oferta por cantidad, la
 * unidad a precio de oferta. Misma cuenta que perUnit en firebase/tienda/index.html.
 */
function wholesaleFloor(x, it, unitsByProduct) {
  const size = Number(it.packSize) > 1 ? Number(it.packSize) : 1;
  const pack = x.pack && Number(x.pack.size) === size && Number(x.pack.price) > 0 ? x.pack : null;
  let per = size > 1 ? (pack ? Number(pack.price) / size : Number(x.price)) : Number(x.price);
  const o = x.wholesale;
  if (o && Number(o.price) > 0 && Number(o.minQty) > 0 && (unitsByProduct.get(String(it.productId)) || 0) >= Number(o.minQty) - 1e-9) per = Math.min(per, Number(o.price));
  return per * size;
}

const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;

/** Texto del problema, o null si los precios están bien (o no se pueden comparar). */
async function priceProblem(storeRef, store, order) {
  const items = Array.isArray(order && order.items) ? order.items.slice(0, 200) : [];
  const idsOf = (it) => [it && it.productId, it && it.half && it.half.productId].filter((x) => typeof x === "string" && x && x.length <= 200);
  const ids = new Set(items.flatMap(idsOf));
  if (!ids.size) return null;
  const products = await publishedProducts(storeRef, store, ids);
  const prices = new Map([...products].map(([id, x]) => [id, Number(x.price)]));
  const wholesale = !!(store.wholesale && store.wholesale.enabled);
  const unitsByProduct = new Map();
  for (const it of items) {
    const size = Number(it && it.packSize) > 1 ? Number(it.packSize) : 1;
    const id = String(it && it.productId);
    unitsByProduct.set(id, (unitsByProduct.get(id) || 0) + (Number(it && it.qty) || 0) * size);
  }
  const lower = [];
  for (const it of items) {
    const known = idsOf(it).map((id) => prices.get(id)).filter((v) => Number.isFinite(v));
    // Un producto que ya no está publicado no se puede comparar: no se marca
    if (!known.length) continue;
    const pub = products.get(String(it.productId));
    const base = wholesale && pub && !it.half ? wholesaleFloor(pub, it, unitsByProduct) : Math.max(...known);
    const paid = Number(it.price);
    if (!Number.isFinite(paid) || paid < base - 1) {
      lower.push(`${String(it.name || it.title || "Producto").slice(0, 60)}: ${Number.isFinite(paid) ? money(paid) : "sin precio"} (publicado ${money(base)})`);
    }
  }
  if (!lower.length) return null;
  const more = lower.length > 5 ? ` y ${lower.length - 5} más` : "";
  return `Precios más bajos que los publicados: ${lower.slice(0, 5).join("; ")}${more}`;
}

module.exports = { priceProblem, publishedPrices, publishedProducts, wholesaleFloor };
