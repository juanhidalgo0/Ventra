// "Ventra les escribe por WhatsApp": reel de Ventra Agenda Pro, estilo fintech cálido.
// Todo va atado a la música (public/musica.mp3, "That Good Feeling", 100 bpm): el primer golpe cae
// a los 0,29 s y cada compás dura 72 cuadros. La batería entra en el compás 4: ahí aparece Ventra.
// El audio final lo arma scripts/reel-agenda-pro-audio.py con estos mismos números.

export const FPS = 30;
export const PRIMER_GOLPE = 0.29 * FPS; // cuadro del primer golpe (8,7)
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
  hook: [0, t(2)], // "Mañana tenés 7 turnos." / "¿Van a venir?"
  antes: [t(2), t(4)], // "Antes: un mensaje a cada cliente…" / "…y a cruzar los dedos."
  whatsapp: [t(4), t(6)], // "Ahora Ventra les escribe por WhatsApp."
  toque: [t(6), t(7)], // "Confirman con un toque."
  aviso: [t(7), t(8)], // "Y vos te enterás al instante."
  agenda: [t(8), t(10)], // "A la mañana, tu agenda ya confirmada."
  solo: [t(10), t(11)], // "Sale solo, el día anterior a las 20 h."
  cupo: [t(11), t(12)], // "200 recordatorios por mes."
  cierre: [t(12), TOTAL],
} as const;

export const CLIENTES = [
  { n: 'Flor', c: '#F6CBA8' }, { n: 'Nico', c: '#CDE8DC' }, { n: 'Vale', c: '#F3D3E1' }, { n: 'Juan', c: '#D7E3F6' },
  { n: 'Lu', c: '#F4E2B6' }, { n: 'Mati', c: '#E2D7F3' }, { n: 'Caro', c: '#C6EBDD' },
];
/** Los que faltaban antes (en la escena "antes") */
export const FALTARON = [3, 6];

// El recordatorio que le llega al cliente (plantilla turno_recordatorio: nombre, negocio,
// servicio con profesional, día y hora; botones Confirmo / Necesito cambiarlo)
export const MENSAJE = 'Hola Nico! Te recordamos tu turno en Estudio Norte: Corte con Diego, mañana viernes a las 09:30.';

// Aviso real que recibe el comercio cuando el cliente confirma (firebase/functions/index.js)
export const AVISO = {
  titulo: 'Turno confirmado: Corte · vie 9/10 09:30',
  cuerpo: 'Nicolás Díaz con Diego confirmó desde el recordatorio de WhatsApp.',
};
