import { collection, doc, onSnapshot, addDoc, updateDoc, deleteDoc, getDocs, deleteField, serverTimestamp } from 'firebase/firestore';
import { getVentraDb } from './ventraFirebase';
import { claimStore, resolveStoreId } from './onlineStore';
import { clientKeyOf, localNow } from './agendaCore';
import { summarize, type Patient, type Consulta, type PatientSummary } from './nutriCore';

export * from './nutriCore';

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

export async function createConsulta(storeId: string, patientId: string, c: ConsultaInput): Promise<string> {
  const ref = await addDoc(consultasCol(storeId, patientId), clean({ ...c, createdAt: serverTimestamp() }));
  await refreshSummary(storeId, patientId);
  return ref.id;
}

/** Solo dentro de las 24 h de cargada (las reglas lo rechazan después). Reemplaza lo medido y lo escrito. */
export async function updateConsulta(storeId: string, patientId: string, id: string, c: ConsultaInput) {
  const fields: (keyof ConsultaInput)[] = ['dateKey', 'first', 'weight', 'height', 'waist', 'hip', 'arm', 'skinfolds', 'bia', 'progress', 'assessment', 'plan', 'nextControl'];
  const cleaned = clean(c as Record<string, any>);
  const data: Record<string, any> = {};
  for (const k of fields) data[k] = k in cleaned ? cleaned[k] : deleteField();
  await updateDoc(doc(consultasCol(storeId, patientId), id), data);
  await refreshSummary(storeId, patientId);
}

export async function deleteConsulta(storeId: string, patientId: string, id: string) {
  await deleteDoc(doc(consultasCol(storeId, patientId), id));
  await refreshSummary(storeId, patientId);
}

/** Nota agregada a una consulta cerrada: queda con su fecha y no se puede cambiar. */
export async function addAddendum(storeId: string, patientId: string, c: Consulta, text: string) {
  const addenda = [...(c.addenda || []), { at: Date.now(), text: text.trim().slice(0, 2000) }];
  await updateDoc(doc(consultasCol(storeId, patientId), c.id), { addenda });
}
