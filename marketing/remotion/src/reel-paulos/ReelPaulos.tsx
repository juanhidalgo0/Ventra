import type React from 'react';
import { AbsoluteFill, Easing, Img, Sequence, continueRender, delayRender, interpolate, random, staticFile, useCurrentFrame } from 'remotion';
import { Audio, Video } from '@remotion/media';
import G from './guion.json';
import pedido from '../../public/reel-paulos/tomas/pedido.json';
import caja from '../../public/reel-paulos/tomas/caja.json';
import seguimiento from '../../public/reel-paulos/tomas/seguimiento.json';
import { ent, INTER, JAKARTA, MENTA, suave, VERDE } from '../reel-agenda-pro/piezas';

// "Un pedido real en Kiosco Paulos": la app de GO y la caja de Ventra grabadas en video
// (scripts/grabar-app.mjs, contra la copia de la tienda de Paulos en los emuladores), de noche,
// con la luz violeta del cartel del kiosco. Los tiempos salen de guion.json.

const espera = delayRender('fuentes');
Promise.all([
  new FontFace('Jakarta', `url(${staticFile('fuentes/plus-jakarta-sans-latin-wght-normal.woff2')})`, { weight: '200 800' }).load(),
  new FontFace('Jakarta', `url(${staticFile('fuentes/plus-jakarta-sans-latin-ext-wght-normal.woff2')})`, { weight: '200 800', unicodeRange: 'U+0100-024F, U+1E00-1EFF' }).load(),
  new FontFace('Inter', `url(${staticFile('inter.woff2')})`, { weight: '100 900' }).load(),
]).then((fs) => { fs.forEach((x) => document.fonts.add(x)); continueRender(espera); });

const COMPAS = G.golpe * 4;
/** Cuadro del golpe `g` del compás `c` (c puede ser fraccionario). */
export const t = (c: number, g = 0) => Math.round(G.primerGolpe * G.fps + c * COMPAS + g * G.golpe);
export const TOTAL = Math.round(G.primerGolpe * G.fps + G.compasesCuerpo * COMPAS + G.finalDura * G.fps);
const E = Object.fromEntries(Object.entries(G.escenas).map(([k, [a, b]]) => [k, [t(a), Math.min(t(b), TOTAL)]])) as Record<keyof typeof G.escenas, [number, number]>;

const VIOLETA = '#8B3DB8', NOCHE = '#0C0910';
const TOMAS = { pedido, caja, seguimiento } as const;
type Clip = { toma: keyof typeof TOMAS; desde: number; hasta: number; cuadros: number; foco: number[] };

/** Los clips de una escena con su cuadro de inicio y su velocidad. */
const armar = (escena: 'telefono' | 'caja' | 'seguimiento') => {
  let a = E[escena][0];
  return (G.clips[escena] as Clip[]).map((c) => {
    const r = { ...c, a, rate: (c.hasta - c.desde) * G.fps / c.cuadros };
    a += c.cuadros;
    return r;
  });
};
const CLIPS = { telefono: armar('telefono'), caja: armar('caja'), seguimiento: armar('seguimiento') };
type Armado = ReturnType<typeof armar>[number];

/** El clip que corre en `f` y la cámara (foco y zoom) suavizada entre clips. */
const enCurso = (f: number, lista: Armado[]) => {
  const i = Math.max(0, lista.findIndex((c) => f >= c.a && f < c.a + c.cuadros));
  const c = lista[i], prev = lista[Math.max(0, i - 1)];
  const p = i === 0 ? 1 : suave(f, c.a - 4, 14);
  const [x0, y0, z0] = prev.foco, [x1, y1, z1] = c.foco;
  return { c, cam: { x: x0 + (x1 - x0) * p, y: y0 + (y1 - y0) * p, z: z0 + (z1 - z0) * p } };
};

/** Toques de los clips de una escena, pasados a cuadros del video. */
const toquesDe = (lista: Armado[]) => lista.flatMap((c) => TOMAS[c.toma].toques
  .filter((q) => q.t >= c.desde && q.t < c.hasta && !('desliza' in q))
  .map((q) => ({ f: Math.round(c.a + (q.t - c.desde) * G.fps / c.rate), x: q.x, y: q.y })));

// ── Los videos de una escena, uno por clip (cortes secos) ────────────────────────────
const Clips = ({ lista, ancho, alto }: { lista: Armado[]; ancho: number; alto: number }) => (
  <>
    {lista.map((c, i) => (
      <Sequence key={i} from={c.a} durationInFrames={c.cuadros} layout="none">
        <Video src={staticFile(`reel-paulos/tomas/${c.toma}.mp4`)} trimBefore={Math.round(c.desde * G.fps)} playbackRate={c.rate} muted
          style={{ position: 'absolute', left: 0, top: 0, width: ancho, height: alto }} />
      </Sequence>
    ))}
  </>
);

/** Onda de un toque, en px de la pantalla grabada. */
const Ondas = ({ f, toques, r = 22 }: { f: number; toques: { f: number; x: number; y: number }[]; r?: number }) => (
  <>
    {toques.filter((q) => f >= q.f - 2 && f < q.f + 16).map((q, i) => {
      const k = (f - (q.f - 2)) / 18;
      return <div key={i} style={{ position: 'absolute', left: q.x - r, top: q.y - r, width: r * 2, height: r * 2, borderRadius: r, background: 'rgba(255,255,255,.35)', border: '2px solid rgba(20,20,24,.35)', boxShadow: '0 0 0 1px rgba(255,255,255,.5)', transform: `scale(${0.55 + k * 1.15})`, opacity: 1 - k }} />;
    })}
  </>
);

// ── Celular ───────────────────────────────────────────────────────────────────────────
const CEL_W = 640, CEL_H = Math.round(CEL_W * 844 / 390), BARRA_CEL = 46, MARCO = 18;
const ESC_CEL = CEL_W / 390;

const Celular = ({ f, lista, hora }: { f: number; lista: Armado[]; hora: string }) => {
  const { cam } = enCurso(f, lista);
  const toques = toquesDe(lista);
  // la cámara se acerca al foco sin salirse de la pantalla
  const z = cam.z;
  const tx = Math.max(CEL_W - CEL_W * z, Math.min(0, CEL_W / 2 - cam.x * ESC_CEL * z));
  const ty = Math.max(CEL_H - CEL_H * z, Math.min(0, (CEL_H / 2) - cam.y * ESC_CEL * z));
  return (
    <div style={{
      width: CEL_W + MARCO * 2, height: CEL_H + BARRA_CEL + MARCO * 2, padding: MARCO, borderRadius: 96,
      background: 'linear-gradient(145deg, #3A3540 0%, #18151C 40%, #0E0C11 100%)',
      boxShadow: '0 0 0 2px #4A4452, inset 0 0 0 2px rgba(255,255,255,.06), 0 60px 120px -30px rgba(0,0,0,.8), 0 0 120px -20px rgba(139,61,184,.45)',
    }}>
      <div style={{ position: 'relative', width: CEL_W, height: CEL_H + BARRA_CEL, borderRadius: 78, overflow: 'hidden', background: '#0B0B0B' }}>
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: BARRA_CEL, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 52px 0 58px', color: '#fff', fontFamily: INTER, fontWeight: 600, fontSize: 21, zIndex: 3 }}>
          <span>{hora}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <svg width="24" height="16" viewBox="0 0 24 16" fill="#fff"><rect x="0" y="11" width="4" height="5" rx="1" /><rect x="6" y="8" width="4" height="8" rx="1" /><rect x="12" y="4" width="4" height="12" rx="1" /><rect x="18" y="0" width="4" height="16" rx="1" /></svg>
            <span style={{ width: 34, height: 17, border: '2px solid #fff', borderRadius: 5, padding: 2 }}><span style={{ display: 'block', width: '64%', height: '100%', background: '#fff', borderRadius: 2 }} /></span>
          </span>
        </div>
        <div style={{ position: 'absolute', top: 12, left: '50%', width: 140, height: 38, marginLeft: -70, borderRadius: 20, background: '#000', zIndex: 4 }} />
        <div style={{ position: 'absolute', left: 0, top: BARRA_CEL, width: CEL_W, height: CEL_H, overflow: 'hidden' }}>
          <div style={{ position: 'absolute', left: tx, top: ty, width: CEL_W, height: CEL_H, transform: `scale(${z})`, transformOrigin: '0 0' }}>
            <Clips lista={lista} ancho={CEL_W} alto={CEL_H} />
            <div style={{ position: 'absolute', left: 0, top: 0, width: 390, height: 844, transform: `scale(${ESC_CEL})`, transformOrigin: '0 0' }}>
              <Ondas f={f} toques={toques} r={20} />
            </div>
          </div>
        </div>
        {/* reflejo muy suave del vidrio */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(115deg, rgba(255,255,255,.07) 0%, transparent 30%)', pointerEvents: 'none', zIndex: 5 }} />
      </div>
    </div>
  );
};

// ── Notebook de la caja ─────────────────────────────────────────────────────────────────
const PC_W = 980, PC_H = Math.round(PC_W * 800 / 1280), ESC_PC = PC_W / 1280;

const Notebook = ({ f }: { f: number }) => {
  const lista = CLIPS.caja;
  const { cam } = enCurso(f, lista);
  const toques = toquesDe(lista);
  const z = cam.z;
  const tx = Math.max(PC_W - PC_W * z, Math.min(0, PC_W / 2 - cam.x * ESC_PC * z));
  const ty = Math.max(PC_H - PC_H * z, Math.min(0, PC_H / 2 - cam.y * ESC_PC * z));
  return (
    <div style={{ width: PC_W + 52, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ padding: 26, paddingBottom: 30, borderRadius: '30px 30px 8px 8px', background: 'linear-gradient(#26222B, #141217)', boxShadow: '0 0 0 2px #3D3744, 0 0 140px -30px rgba(139,61,184,.5)' }}>
        <div style={{ position: 'relative', width: PC_W, height: PC_H, overflow: 'hidden', borderRadius: 6, background: '#F7F8FA' }}>
          <div style={{ position: 'absolute', left: tx, top: ty, width: PC_W, height: PC_H, transform: `scale(${z})`, transformOrigin: '0 0' }}>
            <Clips lista={lista} ancho={PC_W} alto={PC_H} />
            <div style={{ position: 'absolute', left: 0, top: 0, width: 1280, height: 800, transform: `scale(${ESC_PC})`, transformOrigin: '0 0' }}>
              <Ondas f={f} toques={toques} r={26} />
            </div>
          </div>
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(120deg, rgba(255,255,255,.06) 0%, transparent 35%)' }} />
        </div>
      </div>
      {/* base */}
      <div style={{ width: PC_W + 190, height: 30, borderRadius: '4px 4px 26px 26px', background: 'linear-gradient(#3A3540, #1A171E)', boxShadow: '0 30px 60px -20px rgba(0,0,0,.8)' }}>
        <div style={{ margin: '0 auto', width: 170, height: 10, borderRadius: '0 0 10px 10px', background: '#141217' }} />
      </div>
    </div>
  );
};

// ── Leyenda: una línea que sube desde una máscara (y una bajada chica opcional) ──────────
const Leyenda = ({ f, a, hasta, lineas, chica, top = 150 }: { f: number; a: number; hasta: number; lineas: (string | [string, string])[][]; chica?: string; top?: number }) => {
  if (f < a || f >= hasta + 10) return null;
  const sale = ent(f, hasta, 10, Easing.in(Easing.cubic));
  return (
    <div style={{ position: 'absolute', left: 70, right: 60, top, zIndex: 10 }}>
      {chica && (
        <div style={{ fontFamily: JAKARTA, fontWeight: 700, fontSize: 26, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'rgba(255,255,255,.62)', marginBottom: 14, opacity: ent(f, a, 12) * (1 - sale) }}>{chica}</div>
      )}
      {lineas.map((l, i) => {
        const p = ent(f, a + 2 + i * 4, 16);
        return (
          <div key={i} style={{ overflow: 'hidden', paddingBottom: 8, marginBottom: -8 }}>
            <div style={{ transform: `translateY(${(1 - p) * 110 - sale * 110}%)`, fontFamily: JAKARTA, fontWeight: 800, fontSize: 76, lineHeight: 1.06, letterSpacing: '-0.03em', color: '#fff', whiteSpace: 'nowrap' }}>
              {l.map((s, j) => (typeof s === 'string' ? <span key={j}>{s}</span> : <span key={j} style={{ color: s[1] }}>{s[0]}</span>))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ── Fondo de noche: la luz violeta del cartel, grano fino y viñeta ──────────────────────
const Fondo = ({ f }: { f: number }) => {
  const deriva = Math.sin(f / 70) * 40;
  return (
    <AbsoluteFill style={{ background: NOCHE }}>
      <AbsoluteFill style={{ background: `radial-gradient(70% 45% at ${50 + deriva / 20}% 62%, rgba(139,61,184,.42), transparent 70%)` }} />
      <AbsoluteFill style={{ background: 'radial-gradient(60% 30% at 50% 0%, rgba(255,214,140,.10), transparent 70%)' }} />
    </AbsoluteFill>
  );
};
const Grano = ({ f }: { f: number }) => (
  <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 50 }}>
    <svg width="1080" height="1920" style={{ opacity: 0.07, mixBlendMode: 'overlay' }}>
      <filter id="grano"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={Math.floor(random(`g${f}`) * 1000)} /></filter>
      <rect width="1080" height="1920" filter="url(#grano)" />
    </svg>
    <AbsoluteFill style={{ background: 'radial-gradient(120% 90% at 50% 50%, transparent 55%, rgba(0,0,0,.55) 100%)' }} />
  </AbsoluteFill>
);

// ── Escenas ─────────────────────────────────────────────────────────────────────────────
/** Apertura: el frente de Paulos de noche, con un acercamiento lento. */
const Frente = ({ f }: { f: number }) => {
  const [a, b] = E.intro;
  if (f >= b + 16) return null;
  const zoom = interpolate(f, [a, b + 16], [1.18, 1.32]);
  const sale = ent(f, b - 4, 18, Easing.in(Easing.cubic));
  return (
    <AbsoluteFill style={{ opacity: 1 - sale * 0.9 }}>
      <div style={{ position: 'absolute', left: 0, right: 0, top: 380, height: 1000, overflow: 'hidden' }}>
        <Img src={staticFile('reel-paulos/frente.webp')} style={{ position: 'absolute', left: '50%', top: '50%', height: 1000, width: 2000, objectFit: 'cover', transform: `translate(-50%, -50%) scale(${zoom})` }} />
        <AbsoluteFill style={{ background: `linear-gradient(${NOCHE} 0%, transparent 22%, transparent 70%, ${NOCHE} 100%)` }} />
      </div>
    </AbsoluteFill>
  );
};

const Escena = ({ f, desde, hasta, children, dy = 1400 }: { f: number; desde: number; hasta: number; children: React.ReactNode; dy?: number }) => {
  if (f < desde - 2 || f >= hasta + 16) return null;
  const entra = ent(f, desde - 2, 16);
  const sale = ent(f, hasta - 6, 16, Easing.in(Easing.cubic));
  return (
    <div style={{ position: 'absolute', inset: 0, transform: `translateY(${(1 - entra) * dy + sale * -dy}px) scale(${0.96 + 0.04 * entra})`, opacity: 1 - sale * 0.3 }}>
      {children}
    </div>
  );
};

const Cierre = ({ f }: { f: number }) => {
  const a = E.cierre[0];
  const verde = suave(f, a - 2, 16);
  const pieza = (d: number, contenido: React.ReactNode, estilo: React.CSSProperties = {}) => {
    const p = ent(f, a + d, 16);
    return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 40}px)`, ...estilo }}>{contenido}</div>;
  };
  return (
    <AbsoluteFill style={{ clipPath: `circle(${verde * 2300}px at 540px 1900px)`, background: VERDE, padding: '0 72px', justifyContent: 'center', fontFamily: JAKARTA, color: '#fff', zIndex: 20 }}>
      {pieza(2, <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <Img src={staticFile('reel-paulos/logo-paulos.webp')} style={{ width: 104, height: 104, borderRadius: 52, boxShadow: '0 0 0 3px rgba(255,255,255,.35)' }} />
        <Img src={staticFile('reel-go/go-logo.png')} style={{ width: 104, height: 104, borderRadius: 52, boxShadow: '0 0 0 3px rgba(255,255,255,.35)' }} />
        <Img src={staticFile('ventra-logo.png')} style={{ width: 104, height: 104, borderRadius: 26, boxShadow: '0 0 0 3px rgba(255,255,255,.35)' }} />
      </div>)}
      {pieza(6, <div style={{ fontSize: 100, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.03, marginTop: 56 }}>Paulos vende<br />por GO <span style={{ color: MENTA }}>con<br />su caja Ventra.</span></div>)}
      {pieza(12, <div style={{ fontSize: 34, fontWeight: 600, lineHeight: 1.42, marginTop: 40, color: 'rgba(255,255,255,.88)' }}>¿Tenés un comercio en Magdalena?<br />Tu catálogo, las fotos y los precios<br />pasan solos de la caja a GO.</div>)}
      {pieza(18, <div style={{ display: 'flex', alignItems: 'center', gap: 26, marginTop: 56 }}>
        <span style={{ background: '#fff', color: VERDE, fontSize: 40, fontWeight: 800, padding: '26px 40px', borderRadius: 999 }}>Probalo gratis</span>
        <span style={{ fontSize: 40, fontWeight: 700 }}>ventra.store</span>
      </div>)}
      {pieza(24, <div style={{ fontSize: 30, fontWeight: 600, marginTop: 34, color: 'rgba(255,255,255,.75)' }}>Ventra Full $24.900 por mes · sin contrato</div>)}
    </AbsoluteFill>
  );
};

// ── Composición ─────────────────────────────────────────────────────────────────────────
export const ReelPaulos = () => {
  const f = useCurrentFrame();
  const tilt = Math.sin(f / 55) * 2.2; // la cámara respira: un giro mínimo, nada quieto
  return (
    <AbsoluteFill style={{ background: NOCHE, fontFamily: INTER }}>
      <Audio src={staticFile('reel-paulos/audio.wav')} />
      <Fondo f={f} />
      <Frente f={f} />

      <Escena f={f} desde={E.telefono[0]} hasta={E.telefono[1]}>
        <div style={{ position: 'absolute', left: 540 - (CEL_W + MARCO * 2) / 2, top: 400, transform: `perspective(2400px) rotateY(${tilt}deg) rotateX(${2 + tilt * 0.3}deg)` }}>
          <Celular f={f} lista={CLIPS.telefono} hora="21:31" />
        </div>
      </Escena>
      <Escena f={f} desde={E.caja[0]} hasta={E.caja[1]}>
        <div style={{ position: 'absolute', left: 540 - (PC_W + 52) / 2, top: 640, transform: `perspective(2400px) rotateX(${4 + tilt * 0.4}deg) rotateY(${tilt * 0.6}deg)` }}>
          <Notebook f={f} />
        </div>
      </Escena>
      <Escena f={f} desde={E.seguimiento[0]} hasta={E.seguimiento[1]}>
        <div style={{ position: 'absolute', left: 540 - (CEL_W + MARCO * 2) / 2, top: 400, transform: `perspective(2400px) rotateY(${-tilt}deg) rotateX(${2 - tilt * 0.3}deg)` }}>
          <Celular f={f} lista={CLIPS.seguimiento} hora="21:58" />
        </div>
      </Escena>

      <Leyenda f={f} a={t(0)} hasta={t(1.5) - 6} chica="Magdalena · lunes 21:30" lineas={[['Falta el fernet.']]} top={170} />
      <Leyenda f={f} a={t(1.5)} hasta={t(2.2) - 4} chica="GO · Kiosco Paulos" lineas={[['Lo pide por GO.']]} />
      <Leyenda f={f} a={t(2.2)} hasta={t(2.75) - 4} lineas={[['GO le sugiere'], [['el hielo.', MENTA]]]} />
      <Leyenda f={f} a={t(2.75)} hasta={t(4.05) - 4} lineas={[['Y unas papas.']]} />
      <Leyenda f={f} a={t(4.1)} hasta={t(5.75) - 4} lineas={[['Paga al recibir.']]} />
      <Leyenda f={f} a={t(5.75)} hasta={t(6.5) - 6} lineas={[['Un repartidor'], [['lo compra en Paulos.', MENTA]]]} />
      <Leyenda f={f} a={t(6.5)} hasta={t(7.3) - 4} chica="Ventra · la caja de Paulos" lineas={[['Entra el pedido.']]} top={200} />
      <Leyenda f={f} a={t(7.3)} hasta={t(8.1) - 4} lineas={[['Martín '], [['lo compra acá…', MENTA]]]} top={200} />
      <Leyenda f={f} a={t(8.1)} hasta={t(10) - 6} lineas={[['…y paga como'], [['cualquier cliente.', MENTA]]]} top={200} />
      <Leyenda f={f} a={t(10)} hasta={t(11) - 4} chica="GO · seguimiento" lineas={[['Martín sale'], [['de Paulos.', MENTA]]]} />
      <Leyenda f={f} a={t(11)} hasta={t(12) - 4} lineas={[['En camino.']]} />
      <Leyenda f={f} a={t(12)} hasta={t(13) - 6} lineas={[['Entregado.']]} />

      {f >= E.cierre[0] - 2 && <Cierre f={f} />}
      <Grano f={f} />
    </AbsoluteFill>
  );
};
