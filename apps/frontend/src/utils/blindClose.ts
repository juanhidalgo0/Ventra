import { useAuthStore } from '../stores/authStore';

/**
 * Cierre de caja a ciegas: el empleado cuenta y declara sin ver lo que el sistema espera ni la
 * diferencia (tampoco las ventas del turno en "Estado de la caja"). Lo activa el dueño en
 * Configuración (store_settings.cash_blind_close, '1' / '0'); de entrada está apagado.
 * El dueño (ADMIN) lo sigue viendo todo, y en Control de caja ve siempre la diferencia.
 */
export const BLIND_CLOSE_KEY = 'cash_blind_close';

export function isBlindCloseOn(): boolean {
  try { return localStorage.getItem(BLIND_CLOSE_KEY) === '1'; } catch { return false; }
}

/**
 * Si quien está en la caja tiene que cerrar a ciegas. Mira el rol directo (no useOwnerAccess):
 * en /pos el candado se cierra solo, así que ahí el usuario es siempre el de la caja, y estas
 * ventanas también se abren fuera del router (vista previa de desarrollo).
 */
export function useBlindClose(): boolean {
  const role = useAuthStore((s) => s.user?.role);
  return role !== 'ADMIN' && isBlindCloseOn();
}

/**
 * Opción aparte (solo vale con el cierre a ciegas prendido): el reporte Z tampoco lo ven ni lo
 * imprimen los empleados, porque trae lo esperado y las diferencias de cada turno. El dueño lo ve
 * e imprime desde Control de caja. store_settings.cash_blind_close_z ('1' / '0'), apagado de entrada.
 */
export const BLIND_CLOSE_Z_KEY = 'cash_blind_close_z';

export function useBlindZ(): boolean {
  const blind = useBlindClose();
  try { return blind && localStorage.getItem(BLIND_CLOSE_Z_KEY) === '1'; } catch { return false; }
}
