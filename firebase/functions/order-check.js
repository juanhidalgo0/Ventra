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

/**
 * Cliente mayorista (pedido hecho con su link, clientToken): su precio de cada producto. Es el
 * mayorista publicado aparte (tradePrices/{priceKey}) o el de siempre con su %. null si no es
 * mayorista o no se puede leer (entonces se compara con el precio público, como siempre).
 */
async function tradePricesFor(storeRef, order) {
  const token = order && typeof order.clientToken === "string" ? order.clientToken.slice(0, 64) : "";
  if (!token) return null;
  const c = await storeRef.collection("clients").doc(token).get();
  if (!c.exists) return null;
  const client = c.data() || {};
  if (client.priceList !== "TRADE" || client.active === false) return null;
  let prices = {};
  let combos = {};
  let ratios = {};
  if (typeof client.priceKey === "string" && client.priceKey) {
    const t = await storeRef.collection("tradePrices").doc(client.priceKey).get();
    if (t.exists) { prices = (t.data() || {}).prices || {}; combos = (t.data() || {}).combos || {}; ratios = (t.data() || {}).ratios || {}; }
  }
  return { prices, combos, ratios, off: Number(client.tradeDiscount) || 0 };
}

/** El producto publicado con el precio de la unidad del cliente mayorista (y el bulto, si así sale más barato) */
function withTradePrice(x, id, trade) {
  if (!trade || !x) return x;
  const t = Number(trade.prices[id]);
  const price = t > 0 ? t : trade.off > 0 ? Math.round(Number(x.price) * (1 - trade.off / 100) * 100) / 100 : Number(x.price);
  if (!(t > 0 || trade.off > 0)) return Object.assign({}, x, { price });
  // El bulto: cada unidad no le sale más cara que la suelta mayorista (applyTradePrices en la tienda)
  const size = x.pack ? Number(x.pack.size) : 0;
  const tp = size > 1 ? Math.round(price * size * 100) / 100 : 0;
  const pack = size > 1 && tp < Number(x.pack.price) - 0.005 ? { size, price: tp } : x.pack;
  return Object.assign({}, x, { price }, pack ? { pack } : {});
}

/**
 * Combos publicados (onlinePromos de un grupo y onlineCombos de varios), con el precio mayorista
 * del combo si el cliente es de esa lista y el combo lo tiene.
 */
function publishedCombos(store, trade) {
  const out = [];
  for (const pr of Array.isArray(store.onlinePromos) ? store.onlinePromos : []) {
    // "Llevá 3, pagá 2" y "%": sin precio fijo, pagan `ratio` de lo que valen
    const ratio = pr && typeof pr.ratio === "number" && pr.ratio >= 0 && pr.ratio < 1 ? pr.ratio : undefined;
    if (pr && Array.isArray(pr.productIds) && pr.productIds.length) out.push({ id: String(pr.id), name: pr.name, price: Number(pr.price), ...(ratio !== undefined ? { ratio } : {}), groups: [{ qty: Math.max(1, Number(pr.qty) || 1), productIds: pr.productIds.map(String) }] });
  }
  for (const pr of Array.isArray(store.onlineCombos) ? store.onlineCombos : []) {
    if (pr && Array.isArray(pr.groups) && pr.groups.length) out.push({ id: String(pr.id), name: pr.name, price: Number(pr.price), groups: pr.groups.map((g) => ({ qty: Math.max(1, Number(g.qty) || 1), productIds: (g.productIds || []).map(String) })) });
  }
  for (const c of out) {
    const t = trade && trade.combos ? Number(trade.combos[c.id]) : 0;
    if (t > 0) c.price = t;
    const rt = trade && trade.ratios ? trade.ratios[c.id] : undefined;
    if (c.ratio !== undefined && typeof rt === "number" && rt >= 0 && rt < 1) c.ratio = rt;
  }
  return out.filter((c) => c.price > 0 || c.ratio !== undefined);
}

/**
 * Arma los combos con los renglones del pedido. Misma cuenta que applyCombos en
 * apps/backend/src/modules/preorders/combos.ts y en firebase/tienda/index.html: mantener iguales.
 * lines: [{ key, productId, quantity, price }]. Devuelve el ahorro total.
 */
function comboDiscount(lines, combos) {
  const left = new Map();
  for (const l of lines) left.set(l.key, (left.get(l.key) || 0) + Math.max(0, Math.floor(Number(l.quantity) + 1e-9)));
  const units = (c) => c.groups.reduce((s, g) => s + g.qty, 0);
  const sorted = [...combos].sort((a, b) => units(b) - units(a) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let total = 0;
  for (const c of sorted) {
    for (let guard = 0; guard < 10000; guard++) {
      const taken = new Map();
      let ok = true;
      let sum = 0;
      for (const g of c.groups) {
        const cands = lines
          .filter((l) => g.productIds.includes(l.productId) && (left.get(l.key) || 0) - (taken.get(l.key) || 0) > 0)
          .sort((a, b) => b.price - a.price || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
        let need = g.qty;
        for (const l of cands) {
          if (need <= 0) break;
          const n = Math.min(need, (left.get(l.key) || 0) - (taken.get(l.key) || 0));
          taken.set(l.key, (taken.get(l.key) || 0) + n);
          sum += n * l.price;
          need -= n;
        }
        if (need > 0) { ok = false; break; }
      }
      const pay = c.ratio !== undefined ? Math.round(sum * c.ratio * 100) / 100 : c.price;
      if (!ok || sum - pay <= 0.005) break;
      for (const [k, n] of taken) left.set(k, (left.get(k) || 0) - n);
      total += sum - pay;
    }
  }
  return Math.round(total * 100) / 100;
}

/** Mitad y mitad: la mitad de cada pizza, redondeado para arriba a $1.000. Misma cuenta que halfPrice en la tienda. */
const halfPrice = (a, b) => Math.ceil(Math.round((Number(a) + Number(b)) / 2) / 1000) * 1000;

const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;

/** Texto del problema, o null si los precios están bien (o no se pueden comparar). */
async function priceProblem(storeRef, store, order) {
  const items = Array.isArray(order && order.items) ? order.items.slice(0, 200) : [];
  const idsOf = (it) => [it && it.productId, it && it.half && it.half.productId].filter((x) => typeof x === "string" && x && x.length <= 200);
  const ids = new Set(items.flatMap(idsOf));
  if (!ids.size) return null;
  const published = await publishedProducts(storeRef, store, ids);
  const trade = await tradePricesFor(storeRef, order).catch(() => null);
  const products = new Map([...published].map(([id, x]) => [id, withTradePrice(x, id, trade)]));
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
    // Mitad y mitad con un gusto que ya no está publicado: no se puede sacar la cuenta
    if (it.half && known.length < 2) continue;
    // La oferta por cantidad vale en toda tienda (no solo en la venta a comercios), como en la caja
    const offer = pub && pub.wholesale && Number(pub.wholesale.price) > 0 && Number(pub.wholesale.minQty) > 0;
    const base = it.half ? halfPrice(known[0], known[1]) : (wholesale || offer) && pub ? wholesaleFloor(pub, it, unitsByProduct) : known[0];
    const paid = Number(it.price);
    if (!Number.isFinite(paid) || paid < base - 1) {
      lower.push(`${String(it.name || it.title || "Producto").slice(0, 60)}: ${Number.isFinite(paid) ? money(paid) : "sin precio"} (publicado ${money(base)})`);
    }
  }
  // Descuento de promos y combos: no puede pasar lo que dan los combos publicados con este pedido
  let promoProblem = null;
  const disc = Number(order && order.discount) || 0;
  if (disc > 0) {
    const known = items.every((it) => products.has(String(it && it.productId)));
    if (known) {
      const lines = items
        .map((it, i) => ({ it, key: String(i).padStart(3, "0") }))
        .filter(({ it }) => !(Number(it && it.packSize) > 1))
        .map(({ it, key }) => {
          const pub = products.get(String(it.productId));
          return { key, productId: String(it.productId), quantity: Number(it.qty) || 0, price: wholesale ? wholesaleFloor(pub, it, unitsByProduct) : Number(pub.price) };
        });
      const max = comboDiscount(lines, publishedCombos(store, trade));
      if (disc > max + 1) promoProblem = `Descuento de promos ${money(disc)}, más que el de las promos publicadas (${money(max)})`;
    }
  }
  if (!lower.length) return promoProblem;
  const more = lower.length > 5 ? ` y ${lower.length - 5} más` : "";
  return [`Precios más bajos que los publicados: ${lower.slice(0, 5).join("; ")}${more}`, promoProblem].filter(Boolean).join(". ");
}

module.exports = { priceProblem, publishedPrices, publishedProducts, wholesaleFloor, halfPrice, tradePricesFor, withTradePrice, publishedCombos, comboDiscount };
