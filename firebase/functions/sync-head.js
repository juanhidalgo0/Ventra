// ═══════════════════════════════════════════════════
// Último cambio de cada comercio, fuera de Neon.
//
// Las cajas preguntan por cambios de las demás aunque no pase nada (hasta una vez
// por minuto). Si cada pregunta llega a Neon, la base nunca se apaga y el plan se
// consume solo con cajas abiertas. Con este marcador, cuando una caja ya está al
// día la función le responde sin tocar Neon.
//
// ventra_sync_heads/{uid}: { head (último seq), gen (reinicios), checkedAt }
//  - Solo sube (nunca baja): dos subidas en paralelo no lo pueden atrasar.
//  - Se actualiza con cada subida, cada reinicio y cada consulta real a Neon.
//  - Si no se puede actualizar después de subir, se borra: sin marcador las cajas
//    vuelven a preguntarle a Neon, nunca se quedan sin ver un cambio.
//  - Por las dudas, cada comercio consulta Neon de verdad al menos cada RECHECK_MS.
// ═══════════════════════════════════════════════════
const admin = require("firebase-admin");

const RECHECK_MS = 6 * 60 * 60 * 1000;
/** Una consulta real a Neon sin novedades no reescribe el marcador más seguido que esto. */
const CHECKED_WRITE_MS = 60 * 60 * 1000;

const ref = (uid) => admin.firestore().collection("ventra_sync_heads").doc(String(uid));
const millis = (ts) => (ts && ts.toMillis ? ts.toMillis() : 0);

/**
 * Si la caja ya está al día, la respuesta de "pull" sin pasar por Neon; si no, null.
 * Ante cualquier duda (sin marcador, marcador viejo, error) devuelve null y se consulta Neon.
 */
async function idlePull(uid, after) {
  const since = Math.floor(Number(after) || 0);
  if (since <= 0) return null;
  try {
    const snap = await ref(uid).get();
    if (!snap.exists) return null;
    const h = snap.data();
    const head = Number(h.head) || 0;
    if (!head || since < head || Date.now() - millis(h.checkedAt) > RECHECK_MS) return null;
    return { ok: true, gen: Number(h.gen) || 0, rows: [], last: String(after), more: false, head: String(head) };
  } catch {
    return null;
  }
}

/**
 * Sube el marcador (nunca lo baja). `checked`: viene de una consulta real a Neon.
 * Devuelve false si no se pudo guardar.
 */
async function raise(uid, head, gen, checked = false) {
  const h = Number(head) || 0, g = Number(gen) || 0;
  try {
    await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref(uid));
      const cur = snap.exists ? snap.data() : {};
      const next = { head: Math.max(Number(cur.head) || 0, h), gen: Math.max(Number(cur.gen) || 0, g) };
      const same = snap.exists && next.head === cur.head && next.gen === cur.gen;
      const checkedFresh = Date.now() - millis(cur.checkedAt) < CHECKED_WRITE_MS;
      if (same && (!checked || checkedFresh)) return;
      // Un marcador nuevo arranca "comprobado" solo si viene de Neon
      const checkedAt = checked ? admin.firestore.FieldValue.serverTimestamp() : (cur.checkedAt || admin.firestore.Timestamp.fromMillis(0));
      tx.set(ref(uid), { ...next, checkedAt, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    });
    return true;
  } catch (err) {
    console.warn("Ventra marcador de sincronización: no se pudo actualizar", uid, err.message);
    return false;
  }
}

/** Después de escribir en Neon: sube el marcador o, si no se puede, lo borra. */
async function afterWrite(uid, head, gen) {
  if (await raise(uid, head, gen)) return;
  await ref(uid).delete().catch((err) => console.error("Ventra marcador de sincronización: no se pudo borrar", uid, err.message));
}

module.exports = { idlePull, raise, afterWrite, RECHECK_MS };
