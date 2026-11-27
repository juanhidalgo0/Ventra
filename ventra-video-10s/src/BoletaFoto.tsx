import React from 'react';
import { AbsoluteFill } from 'remotion';
import { Boleta } from './Boleta';

// "Foto" de la boleta sobre el mostrador, para que la app la reciba en la grabación (Hoja 1).
export const BoletaFoto: React.FC = () => (
  <AbsoluteFill style={{ background: 'radial-gradient(circle at 40% 35%, #B79E80 0%, #8E7559 70%, #6E5843 100%)', alignItems: 'center', justifyContent: 'center' }}>
    <Boleta style={{ rotate: '-2.5deg', scale: '1.12' }} />
    <AbsoluteFill style={{ background: 'radial-gradient(ellipse at 50% 40%, rgba(255,240,210,.12), rgba(0,0,0,.28) 85%)' }} />
  </AbsoluteFill>
);
