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

/** Precio publicado de cada producto (productId → precio) para los ids pedidos. */
async function publishedPrices(storeRef, store, ids) {
  const prices = new Map();
  const n = Number(store.catalogParts) || 0;
  if (n > 0) {
    const parts = await Promise.all(Array.from({ length: n }, (_, i) => storeRef.collection("catalog").doc(`p${i}`).get()));
    if (parts.every((p) => p.exists)) {
      for (const p of parts) for (const x of p.data().items || []) if (ids.has(String(x.productId))) prices.set(String(x.productId), Number(x.price));
      return prices;
    }
  }
  // Tiendas sin el catálogo agrupado: un documento por producto (solo los pedidos)
  const docs = await Promise.all([...ids].map((id) => storeRef.collection("products").doc(id).get()));
  docs.forEach((d) => { if (d.exists) prices.set(d.id, Number(d.data().price)); });
  return prices;
}

const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;

/** Texto del problema, o null si los precios están bien (o no se pueden comparar). */
async function priceProblem(storeRef, store, order) {
  const items = Array.isArray(order && order.items) ? order.items.slice(0, 200) : [];
  const idsOf = (it) => [it && it.productId, it && it.half && it.half.productId].filter((x) => typeof x === "string" && x && x.length <= 200);
  const ids = new Set(items.flatMap(idsOf));
  if (!ids.size) return null;
  const prices = await publishedPrices(storeRef, store, ids);
  const lower = [];
  for (const it of items) {
    const known = idsOf(it).map((id) => prices.get(id)).filter((v) => Number.isFinite(v));
    // Un producto que ya no está publicado no se puede comparar: no se marca
    if (!known.length) continue;
    const base = Math.max(...known);
    const paid = Number(it.price);
    if (!Number.isFinite(paid) || paid < base - 1) {
      lower.push(`${String(it.name || it.title || "Producto").slice(0, 60)}: ${Number.isFinite(paid) ? money(paid) : "sin precio"} (publicado ${money(base)})`);
    }
  }
  if (!lower.length) return null;
  const more = lower.length > 5 ? ` y ${lower.length - 5} más` : "";
  return `Precios más bajos que los publicados: ${lower.slice(0, 5).join("; ")}${more}`;
}

module.exports = { priceProblem, publishedPrices };
