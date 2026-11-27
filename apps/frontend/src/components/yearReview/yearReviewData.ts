import api from '../../services/api';

/** Lo que devuelve GET /sales/year-review */
export interface YearReview {
  from: string;
  to: string;
  total: number;
  tickets: number;
  daysOpen: number;
  avgTicket: number;
  bestDay: { day: string; total: number; tickets: number } | null;
  months: { month: number; total: number; tickets: number }[];
  hours: { hour: number; tickets: number }[];
  weekdays: { weekday: number; total: number; tickets: number }[];
  topProducts: { id: string; name: string; qty: number; revenue: number; unit: string; image: string | null }[];
  unitsSold: number;
  distinctProducts: number;
  payments: Record<string, number>;
  topClient: { name: string; tickets: number; total: number } | null;
  biggestTicket: number;
  previous: { total: number; tickets: number } | null;
  firstSaleAt: string | null;
}

/** Menos que esto no alcanza para un resumen que valga la pena */
export const MIN_TICKETS = 30;

/** El año del resumen: en noviembre y diciembre el que corre; de enero a octubre, el anterior. */
export function reviewYear(now = new Date()) {
  return now.getMonth() >= 10 ? now.getFullYear() : now.getFullYear() - 1;
}

/** Del 1 de diciembre al 31 de enero se le ofrece solo al dueño */
export function isReviewSeason(now = new Date()) {
  return now.getMonth() === 11 || now.getMonth() === 0;
}

export async function fetchYearReview(year: number): Promise<YearReview> {
  const from = new Date(year, 0, 1, 0, 0, 0, 0);
  const endOfYear = new Date(year, 11, 31, 23, 59, 59, 999);
  const to = endOfYear.getTime() < Date.now() ? endOfYear : new Date();
  const { data } = await api.get<YearReview>('/sales/year-review', {
    params: { from: from.toISOString(), to: to.toISOString(), tzOffset: new Date().getTimezoneOffset() },
  });
  return data;
}

// ── Textos ────────────────────────────────────────────────────────────

export const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const DIAS_PLURAL = ['los domingos', 'los lunes', 'los martes', 'los miércoles', 'los jueves', 'los viernes', 'los sábados'];

export const money = (n: number) => `$${Math.round(n).toLocaleString('es-AR')}`;
export const int = (n: number) => Math.round(n).toLocaleString('es-AR');

/** $12,3 M / $850 mil: para títulos grandes */
export function moneyShort(n: number) {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} mil M`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toLocaleString('es-AR', { maximumFractionDigits: 1 })} M`;
  if (n >= 10_000) return `$${Math.round(n / 1000).toLocaleString('es-AR')} mil`;
  return money(n);
}

export function dayLong(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, (m || 1) - 1, d || 1);
  const wd = date.toLocaleDateString('es-AR', { weekday: 'long' });
  return `${wd.charAt(0).toUpperCase()}${wd.slice(1)} ${d} de ${MESES[(m || 1) - 1]}`;
}

export function peakHour(r: YearReview) {
  return r.hours.reduce<{ hour: number; tickets: number } | null>((b, h) => (!b || h.tickets > b.tickets ? h : b), null);
}

export function bestWeekday(r: YearReview) {
  return r.weekdays.reduce<{ weekday: number; total: number } | null>((b, w) => (!b || w.total > b.total ? w : b), null);
}

export function bestMonth(r: YearReview) {
  return r.months.reduce<{ month: number; total: number } | null>((b, m) => (!b || m.total > b.total ? m : b), null);
}

export function growthPct(r: YearReview) {
  return r.previous && r.previous.total > 0 ? Math.round(((r.total - r.previous.total) / r.previous.total) * 100) : null;
}

export function qtyLabel(qty: number, unit: string) {
  if (unit === 'KG') return `${qty.toLocaleString('es-AR', { maximumFractionDigits: 1 })} kg`;
  if (unit === 'L') return `${qty.toLocaleString('es-AR', { maximumFractionDigits: 1 })} litros`;
  if (unit === 'MT') return `${qty.toLocaleString('es-AR', { maximumFractionDigits: 1 })} metros`;
  return `${int(qty)} ${Math.round(qty) === 1 ? 'unidad' : 'unidades'}`;
}

/** Cómo te pagaron, en grupos que entiende cualquiera */
export function paymentGroups(r: YearReview) {
  const groups: Record<string, number> = {};
  for (const [method, amount] of Object.entries(r.payments)) {
    if (amount <= 0) continue;
    const m = method.toUpperCase();
    const g = m === 'CASH' ? 'Efectivo'
      : m === 'MERCADOPAGO' || m === 'QR' ? 'Mercado Pago'
      : m.startsWith('TRANSFER') ? 'Transferencia'
      : m === 'CLOVER' || m.includes('CARD') || m.includes('DEBIT') || m.includes('CREDIT') ? 'Tarjeta'
      : m.includes('ACCOUNT') || m.includes('CUENTA') ? 'Cuenta corriente'
      : 'Otros';
    groups[g] = (groups[g] || 0) + amount;
  }
  const sum = Object.values(groups).reduce((a, b) => a + b, 0);
  return Object.entries(groups)
    .map(([label, amount]) => ({ label, amount, pct: sum ? Math.round((amount / sum) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

/** Una frase según la hora pico */
export function hourPhrase(hour: number) {
  if (hour < 9) return 'Madrugás más que el sol';
  if (hour < 12) return 'Las mañanas son tuyas';
  if (hour < 14) return 'El mediodía no perdona';
  if (hour < 17) return 'La siesta, ¿qué es eso?';
  if (hour < 20) return 'La tarde explota';
  return 'Tu negocio es de noche';
}
