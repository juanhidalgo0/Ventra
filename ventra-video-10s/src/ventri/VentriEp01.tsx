import React from 'react';
import { AbsoluteFill, Img, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { Audio, Video } from '@remotion/media';
import { Telefono, lineal } from '../comunes';
import { Escena, Frase, Placa, Subtitulos, Toma, cubrir } from './comun';
import G from './guion-ep01.json';

// Ventri, episodio 1: "La pila de boletas". Caricatura 2D (Higgsfield) + la app REAL en las pantallas.
// Biblia del personaje: marketing/ventri/BIBLIA.md. Tiempos: guion-ep01.json (también los usa la mezcla).
// Las piezas que se repiten en la serie (toma, subtítulos, placa) están en ./comun.tsx.

/** El celular real grande, con la cocina del kiosco desenfocada atrás. */
const CelularReal: React.FC<{ e: Escena }> = ({ e }) => {
  const f = useCurrentFrame();
  // entero en cuadro: arranca debajo de los subtítulos (que llegan hasta ~520) y termina antes del borde de abajo
  const ancho = 560;
  const sube = lineal(f, 0, 9, 90, 0);
  let en = 0;
  return (
    <AbsoluteFill>
      <Img src={staticFile('ventri/k3-celular.png')} style={{ ...cubrir, filter: 'blur(22px) brightness(.62) saturate(1.1)', transform: 'scale(1.15)' }} />
      <Telefono x={(1080 - ancho) / 2 - 15} y={545 + sube} ancho={ancho}>
        {e.celular!.map((t, i) => {
          const dura = Math.round(((t.hasta - t.desde) / t.vel) * 30);
          const seq = (
            <Sequence key={i} from={en} durationInFrames={i === e.celular!.length - 1 ? e.dura - en : dura} layout="none">
              <Video src={staticFile('app/b20-celu.mp4')} trimBefore={Math.round(t.desde * 30)} playbackRate={t.vel} muted style={cubrir} />
            </Sequence>
          );
          en += dura;
          return seq;
        })}
      </Telefono>
    </AbsoluteFill>
  );
};

export const VentriEp01: React.FC = () => {
  const f = useCurrentFrame();
  const flash = interpolate(f, [G.flash, G.flash + 2, G.flash + 9], [0, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {(G.escenas as Escena[]).map((e) => (
        <Sequence key={e.id} name={e.id} from={e.desde} durationInFrames={e.dura}>
          {e.celular ? <CelularReal e={e} /> : <Toma e={e} />}
        </Sequence>
      ))}
      <AbsoluteFill style={{ background: '#fff', opacity: flash }} />
      <Subtitulos frases={G.voz.frases as Frase[]} />
      <Sequence name="cierre" from={G.cierre.desde}>
        <Placa arriba="Comentá" grande={G.cierre.palabra} abajo="y te escribo yo" pastilla={`${G.cierre.web} · ${G.cierre.oferta}`} />
      </Sequence>
      {/* Voz y efectos ya mezclados: python scripts/ventri-mezcla.py */}
      <Audio name="Voz y efectos" src={staticFile('ventri/mezcla.wav')} />
    </AbsoluteFill>
  );
};
