import type { BusinessIntent, BusinessProfile } from '../stores/businessStore';
import { AGENDA_TEMPLATES } from './agendaTemplates';

/**
 * Rubro con el que el comercio se suscribió desde una landing por rubro (ventra.store/peluquerias…).
 * Lo guarda la nube en la cuenta (signupRubro) y llega en la licencia firmada (/subscription/status).
 * Solo sirve para arrancar con cosas ya elegidas: el dueño lo puede cambiar todo en la bienvenida.
 * Misma lista que SIGNUP_RUBROS en firebase/functions/index.js.
 */
const CAJA_RUBROS: Record<string, BusinessProfile> = {
  kiosco: 'KIOSKO',
  ferreteria: 'FERRETERIA',
  ropa: 'INDUMENTARIA',
  gastronomia: 'GASTRONOMIA',
  multirubro: 'MULTIRUBRO',
};

/** Perfil de la caja que corresponde al rubro, si es un rubro de venta. */
export const profileForRubro = (rubro: string | null | undefined): BusinessProfile | null =>
  (rubro && CAJA_RUBROS[rubro]) || null;

/** Plantilla de la agenda que corresponde al rubro, si es un rubro de turnos. */
export const agendaTemplateForRubro = (rubro: string | null | undefined): string | null =>
  rubro && AGENDA_TEMPLATES.some((t) => t.id === rubro) ? rubro : null;

/** Qué vino a hacer, según la landing: un rubro de turnos marca "Dar turnos". */
export const intentForRubro = (rubro: string | null | undefined): BusinessIntent | null =>
  profileForRubro(rubro) ? 'mostrador' : agendaTemplateForRubro(rubro) ? 'turnos' : null;
