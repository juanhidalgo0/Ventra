/**
 * Solo la app (Tauri o el navegador en esta PC o en otra del local) y los sitios de
 * Ventra pueden leer las respuestas del backend. Cualquier otra página abierta en la PC
 * de la caja no puede usarlo. Lo comparten la API y el canal en tiempo real.
 */
export function isAllowedOrigin(origin: string): boolean {
  let url: URL;
  try { url = new URL(origin); } catch { return false; }
  const host = url.hostname;
  if (url.protocol === 'tauri:') return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '[::1]') return true;
  // Otras PCs del local que abren la app por la IP de esta
  if (/^(10\.\d+|192\.168|172\.(1[6-9]|2\d|3[01]))\.\d+\.\d+$/.test(host)) return true;
  if (url.protocol !== 'https:') return false;
  return host === 'ventra.store' || host.endsWith('.ventra.store')
    || host === 'ventra-9cba5.web.app' || host === 'ventra-9cba5.firebaseapp.com';
}
