// ═══════════════════════════════════════════════════
// Muestras de boletas (plan-boletas-ia.md, tanda 1.1): cada foto leída queda guardada con lo que
// leyó la IA y, cuando el comercio confirma la compra, con lo que quedó de verdad. Ese resultado
// confirmado es la respuesta correcta para medir el lector (tanda 2) sin adivinar.
//
// - Foto: Storage invoice_samples/{uid}/{id}.jpg (la foto achicada que ya se mandó a leer).
// - Documento: ventra_invoice_samples/{id}: { uid, cuit, supplierName, invoiceNumber, read, models,
//   verified, closes, reread, storagePath, at, confirmed: null | { ...renglones finales }, confirmedAt }.
// - Nadie de afuera lo ve: las reglas de Firestore y de Storage no lo exponen (solo funciones y admin).
// - Interruptor: ventra_config/invoiceSamples { enabled: bool, uids: [uid] }. Sin ese documento no se
//   guarda nada. "uids" prende solo esas cuentas (la del dueño de Ventra) mientras no se actualicen
//   los términos para avisar a los clientes que se guardan las fotos.
// ═══════════════════════════════════════════════════
const crypto = require("crypto");

const COL = "ventra_invoice_samples";
const PREFIX = "invoice_samples/";
const CACHE_MS = 60 * 1000;
let cache = { at: 0, cfg: null };

/** ¿Se guardan las muestras de este comercio? Apagado si no hay configuración o falla la lectura. */
async function enabled(db, uid) {
  if (!db || !uid) return false;
  if (!cache.cfg || Date.now() - cache.at > CACHE_MS) {
    let cfg = { enabled: false, uids: [] };
    try {
      const snap = await db.collection("ventra_config").doc("invoiceSamples").get();
      if (snap.exists) {
        const d = snap.data() || {};
        cfg = { enabled: d.enabled === true, uids: Array.isArray(d.uids) ? d.uids.map(String) : [] };
      }
    } catch { /* sin configuración: apagado */ }
    cache = { at: Date.now(), cfg };
  }
  return cache.cfg.enabled || cache.cfg.uids.includes(String(uid));
}
/** Solo para las pruebas */
const resetCache = () => { cache = { at: 0, cfg: null }; };

const digits = (s) => String(s || "").replace(/\D/g, "");
const str = (s, n) => String(s == null ? "" : s).slice(0, n);

/** Lo que se guarda de una lectura: los datos de la boleta y los renglones (sin el texto crudo largo). Pura. */
function readSummary(read) {
  const r = read || {};
  return {
    supplierName: str(r.supplierName, 120), supplierCuit: str(r.supplierCuit, 20), invoiceNumber: str(r.invoiceNumber, 40), date: str(r.date, 20),
    docType: str(r.docType, 20), pageNumber: Number(r.pageNumber) || 0, pageCount: Number(r.pageCount) || 0,
    totalFacturaAPagar: str(r.totalFacturaAPagar, 30), subtotalNeto: str(r.subtotalNeto, 30), ivaTotal: str(r.ivaTotal, 30), otrosImpuestos: str(r.otrosImpuestos, 30), impuestosInternos: str(r.impuestosInternos, 30),
    condicionVenta: str(r.condicionVenta, 30), precios: str(r.precios, 20), fotoLegible: str(r.fotoLegible, 20), photoIssue: str(r.photoIssue, 200),
    verified: r.verified || null, reread: !!r.reread,
    rawTableTranscription: str(r.rawTableTranscription, 20000),
    items: (Array.isArray(r.items) ? r.items : []).slice(0, 300).map((it) => ({
      sku: str(it.sku, 40), barcode: str(it.barcode, 20), name: str(it.name, 200), packageQuantity: Number(it.packageQuantity) || 0,
      unitsPerPack: Number(it.unitsPerPack) || 0, unitPrice: str(it.unitPrice, 30), total: str(it.total, 30), handPrice: str(it.handPrice, 20),
      lineOk: it.lineOk === undefined ? null : it.lineOk, unsure: !!it.unsure,
    })),
  };
}

/**
 * Guarda la foto y la lectura. Devuelve el id de la muestra, o null si no se guardó (apagado, sin
 * Storage, foto que no es imagen o error: guardar una muestra nunca frena la lectura).
 * image: { mediaType, data(base64) } o el bloque de imagen de Claude ({ source: { media_type, data } }).
 */
async function save({ db, bucket, logger }, uid, image, read, info = {}) {
  try {
    if (!bucket || !(await enabled(db, uid))) return null;
    const src = image && image.source ? image.source : image || {};
    const data = String(src.data || "").replace(/^data:[^,]+,/, "");
    const mediaType = String(src.media_type || src.mediaType || "image/jpeg").toLowerCase();
    if (!data || !/^image\/(jpeg|png|webp)$/.test(mediaType)) return null;
    const id = `${Date.now()}_${crypto.randomBytes(5).toString("hex")}`;
    const ext = mediaType === "image/png" ? "png" : mediaType === "image/webp" ? "webp" : "jpg";
    const storagePath = `${PREFIX}${uid}/${id}.${ext}`;
    await bucket.file(storagePath).save(Buffer.from(data, "base64"), { contentType: mediaType, resumable: false, metadata: { cacheControl: "private, max-age=0" } });
    const r = read || {};
    await db.collection(COL).doc(id).set({
      uid: String(uid), cuit: digits(r.supplierCuit), supplierName: str(r.supplierName, 120), invoiceNumber: str(r.invoiceNumber, 40),
      read: readSummary(r), models: [...new Set((info.models || []).map(String))], costUsd: Number(info.costUsd) || 0,
      verified: r.verified || null, reread: !!r.reread, failed: !!(r.error || !(r.items || []).length), error: str(r.error, 200),
      qr: r.qr || null, storagePath, at: Date.now(), confirmed: null, confirmedAt: null,
    });
    return id;
  } catch (err) {
    if (logger) logger.warn(`Muestra de boleta sin guardar (${uid}): ${err && err.message}`);
    return null;
  }
}

/**
 * La compra se confirmó: lo que quedó de cada renglón es la respuesta correcta de sus muestras.
 * Solo toca muestras de este comercio. body: { sampleIds: [], confirmed: { supplierCuit, invoiceNumber,
 * date, total, docType, items: [{ name, code, barcode, quantity, unitsPerPack, cost, productId, isNew, removed }] } }
 */
async function confirm(db, uid, body) {
  const ids = [...new Set((Array.isArray(body && body.sampleIds) ? body.sampleIds : []).map(String).filter((s) => /^[\w-]{6,60}$/.test(s)))].slice(0, 60);
  if (!ids.length) return { updated: 0 };
  const c = (body && body.confirmed) || {};
  const confirmed = {
    supplierCuit: digits(c.supplierCuit).slice(0, 11), supplierName: str(c.supplierName, 120), invoiceNumber: str(c.invoiceNumber, 40), date: str(c.date, 20),
    total: Number(c.total) || 0, docType: str(c.docType, 20), auto: !!c.auto, untouched: !!c.untouched,
    items: (Array.isArray(c.items) ? c.items : []).slice(0, 300).map((it) => ({
      name: str(it.name, 200), code: str(it.code, 40), barcode: str(it.barcode, 20), quantity: Number(it.quantity) || 0,
      unitsPerPack: Number(it.unitsPerPack) || 0, cost: Number(it.cost) || 0, buyFormat: str(it.buyFormat, 10),
      productId: str(it.productId, 60), productName: str(it.productName, 200), isNew: !!it.isNew,
    })),
  };
  let updated = 0;
  for (const id of ids) {
    const ref = db.collection(COL).doc(id);
    const snap = await ref.get().catch(() => null);
    if (!snap || !snap.exists || snap.data().uid !== String(uid)) continue;
    await ref.set({ confirmed, confirmedAt: Date.now() }, { merge: true });
    updated++;
  }
  return { updated };
}

module.exports = { enabled, save, confirm, readSummary, resetCache, COL, PREFIX };
