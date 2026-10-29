// Guion del reel: qué partes del video original quedan (en segundos de recargo.mp4)
export const FPS = 30;

export type Toma = {
  desde: number;
  hasta: number;
  // Rango de la frase en la transcripción de Whisper, si sus tiempos no coinciden con el corte
  texto?: [number, number];
  velocidad?: number;
  zoom?: { desde: number; hasta: number; x: number; y: number };
  cartel?: { texto: string; resaltado?: string; en?: number; dura?: number; compacto?: boolean };
};

export const TOMAS: Toma[] = [
  {
    // "Soy empleado de comercio y desarrollé este sistema a medida que se iba usando en el kiosco."
    desde: 0,
    hasta: 6.05,
    texto: [0, 6.44],
    zoom: { desde: 1.05, hasta: 1.18, x: 50, y: 42 },
    cartel: { texto: 'Lo hizo alguien que', resaltado: 'atiende un kiosco', en: 0, dura: 3 },
  },
  {
    // "El sistema es muy fácil de usar y está hecho para usar el mouse lo menos posible..."
    desde: 11.72,
    hasta: 17.4,
    texto: [11.02, 17.4],
    zoom: { desde: 1.28, hasta: 1.4, x: 50, y: 42 },
    cartel: { texto: 'Casi sin mouse:', resaltado: 'todo con el teclado', en: 1.9, dura: 3.4 },
  },
  {
    // "Si te piden un Master, flechita para abajo, se agrega al carrito. Con otro Enter se abre..."
    desde: 22.2,
    hasta: 27.4,
    zoom: { desde: 1.12, hasta: 1.22, x: 50, y: 45 },
  },
  {
    // "...seleccionás efectivo, Clover, Mercado Pago, o mixto... Con otro Enter."
    desde: 27.4,
    hasta: 36.9,
    zoom: { desde: 1, hasta: 1.06, x: 50, y: 50 },
    cartel: { texto: 'Recargo automático', resaltado: '$1.600 → $1.760', en: 2.6, dura: 4, compacto: true },
  },
];

export const CIERRE = { titulo: 'Ventra', bajada: 'El sistema para tu kiosco', dura: 2.5 };

// Correcciones a lo que transcribió Whisper
export const CORRECCIONES: Record<string, string> = {
  master: 'Master',
  enter: 'Enter',
  clover: 'Clover',
  'mercado pago': 'Mercado Pago',
};

export const largoToma = (t: Toma) => Math.round(((t.hasta - t.desde) / (t.velocidad ?? 1)) * FPS);
export const duracionTomas = () => TOMAS.reduce((s, t) => s + largoToma(t), 0);
export const duracionTotal = () => duracionTomas() + Math.round(CIERRE.dura * FPS);
