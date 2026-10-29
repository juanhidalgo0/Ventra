// "El precio viaja solo": reel de Ventra + GO Delivery, estilo fintech cálido (como reel-agenda-pro).
// Un kiosquero sube la Coca en la caja y en GO ya figura el precio nuevo; un vecino pide, el repartidor
// compra en el mostrador y paga como cualquier cliente. Todas las pantallas son capturas reales
// (caja de prueba + emuladores de GO, ver docs/traspaso-go-y-reel.md).
// Música: public/musica.mp3 ("That Good Feeling", 100 bpm): primer golpe a 0,29 s, compás de 72 cuadros.
// El audio lo arma scripts/reel-go-audio.py con estos mismos números.

export const FPS = 30;
export const PRIMER_GOLPE = 0.29 * FPS;
export const GOLPE = 18; // cuadros por negra a 100 bpm
export const COMPAS = GOLPE * 4;

/** Cuadro donde cae el golpe `g` del compás `c` (redondeado). */
export const t = (c: number, g = 0) => Math.round(PRIMER_GOLPE + c * COMPAS + g * GOLPE);

// Corte de la música: el tema hasta el compás 12 y después su compás final (desde 122,69 s)
export const COMPASES_CUERPO = 12;
export const FINAL_DESDE = 122.69;
export const FINAL_DURA = 4.55;
export const TOTAL = Math.round(PRIMER_GOLPE + COMPASES_CUERPO * COMPAS + FINAL_DURA * FPS);

export const ESCENAS = {
  hook: [0, t(1)], // "Lunes, 8:40. Subió la Coca."
  precio: [t(1), t(3)], // la ficha del producto: $3.800 → $4.100, Guardar
  go: [t(3), t(5)], // "…y en GO ya está." (la tienda pasa sola de $3.800 a $4.100)
  catalogo: [t(5), t(6)], // "Todo tu kiosco, con fotos."
  pedido: [t(6), t(7)], // "Un vecino pide."
  aviso: [t(7), t(8)], // la caja: el botón de GO con el pedido
  modal: [t(8), t(9)], // "Pedidos de GO" → Cobrar en la caja
  cobro: [t(9), t(11)], // el ticket con $4.100: "paga como cualquier cliente"
  remate: [t(11), t(12)], // "Un precio. En la caja y en GO."
  cierre: [t(12), TOTAL],
} as const;
