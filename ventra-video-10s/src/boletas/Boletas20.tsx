import React from 'react';
import { AbsoluteFill, Easing, Sequence, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { Audio } from '@remotion/media';
import { c, inter } from '../marca';
import { Camara, Fondo, Monitor, Pulso, Telefono, Tramo, entra, lineal } from '../comunes';
import { ALTO_RENGLON, PRIMER_RENGLON, pesos } from '../Boleta';
import { BoletaLarga } from './BoletaLarga';
import { PlacaCierre } from '../placas/PlacaCierre';
import datos from './boleta20.json';

// Video de boletas con IA (20 s). Un solo "mundo": la boleta de papel a la izquierda, el celular en el medio
// y la PC a la derecha; la cámara los recorre siguiendo lo que dice la voz. Tiempos: src/boletas/guion-boletas.json.
// Clips reales: public/app/b20-celu.mp4 (lee de 3,46 a 6,90 s) y public/app/b20-pc.mp4 (lista antes/después,
// aviso a los 20,7 s, toca Revisar a los 22,2 s).

// Dónde está cada cosa en el mundo
const PAPEL = { x: 40, y: 600, esc: 0.82 };
const TEL = { x: 560, y: 760, ancho: 420 };
const PC = { x: 1200, y: 700, ancho: 1000 };
const pcX = (css: number) => PC.x + 16 + css * (PC.ancho / 1280);
const pcY = (css: number) => PC.y + 16 + css * (PC.ancho / 1280);
const renglonY = (i: number) => PAPEL.y + (PRIMER_RENGLON + i * ALTO_RENGLON) * PAPEL.esc;

/** Subtítulo con el estilo de los titulares: entra subiendo desde una máscara y se va hacia arriba. */
const Subtitulo: React.FC<{ desde: number; hasta: number; lineas: { t: string; verde?: boolean }[]; tam?: number }> = ({ desde, hasta, lineas, tam = 88 }) => {
  const f = useCurrentFrame();
  if (f < desde || f >= hasta) return null;
  return (
    <div style={{ position: 'absolute', left: 80, top: 316, right: 40, fontFamily: inter }}>
      {lineas.map((l, i) => (
        <div key={i} style={{ overflow: 'hidden', height: tam * 1.1 }}>
          <div style={{ fontSize: tam, fontWeight: 800, letterSpacing: '-0.045em', lineHeight: 1.08, whiteSpace: 'nowrap', color: l.verde ? c.verde : c.tinta,
            translate: `0 ${lineal(f, desde + i * 3, desde + 10 + i * 3, tam * 1.15, 0) + lineal(f, hasta - 6 + i, hasta, 0, -tam * 1.15, Easing.in(Easing.cubic))}px` }}>{l.t}</div>
        </div>
      ))}
    </div>
  );
};

const Etiqueta: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <div style={{ position: 'absolute', left: 80, top: 262, overflow: 'hidden', height: 44, fontFamily: inter }}>
      <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: c.verde, translate: `0 ${lineal(f, 0, 8, 46, 0)}px`,
        opacity: lineal(f, 474, 484, 1, 0) }}>Boletas con IA</div>
    </div>
  );
};

/** La cámara del celular apuntando a la boleta larga; en el cuadro 70 saca la foto. */
const Visor: React.FC = () => {
  const f = useCurrentFrame();
  const flash = f < 70 ? 0 : lineal(f, 70, 77, 1, 0);
  return (
    <AbsoluteFill style={{ background: '#0B0D0C' }}>
      <AbsoluteFill style={{ background: 'radial-gradient(circle at 45% 40%, #B79E80, #6E5843)', top: 110, bottom: 200, overflow: 'hidden' }}>
        <BoletaLarga style={{ position: 'absolute', left: '50%', top: 20, translate: '-50% 0', scale: `${lineal(f, 40, 70, 0.6, 0.52)}`, transformOrigin: '50% 0', rotate: '-1.5deg' }} />
      </AbsoluteFill>
      {[[34, 140, '0deg'], [386, 140, '90deg'], [386, 690, '180deg'], [34, 690, '270deg']].map(([x, y, r]) => (
        <div key={`${x}-${y}`} style={{ position: 'absolute', left: Number(x) - 20, top: Number(y) - 20, width: 40, height: 40, rotate: String(r),
          borderLeft: '5px solid #FFD60A', borderTop: '5px solid #FFD60A', borderTopLeftRadius: 10 }} />
      ))}
      <div style={{ position: 'absolute', left: '50%', bottom: 56, translate: '-50% 0', width: 104, height: 104, borderRadius: 60, border: '7px solid #fff', boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 78, height: 78, borderRadius: 50, background: '#fff', scale: `${f >= 67 && f < 72 ? 0.85 : 1}` }} />
      </div>
      <AbsoluteFill style={{ background: '#fff', opacity: flash }} />
    </AbsoluteFill>
  );
};

/** Marca sobre la pantalla de la PC: aro menta alrededor de un dato y una etiqueta arriba. */
const Marca: React.FC<{ x: number; y: number; w: number; h: number; desde: number; texto: string; izquierda?: boolean }> = ({ x, y, w, h, desde, texto, izquierda }) => {
  const f = useCurrentFrame();
  if (f < desde) return null;
  const k = lineal(f, desde, desde + 8, 0, 1);
  return (
    <>
      <div style={{ position: 'absolute', left: x - w / 2 - 6, top: y - h / 2 - 4, width: w + 12, height: h + 8, borderRadius: 8, border: `3px solid ${c.menta}`, opacity: k, scale: `${1.25 - 0.25 * k}` }} />
      {/* la etiqueta va en la esquina de arriba a la derecha del aro, pegada al dato (no encima de la fila de arriba) */}
      <div style={{ position: 'absolute', left: izquierda ? x - w / 2 + 4 : x + w / 2 - 4, translate: izquierda ? '-100% 0' : undefined, top: y - h / 2 - 18, padding: '2px 7px', borderRadius: 7, background: c.menta, color: '#fff',
        fontFamily: inter, fontWeight: 750, fontSize: 13, whiteSpace: 'nowrap', opacity: k, boxShadow: '0 2px 6px rgba(8,54,42,.25)' }}>
        <span style={{ display: 'inline-block', translate: `0 ${(1 - k) * 8}px` }}>{texto}</span>
      </div>
    </>
  );
};

export const Boletas20: React.FC = () => {
  const f = useCurrentFrame();
  // la IA lee los 20 renglones entre los cuadros 104 y 186 (a la par del celular, que tarda lo mismo)
  const leidos = interpolate(f, [104, 186], [0, 20], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.sin) });
  const sigue = renglonY(Math.min(19, leidos));
  const control = lineal(f, 186, 194, 0, 1);
  return (
    <AbsoluteFill>
      <Fondo />
      <Camara semilla={7} tomas={[
        { f: 0, x: 335, y: 880, z: 1.35 }, { f: 40, x: 335, y: 1240, z: 1.25 }, { f: 60, x: 560, y: 1150, z: 1.0 }, { f: 92, x: 560, y: 1150, z: 1.0 },
        { f: 104, x: 430, y: renglonY(0) + 140, z: 1.1 }, { f: 145, x: 430, y: (renglonY(0) + sigue) / 2 + 140, z: 1.1 }, { f: 186, x: 430, y: renglonY(19) - 20, z: 1.1 },
        { f: 202, x: 600, y: 1260, z: 0.98 }, { f: 234, x: 640, y: 1220, z: 0.96 },
        { f: 248, x: 1700, y: 1060, z: 0.95 }, { f: 276, x: 1800, y: 1070, z: 1.45 }, { f: 368, x: 1800, y: 1066, z: 1.5 },
        { f: 382, x: 1716, y: 1060, z: 1.0 }, { f: 404, x: 1716, y: 1040, z: 1.05 }, { f: 432, x: 1716, y: 1028, z: 1.5 }, { f: 486, x: 1716, y: 1028, z: 1.56 },
      ]}>
        {/* la boleta de papel */}
        <div style={{ position: 'absolute', left: PAPEL.x, top: PAPEL.y, transformOrigin: '0 0', scale: `${PAPEL.esc}`, rotate: '-1deg' }}>
          <BoletaLarga leidos={f >= 104 ? leidos : undefined} control={control} />
        </div>
        {f >= 186 && (
          <div style={{ position: 'absolute', left: PAPEL.x + 70, top: renglonY(20) + 120, padding: '12px 22px', borderRadius: 16, background: c.verde, color: '#fff',
            fontFamily: inter, fontWeight: 750, fontSize: 30, opacity: lineal(f, 186, 194, 0, 1), translate: `0 ${lineal(f, 186, 196, 24, 0)}px`, boxShadow: '0 12px 30px -10px rgba(8,54,42,.5)' }}>
            Suma $ {pesos(datos.total).replace(',00', '')} = total ✓
          </div>
        )}
        {/* la PC del kiosco */}
        <Monitor x={PC.x} y={PC.y} ancho={PC.ancho}>
          {/* lista de productos antes de la boleta (Bon o Bon: stock 27) */}
          <Tramo archivo="b20-pc" desde={0.6} vel={0.02} en={0} dura={252} />
          {/* después: stock, costos y precios nuevos (Bon o Bon: 39, $ 8.230, $ 11.800) */}
          <Tramo archivo="b20-pc" desde={4.3} vel={0.1} en={252} dura={126} />
          {/* aviso "2 productos nuevos para revisar" (cuadro 386) */}
          <Tramo archivo="b20-pc" desde={20.45} en={378} dura={26} />
          {/* toca Revisar (411): Milka y Takis con foto y nombre, mientras la voz dice "con nombre y foto" (455–488) */}
          <Tramo archivo="b20-pc" desde={22.0} en={404} dura={40} />
          <Tramo archivo="b20-pc" desde={23.3} vel={0.05} en={444} dura={108} />
        </Monitor>
        {f >= 252 && f < 378 && (
          <>
            <Marca x={pcX(838)} y={pcY(463)} w={40} h={26} desde={262} texto="+12" />
            <Marca x={pcX(1104)} y={pcY(463)} w={66} h={22} desde={300} texto="era $ 10.500" izquierda />
          </>
        )}
        {/* el celular, delante de la boleta */}
        <Telefono x={TEL.x} y={TEL.y} ancho={TEL.ancho} style={entra(f, 40)}>
          {f < 84 ? <Visor /> : null}
          {/* "Hoja 1" → toca "Leer la boleta" (cuadro 98) → "La IA está leyendo" → "Boleta leída" (cuadro 201) */}
          <Tramo archivo="b20-celu" desde={3.0} en={84} dura={150} />
          <Tramo archivo="b20-celu" desde={8.0} vel={0.05} en={234} dura={318} />
        </Telefono>
        <Pulso de={[TEL.x + TEL.ancho + 20, 1080]} a={[PC.x + 120, 980]} desde={236} dura={12} curva={-220} />
      </Camara>
      {/* franja del color del fondo detrás de los subtítulos: lo que pasa por debajo no se mezcla con el texto */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 700, background: `linear-gradient(${c.fondo} 0px, ${c.fondo} 590px, ${c.fondo}00 700px)` }} />
      <Etiqueta />
      {/* Subtítulos: lo mismo que dice la voz (src/boletas/guion-boletas.json → voz.tramos) */}
      <Subtitulo desde={4} hasta={98} tam={84} lineas={[{ t: 'Llega el proveedor,' }, { t: 'le sacás una foto' }, { t: 'a la boleta.', verde: true }]} />
      <Subtitulo desde={100} hasta={232} tam={84} lineas={[{ t: 'Ventra la lee solita,' }, { t: 'renglón por renglón.', verde: true }]} />
      <Subtitulo desde={236} hasta={376} tam={80} lineas={[{ t: 'Te suma el stock y te' }, { t: 'actualiza los precios,' }, { t: 'cuidando tu margen.', verde: true }]} />
      <Subtitulo desde={380} hasta={482} tam={84} lineas={[{ t: 'Y si trae productos' }, { t: 'nuevos, te los crea' }, { t: 'con nombre y foto.', verde: true }]} />
      <Sequence name="Cierre" from={486} durationInFrames={66}>
        <PlacaCierre />
      </Sequence>
      {/* Voz, música y efectos ya mezclados: node scripts/audio.mjs src/boletas/guion-boletas.json audio-boletas */}
      <Audio name="Voz, música y efectos" src={staticFile('audio-boletas/mezcla.wav')} />
    </AbsoluteFill>
  );
};
