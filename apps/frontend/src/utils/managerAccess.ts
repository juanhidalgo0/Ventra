import { useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

/**
 * Si quien mira la pantalla es el dueño o el encargado: para los avisos (campanita, productos
 * para revisar). En la PC del local suele quedar el cajero logueado y el dueño entra con el
 * candado (clave de administrador) sin cerrar la sesión: también cuenta. Al volver a la caja el
 * candado se cierra solo (ver App.tsx), así que ahí vuelve a ser el cajero.
 */
export function useManagerAccess(): boolean {
  const role = useAuthStore((s) => s.user?.role);
  const unlocked = useAdminUnlocked();
  return role === 'ADMIN' || role === 'SUPERVISOR' || unlocked;
}

/** Lo mismo, solo para lo que es del dueño (por ejemplo GO Delivery en el menú) */
export function useOwnerAccess(): boolean {
  const role = useAuthStore((s) => s.user?.role);
  const unlocked = useAdminUnlocked();
  return role === 'ADMIN' || unlocked;
}

/** El dueño entró con el candado sobre la sesión de otro usuario (fuera de la caja) */
function useAdminUnlocked(): boolean {
  const role = useAuthStore((s) => s.user?.role);
  const { pathname } = useLocation();
  if (!role || pathname === '/pos' || pathname === '/') return false;
  try { return sessionStorage.getItem('admin_unlocked') === 'true'; } catch { return false; }
}
