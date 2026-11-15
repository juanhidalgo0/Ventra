import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/authStore';
import { isPrinting, onAfterPrint } from './printing';

// Solo la pantalla: al imprimir el ancho es el del papel (80 mm) y no tiene que contar
const QUERY = 'screen and (max-width: 767px)';

export function useSmallScreen() {
  const [isSmall, setIsSmall] = useState(() => window.matchMedia(QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    // Mientras se imprime no se cambia de pantalla: se cambiaba a la app del celular en plena
    // impresión y salía impresa esa pantalla ("Vender / Cargando…") en vez del ticket
    const onChange = () => { if (!isPrinting()) setIsSmall(window.matchMedia(QUERY).matches); };
    mq.addEventListener('change', onChange);
    const stop = onAfterPrint(onChange);
    return () => { mq.removeEventListener('change', onChange); stop(); };
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
