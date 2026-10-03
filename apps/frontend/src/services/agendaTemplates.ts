import type { AgendaService } from './agendaCore';

/**
 * Servicios típicos por rubro para no arrancar la agenda en blanco: el comercio elige el suyo,
 * retoca nombres y duraciones y pone sus precios (van en 0: cambian demasiado de un lugar a
 * otro como para sugerirlos).
 */
export interface AgendaTemplate { id: string; emoji: string; title: string; services: Omit<AgendaService, 'id'>[] }

const s = (name: string, durationMin: number): Omit<AgendaService, 'id'> => ({ name, durationMin, price: 0, active: true });

export const AGENDA_TEMPLATES: AgendaTemplate[] = [
  { id: 'peluqueria', emoji: '💇', title: 'Peluquería', services: [s('Corte', 30), s('Corte y brushing', 45), s('Color', 90), s('Mechas / reflejos', 120), s('Alisado', 150), s('Peinado', 45)] },
  { id: 'barberia', emoji: '💈', title: 'Barbería', services: [s('Corte', 30), s('Barba', 20), s('Corte y barba', 45), s('Perfilado de cejas', 10)] },
  { id: 'unas', emoji: '💅', title: 'Uñas', services: [s('Esmaltado semipermanente', 60), s('Kapping', 75), s('Esculpidas', 120), s('Retiro', 30), s('Pedicuría', 60)] },
  { id: 'estetica', emoji: '✨', title: 'Estética', services: [s('Limpieza facial', 60), s('Perfilado de cejas', 20), s('Lifting de pestañas', 60), s('Depilación', 30), s('Masajes', 60)] },
  { id: 'salud', emoji: '🩺', title: 'Salud', services: [s('Primera consulta', 45), s('Consulta de control', 30), s('Sesión', 45)] },
  { id: 'clases', emoji: '📚', title: 'Clases', services: [s('Clase individual', 60), s('Clase de prueba', 30)] },
  { id: 'profesionales', emoji: '💼', title: 'Profesionales', services: [s('Primera consulta', 60), s('Asesoría', 45), s('Reunión de seguimiento', 30)] },
  { id: 'mascotas', emoji: '🐾', title: 'Mascotas', services: [s('Baño', 60), s('Baño y corte', 90), s('Consulta veterinaria', 30), s('Vacunación', 15)] },
  { id: 'taller', emoji: '🔧', title: 'Taller y service', services: [s('Diagnóstico', 30), s('Service', 120), s('Instalación', 90), s('Reparación', 60)] },
  { id: 'deportes', emoji: '⚽', title: 'Canchas y deportes', services: [s('Cancha 1 hora', 60), s('Cancha 90 minutos', 90), s('Clase', 60)] },
];

export type AgendaKind = AgendaTemplate['id'] | 'otro';

/**
 * Tipo de negocio de la agenda: solo el que eligió el comercio (al arrancar con una plantilla
 * o en Configurar). No se adivina por los nombres de los servicios: la agenda sirve para
 * cualquier rubro, y sin elección los textos quedan genéricos.
 */
export function detectAgendaKind(agenda: { kind?: string } | null | undefined): AgendaKind {
  return agenda?.kind && AGENDA_TEMPLATES.some((t) => t.id === agenda.kind) ? (agenda.kind as AgendaKind) : 'otro';
}
