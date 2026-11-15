/**
 * ¿Se está imprimiendo? Mientras se arma la hoja, el "ancho de la pantalla" pasa a ser el del
 * papel (80 mm ≈ 300 px): todo lo que elige la pantalla según el ancho (la app del celular, la
 * caja angosta) se cambiaba en plena impresión y salía impresa la pantalla del celular en vez
 * del ticket. Mientras esto da true, nada se cambia; al terminar se vuelve a mirar el ancho.
 */
let printing = false;
const afterPrint = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeprint', () => { printing = true; });
  window.addEventListener('afterprint', () => {
    printing = false;
    afterPrint.forEach((fn) => { try { fn(); } catch { /* que no corte a los demás */ } });
  });
}

export const isPrinting = () => printing || (typeof window !== 'undefined' && window.matchMedia('print').matches);

/** Avisa cuando termina una impresión (para volver a mirar el ancho). Devuelve cómo dejar de escuchar. */
export function onAfterPrint(fn: () => void): () => void {
  afterPrint.add(fn);
  return () => { afterPrint.delete(fn); };
}
