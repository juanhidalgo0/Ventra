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

/** Una lección sirve para este comercio si la escribió él o si ya la confirmaron dos comercios */
const usable = (l, uid) => Array.isArray(l.by) && (l.by.includes(uid) || l.by.length >= 2);

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
    if (lessons.length) out.set(s.id, { name: d.name || "", lessons });
  }
  return out;
}

/** Texto para sumarle a la lectura de la foto */
function hintText(map, onlyCuit) {
  const rows = [...map.entries()].filter(([c]) => !onlyCuit || c === digits(onlyCuit));
  if (!rows.length) return "";
  return `\n\nLo que ya se sabe de cómo vienen las boletas de algunos proveedores (aprendido de correcciones de comercios). Usalo SOLO si esta boleta es de ese proveedor (mismo CUIT o nombre):\n${rows
    .map(([c, v]) => `- ${v.name || "Proveedor"} (CUIT ${c}):\n${v.lessons.map((l) => `  · ${l}`).join("\n")}`).join("\n")}`;
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
    return { text: String(l.text || "").trim().slice(0, 300), by, at: base && base.text === l.text ? base.at || now : now };
  }).filter((l) => l.text);
  await ref.set({ name, lessons, corrections: (Number(cur.corrections) || 0) + 1, updatedAt: now }, { merge: true });
  return { result: { lessons: lessons.length }, usage: msg.usage || {} };
}

module.exports = { forCuits, hintText, learn, usable, COL };
