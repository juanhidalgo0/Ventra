import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';

const QUERY = '(max-width: 767px)';

export function useSmallScreen() {
  const [isSmall, setIsSmall] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = () => setIsSmall(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isSmall;
}

/**
 * Modo dueño en el celular: pantalla chica + usuario administrador. En ese caso
 * siempre se muestra la app móvil (no hay acceso a la versión de PC desde el celular).
 * Los cajeros en el celular siguen viendo el POS de siempre.
 */
export function useOwnerMobile() {
  const user = useAuthStore((s) => s.user);
  const isSmall = useSmallScreen();
  return { active: isSmall && user?.role === 'ADMIN' };
}

/**
 * Empleados en el celular (cajero, vendedor, chofer): la misma app del celular, con las
 * pestañas de lo que hace cada uno (ver StaffMobileShell). En la PC siguen con la caja de siempre.
 */
export function useStaffMobile() {
  const user = useAuthStore((s) => s.user);
  const isSmall = useSmallScreen();
  return { active: isSmall && !!user && user.role !== 'ADMIN' };
}
