import { useAuthStore } from '../stores/authStore';

/**
 * Qué hace cada usuario en la distribuidora. Lo elige el dueño en Usuarios y sigue a la persona
 * en cualquier equipo: entra directo a lo suyo y ve solo eso. El administrador (el dueño) no
 * tiene: hace de todo. Sin rol, cada equipo pregunta qué hace (ver StartChooser).
 */
export type WorkRole = 'VENDEDOR' | 'CHOFER' | 'MOSTRADOR';

export const WORK_ROLES: { key: WorkRole; label: string; text: string }[] = [
  { key: 'VENDEDOR', label: 'Vendedor', text: 'Toma pedidos en la calle (preventa)' },
  { key: 'CHOFER', label: 'Chofer', text: 'Hace el reparto: entrega y cobra' },
  { key: 'MOSTRADOR', label: 'Mostrador', text: 'Vende a los que vienen al depósito' },
];

export const WORK_PATH: Record<WorkRole, string> = { VENDEDOR: '/preventa', CHOFER: '/reparto', MOSTRADOR: '/pos' };

export const workRoleLabel = (w?: string | null) => WORK_ROLES.find((r) => r.key === w)?.label || '';

const roleOf = (user: any): WorkRole | null =>
  user && user.role !== 'ADMIN' && WORK_ROLES.some((r) => r.key === user.workRole) ? user.workRole : null;

/** El rol de quien está usando la app (null: el dueño, o un usuario sin rol) */
export const myWorkRole = () => roleOf(useAuthStore.getState().user);
export const useWorkRole = () => useAuthStore((s) => roleOf(s.user));
