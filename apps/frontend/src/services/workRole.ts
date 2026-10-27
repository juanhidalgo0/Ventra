import { useAuthStore } from '../stores/authStore';

/**
 * Qué hace cada usuario en la distribuidora. Lo elige el dueño en Usuarios y sigue a la persona
 * en cualquier equipo: entra directo a lo suyo y ve solo eso. El administrador (el dueño) no
 * tiene: hace de todo. Sin rol, cada equipo pregunta qué hace (ver StartChooser).
 */
export type WorkRole = 'VENDEDOR' | 'CHOFER' | 'MOSTRADOR' | 'TALLER' | 'DISENO';

export const WORK_ROLES: { key: WorkRole; label: string; text: string }[] = [
  { key: 'VENDEDOR', label: 'Vendedor', text: 'Toma pedidos en la calle (preventa)' },
  { key: 'CHOFER', label: 'Chofer', text: 'Hace el reparto: entrega y cobra' },
  { key: 'MOSTRADOR', label: 'Mostrador', text: 'Vende a los que vienen al depósito' },
];

/**
 * Qué hace cada uno en la imprenta (o en cualquier comercio con encargos). Mostrador atiende y
 * cobra; Taller y Diseño solo trabajan los encargos, sin ver precios. Lo que toca plata ya
 * cobrada (cancelar con seña, cambiar el precio con seña) lo autoriza el dueño con su clave.
 */
export const IMPRENTA_ROLES: { key: WorkRole; label: string; text: string }[] = [
  { key: 'MOSTRADOR', label: 'Mostrador', text: 'Toma encargos, cobra y entrega' },
  { key: 'TALLER', label: 'Taller', text: 'Ve los trabajos y cambia el estado' },
  { key: 'DISENO', label: 'Diseño', text: 'Como taller, y corrige notas y detalle' },
];

export const WORK_PATH: Record<WorkRole, string> = { VENDEDOR: '/preventa', CHOFER: '/reparto', MOSTRADOR: '/pos', TALLER: '/encargos', DISENO: '/encargos' };

const ALL_ROLES = [...WORK_ROLES, ...IMPRENTA_ROLES];
export const workRoleLabel = (w?: string | null) => ALL_ROLES.find((r) => r.key === w)?.label || '';

const roleOf = (user: any): WorkRole | null =>
  user && user.role !== 'ADMIN' && ALL_ROLES.some((r) => r.key === user.workRole) ? user.workRole : null;

/** Taller y Diseño: solo los encargos, sin precios ni cobros */
export const isProductionRole = (w?: string | null) => w === 'TALLER' || w === 'DISENO';
/** Lo único que ven Taller y Diseño (más "Más" en el celular, para salir) */
export const PRODUCTION_PATHS = ['/encargos', '/mas'];

/** El rol de quien está usando la app (null: el dueño, o un usuario sin rol) */
export const myWorkRole = () => roleOf(useAuthStore.getState().user);
export const useWorkRole = () => useAuthStore((s) => roleOf(s.user));
