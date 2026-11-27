import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { c, inter } from '../marca';
import { Camara, Fondo, Monitor, Titular, Tramo, entra, lineal, type Largo, type TramoDatos, type Toma } from '../comunes';

// Placa 4 (4,8–6,6 s): se corta internet y la caja de la PC sigue cobrando; después se pone al día sola.
// Grabación real public/app/pc-cobro.mp4: "Sin señal", 4 códigos escaneados, Efectivo, vuelto, "Datos al día".
const Estado: React.FC<{ alDiaEn: number }> = ({ alDiaEn }) => {
  const f = useCurrentFrame();
  const alDia = f >= alDiaEn;
  const sale = lineal(f, 3, 10, 0, 1);
  const cambio = lineal(f, alDiaEn, alDiaEn + 6, 0, 1);
  const chip = (fondo: string, borde: string, color: string, icono: React.ReactNode, texto: string, opacidad: number, dy: number) => (
    <div style={{ position: 'absolute', left: 0, top: 0, display: 'flex', alignItems: 'center', gap: 18, padding: '20px 34px 20px 26px', borderRadius: 26, background: fondo,
      border: `3px solid ${borde}`, color, fontFamily: inter, fontSize: 48, fontWeight: 750, letterSpacing: '-0.02em', opacity: opacidad, translate: `0 ${dy}px`, whiteSpace: 'nowrap' }}>
      {icono}{texto}
    </div>
  );
  const sinSenal = (
    <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M2 2l20 20M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5.2-2.8M19 13a10 10 0 0 0-2.2-1.6M2 8.8a15 15 0 0 1 4.3-2.6M22 8.8A15 15 0 0 0 10.7 5" /><circle cx="12" cy="20" r="0.6" />
    </svg>
  );
  const tilde = (
    <svg width="46" height="46" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><path d="M4 12.5l5 5L20 6.5" /></svg>
  );
  return (
    <div style={{ position: 'absolute', left: 80, top: 548, width: 920, height: 110 }}>
      {chip('#FFF7E0', '#F2C94C', '#7A5200', sinSenal, 'Sin señal · cobrando igual', alDia ? 1 - cambio : sale, alDia ? -30 * cambio : 20 * (1 - sale))}
      {alDia && chip(c.menta50, c.menta300, c.verdeOscuro, tilde, 'Datos al día', cambio, 30 * (1 - cambio))}
    </div>
  );
};

// Cuadros locales. Clip pc-cobro.mp4: "Sin señal" (0,85 s), lector (1,9 / 3,05 / 4,17 / 5,27 s), Efectivo y
// $ 25.000 (9,0–9,4 s: vuelto $ 3.700), Enter (10,45 s), "Datos al día" (12,25 s).
const T: Record<Largo, { tramos: TramoDatos[]; alDia: number; tomas: Toma[] }> = {
  10: {
    tramos: [{ desde: 0.75, en: 0, dura: 8 }, { desde: 1.6, vel: 7, en: 8, dura: 17 }, { desde: 8.9, vel: 2, en: 25, dura: 14 }, { desde: 10.25, vel: 1.5, en: 39, dura: 7 }, { desde: 12.05, en: 46, dura: 8 }],
    alDia: 47,
    tomas: [
      { f: 0, x: 556, y: 1016, z: 1.08 }, { f: 6, x: 556, y: 1016, z: 1.08 },
      { f: 14, x: 700, y: 880, z: 1.22 }, { f: 24, x: 720, y: 880, z: 1.25 },
      { f: 32, x: 556, y: 1040, z: 1.3 }, { f: 40, x: 556, y: 1030, z: 1.28 },
      { f: 50, x: 556, y: 1000, z: 1.15 }, { f: 54, x: 556, y: 995, z: 1.16 },
    ],
  },
  15: {
    // "Sin señal" (cuadro 8) · el lector pasa 4 productos (15, 24, 34, 44) · vuelto (56) · venta hecha (73) · "Datos al día" (84)
    tramos: [{ desde: 0.6, en: 0, dura: 12 }, { desde: 1.6, vel: 3.5, en: 12, dura: 33 }, { desde: 8.85, vel: 1.5, en: 45, dura: 22 }, { desde: 10.25, en: 67, dura: 11 }, { desde: 12.05, en: 78, dura: 12 }],
    alDia: 84,
    tomas: [
      { f: 0, x: 556, y: 1016, z: 1.08 }, { f: 9, x: 556, y: 1016, z: 1.08 },
      { f: 19, x: 700, y: 880, z: 1.22 }, { f: 42, x: 725, y: 875, z: 1.26 },
      { f: 52, x: 556, y: 1040, z: 1.3 }, { f: 70, x: 556, y: 1035, z: 1.3 },
      { f: 80, x: 556, y: 1000, z: 1.15 }, { f: 90, x: 556, y: 990, z: 1.18 },
    ],
  },
};

export const PlacaSinInternet: React.FC<{ largo?: Largo }> = ({ largo = 10 }) => {
  const f = useCurrentFrame();
  const t = T[largo];
  return (
    <AbsoluteFill>
      <Fondo />
      {/* Pantalla de la PC: origen (56, 656), escala 1000/1280 */}
      <Camara semilla={4} tomas={t.tomas}>
        <Monitor x={40} y={640} ancho={1000} style={entra(f, 0)}>
          {t.tramos.map((s) => <Tramo key={s.en} archivo="pc-cobro" {...s} />)}
        </Monitor>
      </Camara>
      <Estado alDiaEn={t.alDia} />
      <Titular etiqueta="3 · Sin internet" lineas={[{ t: 'Se corta internet.' }, { t: 'La caja sigue.', verde: true }]} />
    </AbsoluteFill>
  );
};
