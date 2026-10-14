// SOLO DESARROLLO: reemplaza a services/agenda en /reel-tienda.html (ver vite.reel.config.ts).
// Los turnos viven en memoria, con algunos de ejemplo para hoy y mañana.
import { localNow, addDays, startAtMs, dayLabel, hhmm, clientKeyOf, aggregateClient, type AgendaService, type AgendaStaff, type Booking, type BookingStatus, type AgendaClient } from '../services/agendaCore';

export * from '../services/agendaCore';

const today = localNow().dateKey;
// ?rubro=pelu: un estudio de peluquería y barbería ("Estudio Norte") con los recordatorios automáticos funcionando
export const PELU = new URLSearchParams(location.search).get('rubro') === 'pelu';
const t = (id: string, day: number, hora: string, dur: number, staff: 'm' | 's', svc: [string, string, number], name: string, phone: string, extra: Partial<Booking> = {}): Booking => {
  const [h, m] = hora.split(':').map(Number);
  const startMin = h * 60 + m;
  return { id, kind: 'booking', dateKey: addDays(today, day), startMin, endMin: startMin + dur, staffId: staff, staffName: staff === 'm' ? 'Diego' : 'Sofi',
    serviceId: svc[0], serviceName: svc[1], price: svc[2], customerName: name, customerPhone: phone, status: 'CONFIRMED', source: 'online', code: id.toUpperCase().padEnd(4, 'X'), ...extra };
};
const CORTE: [string, string, number] = ['corte', 'Corte', 15000], COLOR: [string, string, number] = ['color', 'Color', 38000];
const BARBA: [string, string, number] = ['barba', 'Corte y barba', 19000];
const confirmo = { remindedAt: 1, remindedBy: 'auto' as const, reminder: { status: 'read' as const }, clientConfirmedAt: 1 };
const PELU_LIST: Booking[] = [
  t('p1', 0, '09:30', 45, 'm', CORTE, 'Nicolás Díaz', '221 555-0101', confirmo),
  t('p2', 0, '10:30', 90, 's', COLOR, 'Flor Ríos', '221 555-0102', confirmo),
  t('p3', 0, '11:00', 45, 'm', BARBA, 'Juan Paz', '221 555-0103', confirmo),
  { id: 'pb', kind: 'block', dateKey: today, startMin: 780, endMin: 840, staffId: 'ALL', status: 'BLOCK', reason: 'Almuerzo' },
  t('p4', 0, '14:00', 45, 'm', CORTE, 'Valentina Medina', '221 555-0104', confirmo),
  t('p5', 0, '15:00', 45, 's', CORTE, 'Matías Gómez', '221 555-0105', { remindedAt: 1, remindedBy: 'auto', reminder: { status: 'read' } }),
  t('p6', 0, '17:00', 45, 'm', BARBA, 'Lucas Torres', '221 555-0106', confirmo),
  t('p7', 0, '18:00', 90, 's', COLOR, 'Caro Sosa', '221 555-0107', confirmo),
  t('p8', 1, '10:00', 45, 'm', CORTE, 'Julián Herrera', '221 555-0108', { remindedAt: 1, remindedBy: 'auto', reminder: { status: 'delivered' } }),
  t('p9', 1, '12:00', 90, 's', COLOR, 'Pau Acosta', '221 555-0109', confirmo),
  t('h1', -7, '10:00', 45, 'm', CORTE, 'Nicolás Díaz', '221 555-0101', { status: 'DONE', payment: { method: 'Mercado Pago', amount: 15000 } }),
  t('h2', -3, '16:00', 90, 's', COLOR, 'Caro Sosa', '221 555-0107', { status: 'DONE', payment: { method: 'Transferencia', amount: 38000 } }),
  t('h3', -1, '11:00', 45, 'm', BARBA, 'Lucas Torres', '221 555-0106', { status: 'DONE', payment: { method: 'Efectivo', amount: 12000 } }),
];
let list: Booking[] = [
  { id: 'b1', kind: 'booking', dateKey: today, startMin: 600, endMin: 660, staffId: 'a', staffName: 'Mía', serviceId: 's1', serviceName: 'Asesoría de imagen', price: 25000, customerName: 'Carla Gómez', customerPhone: '11 5555-0004', status: 'CONFIRMED', source: 'online', code: 'K7PZ', remindedAt: 1, remindedBy: 'auto', reminder: { status: 'read' }, clientConfirmedAt: 1 },
  { id: 'b2', kind: 'booking', dateKey: today, startMin: 690, endMin: 720, staffId: 'a', staffName: 'Mía', serviceId: 's2', serviceName: 'Arreglo de ruedo', price: 6000, customerName: 'Lucía Fernández', customerPhone: '11 4444-1234', status: 'PENDING', source: 'online', code: 'Q2M8', customerNote: 'Son dos jeans' },
  { id: 'b3', kind: 'block', dateKey: today, startMin: 780, endMin: 840, staffId: 'ALL', status: 'BLOCK', reason: 'Almuerzo' },
  { id: 'b4', kind: 'booking', dateKey: today, startMin: 900, endMin: 960, staffId: 'b', staffName: 'Lucía', serviceId: 's1', serviceName: 'Asesoría de imagen', price: 25000, customerName: 'Sofía Ruiz', customerPhone: '11 3333-9876', status: 'CONFIRMED', source: 'manual', code: 'AB12', remindedAt: 1, remindedBy: 'auto', reminder: { status: 'read' } },
  { id: 'h1', kind: 'booking', dateKey: addDays(today, -6), startMin: 600, endMin: 660, staffId: 'a', staffName: 'Mía', serviceId: 's1', serviceName: 'Asesoría de imagen', price: 25000, customerName: 'Carla Gómez', customerPhone: '11 5555-0004', status: 'DONE', source: 'online', code: 'H1H1', payment: { method: 'Transferencia', amount: 25000 } },
  { id: 'h2', kind: 'booking', dateKey: addDays(today, -2), startMin: 720, endMin: 750, staffId: 'b', staffName: 'Lucía', serviceId: 's2', serviceName: 'Arreglo de ruedo', price: 6000, customerName: 'Sofía Ruiz', customerPhone: '11 3333-9876', status: 'DONE', source: 'manual', code: 'H2H2', payment: { method: 'Efectivo', amount: 6000 } },
  { id: 'h3', kind: 'booking', dateKey: addDays(today, -1), startMin: 660, endMin: 720, staffId: 'a', staffName: 'Mía', serviceId: 's1', serviceName: 'Asesoría de imagen', price: 25000, customerName: 'Martina López', customerPhone: '11 7777-2020', status: 'NO_SHOW', source: 'online', code: 'H3H3' },
  { id: 'b5', kind: 'booking', dateKey: addDays(today, 1), startMin: 630, endMin: 690, staffId: 'b', staffName: 'Lucía', serviceId: 's1', serviceName: 'Asesoría de imagen', price: 25000, customerName: 'Valentina Paz', customerPhone: '11 2222-1111', status: 'CONFIRMED', source: 'online', code: 'ZX45' },
];
if (PELU) list = PELU_LIST;
const subs = new Set<() => void>();
const notes: Record<string, string> = {};
// Lo que en producción hace la función ventraBookingWritten: el resumen de cada cliente
const clientsNow = (): AgendaClient[] => {
  const groups = new Map<string, Booking[]>();
  for (const b of list) { const k = clientKeyOf(b); if (k) groups.set(k, [...(groups.get(k) || []), b]); }
  return [...groups].map(([key, l]) => ({ key, note: notes[key] || '', ...aggregateClient(l, today)! }));
};
const emit = () => subs.forEach((f) => f());

export function subscribeBookings(_storeId: string, fromKey: string, toKey: string, onChange: (l: Booking[]) => void) {
  const f = () => onChange(list.filter((b) => b.dateKey >= fromKey && b.dateKey <= toKey).sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.startMin - b.startMin));
  subs.add(f); setTimeout(f, 50);
  return () => { subs.delete(f); };
}
export async function createManualBooking(_s: string, b: { dateKey: string; startMin: number; service: AgendaService; staff: AgendaStaff; customerName: string; customerPhone?: string; customerNote?: string }) {
  list = [...list, { id: 'm' + Date.now(), kind: 'booking', dateKey: b.dateKey, startMin: b.startMin, endMin: b.startMin + b.service.durationMin, staffId: b.staff.id, staffName: b.staff.name, serviceId: b.service.id, serviceName: b.service.name, price: b.service.price, customerName: b.customerName, customerPhone: b.customerPhone, customerNote: b.customerNote, status: 'CONFIRMED', source: 'manual', code: 'NEW1' }];
  emit(); void startAtMs;
}
export async function createBlock(_s: string, b: { dateKey: string; startMin: number; endMin: number; staffId: string; staffName?: string; reason?: string }) {
  list = [...list, { id: 'k' + Date.now(), kind: 'block', status: 'BLOCK', ...b }]; emit();
}
export async function setBookingStatus(_s: string, id: string, status: BookingStatus) { list = list.map((b) => (b.id === id ? { ...b, status } : b)); emit(); }
export async function chargeBooking(_s: string, b: Booking, payment: { method: string; amount: number }) { list = list.map((x) => (x.id === b.id ? { ...x, status: 'DONE', payment } : x)); emit(); }
export async function unchargeBooking(_s: string, b: Booking) { list = list.map((x) => (x.id === b.id ? { ...x, payment: undefined } : x)); emit(); }
export function subscribeClients(_s: string, onChange: (l: AgendaClient[]) => void) {
  const f = () => onChange(clientsNow());
  subs.add(f); setTimeout(f, 50);
  return () => { subs.delete(f); };
}
export async function fetchClientBookings(_s: string, key: string) {
  return list.filter((b) => clientKeyOf(b) === key).sort((a, b) => b.dateKey.localeCompare(a.dateKey) || b.startMin - a.startMin);
}
export async function saveClientNote(_s: string, c: AgendaClient, note: string) { notes[c.key] = note; emit(); }
export async function hasAnyBooking() { return list.some((b) => b.kind === 'booking'); }
export async function rebuildClients() { return clientsNow().length; }
export async function fetchBookingsRange(_s: string, fromKey: string, toKey: string) {
  return list.filter((b) => b.dateKey >= fromKey && b.dateKey <= toKey).sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.startMin - b.startMin);
}
export async function waRemindersAvailable() { return true; }
export async function markReminded(_s: string, id: string) { list = list.map((b) => (b.id === id ? { ...b, remindedAt: Date.now() } : b)); emit(); }
export async function rescheduleBooking(_s: string, b: Booking, to: { dateKey: string; startMin: number; staff: AgendaStaff }) {
  list = list.map((x) => (x.id === b.id ? { ...x, dateKey: to.dateKey, startMin: to.startMin, endMin: to.startMin + (x.endMin - x.startMin), staffId: to.staff.id, staffName: to.staff.name, movedFrom: { dateKey: x.dateKey, startMin: x.startMin } } : x));
  emit();
}
export async function deleteBooking(_s: string, id: string) { list = list.filter((b) => b.id !== id); emit(); }
export function whatsappToCustomer(b: Booking, businessName: string, kind: string) {
  return `https://wa.me/549${(b.customerPhone || '').replace(/\D/g, '')}?text=${encodeURIComponent(`${kind} ${businessName} ${dayLabel(b.dateKey)} ${hhmm(b.startMin)}`)}`;
}

// Lo que el servicio real tiene y esta vista no necesita simular de verdad
export const REMINDER_PLAN_QUOTA: Record<string, number> = { agenda_pro: 200, full: 200, prueba: 200 };
export const REMINDER_PACK = { qty: 100, price: 7500 };
export interface ReminderQuota { included: number; used: number; extra: number; left: number }
export function subscribeReminderQuota(plan: string | null, onChange: (q: ReminderQuota) => void) {
  const included = (plan && REMINDER_PLAN_QUOTA[plan]) || 0;
  setTimeout(() => onChange({ included, used: 37, extra: 0, left: Math.max(0, included - 37) }), 30);
  return () => {};
}
export async function buyReminderPack(): Promise<string> { return 'https://www.mercadopago.com.ar'; }
export function seriesDates(b: { dateKey: string }, everyWeeks: number, times: number) {
  return { ok: Array.from({ length: times }, (_, i) => addDays(b.dateKey, i * 7 * everyWeeks)), taken: [] as string[] };
}
export async function createSeries(s: string, b: Parameters<typeof createManualBooking>[1], days: string[]) {
  for (const dateKey of days) await createManualBooking(s, { ...b, dateKey });
  return 's_reel';
}
export async function seriesUpcoming(): Promise<Booking[]> { return []; }
export async function cancelBookings(_s: string, l: Booking[]) { const ids = new Set(l.map((x) => x.id)); list = list.map((b) => (ids.has(b.id) ? { ...b, status: 'CANCELLED' } : b)); emit(); }
export async function fetchBooking(_s: string, id: string) { return list.find((b) => b.id === id) || null; }
