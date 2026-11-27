import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { Chat } from './ReelBot';

// Solo la pantalla del celular (el chat con Ventra), sin teléfono ni fondo: se pega sobre la
// pantalla verde de la mano real con scripts/reel-bot-componer.py.
export const ReelBotPantalla = () => {
  const f = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: '#fff' }}>
      <Chat f={f} />
    </AbsoluteFill>
  );
};
