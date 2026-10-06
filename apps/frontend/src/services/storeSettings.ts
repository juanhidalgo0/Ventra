import api from './api';

/**
 * Configuración del COMERCIO (no del equipo) guardada en el servidor (/settings, tabla
 * store_settings). El sync la lleva a las otras cajas, a la nube y al celular: reinstalar o
 * entrar desde otro dispositivo ya no la pierde.
 *
 * Las pantallas la siguen leyendo de localStorage como siempre; acá se baja lo del servidor a
 * localStorage y se sube lo que se cambia con `setStoreSetting`. Lo que es de cada equipo
 * (impresora, modo rendimiento, conexión, vista del POS) se queda solo en el navegador.
 */

/** Ajuste del comercio → clave de localStorage donde lo leen las pantallas. */
const SHARED: Record<string, string> = {
  business_profile: 'business_profile',
  business_features: 'business_features',
  /** Qué hace el comercio con Ventra (mostrador, online, turnos): ordena el menú */
  business_intents: 'business_intents',
  /** La bienvenida del primer uso ya se hizo (en cualquier equipo del comercio) */
  onboarding_done: 'onboarding_done',
  /** Ya compartió el link de reservas alguna vez (paso de "Primeros pasos") */
  agenda_link_shared: 'agenda_link_shared',
  store_name: 'gd_store_name',
  allow_negative_stock: 'allow_negative_stock',
  low_stock_alerts: 'low_stock_alerts',
  hourly_rate: 'hourly_rate',
  pos_disable_change_calculator: 'pos_disable_change_calculator',
  virtual1_code: 'virtual1_code',
  virtual2_code: 'virtual2_code',
  virtual1_surcharge: 'virtual1_surcharge',
  virtual2_surcharge: 'virtual2_surcharge',
  purchase_default_margin: 'purchase_default_margin',
  purchase_use_iva: 'purchase_use_iva',
  earnings_division_partners: 'earnings_division_partners',
  /** Los empleados pueden registrar su consumo (sin cargo, solo descuenta stock): '1' / '0' */
  employee_consumption: 'employee_consumption',
};

export type StoreSettingKey = keyof typeof SHARED;

/** Avisa qué ajustes cambiaron porque llegaron del servidor (otro equipo los tocó). */
export const STORE_SETTINGS_EVENT = 'ventra:store-settings';

/** Ajustes cambiados en este equipo que todavía no llegaron al servidor (sin conexión, por ejemplo). */
const PENDING_KEY = 'store_settings_pending';

const readPending = (): string[] => {
  try { const v = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
};
const writePending = (keys: string[]) => {
  try {
    if (keys.length) localStorage.setItem(PENDING_KEY, JSON.stringify([...new Set(keys)]));
    else localStorage.removeItem(PENDING_KEY);
  } catch { /* sin espacio */ }
};

const localValue = (key: string) => localStorage.getItem(SHARED[key]);

/** Solo el dueño guarda la configuración en el servidor (PUT /settings pide ADMIN). */
const isAdmin = () => {
  if (sessionStorage.getItem('admin_unlocked') === 'true') return true;
  try { return JSON.parse(localStorage.getItem('user') || 'null')?.role === 'ADMIN'; } catch { return false; }
};

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushing: Promise<void> | null = null;

/** Sube los ajustes pendientes. Sin permiso (cajero, suscripción vencida) quedan solo en este equipo. */
async function flush(): Promise<void> {
  if (flushing) return flushing;
  const keys = readPending();
  if (!keys.length) return;
  const values: Record<string, string | null> = {};
  for (const k of keys) if (SHARED[k]) values[k] = localValue(k);
  flushing = (async () => {
    try {
      await api.put('/settings', { values });
      // Lo que se cambió mientras subía queda para la próxima
      writePending(readPending().filter((k) => !(k in values) || localValue(k) !== values[k]));
    } catch (err: any) {
      const status = err?.response?.status;
      if (status === 401 || status === 403 || status === 400) writePending(readPending().filter((k) => !(k in values)));
      // Sin conexión o servidor caído: se reintenta en la próxima sincronización
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}

/** Guarda un ajuste del comercio: queda en este equipo al instante y viaja al resto. */
export function setStoreSetting(key: StoreSettingKey, value: string) {
  if (localStorage.getItem(SHARED[key]) === value && !readPending().includes(key)) return; // sin cambios
  try { localStorage.setItem(SHARED[key], value); } catch { /* sin espacio */ }
  writePending([...readPending(), key]);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => { flushTimer = null; flush(); }, 400);
}

/**
 * Baja los ajustes del servidor y los deja en localStorage. Los que el servidor todavía no
 * tiene (primera vez después de actualizar) se suben desde este equipo; si dos equipos los
 * suben a la vez, gana el primero y el otro lo adopta en la vuelta siguiente.
 */
export async function syncStoreSettings(): Promise<void> {
  let remote: Record<string, unknown>;
  try {
    const { data } = await api.get('/settings', { silent: true } as any);
    remote = data && typeof data === 'object' ? data : {};
  } catch {
    return; // backend viejo o sin conexión: queda lo local
  }
  const pending = new Set(readPending());
  const changed: string[] = [];
  const missing: string[] = [];
  for (const [key, lsKey] of Object.entries(SHARED)) {
    if (pending.has(key)) continue; // lo cambiado acá y no subido todavía manda
    if (key in remote && remote[key] !== null && remote[key] !== undefined) {
      const value = typeof remote[key] === 'string' ? (remote[key] as string) : JSON.stringify(remote[key]);
      if (localStorage.getItem(lsKey) !== value) {
        try { localStorage.setItem(lsKey, value); changed.push(key); } catch { /* sin espacio */ }
      }
    } else if (localStorage.getItem(lsKey) !== null) {
      missing.push(key);
    }
  }
  if (missing.length && isAdmin()) writePending([...readPending(), ...missing]);
  if (changed.length) window.dispatchEvent(new CustomEvent(STORE_SETTINGS_EVENT, { detail: changed }));
  await flush();
}

let started = false;
let lastRun = 0;

/** Primera sincronización de la sesión (haya andado o no): para decidir con los datos del comercio. */
let markReady: () => void = () => {};
const ready = new Promise<void>((resolve) => { markReady = resolve; });
export const whenStoreSettingsReady = () => ready;

/** Sincroniza al entrar, al volver a la ventana (como mucho una vez por minuto) y cada 5 minutos. */
export function startStoreSettingsSync(): () => void {
  if (started) return () => {};
  started = true;
  const run = () => { lastRun = Date.now(); syncStoreSettings().finally(markReady); };
  const onFocus = () => { if (Date.now() - lastRun > 60_000) run(); };
  run();
  const timer = setInterval(run, 5 * 60_000);
  window.addEventListener('focus', onFocus);
  return () => {
    started = false;
    clearInterval(timer);
    window.removeEventListener('focus', onFocus);
  };
}
