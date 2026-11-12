/**
 * Boletas sacadas con el celular sin conexión (plan-boletas-ia.md, tanda 6.4): las fotos quedan
 * guardadas en el teléfono (IndexedDB) y se mandan solas cuando vuelve la conexión. Nada se pierde si se
 * cierra la app. Si el navegador no deja guardar (modo privado), se avisa y no se encola.
 */
import api from '../services/api';

const DB_NAME = 'ventra-scan-queue';
const STORE = 'boletas';

export interface QueuedScan { id: string; at: number; files: { name: string; type: string; data: ArrayBuffer }[] }

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const r = fn(db.transaction(STORE, mode).objectStore(STORE));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

/** ¿El error es por falta de conexión? (no hubo respuesta del servidor) */
export const isOffline = (err: any) => !err?.response && (!navigator.onLine || err?.code === 'ERR_NETWORK' || err?.message === 'Network Error' || err?.code === 'ECONNABORTED');

export async function enqueueScan(files: File[]): Promise<boolean> {
  try {
    const item: QueuedScan = { id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, at: Date.now(), files: await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, data: await f.arrayBuffer() }))) };
    await tx('readwrite', (s) => s.put(item));
    return true;
  } catch {
    return false;
  }
}

export async function queuedScans(): Promise<QueuedScan[]> {
  try { return (await tx<QueuedScan[]>('readonly', (s) => s.getAll())) || []; } catch { return []; }
}

let flushing = false;
/** Manda las que esperan. Devuelve cuántas se mandaron (las que vuelven a fallar por conexión, siguen esperando). */
export async function flushScans(): Promise<number> {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const q of await queuedScans()) {
      const form = new FormData();
      q.files.forEach((f) => form.append('files', new File([f.data], f.name, { type: f.type })));
      try {
        await api.post('/purchases/scan-invoice', form, { timeout: 290000, silent: true } as any);
        await tx('readwrite', (s) => s.delete(q.id));
        sent++;
      } catch (err) {
        if (isOffline(err)) break;
        // Otro error (foto ilegible, tope de la IA): no se reintenta para siempre
        await tx('readwrite', (s) => s.delete(q.id)).catch(() => {});
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}
