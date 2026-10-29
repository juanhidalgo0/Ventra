/**
 * Portal del paciente del consultorio de nutrición (tienda.ventra.store/paciente#<token>).
 * El token (nutri_portal/{token}) lo crea la nutricionista desde la ficha; con él, el paciente
 * ve su plan vigente, su evolución, su próximo control y la videollamada, y completa la ficha
 * previa. Solo sale lo que el paciente puede ver: nada de evaluaciones ni notas clínicas.
 *
 * Y una vez por día: aviso a la nutricionista con los controles de los próximos días, para que
 * se los recuerde con un toque (el WhatsApp automático necesita una plantilla aprobada por Meta).
 */
const { FieldValue } = require("firebase-admin/firestore");
const storeSlugs = require("./store-slugs");

/** Lo que el paciente puede contestar en la ficha previa (mismas claves que la historia clínica) */
const INTAKE_KEYS = ["reason", "pathologies", "medication", "allergies", "intolerances", "physicalActivity", "sleep", "water", "eating", "likes", "dislikes"];
const MAX_TEXT = 2000;

const TZ = "America/Argentina/Buenos_Aires";
const dateKeyOf = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: TZ });
const addDaysKey = (key, n) => { const d = new Date(`${key}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

const pos = (n) => typeof n === "number" && isFinite(n) && n > 0;
const round1 = (n) => Math.round(n * 10) / 10;
const firstName = (name) => String(name || "").trim().split(/\s+/)[0] || "";

class PortalError extends Error { constructor(code, status = 400) { super(code); this.code = code; this.status = status; } }

async function resolve(db, token) {
  if (typeof token !== "string" || !/^[a-z0-9]{20,40}$/.test(token)) throw new PortalError("bad-token", 404);
  const link = await db.collection("nutri_portal").doc(token).get();
  if (!link.exists) throw new PortalError("not-found", 404);
  const { storeId, patientId } = link.data();
  const storeRef = db.collection("ventra_stores").doc(storeId);
  const patientRef = storeRef.collection("nutri_patients").doc(patientId);
  const [store, patient] = await Promise.all([storeRef.get(), patientRef.get()]);
  // El link quedó viejo (se pidió uno nuevo) o el paciente ya no existe
  if (!store.exists || !patient.exists || patient.data().portalToken !== token) throw new PortalError("not-found", 404);
  return { store, patient, patientRef };
}

/** Lo que ve el paciente: su plan vigente, su evolución de peso y cintura, y lo que viene. */
async function view(db, token) {
  const { store, patient, patientRef } = await resolve(db, token);
  const s = store.data() || {};
  const p = patient.data() || {};
  const [plans, consultas] = await Promise.all([patientRef.collection("planes").get(), patientRef.collection("consultas").get()]);
  const active = plans.docs.map((d) => d.data()).filter((x) => x.status === "active")
    .sort((a, b) => (b.updatedAt?.toMillis?.() || 0) - (a.updatedAt?.toMillis?.() || 0))[0] || null;
  let height = null;
  const evolution = consultas.docs.map((d) => d.data())
    .sort((a, b) => String(a.dateKey).localeCompare(String(b.dateKey)))
    .map((c) => {
      if (pos(c.height)) height = c.height;
      const point = { d: c.dateKey };
      if (pos(c.weight)) point.w = c.weight;
      if (pos(c.weight) && pos(height)) point.bmi = round1(c.weight / (height / 100) ** 2);
      if (pos(c.waist)) point.waist = c.waist;
      return point;
    })
    .filter((x) => x.w || x.waist);
  const today = dateKeyOf();
  const logo = typeof s.logoUrl === "string" && /^https:\/\//.test(s.logoUrl) ? s.logoUrl : null;
  return {
    business: { name: s.businessName || "Tu nutricionista", logo, phone: s.whatsappNumber || null, bookingUrl: s.isPublished && s.subdomain ? storeSlugs.publicUrl(s.subdomain, "turnos") : null },
    patient: { firstName: firstName(p.name), goalWeight: pos(p.goalWeight) ? p.goalWeight : null },
    nextControl: p.nextControl && p.nextControl >= today ? p.nextControl : null,
    video: typeof p.videoLink === "string" && /^https:\/\/meet\.jit\.si\//.test(p.videoLink) ? p.videoLink : null,
    plan: active ? {
      title: active.title,
      kcal: pos(active.kcalTarget) ? active.kcalTarget : null,
      meals: (active.meals || []).map((m) => ({
        name: m.name, time: m.time || null, note: m.note || null,
        items: (m.items || []).map((i) => ({ name: i.name, grams: pos(i.grams) ? i.grams : 0, measure: i.measure || null, unitGrams: pos(i.unitGrams) ? i.unitGrams : null })),
      })),
      recommendations: active.recommendations || null,
    } : null,
    evolution,
    // Se pide la ficha hasta que la nutricionista la revisa; después ya no se muestra el formulario
    intake: { done: !!p.intake, reviewed: !!p.intake?.reviewed, data: p.intake && !p.intake.reviewed ? p.intake.data : null },
  };
}

/** Guarda la ficha previa en el paciente (la nutricionista la revisa y la pasa a la historia clínica). */
async function saveIntake(db, token, body) {
  const { store, patient, patientRef } = await resolve(db, token);
  if (patient.data().intake?.reviewed) throw new PortalError("already-reviewed", 409);
  const data = {};
  for (const k of INTAKE_KEYS) {
    const v = body && typeof body[k] === "string" ? body[k].trim().slice(0, MAX_TEXT) : "";
    if (v) data[k] = v;
  }
  if (!Object.keys(data).length) throw new PortalError("empty");
  await patientRef.update({ intake: { at: Date.now(), data }, updatedAt: FieldValue.serverTimestamp() });
  return { ownerUid: store.data().ownerUid || null, storeId: store.id, patientName: patient.data().name || "Un paciente", patientId: patient.id, first: !patient.data().intake };
}

/** HTTP POST { t } para ver, { t, intake } para mandar la ficha previa (el token nunca va en la dirección). */
async function handle(db, req, res, { notifyOwner } = {}) {
  try {
    if (req.method === "POST") {
      const body = req.body || {};
      if (!body.intake) return res.status(200).json(await view(db, String(body.t || "")));
      const saved = await saveIntake(db, String(body.t || ""), body.intake);
      if (saved.ownerUid && notifyOwner) {
        await notifyOwner(saved.ownerUid, {
          title: `${saved.patientName} completó su ficha previa`,
          body: "Revisala y pasala a la historia clínica con un toque.",
          url: `/#/pacientes/${saved.patientId}`,
        }, saved.storeId).catch(() => {});
      }
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: "method" });
  } catch (err) {
    if (err instanceof PortalError) return res.status(err.status).json({ error: err.code });
    console.error("nutriPortal", err);
    return res.status(500).json({ error: "server" });
  }
}

/**
 * Controles de los próximos 2 días por consultorio, sin recordatorio mandado: un aviso por
 * consultorio a la mañana. Devuelve [{ ownerUid, storeId, names: [...] }].
 */
async function controlsDue(db, today = dateKeyOf(), days = 2) {
  const keys = Array.from({ length: days }, (_, i) => addDaysKey(today, i + 1));
  const snap = await db.collectionGroup("nutri_patients").where("nextControl", "in", keys).get();
  const byStore = new Map();
  for (const d of snap.docs) {
    const p = d.data();
    if (p.archived || p.remindedFor === p.nextControl) continue;
    const storeId = d.ref.parent.parent.id;
    if (!byStore.has(storeId)) byStore.set(storeId, []);
    byStore.get(storeId).push({ name: p.name, when: p.nextControl === keys[0] ? "mañana" : "pasado mañana" });
  }
  const out = [];
  for (const [storeId, list] of byStore) {
    const store = await db.collection("ventra_stores").doc(storeId).get();
    const ownerUid = store.exists ? store.data().ownerUid : null;
    if (ownerUid) out.push({ ownerUid, storeId, list });
  }
  return out;
}

function controlsMessage(list) {
  const names = list.slice(0, 4).map((x) => `${firstName(x.name)} (${x.when})`).join(", ") + (list.length > 4 ? ` y ${list.length - 4} más` : "");
  return {
    title: list.length === 1 ? `Control de ${firstName(list[0].name)} ${list[0].when}` : `${list.length} controles en los próximos días`,
    body: `${names}. Recordáselos por WhatsApp con un toque.`,
    url: "/#/pacientes?filtro=avisar",
  };
}

module.exports = { handle, view, saveIntake, controlsDue, controlsMessage, INTAKE_KEYS, PortalError, dateKeyOf, addDaysKey };
