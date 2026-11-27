import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { Camara, Fondo, Monitor, Pulso, Telefono, Titular, Tramo, entra, type Largo, type TramoDatos, type Toma } from '../comunes';

// Placa 5: un cliente arma el pedido en la tienda online real de "Kiosco Los Primos"
// (public/app/tienda.mp4: toques a los 1,62 / 2,11 / 2,50 / 2,89 / 3,48 s, "Enviar pedido" a los 8,11 s) y el
// mismo pedido #D8RS entra en la PC del kiosco (public/app/pc-pedido.mp4: entra a los 1,05 s).
const T: Record<Largo, { tel: TramoDatos[]; pc: TramoDatos[]; pulso: number; tomas: Toma[] }> = {
  10: {
    tel: [{ desde: 1.45, vel: 3, en: 0, dura: 22 }, { desde: 7.9, vel: 1.5, en: 22, dura: 32 }],
    pc: [{ desde: 0, vel: 0.8, en: 0, dura: 40 }, { desde: 1.33, en: 40, dura: 14 }],
    pulso: 30,
    tomas: [{ f: 0, x: 400, y: 1130, z: 1.05 }, { f: 28, x: 410, y: 1120, z: 1.08 }, { f: 40, x: 1110, y: 1080, z: 0.95 }, { f: 44, x: 1110, y: 1060, z: 1.0 }, { f: 54, x: 1125, y: 1000, z: 1.55 }],
  },
  15: {
    // suma 4 Amstel y un Bon o Bon (toques 3, 12, 20, 27, 38) · "Enviar pedido" (48) → "¡Pedido enviado!"
    tel: [{ desde: 1.45, vel: 1.6, en: 0, dura: 40 }, { desde: 7.85, en: 40, dura: 50 }],
    // la PC esperando; el pedido entra en el cuadro 68
    pc: [{ desde: 0, vel: 0.46, en: 0, dura: 68 }, { desde: 1.05, en: 68, dura: 22 }],
    pulso: 57,
    tomas: [{ f: 0, x: 400, y: 1130, z: 1.05 }, { f: 40, x: 405, y: 1125, z: 1.08 }, { f: 56, x: 415, y: 1110, z: 1.12 },
      { f: 68, x: 1110, y: 1080, z: 0.95 }, { f: 74, x: 1110, y: 1060, z: 1.0 }, { f: 86, x: 1125, y: 1000, z: 1.55 }, { f: 90, x: 1125, y: 995, z: 1.58 }],
  },
};

export const PlacaTienda: React.FC<{ largo?: Largo }> = ({ largo = 10 }) => {
  const f = useCurrentFrame();
  const t = T[largo];
  return (
    <AbsoluteFill>
      <Fondo />
      {/* Pantalla de la PC: origen (716, 736), escala 980/1280 */}
      <Camara semilla={5} tomas={t.tomas}>
        <Monitor x={700} y={720} ancho={980} style={entra(f, 4)}>
          {t.pc.map((s) => <Tramo key={s.en} archivo="pc-pedido" {...s} />)}
        </Monitor>
        <Telefono x={110} y={600} ancho={460} style={entra(f, 0)}>
          {t.tel.map((s) => <Tramo key={s.en} archivo="tienda" {...s} />)}
        </Telefono>
        <Pulso de={[560, 1100]} a={[880, 1000]} desde={t.pulso} dura={9} curva={-200} />
      </Camara>
      <Titular etiqueta="4 · Tienda online" tam={90} lineas={[{ t: 'Tu tienda online,' }, { t: 'con el mismo stock.', verde: true }]} />
    </AbsoluteFill>
  );
};
