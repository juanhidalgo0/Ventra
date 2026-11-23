// SOLO DESARROLLO (grabación de videos): reemplaza a services/ventraFirebase en /reel-tienda.html.
// La grabación no se conecta a Firebase: la sesión "existe" siempre y la base no se usa.
export const STORE_ID_KEY = 'ventra_store_id';
export function getVentraApp(): any { return {}; }
export function getVentraDb(): any { return {}; }
export function getVentraStorage(): any { return {}; }
export function ensureVentraSession(): Promise<any> { return Promise.resolve({ uid: 'reel-demo' }); }
/** ?pro=<id del profesional>: la agenda como la ve un profesional con usuario propio */
export function sessionProStaffId(): string | null { return new URLSearchParams(location.search).get('pro'); }
