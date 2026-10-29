import { Video } from '@remotion/media';
import { AbsoluteFill, Img, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { fuentes, verde } from './marca';

export const Prueba = ({ titulo, bajada }: { titulo: string; bajada: string }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrada = spring({ frame, fps, config: { damping: 14 } });
  const bajadaOpacidad = interpolate(frame, [20, 40], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

  return (
    <>
      <AbsoluteFill style={{ background: `linear-gradient(160deg, ${verde.oscuro}, ${verde.base})`, alignItems: 'center', justifyContent: 'center', gap: 48 }}>
        <style>{fuentes}</style>
        <Img src={staticFile('ventra-logo.png')} style={{ width: 360, transform: `scale(${entrada})` }} />
        <div style={{ fontFamily: 'Bricolage', fontSize: 140, fontWeight: 700, color: 'white', transform: `translateY(${(1 - entrada) * 80}px)` }}>
          {titulo}
        </div>
        <div style={{ fontFamily: 'Inter', fontSize: 56, color: verde.claro, opacity: bajadaOpacidad }}>{bajada}</div>
      </AbsoluteFill>
      <Video
        src={staticFile('VID_20261004_043458556.mp4')}
        durationInFrames={1134.93}
        style={{ position: 'absolute', width: 1080, height: 1920 }}
        premountFor={30}
      />
    </>
  );
};
