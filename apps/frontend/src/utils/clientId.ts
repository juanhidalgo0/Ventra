const KEY = 'ventra_client_id';

/**
 * Identificador de esta terminal (pestaña/ventana). Sirve para que, cuando el
 * servidor pide cerrar sesión en todas las terminales de un usuario, la terminal
 * que originó el cierre no se cierre de golpe y pueda terminar su flujo
 * (imprimir el comprobante X, por ejemplo).
 */
export function getClientId(): string {
  try {
    let id = sessionStorage.getItem(KEY);
    if (!id) {
      id = (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      sessionStorage.setItem(KEY, id);
    }
    return id;
  } catch {
    return 'sin-id';
  }
}
