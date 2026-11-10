// ═══════════════════════════════════════════════════
// El dueño cambia precios (y activa u oculta productos) por WhatsApp.
//
// - La IA (ai-agent.js) tiene la herramienta cambiar_productos, solo para el dueño y solo por
//   WhatsApp. La herramienta NO cambia nada: busca los productos en la réplica de Neon, calcula
//   los precios nuevos y deja la propuesta. processInbox (wa-owner.js) la guarda en
//   ventra_wa_owner_edits/{id} y le manda al dueño la lista con botones Confirmar / Cancelar.
// - Al confirmar, apply escribe las filas en Neon como si fuera una caja más (device "whatsapp"),
//   con la hora actual: gana sobre lo anterior, las cajas la bajan en su próximo ciclo y la que
//   publica en GO Delivery manda el precio nuevo. El stock no se toca (las cajas no aplican
//   contadores que llegan en la fila).
// - Queda el historial de precios (price_history, si el teléfono está vinculado a un usuario) y
//   un renglón de auditoría por producto.
// - Deshacer: vuelve al precio anterior solo los productos que nadie volvió a cambiar.
// ═══════════════════════════════════════════════════
const crypto = require("crypto");
const cloudSync = require("./sync");

const EDITS = "ventra_wa_owner_edits";
const DEVICE = "whatsapp";
const SKIP_PRODUCTS = ["VENTA_RAPIDA", "PAGO_CTA_CTE"];
/** Cuánto vale una propuesta sin confirmar */
const PENDING_MS = 30 * 60 * 1000;
/** Hasta cuándo se puede deshacer */
const UNDO_MS = 24 * 60 * 60 * 1000;
const MAX_ITEMS = 20;
const MAX_PRODUCTS = 300;
/** Opciones que se le muestran a la IA cuando hay varios parecidos */
const MAX_OPTIONS = 6;

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
const yes = (v) => v === true || v === 1 || v === "1" || v === "true";
const num = (v) => (v === null || v === undefined || v === "" ? NaN : Number(v));
const r2 = (v) => Math.round(Number(v) * 100) / 100;
const ms = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : Number(t) || 0);
const money = (v) => {
  const n = Number(v) || 0;
  return `$ ${n.toLocaleString("es-AR", { minimumFractionDigits: 0, maximumFractionDigits: Number.isInteger(n) ? 0 : 2 })}`;
};
const run = (sql, text, params) => (typeof sql.query === "function" ? sql.query(text, params) : sql(text, params));

const TOOL = {
  name: "cambiar_productos",
  description: "Prepara cambios de precio de venta o activar/ocultar productos. NO cambia nada: el sistema le manda al dueño la lista con botones para confirmar. "
    + "cambios: uno por producto, con buscar (nombre, parte del nombre o código de barras; o el id que devolvió esta herramienta) y lo que cambia: "
    + "precio (precio final de venta), porcentaje (ej. 10 para subir 10%, -5 para bajar 5%) o activo (false para ocultarlo de la venta, true para volver a activarlo). "
    + "Para todos los de una categoría: categoria y porcentaje, sin cambios. redondeo: múltiplo para los precios calculados con porcentaje (si no se dice, de a $ 10).",
  input_schema: {
    type: "object",
    properties: {
      cambios: {
        type: "array",
        items: {
          type: "object",
          properties: { buscar: { type: "string" }, precio: { type: "number" }, porcentaje: { type: "number" }, activo: { type: "boolean" } },
          required: ["buscar"],
          additionalProperties: false,
        },
      },
      categoria: { type: "string" },
      porcentaje: { type: "number" },
      redondeo: { type: "number" },
    },
    additionalProperties: false,
  },
};

const SYSTEM_NOTE = `- Podés cambiar precios de venta y activar u ocultar productos con cambiar_productos. Esa herramienta solo prepara el cambio: el sistema le manda al dueño la lista con botones para confirmar. Si devuelve listo, respondé solo una oración corta como "Te paso los cambios para que los confirmes" (sin repetir la lista y sin decir que ya se cambió). Si devuelve dudas (varios productos parecidos o ninguno), preguntá cuál con las opciones que trae. El stock, el costo y los productos nuevos no se cambian por acá: decile que lo haga desde Ventra.`;

/** Precio calculado con porcentaje, redondeado al múltiplo (por defecto $ 10, o $ 1 si es menos de $ 100) */
function withPercent(price, pct, step) {
  const raw = Number(price) * (1 + Number(pct) / 100);
  const s = Number(step) > 0 ? Number(step) : raw >= 100 ? 10 : 1;
  return r2(Math.round(raw / s) * s);
}

/** Productos vigentes con lo justo para buscar (sin traer la fila entera) */
async function listProducts(sql, uid) {
  return run(sql, `SELECT id, data->>'name' AS name, data->>'barcode' AS barcode, data->>'sku' AS sku, data->>'sale_price' AS price,
      data->>'is_active' AS active, data->>'unit' AS unit, data->>'category_id' AS category_id
    FROM sync_rows WHERE tenant_id = $1 AND tbl = 'products' AND NOT deleted AND id <> ALL($2)`, [uid, SKIP_PRODUCTS]);
}

/** Un producto por id, código o nombre. { product } o { options } (varios) o {} (ninguno) */
function findOne(products, buscar) {
  const raw = String(buscar || "").trim();
  if (!raw) return {};
  const byId = products.find((p) => p.id === raw || (p.barcode && p.barcode === raw) || (p.sku && p.sku === raw));
  if (byId) return { product: byId };
  const q = norm(raw);
  const exact = products.filter((p) => norm(p.name) === q);
  if (exact.length === 1) return { product: exact[0] };
  const words = q.split(" ").filter(Boolean);
  const found = products.filter((p) => words.every((w) => norm(p.name).includes(w)));
  // Los activos primero y los nombres más cortos (lo más parecido a lo que escribió)
  found.sort((a, b) => (yes(b.active) - yes(a.active)) || String(a.name).length - String(b.name).length);
  if (found.length === 1) return { product: found[0] };
  return found.length ? { options: found } : {};
}

const unitOf = (p) => (["KG", "L", "MT"].includes(String(p.unit || "").toUpperCase()) ? String(p.unit).toLowerCase() : "");

/**
 * Lo que pidió la IA → propuesta. Devuelve { result } para la IA y, si está todo claro, { plan }.
 * plan.items: [{ id, name, unit, oldPrice, newPrice, oldActive, newActive }]
 */
async function prepare(sql, uid, input = {}) {
  const products = await listProducts(sql, uid);
  const changes = Array.isArray(input.cambios) ? input.cambios.slice(0, MAX_ITEMS + 1) : [];
  if (changes.length > MAX_ITEMS) return { result: { error: `Por WhatsApp se cambian hasta ${MAX_ITEMS} productos sueltos por vez (o una categoría entera con porcentaje).` } };
  const step = num(input.redondeo);
  const items = new Map();
  const doubts = [];
  let catName = null;
  const put = (p, change) => {
    const oldPrice = r2(num(p.price) || 0);
    const oldActive = p.active === null || yes(p.active);
    const prev = items.get(p.id);
    let newPrice = prev ? prev.newPrice : oldPrice;
    let newActive = prev ? prev.newActive : oldActive;
    if (Number.isFinite(num(change.precio))) newPrice = r2(num(change.precio));
    else if (Number.isFinite(num(change.porcentaje))) newPrice = withPercent(oldPrice, change.porcentaje, step);
    if (typeof change.activo === "boolean") newActive = change.activo;
    items.set(p.id, { id: p.id, name: p.name, unit: unitOf(p), oldPrice, newPrice, oldActive, newActive });
  };

  for (const c of changes) {
    const hasChange = Number.isFinite(num(c.precio)) || Number.isFinite(num(c.porcentaje)) || typeof c.activo === "boolean";
    if (!hasChange) { doubts.push({ buscado: c.buscar, problema: "No dice qué cambiar (precio, porcentaje o activo)" }); continue; }
    if (Number.isFinite(num(c.precio)) && !(num(c.precio) > 0)) { doubts.push({ buscado: c.buscar, problema: "El precio tiene que ser mayor a 0" }); continue; }
    const f = findOne(products, c.buscar);
    if (f.product) { put(f.product, c); continue; }
    if (f.options) {
      doubts.push({ buscado: c.buscar, problema: "Hay varios parecidos: preguntale cuál", opciones: f.options.slice(0, MAX_OPTIONS).map((p) => ({ id: p.id, producto: p.name, precio: r2(num(p.price) || 0), activo: p.active === null || yes(p.active) })), total: f.options.length });
    } else {
      doubts.push({ buscado: c.buscar, problema: "No encontré ese producto" });
    }
  }

  if (input.categoria) {
    if (!Number.isFinite(num(input.porcentaje))) {
      doubts.push({ categoria: input.categoria, problema: "Para una categoría entera hace falta el porcentaje" });
    } else {
      const cats = await run(sql, `SELECT id, data->>'name' AS name FROM sync_rows WHERE tenant_id = $1 AND tbl = 'categories' AND NOT deleted`, [uid]);
      const q = norm(input.categoria);
      const exact = cats.filter((c) => norm(c.name) === q);
      const match = exact.length ? exact : cats.filter((c) => norm(c.name).includes(q));
      if (match.length !== 1) {
        doubts.push({ categoria: input.categoria, problema: match.length ? "Hay varias categorías parecidas: preguntale cuál" : "No encontré esa categoría", opciones: match.slice(0, MAX_OPTIONS).map((c) => c.name), ...(match.length ? {} : { categorias: cats.slice(0, 30).map((c) => c.name) }) });
      } else {
        const inCat = products.filter((p) => p.category_id === match[0].id && (p.active === null || yes(p.active)) && num(p.price) > 0);
        if (!inCat.length) doubts.push({ categoria: match[0].name, problema: "Esa categoría no tiene productos activos con precio" });
        else if (inCat.length > MAX_PRODUCTS) doubts.push({ categoria: match[0].name, problema: `Tiene ${inCat.length} productos: por WhatsApp se cambian hasta ${MAX_PRODUCTS} por vez. Que lo haga desde Ventra (Productos → Actualizar precios).` });
        else { catName = match[0].name; for (const p of inCat) put(p, { porcentaje: input.porcentaje }); }
      }
    }
  }

  if (doubts.length) return { result: { listo: false, dudas: doubts } };
  const list = [...items.values()].filter((i) => i.newPrice !== i.oldPrice || i.newActive !== i.oldActive);
  if (!list.length) return { result: { listo: false, dudas: [{ problema: items.size ? "Los productos ya tienen esos valores: no hay nada para cambiar" : "No dijo qué productos cambiar" }] } };
  const plan = { items: list.slice(0, MAX_PRODUCTS), category: catName, percent: Number.isFinite(num(input.porcentaje)) ? num(input.porcentaje) : null };
  return {
    plan,
    result: { listo: true, productos: list.length, aviso: "El sistema ya le manda la lista con botones para confirmar. No la repitas." },
  };
}

/** Texto de la propuesta (cuerpo del mensaje con botones: hasta 1024 caracteres) */
function previewText(plan, prefix = "") {
  const lines = [];
  const big = plan.items.filter((i) => i.oldPrice > 0 && (i.newPrice > i.oldPrice * 2 || i.newPrice < i.oldPrice / 2));
  for (const i of plan.items) {
    const u = i.unit ? ` /${i.unit}` : "";
    const parts = [];
    if (i.newPrice !== i.oldPrice) parts.push(`${money(i.oldPrice)} → *${money(i.newPrice)}*${u}`);
    if (i.newActive !== i.oldActive) parts.push(i.newActive ? "*se vuelve a vender*" : "*se oculta de la venta*");
    lines.push(`- ${i.name}: ${parts.join(", ")}`);
  }
  const head = plan.category && plan.percent !== null
    ? `Revisá antes de confirmar (${plan.category}, ${plan.percent > 0 ? "+" : ""}${plan.percent}%):`
    : "Revisá antes de confirmar:";
  const foot = `${big.length ? `\n\nOjo: ${big.length === 1 ? "un precio cambia" : `${big.length} precios cambian`} más del doble o a menos de la mitad.` : ""}\n\nSe cambia en todas las cajas${plan.items.length > 1 ? ` (${plan.items.length} productos)` : ""}. La propuesta vale 30 minutos.`;
  let body = prefix + head;
  let shown = 0;
  for (const l of lines) {
    const rest = lines.length - shown - 1;
    const tail = rest > 0 ? `\n- …y ${rest} más` : "";
    if ((body + "\n" + l + tail + foot).length > 1000) break;
    body += "\n" + l;
    shown++;
  }
  if (shown < lines.length) body += `\n- …y ${lines.length - shown} más`;
  return body + foot;
}

/** El mismo tipo que ya tenía la columna (las cajas guardan booleanos como 1/0) */
const sameKind = (old, value) => (typeof old === "number" ? (value ? 1 : 0) : typeof old === "string" ? (value ? "1" : "0") : value);

/**
 * Escribe en Neon. `items` con { id, from: { price, active }, to: { price, active } }: solo cambia
 * los productos que siguen como `from` (si alguien los cambió mientras tanto, no los pisa).
 * deps: { sql, uid, userId, afterWrite, now }. Devuelve { done: [...], skipped: [...] }.
 */
async function write({ sql, uid, userId, afterWrite, now = Date.now(), via = "WhatsApp" }, items) {
  const ids = items.map((i) => i.id);
  const cur = await run(sql, `SELECT id, data FROM sync_rows WHERE tenant_id = $1 AND tbl = 'products' AND NOT deleted AND id = ANY($2)`, [uid, ids]);
  const byId = new Map(cur.map((r) => [r.id, typeof r.data === "string" ? JSON.parse(r.data) : r.data]));
  let user = null;
  if (userId) {
    const u = await run(sql, `SELECT 1 FROM sync_rows WHERE tenant_id = $1 AND tbl = 'users' AND id = $2 AND NOT deleted`, [uid, userId]);
    if (u.length) user = userId;
  }
  const rows = [];
  const done = [];
  const skipped = [];
  for (const it of items) {
    const d = byId.get(it.id);
    if (!d) { skipped.push({ ...it, why: "ya no existe" }); continue; }
    const price = r2(num(d.sale_price) || 0);
    const active = d.is_active === null || d.is_active === undefined || yes(d.is_active);
    if (price !== it.from.price || active !== it.from.active) { skipped.push({ ...it, why: "lo cambiaron mientras tanto" }); continue; }
    const data = { ...d, sale_price: it.to.price, is_active: sameKind(d.is_active, it.to.active) };
    if (typeof d.updated_at === "number") data.updated_at = now;
    rows.push({ t: "products", id: it.id, d: data, ts: now });
    if (it.to.price !== it.from.price && user) {
      rows.push({ t: "price_history", id: crypto.randomUUID(), ts: now, d: { id: null, product_id: it.id, user_id: user, old_price: it.from.price, new_price: it.to.price, changed_at: now } });
      rows[rows.length - 1].d.id = rows[rows.length - 1].id;
    }
    const aid = crypto.randomUUID();
    rows.push({ t: "audit_logs", id: aid, ts: now, d: {
      id: aid, user_id: user, entity_type: "PRODUCT", entity_id: it.id, action: "UPDATE",
      old_values: JSON.stringify({ salePrice: it.from.price, isActive: it.from.active }),
      new_values: JSON.stringify({ salePrice: it.to.price, isActive: it.to.active, via }),
      ip_address: null, terminal: via, created_at: now,
    } });
    done.push(it);
  }
  if (rows.length) {
    const res = await cloudSync.push(sql, uid, DEVICE, rows);
    // Las cajas que ya estaban al día se enteran por el marcador (ver sync-head.js)
    if (afterWrite) await afterWrite(uid, res.maxSeq || 0, res.gen);
  }
  return { done, skipped };
}

const asWrite = (i) => ({ id: i.id, name: i.name, unit: i.unit, from: { price: i.oldPrice, active: i.oldActive }, to: { price: i.newPrice, active: i.newActive } });
const asUndo = (i) => ({ id: i.id, name: i.name, unit: i.unit, from: { price: i.newPrice, active: i.newActive }, to: { price: i.oldPrice, active: i.oldActive } });

/** Guarda la propuesta para confirmarla con los botones. Devuelve el id. */
async function save(db, { uid, from, userId, plan }, now = Date.now()) {
  const id = `${now.toString(36)}${crypto.randomBytes(4).toString("hex")}`;
  await db.collection(EDITS).doc(id).set({ uid, from, userId: userId || null, items: plan.items, category: plan.category, percent: plan.percent, status: "pending", createdAt: now });
  return id;
}

/**
 * Botón (o "sí"/"no" escrito): confirmar, cancelar o deshacer. Devuelve el texto para el dueño y
 * si corresponde el botón de deshacer: { text, undo: id }.
 */
async function act(db, { action, id, from, uid, sql, afterWrite }, now = Date.now()) {
  const ref = db.collection(EDITS).doc(String(id || ""));
  const snap = await ref.get();
  if (!snap.exists) return { text: "No encontré ese cambio. Pedímelo de nuevo." };
  const e = snap.data();
  // Solo quien lo pidió, desde el mismo teléfono y para el mismo comercio
  if (e.from !== from || e.uid !== uid) return { text: "Ese cambio no es tuyo." };
  const n = e.items.length;
  const what = n === 1 ? e.items[0].name : `${n} productos`;

  if (action === "no") {
    if (e.status !== "pending") return { text: e.status === "applied" ? "Ese cambio ya está hecho. Si querés volver atrás, tocá *Deshacer*." : "Ese cambio ya no está pendiente." };
    await ref.set({ status: "cancelled", doneAt: now }, { merge: true });
    return { text: "Listo, no cambié nada." };
  }

  if (action === "ok") {
    if (e.status === "applied") return { text: "Ese cambio ya está hecho." };
    if (e.status !== "pending") return { text: "Ese cambio se canceló. Si lo querés, pedímelo de nuevo." };
    if (now - ms(e.createdAt) > PENDING_MS) {
      await ref.set({ status: "expired" }, { merge: true });
      return { text: "Pasaron más de 30 minutos y los precios pueden haber cambiado. Pedímelo de nuevo y te paso la lista actualizada." };
    }
    // Primero se marca (si Meta manda el botón dos veces, el segundo no vuelve a escribir)
    await ref.set({ status: "applying" }, { merge: true });
    try {
      const r = await write({ sql, uid, userId: e.userId, afterWrite, now }, e.items.map(asWrite));
      const appliedIds = r.done.map((d) => d.id);
      await ref.set({ status: "applied", appliedAt: now, appliedIds }, { merge: true });
      if (!r.done.length) return { text: `No cambié nada: ${r.skipped.length === 1 ? `${r.skipped[0].name} ${r.skipped[0].why}` : "los productos cambiaron mientras tanto"}. Pedímelo de nuevo.` };
      const miss = r.skipped.length ? `\n\nNo toqué ${r.skipped.map((s) => s.name).slice(0, 5).join(", ")}${r.skipped.length > 5 ? "…" : ""}: los cambiaron mientras tanto.` : "";
      return { text: `Listo, cambié ${r.done.length === 1 ? r.done[0].name : `${r.done.length} productos`}. Las cajas lo toman en unos segundos (las que están apagadas, cuando se prendan).${miss}\n\nSi te equivocaste, tocá *Deshacer* (sirve hasta mañana a esta hora).`, undo: id };
    } catch (err) {
      await ref.set({ status: "pending" }, { merge: true });
      throw err;
    }
  }

  if (action === "undo") {
    if (e.status === "undone") return { text: "Ese cambio ya lo deshice." };
    if (e.status !== "applied") return { text: "Ese cambio no se llegó a hacer, así que no hay nada para deshacer." };
    if (now - ms(e.appliedAt) > UNDO_MS) return { text: "Pasó más de un día: ese cambio ya no se puede deshacer desde acá. Cambialo de nuevo o hacelo desde Ventra." };
    await ref.set({ status: "undoing" }, { merge: true });
    try {
      const applied = new Set(e.appliedIds || []);
      const r = await write({ sql, uid, userId: e.userId, afterWrite, now, via: "WhatsApp (deshacer)" }, e.items.filter((i) => applied.has(i.id)).map(asUndo));
      await ref.set({ status: "undone", undoneAt: now }, { merge: true });
      const miss = r.skipped.length ? `\n\nNo toqué ${r.skipped.map((s) => s.name).slice(0, 5).join(", ")}${r.skipped.length > 5 ? "…" : ""}: los volvieron a cambiar después.` : "";
      return { text: r.done.length ? `Listo, volví ${r.done.length === 1 ? r.done[0].name : `${r.done.length} productos`} a como estaba${r.done.length === 1 ? "" : "n"}.${miss}` : `No deshice nada: ${what === e.items[0].name ? "lo" : "los"} volvieron a cambiar después.` };
    } catch (err) {
      await ref.set({ status: "applied" }, { merge: true });
      throw err;
    }
  }
  return { text: "No entendí ese botón." };
}

/**
 * Para una pregunta: la herramienta que recibe la IA y la última propuesta lista.
 * session.plan queda con la propuesta si la IA preparó una sin dudas.
 */
function session(sql, uid) {
  const s = {
    tool: TOOL,
    systemNote: SYSTEM_NOTE,
    plan: null,
    run: async (input) => {
      const r = await prepare(sql, uid, input || {});
      s.plan = r.plan || null;
      return r.result;
    },
  };
  return s;
}

module.exports = { TOOL, SYSTEM_NOTE, EDITS, DEVICE, PENDING_MS, UNDO_MS, prepare, previewText, write, save, act, session, withPercent, findOne };
