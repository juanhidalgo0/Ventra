// ═══════════════════════════════════════════════════
// Memoria compartida por proveedor para leer boletas (2026-11-12, pedido del dueño: "que la IA se
// haga cada vez más inteligente y cada usuario nuevo encuentre una IA mejor").
//
// - Aprende: cuando un comercio confirma una boleta escaneada y corrigió lo que la IA leyó (cantidades,
//   costos, renglones de más), la caja manda esas diferencias. Una IA chica las convierte en lecciones
//   GENERALES sobre cómo viene la boleta de ese proveedor ("la columna U.B. son unidades por bulto",
//   "los renglones 'Promoción' traen el precio con la promo"), nunca datos de un comercio.
// - Usa: al leer una foto, se suman las lecciones de los proveedores del comercio; y si la foto es de un
//   proveedor que el comercio no tenía, sus lecciones entran en la relectura.
// - Cuida: una lección de un solo comercio la usa solo ese comercio; para todos, cuando la confirma un
//   segundo comercio (así una corrección equivocada no arruina la lectura de los demás).
//
// ventra_supplier_lessons/{cuit sin guiones}: { name, lessons: [{ text, by: [uid], at }], corrections, updatedAt }
// ═══════════════════════════════════════════════════
const COL = "ventra_supplier_lessons";
const MAX_LESSONS = 10;
const MODEL = "claude-haiku-5-5";

const digits = (s) => String(s || "").replace(/\D/g, "");
const validCuit = (c) => /^(20|23|24|25|26|27|30|33|34)\d{9}$/.test(c);

/**
 * Una lección sirve para este comercio si la escribió él o si ya la confirmaron dos comercios.
 * Desde la tanda 4 cada lección nueva queda "a prueba" (status "candidate"): con 3 o más boletas
 * confirmadas de ese proveedor se lee con y sin ella (lesson-trials.js) y queda adoptada (para todos)
 * o descartada (para nadie). Sin muestras suficientes sigue la regla de los dos comercios.
 */
const usable = (l, uid) => {
  if (!l || l.status === "discarded") return false;
  if (l.status === "adopted") return true;
  return Array.isArray(l.by) && (l.by.includes(uid) || l.by.length >= 2);
};

/** Las lecciones que puede usar este comercio, por CUIT (de a muchos CUIT en una lectura) */
async function forCuits(db, uid, cuits) {
  const list = [...new Set((cuits || []).map(digits).filter(validCuit))].slice(0, 60);
  const out = new Map();
  if (!list.length) return out;
  const refs = list.map((c) => db.collection(COL).doc(c));
  const snaps = await (typeof db.getAll === "function" ? db.getAll(...refs) : Promise.all(refs.map((r) => r.get()))).catch(() => []);
  for (const s of snaps) {
    if (!s.exists) continue;
    const d = s.data();
    const lessons = (d.lessons || []).filter((l) => usable(l, uid)).map((l) => String(l.text || "").slice(0, 300)).filter(Boolean);
    const profile = d.profile && d.profile.fields ? d.profile : null;
    if (lessons.length || profile) out.set(s.id, { name: d.name || "", lessons, profile });
  }
  return out;
}

/** Texto para sumarle a la lectura de la foto: la ficha fija del proveedor y sus lecciones */
function hintText(map, onlyCuit) {
  const rows = [...map.entries()].filter(([c]) => !onlyCuit || c === digits(onlyCuit));
  if (!rows.length) return "";
  return `\n\nLo que ya se sabe de cómo vienen las boletas de algunos proveedores (aprendido de boletas confirmadas y correcciones de comercios). Usalo SOLO si esta boleta es de ese proveedor (mismo CUIT o nombre):\n${rows
    .map(([c, v]) => `- ${v.name || "Proveedor"} (CUIT ${c}):\n${[...profileLines(v.profile), ...(v.lessons || [])].map((l) => `  · ${l}`).join("\n")}`).join("\n")}`;
}

// ─── Ficha del proveedor (tanda 4.2) ───
// Datos fijos por CUIT, armados solos con las boletas confirmadas (no con texto libre de la IA):
// si los precios traen IVA, si la cantidad viene en bultos o unidades, si hay columna de unidades por
// bulto, si la columna de código es interna, y el formato "bultos,unidades". Un voto por comercio (su
// última boleta) y gana la mayoría: entra en la PRIMERA lectura, para que Haiku acierte de entrada.
// Es formato de la boleta, nunca precios ni cantidades de un comercio.

const EAN = /^(\d{8}|\d{12,14})$/;
const nameWords = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
function nameMatch(a, b) {
  const wa = nameWords(a), wb = nameWords(b);
  if (!wa.length || !wb.length) return 0;
  return wa.filter((w) => wb.some((x) => x.startsWith(w.slice(0, 4)) || w.startsWith(x.slice(0, 4)))).length / Math.max(wa.length, wb.length);
}

/**
 * Una hoja leída + lo que confirmó el comercio → lo que se observa del formato. Pura.
 * read: lectura de la IA (items con packageQuantity, unitsPerPack, sku, total…); confirmed: { items: [{ name, code, quantity, buyFormat }] }
 */
function profileFrom(read, confirmed) {
  const r = read || {}, c = confirmed || {};
  const items = (r.items || []).filter((it) => Number(String(it.total || "").replace(/[^\d-]/g, "")) > 0);
  const obs = {};
  // Precios: solo si la lectura cerró con lo impreso (si no, no se sabe si se leyó bien)
  if ((r.precios === "sin iva" || r.precios === "finales") && r.verified && r.verified !== "no") obs.precios = r.precios;
  if (items.length >= 2) obs.columnaUB = items.filter((it) => Number(it.unitsPerPack) > 1).length >= Math.max(1, Math.round(items.length * 0.3));
  // Cantidad: cada renglón confirmado (en unidades) contra el leído
  const conf = (c.items || []).filter((it) => it.buyFormat !== "PACK" && Number(it.quantity) > 0);
  const votes = { bultos: 0, unidades: 0, bultosUnidades: 0 };
  for (const ci of conf) {
    let best = null, score = 0.5;
    for (const it of items) { const s = nameMatch(ci.name, it.name); if (s > score) { score = s; best = it; } }
    if (!best) continue;
    const q = Number(best.packageQuantity) || 0, upp = Number(best.unitsPerPack) > 1 ? Number(best.unitsPerPack) : 1, units = Number(ci.quantity);
    if (q > 0 && q < 1 && Number.isInteger(units) && units >= 1) votes.bultosUnidades++;
    if (Math.abs(q * upp - units) < 0.01) votes[upp > 1 ? "bultos" : "unidades"]++;
    else if (q > 0 && units > q && Math.abs(units / q - Math.round(units / q)) < 0.01) votes.bultos++;
  }
  const total = votes.bultos + votes.unidades;
  if (total >= 2) obs.cantidad = votes.bultos > votes.unidades ? "bultos" : "unidades";
  if (votes.bultosUnidades) obs.formatoCantidad = "bultos,unidades";
  // Código: lo que quedó confirmado como código del proveedor, ¿es interno (no EAN)?
  const codes = (c.items || []).map((it) => String(it.code || "").replace(/\D/g, "") || String(it.code || "")).filter(Boolean);
  if (codes.length >= 2) obs.codigoInterno = codes.filter((x) => !EAN.test(x)).length > codes.length / 2;
  return obs;
}

const PROFILE_FIELDS = ["precios", "columnaUB", "cantidad", "formatoCantidad", "codigoInterno"];
/** Los votos de cada comercio → la ficha (lo que dice la mayoría, campo por campo). Pura. */
function profileMajority(votesBy) {
  const fields = {};
  for (const f of PROFILE_FIELDS) {
    const count = new Map();
    for (const v of Object.values(votesBy || {})) if (v && v[f] !== undefined && v[f] !== null) count.set(JSON.stringify(v[f]), (count.get(JSON.stringify(v[f])) || 0) + 1);
    const top = [...count.entries()].sort((a, b) => b[1] - a[1])[0];
    if (top) fields[f] = JSON.parse(top[0]);
  }
  return fields;
}

/** La ficha en palabras para la IA. Pura. */
function profileLines(profile) {
  const f = (profile && profile.fields) || {};
  const out = [];
  if (f.precios === "sin iva") out.push("Ficha: los precios de los renglones vienen SIN IVA (el IVA se suma al pie).");
  if (f.precios === "finales") out.push("Ficha: los precios de los renglones ya son finales (con IVA incluido).");
  if (f.cantidad === "bultos" && f.columnaUB) out.push("Ficha: la cantidad viene en bultos y hay una columna de unidades por bulto (U.B.): usala en unitsPerPack.");
  else if (f.cantidad === "bultos") out.push("Ficha: la cantidad viene en bultos; las unidades por bulto suelen estar en el nombre (\"X 24\").");
  else if (f.cantidad === "unidades") out.push("Ficha: la cantidad viene en unidades sueltas.");
  if (f.formatoCantidad === "bultos,unidades") out.push("Ficha: algunas cantidades vienen como \"bultos,unidades\" (0,04 = 4 unidades).");
  if (f.codigoInterno === true) out.push("Ficha: la columna de código es interna del proveedor: va en sku, nunca en barcode.");
  return out;
}

/** Suma lo observado en una boleta confirmada a la ficha de ese proveedor (un voto por comercio) */
async function updateProfile(db, cuit, uid, obs) {
  const c = digits(cuit);
  if (!validCuit(c) || !obs || !Object.keys(obs).length) return null;
  const ref = db.collection(COL).doc(c);
  const snap = await ref.get();
  const cur = snap.exists ? snap.data() : {};
  const votesBy = { ...((cur.profile && cur.profile.votesBy) || {}) };
  votesBy[uid] = { ...(votesBy[uid] || {}), ...obs, at: Date.now() };
  const profile = { fields: profileMajority(votesBy), votesBy, shops: Object.keys(votesBy).length, updatedAt: Date.now() };
  await ref.set({ profile }, { merge: true });
  return profile;
}

const LEARN_SCHEMA = {
  type: "object",
  properties: {
    lessons: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          // Índice de la lección que ya existía y esta confirma o corrige; -1 si es nueva
          basedOn: { type: "integer" },
        },
        required: ["text", "basedOn"],
        additionalProperties: false,
      },
    },
  },
  required: ["lessons"],
  additionalProperties: false,
};

const LEARN_PROMPT = `Mejorás la lectura automática de facturas de compra de UN proveedor de Argentina. Un comercio confirmó una boleta de este proveedor y corrigió lo que había leído la IA. Con esas correcciones, actualizá la lista de lecciones sobre CÓMO VIENE LA BOLETA de este proveedor, para que la próxima lectura acierte.

Reglas:
- Lecciones generales sobre el formato: qué significa cada columna, si la cantidad viene en bultos o unidades, unidades por bulto, si los precios traen IVA o impuestos internos, cómo vienen las promociones y descuentos, renglones que no son productos, cómo se lee el total. Una oración cada una, concreta.
- Nunca pongas datos de un comercio: ni precios puntuales, ni nombres de clientes, ni cantidades de esa compra.
- Si una corrección parece una decisión del comercio y no un error de lectura (cambió un costo un poco, sacó un producto que no quiso cargar), no hagas lección con eso.
- Mantené las lecciones que ya había y que no se contradicen (con su basedOn). Si una corrección confirma una lección que ya existía, devolvela con su basedOn. Si la contradice, reescribila con el mismo basedOn.
- Como mucho ${MAX_LESSONS} lecciones. Si no hay nada que aprender, devolvé las que ya había tal cual.`;

/**
 * Aprende de las correcciones de un comercio. body: { supplierCuit, supplierName, diffs: [{ renglon,
 * leido, corregido }] }. Devuelve { result: { lessons }, usage }.
 */
async function learn(client, db, uid, body) {
  const cuit = digits(body && body.supplierCuit);
  if (!validCuit(cuit)) return { result: { skipped: "sin CUIT" }, usage: {} };
  const diffs = (Array.isArray(body.diffs) ? body.diffs : []).slice(0, 25).map((d) => ({
    renglon: String(d && d.renglon || "").slice(0, 120), leido: String(d && d.leido || "").slice(0, 160), corregido: String(d && d.corregido || "").slice(0, 160),
  })).filter((d) => d.renglon);
  if (!diffs.length) return { result: { skipped: "sin diferencias" }, usage: {} };
  const ref = db.collection(COL).doc(cuit);
  const snap = await ref.get();
  const cur = snap.exists ? snap.data() : {};
  const prev = Array.isArray(cur.lessons) ? cur.lessons : [];
  const name = String(body.supplierName || cur.name || "").slice(0, 120);
  const msg = await client.messages.create({
    model: MODEL, max_tokens: 2000,
    output_config: { effort: "medium", format: { type: "json_schema", schema: LEARN_SCHEMA } },
    system: LEARN_PROMPT,
    messages: [{ role: "user", content: `Proveedor: ${name || "(sin nombre)"} (CUIT ${cuit})\n\nLecciones que ya había:\n${prev.length ? prev.map((l, i) => `${i}. ${l.text}`).join("\n") : "(ninguna)"}\n\nCorrecciones del comercio en esta boleta:\n${diffs.map((d) => `- ${d.renglon}: la IA leyó ${d.leido}; quedó ${d.corregido}`).join("\n")}` }],
  });
  let out;
  try { out = JSON.parse((msg.content || []).filter((b) => b.type === "text").map((b) => b.text).join("")); } catch { return { result: { skipped: "respuesta inválida" }, usage: msg.usage || {} }; }
  const now = Date.now();
  const lessons = (out.lessons || []).slice(0, MAX_LESSONS).map((l) => {
    const base = Number.isInteger(l.basedOn) && l.basedOn >= 0 ? prev[l.basedOn] : null;
    const by = [...new Set([...((base && base.by) || []), uid])].slice(0, 10);
    const same = base && base.text === l.text;
    // Una lección nueva o reescrita queda a prueba; la que ya estaba conserva lo que se probó
    return { text: String(l.text || "").trim().slice(0, 300), by, at: same ? base.at || now : now, status: same ? base.status || "candidate" : "candidate", ...(same && base.trial ? { trial: base.trial } : {}) };
  }).filter((l) => l.text);
  await ref.set({ name, lessons, corrections: (Number(cur.corrections) || 0) + 1, updatedAt: now }, { merge: true });
  return { result: { lessons: lessons.length }, usage: msg.usage || {} };
}

module.exports = { forCuits, hintText, learn, usable, profileFrom, profileMajority, profileLines, updateProfile, COL };
