// ═══════════════════════════════════════════════════
// Admin → pestaña Boletas (plan-boletas-ia.md, tandas 2.3 y 8).
// - Avisos "Leyó mal" de los comercios (ventra_invoice_misreads), sin ver primero.
// - Seguimiento: boletas sin tocar por proveedor, renglones corregidos, costo por boleta y los
//   proveedores que peor se leen (de las muestras confirmadas, ventra_invoice_samples).
// Solo lo usa el admin (index.js, ventraAdmin). Nada de esto lo ven los comercios.
// ═══════════════════════════════════════════════════
const samples = require("./invoice-samples");

const DAY = 864e5;

/** Muestras confirmadas → números por proveedor y generales. Pura (la prueba firebase/test). */
function stats(rows) {
  // Una boleta = las hojas confirmadas juntas (mismo comercio, misma confirmación)
  const docs = new Map();
  for (const s of rows) {
    if (!s.confirmed) continue;
    const key = `${s.uid}|${s.confirmedAt}|${s.confirmed.invoiceNumber || ""}`;
    const d = docs.get(key) || { supplier: s.confirmed.supplierName || s.supplierName || s.cuit || "Sin proveedor", cuit: s.cuit || "", untouched: !!s.confirmed.untouched, auto: !!s.confirmed.auto, cost: 0, read: 0, confirmed: (s.confirmed.items || []).length, flagged: false, escalated: false };
    d.cost += Number(s.costUsd) || 0;
    d.read += ((s.read && s.read.items) || []).filter((it) => !String(it.total || "").trim().startsWith("-")).length;
    d.flagged = d.flagged || !!s.flagged;
    d.escalated = d.escalated || (s.models || []).some((m) => /sonnet|opus/.test(m));
    docs.set(key, d);
  }
  const list = [...docs.values()];
  const by = {};
  for (const d of list) {
    const k = d.supplier;
    const b = by[k] = by[k] || { supplier: k, cuit: d.cuit, invoices: 0, untouched: 0, corrected: 0, flagged: 0, escalated: 0, cost: 0 };
    b.invoices++; b.untouched += d.untouched ? 1 : 0; b.flagged += d.flagged ? 1 : 0; b.escalated += d.escalated ? 1 : 0; b.cost += d.cost;
    // Renglones corregidos: aproximado por la diferencia entre lo leído y lo confirmado (si no quedó sin tocar)
    if (!d.untouched) b.corrected += Math.max(1, Math.abs(d.read - d.confirmed));
  }
  const suppliers = Object.values(by).map((b) => ({ ...b, untouchedPct: Math.round((b.untouched / b.invoices) * 100), cost: Math.round(b.cost * 1000) / 1000, costPerInvoice: Math.round((b.cost / b.invoices) * 1000) / 1000 }))
    .sort((a, b) => a.untouchedPct - b.untouchedPct || b.invoices - a.invoices);
  const total = list.length;
  return {
    invoices: total, untouched: list.filter((d) => d.untouched).length, untouchedPct: total ? Math.round((list.filter((d) => d.untouched).length / total) * 100) : null,
    auto: list.filter((d) => d.auto).length, escalatedPct: total ? Math.round((list.filter((d) => d.escalated).length / total) * 100) : null,
    costPerInvoice: total ? Math.round((list.reduce((s, d) => s + d.cost, 0) / total) * 1000) / 1000 : null,
    correctedLines: suppliers.reduce((s, b) => s + b.corrected, 0),
    suppliers,
    // Los que peor se leen: con al menos 2 boletas, menos de la mitad sin tocar
    worst: suppliers.filter((b) => b.invoices >= 2 && b.untouchedPct < 50).slice(0, 8),
  };
}

/** Lo que muestra la pestaña Boletas: avisos "Leyó mal" y el seguimiento de los últimos `days` días */
async function report(db, { days = 30 } = {}) {
  const since = Date.now() - days * DAY;
  const [mis, smp] = await Promise.all([
    db.collection(samples.MISREADS).orderBy("at", "desc").limit(60).get(),
    db.collection(samples.COL).where("confirmedAt", ">", since).limit(3000).get(),
  ]);
  const accounts = new Map();
  const misreads = mis.docs.map((d) => ({ id: d.id, ...d.data() }));
  // El mail de cada comercio para reconocerlo (solo para el admin)
  for (const uid of [...new Set(misreads.map((m) => m.uid))]) {
    const a = await db.collection("ventra_accounts").doc(uid).get().catch(() => null);
    accounts.set(uid, (a && a.exists && (a.data().email || a.data().storeName)) || uid);
  }
  return {
    days,
    misreads: misreads.map((m) => ({ ...m, shop: accounts.get(m.uid) || m.uid })),
    unseen: misreads.filter((m) => !m.seen).length,
    stats: stats(smp.docs.map((d) => d.data())),
  };
}

async function markSeen(db, id) {
  if (!/^[\w-]{6,80}$/.test(String(id || ""))) return { ok: false };
  await db.collection(samples.MISREADS).doc(String(id)).set({ seen: true, seenAt: Date.now() }, { merge: true });
  return { ok: true };
}

module.exports = { report, markSeen, stats };
