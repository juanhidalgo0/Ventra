import { comingSoon } from './comingSoon';

/**
 * Maquinitas Point de Mercado Pago que usa ESTA caja. Cada PC elige las suyas en
 * Configuración → Integraciones (pueden ser varias, cada una con un nombre); si hay
 * alguna, cobrar con Mercado Pago en el POS manda el monto a la maquinita elegida y la
 * venta se registra recién cuando se aprueba.
 */
const KEY = 'mp_point_terminals';
const LEGACY_KEY = 'mp_point_terminal';
const LAST_KEY = 'mp_point_last';

export interface PointTerminalChoice {
  id: string;
  label: string;
}

export function getPointTerminals(): PointTerminalChoice[] {
  // Mercado Pago todavía no está habilitado: ningún cobro va al Point
  if (comingSoon('mercadoPago')) return [];
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (Array.isArray(list)) return list.filter((t) => t && typeof t.id === 'string' && t.id);
    // Antes se guardaba una sola
    const one = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null');
    return one && typeof one.id === 'string' && one.id ? [one] : [];
  } catch {
    return [];
  }
}

export function setPointTerminals(list: PointTerminalChoice[]) {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
    else localStorage.removeItem(KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch { /* sin almacenamiento */ }
}

/** La última maquinita con la que se cobró en esta caja (queda marcada por defecto) */
export function getLastPointTerminalId(): string | null {
  try { return localStorage.getItem(LAST_KEY); } catch { return null; }
}

export function setLastPointTerminalId(id: string) {
  try { localStorage.setItem(LAST_KEY, id); } catch { /* sin almacenamiento */ }
}

/** "NEWLAND_N950__N950NCB801293324" → "N950 · N° 293324" */
export function terminalLabel(id: string) {
  const [model, serial] = String(id).split('__');
  const shortModel = (model || '').split('_').pop() || model || 'Point';
  return serial ? `${shortModel} · N° ${serial.slice(-6)}` : id;
}

/** ¿Este medio de pago del POS es Mercado Pago? (el id por defecto o un posnet llamado así) */
export function isMercadoPagoMethod(method: string, posnets: { id: string; name: string }[] = []) {
  if (method === 'MERCADOPAGO') return true;
  const p = posnets.find((x) => x.id === method);
  return !!p && p.name.toLowerCase().replace(/\s+/g, '').includes('mercadopago');
}
