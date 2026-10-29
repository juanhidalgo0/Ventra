/**
 * Links públicos del comercio: ventra.store/<dirección> (corto). /turnos abre directo la reserva y
 * /turno/<código> es el link del turno de un cliente. El de siempre, tienda.ventra.store/<dirección>, sigue andando.
 * Las direcciones del sitio de Ventra no se le dan a ningún comercio nuevo; uno viejo que ya tenga una sigue con
 * tienda.ventra.store. Misma lista en firebase/functions/store-slugs.js y firebase/tienda/index.html.
 */
export const RESERVED_SLUGS = new Set(['admin', 'panel', 'instagram', 'peluquerias', 'tienda-online', 'sistema-de-ventas', 'turnos', 'cuenta',
  'privacidad', 'terminos', 'index', 'og', 'tienda', 'tiendas', 'agenda', 'app', 'api', 'ayuda', 'blog', 'precios', 'planes', 'login',
  'registro', 'soporte', 'contacto', 'ventra', 'www', 'turno', 'reservas', 'descargar', 'paciente', 'nutricionistas']);

/** Dominio del link según la dirección (para mostrar "ventra.store/" delante del campo) */
export const storeHost = (slug?: string | null) => (slug && RESERVED_SLUGS.has(slug) ? 'tienda.ventra.store' : 'ventra.store');

/** Link público del comercio. sub: 'turnos' (abre la reserva) o 'turno/<código>' */
export function publicStoreUrl(slug?: string | null, sub = ''): string {
  if (!slug) return '';
  const s = encodeURIComponent(slug);
  if (RESERVED_SLUGS.has(slug)) return `https://tienda.ventra.store/${s}${sub === 'turnos' ? '#turnos' : ''}`;
  return `https://ventra.store/${s}${sub ? `/${sub}` : ''}`;
}
