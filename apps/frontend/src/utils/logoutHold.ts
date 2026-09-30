let holds = 0;

/**
 * Mientras esta terminal está en medio de un cierre (X o Z) no se le cierra la sesión
 * desde afuera: el cajero tiene que poder imprimir el comprobante. La sesión se cierra
 * cuando sale del cartel. Devuelve la función que libera la traba.
 */
export function holdLogout(): () => void {
  holds++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds = Math.max(0, holds - 1);
  };
}

export function isLogoutHeld(): boolean {
  return holds > 0;
}
