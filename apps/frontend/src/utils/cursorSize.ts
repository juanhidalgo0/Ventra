/**
 * Tamaño del cursor de esta PC (Configuración > Equipo): normal (32 px) o grande (48 px).
 * Se guarda en el navegador de cada PC y se aplica con la clase "cursor-grande" en <html>
 * (las reglas están en cursores.css).
 */
const KEY = 'ventra_cursor_grande';

export function getCursorGrande(): boolean {
  try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function setCursorGrande(on: boolean) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* sin almacenamiento: solo esta vez */ }
  document.documentElement.classList.toggle('cursor-grande', on);
}

// Al arrancar la app
if (typeof document !== 'undefined') document.documentElement.classList.toggle('cursor-grande', getCursorGrande());
