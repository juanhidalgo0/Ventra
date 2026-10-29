import type React from 'react';

// Piezas de papel en stop-motion. Todo se mueve "a tercios": la animación cambia cada 3 cuadros
// (10 por segundo, como cuadro por cuadro) y cada pieza tiembla un poco en cada cambio.

export const CADA = 3;

// Fuentes del sistema con alias: Chrome no siempre encuentra por familia las variantes
// "Condensed"/"Demi", pero sí por nombre completo con local().
export const FUENTES_CSS = `
@font-face { font-family: 'VDymo'; src: local('Tw Cen MT Condensed Extra Bold'), local('TwCenMT-CondensedExtraBold'); }
@font-face { font-family: 'VBoton'; src: local('Franklin Gothic Demi Cond'), local('FranklinGothic-DemiCond'); }
@font-face { font-family: 'VSello'; src: local('Rockwell Extra Bold'), local('Rockwell-ExtraBold'); }
`;
export const DYMO = "'VDymo', 'Tw Cen MT Condensed Extra Bold', 'Tw Cen MT Condensed', 'Agency FB'";
export const BOTON = "'VBoton', 'Franklin Gothic Demi Cond', 'Franklin Gothic Medium', 'Arial Narrow'";

/** Número pseudoaleatorio estable en [0, 1) a partir de una semilla. */
export const azar = (n: number) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** Temblor de stop-motion: cambia cada 3 cuadros, distinto para cada pieza. */
export const tiembla = (semilla: number, f: number, amp = 1.4) => {
  const k = Math.floor(f / CADA);
  return {
    x: (azar(semilla * 13.1 + k) - 0.5) * 2 * amp,
    y: (azar(semilla * 7.3 + k + 91) - 0.5) * 2 * amp,
    r: (azar(semilla * 3.7 + k + 17) - 0.5) * 0.5 * amp,
  };
};

/** Avance 0 → 1 en `pasos` saltos de 3 cuadros desde `a` (0 antes de `a`). */
export const salto = (f: number, a: number, pasos = 3) => {
  if (f < a) return 0;
  const p = Math.min(1, (Math.floor((f - a) / CADA) + 1) / pasos);
  return 1 - (1 - p) * (1 - p);
};

/** Borde de papel cortado a tijera: polígono con los puntos un poco corridos. */
export const corte = (semilla: number, amp = 1.2, porLado = 4) => {
  const pts: string[] = [];
  const j = (i: number) => (azar(semilla * 5.1 + i) * amp).toFixed(2);
  let i = 0;
  for (let k = 0; k < porLado; k++) pts.push(`${(k / porLado) * 100}% ${j(i++)}%`);
  for (let k = 0; k < porLado; k++) pts.push(`${100 - +j(i++)}% ${(k / porLado) * 100}%`);
  for (let k = 0; k < porLado; k++) pts.push(`${100 - (k / porLado) * 100}% ${100 - +j(i++)}%`);
  for (let k = 0; k < porLado; k++) pts.push(`${j(i++)}% ${100 - (k / porLado) * 100}%`);
  return `polygon(${pts.join(',')})`;
};

// Fibra de papel: una textura fija (no cambia por cuadro), barata de pintar
export const FIBRA = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='300' height='300'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.75' numOctaves='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 .35  0 0 0 0 .28  0 0 0 0 .2  0 0 0 .13 0'/></filter><rect width='300' height='300' filter='url(#n)'/></svg>`,
)}")`;

export const SOMBRA = 'drop-shadow(5px 9px 0 rgba(0,0,0,.18)) drop-shadow(2px 16px 18px rgba(0,0,0,.28))';

/** Un recorte de papel: forma cortada, fibra y sombra de estar apoyado sobre la mesa. */
export const Papel = ({ semilla, color = '#F4EFE4', amp = 1, style, children, sombra = SOMBRA }: {
  semilla: number; color?: string; amp?: number; style?: React.CSSProperties; children?: React.ReactNode; sombra?: string;
}) => (
  <div style={{ position: 'absolute', filter: sombra, ...style }}>
    <div style={{ position: 'absolute', inset: 0, clipPath: corte(semilla, amp), background: color }}>
      <div style={{ position: 'absolute', inset: 0, backgroundImage: FIBRA }} />
      {children}
    </div>
  </div>
);

/** Pedazo de cinta de papel con los extremos rotos. */
export const Cinta = ({ x, y, w = 190, rot = 0, semilla, f, a }: { x: number; y: number; w?: number; rot?: number; semilla: number; f: number; a: number }) => {
  if (f < a) return null;
  const t = tiembla(semilla, f, 0.6);
  const dientes = Array.from({ length: 9 }, (_, i) => `${3 + azar(semilla + i) * 5}% ${(i / 8) * 100}%`);
  const dientesB = Array.from({ length: 9 }, (_, i) => `${92 + azar(semilla + 40 + i) * 5}% ${100 - (i / 8) * 100}%`);
  return (
    <div style={{
      position: 'absolute', left: x, top: y, width: w, height: 58, transform: `translate(${t.x}px,${t.y}px) rotate(${rot + t.r}deg)`,
      background: 'rgba(233,222,190,.78)', clipPath: `polygon(${[...dientes, ...dientesB].join(',')})`, backgroundImage: FIBRA,
      boxShadow: 'inset 0 0 0 100px rgba(255,250,235,.12)',
    }} />
  );
};

// ── Letras recortadas de revista ─────────────────────────────────────────────
const FUENTES: [string, number?, string?][] = [
  ['Cooper Black'], ['Rockwell Extra Bold'], ['Stencil'], ['Playbill', 400, 'scaleX(1.35)'], ['Showcard Gothic'], ['Elephant'],
  ['Bernard MT Condensed'], ['Gill Sans Ultra Bold'], ['Haettenschweiler'], ['Impact'], ['Bodoni MT Black', 900], ['Algerian'],
  ['Georgia', 700], ['Franklin Gothic Demi Cond'], ['Courier New', 700], ['Britannic Bold'], ['Bauhaus 93'],
];
const RECORTES_COLOR = [
  { bg: '#F4EFE4', fg: '#16241F' }, { bg: '#16241F', fg: '#F4EFE4' }, { bg: '#F2D04B', fg: '#16241F' }, { bg: '#ECE4D0', fg: '#C0262D' },
  { bg: '#7FE3B8', fg: '#0B4A3C' }, { bg: '#F3A6B5', fg: '#16241F' }, { bg: '#FFFFFF', fg: '#136B57' }, { bg: '#C0262D', fg: '#FFF6E8' },
  { bg: '#E6DCC8', fg: '#16241F' },
];

export const Recortes = ({ lineas, f, a, cada, tam, semilla, sinVerde = false, style }: {
  lineas: string[]; f: number; a: number; cada: number; tam: number; semilla: number; sinVerde?: boolean; style?: React.CSSProperties;
}) => {
  let i = 0;
  const colores = sinVerde ? RECORTES_COLOR.filter((c) => !['#7FE3B8', '#136B57'].includes(c.bg) && c.fg !== '#136B57') : RECORTES_COLOR;
  return (
    <div style={{ position: 'absolute', display: 'flex', flexDirection: 'column', gap: tam * 0.12, ...style }}>
      {lineas.map((linea, li) => (
        <div key={li} style={{ display: 'flex', alignItems: 'center', gap: tam * 0.05 }}>
          {[...linea].map((ch, ci) => {
            const idx = i++;
            if (ch === ' ') return <span key={ci} style={{ width: tam * 0.32 }} />;
            const llega = a + idx * cada;
            if (f < llega) return <span key={ci} style={{ width: tam * 0.7, height: tam }} />;
            const s = semilla * 31 + idx;
            const [fuente, peso, extra] = FUENTES[Math.floor(azar(s) * FUENTES.length)];
            const c = colores[Math.floor(azar(s + 5) * colores.length)];
            const rot = (azar(s + 9) - 0.5) * 16;
            const esc = 0.86 + azar(s + 13) * 0.3;
            const primero = f - llega < CADA; // el primer cuadro cae un poco más grande: "golpe" de papel
            const t = tiembla(s, f, 1.1);
            return (
              <div key={ci} style={{
                position: 'relative', filter: 'drop-shadow(3px 6px 0 rgba(0,0,0,.22)) drop-shadow(1px 9px 9px rgba(0,0,0,.25))',
                transform: `translate(${t.x}px,${t.y + (azar(s + 2) - 0.5) * tam * 0.14}px) rotate(${rot + t.r}deg) scale(${esc * (primero ? 1.18 : 1)})`,
              }}>
                <div style={{
                  clipPath: corte(s, 5, 2), background: c.bg, color: c.fg, padding: `${tam * 0.06}px ${tam * 0.1}px ${tam * 0.02}px`,
                  fontFamily: `'${fuente}'`, fontWeight: peso ?? 400, fontSize: tam, lineHeight: 1.05, position: 'relative',
                }}>
                  <div style={{ position: 'absolute', inset: 0, backgroundImage: FIBRA }} />
                  <span style={{ display: 'inline-block', transform: extra, position: 'relative' }}>{ch}</span>
                </div>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

/** Texto escrito a mano: aparece letra por letra, a saltos de 3 cuadros. */
export const AMano = ({ txt, f, a, dur, fuente = "'Ink Free'", tam, color, peso = 400, style }: {
  txt: string; f: number; a: number; dur: number; fuente?: string; tam: number; color: string; peso?: number; style?: React.CSSProperties;
}) => {
  if (f < a) return null;
  const fq = Math.floor(f / CADA) * CADA + CADA;
  const n = Math.min(txt.length, Math.ceil(((fq - a) / dur) * txt.length));
  return (
    <div style={{ fontFamily: fuente, fontSize: tam, color, fontWeight: peso, whiteSpace: 'pre', lineHeight: 1.1, ...style }}>
      {txt.slice(0, n)}<span style={{ opacity: 0 }}>{txt.slice(n)}</span>
    </div>
  );
};

/** Trazo de marcador que se dibuja (tachón, círculo, subrayado, flecha). */
export const Trazo = ({ d, f, a, dur, color = '#D2232A', grosor = 11, w, h, style, tinta = true }: {
  d: string; f: number; a: number; dur: number; color?: string; grosor?: number; w: number; h: number; style?: React.CSSProperties; tinta?: boolean;
}) => {
  if (f < a) return null;
  const p = Math.min(1, (Math.floor((f - a) / CADA) * CADA + CADA) / dur);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ position: 'absolute', overflow: 'visible', ...style }}>
      <path d={d} pathLength={1} fill="none" stroke={color} strokeWidth={grosor} strokeLinecap="round" strokeLinejoin="round"
        strokeDasharray="1 1" strokeDashoffset={1 - p} style={{ mixBlendMode: tinta ? 'multiply' : 'normal' }} opacity={0.92} />
    </svg>
  );
};

/** Tachón en zigzag, como cuando se tacha con bronca. */
export const zigzag = (w: number, h: number, semilla: number) => {
  const pts: string[] = [];
  const pasadas = 5;
  for (let i = 0; i <= pasadas; i++) {
    const x = i % 2 === 0 ? 6 + azar(semilla + i) * 14 : w - 6 - azar(semilla + i) * 14;
    const y = h * 0.25 + (i / pasadas) * h * 0.5 + (azar(semilla + 20 + i) - 0.5) * 10;
    pts.push(`${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return pts.join(' ');
};

/** Círculo a mano que se pasa un poco de largo. */
export const circulo = (w: number, h: number) =>
  `M ${w * 0.62} ${h * 0.06} C ${w * 1.02} ${h * 0.02}, ${w * 1.04} ${h * 0.94}, ${w * 0.5} ${h * 0.96} C ${w * 0.02} ${h * 0.98}, ${-w * 0.03} ${h * 0.1}, ${w * 0.48} ${h * 0.05} L ${w * 0.7} ${h * 0.09}`;

// ── Sello de goma ────────────────────────────────────────────────────────────
export const Sello = ({ txt, f, a, color, semilla, rot, style, tam = 46 }: {
  txt: string; f: number; a: number; color: string; semilla: number; rot: number; style?: React.CSSProperties; tam?: number;
}) => {
  if (f < a) return null;
  const golpe = f - a < CADA; // primer cuadro: la tinta todavía se está asentando
  const w = txt.length * tam * 0.78 + 60, h = tam * 1.9;
  const id = `s${semilla}`;
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{
      position: 'absolute', overflow: 'visible', mixBlendMode: 'multiply',
      transform: `rotate(${rot}deg) scale(${golpe ? 1.09 : 1})`, opacity: golpe ? 0.8 : 0.96, ...style,
    }}>
      <defs>
        <filter id={`g${id}`}><feTurbulence type="fractalNoise" baseFrequency="0.55" numOctaves="3" seed={semilla} />
          <feColorMatrix values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  12 0 0 0 -7.4" /></filter>
        <mask id={`m${id}`}>
          <rect width={w} height={h} fill="#fff" />
          <rect width={w} height={h} filter={`url(#g${id})`} />
        </mask>
      </defs>
      <g mask={`url(#m${id})`} fill={color} stroke={color}>
        <rect x={5} y={5} width={w - 10} height={h - 10} rx={14} fill="none" strokeWidth={9} />
        <rect x={18} y={18} width={w - 36} height={h - 36} rx={8} fill="none" strokeWidth={3.5} />
        <text x={w / 2} y={h / 2 + tam * 0.36} textAnchor="middle" fontFamily="'VSello', 'Rockwell Extra Bold', Rockwell" fontWeight={800} fontSize={tam} letterSpacing={tam * 0.06} stroke="none">{txt}</text>
      </g>
    </svg>
  );
};

// ── Etiqueta de rotuladora (Dymo): las letras salen de a una ─────────────────
const CINTAS: Record<string, string> = {
  verde: 'linear-gradient(180deg,#1C8A6C 0%,#136B57 45%,#0E5644 100%)',
  negra: 'linear-gradient(180deg,#3A3D40 0%,#1E2022 50%,#141516 100%)',
  roja: 'linear-gradient(180deg,#D8443F 0%,#B3261E 50%,#8E1C16 100%)',
};
export const Dymo = ({ txt, f, a, cada, cinta, tam, semilla, style }: {
  txt: string; f: number; a: number; cada: number; cinta: string; tam: number; semilla: number; style?: React.CSSProperties;
}) => {
  if (f < a) return null;
  const n = Math.min(txt.length, Math.floor((f - a) / cada) + 1);
  const t = tiembla(semilla, f, 0.8);
  return (
    <div style={{
      position: 'absolute', filter: 'drop-shadow(3px 6px 0 rgba(0,0,0,.25)) drop-shadow(1px 10px 10px rgba(0,0,0,.3))',
      transform: `translate(${t.x}px,${t.y}px) rotate(${(azar(semilla) - 0.5) * 3 + t.r}deg)`, ...style,
    }}>
      <div style={{
        background: CINTAS[cinta], padding: `${tam * 0.2}px ${tam * 0.5}px ${tam * 0.14}px`,
        clipPath: 'polygon(1.5% 0, 100% 0, 98.5% 50%, 100% 100%, 0 100%, 1.5% 50%)',
        fontFamily: DYMO, fontWeight: 800, fontSize: tam, letterSpacing: '.09em', lineHeight: 1,
        color: 'rgba(255,255,255,.94)', textShadow: '0 -2px 0 rgba(0,0,0,.35), 0 2px 1px rgba(255,255,255,.25)', whiteSpace: 'pre',
      }}>
        {txt.slice(0, n)}
      </div>
    </div>
  );
};

// ── Mano de papel que señala ─────────────────────────────────────────────────
/** El dedo señala hacia arriba; la punta queda en (0, 0) de la pieza. */
export const Mano = ({ x, y, rot, f, semilla }: { x: number; y: number; rot: number; f: number; semilla: number }) => {
  const t = tiembla(semilla, f, 1.2);
  return (
    <svg width={420} height={900} viewBox="-150 -10 420 900" style={{
      position: 'absolute', left: x - 150, top: y - 10, overflow: 'visible', transformOrigin: '150px 10px',
      transform: `translate(${t.x}px,${t.y}px) rotate(${rot + t.r}deg)`, filter: SOMBRA,
    }}>
      {/* manga */}
      <path d="M -70 380 L 150 360 L 190 900 L -60 900 Z" fill="#136B57" />
      <path d="M -72 380 L 152 360 L 156 420 L -68 440 Z" fill="#0B4A3C" />
      {/* puño */}
      <path d="M -60 200 C -70 150, 0 140, 40 150 L 120 160 C 160 170, 170 230, 160 290 C 150 360, 120 390, 40 392 C -40 394, -70 340, -66 280 Z" fill="#E7B48E" />
      {/* dedo índice */}
      <path d="M -22 175 L -18 30 C -17 -6, 22 -6, 24 30 L 30 180 Z" fill="#E7B48E" />
      <path d="M -10 22 C -6 4, 14 4, 16 22 C 8 30, -4 30, -10 22 Z" fill="#F3D2B8" />
      {/* dedos doblados y pulgar */}
      <path d="M 40 205 C 90 195, 140 205, 150 235 M 38 262 C 90 252, 140 262, 150 290 M 40 318 C 85 312, 130 318, 140 340" stroke="#B7805C" strokeWidth={6} fill="none" strokeLinecap="round" />
      <path d="M -62 230 C -110 210, -120 280, -70 300 C -40 310, -20 290, -30 262 Z" fill="#DDA27B" />
    </svg>
  );
};
