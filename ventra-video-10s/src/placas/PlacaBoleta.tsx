import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { Boleta } from '../Boleta';
import { Camara, Fondo, Monitor, Pulso, Telefono, Titular, Tramo, entra, lineal, type Largo, type TramoDatos, type Toma } from '../comunes';

/** La cámara del celular apuntando a la boleta; en el cuadro `disparo` saca la foto (destello). */
const Visor: React.FC<{ disparo: number }> = ({ disparo }) => {
  const f = useCurrentFrame();
  const flash = f < disparo + 2 ? 0 : lineal(f, disparo + 2, disparo + 8, 1, 0);
  return (
    <AbsoluteFill style={{ background: '#0B0D0C' }}>
      <AbsoluteFill style={{ background: 'radial-gradient(circle at 45% 40%, #B79E80, #6E5843)', top: 120, bottom: 230 }}>
        <Boleta style={{ position: 'absolute', left: '50%', top: '50%', translate: '-50% -50%', scale: `${lineal(f, 0, disparo + 4, 0.62, 0.58)}`, rotate: '-2deg' }} />
      </AbsoluteFill>
      {/* esquinas de encuadre */}
      {[[38, 160, '0deg'], [432, 160, '90deg'], [432, 780, '180deg'], [38, 780, '270deg']].map(([x, y, r]) => (
        <div key={`${x}-${y}`} style={{ position: 'absolute', left: Number(x) - 22, top: Number(y) - 22, width: 44, height: 44, rotate: String(r),
          borderLeft: '5px solid #FFD60A', borderTop: '5px solid #FFD60A', borderTopLeftRadius: 10 }} />
      ))}
      {/* botón de la cámara */}
      <div style={{ position: 'absolute', left: '50%', bottom: 70, translate: '-50% 0', width: 116, height: 116, borderRadius: 60, border: '7px solid #fff', boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 88, height: 88, borderRadius: 50, background: '#fff', scale: `${f >= disparo && f < disparo + 4 ? 0.86 : 1}` }} />
      </div>
      <AbsoluteFill style={{ background: '#fff', opacity: flash }} />
    </AbsoluteFill>
  );
};

// Tiempos de cada versión, en cuadros locales de la placa. Clips: public/app/boleta.mp4 (celular,
// "leída" a los 7,0 s) y public/app/pc-boleta.mp4 (PC: aviso a los 21,3 s, toca Revisar a los 23,07 s).
const T: Record<Largo, { visor: number; disparo: number; tel: TramoDatos[]; pc: TramoDatos[]; pulso: number; tomas: Toma[] }> = {
  10: {
    visor: 12, disparo: 4,
    tel: [{ desde: 3.3, vel: 2.5, en: 12, dura: 6 }, { desde: 6.75, vel: 2, en: 18, dura: 6 }, { desde: 7.15, en: 24, dura: 30 }],
    pc: [{ desde: 20.125, en: 0, dura: 40 }, { desde: 22.98, vel: 1.5, en: 40, dura: 14 }],
    pulso: 26,
    tomas: [{ f: 0, x: 400, y: 1130, z: 1.05 }, { f: 27, x: 410, y: 1120, z: 1.08 }, { f: 38, x: 1110, y: 1070, z: 0.95 }, { f: 46, x: 1150, y: 1050, z: 1.05 }, { f: 54, x: 1206, y: 1040, z: 1.28 }],
  },
  15: {
    visor: 16, disparo: 7,
    // "Hoja 1" y toca "Leer la boleta" (cuadro 26) · la IA termina: "Boleta leída" (cuadro 38) · queda a la vista
    tel: [{ desde: 3.0, vel: 1.5, en: 16, dura: 14 }, { desde: 6.6, vel: 1.5, en: 30, dura: 12 }, { desde: 7.2, en: 42, dura: 48 }],
    // la PC: aviso "2 productos nuevos para revisar" (cuadro 60) · toca Revisar (71): Milka y Takis con foto y nombre
    pc: [{ desde: 19.325, en: 0, dura: 66 }, { desde: 22.9, en: 66, dura: 24 }],
    pulso: 47,
    tomas: [{ f: 0, x: 400, y: 1130, z: 1.05 }, { f: 30, x: 405, y: 1125, z: 1.07 }, { f: 40, x: 420, y: 1110, z: 1.13 }, { f: 47, x: 420, y: 1110, z: 1.13 },
      { f: 59, x: 1110, y: 1070, z: 0.95 }, { f: 68, x: 1150, y: 1050, z: 1.05 }, { f: 80, x: 1206, y: 1040, z: 1.3 }, { f: 90, x: 1206, y: 1040, z: 1.34 }],
  },
};

// Placa 2: el celular le saca foto a la boleta y la lee; la PC recibe los productos nuevos con nombre y foto.
export const PlacaBoleta: React.FC<{ largo?: Largo }> = ({ largo = 10 }) => {
  const f = useCurrentFrame();
  const t = T[largo];
  return (
    <AbsoluteFill>
      <Fondo />
      <Camara semilla={2} tomas={t.tomas}>
        <Monitor x={700} y={720} ancho={980} style={entra(f, 4)}>
          {t.pc.map((s) => <Tramo key={s.en} archivo="pc-boleta" {...s} />)}
        </Monitor>
        <Telefono x={110} y={600} ancho={460} style={entra(f, 0)}>
          {f < t.visor ? <Visor disparo={t.disparo} /> : null}
          {t.tel.map((s) => <Tramo key={s.en} archivo="boleta" {...s} />)}
        </Telefono>
        <Pulso de={[560, 1040]} a={[880, 960]} desde={t.pulso} dura={10} curva={-180} />
      </Camara>
      <Titular etiqueta="1 · Boletas con IA" lineas={[{ t: 'Foto a la boleta.' }, { t: 'Se carga sola.', verde: true }]} />
    </AbsoluteFill>
  );
};
