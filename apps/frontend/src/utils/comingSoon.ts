import { usePlanStore } from '../stores/planStore';

/**
 * Funciones terminadas a medias que todavía no se ofrecen: se ven como "Próximamente".
 * Para habilitar una, ponerla en false (el resto del código queda intacto).
 */
export const COMING_SOON = {
  /** Leer boletas desde fotos con IA (los PDF con texto y los Excel se leen igual, sin IA) */
  aiInvoiceScan: true,
  /** Mercado Pago: conectar la cuenta, cobrar con Point y cuadrar la caja automáticamente. Habilitado para todos
   *  el 2026-10-15 para probar la seña de la agenda con una cuenta real (todavía sin un pago real probado). */
  mercadoPago: false,
  /** Facturación electrónica con ARCA */
  arcaInvoicing: true,
  /** Facturar autorizando a la CUIT de Ventra (delegación). Por ahora cada comercio usa su propio certificado */
  arcaDelegation: true,
  /** Recordatorio de turnos por email (falta la clave de Resend y verificar el dominio ventra.store) */
  emailReminders: true,
} as const;

/**
 * Cuentas de Ventra que ya prueban lo que está en "Próximamente" (con su cuenta real), antes de
 * habilitarlo para todos. Se reconoce por el email de la suscripción (/subscription/status).
 */
const EARLY_ACCESS: Partial<Record<keyof typeof COMING_SOON, string[]>> = {
  mercadoPago: ['juanhidalgobass@gmail.com'],
};

/** true = esta función todavía se muestra como "Próximamente" para esta cuenta */
export function comingSoon(key: keyof typeof COMING_SOON): boolean {
  if (!COMING_SOON[key]) return false;
  const email = (usePlanStore.getState().email || '').toLowerCase();
  return !(email && EARLY_ACCESS[key]?.includes(email));
}
