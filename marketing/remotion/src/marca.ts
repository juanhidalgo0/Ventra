import { staticFile } from 'remotion';

// Colores de los reels de Ventra
export const verde = {
  base: '#136B57',
  oscuro: '#0B4A3C',
  claro: '#7FE3B8',
};

export const fuentes = `
@font-face { font-family: 'Bricolage'; src: url('${staticFile('bricolage.woff2')}') format('woff2'); font-weight: 200 800; }
@font-face { font-family: 'Inter'; src: url('${staticFile('inter.woff2')}') format('woff2'); font-weight: 100 900; }
`;
