// ═══════════════════════════════════════════════════
// Boleta o factura del proveedor por foto (WhatsApp del dueño).
//
// 1. La foto va a la caja en la nube (POST /api/purchases/scan-invoice-json): la lee la IA de Ventra
//    y el emparejador de siempre busca cada renglón (código de barras → lo aprendido de ese proveedor
//    → código → nombre con los mismos tamaños → IA). Es una VISTA PREVIA: no se guarda nada.
// 2. Lo seguro pasa solo. Lo dudoso (producto no seguro, costo que cambia mucho, no encontrado, o un
//    producto que tiene repetidos) se pregunta de a uno con botones o una lista de candidatos.
// 3. Al final, el resumen con los cambios de costo y precio, y Confirmar / Sin cambiar precios /
//    Cancelar. Recién ahí se carga la compra (POST /api/purchases): suma stock, actualiza costos y
//    precios (manteniendo el margen) y aprende cómo factura ese proveedor cada producto.
// Nunca crea un producto que el dueño no aprobó.
// ═══════════════════════════════════════════════════
const crypto = require("crypto");

const INVOICES = "ventra_wa_invoices";
const ACTIVE_MS = 2 * 60 * 60 * 1000;
/** Fotos por vez (la IA lee hasta 6) */
const MAX_PHOTOS = 6;
const money = (n) => { const v = Math.round(Number(n) || 0); return `${v < 0 ? "-" : ""}$ ${Math.abs(v).toLocaleString("es-AR")}`; };
const pct = (p) => (p === null || p === undefined ? "" : ` (${p > 0 ? "+" : ""}${String(p).replace(".", ",")}%)`);
const errorOf = (r) => (r && r.body && (Array.isArray(r.body.message) ? r.body.message.join(". ") : r.body.message || r.body.error)) || `error ${r && r.status}`;
const roundTo10 = (v) => Math.ceil(Number(v) / 10) * 10;
const short = (s, n = 24) => (String(s).length > n ? `${String(s).slice(0, n - 1)}…` : String(s));

/** Precio de venta manteniendo el margen del producto elegido */
const keepMargin = (p, newCost) => (p && p.cost > 0 && newCost > 0 ? roundTo10(p.sale * (newCost / p.cost)) : (p ? p.sale : null));

/** Qué renglones hay que preguntar (índices) */
const pending = (inv) => inv.items.map((it, k) => (it.decision ? null : k)).filter((k) => k !== null);

/**
 * Las fotos (ya guardadas en Storage) → vista previa → un comprobante por vez → preguntas o resumen.
 * Varias fotos juntas pueden ser varios comprobantes (dos facturas, un remito, la nota de otro
 * proveedor): la caja lee cada foto por separado y devuelve cada uno; acá se recorren de a uno.
 * deps: { db, api, bucket, uid, from, send, sendButtons, sendList, now }
 */
async function start(deps, paths) {
  const { db, api, bucket, uid, from, send, now = Date.now() } = deps;
  const list = (Array.isArray(paths) ? paths : [paths]).filter(Boolean);
  if (list.length > MAX_PHOTOS) await send(from, `Leo hasta ${MAX_PHOTOS} fotos por vez: tomo las primeras ${MAX_PHOTOS}. Las demás mandámelas después.`);
  const use = list.slice(0, MAX_PHOTOS);
  await send(from, use.length > 1
    ? `🧾 Leyendo ${use.length} fotos… cada una por separado, tarda un poco más (hasta un par de minutos).`
    : "🧾 Leyendo la boleta… tarda unos segundos (hasta un minuto si es larga).");
  let r;
  try {
    const bufs = await Promise.all(use.map((p) => bucket.file(p).download().then(([b]) => b)));
    [r] = await api.call(uid, [{ method: "POST", path: "/api/purchases/scan-invoice-json", body: { images: bufs.map((b, i) => ({ data: b.toString("base64"), mime: "image/jpeg", name: `boleta-${i + 1}.jpg` })) } }]);
  } catch (err) {
    return send(from, err.preparing ? `${err.message} Cuando esté lista, mandame la foto de nuevo.` : `No pude leer la boleta: ${err.message}`);
  }
  if (r.status >= 300) return send(from, `No pude leer la boleta: ${errorOf(r)}`);
  const p = r.body;
  const docs = [p, ...(Array.isArray(p.others) ? p.others : [])].filter((d) => d && d.items && d.items.length);
  const failed = Array.isArray(p.failedImages) ? p.failedImages : [];
  if (!docs.length) return send(from, "No encontré productos en la foto. Mandame una foto más cerca, con el detalle de los renglones.");

  // Productos con repetidos: hay que preguntar a cuál (así no se actualiza uno y el otro queda viejo)
  let dupOf = new Map();
  try {
    const [d] = await api.call(uid, [{ method: "GET", path: "/api/products/duplicates", query: { limit: 500 } }]);
    if (d.status < 300) for (const g of d.body.groups || []) for (const x of g.products) dupOf.set(x.id, g.products.filter((y) => y.id !== x.id));
  } catch { dupOf = new Map(); }

  const ids = docs.map((d, k) => `${now.toString(36)}${crypto.randomBytes(3).toString("hex")}${k}`);
  for (const [k, d] of docs.entries()) {
    const inv = build(d, dupOf, { uid, from, now, status: k === 0 ? "review" : "queued" });
    inv.batch = ids; inv.pos = k;
    await db.collection(INVOICES).doc(ids[k]).set(inv);
  }
  if (docs.length > 1 || failed.length) {
    const lines = docs.map((d, k) => `${k + 1}. ${label(d)}`).join("\n");
    await send(from, [
      docs.length > 1 ? `📑 En ${use.length === 1 ? "la foto" : `las ${use.length} fotos`} encontré *${docs.length} comprobantes*:\n${lines}\n\nVamos de a uno: cuando termines con uno, te muestro el siguiente.` : "",
      failed.length ? `⚠️ No pude leer ${failed.length === 1 ? `la foto ${failed[0] + 1}` : `las fotos ${failed.map((n) => n + 1).join(", ")}`}: mandámela de nuevo, de frente y con buena luz.` : "",
    ].filter(Boolean).join("\n\n"));
  }
  return present(deps, ids[0]);
}

/** Proveedor y número para mostrar: "Distribuidora Sur · N° 0001-00012345 (remito)" */
const label = (d) => `${(d.matchedSupplier && d.matchedSupplier.name) || (d.supplier && d.supplier.name) || d.supplierName || "Proveedor"}${d.invoiceNumber ? ` · N° ${d.invoiceNumber}` : ""}${d.docType && d.docType !== "factura" ? ` (${d.docType})` : ""}`;

/** Un comprobante leído → lo que se guarda para recorrerlo por WhatsApp. Pura. */
function build(p, dupOf, { uid, from, now, status }) {
  const items = (p.items || []).map((it) => {
    const prod = it.product ? { id: it.product.id, name: it.product.name, cost: it.product.costPrice, sale: it.product.salePrice } : null;
    const twins = prod ? (dupOf.get(prod.id) || []) : [];
    const reasons = [...(it.reasons || [])];
    if (twins.length) reasons.push(`tenés ${twins.length + 1} productos iguales`);
    const candidates = prod
      ? twins.map((x) => ({ id: x.id, name: x.name, cost: x.costPrice, sale: x.salePrice }))
      : (it.candidates || []).map((c) => ({ id: c.id, name: c.name, cost: c.costPrice, sale: c.salePrice }));
    const doubtful = !!it.doubtful || twins.length > 0 || !prod;
    return {
      name: it.name, sku: it.sku || null, barcode: it.barcode || null, quantity: it.quantity, unitsPerPack: it.unitsPerPack || 1, cost: it.cost,
      changePct: it.changePct, suggested: it.suggestedSalePrice, product: prod, candidates, reasons,
      decision: doubtful ? null : "ok", chosen: doubtful ? null : prod,
    };
  });
  const { others: _o, failedImages: _f, documentsFound: _d, ...preview } = p;
  return {
    uid, from, status, at: now,
    supplier: p.matchedSupplier || null, supplierName: p.supplierName || "", invoiceNumber: p.invoiceNumber || "", date: p.date || null, docType: p.docType || null,
    duplicate: !!p.duplicate,
    total: (p.invoice && p.invoice.totals && p.invoice.totals.total) || null, check: p.check ? { ok: p.check.ok, message: p.check.message } : null, items,
    // Lo leído tal cual: si elige revisarla en la PC, queda pendiente con esto (sin volver a leerla con IA)
    preview: JSON.parse(JSON.stringify(preview)),
  };
}

/** Muestra un comprobante: lo leído y dónde revisarlo (acá o en la PC) */
async function present(deps, id) {
  const { db, from, send } = deps;
  const ref = db.collection(INVOICES).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return null;
  const inv = snap.data();
  const n = (inv.batch || []).length;
  const tag = n > 1 ? `*${inv.pos + 1} de ${n}* · ` : "";
  if (inv.duplicate) {
    await ref.set({ status: "cancelled" }, { merge: true });
    await send(from, `${tag}${label(inv)}: esta boleta ya estaba cargada. No la cargo de nuevo.`);
    return advance(deps, inv);
  }
  const items = inv.items;
  const ok = items.filter((it) => it.decision === "ok").length;
  const ask = pending(inv).length;
  await send(from, `🧾 ${tag}*${inv.supplier ? inv.supplier.name : inv.supplierName || "Proveedor"}*${inv.invoiceNumber ? ` · N° ${inv.invoiceNumber}` : ""}${inv.docType && inv.docType !== "factura" ? ` (${inv.docType})` : ""}: leí *${items.length} renglones*.\n✅ ${ok} los reconocí seguro${ask ? `\n❓ ${ask} te los pregunto de a uno` : ""}${inv.check && inv.check.ok === false ? `\n⚠️ ${inv.check.message}` : ""}${inv.docType === "remito" ? "\nℹ️ Es un remito: los precios suelen venir en la factura. Si ya cargás la factura, salteá este." : ""}`);
  // Elige dónde revisarla: acá (preguntas con botones) o en la PC (queda en Compras y la PC avisa)
  return deps.sendButtons(from, `¿Dónde la querés revisar?\n\n*Seguir por acá*: ${ask ? `te pregunto ${ask === 1 ? "el dudoso" : `los ${ask} dudosos`} y` : "te muestro el resumen y"} la confirmás desde el chat.\n*Revisar en la PC*: te queda en Compras, lista para confirmar con la pantalla grande.`, [
    { id: `wv|here|${id}`, title: "Seguir por acá" }, { id: `wv|pc|${id}`, title: "Revisar en la PC" }, { id: `wv|no|${id}`, title: n > 1 ? "Saltear" : "Cancelar" },
  ]);
}

/** Terminó un comprobante (cargado, a la PC, cancelado): si las fotos traían otro, sigue con ese */
async function advance(deps, inv) {
  const ids = inv.batch || [];
  for (const id of ids) {
    const s = await deps.db.collection(INVOICES).doc(id).get();
    if (s.exists && s.data().status === "queued") {
      await deps.db.collection(INVOICES).doc(id).set({ status: "review", at: Date.now() }, { merge: true });
      return present(deps, id);
    }
  }
  if (ids.length > 1) return deps.send(deps.from, "✅ Listo, terminamos con todos los comprobantes de las fotos.");
  return null;
}

/** La próxima pregunta, o el resumen si no queda ninguna */
async function next(deps, id, inv) {
  const { from, sendButtons, sendList } = deps;
  const left = pending(inv);
  if (!left.length) return summary(deps, id, inv);
  const k = left[0];
  const it = inv.items[k];
  const head = `❓ *${inv.items.length - left.length + 1} de ${inv.items.length}* · En la boleta: *${it.name}*\n${it.quantity} × ${money(it.cost)}${it.reasons.length ? `\n_${it.reasons.join("; ")}_` : ""}`;
  if (it.product && !it.candidates.length) {
    return sendButtons(from, `${head}\n\n¿Es *${it.product.name}*?\nCosto ${money(it.product.cost)} → ${money(it.cost)}${pct(it.changePct)}`, [
      { id: `wv|yes|${id}|${k}`, title: "Sí, es ese" }, { id: `wv|other|${id}|${k}`, title: "Es otro" }, { id: `wv|skip|${id}|${k}`, title: "Saltear" },
    ]);
  }
  const opts = [...(it.product ? [it.product] : []), ...it.candidates].slice(0, 7);
  if (!opts.length) {
    return sendButtons(from, `${head}\n\nNo lo encontré en tu catálogo. ¿Lo creo como producto nuevo?`, [
      { id: `wv|new|${id}|${k}`, title: "Crear nuevo" }, { id: `wv|skip|${id}|${k}`, title: "Saltear" },
    ]);
  }
  return sendList(from, `${head}\n\n${it.product ? "Tenés varios iguales: ¿a cuál le cargo esto?" : "No es seguro cuál es. ¿Es alguno de estos?"}`, "Elegir producto", [{
    title: "Elegí uno",
    rows: [
      // El título se corta en 24 letras ("BARRIGON ALFAJOR TRIPLA…" para el FR y el CR): el nombre
      // completo va en la descripción, que es lo que los distingue
      ...opts.map((o) => {
        const tail = ` · venta ${money(o.sale)}`;
        return { id: `wv|pick|${id}|${k}|${o.id}`, title: short(o.name), description: `${String(o.name).slice(0, 72 - tail.length)}${tail}` };
      }),
      { id: `wv|new|${id}|${k}`, title: "Es un producto nuevo", description: "Lo creo con el nombre de la boleta" },
      { id: `wv|skip|${id}|${k}`, title: "Saltear este renglón", description: "No se carga" },
    ],
  }]);
}

async function summary(deps, id, inv) {
  const { db, from, sendButtons } = deps;
  inv.status = "confirm";
  await db.collection(INVOICES).doc(id).set({ status: "confirm", items: inv.items }, { merge: true });
  const load = inv.items.filter((it) => it.decision === "ok");
  const created = inv.items.filter((it) => it.decision === "new");
  const skipped = inv.items.filter((it) => it.decision === "skip");
  if (!load.length && !created.length) {
    await db.collection(INVOICES).doc(id).set({ status: "cancelled" }, { merge: true });
    await deps.send(from, "No quedó ningún renglón para cargar, así que no hago nada.");
    return advance(deps, inv);
  }
  const changes = load.map((it) => {
    const newCost = it.cost;
    const oldCost = it.chosen.cost;
    const change = oldCost > 0 ? Math.round((newCost / oldCost - 1) * 1000) / 10 : null;
    const sale = keepMargin(it.chosen, newCost);
    return { it, change, sale, below: sale !== null && sale < newCost };
  });
  const big = changes.filter((c) => c.change !== null && Math.abs(c.change) >= 5).sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 6);
  const below = changes.filter((c) => c.below);
  const lines = [
    `🧾 *Listo para cargar* · ${inv.supplier ? inv.supplier.name : inv.supplierName || "Proveedor"}${inv.invoiceNumber ? ` · N° ${inv.invoiceNumber}` : ""}`,
    `✅ ${load.length} productos: suma stock y actualiza el costo`,
    created.length ? `🆕 ${created.length} nuevos: ${created.slice(0, 3).map((it) => it.name).join(", ")}${created.length > 3 ? "…" : ""}` : "",
    skipped.length ? `⏭️ ${skipped.length} salteados` : "",
    big.length ? `\n*Cambios de costo:*\n${big.map((c) => `- ${c.it.chosen.name}: ${money(c.it.chosen.cost)} → ${money(c.it.cost)}${pct(c.change)} · venta ${money(c.it.chosen.sale)} → ${money(c.sale)}`).join("\n")}` : "",
    below.length ? `\n⚠️ Quedan por debajo del costo: ${below.map((c) => c.it.chosen.name).join(", ")}` : "",
    "\n*Confirmar*: carga la compra y sube los precios de venta manteniendo tu margen.\n*Sin cambiar precios*: solo stock y costos.",
  ].filter(Boolean).join("\n");
  return sendButtons(from, lines.slice(0, 1024), [
    { id: `wv|ok|${id}`, title: "Confirmar" }, { id: `wv|keep|${id}`, title: "Sin cambiar precios" }, { id: `wv|no|${id}`, title: "Cancelar" },
  ]);
}

/** Respuesta a una pregunta o al resumen. action: yes|other|skip|new|pick|ok|keep|no */
async function act(deps, { action, id, k, productId }) {
  const { db, api, uid, from, send } = deps;
  const now = Date.now();
  const ref = db.collection(INVOICES).doc(String(id));
  const snap = await ref.get();
  if (!snap.exists) return send(from, "No encontré esa boleta. Mandame la foto de nuevo.");
  const inv = snap.data();
  if (inv.uid !== uid || inv.from !== from) return send(from, "Esa boleta no es tuya.");
  if (inv.status === "done") return send(from, "Esa boleta ya está cargada.");
  if (inv.status === "pc") return send(from, "Esa boleta ya te la dejé en la PC: revisala y confirmala desde Compras.");
  // Tocó Confirmar dos veces: la primera ya la está cargando (no se carga dos veces)
  if (inv.status === "loading" && now - Number(inv.loadingAt || 0) < 10 * 60 * 1000) return send(from, "Ya la estoy cargando, esperá un momento.");
  if (inv.status === "cancelled") return send(from, "Esa boleta la cancelaste. Mandame la foto de nuevo si la querés cargar.");
  if (inv.status === "queued") return send(from, "Primero terminemos el comprobante anterior: después te muestro este.");

  if (["yes", "other", "skip", "new", "pick"].includes(action)) {
    const it = inv.items[Number(k)];
    if (!it) return send(from, "No encontré ese renglón.");
    if (it.decision) return send(from, "Ese renglón ya lo respondiste.");
    if (action === "yes") { it.decision = "ok"; it.chosen = it.product; }
    if (action === "skip") { it.decision = "skip"; }
    if (action === "new") { it.decision = "new"; }
    if (action === "pick") {
      const o = [...(it.product ? [it.product] : []), ...it.candidates].find((x) => x.id === productId);
      if (!o) return send(from, "Ese producto no estaba entre las opciones.");
      it.decision = "ok"; it.chosen = o;
    }
    if (action === "other") {
      // Sin otros candidatos: se ofrece crearlo o saltearlo
      it.product = null;
      await ref.set({ items: inv.items, at: Date.now() }, { merge: true });
      return next(deps, id, inv);
    }
    await ref.set({ items: inv.items, at: Date.now() }, { merge: true });
    return next(deps, id, inv);
  }
  if (action === "here") {
    if (inv.status !== "review" && inv.status !== "confirm") return send(from, "Esa boleta ya no está para revisar.");
    return next(deps, id, inv);
  }
  if (action === "pc") return toPc(deps, ref, inv);
  if (action === "no") {
    await ref.set({ status: "cancelled" }, { merge: true });
    await send(from, (inv.batch || []).length > 1 ? "Listo, ese no lo cargo." : "Listo, no cargué nada.");
    return advance(deps, inv);
  }
  if (action !== "ok" && action !== "keep") return send(from, "No entendí esa opción.");
  if (inv.status !== "confirm" && inv.status !== "loading") return send(from, "Todavía quedan renglones por responder.");
  // Cargar la compra
  await ref.set({ status: "loading", loadingAt: now }, { merge: true });
  await send(from, "⏳ Cargando la compra en tu caja…");
  const updatePrices = action === "ok";
  let supplierId = inv.supplier && inv.supplier.id;
  try {
    if (!supplierId) {
      const [s] = await api.call(uid, [{ method: "POST", path: "/api/suppliers", body: { name: inv.supplierName || "Proveedor sin nombre" } }]);
      if (s.status >= 300) throw new Error(errorOf(s));
      supplierId = s.body.id;
    }
    const items = inv.items.filter((it) => it.decision === "ok" || it.decision === "new").map((it) => {
      const base = { quantity: it.quantity, cost: it.cost, buyFormat: "UNIT", source: { code: it.sku || undefined, name: it.name } };
      if (it.decision === "ok") {
        const sale = updatePrices ? (it.chosen.id === (it.product && it.product.id) && it.suggested ? it.suggested : keepMargin(it.chosen, it.cost)) : undefined;
        return { ...base, productId: it.chosen.id, ...(sale ? { salePrice: sale } : {}) };
      }
      const sale = it.suggested || roundTo10(it.cost * 1.4);
      return { ...base, newProductData: { name: it.name, barcode: /^\d{8}$|^\d{12,14}$/.test(String(it.barcode || "")) ? it.barcode : undefined, sku: it.sku || undefined, salePrice: sale, taxRate: 21 } };
    });
    const [r] = await api.call(uid, [{ method: "POST", path: "/api/purchases", body: {
      supplierId, invoiceNumber: inv.invoiceNumber || undefined, paymentStatus: "OWED", ...(inv.total ? { manualTotal: inv.total } : {}),
      notes: `Cargada por WhatsApp desde la foto de la boleta${updatePrices ? "" : " (sin cambiar precios de venta)"}.`, items,
    } }]);
    if (r.status >= 300) throw new Error(errorOf(r));
    await ref.set({ status: "done", purchaseId: r.body && r.body.id, doneAt: Date.now() }, { merge: true });
    const nNew = items.filter((x) => x.newProductData).length;
    await send(from, `✅ *Compra cargada.* ${items.length - nNew} productos con stock y costo actualizados${updatePrices ? " y precios de venta al día" : ""}${nNew ? `, y ${nNew} productos nuevos (revisalos en Ventra: nombre, categoría y precio)` : ""}.\n\nAprendí cómo factura este proveedor cada producto: la próxima boleta va a tener menos preguntas.`);
    return advance(deps, inv);
  } catch (err) {
    await ref.set({ status: "confirm", error: err.message }, { merge: true });
    return send(from, `No pude cargar la compra: ${err.message}. Podés tocar *Confirmar* de nuevo.`);
  }
}

/** Revisarla en la PC: la compra queda pendiente en la caja con lo leído y la PC avisa al toque */
async function toPc(deps, ref, inv) {
  const { api, uid, from, send } = deps;
  if (inv.status !== "review" && inv.status !== "confirm") return send(from, "Esa boleta ya no está para revisar.");
  if (!inv.preview) return send(from, "Esta boleta la leí antes de que existiera esta opción: mandame la foto de nuevo.");
  await ref.set({ status: "loading", loadingAt: Date.now() }, { merge: true });
  try {
    const [r] = await api.call(uid, [{ method: "POST", path: "/api/purchases/pending-from-preview", body: { preview: inv.preview, via: "WhatsApp" } }]);
    if (r.status >= 300) throw new Error(errorOf(r));
    if (r.body && r.body.status === "DUPLICATE") {
      await ref.set({ status: "cancelled" }, { merge: true });
      await send(from, "Esta boleta ya estaba cargada en Ventra, así que no la mandé de nuevo.");
      return advance(deps, inv);
    }
    await ref.set({ status: "pc", purchaseId: (r.body && r.body.purchaseId) || null, doneAt: Date.now() }, { merge: true });
    await send(from, "💻 *Listo, te la dejé en la PC.* Abrí Ventra: te aparece un aviso para revisarla (también está en *Compras*). Todavía no se cargó nada: el stock y los costos cambian recién cuando la confirmás ahí.");
    return advance(deps, inv);
  } catch (err) {
    await ref.set({ status: inv.status, error: err.message }, { merge: true });
    return send(from, `No pude dejarla en la PC: ${err.message}. Probá de nuevo o tocá *Seguir por acá*.`);
  }
}

/** La boleta en curso (para CANCELAR escrito) */
async function current(db, uid, from, now = Date.now()) {
  const snap = await db.collection(INVOICES).where("from", "==", from).where("uid", "==", uid).get();
  const open = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => ["review", "confirm"].includes(x.status) && now - Number(x.at || 0) < ACTIVE_MS);
  return open.sort((a, b) => b.at - a.at)[0] || null;
}

module.exports = { start, next, summary, act, current, keepMargin, advance, present, INVOICES, MAX_PHOTOS };
