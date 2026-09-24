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
}

export type BookingStatus = 'PENDING' | 'CONFIRMED' | 'DONE' | 'NO_SHOW' | 'CANCELLED' | 'BLOCK';

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
  customerPhone?: string;
  customerNote?: string;
  code?: string;
  status: BookingStatus;
  source?: 'online' | 'manual';
  reason?: string;
  createdAt?: any;
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
const OCCUPIES = new Set<BookingStatus>(['PENDING', 'CONFIRMED', 'DONE', 'BLOCK']);
export const occupies = (b: Booking) => OCCUPIES.has(b.status);

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
