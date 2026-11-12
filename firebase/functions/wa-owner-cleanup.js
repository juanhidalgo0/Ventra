// ═══════════════════════════════════════════════════
// Limpieza guiada de productos repetidos por WhatsApp (MENÚ → Más opciones → Productos repetidos).
//
// El bot muestra de a un grupo (nombre, código de barras, precio, stock y ventas de cada uno) y el
// dueño elige: Juntar / Son distintos / Saltear. Juntar llama a la caja en la nube
// (POST /api/products/merge, ver apps/backend/.../product-merge.service.ts): el repetido se OCULTA,
// sus códigos de barras pasan al que queda y el stock se suma. Nada se borra; "SEPARAR" deshace la
// última juntada y "JUNTADOS" lista las anteriores para separar cualquiera.
//
// Los grupos que parecen distintos (talle, color, sabor, precios muy distintos) vienen marcados:
// el botón principal es "Son distintos" y juntar pide "Juntar igual".
// ═══════════════════════════════════════════════════
const CLEANUPS = "ventra_wa_cleanup";
const ACTIVE_MS = 2 * 60 * 60 * 1000;
const MAX_SHOWN = 4;

const money = (n) => { const v = Math.round(Number(n) || 0); return `${v < 0 ? "-" : ""}$ ${Math.abs(v).toLocaleString("es-AR")}`; };
const day = (iso) => (iso ? new Date(iso).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "numeric" }) : null);
const NUM = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣", "8️⃣", "9️⃣"];
const errorOf = (r) => (r && r.body && (Array.isArray(r.body.message) ? r.body.message.join(". ") : r.body.message || r.body.error)) || `error ${r && r.status}`;
const docId = (uid, from) => `${uid}_${from}`;

/** Lo justo de cada grupo para guardar (Firestore) y mostrar */
const slim = (g) => ({
  key: g.key, kind: g.kind, looksDistinct: !!g.looksDistinct, why: g.why || null, keepId: g.keepId,
  products: g.products.map((p) => ({ id: p.id, name: p.name, barcode: p.barcode || null, extra: (p.extraBarcodes || []).length, price: p.salePrice, stock: p.stock, sold: p.sold, last: p.lastSale })),
});

function card(c, prefix = "") {
  const g = c.groups[c.i];
  const total = c.groups.length;
  const keepIdx = Math.max(0, g.products.findIndex((p) => p.id === g.keepId));
  const shown = g.products.slice(0, MAX_SHOWN);
  const lines = shown.map((p, k) => `${NUM[k]} ${p.name}\n    ${p.barcode ? `Código ${p.barcode}` : "Sin código"}${p.extra ? ` (+${p.extra})` : ""} · ${money(p.price)} · stock ${Math.round(p.stock * 100) / 100} · ${p.sold ? `vendió ${p.sold}${p.last ? ` (última ${day(p.last)})` : ""}` : "sin ventas"}`);
  const title = g.kind === "igual" ? `*${g.products[0].name}* aparece ${g.products.length} veces:` : `Estos ${g.products.length} parecen el mismo producto:`;
  const advice = g.looksDistinct
    ? `⚠️ Ojo: ${g.why}. Si no son el mismo, tocá *Son distintos*.`
    : `Si los junto, queda el ${NUM[keepIdx]} (${g.products[keepIdx].sold ? "el que más vende" : "el que tiene código"}) y ${g.products.length > 2 ? "los otros se ocultan" : "el otro se oculta"}: sus códigos pasan al ${NUM[keepIdx]}, así se encuentra igual al escanearlo. No se borra nada.`;
  const more = g.products.length > MAX_SHOWN ? `\n_…y ${g.products.length - MAX_SHOWN} más (se juntan todos)._` : "";
  const body = `${prefix}🔁 *Repetidos* (${c.i + 1} de ${total})\n\n${title}\n\n${lines.join("\n")}${more}\n\n${advice}\n_Para que quede otro, escribí por ejemplo *queda el 2*._`;
  const buttons = g.looksDistinct
    ? [{ id: `wc|distinct|${c.i}`, title: "Son distintos" }, { id: `wc|merge|${c.i}`, title: "Juntar igual" }, { id: `wc|skip|${c.i}`, title: "Saltear" }]
    : [{ id: `wc|merge|${c.i}`, title: "Juntar" }, { id: `wc|distinct|${c.i}`, title: "Son distintos" }, { id: `wc|skip|${c.i}`, title: "Saltear" }];
  return { body: body.length > 1024 ? `${body.slice(0, 1000)}…` : body, buttons };
}

/**
 * deps: { db, api (ventraApi client), uid, from, send, sendButtons, now }.
 * Cada función manda lo que corresponde y devuelve null.
 */
async function start({ db, api, uid, from, send, sendButtons, now = Date.now() }) {
  const ref = db.collection(CLEANUPS).doc(docId(uid, from));
  const prev = await ref.get();
  const p = prev.exists ? prev.data() : {};
  await send(from, "🔎 Buscando productos repetidos en tu catálogo…");
  let res;
  try {
    [res] = await api.call(uid, [{ method: "GET", path: "/api/products/duplicates", query: { limit: 400 } }]);
  } catch (err) {
    return send(from, err.preparing ? `${err.message} Cuando esté lista, pedime de nuevo *Productos repetidos*.` : `No pude buscar los repetidos: ${err.message}`);
  }
  if (res.status >= 300) return send(from, `No pude buscar los repetidos: ${errorOf(res)}`);
  const skipped = new Set(p.skipped || []);
  const groups = (res.body.groups || []).filter((g) => !skipped.has(g.key)).map(slim);
  if (!groups.length) {
    await ref.set({ uid, from, groups: [], i: 0, at: now, active: false }, { merge: true });
    return send(from, skipped.size ? `No quedan repetidos por revisar ✅ (salteaste ${skipped.size}: escribí *REPETIDOS DE NUEVO* para verlos otra vez).` : "No encontré productos repetidos. ✅ Tu catálogo está limpio.");
  }
  const c = { uid, from, groups, i: 0, at: now, active: true, skipped: [...skipped], stats: p.stats || { merged: 0, distinct: 0, skipped: 0 }, lastMerge: p.lastMerge || null };
  await ref.set(c);
  const intro = `Encontré *${groups.length} grupos* de productos que parecen repetidos. Vamos de a uno; podés parar cuando quieras escribiendo *PARAR* y seguir otro día.\n\n`;
  const k = card(c, intro);
  return sendButtons(from, k.body, k.buttons);
}

/** Botón de un grupo: merge | distinct | skip. keepIndex (opcional): el que queda ("queda el 2") */
async function act({ db, api, uid, from, send, sendButtons, now = Date.now() }, action, i, keepIndex = null) {
  const ref = db.collection(CLEANUPS).doc(docId(uid, from));
  const snap = await ref.get();
  if (!snap.exists || !snap.data().active) return send(from, "Esa revisión ya terminó. Escribí *MENÚ* → Más opciones → Productos repetidos para empezar otra.");
  const c = snap.data();
  if (Number(i) !== c.i) return send(from, "Ese grupo ya lo resolviste. Seguimos con el que te mandé último.");
  const g = c.groups[c.i];
  let prefix = "";
  if (action === "merge") {
    const keep = keepIndex !== null && g.products[keepIndex] ? g.products[keepIndex] : g.products.find((p) => p.id === g.keepId) || g.products[0];
    const mergeIds = g.products.filter((p) => p.id !== keep.id).map((p) => p.id);
    let r;
    try { [r] = await api.call(uid, [{ method: "POST", path: "/api/products/merge", body: { keepId: keep.id, mergeIds } }]); } catch (err) { r = { status: 500, body: { message: err.message } }; }
    if (r.status >= 300) {
      // No se pudo (promo, kit, ya oculto…): se avisa y se sigue con el próximo
      prefix = `⚠️ No los junté: ${errorOf(r)}\n\n`;
      c.stats.skipped++;
    } else {
      c.stats.merged++;
      c.lastMerge = { mergeId: r.body.mergeId, name: keep.name, at: now };
      prefix = `✅ Junté en *${keep.name}*${r.body.barcodesMoved ? ` (pasaron ${r.body.barcodesMoved} ${r.body.barcodesMoved === 1 ? "código" : "códigos"})` : ""}${r.body.backup ? " · hice una copia de seguridad antes" : ""}. _Si fue un error, escribí *SEPARAR*._\n\n`;
    }
  } else if (action === "distinct") {
    let r;
    try { [r] = await api.call(uid, [{ method: "POST", path: "/api/products/duplicates/distinct", body: { ids: g.products.map((p) => p.id) } }]); } catch (err) { r = { status: 500, body: { message: err.message } }; }
    if (r.status >= 300) return send(from, `No pude anotarlo: ${errorOf(r)}. Probá de nuevo.`);
    c.stats.distinct++;
    prefix = "👍 Anotado: son distintos, no te los vuelvo a mostrar.\n\n";
  } else {
    c.stats.skipped++;
    c.skipped = [...new Set([...(c.skipped || []), g.key])];
    prefix = "⏭️ Salteado.\n\n";
  }
  c.i++;
  c.at = now;
  if (c.i >= c.groups.length) {
    c.active = false;
    await ref.set(c);
    return send(from, `${prefix}🎉 *Terminamos.* Juntaste ${c.stats.merged}, ${c.stats.distinct} eran distintos y salteaste ${c.stats.skipped}.\n\nNada se borró: los juntados quedaron ocultos. Escribí *JUNTADOS* para verlos y separar cualquiera.`);
  }
  await ref.set(c);
  const k = card(c, prefix);
  return sendButtons(from, k.body, k.buttons);
}

async function stop({ db, uid, from, send }) {
  const ref = db.collection(CLEANUPS).doc(docId(uid, from));
  const snap = await ref.get();
  if (!snap.exists || !snap.data().active) return send(from, "No había ninguna revisión en curso.");
  const c = snap.data();
  await ref.set({ active: false }, { merge: true });
  return send(from, `Listo, paramos. Revisaste ${c.i} de ${c.groups.length}. Cuando quieras seguir: *MENÚ* → Más opciones → Productos repetidos.`);
}

/** SEPARAR (la última) o SEPARAR n (de la lista de JUNTADOS) */
async function undo({ db, api, uid, from, send }, n = null) {
  const ref = db.collection(CLEANUPS).doc(docId(uid, from));
  const snap = await ref.get();
  const c = snap.exists ? snap.data() : {};
  let target = null;
  if (n !== null) {
    const list = c.mergedList || [];
    target = list[n - 1] || null;
    if (!target) return send(from, "No encontré ese número. Escribí *JUNTADOS* para ver la lista.");
  } else {
    target = c.lastMerge || null;
    if (!target) return send(from, "No tengo ninguna juntada reciente. Escribí *JUNTADOS* para ver las anteriores.");
  }
  let r;
  try { [r] = await api.call(uid, [{ method: "POST", path: `/api/products/merge/${encodeURIComponent(target.mergeId)}/undo` }]); } catch (err) { r = { status: 500, body: { message: err.message } }; }
  if (r.status >= 300) return send(from, `No pude separarlos: ${errorOf(r)}`);
  if (c.lastMerge && c.lastMerge.mergeId === target.mergeId) await ref.set({ lastMerge: null }, { merge: true });
  if (r.body.already) return send(from, "Esos ya estaban separados.");
  return send(from, `↩️ Listo, separé ${(r.body.restored || []).join(", ") || "los productos"} de *${target.name || "el producto"}*: volvieron a estar como antes (con su código y su stock).`);
}

/** JUNTADOS: las últimas juntadas, numeradas, para separar */
async function list({ db, api, uid, from, send }) {
  let r;
  try { [r] = await api.call(uid, [{ method: "GET", path: "/api/products/merges" }]); } catch (err) { return send(from, `No pude traer la lista: ${err.message}`); }
  if (r.status >= 300) return send(from, `No pude traer la lista: ${errorOf(r)}`);
  const merges = (r.body || []).slice(0, 15);
  if (!merges.length) return send(from, "No hay productos juntados.");
  await db.collection(CLEANUPS).doc(docId(uid, from)).set({ uid, from, mergedList: merges.map((m) => ({ mergeId: m.mergeId, name: m.kept })) }, { merge: true });
  return send(from, `*Productos juntados* (los ocultos siguen guardados):\n\n${merges.map((m, k) => `${k + 1}. *${m.kept}* ← ${m.hidden.join(", ")}`).join("\n")}\n\nPara separar uno escribí *SEPARAR* y el número (por ejemplo *SEPARAR 2*).`);
}

/** ¿Hay una revisión en curso? (para "queda el 2" y PARAR) */
async function active(db, uid, from, now = Date.now()) {
  const snap = await db.collection(CLEANUPS).doc(docId(uid, from)).get();
  if (!snap.exists) return null;
  const c = snap.data();
  return c.active && now - Number(c.at || 0) < ACTIVE_MS ? c : null;
}

async function resetSkipped(db, uid, from) {
  await db.collection(CLEANUPS).doc(docId(uid, from)).set({ skipped: [] }, { merge: true });
}

module.exports = { start, act, stop, undo, list, active, resetSkipped, card, CLEANUPS };
