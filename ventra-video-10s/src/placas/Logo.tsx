import React from 'react';
import { AbsoluteFill, Img, staticFile, useCurrentFrame } from 'remotion';
import { c, inter } from '../marca';
import { Fondo, lineal } from '../comunes';

/** El logo recortado apenas para sacar el borde claro que trae el PNG. */
export const LogoV: React.FC<{ tam: number; style?: React.CSSProperties }> = ({ tam, style }) => (
  <div style={{ width: tam, height: tam, borderRadius: tam * 0.22, overflow: 'hidden', ...style }}>
    <Img src={staticFile('VentraLOGO.png')} style={{ width: tam * 1.06, height: tam * 1.06, margin: -tam * 0.03, display: 'block' }} />
  </div>
);

// Placa 1 (0–1,2 s): logo + gancho. Fondo pino, como el cierre de la web.
export const PlacaLogo: React.FC = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill>
      <Fondo color={c.pino} oscuro />
      <div style={{ position: 'absolute', left: 80, top: 560, display: 'flex', alignItems: 'center', gap: 30 }}>
        <LogoV tam={150} style={{ opacity: lineal(f, 0, 6, 0, 1), scale: `${lineal(f, 0, 10, 0.86, 1)}` }} />
        <div style={{ overflow: 'hidden' }}>
          <div style={{ fontFamily: inter, fontWeight: 750, fontSize: 92, letterSpacing: '-0.035em', color: c.crema, translate: `${lineal(f, 3, 12, -280, 0)}px 0` }}>Ventra</div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 80, top: 800, fontFamily: inter, fontWeight: 800, fontSize: 118, letterSpacing: '-0.05em', lineHeight: 1.04 }}>
        {[
          { t: '4 cosas que', col: c.crema },
          { t: 'tu caja', col: c.crema },
          { t: 'no hace.', col: c.menta300 },
        ].map((l, i) => (
          <div key={l.t} style={{ overflow: 'hidden', height: 128 }}>
            <div style={{ color: l.col, translate: `0 ${lineal(f, 7 + i * 3, 17 + i * 3, 130, 0)}px` }}>{l.t}</div>
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
