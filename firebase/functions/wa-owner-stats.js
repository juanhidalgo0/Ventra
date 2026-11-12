/**
 * Uso del WhatsApp del dueño, para el panel de admin ("WhatsApp del dueño").
 *
 * Por comercio y por mes (hora argentina) se cuentan los mensajes que llegan y qué se hizo con
 * cada uno: ventra_wa_stats/{AAAA-MM}_{uid}. No se guarda el texto de lo que escriben: solo
 * contadores. El último mensaje de cada teléfono ya queda en ventra_wa_owners, y las preguntas que
 * la IA no supo contestar en ventra_ai_misses.
 */
const admin = require("firebase-admin");

const STATS = "ventra_wa_stats";
const TZ = "America/Argentina/Buenos_Aires";

const monthOf = (now) => new Date(now).toLocaleDateString("en-CA", { timeZone: TZ }).slice(0, 7);
const ms = (t) => (t && typeof t.toMillis === "function" ? t.toMillis() : Number(t) || 0);
const masked = (phone) => { const d = String(phone || ""); return d.length > 4 ? `•••• ${d.slice(-4)}` : d; };
/** Los nombres de los campos van sin puntos ni símbolos (Firestore los toma como rutas) */
const key = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").slice(0, 40);

/**
 * Suma 1 a cada contador del comercio en el mes. Nunca frena la respuesta al dueño:
 * si falla, se pierde ese conteo y listo.
 */
function track(db, uid, fields, now = Date.now()) {
  if (!uid || !fields || !fields.length) return Promise.resolve();
  const inc = admin.firestore.FieldValue.increment(1);
  const month = monthOf(now);
  const data = { uid: String(uid), month, lastAt: now };
  for (const f of fields) if (f) data[key(f)] = inc;
  return db.collection(STATS).doc(`${month}_${uid}`).set(data, { merge: true }).catch(() => {});
}

/** Etiquetas para mostrar los contadores en el panel */
const LABELS = {
  in_question: "Mensajes escritos", in_audio: "Audios", in_image: "Fotos", in_menu: "Menú", in_button: "Botones",
  do_answer: "Preguntas contestadas", do_prices: "Cambios de precios propuestos", do_prices_ok: "Cambios de precios confirmados",
  do_op: "Acciones en el sistema propuestas", do_op_ok: "Acciones confirmadas", do_promo: "Imágenes de promos", do_invoice: "Boletas cargadas por foto",
};

/**
 * Lo que muestra el panel: teléfonos vinculados, uso del mes (y del anterior para comparar)
 * y las preguntas que no supo contestar por WhatsApp en los últimos 30 días.
 */
async function report(db, now = Date.now()) {
  const month = monthOf(now);
  const prevDate = new Date(`${month}-15T12:00:00Z`); prevDate.setUTCMonth(prevDate.getUTCMonth() - 1);
  const prevMonth = prevDate.toISOString().slice(0, 7);
  const [owners, cur, prev, misses] = await Promise.all([
    db.collection("ventra_wa_owners").get(),
    db.collection(STATS).where("month", "==", month).get(),
    db.collection(STATS).where("month", "==", prevMonth).get(),
    db.collection("ventra_ai_misses").where("at", ">=", now - 30 * 864e5).get(),
  ]);
  const byUid = {};
  const shop = (uid) => (byUid[uid] = byUid[uid] || { uid, phones: [], month: {}, prev: 0 });
  owners.forEach((d) => {
    const o = d.data() || {};
    if (!o.uid) return;
    shop(o.uid).phones.push({
      phone: masked(d.id), role: o.role === "SUPERVISOR" ? "SUPERVISOR" : "ADMIN", name: o.name || null,
      linkedAt: ms(o.linkedAt) || null, lastAt: ms(o.lastInboundAt) || ms(o.lastAt) || null,
      questions: Number(o.questions) || 0, summary: !!(o.summary && o.summary.enabled),
    });
  });
  cur.forEach((d) => {
    const s = d.data() || {};
    if (!s.uid) return;
    const counts = {};
    for (const [k, v] of Object.entries(s)) if (typeof v === "number" && k !== "lastAt") counts[k] = v;
    shop(s.uid).month = counts;
  });
  prev.forEach((d) => { const s = d.data() || {}; if (s.uid) shop(s.uid).prev = Number(s.msgs) || 0; });

  // Mails de las cuentas para que el panel muestre de quién es cada fila
  const uids = Object.keys(byUid);
  const accounts = uids.length ? await db.getAll(...uids.map((u) => db.collection("ventra_accounts").doc(u))) : [];
  accounts.forEach((a) => { if (a.exists && byUid[a.id]) { byUid[a.id].email = a.data().email || null; byUid[a.id].plan = a.data().plan || null; } });

  const shops = Object.values(byUid).sort((a, b) => (Number(b.month.msgs) || 0) - (Number(a.month.msgs) || 0)
    || Math.max(0, ...b.phones.map((p) => p.lastAt || 0)) - Math.max(0, ...a.phones.map((p) => p.lastAt || 0)));
  const totals = {};
  for (const s of shops) for (const [k, v] of Object.entries(s.month)) totals[k] = (totals[k] || 0) + v;

  const missList = [];
  misses.forEach((d) => {
    const m = d.data() || {};
    if (m.channel !== "whatsapp") return;
    missList.push({ uid: m.uid || null, email: (byUid[m.uid] && byUid[m.uid].email) || null, question: String(m.question || "").slice(0, 300), reasons: (m.reasons || []).slice(0, 3), at: Number(m.at) || 0 });
  });
  missList.sort((a, b) => b.at - a.at);

  return {
    month, prevMonth, labels: LABELS, totals,
    linkedShops: shops.filter((s) => s.phones.length).length,
    linkedPhones: shops.reduce((n, s) => n + s.phones.length, 0),
    activeShops: shops.filter((s) => Number(s.month.msgs) > 0).length,
    shops, misses: missList.slice(0, 60),
  };
}

module.exports = { track, report, monthOf, STATS, LABELS };
