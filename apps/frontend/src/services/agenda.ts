import { collection, doc, query, where, orderBy, onSnapshot, addDoc, updateDoc, deleteDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { getVentraDb, ensureVentraSession } from './ventraFirebase';
import { claimStore } from './onlineStore';
import { startAtMs, dayLabel, hhmm, type AgendaService, type AgendaStaff, type Booking, type BookingStatus } from './agendaCore';

export * from './agendaCore';

/**
 * Agenda de turnos de la tienda online (planes Tienda y Full).
 * La configuración va en ventra_stores/{id}.agenda (pública, sin datos de clientes) y los
 * turnos en ventra_stores/{id}/bookings (solo el dueño). Los clientes reservan por la
 * función agendaBook, que evita superposiciones. Ver firebase/functions/agenda.js.
 * Horario de Argentina (UTC-3): las horas se guardan como minutos del día.
 */

const bookingsCol = (storeId: string) => collection(getVentraDb(), 'ventra_stores', storeId, 'bookings');

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
  return addDoc(bookingsCol(storeId), {
    kind: 'booking',
    dateKey: b.dateKey, startMin: b.startMin, endMin: b.startMin + dur,
    startAt: Timestamp.fromMillis(startAtMs(b.dateKey, b.startMin)),
    staffId: b.staff.id, staffName: b.staff.name,
    serviceId: b.service.id, serviceName: b.service.name, durationMin: dur, price: Number(b.service.price) || 0,
    customerName: b.customerName.trim(), customerPhone: phone, customerPhoneKey: phone.replace(/\D/g, '').slice(-10), customerNote: (b.customerNote || '').trim(),
    code: code(), status: 'CONFIRMED', source: 'manual',
    createdAt: serverTimestamp(),
  });
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

export async function setBookingStatus(storeId: string, id: string, status: BookingStatus) {
  await ensureVentraSession();
  await updateDoc(doc(bookingsCol(storeId), id), { status, statusAt: serverTimestamp() });
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

/** Link de WhatsApp al cliente con el mensaje ya escrito. */
export function whatsappToCustomer(b: Booking, businessName: string, kind: 'confirm' | 'remind' | 'cancel') {
  const when = `${dayLabel(b.dateKey).toLowerCase()} a las ${hhmm(b.startMin)}`;
  const who = b.staffName ? ` con ${b.staffName}` : '';
  const hi = `Hola ${String(b.customerName || '').split(' ')[0]}!`;
  const text = kind === 'confirm'
    ? `${hi} Te confirmamos tu turno en *${businessName}*: *${b.serviceName}*${who}, ${when}. ¡Te esperamos!`
    : kind === 'remind'
      ? `${hi} Te recordamos tu turno en *${businessName}*: *${b.serviceName}*${who}, ${when}. Si no podés venir, avisanos por acá. ¡Gracias!`
      : `${hi} Lamentablemente tuvimos que cancelar tu turno en *${businessName}* (${b.serviceName}, ${when}). Escribinos y te damos otro horario.`;
  return `https://wa.me/${waDigits(b.customerPhone || '')}?text=${encodeURIComponent(text)}`;
}
