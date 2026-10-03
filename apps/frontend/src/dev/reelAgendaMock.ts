// SOLO DESARROLLO: reemplaza a services/agenda en /reel-tienda.html (ver vite.reel.config.ts).
// Los turnos viven en memoria, con algunos de ejemplo para hoy y mañana.
import { localNow, addDays, startAtMs, dayLabel, hhmm, clientKeyOf, aggregateClient, type AgendaService, type AgendaStaff, type Booking, type BookingStatus, type AgendaClient } from '../services/agendaCore';

export * from '../services/agendaCore';

const today = localNow().dateKey;
let list: Booking[] = [
  { id: 'b1', kind: 'booking', dateKey: today, startMin: 600, endMin: 660, staffId: 'a', staffName: 'Mía', serviceId: 's1', serviceName: 'Asesoría de imagen', price: 25000, customerName: 'Carla Gómez', customerPhone: '11 5555-0004', status: 'CONFIRMED', source: 'online', code: 'K7PZ' },
  { id: 'b2', kind: 'booking', dateKey: today, startMin: 690, endMin: 720, staffId: 'a', staffName: 'Mía', serviceId: 's2', serviceName: 'Arreglo de ruedo', price: 6000, customerName: 'Lucía Fernández', customerPhone: '11 4444-1234', status: 'PENDING', source: 'online', code: 'Q2M8', customerNote: 'Son dos jeans' },
  { id: 'b3', kind: 'block', dateKey: today, startMin: 780, endMin: 840, staffId: 'ALL', status: 'BLOCK', reason: 'Almuerzo' },
  { id: 'b4', kind: 'booking', dateKey: today, startMin: 900, endMin: 960, staffId: 'b', staffName: 'Lucía', serviceId: 's1', serviceName: 'Asesoría de imagen', price: 25000, customerName: 'Sofía Ruiz', customerPhone: '11 3333-9876', status: 'CONFIRMED', source: 'manual', code: 'AB12' },
  { id: 'h1', kind: 'booking', dateKey: addDays(today, -6), startMin: 600, endMin: 660, staffId: 'a', staffName: 'Mía', serviceId: 's1', serviceName: 'Asesoría de imagen', price: 25000, customerName: 'Carla Gómez', customerPhone: '11 5555-0004', status: 'DONE', source: 'online', code: 'H1H1', payment: { method: 'Transferencia', amount: 25000 } },
  { id: 'h2', kind: 'booking', dateKey: addDays(today, -2), startMin: 720, endMin: 750, staffId: 'b', staffName: 'Lucía', serviceId: 's2', serviceName: 'Arreglo de ruedo', price: 6000, customerName: 'Sofía Ruiz', customerPhone: '11 3333-9876', status: 'DONE', source: 'manual', code: 'H2H2', payment: { method: 'Efectivo', amount: 6000 } },
  { id: 'h3', kind: 'booking', dateKey: addDays(today, -1), startMin: 660, endMin: 720, staffId: 'a', staffName: 'Mía', serviceId: 's1', serviceName: 'Asesoría de imagen', price: 25000, customerName: 'Martina López', customerPhone: '11 7777-2020', status: 'NO_SHOW', source: 'online', code: 'H3H3' },
  { id: 'b5', kind: 'booking', dateKey: addDays(today, 1), startMin: 630, endMin: 690, staffId: 'b', staffName: 'Lucía', serviceId: 's1', serviceName: 'Asesoría de imagen', price: 25000, customerName: 'Valentina Paz', customerPhone: '11 2222-1111', status: 'CONFIRMED', source: 'online', code: 'ZX45' },
];
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
export async function deleteBooking(_s: string, id: string) { list = list.filter((b) => b.id !== id); emit(); }
export function whatsappToCustomer(b: Booking, businessName: string, kind: string) {
  return `https://wa.me/549${(b.customerPhone || '').replace(/\D/g, '')}?text=${encodeURIComponent(`${kind} ${businessName} ${dayLabel(b.dateKey)} ${hhmm(b.startMin)}`)}`;
}
