import { usePlanStore, isAgendaOnly, type PlanFeatures } from '../../../stores/planStore';
import { useBusinessStore, type BusinessProfile } from '../../../stores/businessStore';
import type { AgendaKind } from '../../../services/agendaTemplates';

/**
 * Con qué comercio se hace el recorrido: plan contratado, rubro (caja y tienda) y tipo de
 * servicio (agenda). Los recorridos de tours.ts arman sus pasos y sus textos con esto.
 */
export interface TourCtx {
  plan: PlanFeatures;
  agendaOnly: boolean;
  profile: BusinessProfile;
  /** Funciones del rubro prendidas (presupuestos, variantes, vencimientos...) */
  biz: Record<string, boolean>;
  agendaKind: AgendaKind;
  /** Palabras de la agenda según el tipo de servicio */
  w: AgendaWords;
  mobile: boolean;
}

export interface AgendaWords {
  /** "Peluquería", "Consultorio"… */
  title: string;
  cliente: string;
  clientes: string;
  /** Quienes atienden ("barberos", "profesionales", "docentes", "canchas") */
  staff: string;
  /** Uno de ellos ("profesional", "cancha") */
  staffUno: string;
  turno: string;
  turnos: string;
  /** Ejemplo de servicio para los textos ("un corte o un color") */
  ejemplo: string;
  /** Ejemplo de horario para bloquear */
  bloqueo: string;
  /** Consejo propio del rubro, se muestra como un paso más */
  consejo: { title: string; body: string };
  /** Consejo para cargar los servicios */
  servicios: string;
}

const BASE: AgendaWords = {
  title: 'tu negocio', cliente: 'cliente', clientes: 'clientes', staff: 'profesionales', staffUno: 'profesional', turno: 'turno', turnos: 'turnos',
  ejemplo: 'un servicio', bloqueo: 'el almuerzo o un trámite',
  consejo: { title: 'Un consejo', body: 'Mandá el **recordatorio por WhatsApp** el día anterior: es la forma más simple de que **nadie falte** a su turno.' },
  servicios: 'Cargá cada servicio con **cuánto dura de verdad**: así la agenda nunca te superpone dos turnos.',
};

export const AGENDA_WORDS: Record<AgendaKind, AgendaWords> = {
  peluqueria: {
    ...BASE, title: 'tu peluquería', ejemplo: 'un corte o un color',
    consejo: { title: 'Color y alisados', body: 'Los trabajos largos (**color, mechas, alisado**) bloquean más tiempo solos: cargá bien su duración y la agenda ofrece únicamente los huecos donde entran.' },
    servicios: 'Un corte no dura lo mismo que un color: poné **la duración real de cada servicio** para que la agenda no te superponga turnos.',
  },
  barberia: {
    ...BASE, title: 'tu barbería', staff: 'barberos', staffUno: 'barbero', ejemplo: 'un corte y barba',
    consejo: { title: 'Turnos cortos, agenda llena', body: 'En barbería los turnos son cortos: probá mostrar horarios **cada 15 o 20 minutos** en Reglas de reserva para **aprovechar cada hueco**.' },
    servicios: 'Si hacés **corte y barba juntos**, cargalo como un servicio aparte con su propia duración: es lo que más se reserva.',
  },
  unas: {
    ...BASE, title: 'tu estudio de uñas', staff: 'manicuras', staffUno: 'manicura', ejemplo: 'un semipermanente o un kapping',
    consejo: { title: 'Retiros y service', body: 'Cargá el **retiro** como un servicio aparte: así quien viene solo a sacarse el esmalte ocupa **el tiempo justo**, y no un turno entero.' },
    servicios: 'Esculpidas, kapping y semi duran muy distinto: con **la duración real** de cada uno la agenda nunca te junta dos clientas.',
  },
  estetica: {
    ...BASE, title: 'tu centro de estética', ejemplo: 'una limpieza facial',
    consejo: { title: 'Tiempo entre sesiones', body: 'Si necesitás **preparar la camilla** entre una sesión y otra, sumá **tiempo libre entre turnos** en Reglas de reserva.' },
  },
  salud: {
    ...BASE, title: 'tu consultorio', cliente: 'paciente', clientes: 'pacientes', ejemplo: 'una primera consulta', bloqueo: 'una cirugía o un congreso',
    consejo: { title: 'Confirmá vos cada turno', body: 'Si preferís revisar quién reserva, apagá **Confirmar automáticamente**: los turnos online quedan **Por confirmar** hasta que los aceptes.' },
    servicios: 'La **primera consulta** suele llevar más tiempo que un control: cargalas como servicios separados.',
  },
  clases: {
    ...BASE, title: 'tus clases', cliente: 'alumno', clientes: 'alumnos', staff: 'docentes', staffUno: 'docente', turno: 'clase', turnos: 'clases', ejemplo: 'una clase de prueba', bloqueo: 'feriados o vacaciones',
    consejo: { title: 'Clases de prueba', body: 'Ofrecé una **clase de prueba** corta: es la forma más fácil de que un alumno nuevo **reserve por primera vez** desde tu link.' },
    servicios: 'Cargá cada tipo de clase con su duración. Una **clase de prueba** más corta ayuda a sumar alumnos nuevos.',
  },
  profesionales: {
    ...BASE, title: 'tu estudio', ejemplo: 'una primera consulta', bloqueo: 'una audiencia o un trámite',
    consejo: { title: 'Primera reunión', body: 'Ofrecé una **primera consulta** con su propia duración: es la que más se reserva online y te ordena la semana.' },
    servicios: 'Separá la **primera consulta** de los seguimientos: suelen durar distinto y tienen otro precio.',
  },
  mascotas: {
    ...BASE, title: 'tu veterinaria o peluquería canina', ejemplo: 'un baño o una consulta',
    consejo: { title: 'Pedí los datos de la mascota', body: 'En la nota del turno tus clientes pueden contarte **raza y tamaño**: así sabés cuánto tiempo te va a llevar.' },
    servicios: 'Un perro grande lleva más tiempo que uno chico: podés cargar **el mismo servicio por tamaño**, cada uno con su duración y precio.',
  },
  taller: {
    ...BASE, title: 'tu taller', ejemplo: 'un service o un diagnóstico', bloqueo: 'un trabajo largo o una salida a domicilio',
    consejo: { title: 'Trabajos largos', body: 'Si un trabajo te ocupa medio día, **bloqueá ese horario**: la agenda no ofrece turnos mientras estás con él.' },
    servicios: 'Cargá cada trabajo con **el tiempo que de verdad te lleva**: así nunca se te juntan dos clientes.',
  },
  deportes: {
    ...BASE, title: 'tus canchas', staff: 'canchas', staffUno: 'cancha', ejemplo: 'una hora de cancha', bloqueo: 'un torneo o mantenimiento',
    consejo: { title: 'Cada cancha, su agenda', body: 'Cargá cada **cancha como si fuera un profesional**: tiene sus horarios y se reserva por separado.' },
    servicios: 'Ofrecé turnos de **1 hora y de 90 minutos**: así cada grupo reserva el tiempo que juega.',
  },
  otro: BASE,
};

let agendaKind: AgendaKind = 'otro';
let mobile = false;
/** La pantalla avisa con qué tipo de servicio y en qué formato se ve (lo usa el próximo recorrido). */
export function setTourScreen(info: { agendaKind?: AgendaKind; mobile?: boolean }) {
  if (info.agendaKind) agendaKind = info.agendaKind;
  if (typeof info.mobile === 'boolean') mobile = info.mobile;
}

export function getTourCtx(): TourCtx {
  const plan = usePlanStore.getState().features;
  const { profile, features } = useBusinessStore.getState();
  return { plan, agendaOnly: isAgendaOnly(plan), profile, biz: features as any, agendaKind, w: AGENDA_WORDS[agendaKind], mobile };
}
