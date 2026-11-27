import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { c, inter } from '../marca';
import { Fondo, lineal } from '../comunes';
import { LogoV } from './Logo';

// Placa 6 (8,4–10 s): el verde entra con un círculo que crece; logo, llamado a la acción, la web y el precio.
// El golpe final de la música cae en el cuadro 27 (279 del video): el botón se "aprieta".
export const PlacaCierre: React.FC = () => {
  const f = useCurrentFrame();
  const radio = lineal(f, 0, 11, 0, 1250);
  const golpe = f >= 27 && f < 31 ? 0.96 : 1;
  return (
    <AbsoluteFill>
      <Fondo />
      <div style={{ position: 'absolute', left: 540 - radio, top: 960 - radio, width: radio * 2, height: radio * 2, borderRadius: '50%', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: radio - 540, top: radio - 960, width: 1080, height: 1920 }}>
          <Fondo color={c.pino} oscuro />
        </div>
      </div>
      <div style={{ position: 'absolute', left: 80, top: 520, display: 'flex', alignItems: 'center', gap: 28 }}>
        <LogoV tam={128} style={{ opacity: lineal(f, 5, 10, 0, 1), scale: `${lineal(f, 5, 14, 0.86, 1)}` }} />
        <div style={{ overflow: 'hidden' }}>
          <div style={{ fontFamily: inter, fontWeight: 750, fontSize: 80, letterSpacing: '-0.035em', color: c.crema, translate: `${lineal(f, 7, 15, -260, 0)}px 0` }}>Ventra</div>
        </div>
      </div>
      <div style={{ position: 'absolute', left: 80, top: 720, fontFamily: inter, fontWeight: 800, fontSize: 124, letterSpacing: '-0.05em', lineHeight: 1.02 }}>
        {[{ t: 'Probalo', col: c.crema }, { t: '7 días gratis.', col: c.menta300 }].map((l, i) => (
          <div key={l.t} style={{ overflow: 'hidden', height: 134 }}>
            <div style={{ color: l.col, translate: `0 ${lineal(f, 9 + i * 3, 19 + i * 3, 136, 0)}px` }}>{l.t}</div>
          </div>
        ))}
      </div>
      <div style={{ position: 'absolute', left: 80, top: 1040, display: 'flex', alignItems: 'center', gap: 22, padding: '26px 44px', borderRadius: 22, background: c.menta,
        fontFamily: inter, fontWeight: 750, fontSize: 60, letterSpacing: '-0.02em', color: c.pinoProfundo,
        opacity: lineal(f, 15, 21, 0, 1), translate: `0 ${lineal(f, 15, 24, 40, 0)}px`, scale: `${golpe}`, transformOrigin: '0 50%' }}>
        ventra.store
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke={c.pinoProfundo} strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h13M13 6l6 6-6 6" /></svg>
      </div>
      <div style={{ position: 'absolute', left: 82, top: 1200, fontFamily: inter, fontWeight: 550, fontSize: 38, color: 'rgba(246,242,236,.72)', lineHeight: 1.35,
        opacity: lineal(f, 19, 26, 0, 1) }}>
        $0 hoy · después $24.900 por mes<br />Sin permanencia
      </div>
    </AbsoluteFill>
  );
};
