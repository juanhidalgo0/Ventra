import { collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, getDoc, getDocs, setDoc, deleteField, serverTimestamp, query, where } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getVentraDb, getVentraApp } from './ventraFirebase';
import { claimStore, resolveStoreId } from './onlineStore';
import { clientKeyOf, localNow } from './agendaCore';
import { summarize, applyPackSession, mergeIntake, newVideoLink, type Patient, type Consulta, type PatientSummary, type Pack } from './nutriCore';
import { newId, type MealPlan } from './nutriPlan';
import type { Food } from './nutriFoods';

export * from './nutriCore';
export * from './nutriPlan';
export * from './nutriFoods';

/**
 * Consultorio de nutrición (rubro Nutricionista): pacientes en ventra_stores/{id}/nutri_patients
 * y sus consultas en .../nutri_patients/{paciente}/consultas. Solo los ve el dueño (reglas de
 * Firestore). Son datos de salud: viven solo en la nube, no pasan por la base de las PCs.
 * La historia clínica no se borra (el paciente se archiva) y una consulta solo se corrige en
 * las primeras 24 h; después se le agregan notas. Las reglas lo hacen cumplir.
 */

let storeIdPromise: Promise<string> | null = null;
/** El consultorio usa la misma "tienda" de la cuenta que la agenda (sin publicarla): la crea si no existe. */
export function nutriStoreId(): Promise<string> {
  if (!storeIdPromise) {
    storeIdPromise = resolveStoreId().then(async (id) => { await claimStore(id); return id; });
    storeIdPromise.catch(() => { storeIdPromise = null; });
  }
  return storeIdPromise;
}

const patientsCol = (storeId: string) => collection(getVentraDb(), 'ventra_stores', storeId, 'nutri_patients');
const consultasCol = (storeId: string, patientId: string) => collection(getVentraDb(), 'ventra_stores', storeId, 'nutri_patients', patientId, 'consultas');

/** Firestore no acepta undefined: se sacan (también adentro de pliegues y bioimpedancia) y los objetos que quedan vacíos. */
function clean<T extends Record<string, any>>(o: T): T {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue;
    if (v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype) {
      const inner = clean(v);
      if (Object.keys(inner).length) out[k] = inner;
    } else out[k] = v;
  }
  return out as T;
}

/** Con qué cliente de la agenda se cruza el paciente (por teléfono o, si no tiene, por nombre). */
const agendaKeyOf = (p: { name?: string; phone?: string }) => clientKeyOf({ kind: 'booking', customerName: p.name, customerPhone: p.phone }) ?? null;

export function subscribePatients(storeId: string, onChange: (list: Patient[]) => void, onError?: (e: Error) => void) {
  return onSnapshot(patientsCol(storeId), (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
  }, (err) => { console.warn('[Nutri] Error escuchando pacientes:', err.message); onError?.(err); });
}

export function subscribePatient(storeId: string, id: string, onChange: (p: Patient | null) => void) {
  return onSnapshot(doc(patientsCol(storeId), id), (snap) => onChange(snap.exists() ? { id: snap.id, ...(snap.data() as any) } : null),
    (err) => { console.warn('[Nutri] Error escuchando el paciente:', err.message); onChange(null); });
}

type PatientInput = Omit<Patient, 'id' | 'createdAt' | 'updatedAt' | keyof PatientSummary | 'agendaKey'>;

export async function createPatient(storeId: string, p: PatientInput): Promise<string> {
  const ref = await addDoc(patientsCol(storeId), clean({ ...p, name: p.name.trim(), agendaKey: agendaKeyOf(p), visits: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp() }));
  return ref.id;
}

/** Cambia datos de la ficha. Lo que vino vacío se borra (null en el patch). */
export async function updatePatient(storeId: string, p: Patient, patch: Partial<PatientInput>) {
  const next = { ...p, ...patch };
  const data: Record<string, any> = { updatedAt: serverTimestamp() };
  for (const [k, v] of Object.entries(patch)) data[k] = v === undefined || v === '' ? deleteField() : v;
  if ('name' in patch || 'phone' in patch) data.agendaKey = agendaKeyOf(next);
  await updateDoc(doc(patientsCol(storeId), p.id), data);
}

/** La historia clínica se guarda (ley 26.529): un paciente que deja de venir se archiva, no se borra. */
export async function setPatientArchived(storeId: string, id: string, archived: boolean) {
  await updateDoc(doc(patientsCol(storeId), id), { archived: archived || deleteField(), updatedAt: serverTimestamp() });
}

export function subscribeConsultas(storeId: string, patientId: string, onChange: (list: Consulta[]) => void) {
  return onSnapshot(consultasCol(storeId, patientId), (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
  }, (err) => { console.warn('[Nutri] Error escuchando consultas:', err.message); onChange([]); });
}

/** Recalcula el resumen de la ficha (peso, IMC, visitas, próximo control) con todas sus consultas. */
async function refreshSummary(storeId: string, patientId: string) {
  const list = (await getDocs(consultasCol(storeId, patientId))).docs.map((d) => ({ id: d.id, ...(d.data() as any) }) as Consulta);
  const s = summarize(list, localNow().dateKey);
  const keys: (keyof PatientSummary)[] = ['visits', 'firstDate', 'lastVisit', 'nextControl', 'firstWeight', 'lastWeight', 'height', 'bmi'];
  const data: Record<string, any> = { updatedAt: serverTimestamp() };
  for (const k of keys) data[k] = s[k] ?? deleteField();
  await updateDoc(doc(patientsCol(storeId), patientId), data);
}

type ConsultaInput = Omit<Consulta, 'id' | 'createdAt' | 'addenda'>;

/** Una sesión del pack que cubre la consulta: se suma al cargarla y se devuelve al borrarla. */
async function movePackSession(storeId: string, patientId: string, packId: string, delta: 1 | -1) {
  const ref = doc(patientsCol(storeId), patientId);
  const snap = await getDoc(ref);
  const packs = (snap.data()?.packs || []) as Pack[];
  if (!packs.some((k) => k.id === packId)) return;
  await updateDoc(ref, { packs: applyPackSession(packs, packId, delta), updatedAt: serverTimestamp() });
}

export async function createConsulta(storeId: string, patientId: string, c: ConsultaInput): Promise<string> {
  const ref = await addDoc(consultasCol(storeId, patientId), clean({ ...c, createdAt: serverTimestamp() }));
  if (c.coverage?.type === 'pack') await movePackSession(storeId, patientId, c.coverage.packId, 1);
  await refreshSummary(storeId, patientId);
  return ref.id;
}

/** Solo dentro de las 24 h de cargada (las reglas lo rechazan después). Reemplaza lo medido y lo escrito. */
export async function updateConsulta(storeId: string, patientId: string, id: string, c: ConsultaInput, before?: Consulta) {
  const fields: (keyof ConsultaInput)[] = ['dateKey', 'first', 'weight', 'height', 'waist', 'hip', 'arm', 'skinfolds', 'bia', 'progress', 'assessment', 'plan', 'nextControl', 'coverage'];
  const cleaned = clean(c as Record<string, any>);
  const data: Record<string, any> = {};
  for (const k of fields) data[k] = k in cleaned ? cleaned[k] : deleteField();
  await updateDoc(doc(consultasCol(storeId, patientId), id), data);
  // Cambió de pack (o dejó de usar uno): la sesión vuelve al de antes y se descuenta del nuevo
  const was = before?.coverage?.type === 'pack' ? before.coverage.packId : null;
  const now = c.coverage?.type === 'pack' ? c.coverage.packId : null;
  if (was !== now) {
    if (was) await movePackSession(storeId, patientId, was, -1);
    if (now) await movePackSession(storeId, patientId, now, 1);
  }
  await refreshSummary(storeId, patientId);
}

export async function deleteConsulta(storeId: string, patientId: string, c: Consulta) {
  await deleteDoc(doc(consultasCol(storeId, patientId), c.id));
  if (c.coverage?.type === 'pack') await movePackSession(storeId, patientId, c.coverage.packId, -1);
  await refreshSummary(storeId, patientId);
}

/** Nota agregada a una consulta cerrada: queda con su fecha y no se puede cambiar. */
export async function addAddendum(storeId: string, patientId: string, c: Consulta, text: string) {
  const addenda = [...(c.addenda || []), { at: Date.now(), text: text.trim().slice(0, 2000) }];
  await updateDoc(doc(consultasCol(storeId, patientId), c.id), { addenda });
}

// ─── Plan alimentario (ventra_stores/{id}/nutri_patients/{p}/planes) ───

const plansCol = (storeId: string, patientId: string) => collection(getVentraDb(), 'ventra_stores', storeId, 'nutri_patients', patientId, 'planes');

export function subscribePlans(storeId: string, patientId: string, onChange: (list: MealPlan[]) => void) {
  return onSnapshot(plansCol(storeId, patientId), (snap) => {
    onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
  }, (err) => { console.warn('[Nutri] Error escuchando planes:', err.message); onChange([]); });
}

type PlanInput = Omit<MealPlan, 'id' | 'createdAt' | 'updatedAt'>;

/** Guarda el plan. Si queda vigente, los otros vigentes pasan a anteriores (el paciente ve uno solo). */
export async function savePlan(storeId: string, patientId: string, plan: PlanInput, id?: string, others: MealPlan[] = []): Promise<string> {
  const data = clean({ ...plan, updatedAt: serverTimestamp() } as Record<string, any>);
  let planId = id;
  if (planId) await updateDoc(doc(plansCol(storeId, patientId), planId), { ...data, kcalTarget: plan.kcalTarget ?? deleteField(), recommendations: plan.recommendations || deleteField() });
  else planId = (await addDoc(plansCol(storeId, patientId), { ...data, createdAt: serverTimestamp() })).id;
  if (plan.status === 'active') {
    for (const o of others) if (o.id !== planId && o.status === 'active') await updateDoc(doc(plansCol(storeId, patientId), o.id), { status: 'old', updatedAt: serverTimestamp() });
  }
  return planId;
}

export async function deletePlan(storeId: string, patientId: string, id: string) {
  await deleteDoc(doc(plansCol(storeId, patientId), id));
}

// ─── Alimentos y plantillas propias del consultorio ───

const foodsCol = (storeId: string) => collection(getVentraDb(), 'ventra_stores', storeId, 'nutri_foods');
const templatesCol = (storeId: string) => collection(getVentraDb(), 'ventra_stores', storeId, 'nutri_templates');

export function subscribeCustomFoods(storeId: string, onChange: (list: Food[]) => void) {
  return onSnapshot(foodsCol(storeId), (snap) => onChange(snap.docs.map((d) => ({ ...(d.data() as any), id: `own-${d.id}`, custom: true }))),
    () => onChange([]));
}

export async function addCustomFood(storeId: string, f: Omit<Food, 'id' | 'custom'>): Promise<Food> {
  const data = { name: f.name.trim(), group: f.group, k: f.k, p: f.p, c: f.c, f: f.f, measure: f.measure.trim() || '1 porción', grams: f.grams, createdAt: serverTimestamp() };
  const ref = await addDoc(foodsCol(storeId), data);
  return { ...data, id: `own-${ref.id}`, custom: true };
}

export interface OwnTemplate { id: string; title: string; kcal: number; meals: MealPlan['meals']; recommendations?: string }

export function subscribeOwnTemplates(storeId: string, onChange: (list: OwnTemplate[]) => void) {
  return onSnapshot(templatesCol(storeId), (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))), () => onChange([]));
}

/** Guarda un plan como plantilla del consultorio, para usarlo con otros pacientes. */
export async function saveOwnTemplate(storeId: string, t: Omit<OwnTemplate, 'id'>) {
  await addDoc(templatesCol(storeId), clean({ ...t, title: t.title.trim(), createdAt: serverTimestamp() } as Record<string, any>));
}

export async function deleteOwnTemplate(storeId: string, id: string) {
  await deleteDoc(doc(templatesCol(storeId), id));
}

// ─── Portal del paciente (nutri_portal/{token}) ───

/** Dirección del portal: el token va después del # (no viaja en la dirección que piden los navegadores) */
export const portalUrl = (token: string) => `https://tienda.ventra.store/paciente#${token}`;

function randomToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => 'abcdefghijkmnopqrstuvwxyz23456789'[b % 33]).join('');
}

/** El link del portal del paciente: el que ya tiene o uno nuevo (renew: el viejo deja de andar). */
export async function ensurePortalLink(storeId: string, p: Patient, renew = false): Promise<string> {
  if (p.portalToken && !renew) return portalUrl(p.portalToken);
  const db = getVentraDb();
  const uid = getAuth(getVentraApp()).currentUser?.uid;
  if (!uid) throw new Error('Sin sesión en la nube');
  if (p.portalToken && renew) await deleteDoc(doc(db, 'nutri_portal', p.portalToken)).catch(() => {});
  const token = randomToken();
  await setDoc(doc(db, 'nutri_portal', token), { ownerUid: uid, storeId, patientId: p.id, createdAt: serverTimestamp() });
  await updateDoc(doc(patientsCol(storeId), p.id), { portalToken: token, updatedAt: serverTimestamp() });
  return portalUrl(token);
}

/** Pasa la ficha previa que mandó el paciente a su historia clínica y la marca como revisada. */
export async function acceptIntake(storeId: string, p: Patient) {
  if (!p.intake) return;
  await updateDoc(doc(patientsCol(storeId), p.id), {
    history: mergeIntake(p.history, p.intake.data),
    'intake.reviewed': true,
    updatedAt: serverTimestamp(),
  });
}

export async function dismissIntake(storeId: string, p: Patient) {
  await updateDoc(doc(patientsCol(storeId), p.id), { 'intake.reviewed': true, updatedAt: serverTimestamp() });
}

// ─── Packs y cobros del consultorio ───

/** Cobros que no son de un turno (packs): ventra_stores/{id}/nutri_payments. Salen en Cobros. */
export interface NutriPayment { id: string; patientId: string; patientName: string; concept: string; amount: number; method: string; dateKey: string; paidAt: number }

const paymentsCol = (storeId: string) => collection(getVentraDb(), 'ventra_stores', storeId, 'nutri_payments');

export function subscribeNutriPayments(storeId: string, fromKey: string, toKey: string, onChange: (list: NutriPayment[]) => void) {
  const q = query(paymentsCol(storeId), where('dateKey', '>=', fromKey), where('dateKey', '<=', toKey));
  return onSnapshot(q, (snap) => onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))), () => onChange([]));
}

/** Vende un pack de consultas: queda en la ficha (con sus sesiones) y el cobro en Cobros. */
export async function sellPack(storeId: string, p: Patient, pack: Omit<Pack, 'id' | 'used' | 'paidAt'>) {
  const full: Pack = { ...pack, id: newId(), used: 0, paidAt: Date.now() };
  await updateDoc(doc(patientsCol(storeId), p.id), { packs: [...(p.packs || []), full], updatedAt: serverTimestamp() });
  if (pack.price > 0) {
    await addDoc(paymentsCol(storeId), {
      patientId: p.id, patientName: p.name, concept: pack.name, amount: pack.price, method: pack.method, dateKey: pack.dateKey, paidAt: full.paidAt, packId: full.id,
    });
  }
}

/** Saca un pack cargado por error (y su cobro). Solo si todavía no se usó ninguna sesión. */
export async function removePack(storeId: string, p: Patient, packId: string) {
  const pack = (p.packs || []).find((k) => k.id === packId);
  if (!pack || pack.used > 0) return;
  await updateDoc(doc(patientsCol(storeId), p.id), { packs: (p.packs || []).filter((k) => k.id !== packId), updatedAt: serverTimestamp() });
  const pays = await getDocs(query(paymentsCol(storeId), where('packId', '==', packId)));
  for (const d of pays.docs) await deleteDoc(d.ref);
}

// ─── Videollamada y recordatorios ───

/** La sala de videollamada del paciente (la misma para todas sus consultas, salvo que se pida una nueva). */
export async function ensureVideoLink(storeId: string, p: Patient, renew = false): Promise<string> {
  if (p.videoLink && !renew) return p.videoLink;
  const link = newVideoLink();
  await updateDoc(doc(patientsCol(storeId), p.id), { videoLink: link, updatedAt: serverTimestamp() });
  return link;
}

/** Marca que ya se le recordó el control de esa fecha (deja de aparecer en "Para avisar"). */
export async function markReminded(storeId: string, p: Patient) {
  if (!p.nextControl) return;
  await updateDoc(doc(patientsCol(storeId), p.id), { remindedFor: p.nextControl, updatedAt: serverTimestamp() });
}

/** Consultas de un período de todos los pacientes que vinieron (para el informe de obras sociales). */
export async function fetchConsultasBetween(storeId: string, patients: Patient[], fromKey: string, toKey: string): Promise<{ patient: Patient; consulta: Consulta }[]> {
  const out: { patient: Patient; consulta: Consulta }[] = [];
  // Solo los que tuvieron una consulta desde el inicio del período (la ficha guarda la última)
  const candidates = patients.filter((p) => p.lastVisit && p.lastVisit >= fromKey);
  await Promise.all(candidates.map(async (p) => {
    const snap = await getDocs(query(consultasCol(storeId, p.id), where('dateKey', '>=', fromKey), where('dateKey', '<=', toKey)));
    for (const d of snap.docs) out.push({ patient: p, consulta: { id: d.id, ...(d.data() as any) } });
  }));
  return out.sort((a, b) => a.consulta.dateKey.localeCompare(b.consulta.dateKey) || a.patient.name.localeCompare(b.patient.name));
}
