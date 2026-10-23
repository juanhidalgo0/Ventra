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
      tx.set(ref, { ...best(votesBy), votesBy, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    });
    saved++;
  }
  return { saved };
}

module.exports = { get, confirm, best };
