// ═══════════════════════════════════════════════════
// Uso de la nube por comercio, para estimar cuánto cuesta cada cliente.
//
// Cada función suma contadores en memoria (track) y cada ~60 s los vuelca a
// Firestore con incrementos: ventra_usage/{AAAA-MM}_{uid}. Así una caja que
// sincroniza cada pocos segundos no genera una escritura por llamada.
// Si la instancia se apaga antes de volcar se pierde ese minuto: son estimaciones.
//
// Contadores:
//  syncCalls, cloudSyncCalls (de la caja en la nube, pesan en fly.io),
//  neonCalls (las que llegaron a Neon), idlePulls (respondidas sin despertar Neon),
//  pushRows, pullRows, imgUpBytes, imgDownBytes, panelCalls, storeViews
// ═══════════════════════════════════════════════════
const admin = require("firebase-admin");

const FLUSH_MS = 60 * 1000;
const TZ = "America/Argentina/Buenos_Aires";
let buffer = {};
let lastFlush = Date.now();

const monthKey = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 7);

function track(uid, fields) {
  if (!uid) return;
  const b = (buffer[uid] = buffer[uid] || {});
  for (const [k, v] of Object.entries(fields)) {
    const n = Number(v) || 0;
    if (n) b[k] = (b[k] || 0) + n;
  }
}

/** Vuelca lo acumulado si pasó más de un minuto (o siempre, con force). Nunca tira error. */
async function flush(force = false) {
  if (!force && Date.now() - lastFlush < FLUSH_MS) return;
  const pending = buffer;
  buffer = {};
  lastFlush = Date.now();
  const uids = Object.keys(pending);
  if (!uids.length) return;
  const db = admin.firestore();
  const month = monthKey();
  const inc = admin.firestore.FieldValue.increment;
  const batch = db.batch();
  for (const uid of uids) {
    const data = { uid, month, updatedAt: admin.firestore.FieldValue.serverTimestamp() };
    for (const [k, v] of Object.entries(pending[uid])) data[k] = inc(v);
    batch.set(db.collection("ventra_usage").doc(`${month}_${uid}`), data, { merge: true });
  }
  try {
    await batch.commit();
  } catch (err) {
    console.warn("Ventra uso: no se pudo guardar", err.message);
  }
}

/** Uso del mes por comercio: { uid: { syncCalls, ... } } */
async function monthUsage(month) {
  const snap = await admin.firestore().collection("ventra_usage").where("month", "==", month).get();
  const out = {};
  snap.forEach((d) => {
    const { uid, month: _m, updatedAt: _u, ...counters } = d.data();
    out[uid] = counters;
  });
  return out;
}

/** Bytes de fotos de productos en Storage por comercio (tenants/{uid}/...). */
async function storageBytesByTenant() {
  // De a una página y pidiendo solo nombre y tamaño: con miles de fotos, traer todo junto agotaba la memoria
  const bucket = admin.storage().bucket();
  const out = {};
  let query = { prefix: "tenants/", autoPaginate: false, maxResults: 1000, fields: "items(name,size),nextPageToken" };
  while (query) {
    const [files, next] = await bucket.getFiles(query);
    files.forEach((f) => {
      const uid = f.name.split("/")[1];
      if (uid) out[uid] = (out[uid] || 0) + Number(f.metadata.size || 0);
    });
    query = next || null;
  }
  return out;
}

/**
 * Reparte el costo mensual de cada servicio entre los comercios según su uso.
 *  - Neon: mitad por datos guardados, mitad por las consultas que llegaron a la base.
 *  - Firebase: 70 % por llamadas (sync + panel + tienda), 30 % por fotos guardadas.
 *  - fly.io: por uso de la caja en la nube; si nadie la usó, se reparte entre los que la tienen.
 *  - Otros (dominio, ARCA, varios): parejo entre las cuentas activas.
 * `tenants`: [{ uid, active, cloudBytes, storageBytes, hasCloudBox, usage }]
 */
function allocate(costs, tenants) {
  // Si nadie tuvo uso de algo, esa parte se reparte parejo entre las cuentas activas
  const actives = tenants.filter((t) => t.active).length;
  const even = (t) => (actives ? (t.active ? 1 / actives : 0) : 1 / (tenants.length || 1));
  const share = (list, weight) => {
    const total = list.reduce((s, t) => s + weight(t), 0);
    return (t) => (total > 0 ? weight(t) / total : even(t));
  };
  const calls = (t) => (t.usage.syncCalls || 0) + (t.usage.panelCalls || 0) + (t.usage.storeViews || 0);
  const neonData = share(tenants, (t) => t.cloudBytes || 0);
  // Antes de medir neonCalls se usaban todas las sincronizaciones
  const neonCalls = share(tenants, (t) => (t.usage.neonCalls != null ? t.usage.neonCalls : t.usage.syncCalls) || 0);
  const fbCalls = share(tenants, calls);
  const fbStorage = share(tenants, (t) => t.storageBytes || 0);
  const flyUse = share(tenants, (t) => t.usage.cloudSyncCalls || 0);
  const flyHas = share(tenants, (t) => (t.hasCloudBox ? 1 : 0));
  const anyFly = tenants.some((t) => t.usage.cloudSyncCalls);
  const activeShare = even;

  const c = { neon: Number(costs.neon) || 0, firebase: Number(costs.firebase) || 0, fly: Number(costs.fly) || 0, other: Number(costs.other) || 0 };
  const out = {};
  tenants.forEach((t) => {
    const parts = {
      neon: c.neon * (0.5 * neonData(t) + 0.5 * neonCalls(t)),
      firebase: c.firebase * (0.7 * fbCalls(t) + 0.3 * fbStorage(t)),
      fly: c.fly * (anyFly ? flyUse(t) : flyHas(t)),
      other: c.other * activeShare(t),
    };
    out[t.uid] = { ...parts, total: parts.neon + parts.firebase + parts.fly + parts.other };
  });
  return out;
}

module.exports = { track, flush, monthUsage, storageBytesByTenant, allocate, monthKey };
