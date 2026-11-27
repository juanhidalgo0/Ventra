import React from 'react';
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { Audio } from '@remotion/media';
import { inter } from '../marca';
import { lineal } from '../comunes';
import { Escena, Frase, Placa, Subtitulos, Toma, VERDE, VERDE_CLARO, cubrir, letra } from './comun';
import { SelloExplica } from './SelloExplica';
import G from './guion-ep02.json';
import s1 from './ep02/tira-s1.json';
import s2 from './ep02/tira-s2.json';
import s3 from './ep02/tira-s3.json';
import s4 from './ep02/tira-s4.json';
import s5 from './ep02/tira-s5.json';

// Ventri explica, episodio 2: "¿Cuánto aguinaldo te toca?". Biblia: marketing/ventri/BIBLIA.md.
// Tiempos: guion-ep02.json (también los usa scripts/ventri-mezcla.py). Datos verificados: marketing/ventri/ep02/datos.md.
// Las cuentas NO las dibuja la IA: se escriben acá encima del papel en blanco que Ventri tiene en la mano,
// siguiendo su movimiento cuadro a cuadro (scripts/ventri-tira.py → ep02/tira-*.json).

type Seguimiento = { ancho: number; alto: number; rect: number[]; cuadros: number[][] };
const SEGUIMIENTOS: Record<string, Seguimiento> = { s1, s2, s3, s4, s5 };
type Renglon = { t: string; tam: number; verde?: boolean; luego?: number };
type Tira = { escena: string; seguimiento: string; caja: number[]; desde: number; hasta?: number; escribe: number; fuente?: string; renglones: Renglon[] };

const TINTA = '#1f1d1a';
// letra de lo impreso: la misma que tiene Ventri en el cuerpo (Alfajor… TOTAL $12.450), negra y gruesa
const ticket = (tam: number): React.CSSProperties => ({
  fontFamily: inter, fontWeight: 800, fontSize: tam, lineHeight: 1.08, color: TINTA,
  letterSpacing: 0, whiteSpace: 'nowrap', opacity: 0.92,
});
const almanaque = (tam: number, verde?: boolean): React.CSSProperties => ({
  fontFamily: inter, fontWeight: 900, fontSize: tam, lineHeight: 1, color: verde ? VERDE : TINTA, letterSpacing: tam > 80 ? -4 : 1, whiteSpace: 'nowrap',
});

/** El texto escrito sobre el papel de la toma: se mueve, gira y se achica igual que el papel. */
const TextoEnPapel: React.FC<{ t: Tira }> = ({ t }) => {
  const f = useCurrentFrame(); // relativo a la escena
  if (f < t.desde || (t.hasta !== undefined && f >= t.hasta)) return null;
  const S = SEGUIMIENTOS[t.seguimiento];
  const [a, b, tx, ty] = S.cuadros[Math.min(f, S.cuadros.length - 1)];
  const s = Math.max(1080 / S.ancho, 1920 / S.alto); // la toma cubre el cuadro (objectFit: cover)
  const ox = (1080 - S.ancho * s) / 2;
  const oy = (1920 - S.alto * s) / 2;
  const [x0, y0, x1, y1] = t.caja;
  const falta = interpolate(f, [t.desde, t.desde + Math.max(1, t.escribe)], [100, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', left: 0, top: 0, width: S.ancho, height: S.alto, transformOrigin: '0 0', transform: `translate(${ox}px, ${oy}px) scale(${s})` }}>
      <div
        style={{
          position: 'absolute', left: 0, top: 0, width: x1 - x0, height: y1 - y0, transformOrigin: '0 0',
          transform: `matrix(${a}, ${b}, ${-b}, ${a}, ${tx}, ${ty}) translate(${x0}px, ${y0}px)`,
          display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center',
          clipPath: `inset(0 0 ${falta}% 0)`, mixBlendMode: 'multiply',
        }}
      >
        {t.renglones.map((r, i) => (
          <div key={i} style={{ ...(t.fuente === 'almanaque' ? almanaque(r.tam, r.verde) : ticket(r.tam)), opacity: f >= t.desde + (r.luego ?? 0) ? 1 : 0 }}>
            {r.t}
          </div>
        ))}
      </div>
    </div>
  );
};

/** La tira con el resultado: sale de abajo como un ticket recién impreso, con el borde de arriba dentado. */
export const Impresa: React.FC<{ renglones: Renglon[]; dura: number }> = ({ renglones, dura }) => {
  const f = useCurrentFrame();
  const sube = lineal(f, 0, 12, 1, 0);
  const baja = lineal(f, dura - 8, dura, 0, 1);
  const y = 1150 + (sube + baja) * 800;
  const ancho = 290;
  const dientes = Array.from({ length: 12 }, (_, i) => `${(i * ancho) / 12 + ancho / 24},0 ${((i + 1) * ancho) / 12},14`).join(' ');
  return (
    <div style={{ position: 'absolute', left: 750, top: y, width: ancho, height: 900, transform: 'rotate(4deg)', transformOrigin: 'center top' }}>
      <svg width={ancho} height={900} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', filter: 'drop-shadow(0 8px 0 rgba(0,0,0,.35))' }}>
        <polygon points={`0,14 ${dientes} ${ancho},900 0,900`} fill="#FBF7EE" stroke="#111" strokeWidth={5} strokeLinejoin="round" />
      </svg>
      <div style={{ position: 'absolute', top: 40, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
        {renglones.map((r, i) => (
          <div key={i} style={ticket(r.tam)}>{r.t}</div>
        ))}
        <div style={{ width: ancho - 50, borderTop: `3px dashed ${TINTA}`, marginTop: 6, opacity: 0.7 }} />
      </div>
    </div>
  );
};

export const VentriEp02: React.FC = () => {
  const tiras = G.tiras as Tira[];
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {(G.escenas as Escena[]).map((e) => (
        <Sequence key={e.id} name={e.id} from={e.desde} durationInFrames={e.dura}>
          <Toma e={e}>
            {tiras.filter((t) => t.escena === e.id).map((t, i) => (
              <TextoEnPapel key={i} t={t} />
            ))}
          </Toma>
        </Sequence>
      ))}
      <Sequence name="tira impresa" from={G.impresa.desde} durationInFrames={G.impresa.hasta - G.impresa.desde}>
        <Impresa renglones={G.impresa.renglones} dura={G.impresa.hasta - G.impresa.desde} />
      </Sequence>
      <Sequence name="sello" from={G.sello.desde} durationInFrames={G.sello.hasta - G.sello.desde}>
        <SelloExplica />
      </Sequence>
      <Subtitulos frases={G.voz.frases as Frase[]} />
      <Sequence name="cierre" from={G.cierre.desde}>
        <Placa grande={G.cierre.grande} abajo={G.cierre.abajo} pastilla={G.cierre.web} />
      </Sequence>
      {/* Voz y efectos ya mezclados: python scripts/ventri-mezcla.py src/ventri/guion-ep02.json */}
      <Audio name="Voz y efectos" src={staticFile(G.salida)} />
    </AbsoluteFill>
  );
};

/** Portada del reel: Ventri rompiendo la tira y la pregunta arriba (npx remotion still VentriEp02Portada). */
export const VentriEp02Portada: React.FC = () => (
  <AbsoluteFill style={{ background: '#000' }}>
    <Img src={staticFile('ventri/ep02/portada-base.png')} style={{ ...cubrir, transform: 'scale(1.06) translateY(40px)' }} />
    <SelloExplica />
    <div style={{ position: 'absolute', top: 290, left: 40, right: 40, textAlign: 'center' }}>
      <div style={letra(120)}>¿CUÁNTO</div>
      <div style={{ ...letra(132), color: VERDE_CLARO }}>AGUINALDO</div>
      <div style={letra(120)}>TE TOCA?</div>
    </div>
  </AbsoluteFill>
);
