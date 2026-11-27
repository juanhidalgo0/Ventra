import React from 'react';
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { Audio } from '@remotion/media';
import { inter } from '../marca';
import { lineal, suave } from '../comunes';
import { CREMA, Frase, Placa, Subtitulos, VERDE, cubrir } from './comun';
import { SelloExplica } from './SelloExplica';
import { Impresa } from './VentriEp02';
import T from '../../public/ventri/titere/titere.json';

// Shorts baratos de Ventri: el "títere" (una pose + bocas + parpadeo, scripts/ventri-titere.py) animado acá,
// sin generar video con IA. Cada short es un guion JSON en src/ventri/cortos/ (tiempos, voz, boca, planos).
// Boca: scripts/ventri-titere-boca.py · Sonido: scripts/ventri-mezcla.py. Biblia: marketing/ventri/BIBLIA.md.

type Renglon = { t: string; tam: number };
export type GuionCorto = {
  fps: number; total: number; salida: string; fondo: string;
  titere: { x: number; pie: number; alto: number };
  entrada?: { desde: number[]; dura: number };
  voz: { archivo: string; frases: Frase[] };
  boca: string;
  planos: { en: number; zoom: number; foco: number[] }[];
  impresa?: { desde: number; hasta: number; renglones: Renglon[] };
  cartel?: { desde: number; hasta: number; arriba: string; grande: string; abajo: string };
  sello?: { desde: number; hasta: number };
  cierre?: { desde: number; grande: string; abajo: string; web: string };
};

const BOCAS: Record<string, string> = { c: 'chica', a: 'a', o: 'o', e: 'e' };

/** Parpadeos "al azar" pero siempre iguales (cada 2,8 a 4,3 s), 4 cuadros cada uno. */
const parpadea = (f: number, desde: number) => {
  let t = desde + 40;
  let i = 0;
  while (t <= f) {
    if (f < t + 4) return true;
    t += 84 + ((i * 37) % 46);
    i++;
  }
  return false;
};

const Titere: React.FC<{ g: GuionCorto }> = ({ g }) => {
  const f = useCurrentFrame();
  const { x, pie, alto } = g.titere;
  const k = alto / T.alto;
  const ancho = T.ancho * k;
  const boca = g.boca[Math.min(f, g.boca.length - 1)] ?? '-';
  const abierta = boca === '-' ? 0 : boca === 'c' ? 0.4 : 1;

  // respiración y vaivén (el papel se estira y se balancea apoyado en los pies)
  let sy = 1 + 0.012 * Math.sin((f / 50) * Math.PI * 2);
  let sx = 1 - 0.006 * Math.sin((f / 50) * Math.PI * 2);
  let rot = 1.1 * Math.sin((f / 90) * Math.PI * 2);
  let dy = -5 * abierta;
  let px = x;
  let py = pie;
  let escala = 1;

  // saltito al empezar cada frase (menos la primera, que viene con la entrada)
  for (const fr of g.voz.frases.slice(1)) {
    const t = f - (fr.en - 4);
    if (t >= 0 && t < 10) dy -= 34 * Math.sin((t / 10) * Math.PI);
    if (t >= 10 && t < 16) { const q = 1 - (t - 10) / 6; sy *= 1 - 0.06 * q; sx *= 1 + 0.05 * q; }
  }

  // entrada: sale de la impresora, vuela en arco y cae parada en el mostrador
  const e = g.entrada;
  if (e && f < e.dura + 8) {
    const t = Math.min(1, f / e.dura);
    px = interpolate(t, [0, 1], [e.desde[0], x]);
    py = interpolate(t, [0, 1], [e.desde[1], pie]) - Math.sin(t * Math.PI) * 420;
    escala = interpolate(t, [0, 1], [0.3, 1], { easing: suave });
    rot += (1 - t) * -25;
    if (f >= e.dura) { const q = 1 - (f - e.dura) / 8; sy *= 1 - 0.12 * q; sx *= 1 + 0.09 * q; }
  }

  const ojos = parpadea(f, e ? e.dura : 0);
  const capa: React.CSSProperties = { position: 'absolute', left: 0, top: 0, width: ancho, height: alto };
  return (
    <div
      style={{
        position: 'absolute', left: px - ancho / 2, top: py - alto + dy, width: ancho, height: alto,
        transformOrigin: '50% 100%', transform: `rotate(${rot}deg) scale(${escala * sx}, ${escala * sy})`,
        filter: 'drop-shadow(0 10px 0 rgba(0,0,0,.28))',
      }}
    >
      <Img src={staticFile('ventri/titere/base.png')} style={capa} />
      <Img src={staticFile('ventri/titere/cerrados.png')} style={{ ...capa, opacity: ojos ? 1 : 0 }} />
      {Object.entries(BOCAS).map(([c, archivo]) => (
        <Img key={c} src={staticFile(`ventri/titere/${archivo}.png`)} style={{ ...capa, opacity: boca === c ? 1 : 0 }} />
      ))}
    </div>
  );
};

/** Cámara: cortes rápidos (zoom a la cara y vuelta) como los shorts editados a mano. */
const Camara: React.FC<{ g: GuionCorto; children: React.ReactNode }> = ({ g, children }) => {
  const f = useCurrentFrame();
  let i = 0;
  while (i + 1 < g.planos.length && g.planos[i + 1].en <= f) i++;
  const p = g.planos[i];
  const ant = g.planos[Math.max(0, i - 1)];
  const t = lineal(f, p.en, p.en + 5, 0, 1);
  const zoom = ant.zoom + (p.zoom - ant.zoom) * t;
  const fx = ant.foco[0] + (p.foco[0] - ant.foco[0]) * t;
  const fy = ant.foco[1] + (p.foco[1] - ant.foco[1]) * t;
  const lento = 1 + 0.03 * (f / g.total); // acercamiento lento de fondo
  return (
    <AbsoluteFill style={{ transformOrigin: `${fx}px ${fy}px`, transform: `scale(${zoom * lento})` }}>{children}</AbsoluteFill>
  );
};

/** Cartel tipo talón de ticket que cae con rebote (ej. "VENCE EL 18 DE DICIEMBRE"). */
const Cartel: React.FC<{ arriba: string; grande: string; abajo: string }> = ({ arriba, grande, abajo }) => {
  const f = useCurrentFrame();
  const y = interpolate(f, [0, 7, 11, 14], [-420, 18, -8, 0], { extrapolateRight: 'clamp' });
  return (
    <div style={{ position: 'absolute', right: 70, top: 760 + y, width: 330, transform: 'rotate(5deg)', background: CREMA, border: '6px solid #111',
      borderRadius: 14, boxShadow: '0 10px 0 rgba(0,0,0,.35)', padding: '18px 0 22px', textAlign: 'center', fontFamily: inter }}>
      <div style={{ fontWeight: 800, fontSize: 38, color: '#1f1d1a', letterSpacing: 1 }}>{arriba}</div>
      <div style={{ fontWeight: 900, fontSize: Math.min(190, 300 / (grande.length * 0.6)), lineHeight: 1, color: VERDE, letterSpacing: -4 }}>{grande}</div>
      <div style={{ fontWeight: 800, fontSize: 40, color: '#1f1d1a' }}>{abajo}</div>
    </div>
  );
};

export const VentriCorto: React.FC<{ g: GuionCorto }> = ({ g }) => (
  <AbsoluteFill style={{ background: '#000' }}>
    <Camara g={g}>
      <Img src={staticFile(g.fondo)} style={cubrir} />
      <Titere g={g} />
      {g.impresa ? (
        <Sequence name="tira impresa" from={g.impresa.desde} durationInFrames={g.impresa.hasta - g.impresa.desde}>
          <Impresa renglones={g.impresa.renglones} dura={g.impresa.hasta - g.impresa.desde} />
        </Sequence>
      ) : null}
    </Camara>
    {g.cartel ? (
      <Sequence name="cartel" from={g.cartel.desde} durationInFrames={g.cartel.hasta - g.cartel.desde}>
        <Cartel {...g.cartel} />
      </Sequence>
    ) : null}
    {g.sello ? (
      <Sequence name="sello" from={g.sello.desde} durationInFrames={g.sello.hasta - g.sello.desde}>
        <SelloExplica />
      </Sequence>
    ) : null}
    <Subtitulos frases={g.voz.frases} />
    {g.cierre ? (
      <Sequence name="cierre" from={g.cierre.desde}>
        <Placa grande={g.cierre.grande} abajo={g.cierre.abajo} pastilla={g.cierre.web} />
      </Sequence>
    ) : null}
    <Audio name="Voz y efectos" src={staticFile(g.salida)} />
  </AbsoluteFill>
);
