import React from 'react';
import { AbsoluteFill, Sequence, staticFile } from 'remotion';
import { Audio } from '@remotion/media';
import { c } from './marca';
import type { Largo } from './comunes';
import { PlacaLogo } from './placas/Logo';
import { PlacaBoleta } from './placas/PlacaBoleta';
import { PlacaWhatsApp } from './placas/PlacaWhatsApp';
import { PlacaSinInternet } from './placas/PlacaSinInternet';
import { PlacaTienda } from './placas/PlacaTienda';
import { PlacaCierre } from './placas/PlacaCierre';
import guion10 from './guion.json';
import guion15 from './guion15.json';

// Los tiempos de las placas salen del guion de cada versión (el audio usa el mismo archivo):
// 10 s = src/guion.json (300 cuadros) · 15 s = src/guion15.json (450 cuadros).
const VentraVideo: React.FC<{ largo: Largo }> = ({ largo }) => {
  const g = largo === 15 ? guion15 : guion10;
  const p = Object.fromEntries(g.placas.map((x) => [x.id, x]));
  return (
    <AbsoluteFill style={{ background: c.fondo }}>
      <Sequence name="1 · Logo" from={p.logo.desde} durationInFrames={p.logo.dura}>
        <PlacaLogo />
      </Sequence>
      <Sequence name="2 · Boleta" from={p.boleta.desde} durationInFrames={p.boleta.dura}>
        <PlacaBoleta largo={largo} />
      </Sequence>
      <Sequence name="3 · WhatsApp" from={p.whatsapp.desde} durationInFrames={p.whatsapp.dura}>
        <PlacaWhatsApp largo={largo} />
      </Sequence>
      <Sequence name="4 · Sin internet" from={p.sininternet.desde} durationInFrames={p.sininternet.dura}>
        <PlacaSinInternet largo={largo} />
      </Sequence>
      <Sequence name="5 · Tienda" from={p.tienda.desde} durationInFrames={p.tienda.dura}>
        <PlacaTienda largo={largo} />
      </Sequence>
      <Sequence name="6 · Cierre" from={p.cierre.desde} durationInFrames={p.cierre.dura}>
        <PlacaCierre />
      </Sequence>
      {/* Música y efectos hechos con scripts/audio.mjs (mismos tiempos del guion) */}
      <Audio name="Música y efectos" src={staticFile(largo === 15 ? 'audio15/mezcla.wav' : 'audio/mezcla.wav')} />
    </AbsoluteFill>
  );
};

export const Ventra10s: React.FC = () => <VentraVideo largo={10} />;
export const Ventra15s: React.FC = () => <VentraVideo largo={15} />;
