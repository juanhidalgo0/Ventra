/** Vibración corta del celular (escanear, cobrar, pedido nuevo). No hace nada en PC o iPhone. */
export function haptic(pattern: number | number[] = 12) {
  try { if (window.matchMedia?.('(pointer: coarse)').matches) navigator.vibrate?.(pattern); } catch { /* sin vibración */ }
}
