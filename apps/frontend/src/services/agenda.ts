import { collection, doc, query, where, orderBy, limit, onSnapshot, addDoc, updateDoc, deleteDoc, setDoc, getDocs, writeBatch, deleteField, serverTimestamp, Timestamp } from 'firebase/firestore';
import { getVentraDb, ensureVentraSession } from './ventraFirebase';
import { claimStore } from './onlineStore';
import { startAtMs, dayLabel, hhmm, localNow, clientKeyOf, aggregateClient, type AgendaService, type AgendaStaff, type Booking, type BookingStatus, type BookingPayment, type AgendaClient } from './agendaCore';

export * from './agendaCore';

/**
 * Agenda de turnos de la tienda online (planes Tienda y Full).
 * La configuración va en ventra_stores/{id}.agenda (pública, sin datos de clientes) y los
 * turnos en ventra_stores/{id}/bookings (solo el dueño). Los clientes reservan por la
 * función agendaBook, que evita superposiciones. Ver firebase/functions/agenda.js.
 * Horario de Argentina (UTC-3): las horas se guardan como minutos del día.
 */

const bookingsCol = (storeId: string) => collection(getVentraDb(), 'ventra_stores', storeId, 'bookings');
const clientsCol = (storeId: string) => collection(getVentraDb(), 'ventra_stores', storeId, 'agenda_clients');
const docsOf = (snap: any): Booking[] => snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));

/** Turnos y bloqueos entre dos días (inclusive), en vivo. */
export function subscribeBookings(storeId: string, fromKey: string, toKey: string, onChange: (list: Booking[]) => void, onError?: (e: Error) => void) {
  let unsub: (() => void) | null = null;
  let cancelled = false;
  claimStore(storeId).then(() => {
    if (cancelled) return;
    const q = query(bookingsCol(storeId), where('dateKey', '>=', fromKey), where('dateKey', '<=', toKey), orderBy('dateKey'));
    unsub = onSnapshot(q, (snap) => {
      onChange(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })).sort((a: Booking, b: Booking) => a.dateKey.localeCompare(b.dateKey) || a.startMin - b.startMin));
    }, (err) => { console.warn('[Agenda] Error escuchando turnos:', err.message); onError?.(err); });
  }).catch((err) => onError?.(err));
  return () => { cancelled = true; unsub?.(); };
}

function code() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 4; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

/** Turno cargado por el comercio (alguien que llamó o vino al local). */
export async function createManualBooking(storeId: string, b: {
  dateKey: string; startMin: number; service: AgendaService; staff: AgendaStaff;
  customerName: string; customerPhone?: string; customerNote?: string;
}) {
  await ensureVentraSession();
  const dur = Math.max(5, Number(b.service.durationMin) || 30);
  const phone = (b.customerPhone || '').trim();
  const data = {
    kind: 'booking' as const,
    dateKey: b.dateKey, startMin: b.startMin, endMin: b.startMin + dur,
    startAt: Timestamp.fromMillis(startAtMs(b.dateKey, b.startMin)),
    staffId: b.staff.id, staffName: b.staff.name,
    serviceId: b.service.id, serviceName: b.service.name, durationMin: dur, price: Number(b.service.price) || 0,
    customerName: b.customerName.trim(), customerPhone: phone, customerPhoneKey: phone.replace(/\D/g, '').slice(-10), customerNote: (b.customerNote || '').trim(),
    code: code(), status: 'CONFIRMED' as const, source: 'manual' as const,
  };
  const ref = await addDoc(bookingsCol(storeId), { ...data, createdAt: serverTimestamp() });
  refreshClientOf(storeId, data as any);
  return ref;
}

/** Horario bloqueado (almuerzo, un día libre). staffId 'ALL' = todo el local. */
export async function createBlock(storeId: string, b: { dateKey: string; startMin: number; endMin: number; staffId: string; staffName?: string; reason?: string }) {
  await ensureVentraSession();
  return addDoc(bookingsCol(storeId), {
    kind: 'block', status: 'BLOCK',
    dateKey: b.dateKey, startMin: b.startMin, endMin: b.endMin,
    startAt: Timestamp.fromMillis(startAtMs(b.dateKey, b.startMin)),
    staffId: b.staffId, staffName: b.staffName || '', reason: (b.reason || '').trim(),
    source: 'manual', createdAt: serverTimestamp(),
  });
}

export async function setBookingStatus(storeId: string, id: string, status: BookingStatus, booking?: Booking) {
  await ensureVentraSession();
  await updateDoc(doc(bookingsCol(storeId), id), { status, statusAt: serverTimestamp() });
  if (booking) refreshClientOf(storeId, { ...booking, status });
}

/**
 * Mueve un turno a otro día, horario o profesional. Si estaba "no vino" o cancelado, vuelve a
 * quedar confirmado. La función ventraBookingWritten libera el horario viejo y ocupa el nuevo.
 */
export async function rescheduleBooking(storeId: string, b: Booking, to: { dateKey: string; startMin: number; staff: AgendaStaff }) {
  await ensureVentraSession();
  const dur = Math.max(5, (b.endMin - b.startMin) || Number(b.durationMin) || 30);
  const status = b.status === 'PENDING' ? 'PENDING' : 'CONFIRMED';
  const patch = {
    dateKey: to.dateKey, startMin: to.startMin, endMin: to.startMin + dur,
    startAt: Timestamp.fromMillis(startAtMs(to.dateKey, to.startMin)),
    staffId: to.staff.id, staffName: to.staff.name, status,
    movedFrom: { dateKey: b.dateKey, startMin: b.startMin }, statusAt: serverTimestamp(),
  };
  await updateDoc(doc(bookingsCol(storeId), b.id), patch);
  refreshClientOf(storeId, { ...b, ...patch } as any);
  return { ...b, ...patch } as Booking;
}

/** Cobra el turno: queda como atendido con el medio y el monto (con caja, lo hace la venta del POS). */
export async function chargeBooking(storeId: string, b: Booking, payment: { method: string; amount: number }) {
  await ensureVentraSession();
  const p: BookingPayment = { method: payment.method, amount: Math.max(0, Number(payment.amount) || 0) };
  await updateDoc(doc(bookingsCol(storeId), b.id), { status: 'DONE', statusAt: serverTimestamp(), payment: { ...p, at: serverTimestamp() } });
  refreshClientOf(storeId, { ...b, status: 'DONE', payment: p });
}

/** Deshace un cobro cargado por error (el turno sigue como atendido). */
export async function unchargeBooking(storeId: string, b: Booking) {
  await ensureVentraSession();
  await updateDoc(doc(bookingsCol(storeId), b.id), { payment: deleteField() });
  refreshClientOf(storeId, { ...b, payment: undefined });
}

// ─── Clientes de la agenda ───
// El resumen de cada cliente lo mantiene la función ventraBookingWritten (también para las
// reservas online). La app lo recalcula además después de sus propios cambios, así se ve al
// instante y funciona aunque la función todavía no esté actualizada.

/** Turnos de un cliente (todos, de cualquier fecha). */
export async function fetchClientBookings(storeId: string, key: string, sampleName?: string): Promise<Booking[]> {
  const q = key.startsWith('p')
    ? query(bookingsCol(storeId), where('customerPhoneKey', '==', key.slice(1)))
    : query(bookingsCol(storeId), where('customerName', '==', sampleName || ''));
  const list = docsOf(await getDocs(q)).filter((b) => clientKeyOf(b) === key);
  return list.sort((a, b) => b.dateKey.localeCompare(a.dateKey) || b.startMin - a.startMin);
}

async function refreshClient(storeId: string, key: string, sample?: Partial<Booking>) {
  const list = await fetchClientBookings(storeId, key, sample?.customerName);
  const agg = aggregateClient(list, localNow().dateKey);
  if (agg) await setDoc(doc(clientsCol(storeId), key), { ...agg, key, updatedAt: serverTimestamp() }, { merge: true });
}

function refreshClientOf(storeId: string, b: Partial<Booking>) {
  const key = clientKeyOf(b);
  if (key) refreshClient(storeId, key, b).catch((err) => console.warn('[Agenda] No se pudo actualizar el cliente', err?.message));
}

/** Clientes de la agenda, en vivo. */
export function subscribeClients(storeId: string, onChange: (list: AgendaClient[]) => void, onError?: (e: Error) => void) {
  let unsub: (() => void) | null = null;
  let cancelled = false;
  claimStore(storeId).then(() => {
    if (cancelled) return;
    unsub = onSnapshot(clientsCol(storeId), (snap) => {
      onChange(snap.docs.map((d) => ({ key: d.id, ...(d.data() as any) })));
    }, (err) => { console.warn('[Agenda] Error escuchando clientes:', err.message); onError?.(err); });
  }).catch((err) => onError?.(err));
  return () => { cancelled = true; unsub?.(); };
}

export async function saveClientNote(storeId: string, client: AgendaClient, note: string) {
  await ensureVentraSession();
  await setDoc(doc(clientsCol(storeId), client.key), { note: note.trim().slice(0, 1000), key: client.key, updatedAt: serverTimestamp() }, { merge: true });
}

/**
 * Arma los clientes con todos los turnos guardados. Una sola vez por comercio: la lista
 * de clientes nació después que la agenda, y los turnos viejos no tenían resumen.
 */
export async function rebuildClients(storeId: string): Promise<number> {
  await claimStore(storeId);
  const all = docsOf(await getDocs(bookingsCol(storeId)));
  const groups = new Map<string, Booking[]>();
  for (const b of all) {
    const k = clientKeyOf(b);
    if (k) groups.set(k, [...(groups.get(k) || []), b]);
  }
  const today = localNow().dateKey;
  const entries = [...groups];
  for (let i = 0; i < entries.length; i += 400) {
    const batch = writeBatch(getVentraDb());
    for (const [k, list] of entries.slice(i, i + 400)) {
      const agg = aggregateClient(list, today);
      if (agg) batch.set(doc(clientsCol(storeId), k), { ...agg, key: k, updatedAt: serverTimestamp() }, { merge: true });
    }
    await batch.commit();
  }
  return entries.length;
}

/** Si el comercio ya tiene algún turno (para "Primeros pasos"): lee un solo documento. */
export async function hasAnyBooking(storeId: string): Promise<boolean> {
  await claimStore(storeId);
  const snap = await getDocs(query(bookingsCol(storeId), where('kind', '==', 'booking'), limit(1)));
  return !snap.empty;
}

/** Turnos entre dos días (inclusive), una sola lectura: para los cobros del período. */
export async function fetchBookingsRange(storeId: string, fromKey: string, toKey: string): Promise<Booking[]> {
  await claimStore(storeId);
  const q = query(bookingsCol(storeId), where('dateKey', '>=', fromKey), where('dateKey', '<=', toKey), orderBy('dateKey'));
  return docsOf(await getDocs(q)).sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.startMin - b.startMin);
}

export async function deleteBooking(storeId: string, id: string) {
  await ensureVentraSession();
  await deleteDoc(doc(bookingsCol(storeId), id));
}

const waDigits = (phone: string) => {
  let d = phone.replace(/\D/g, '');
  if (d.startsWith('0')) d = d.slice(1);
  // Números argentinos cargados sin código de país
  if (d.length === 10) d = '549' + d;
  return d;
};

/** Link del turno para el cliente: lo ve y lo puede cancelar (función agendaManage). */
export const bookingManageUrl = (b: Booking, slug?: string | null) =>
  slug && b.id && b.code ? `https://tienda.ventra.store/${encodeURIComponent(slug)}#turno=${b.id}.${b.code}` : '';

/** Link de WhatsApp al cliente con el mensaje ya escrito (con el link del turno, si la página tiene dirección). */
export function whatsappToCustomer(b: Booking, businessName: string, kind: 'confirm' | 'remind' | 'cancel' | 'moved', slug?: string | null) {
  const when = `${dayLabel(b.dateKey).toLowerCase()} a las ${hhmm(b.startMin)}`;
  const who = b.staffName ? ` con ${b.staffName}` : '';
  const hi = `Hola ${String(b.customerName || '').split(' ')[0]}!`;
  const text = kind === 'confirm'
    ? `${hi} Te confirmamos tu turno en *${businessName}*: *${b.serviceName}*${who}, ${when}. ¡Te esperamos!`
    : kind === 'remind'
      ? `${hi} Te recordamos tu turno en *${businessName}*: *${b.serviceName}*${who}, ${when}. Si no podés venir, avisanos por acá. ¡Gracias!`
      : kind === 'moved'
        ? `${hi} Te cambiamos el turno en *${businessName}*: *${b.serviceName}*${who}, ahora es ${when}. Si no te queda bien, avisanos por acá.`
        : `${hi} Lamentablemente tuvimos que cancelar tu turno en *${businessName}* (${b.serviceName}, ${when}). Escribinos y te damos otro horario.`;
  const link = kind !== 'cancel' ? bookingManageUrl(b, slug) : '';
  if (link) return `https://wa.me/${waDigits(b.customerPhone || '')}?text=${encodeURIComponent(`${text}

Tu turno (para verlo o cancelarlo): ${link}`)}`;
  return `https://wa.me/${waDigits(b.customerPhone || '')}?text=${encodeURIComponent(text)}`;
}
