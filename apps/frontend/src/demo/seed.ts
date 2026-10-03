// SOLO DEMO PÚBLICA: datos de ejemplo de la tienda y la agenda, guardados en el navegador del
// visitante por la Firestore local (firebase/firestore.ts). Nada de esto existe en el Firebase real.
import { localNow, addDays, startAtMs } from '../services/agendaCore';

export const DEMO_UID = 'demo_owner';
export const DEMO_STORE_ID = 'store_demo';

const week = (from: string, to: string, closedSunday = true) =>
  [0, 1, 2, 3, 4, 5, 6].map((d) => ({ open: !(closedSunday && d === 0), from, to }));

export function seedDemoData(put: (path: string, data: Record<string, any>) => void) {
  const now = Date.now();
  const staff = [
    { id: 'st_lu', name: 'Lucía', color: '#DB2777', hours: week('09:00', '18:00'), active: true },
    { id: 'st_ma', name: 'Martín', color: '#2563EB', hours: week('12:00', '20:00'), active: true },
  ];
  const services = [
    { id: 'sv_consulta', name: 'Consulta', durationMin: 30, price: 9000, active: true },
    { id: 'sv_sesion', name: 'Sesión completa', durationMin: 90, price: 28000, staffIds: ['st_lu'], active: true },
    { id: 'sv_seguimiento', name: 'Seguimiento', durationMin: 30, price: 6000, staffIds: ['st_ma'], active: true },
  ];

  put(`ventra_stores/${DEMO_STORE_ID}`, {
    businessName: 'Ventra Demo',
    rubro: 'OTRO',
    subdomain: 'demo',
    whatsappNumber: '',
    primaryColor: '#0E6E52',
    secondaryColor: '#1e293b',
    isPublished: false,
    description: 'Tienda y turnos de ejemplo',
    hours: week('09:00', '20:00'),
    pickupEnabled: true,
    paymentMethods: ['Efectivo', 'Transferencia'],
    showOutOfStock: true,
    agenda: { enabled: true, services, staff, slotStepMin: 30, bufferMin: 0, minNoticeMin: 60, maxDaysAhead: 30, autoConfirm: true },
    ownerUid: DEMO_UID,
    claimed: true,
    createdAt: { __ts: now },
    updatedAt: { __ts: now },
  });

  const today = localNow().dateKey;
  const clients = [
    ['Sofía Gómez', '11 5555-0101'], ['Diego Pérez', '11 5555-0102'], ['Valentina Ruiz', '11 5555-0103'],
    ['Tomás Díaz', '11 5555-0104'], ['Camila López', '11 5555-0105'],
  ];
  const bookings: [number, number, number, number, string][] = [
    // [día relativo, hora (min), cliente, servicio, estado]
    [-2, 600, 0, 0, 'DONE'], [-1, 660, 1, 2, 'DONE'], [-1, 720, 3, 0, 'NO_SHOW'],
    [0, 600, 2, 1, 'CONFIRMED'], [0, 780, 4, 0, 'CONFIRMED'], [0, 840, 1, 2, 'PENDING'],
    [1, 630, 0, 1, 'CONFIRMED'], [1, 900, 3, 0, 'CONFIRMED'], [2, 720, 4, 2, 'CONFIRMED'],
  ];
  bookings.forEach(([day, start, ci, si, status], i) => {
    const sv = services[si];
    const st = sv.staffIds ? staff.find((s) => s.id === sv.staffIds![0])! : staff[i % 2];
    const dateKey = addDays(today, day);
    const [name, phone] = clients[ci];
    put(`ventra_stores/${DEMO_STORE_ID}/bookings/demo_b${i}`, {
      kind: 'booking', dateKey, startMin: start, endMin: start + sv.durationMin,
      startAt: { __ts: startAtMs(dateKey, start) },
      staffId: st.id, staffName: st.name, serviceId: sv.id, serviceName: sv.name, durationMin: sv.durationMin, price: sv.price,
      customerName: name, customerPhone: phone, customerPhoneKey: phone.replace(/\D/g, '').slice(-10), customerNote: '',
      code: `D${i}X${ci}`, status, source: i % 3 === 0 ? 'online' : 'manual',
      ...(status === 'DONE' ? { payment: { method: 'Efectivo', amount: sv.price, at: { __ts: now } } } : {}),
      createdAt: { __ts: now },
    });
  });
}
