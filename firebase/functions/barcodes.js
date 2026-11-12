// ═══════════════════════════════════════════════════
// Catálogo compartido de códigos de barras (ventraBarcodes), para todos los comercios de Ventra.
//
// Cuando un dueño confirma un producto (lo dejó como estaba o lo editó en la revisión, o lo
// cargó él mismo desde la caja), su PC manda el código con el nombre y la foto (un enlace, no la
// foto guardada). Cada comercio vota una vez por código: gana el nombre y la foto que más
// comercios confirmaron, así un dato equivocado de uno no le pisa el bueno a los demás.
// La PC lo pide antes que a los supermercados (ver apps/backend shared-catalog.service).
//
// ventra_barcodes/{código}: { name, imageUrl, votes, total, votesBy: { uid: { name, imageUrl, at } } }
// Solo lo leen y escriben las funciones (las reglas no lo exponen).
// ═══════════════════════════════════════════════════
const admin = require("firebase-admin");

const BARCODE = /^\d{8,14}$/;
const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/** El nombre y la foto con más votos (un voto por comercio) */
function best(votesBy) {
  const names = new Map();
  const images = new Map();
  for (const v of Object.values(votesBy || {})) {
    if (v.name) { const k = norm(v.name); const cur = names.get(k) || { value: v.name, n: 0 }; cur.n++; names.set(k, cur); }
    if (v.imageUrl) { const cur = images.get(v.imageUrl) || { value: v.imageUrl, n: 0 }; cur.n++; images.set(v.imageUrl, cur); }
  }
  const top = (m) => [...m.values()].sort((a, b) => b.n - a.n)[0] || null;
  const n = top(names);
  const i = top(images);
  return { name: n ? n.value : null, imageUrl: i ? i.value : null, votes: Math.max(n ? n.n : 0, i ? i.n : 0), total: Object.keys(votesBy || {}).length };
}

async function get(db, barcodes) {
  const list = (Array.isArray(barcodes) ? barcodes : []).map(String).filter((b) => BARCODE.test(b)).slice(0, 50);
  const snaps = list.length ? await db.getAll(...list.map((b) => db.collection("ventra_barcodes").doc(b))) : [];
  const items = {};
  snaps.forEach((s) => { if (s.exists) { const d = s.data(); items[s.id] = { name: d.name || null, imageUrl: d.imageUrl || null, votes: d.votes || 0 }; } });
  return { items };
}

async function confirm(db, uid, rawItems) {
  const items = (Array.isArray(rawItems) ? rawItems : []).slice(0, 50).map((i) => ({
    barcode: String(i && i.barcode || "").trim(),
    name: String(i && i.name || "").trim().slice(0, 120) || null,
    imageUrl: /^https:\/\//.test(String(i && i.imageUrl || "")) ? String(i.imageUrl).slice(0, 500) : null,
  })).filter((i) => BARCODE.test(i.barcode) && (i.name || i.imageUrl));
  let saved = 0;
  for (const it of items) {
    const ref = db.collection("ventra_barcodes").doc(it.barcode);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const votesBy = { ...(snap.exists ? snap.data().votesBy || {} : {}) };
      const prev = votesBy[uid] || {};
      // El voto de este comercio se actualiza (si editó el nombre, cuenta el último); la foto se conserva si no mandó otra
      votesBy[uid] = { name: it.name || prev.name || null, imageUrl: it.imageUrl || prev.imageUrl || null, at: Date.now() };
      const b = best(votesBy);
      // words: índice por palabras del nombre, para buscar por nombre (tanda 7.1 de boletas)
      tx.set(ref, { ...b, words: indexKeys(b.name), votesBy, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    });
    saved++;
  }
  return { saved };
}

// ─── Buscar por nombre (plan-boletas-ia.md, tanda 7.1) ───
// Un producto nuevo de una boleta que no trae código de barras: se busca su nombre en este catálogo
// para proponer el código. Siempre es una sugerencia que el dueño confirma con un toque, nunca solo.
const STOP = new Set(["de", "la", "el", "con", "sin", "por", "para", "los", "las", "del", "x", "un", "una"]);
/** Palabras del nombre para el índice: sin acentos, de 3 letras o más, y los números (tamaños). Pura. */
function nameWords(name) {
  const w = norm(name).replace(/(\d),(\d)/g, "$1.$2").replace(/(\d)([a-z])/g, "$1 $2").replace(/[^a-z0-9. ]/g, " ").split(/\s+/)
    .map((x) => x.replace(/^\.+|\.+$/g, "")).filter((x) => x && !STOP.has(x) && (x.length >= 3 || /^\d/.test(x)));
  return [...new Set(w)].slice(0, 20);
}
/** Lo que se guarda en el índice: las palabras y el principio de cada una ("p:alfa"), así una boleta que dice "ALF." encuentra "alfajor". Pura. */
function indexKeys(name) {
  const w = nameWords(name);
  return [...new Set([...w, ...w.filter((x) => !/^\d/.test(x)).map((x) => `p:${x.slice(0, 3)}`)])].slice(0, 40);
}
/** Qué tan parecido es un nombre a otro: palabras en común (abreviadas también) y los mismos números. Pura. */
function similarity(a, b) {
  const wa = nameWords(a), wb = nameWords(b);
  if (!wa.length || !wb.length) return 0;
  const nums = (ws) => ws.filter((x) => /^\d/.test(x)).sort().join(",");
  const text = (ws) => ws.filter((x) => !/^\d/.test(x));
  const ta = text(wa), tb = text(wb);
  const hit = ta.filter((x) => tb.some((y) => y === x || (Math.min(x.length, y.length) >= 3 && (y.startsWith(x) || x.startsWith(y))))).length;
  const base = hit / Math.max(ta.length, tb.length, 1);
  return nums(wa) === nums(wb) ? base + 0.15 : nums(wa) && nums(wb) ? base - 0.5 : base;
}
/** names: los nombres de la boleta → por cada uno, hasta 3 { barcode, name, votes, score } */
async function search(db, names) {
  const list = (Array.isArray(names) ? names : []).map((n) => String(n || "").slice(0, 120)).slice(0, 40);
  const results = [];
  for (const name of list) {
    // Las 2 palabras más largas (las que más distinguen) buscan candidatos en el índice
    const keys = nameWords(name).filter((x) => !/^\d/.test(x)).sort((a, b) => b.length - a.length).slice(0, 2).map((x) => `p:${x.slice(0, 3)}`);
    const found = new Map();
    for (const k of keys) {
      const snap = await db.collection("ventra_barcodes").where("words", "array-contains", k).limit(40).get().catch(() => ({ docs: [] }));
      for (const d of snap.docs) found.set(d.id, d.data());
    }
    results.push([...found.entries()].map(([barcode, d]) => ({ barcode, name: d.name || "", votes: d.votes || 0, score: Math.round(similarity(name, d.name) * 100) / 100 }))
      .filter((x) => x.score >= 0.6).sort((a, b) => b.score - a.score || b.votes - a.votes).slice(0, 3));
  }
  return { results };
}

module.exports = { get, confirm, best, search, nameWords, indexKeys, similarity };
