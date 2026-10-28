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
  const { pathname } = useLocation();
  if (role === 'ADMIN' || role === 'SUPERVISOR') return true;
  if (!role || pathname === '/pos' || pathname === '/') return false;
  try { return sessionStorage.getItem('admin_unlocked') === 'true'; } catch { return false; }
}
