import { AbsoluteFill, Img, OffthreadVideo, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import { fuentes, verde } from '../marca';
import { Subtitulos } from './Subtitulos';
import { CIERRE, FPS, TOMAS, duracionTomas, largoToma, type Toma } from './guion';

// Una toma del video original, con zoom suave hacia la zona que importa
const TomaVideo = ({ toma }: { toma: Toma }) => {
  const frame = useCurrentFrame();
  const largo = largoToma(toma);
  const zoom = toma.zoom ?? { desde: 1, hasta: 1, x: 50, y: 50 };
  const escala = interpolate(frame, [0, largo], [zoom.desde, zoom.hasta], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: 'black' }}>
      <OffthreadVideo
        src={staticFile('recargo.mp4')}
        startFrom={Math.round(toma.desde * FPS)}
        endAt={Math.round(toma.hasta * FPS)}
        playbackRate={toma.velocidad ?? 1}
        // Fundido corto en cada corte para que no se escuche el salto
        volume={(f) => interpolate(f, [0, 3, largo - 3, largo], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' })}
        style={{ width: '100%', height: '100%', objectFit: 'cover', transform: `scale(${escala})`, transformOrigin: `${zoom.x}% ${zoom.y}%` }}
      />
    </AbsoluteFill>
  );
};

// Cartel grande arriba (gancho y remates)
const Cartel = ({ texto, resaltado, compacto }: { texto: string; resaltado?: string; compacto?: boolean }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrada = spring({ frame, fps, config: { damping: 13 } });

  return (
    <AbsoluteFill style={{ alignItems: 'center', paddingTop: compacto ? 70 : 210 }}>
      <div
        style={{
          maxWidth: 940,
          padding: compacto ? '22px 40px' : '34px 46px',
          borderRadius: 36,
          background: 'white',
          boxShadow: '0 24px 60px rgba(0,0,0,.35)',
          fontFamily: 'Bricolage',
          fontWeight: 800,
          fontSize: compacto ? 60 : 76,
          lineHeight: 1.08,
          textAlign: 'center',
          color: verde.oscuro,
          transform: `translateY(${(1 - entrada) * -120}px) scale(${0.85 + entrada * 0.15})`,
          opacity: entrada,
        }}
      >
        {texto}
        {resaltado ? <div style={{ color: verde.base, marginTop: 10 }}>{resaltado}</div> : null}
      </div>
    </AbsoluteFill>
  );
};

const Cierre = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const entrada = spring({ frame, fps, config: { damping: 14 } });

  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg, ${verde.oscuro}, ${verde.base})`, alignItems: 'center', justifyContent: 'center', gap: 44 }}>
      <Img src={staticFile('ventra-logo.png')} style={{ width: 300, transform: `scale(${entrada})` }} />
      <div style={{ fontFamily: 'Bricolage', fontWeight: 800, fontSize: 92, color: 'white', textAlign: 'center', lineHeight: 1.05, opacity: entrada }}>
        {CIERRE.titulo}
      </div>
      <div style={{ fontFamily: 'Inter', fontSize: 52, color: verde.claro, opacity: entrada }}>{CIERRE.bajada}</div>
    </AbsoluteFill>
  );
};

export const ReelRecargo = () => {
  let desde = 0;
  const tomas = TOMAS.map((toma) => {
    const largo = largoToma(toma);
    const bloque = { toma, desde, largo };
    desde += largo;
    return bloque;
  });

  return (
    <AbsoluteFill style={{ background: 'black' }}>
      <style>{fuentes}</style>
      {tomas.map(({ toma, desde, largo }) => (
        <Sequence key={toma.desde} from={desde} durationInFrames={largo}>
          <TomaVideo toma={toma} />
          {toma.cartel ? (
            <Sequence from={Math.round((toma.cartel.en ?? 0) * FPS)} durationInFrames={Math.round((toma.cartel.dura ?? 2.5) * FPS)}>
              <Cartel texto={toma.cartel.texto} resaltado={toma.cartel.resaltado} compacto={toma.cartel.compacto} />
            </Sequence>
          ) : null}
        </Sequence>
      ))}
      <Subtitulos />
      <Sequence from={duracionTomas()} durationInFrames={Math.round(CIERRE.dura * FPS)}>
        <Cierre />
      </Sequence>
    </AbsoluteFill>
  );
};
