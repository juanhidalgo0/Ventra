import { createTikTokStyleCaptions, type Caption } from '@remotion/captions';
import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { verde } from '../marca';
import subs from '../../public/VID_20261004_043458556.subs.json';
import { CORRECCIONES, FPS, TOMAS, largoToma } from './guion';

// Whisper parte las palabras en pedazos ("sele", "cc", "ion"): las junto y saco marcas como [AUDIO_EN_BLANCO]
const juntarPalabras = (tokens: Caption[]) => {
  const palabras: Caption[] = [];
  for (const t of tokens) {
    if (t.text.startsWith(' ') || palabras.length === 0) palabras.push({ ...t });
    else {
      const ultima = palabras[palabras.length - 1];
      ultima.text += t.text;
      ultima.endMs = t.endMs;
    }
  }
  const limpias = palabras.filter((p) => !p.text.includes('['));
  for (let i = 0; i < limpias.length; i++) {
    const palabra = limpias[i].text.trim();
    const conSiguiente = `${palabra} ${limpias[i + 1]?.text.trim() ?? ''}`.toLowerCase().replace(/[.,]/g, '');
    if (CORRECCIONES[conSiguiente]) {
      const [a, b] = CORRECCIONES[conSiguiente].split(' ');
      limpias[i].text = ` ${a}`;
      limpias[i + 1].text = limpias[i + 1].text.replace(/[^ .,]+/, b);
      continue;
    }
    const base = palabra.replace(/[.,]/g, '').toLowerCase();
    if (CORRECCIONES[base]) limpias[i].text = limpias[i].text.replace(/[^ .,]+/, CORRECCIONES[base]);
  }
  return limpias;
};

// Pasa un tiempo de la transcripción (ms) al tiempo del reel ya cortado, o null si esa frase quedó afuera
const aTiempoReel = (ms: number) => {
  let inicio = 0;
  for (const toma of TOMAS) {
    const [td, th] = (toma.texto ?? [toma.desde, toma.hasta]).map((s) => s * 1000);
    const largo = (largoToma(toma) / FPS) * 1000;
    if (ms >= td && ms < th) return inicio + ((ms - td) / (th - td)) * largo;
    inicio += largo;
  }
  return null;
};

const recortados: Caption[] = juntarPalabras(subs as Caption[]).flatMap((c) => {
  const desde = aTiempoReel(c.startMs);
  const hasta = aTiempoReel(Math.max(c.startMs, c.endMs - 1));
  if (desde === null || hasta === null) return [];
  return [{ ...c, startMs: desde, endMs: Math.max(hasta, desde + 1), timestampMs: desde }];
});

const { pages } = createTikTokStyleCaptions({ captions: recortados, combineTokensWithinMilliseconds: 900 });

const Pagina = ({ tokens, inicioMs }: { tokens: { text: string; fromMs: number; toMs: number }[]; inicioMs: number }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ahora = inicioMs + (frame / fps) * 1000;

  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 330 }}>
      <div
        style={{
          maxWidth: 960,
          textAlign: 'center',
          fontFamily: 'Bricolage',
          fontWeight: 800,
          fontSize: 82,
          lineHeight: 1.15,
          color: 'white',
          whiteSpace: 'pre-wrap',
          WebkitTextStroke: '14px black',
          paintOrder: 'stroke',
          textShadow: '0 6px 24px rgba(0,0,0,.5)',
        }}
      >
        {tokens.map((t) => (
          <span key={t.fromMs} style={{ color: ahora >= t.fromMs && ahora < t.toMs ? verde.claro : 'white' }}>
            {t.text}
          </span>
        ))}
      </div>
    </AbsoluteFill>
  );
};

export const Subtitulos = () => (
  <>
    {pages.map((p, i) => {
      const siguiente = pages[i + 1]?.startMs ?? p.startMs + p.durationMs;
      const fin = Math.min(siguiente, p.startMs + p.durationMs + 400);
      const desde = Math.round((p.startMs / 1000) * FPS);
      const largo = Math.max(1, Math.round((fin / 1000) * FPS) - desde);
      return (
        <Sequence key={p.startMs} from={desde} durationInFrames={largo}>
          <Pagina tokens={p.tokens} inicioMs={p.startMs} />
        </Sequence>
      );
    })}
  </>
);
