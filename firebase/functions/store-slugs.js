// ═══════════════════════════════════════════════════
// Dirección única de cada tienda online (tienda.ventra.store/<dirección>)
//
// Antes la tienda pública buscaba "la primera tienda con esa dirección": cualquiera con
// una sesión de Firebase (hasta una anónima) podía crear otra tienda con la dirección de
// un comercio real y, como el resultado sale ordenado por id, la suya aparecía primero:
// con su alias de transferencia y su WhatsApp.
//
// Ahora cada dirección queda registrada en ventra_store_slugs/{dirección} = { storeId }.
// Lo escribe solo esta función (las reglas no dejan a nadie más): la primera tienda que
// usa una dirección la conserva mientras la siga usando; si otra la pone, se la saca y
// queda sin publicar. La tienda pública y la vista previa resuelven por este registro.
// Funciona con las versiones del POS ya instaladas (no tienen que escribir nada nuevo).
// ═══════════════════════════════════════════════════
const admin = require("firebase-admin");
const logger = require("firebase-functions/logger");

const SLUGS = "ventra_store_slugs";
const STORES = "ventra_stores";
const SLUG_RE = /^[a-z0-9-]{2,60}$/;

const slugOf = (data) => {
  const s = data && typeof data.subdomain === "string" ? data.subdomain.trim().toLowerCase() : "";
  return SLUG_RE.test(s) ? s : "";
};

// Las reglas obligan a que createdAt sea la hora del servidor al crear y que no cambie
// después. Las tiendas de antes de esa regla que no la tienen son, justamente, las viejas.
const createdMs = (doc) => {
  const t = doc.data().createdAt;
  return t && t.toMillis ? t.toMillis() : 0;
};

/**
 * Reserva `slug` para `storeId` si está libre (o si la tienda que lo tenía ya no lo usa).
 * Devuelve false si lo usa otra tienda.
 */
async function claim(db, slug, storeId) {
  const ref = db.collection(SLUGS).doc(slug);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const owner = snap.exists ? snap.data().storeId : null;
    if (owner === storeId) return true;
    if (owner) {
      const other = await tx.get(db.collection(STORES).doc(owner));
      if (other.exists && other.data().claimed === true && slugOf(other.data()) === slug) return false;
    } else {
      // Dirección sin registrar (tiendas de antes del registro): la conserva la tienda que ya
      // la usaba, la más antigua. Así un impostor no se la queda por escribir primero.
      const users = await tx.get(db.collection(STORES).where("claimed", "==", true).where("subdomain", "==", slug).limit(10));
      const others = users.docs.filter((d) => d.id !== storeId);
      if (others.length) {
        const self = users.docs.find((d) => d.id === storeId);
        const winner = [...others, ...(self ? [self] : [])].sort((a, b) => createdMs(a) - createdMs(b))[0];
        if (winner.id !== storeId) {
          tx.set(ref, { storeId: winner.id, at: admin.firestore.FieldValue.serverTimestamp() });
          return false;
        }
      }
    }
    tx.set(ref, { storeId, at: admin.firestore.FieldValue.serverTimestamp() });
    return true;
  });
}

/** Cada cambio de una tienda: registra su dirección nueva y libera la anterior. */
async function onStoreWritten(db, storeId, before, after) {
  const prev = slugOf(before);
  const next = after && after.claimed === true ? slugOf(after) : "";

  if (next && !(await claim(db, next, storeId))) {
    // Otra tienda ya tiene esa dirección: esta la pierde y queda sin publicar
    await db.collection(STORES).doc(storeId).update({
      subdomain: "",
      isPublished: false,
      slugConflict: next,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    logger.warn(`Ventra tienda: ${storeId} intentó usar la dirección "${next}", que ya es de otra tienda`, { ownerUid: after.ownerUid || null });
    return;
  }

  if (prev && prev !== next) {
    const ref = db.collection(SLUGS).doc(prev);
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (snap.exists && snap.data().storeId === storeId) tx.delete(ref);
    });
  }
}

/**
 * La tienda que corresponde a una dirección, o null. Primero el registro; si la dirección
 * todavía no está registrada (tiendas de antes de esto), se acepta solo si hay UNA tienda
 * con esa dirección: con dos, no se muestra ninguna (nunca la de un impostor).
 */
async function findBySlug(db, slug) {
  if (!SLUG_RE.test(String(slug || ""))) return null;
  const reg = await db.collection(SLUGS).doc(slug).get();
  if (reg.exists) {
    const doc = await db.collection(STORES).doc(String(reg.data().storeId)).get();
    return doc.exists && doc.data().claimed === true && slugOf(doc.data()) === slug ? doc : null;
  }
  const snap = await db.collection(STORES).where("claimed", "==", true).where("subdomain", "==", slug).limit(2).get();
  return snap.size === 1 ? snap.docs[0] : null;
}

module.exports = { onStoreWritten, findBySlug, claim, slugOf, SLUGS, SLUG_RE };
