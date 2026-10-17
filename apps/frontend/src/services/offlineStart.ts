/**
 * Arranque sin señal. Al abrir, la app baja categorías, catálogo, promociones y clientes; si
 * el servidor no responde (el vendedor en la ruta, sin señal) arranca con lo último que bajó
 * este equipo y sigue probando de fondo. Se guarda en IndexedDB: el catálogo no entra en
 * localStorage. Cada comercio y servidor tiene su copia (no se mezclan si se cambia de caja).
 */
const DB_NAME = 'ventra_offline';
const STORE = 'kv';
export const OFFLINE_EVENT = 'ventra-offline-start';

export interface WarmData {
  categories: any[];
  products: any[];
  promotions: any[];
  clients: any[];
  savedAt: string;
}

const keyFor = () => `warm:${localStorage.getItem('server_ip') || location.host}`;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveWarmData(data: Omit<WarmData, 'savedAt'>) {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ ...data, savedAt: new Date().toISOString() }, keyFor());
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* sin IndexedDB (modo privado): la próxima vez se baja de nuevo */ }
}

export async function loadWarmData(): Promise<WarmData | null> {
  try {
    const db = await open();
    const data = await new Promise<WarmData | null>((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(keyFor());
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return data && Array.isArray(data.products) ? data : null;
  } catch {
    return null;
  }
}

/** El servidor no contestó (sin señal, apagado, la nube despertando): no es un rechazo */
export const isUnreachable = (err: any) => !err?.response || [502, 503, 504].includes(err.response.status);

/** El servidor está en esta misma PC: tarda unos segundos en arrancar, hay que esperarlo */
export function isLocalServer() {
  const ip = (localStorage.getItem('server_ip') || '').replace(/^https?:\/\//, '');
  const host = ip || location.host;
  return /^(localhost|127\.|\[::1\])/.test(host);
}

/** Estado del arranque sin señal (lo muestra el aviso de MainLayout) */
let offlineSince: string | null = null;
export const offlineStartedWith = () => offlineSince;
export function markOfflineStart(savedAt: string | null) {
  offlineSince = savedAt;
  window.dispatchEvent(new CustomEvent(OFFLINE_EVENT));
}
