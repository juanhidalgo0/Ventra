import { APP_VERSION } from '../appVersion';
import { usePlanStore } from '../stores/planStore';

/**
 * Errores de la caja que nadie atrapa: se mandan a la nube (ventraClientError) y aparecen
 * agrupados en el admin (pestaña Cajas). Así se ven los fallos antes de que el comercio llame.
 * Sin datos personales: mensaje, pila, versión, pantalla y el comercio (email de la cuenta o uid
 * de la caja web). Como mucho 10 por sesión y cada error distinto una sola vez.
 */
const URL = 'https://us-central1-ventra-9cba5.cloudfunctions.net/ventraClientError';
const MAX = 10;
const seen = new Set<string>();
let sent = 0;

const where = (): 'pc' | 'web' | 'celular' => {
  const w = window as any;
  if (w.__TAURI_INTERNALS__ || w.__TAURI__) return 'pc';
  return window.matchMedia?.('(pointer: coarse)').matches && window.innerWidth < 768 ? 'celular' : 'web';
};

// Ruidos del navegador que no son fallas de Ventra
const IGNORE = /ResizeObserver loop|Script error\.?$|Load failed$|Failed to fetch$|NetworkError|Network Error|status code 4\d\d|timeout of \d+ms|AbortError|canceled|cancelad/i;

export function reportError(error: unknown, extra?: string) {
  try {
    // En la PC de desarrollo (vite en localhost:5173) no se manda nada
    if (/^(localhost|127.0.0.1)$/.test(location.hostname) && location.port === '5173') return;
    const e = error instanceof Error ? error : new Error(typeof error === 'string' ? error : JSON.stringify(error)?.slice(0, 300) || 'Error');
    const message = (extra ? `${extra}: ` : '') + String(e.message || e.name || 'Error');
    if (IGNORE.test(message) || sent >= MAX || seen.has(message)) return;
    seen.add(message);
    sent++;
    const plan = usePlanStore.getState();
    const tenant = plan.isDemo ? 'demo' : (plan.email || String((window as any).__VENTRA_TENANT || '') || null);
    const body = JSON.stringify({
      message, stack: String(e.stack || '').slice(0, 1500), version: APP_VERSION || null,
      where: where(), tenant, path: location.hash.split('?')[0].slice(0, 120),
    });
    // text/plain: sin preflight de CORS; keepalive: sale aunque la pantalla se cierre
    fetch(URL, { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }).catch(() => {});
  } catch { /* reportar nunca puede romper la caja */ }
}

let installed = false;
export function installErrorReport() {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (ev) => reportError(ev.error || ev.message));
  window.addEventListener('unhandledrejection', (ev) => reportError(ev.reason, 'Promesa'));
}
