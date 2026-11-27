import { loadFont } from '@remotion/fonts';
import { staticFile } from 'remotion';

// Colores tomados de la web pública (ventra.store, variables de estilo.css), 2026-11-14.
// Ganan sobre marketing/remotion/src/marca.ts, que tiene los verdes viejos.
export const c = {
  verde: '#167160', // --green / --pine: botones, acentos, "tu negocio"
  verdeOscuro: '#0E5E48', // --green-dk
  pino: '#08362A', // fondo oscuro de la web ("¿Arrancamos?")
  pinoProfundo: '#03140F',
  menta: '#34AC7E',
  menta300: '#67C7A0',
  menta50: '#EAF7F1',
  fondo: '#F6F9F7', // --paper
  linea: '#E2EAE5',
  tinta: '#0E1B16', // --ink
  tinta2: '#4F5E58',
  tinta3: '#7F8C86',
  crema: '#F6F2EC', // --on-dark, la "V" del logo
  waFondo: '#E7DDD3',
  waSale: '#D9FDD3',
  waVerde: '#25D366',
};

// Inter (la de la web) y Plus Jakarta Sans (la de la app), las dos OFL.
export const fuentesListas = Promise.all([
  loadFont({ family: 'Inter', url: staticFile('fuentes/inter.woff2'), weight: '100 900' }),
  loadFont({ family: 'Jakarta', url: staticFile('fuentes/plus-jakarta-sans-latin-wght-normal.woff2'), weight: '200 800' }),
]);

export const inter = "'Inter', system-ui, sans-serif";
export const jakarta = "'Jakarta', 'Inter', sans-serif";
