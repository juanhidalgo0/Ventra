import React from 'react';
import { AbsoluteFill } from 'remotion';
import { Boleta, pesos } from '../Boleta';
import datos from './boleta20.json';

/** La boleta de 20 renglones de Distribuidora Norte (datos de scripts/boleta20.mjs). */
export const RENGLONES20 = datos.renglones.map((r) => ({ cant: r.cant, desc: r.desc, unit: pesos(r.unit), imp: pesos(r.imp) }));
export const TOTAL20 = pesos(datos.total);
export const ALTO20 = 1340;

export const BoletaLarga: React.FC<{ style?: React.CSSProperties; leidos?: number; control?: number }> = ({ style, leidos, control }) => (
  <Boleta renglones={RENGLONES20} total={TOTAL20} alto={ALTO20} leidos={leidos} control={control} style={style} />
);

/** "Foto" de la boleta larga sobre el mostrador, para que la app la reciba en la grabación (grabaciones/boleta20.png). */
export const BoletaLargaFoto: React.FC = () => (
  <AbsoluteFill style={{ background: 'radial-gradient(circle at 40% 35%, #B79E80 0%, #8E7559 70%, #6E5843 100%)', alignItems: 'center', justifyContent: 'center' }}>
    <BoletaLarga style={{ rotate: '-2deg', scale: '0.96' }} />
    <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(255,240,210,.12), rgba(0,0,0,.28) 85%)' }} />
  </AbsoluteFill>
);
