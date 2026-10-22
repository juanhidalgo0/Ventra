import { setStoreSetting } from './storeSettings';

/**
 * Recorrido fijo de la distribuidora: qué días se visita cada localidad (lunes Magdalena,
 * martes Bavio...). Es configuración del comercio: viaja a todos los equipos con el resto
 * (store_settings.route_days) y se lee de localStorage, así anda también sin señal.
 * Días como en JavaScript: 0 domingo … 6 sábado.
 */
const KEY = 'ventra_route_days';
export const ROUTE_DAYS_EVENT = 'ventra:route-days';

export const WEEK = [
  { day: 1, short: 'L', name: 'lunes' },
  { day: 2, short: 'M', name: 'martes' },
  { day: 3, short: 'X', name: 'miércoles' },
  { day: 4, short: 'J', name: 'jueves' },
  { day: 5, short: 'V', name: 'viernes' },
  { day: 6, short: 'S', name: 'sábado' },
];
export const dayName = (d: number) => (d === 0 ? 'domingo' : WEEK.find((w) => w.day === d)?.name || '');

export type RouteDays = Record<string, number[]>;

export function readRouteDays(): RouteDays {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export function saveRouteDays(map: RouteDays) {
  const clean: RouteDays = {};
  for (const [zone, days] of Object.entries(map)) if (days?.length) clean[zone] = [...new Set(days)].sort();
  // setStoreSetting lo guarda en este equipo y lo sube (si se escribiera antes acá, creería que no cambió)
  setStoreSetting('route_days', JSON.stringify(clean));
  window.dispatchEvent(new CustomEvent(ROUTE_DAYS_EVENT));
  // La tienda (venta a comercios) muestra "próximo reparto": se le pasan los días nuevos si está activa
  import('./onlineStore').then((m) => m.syncWholesaleRouteDays(clean)).catch(() => {});
}

/** Las localidades que tocan este día (por defecto, hoy) */
export function zonesFor(map: RouteDays, date = new Date()) {
  const d = date.getDay();
  return Object.entries(map).filter(([, days]) => days.includes(d)).map(([zone]) => zone).sort((a, b) => a.localeCompare(b, 'es'));
}
