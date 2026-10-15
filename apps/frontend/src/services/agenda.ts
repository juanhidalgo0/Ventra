import { collection, doc, query, where, orderBy, limit, onSnapshot, addDoc, updateDoc, deleteDoc, setDoc, getDoc, getDocs, writeBatch, deleteField, serverTimestamp, Timestamp } from 'firebase/firestore';
import { getVentraDb, ensureVentraSession } from './ventraFirebase';
import { IS_DEMO_BUILD } from '../demo/flag';
import { publicStoreUrl, RESERVED_SLUGS } from '../utils/storeLinks';
import { claimStore } from './onlineStore';
import { startAtMs, dayLabel, hhmm, localNow, clientKeyOf, aggregateClient, addDays, occupies, phoneKeyOf, nameKeyOf, waPhone, type AgendaConfig, type AgendaService, type AgendaStaff, type Booking, type BookingStatus, type BookingPayment, type AgendaClient } from './agendaCore';

export * from './agendaCore';

/**
 * Agenda de turnos de la tienda online (planes Tienda y Full).
 * La configuración va en ventra_stores/{id}.agenda (pública, sin datos de clientes) y los
 * turnos en ventra_stores/{id}/bookings (solo el dueño). Los clientes reservan por la
 * función agendaBook, que evita superposiciones. Ver firebase/functions/agenda.js.
 * Horario de Argentina (UTC-3): las horas se guardan como minutos del día.
 */

/**
 * Si Ventra ya manda recordatorios automáticos por WhatsApp: lo marca la nube (whatsapp.js) cuando
 * el número de Ventra está configurado. Hasta entonces la opción se muestra como "Muy pronto".
 * En la demo se muestra activa, para que se vea cómo funciona.
 */
export async function waRemindersAvailable(): Promise<boolean> {
  if (IS_DEMO_BUILD) return true;
  try {
    const snap = await getDoc(doc(getVentraDb(), 'ventra_desktop', 'whatsapp'));
    return !!(snap.exists() && snap.data().reminders);
  } catch {
    return false;
  }
}

/**
 * Cupo de recordatorios automáticos de la cuenta (lo cuenta la nube: firebase/functions/reminder-quota.js).
 * Mismos números que PLAN_REMINDERS y PACK de allá.
 */
export const REMINDER_PLAN_QUOTA: Record<string, number> = { agenda_pro: 200, full: 200, prueba: 200 };
export const REMINDER_PACK = { qty: 100, price: 7500 };
export interface ReminderQuota { included: number; used: number; extra: number; left: number }

const monthKeyAR = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }).slice(0, 7);

/** Cuánto le queda a la cuenta este mes, en vivo. El mes nuevo arranca de cero aunque la nube todavía no lo haya tocado. */
export function subscribeReminderQuota(plan: string | null, onChange: (q: ReminderQuota) => void) {
  const included = (plan && REMINDER_PLAN_QUOTA[plan]) || 0;
  const emit = (d: any) => {
    const used = d && d.month === monthKeyAR() ? Number(d.used) || 0 : 0;
    const extra = Math.max(0, Number(d?.extra) || 0);
    onChange({ included, used, extra, left: Math.max(0, included - used) + extra });
  };
  if (IS_DEMO_BUILD) { emit({ month: monthKeyAR(), used: 37, extra: 0 }); return () => {}; }
  let unsub: (() => void) | null = null, cancelled = false;
  ensureVentraSession().then((user) => {
    if (cancelled || user.isAnonymous) return emit(null);
    unsub = onSnapshot(doc(getVentraDb(), 'ventra_wa_quota', user.uid), (snap) => emit(snap.exists() ? snap.data() : null), () => emit(null));
  }).catch(() => emit(null));
  return () => { cancelled = true; unsub?.(); };
}

/** Link de pago de un paquete de recordatorios. Se acredita solo cuando Mercado Pago confirma el pago. */
export async function buyReminderPack(): Promise<string> {
  const user = await ensureVentraSession();
  const res = await fetch('https://us-central1-ventra-9cba5.cloudfunctions.net/buyReminderPack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
    body: '{}',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.initPoint) throw new Error(data.error || 'No se pudo iniciar el pago');
  return data.initPoint;
}

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

function code(n = 4) {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint32Array(n));
  let s = ''; for (let i = 0; i < n; i++) s += a[r[i] % a.length];
  return s;
}

/** Turno cargado por el comercio (alguien que llamó o vino al local). */
export async function createManualBooking(storeId: string, b: {
  dateKey: string; startMin: number; service: AgendaService; staff: AgendaStaff;
  customerName: string; customerPhone?: string; customerNote?: string;
  /** Turno fijo: todos los de la serie comparten este id (ver createSeries) */
  seriesId?: string;
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
    customerName: b.customerName.trim(), customerNameKey: nameKeyOf(b.customerName), customerPhone: phone, customerPhoneKey: phoneKeyOf(phone), customerNote: (b.customerNote || '').trim(),
    code: code(), shortCode: code(8), status: 'CONFIRMED' as const, source: 'manual' as const,
    ...(b.seriesId ? { seriesId: b.seriesId } : {}),
  };
  const ref = await addDoc(bookingsCol(storeId), { ...data, createdAt: serverTimestamp() });
  refreshClientOf(storeId, data as any);
  return ref;
}

/**
 * Turno fijo (el cliente que viene "todos los martes a las 18"): la fecha elegida y las siguientes cada
 * `everyWeeks` semanas, `times` veces en total. Las fechas en las que ese horario ya está ocupado (otro turno
 * o un bloqueo) no se cargan y se devuelven para avisarle al comercio.
 */
export function seriesDates(b: { dateKey: string; startMin: number; service: AgendaService; staff: AgendaStaff }, everyWeeks: number, times: number, existing: Booking[], agenda: AgendaConfig) {
  const dur = Math.max(5, Number(b.service.durationMin) || 30);
  const buf = Math.max(0, Number(agenda.bufferMin) || 0);
  const ok: string[] = [], taken: string[] = [];
  for (let i = 0; i < times; i++) {
    const day = addDays(b.dateKey, i * 7 * everyWeeks);
    const clash = existing.some((x) => x.dateKey === day && occupies(x) && (x.staffId === b.staff.id || x.staffId === 'ALL') && b.startMin < x.endMin + buf && x.startMin < b.startMin + dur + buf);
    (i === 0 || !clash ? ok : taken).push(day);
  }
  return { ok, taken };
}

export async function createSeries(storeId: string, b: Parameters<typeof createManualBooking>[1], days: string[]) {
  const seriesId = `s_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  for (const dateKey of days) await createManualBooking(storeId, { ...b, dateKey, seriesId });
  return seriesId;
}

/** Turnos de la misma serie desde un día (sin contar uno), que todavía están por venir. */
export async function seriesUpcoming(storeId: string, seriesId: string, fromKey: string, exceptId?: string): Promise<Booking[]> {
  await ensureVentraSession();
  const snap = await getDocs(query(bookingsCol(storeId), where('seriesId', '==', seriesId)));
  return docsOf(snap).filter((x) => x.id !== exceptId && x.dateKey >= fromKey && (x.status === 'CONFIRMED' || x.status === 'PENDING')).sort((x, y) => x.dateKey.localeCompare(y.dateKey));
}

export async function cancelBookings(storeId: string, list: Booking[]) {
  await ensureVentraSession();
  const batch = writeBatch(getVentraDb());
  list.forEach((x) => batch.update(doc(bookingsCol(storeId), x.id), { status: 'CANCELLED', cancelledBy: 'owner', statusAt: serverTimestamp() }));
  await batch.commit();
  if (list[0]) refreshClientOf(storeId, { ...list[0], status: 'CANCELLED' });
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

/**
 * Cambia el estado de un turno desde la app. Cancelarlo lo marca como cancelado por el comercio (no por el cliente) y,
 * si pagó online, queda para devolver: lo canceló el comercio, así que la seña también se devuelve.
 * Volver a dar un turno cancelado borra quién lo canceló y lo que había que devolver.
 */
export async function setBookingStatus(storeId: string, id: string, status: BookingStatus, booking?: Booking) {
  await ensureVentraSession();
  const del = deleteField();
  const patch: Record<string, any> = { status, statusAt: serverTimestamp() };
  if (status === 'CANCELLED') {
    patch.cancelledBy = 'owner';
    patch.cancelVia = del;
    if (booking?.deposit?.status === 'paid') patch['deposit.refundNeeded'] = true;
  } else if (booking && (booking.status === 'CANCELLED' || booking.cancelledBy)) {
    Object.assign(patch, revivePatch(booking));
  }
  await updateDoc(doc(bookingsCol(storeId), id), patch);
  if (booking) refreshClientOf(storeId, { ...booking, status });
}

/** Un turno cancelado que vuelve a estar en pie: ya no lo canceló nadie ni hay nada que devolver */
function revivePatch(b: Booking): Record<string, any> {
  const del = deleteField();
  return { cancelledBy: del, cancelVia: del, ...(b.deposit ? { 'deposit.refundNeeded': del } : {}) };
}

/**
 * Mueve un turno a otro día, horario o profesional. Si estaba "no vino" o cancelado, vuelve a
 * quedar confirmado. La función ventraBookingWritten libera el horario viejo y ocupa el nuevo.
 */
export async function rescheduleBooking(storeId: string, b: Booking, to: { dateKey: string; startMin: number; staff: AgendaStaff }) {
  await ensureVentraSession();
  const dur = Math.max(5, (b.endMin - b.startMin) || Number(b.durationMin) || 30);
  const status = b.status === 'PENDING' ? 'PENDING' : 'CONFIRMED';
  const revived = b.status === 'CANCELLED' || b.status === 'NO_SHOW' || !!b.cancelledBy ? revivePatch(b) : {};
  const patch = {
    dateKey: to.dateKey, startMin: to.startMin, endMin: to.startMin + dur,
    startAt: Timestamp.fromMillis(startAtMs(to.dateKey, to.startMin)),
    staffId: to.staff.id, staffName: to.staff.name, status,
    movedFrom: { dateKey: b.dateKey, startMin: b.startMin }, movedBy: 'owner', statusAt: serverTimestamp(),
  };
  // El recordatorio automático (WhatsApp y email) vuelve a salir para el horario nuevo
  const del = deleteField();
  await updateDoc(doc(bookingsCol(storeId), b.id), { ...patch, ...revived, remindedAt: del, reminder: del, emailRemindedAt: del, emailReminder: del, clientConfirmedAt: del });
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
  // Sin teléfono: por la clave del nombre ("Ana Pérez" y "ana perez" son la misma) y, para los turnos de antes
  // de customerNameKey, por el nombre tal cual
  const qs = key.startsWith('p')
    ? [query(bookingsCol(storeId), where('customerPhoneKey', '==', key.slice(1)))]
    : [query(bookingsCol(storeId), where('customerNameKey', '==', key.slice(2))), query(bookingsCol(storeId), where('customerName', '==', sampleName || ''))];
  const byId = new Map<string, Booking>();
  for (const snap of await Promise.all(qs.map((q) => getDocs(q)))) for (const b of docsOf(snap)) byId.set(b.id, b);
  const list = [...byId.values()].filter((b) => clientKeyOf(b) === key);
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

/** Un turno por su id (para abrirlo desde un aviso). null si no existe. */
export async function fetchBooking(storeId: string, id: string): Promise<Booking | null> {
  await claimStore(storeId);
  const snap = await getDoc(doc(bookingsCol(storeId), id));
  return snap.exists() ? ({ id: snap.id, ...(snap.data() as any) } as Booking) : null;
}

/** Turnos por confirmar de hoy en adelante, en vivo (para el aviso de la agenda, aunque estén lejos del día que se mira). */
export function subscribePending(storeId: string, onChange: (list: Booking[]) => void) {
  let unsub: (() => void) | null = null;
  let cancelled = false;
  claimStore(storeId).then(() => {
    if (cancelled) return;
    unsub = onSnapshot(query(bookingsCol(storeId), where('status', '==', 'PENDING')), (snap) => {
      const today = localNow().dateKey;
      onChange(docsOf(snap).filter((b) => b.dateKey >= today).sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.startMin - b.startMin));
    }, (err) => console.warn('[Agenda] Error escuchando los turnos por confirmar:', err.message));
  }).catch(() => {});
  return () => { cancelled = true; unsub?.(); };
}

/**
 * Turnos con plata que entró entre dos momentos (ms), en vivo: cobrados (payment.at) o pagados online (deposit.paidAt).
 * Para los cobros del período: cuentan el día que entró la plata, no el día del turno (así cuadra con Mercado Pago).
 */
export function subscribePaidBetween(storeId: string, fromMs: number, toMs: number, onChange: (list: Booking[]) => void, onError?: (e: Error) => void) {
  const unsubs: (() => void)[] = [];
  let cancelled = false;
  const parts: Record<string, Booking[] | null> = { payment: null, deposit: null };
  const emit = () => {
    if (parts.payment === null || parts.deposit === null) return;
    const byId = new Map<string, Booking>();
    for (const b of [...parts.payment, ...parts.deposit]) byId.set(b.id, b);
    onChange([...byId.values()]);
  };
  claimStore(storeId).then(() => {
    if (cancelled) return;
    const from = Timestamp.fromMillis(fromMs), to = Timestamp.fromMillis(toMs);
    for (const [k, field] of [['payment', 'payment.at'], ['deposit', 'deposit.paidAt']] as const) {
      unsubs.push(onSnapshot(query(bookingsCol(storeId), where(field, '>=', from), where(field, '<', to)),
        (snap) => { parts[k] = docsOf(snap); emit(); },
        (err) => { console.warn('[Agenda] Error escuchando cobros:', err.message); onError?.(err); }));
    }
  }).catch((err) => onError?.(err));
  return () => { cancelled = true; unsubs.forEach((u) => u()); };
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

// Números argentinos en cualquier formato (0, 15, +54 9…): ver waPhone en agendaCore
const waDigits = (phone: string) => waPhone(phone);

/** Marca que ya se le mandó el recordatorio por WhatsApp (para la lista de recordatorios de mañana). */
export async function markReminded(storeId: string, id: string) {
  await ensureVentraSession();
  await updateDoc(doc(bookingsCol(storeId), id), { remindedAt: serverTimestamp() });
}

/** Link del turno para el cliente: lo ve y lo puede cancelar (función agendaManage). */
export const bookingManageUrl = (b: Booking, slug?: string | null) =>
  !slug || !b.id || !b.code ? ''
    // El corto (ventra.store/<comercio>/turno/<código>) si el turno lo tiene; los viejos, con el link de siempre
    : b.shortCode && !RESERVED_SLUGS.has(slug) ? publicStoreUrl(slug, `turno/${b.shortCode}`)
      : `https://tienda.ventra.store/${encodeURIComponent(slug)}#turno=${b.id}.${b.code}`;

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
