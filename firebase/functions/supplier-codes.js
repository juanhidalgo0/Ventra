// ═══════════════════════════════════════════════════
// Mapa compartido entre comercios (plan-boletas-ia.md, tanda 3): código interno de un proveedor →
// código de barras del producto. Lo que asoció un comercio le sirve al próximo que compra a ese
// proveedor, sin que el error de uno contagie a los demás.
//
// ventra_supplier_codes/{cuit}_{código}: { cuit, code, barcode, name, unitsPerPack, votes, rivals,
//   votesBy: { uid: { barcode, name, unitsPerPack, at } } }
// - Se alimenta al confirmar una compra (la PC manda lo que asoció), solo con CUIT válido y un
//   código de barras de verdad. Un voto por comercio: si corrige, cuenta lo último.
// - Al leer una boleta: 2 o más comercios coinciden y nadie dice otra cosa → se asocia solo ("alta").
//   Un solo comercio → sugerencia (queda dudoso). Comercios que no coinciden → dudoso ("contradice").
// - Nunca precios ni cantidades de compra: solo código, código de barras, nombre y unidades por bulto.
// Solo lo leen y escriben las funciones (las reglas no lo exponen). Va por ventraBarcodes.
// ═══════════════════════════════════════════════════
const COL = "ventra_supplier_codes";
const BARCODE = /^\d{8,14}$/;
const digits = (s) => String(s || "").replace(/\D/g, "");
const validCuit = (c) => /^(20|23|24|25|26|27|30|33|34)\d{9}$/.test(c);
/** El código del proveedor como clave: sin espacios, puntos ni guiones ni ceros adelante (igual que codeKey de la caja) */
const codeKey = (s) => String(s || "").toUpperCase().replace(/[\s.\-_/]/g, "").replace(/^0+/, "").replace(/[^A-Z0-9]/g, "").slice(0, 40);

/** Dígito verificador de un EAN/UPC (8, 12, 13 o 14 dígitos). Pura. */
function validEan(code) {
  if (!BARCODE.test(code) || ![8, 12, 13, 14].includes(code.length)) return false;
  const d = code.split("").map(Number);
  const check = d.pop();
  const sum = d.reverse().reduce((s, n, i) => s + n * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

/** Los votos → el código de barras que más comercios dijeron, cuántos y cuántos dijeron otro. Pura. */
function tally(votesBy) {
  const by = new Map();
  for (const v of Object.values(votesBy || {})) {
    if (!v || !v.barcode) continue;
    const cur = by.get(v.barcode) || { barcode: v.barcode, n: 0, names: new Map(), upps: new Map() };
    cur.n++;
    if (v.name) cur.names.set(v.name, (cur.names.get(v.name) || 0) + 1);
    if (Number(v.unitsPerPack) > 0) cur.upps.set(Number(v.unitsPerPack), (cur.upps.get(Number(v.unitsPerPack)) || 0) + 1);
    by.set(v.barcode, cur);
  }
  const ranked = [...by.values()].sort((a, b) => b.n - a.n);
  const top = ranked[0];
  if (!top) return { barcode: null, name: null, unitsPerPack: null, votes: 0, rivals: 0 };
  const most = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    barcode: top.barcode, name: (most(top.names) || [null])[0], unitsPerPack: (most(top.upps) || [null])[0],
    votes: top.n, rivals: ranked.slice(1).reduce((s, r) => s + r.n, 0),
  };
}

/** Qué tan seguro es: "alta" (2+ coinciden, nadie en contra), "sugerencia" (uno solo) o "contradice". Pura. */
function confidence(t) {
  if (!t || !t.barcode) return null;
  if (t.rivals > 0) return "contradice";
  return t.votes >= 2 ? "alta" : "sugerencia";
}

/** La caja pide los códigos de una boleta que no encontró: { items: { [código]: { barcode, name, unitsPerPack, votes, confidence } } } */
async function get(db, uid, rawCuit, codes) {
  const cuit = digits(rawCuit);
  if (!validCuit(cuit)) return { items: {} };
  const keys = [...new Set((Array.isArray(codes) ? codes : []).map(codeKey).filter(Boolean))].slice(0, 200);
  if (!keys.length) return { items: {} };
  const refs = keys.map((k) => db.collection(COL).doc(`${cuit}_${k}`));
  const snaps = typeof db.getAll === "function" ? await db.getAll(...refs) : await Promise.all(refs.map((r) => r.get()));
  const items = {};
  snaps.forEach((s, i) => {
    if (!s.exists) return;
    const t = tally(s.data().votesBy);
    if (!t.barcode) return;
    items[keys[i]] = { barcode: t.barcode, name: t.name, unitsPerPack: t.unitsPerPack, votes: t.votes, rivals: t.rivals, confidence: confidence(t), mine: !!(s.data().votesBy || {})[uid] };
  });
  return { items };
}

/**
 * Lo que confirmó un comercio en una compra: [{ code, barcode, name, unitsPerPack }]. Solo con CUIT
 * válido, código del proveedor que no sea él mismo un código de barras, y código de barras de verdad.
 */
async function confirm(db, uid, rawCuit, rawItems) {
  const cuit = digits(rawCuit);
  if (!validCuit(cuit)) return { saved: 0 };
  const items = (Array.isArray(rawItems) ? rawItems : []).slice(0, 200).map((i) => ({
    code: codeKey(i && i.code), barcode: digits(i && i.barcode),
    name: String((i && i.name) || "").trim().slice(0, 120) || null, unitsPerPack: Math.max(0, Math.min(1000, Math.round(Number(i && i.unitsPerPack) || 0))) || null,
  })).filter((i) => i.code && i.code !== i.barcode && !validEan(i.code) && validEan(i.barcode));
  let saved = 0;
  for (const it of items) {
    const ref = db.collection(COL).doc(`${cuit}_${it.code}`);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const votesBy = { ...(snap.exists ? snap.data().votesBy || {} : {}) };
      votesBy[uid] = { barcode: it.barcode, name: it.name, unitsPerPack: it.unitsPerPack, at: Date.now() };
      const t = tally(votesBy);
      tx.set(ref, { cuit, code: it.code, ...t, votesBy, updatedAt: Date.now() });
    });
    saved++;
  }
  return { saved };
}

module.exports = { get, confirm, tally, confidence, codeKey, validEan, COL };
