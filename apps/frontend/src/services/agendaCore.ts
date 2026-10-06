import type { DayHours } from './onlineStore';

/**
 * Agenda de turnos: tipos y cuentas de horarios, sin Firebase (lo usan la app y el
 * entorno de prueba). Misma lógica que firebase/functions/agenda.js y la tienda.
 * Horario de Argentina (UTC-3): las horas se guardan como minutos del día.
 */

export interface AgendaService {
  id: string;
  name: string;
  durationMin: number;
  price: number;
  description?: string;
  /** Profesionales que lo hacen (vacío = todos) */
  staffIds?: string[];
  active?: boolean;
}

export interface AgendaStaff {
  id: string;
  name: string;
  color?: string;
  /** Horario semanal (0 = domingo), mismo formato que el horario de la tienda */
  hours: DayHours[];
  active?: boolean;
}

export interface AgendaConfig {
  enabled: boolean;
  services: AgendaService[];
  staff: AgendaStaff[];
  /** Cada cuántos minutos se ofrecen horarios */
  slotStepMin: number;
  /** Minutos libres entre un turno y el siguiente */
  bufferMin: number;
  /** Anticipación mínima para reservar online (minutos) */
  minNoticeMin: number;
  /** Hasta cuántos días para adelante se puede reservar */
  maxDaysAhead: number;
  /** Si es false, los turnos online quedan "Por confirmar" */
  autoConfirm: boolean;
  /**
   * Seña con Mercado Pago al reservar online (la cobra la función agendaBook con la cuenta de MP
   * conectada del comercio). percent: % del precio; fixed: monto fijo. Nunca más que el precio.
   */
  deposit?: { enabled: boolean; mode: 'percent' | 'fixed'; value: number };
  /** Tipo de servicio (plantilla con la que arrancó: peluqueria, salud...). Adapta textos y recorridos. */
  kind?: string;
  /** Recordatorio automático por WhatsApp desde el número de Ventra (firebase/functions/whatsapp.js) */
  reminders?: { enabled: boolean; when: ReminderWhen };
  /** Recordatorio por email, gratis en todos los planes. Sin el campo = prendido. */
  emailReminders?: { enabled: boolean };
}

/** Cuándo sale el recordatorio automático (mismas claves que WHEN en whatsapp.js) */
export type ReminderWhen = 'dayBefore18' | 'dayBefore20' | 'hours3' | 'hours2';
export const REMINDER_WHEN: [ReminderWhen, string][] = [
  ['dayBefore18', 'El día anterior a las 18 h'],
  ['dayBefore20', 'El día anterior a las 20 h'],
  ['hours3', '3 horas antes'],
  ['hours2', '2 horas antes'],
];

/** Recordatorio automático de un turno: lo escribe la nube */
export interface BookingReminder {
  /** noquota: la cuenta se quedó sin recordatorios automáticos este mes (reminder-quota.js) */
  status: 'sending' | 'retry' | 'sent' | 'delivered' | 'read' | 'failed' | 'noquota';
  tries?: number;
  error?: string;
}

export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'DONE' | 'NO_SHOW' | 'CANCELLED' | 'BLOCK' | 'AWAITING_PAYMENT';

export interface Booking {
  id: string;
  kind: 'booking' | 'block';
  dateKey: string;
  startMin: number;
  endMin: number;
  staffId: string;
  staffName?: string;
  serviceId?: string;
  serviceName?: string;
  durationMin?: number;
  price?: number;
  customerName?: string;
  /** 'client': lo canceló el cliente con el link de su turno */
  cancelledBy?: 'client' | 'expired';
  /** Cuándo se le mandó el recordatorio por WhatsApp */
  remindedAt?: any;
  /** 'auto': lo mandó Ventra solo (ver reminder) */
  remindedBy?: 'auto';
  reminder?: BookingReminder;
  /** Tocó "Confirmo" en el recordatorio */
  clientConfirmedAt?: any;
  cancelVia?: 'whatsapp';
  /** Esperando seña: hasta cuándo se aparta el horario */
  holdUntil?: any;
  /** Seña pedida al reservar online */
  deposit?: { amount: number; status: 'pending' | 'paid'; paidAmount?: number; paymentId?: string; refundNeeded?: boolean };
  /** Día y hora anteriores, si se reprogramó */
  movedFrom?: { dateKey: string; startMin: number };
  customerPhone?: string;
  /** Opcional en la reserva online: para el recordatorio por email */
  customerEmail?: string;
  customerNote?: string;
  customerPhoneKey?: string;
  code?: string;
  status: BookingStatus;
  /** Cobro del turno (planes sin caja): queda como atendido */
  payment?: BookingPayment;
  source?: 'online' | 'manual';
  reason?: string;
  createdAt?: any;
}

export interface BookingPayment { method: string; amount: number; at?: any }

/** Medios de cobro de un turno. */
export const PAY_METHODS = ['Efectivo', 'Transferencia', 'Mercado Pago', 'Débito', 'Crédito'];

/** Resumen de un cliente de la agenda (ventra_stores/{id}/agenda_clients/{key}). */
export interface AgendaClient {
  key: string;
  name: string;
  phone: string;
  visits: number;
  noShows: number;
  cancelled: number;
  spent: number;
  firstDate?: string;
  lastVisit: string | null;
  lastService?: string;
  next: { dateKey: string; startMin: number; serviceName: string } | null;
  note?: string;
}

// Misma lógica que clientKeyOf / aggregateClient de firebase/functions/agenda.js: mantener iguales.
const phoneKeyOf = (phone?: string) => String(phone || '').replace(/\D/g, '').slice(-10);
const nameKeyOf = (name?: string) => String(name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

/** Clave del cliente de un turno: el teléfono si tiene, si no el nombre. null para bloqueos. */
export function clientKeyOf(b: Partial<Booking> | null | undefined): string | null {
  if (!b || b.kind !== 'booking') return null;
  const phone = b.customerPhoneKey || phoneKeyOf(b.customerPhone);
  if (phone.length >= 6) return 'p' + phone;
  const name = nameKeyOf(b.customerName);
  return name ? 'n_' + name : null;
}

export function aggregateClient(bookings: Booking[], todayKey: string): Omit<AgendaClient, 'key' | 'note'> | null {
  const list = bookings.filter((b) => b.kind === 'booking').sort((a, b) => a.dateKey.localeCompare(b.dateKey) || a.startMin - b.startMin);
  if (!list.length) return null;
  const last = list[list.length - 1];
  const withPhone = list.filter((b) => b.customerPhone).pop();
  const done = list.filter((b) => b.status === 'DONE' || b.payment);
  const next = list.find((b) => (b.status === 'PENDING' || b.status === 'CONFIRMED') && b.dateKey >= todayKey);
  return {
    name: last.customerName || '',
    phone: withPhone ? withPhone.customerPhone || '' : '',
    visits: done.length,
    noShows: list.filter((b) => b.status === 'NO_SHOW').length,
    cancelled: list.filter((b) => b.status === 'CANCELLED').length,
    spent: list.reduce((s, b) => s + (b.payment ? Number(b.payment.amount) || 0 : 0), 0),
    firstDate: list[0].dateKey,
    lastVisit: done.length ? done[done.length - 1].dateKey : null,
    lastService: (done.length ? done[done.length - 1] : last).serviceName || '',
    next: next ? { dateKey: next.dateKey, startMin: next.startMin, serviceName: next.serviceName || '' } : null,
  };
}

export const STAFF_COLORS = ['#DB2777', '#2563EB', '#059669', '#D97706', '#7C3AED', '#0891B2', '#DC2626', '#4B5563'];

export const newId = () => Math.random().toString(36).slice(2, 10);

export function defaultAgenda(): AgendaConfig {
  return {
    enabled: false,
    services: [],
    staff: [],
    slotStepMin: 30,
    bufferMin: 0,
    minNoticeMin: 60,
    maxDaysAhead: 30,
    autoConfirm: true,
  };
}

export const fullAgenda = (a?: Partial<AgendaConfig> | null): AgendaConfig => ({ ...defaultAgenda(), ...(a || {}) }) as AgendaConfig;

const TZ_OFFSET_MIN = -180;
const pad = (n: number) => String(n).padStart(2, '0');
export const toMin = (hhmm: string) => { const p = String(hhmm || '0:0').split(':'); return (+p[0]) * 60 + (+p[1] || 0); };
export const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

export function localNow(ms = Date.now()) {
  const d = new Date(ms + TZ_OFFSET_MIN * 60000);
  return { dateKey: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`, min: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
export function addDays(dateKey: string, n: number) {
  const d = new Date(`${dateKey}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const weekday = (dateKey: string) => new Date(`${dateKey}T12:00:00Z`).getUTCDay();
export const startAtMs = (dateKey: string, min: number) => Date.parse(`${dateKey}T00:00:00Z`) + (min - TZ_OFFSET_MIN) * 60000;

const DAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export function dayLabel(dateKey: string, short = false) {
  const [, m, d] = dateKey.split('-').map(Number);
  const today = localNow().dateKey;
  if (dateKey === today) return short ? 'Hoy' : `Hoy, ${d} de ${MONTHS[m - 1]}`;
  if (dateKey === addDays(today, 1)) return short ? 'Mañana' : `Mañana, ${d} de ${MONTHS[m - 1]}`;
  const w = DAYS[weekday(dateKey)];
  return short ? `${w.slice(0, 3)} ${d}/${m}` : `${w} ${d} de ${MONTHS[m - 1]}`;
}

function staffRanges(h?: DayHours) {
  if (!h || !h.open) return [] as { s: number; e: number }[];
  const r = h.ranges && h.ranges.length ? h.ranges : [{ from: h.from, to: h.to }];
  return r.filter((x) => x && x.from && x.to).map((x) => ({ s: toMin(x.from), e: toMin(x.to) })).filter((x) => x.e > x.s).sort((a, b) => a.s - b.s);
}

export const canDo = (staff: AgendaStaff, service: AgendaService) => !service.staffIds?.length || service.staffIds.includes(staff.id);
const OCCUPIES = new Set<BookingStatus>(['PENDING', 'CONFIRMED', 'DONE', 'BLOCK', 'AWAITING_PAYMENT']);
const holdMs = (b: Booking) => (b.holdUntil?.toMillis ? b.holdUntil.toMillis() : 0);
/** Ocupa el horario. Esperando seña ocupa solo mientras no venza el plazo para pagar. */
export const occupies = (b: Booking) => OCCUPIES.has(b.status) && (b.status !== 'AWAITING_PAYMENT' || holdMs(b) > Date.now());
/** Lo que ya pagó de seña (0 si no pagó) */
export const depositPaid = (b: Partial<Booking>) => (b.deposit?.status === 'paid' ? Number(b.deposit.paidAmount ?? b.deposit.amount) || 0 : 0);
/** Seña de un servicio según la agenda (misma cuenta que depositFor en firebase/functions/agenda.js) */
export function depositFor(agenda: AgendaConfig, service: { price?: number }) {
  const d = agenda.deposit;
  if (!d?.enabled) return 0;
  const price = Number(service.price) || 0;
  let amount = d.mode === 'fixed' ? Number(d.value) || 0 : Math.round(price * (Number(d.value) || 0) / 100);
  if (price > 0) amount = Math.min(amount, price);
  return amount >= 1 ? Math.round(amount) : 0;
}

/** Horarios de inicio libres (misma lógica que la función agendaBook y la tienda). */
export function freeStarts(agenda: AgendaConfig, staff: AgendaStaff, service: AgendaService, dateKey: string, bookings: Booking[], minStart = 0, ignoreId?: string) {
  const step = Math.max(5, Number(agenda.slotStepMin) || 15);
  const buf = Math.max(0, Number(agenda.bufferMin) || 0);
  const dur = Math.max(5, Number(service.durationMin) || 30);
  const busy = bookings.filter((b) => b.dateKey === dateKey && occupies(b) && b.id !== ignoreId);
  const out: number[] = [];
  for (const r of staffRanges(staff.hours?.[weekday(dateKey)])) {
    for (let t = r.s; t + dur <= r.e; t += step) {
      if (t < minStart) continue;
      const clash = busy.some((b) => (b.staffId === staff.id || b.staffId === 'ALL') && t < b.endMin + buf && b.startMin < t + dur + buf);
      if (!clash) out.push(t);
    }
  }
  return out;
}
