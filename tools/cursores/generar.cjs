// Genera los cursores de Ventra (verde con borde blanco y línea oscura afuera) en tamaño normal
// (32 px) y grande (48 px), y el CSS que los aplica en toda la app: apps/frontend/src/cursores.css.
// Uso: node tools/cursores/generar.cjs
const fs = require('fs');
const path = require('path');

const FRONT = path.join(__dirname, '..', '..', 'apps', 'frontend', 'src');
const DIR = path.join(FRONT, 'assets', 'cursors');
const G = '#17925F', GD = '#0A4736', W = '#fff', GL = '#EAF7F1', R = '#E24B4A';

const ARROW = 'M4 2 L4 26 L10 20 L14 29 L18 27 L14 18 L22 18 Z';
const HAND = 'M11 5 a2.5 2.5 0 0 1 5 0 V13 a2.4 2.4 0 0 1 4.8 0.6 a2.4 2.4 0 0 1 4.6 1.2 V22 a7 7 0 0 1 -7 7 h-3 a7 7 0 0 1 -5.6 -2.8 L5 20.5 a2.3 2.3 0 0 1 3.6 -2.9 L11 19.5 Z';
const OPEN = 'M9 17 V8 a2 2 0 0 1 4 0 V14 V6 a2 2 0 0 1 4 0 V14 V7 a2 2 0 0 1 4 0 V15 V10 a2 2 0 0 1 4 0 V21 a7 7 0 0 1 -7 7 h-3 a7 7 0 0 1 -5.8 -3 L5.5 20 a2 2 0 0 1 3.3 -2.3 L9 18.5 Z';
const FIST = 'M7 17 a2 2 0 0 1 2 -2 V14 a2 2 0 0 1 4 0 a2 2 0 0 1 4 0 a2 2 0 0 1 4 0 a2 2 0 0 1 4 0 V21 a7 7 0 0 1 -7 7 h-3 a7 7 0 0 1 -7 -7 Z';
const EW = 'M3 16 L9 10 V13.5 H23 V10 L29 16 L23 22 V18.5 H9 V22 Z';
const NS = 'M16 3 L22 9 H18.5 V23 H22 L16 29 L10 23 H13.5 V9 H10 Z';

// Figura rellena con el estilo 1B: línea oscura afuera, borde blanco y relleno verde
const shape = (d) =>
  `<path d="${d}" fill="none" stroke="${GD}" stroke-width="3.4" stroke-linejoin="round"/>` +
  `<path d="${d}" fill="${G}" stroke="${W}" stroke-width="1.6" stroke-linejoin="round"/>`;
// Trazo (barrita, lupa) con las mismas tres capas
const line = (d, extra = '') =>
  `<path d="${d}" stroke="${GD}" stroke-width="6.4" stroke-linecap="round" fill="none"${extra}/>` +
  `<path d="${d}" stroke="${W}" stroke-width="4.6" stroke-linecap="round" fill="none"${extra}/>` +
  `<path d="${d}" stroke="${G}" stroke-width="2.2" stroke-linecap="round" fill="none"${extra}/>`;
const badge = (inner) => `<circle cx="24" cy="24" r="6.5" fill="${W}" stroke="${GD}" stroke-width="1.2"/>${inner}`;

const CURSORS = {
  flecha: shape(ARROW),
  mano: shape(HAND),
  'mano-abierta': shape(OPEN),
  'mano-cerrada': shape(FIST),
  texto: line('M12 4h8M16 4v24M12 28h8'),
  lupa:
    line('M19.5 19.5 L27 27') +
    `<circle cx="13" cy="13" r="8" fill="${GL}" stroke="${GD}" stroke-width="5.4"/>` +
    `<circle cx="13" cy="13" r="8" fill="${GL}" stroke="${W}" stroke-width="3.4"/>` +
    `<circle cx="13" cy="13" r="8" fill="${GL}" stroke="${G}" stroke-width="1.8"/>` +
    `<path d="M9.5 13h7M13 9.5v7" stroke="${G}" stroke-width="2" stroke-linecap="round"/>`,
  ancho: shape(EW),
  alto: shape(NS),
  espera:
    shape(ARROW) +
    badge(`<circle cx="24" cy="24" r="4" fill="none" stroke="${G}" stroke-opacity=".3" stroke-width="2"/><path d="M24 20a4 4 0 0 1 4 4" stroke="${G}" stroke-width="2" stroke-linecap="round" fill="none"/>`),
  prohibido:
    shape(ARROW) +
    badge(`<circle cx="24" cy="24" r="4" fill="none" stroke="${R}" stroke-width="1.8"/><path d="M21.2 26.8 L26.8 21.2" stroke="${R}" stroke-width="1.8" stroke-linecap="round"/>`),
};

fs.mkdirSync(DIR, { recursive: true });
for (const [name, body] of Object.entries(CURSORS)) {
  for (const [suffix, px] of [['', 32], ['-grande', 48]]) {
    fs.writeFileSync(
      path.join(DIR, `${name}${suffix}.svg`),
      `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 32 32">${body}</svg>\n`,
    );
  }
}

// [selectores, cursor, punto que clickea (en 32 px), cursor del sistema de respaldo]
const TEXT_INPUT = "input:not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit']):not([type='range']):not([type='color']):not([type='file']):not(:disabled)";
const RULES = [
  [['html', 'body'], 'flecha', [4, 2], 'default'],
  [["a[href]", 'button:not(:disabled)', "[role='button']", "[role='tab']", "[role='menuitem']", "[role='option']",
    "[role='switch']", "[role='checkbox']", 'label[for]', 'summary', 'select:not(:disabled)',
    "input[type='checkbox']:not(:disabled)", "input[type='radio']:not(:disabled)",
    "input[type='button']:not(:disabled)", "input[type='submit']:not(:disabled)", "input[type='file']",
    '.cursor-pointer', '.nav-btn'], 'mano', [13, 3], 'pointer'],
  [['.cursor-default'], 'flecha', [4, 2], 'default'],
  [['.cursor-grab', "[draggable='true']"], 'mano-abierta', [16, 14], 'grab'],
  [['.cursor-grabbing', '.cursor-grab:active', '.active\\:cursor-grabbing:active', "[draggable='true']:active"], 'mano-cerrada', [16, 16], 'grabbing'],
  [['.cursor-zoom-in'], 'lupa', [13, 13], 'zoom-in'],
  [['.cursor-col-resize', '.cursor-ew-resize', '.cursor-e-resize', '.cursor-w-resize'], 'ancho', [16, 16], 'ew-resize'],
  [['.cursor-row-resize', '.cursor-ns-resize', '.cursor-n-resize', '.cursor-s-resize'], 'alto', [16, 16], 'ns-resize'],
  [['.cursor-wait', '.cursor-progress', "[aria-busy='true']"], 'espera', [4, 2], 'wait'],
  [[TEXT_INPUT, 'textarea:not(:disabled)', "[contenteditable='true']"], 'texto', [16, 16], 'text'],
  [['input:disabled', 'textarea:disabled', 'button:disabled', 'select:disabled', '.cursor-not-allowed', "[aria-disabled='true']"], 'prohibido', [4, 2], 'not-allowed'],
];

const decl = (file, [x, y], fallback) => `  cursor: url('./assets/cursors/${file}.svg') ${x} ${y}, ${fallback};`;
const big = (sel) => (sel === 'html' ? 'html.cursor-grande' : `html.cursor-grande ${sel}`);

let css = `/* Generado por tools/cursores/generar.cjs: no editar a mano, cambiar el script y volver a correrlo.
   Cursores de Ventra en toda la app (PC y caja web). Se carga después de index.css para ganarle a
   las clases cursor-* de Tailwind. "cursor-grande" (Configuración > Equipo) usa los de 48 px y
   "cursor-oculto" esconde el mouse mientras se escanea o se tipea en la caja. */\n`;
for (const [sels, file, hot, fb] of RULES) css += `${sels.join(',\n')} {\n${decl(file, hot, fb)}\n}\n`;
css += '\n';
for (const [sels, file, hot, fb] of RULES) {
  css += `${sels.map(big).join(',\n')} {\n${decl(`${file}-grande`, hot.map((n) => Math.round(n * 1.5)), fb)}\n}\n`;
}
// Mientras se arrastra un producto al ticket (components/pos/dragToCart.ts): manito cerrada en todos lados
css += `\nhtml.pos-dragging,\nhtml.pos-dragging * {\n${decl('mano-cerrada', [16, 16], 'grabbing').replace(';', ' !important;')}\n}\n`;
css += `html.cursor-grande.pos-dragging,\nhtml.cursor-grande.pos-dragging * {\n${decl('mano-cerrada-grande', [24, 24], 'grabbing').replace(';', ' !important;')}\n}\n`;
css += `\nhtml.cursor-oculto,\nhtml.cursor-oculto * {\n  cursor: none !important;\n}\n`;
fs.writeFileSync(path.join(FRONT, 'cursores.css'), css);
console.log(`Listo: ${Object.keys(CURSORS).length * 2} cursores y src/cursores.css`);
