import React from 'react';
import { AbsoluteFill, Easing, interpolate, random, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { Video } from '@remotion/media';
import { c, inter } from './marca';

// La curva de la web (--ease: cubic-bezier(.16,1,.3,1)): arranca rápido y frena suave, sin rebote.
export const suave = Easing.bezier(0.16, 1, 0.3, 1);
export const lineal = (f: number, a: number, b: number, de: number, a2: number, easing = suave) =>
  interpolate(f, [a, b], [de, a2], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing });

/** Fondo claro de la web con grano fino animado (una semilla por cuadro) y viñeta suave. */
export const Fondo: React.FC<{ color?: string; oscuro?: boolean }> = ({ color = c.fondo, oscuro = false }) => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: color }}>
      <svg width="1080" height="1920" style={{ position: 'absolute', inset: 0, opacity: oscuro ? 0.1 : 0.07, mixBlendMode: oscuro ? 'screen' : 'multiply' }}>
        <filter id={`grano-${frame}`}>
          <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={frame % 24} stitchTiles="stitch" />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="1080" height="1920" filter={`url(#grano-${frame})`} />
      </svg>
      <AbsoluteFill style={{ background: oscuro ? 'radial-gradient(ellipse at 50% 45%, transparent 40%, rgba(0,0,0,.35) 100%)' : 'radial-gradient(ellipse at 50% 45%, transparent 55%, rgba(14,27,22,.08) 100%)' }} />
    </AbsoluteFill>
  );
};

/** Cámara en mano: deriva lenta (suma de senos, ±6 px y ±0,4°) más el encuadre de cada momento. */
export type Toma = { f: number; x: number; y: number; z: number };
export const Camara: React.FC<{ tomas: Toma[]; children: React.ReactNode; semilla?: number }> = ({ tomas, children, semilla = 1 }) => {
  const frame = useCurrentFrame();
  // Entre dos tomas, la cámara viaja con la curva de la web
  let x = tomas[0].x, y = tomas[0].y, z = tomas[0].z;
  for (let i = 1; i < tomas.length; i++) {
    const a = tomas[i - 1], b = tomas[i];
    if (frame >= a.f) {
      const t = interpolate(frame, [a.f, b.f], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.bezier(0.45, 0, 0.2, 1) });
      x = a.x + (b.x - a.x) * t; y = a.y + (b.y - a.y) * t; z = a.z + (b.z - a.z) * t;
    }
  }
  const s = frame / 30 + semilla * 10;
  const dx = Math.sin(s * 1.3) * 3.5 + Math.sin(s * 2.9 + 1) * 2;
  const dy = Math.sin(s * 1.1 + 2) * 3 + Math.sin(s * 2.3) * 2;
  const rot = Math.sin(s * 0.9 + 0.5) * 0.25 + Math.sin(s * 1.7) * 0.15;
  // (x, y) es el punto del mundo que queda en el centro de la zona de abajo (540, 1130)
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: 1080, height: 1920, transformOrigin: '0 0',
        transform: `translate(${540 + dx}px, ${1130 + dy}px) rotate(${rot}deg) scale(${z}) translate(${-x}px, ${-y}px)` }}>
        {children}
      </div>
    </AbsoluteFill>
  );
};

/** Las dos versiones del video: 10 s (300 cuadros) y 15 s (450 cuadros, cada función dura 3 s). */
export type Largo = 10 | 15;
export type TramoDatos = { desde: number; vel?: number; en: number; dura: number };

/** Un tramo de una grabación de la app: desde el segundo `desde` del clip, a `vel` veces la velocidad. */
export const Tramo: React.FC<{ archivo: string; desde: number; vel?: number; en: number; dura: number }> = ({ archivo, desde, vel = 1, en, dura }) => (
  <Sequence from={en} durationInFrames={dura} layout="none">
    <Video src={staticFile(`app/${archivo}.mp4`)} trimBefore={Math.round(desde * 30)} playbackRate={vel} muted
      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
  </Sequence>
);

/** Celular: marco oscuro con isla, la pantalla mide 390×844 de la app escalada al ancho `ancho`. */
export const Telefono: React.FC<{ x: number; y: number; ancho: number; alto?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ x, y, ancho, alto, children, style }) => {
  const s = ancho / 390;
  const borde = 15;
  const h = alto ?? 844 * s;
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: ancho + borde * 2, height: h + borde * 2, borderRadius: 64, background: '#101816',
      boxShadow: '0 50px 90px -30px rgba(8,54,42,.55), 0 10px 24px rgba(8,54,42,.18), inset 0 0 0 2px #2A3532', padding: borde, boxSizing: 'border-box', ...style }}>
      <div style={{ width: ancho, height: h, borderRadius: 50, overflow: 'hidden', position: 'relative', background: '#fff' }}>
        {children}
        <div style={{ position: 'absolute', top: 12, left: '50%', translate: '-50% 0', width: 118, height: 34, borderRadius: 20, background: '#0B0F0E' }} />
      </div>
    </div>
  );
};

/** Monitor de la PC del local: la pantalla mide 1280×800 de la app escalada al ancho `ancho`. */
export const Monitor: React.FC<{ x: number; y: number; ancho: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ x, y, ancho, children, style }) => {
  const alto = (ancho * 800) / 1280;
  const borde = 16;
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: ancho + borde * 2, ...style }}>
      <div style={{ width: ancho + borde * 2, height: alto + borde * 2 + 10, borderRadius: 22, background: '#141B19', padding: `${borde}px ${borde}px ${borde + 10}px`, boxSizing: 'border-box',
        boxShadow: '0 60px 100px -40px rgba(8,54,42,.55), 0 10px 26px rgba(8,54,42,.16), inset 0 0 0 2px #26302D' }}>
        <div style={{ width: ancho, height: alto, borderRadius: 6, overflow: 'hidden', position: 'relative', background: '#fff' }}>{children}</div>
      </div>
      {/* pie */}
      <div style={{ width: 120, height: 70, margin: '0 auto', background: 'linear-gradient(#1C2422, #121816)' }} />
      <div style={{ width: 330, height: 16, margin: '0 auto', borderRadius: 10, background: '#141B19' }} />
    </div>
  );
};

/** Titular fijo de cada placa: etiqueta chica en verde + líneas que suben desde una máscara. */
export const Titular: React.FC<{ etiqueta: string; lineas: { t: string; verde?: boolean }[]; tam?: number; claro?: boolean; desde?: number }> = ({ etiqueta, lineas, tam = 96, claro = false, desde = 0 }) => {
  const frame = useCurrentFrame() - desde;
  return (
    <div style={{ position: 'absolute', left: 80, top: 262, right: 60, fontFamily: inter }}>
      <div style={{ overflow: 'hidden', height: 44 }}>
        <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: claro ? c.menta300 : c.verde,
          translate: `0 ${lineal(frame, 0, 8, 46, 0)}px` }}>{etiqueta}</div>
      </div>
      {lineas.map((l, i) => (
        <div key={i} style={{ overflow: 'hidden', height: tam * 1.08, marginTop: i === 0 ? 10 : 0 }}>
          <div style={{ fontSize: tam, fontWeight: 800, letterSpacing: '-0.045em', lineHeight: 1.06, whiteSpace: 'nowrap',
            color: l.verde ? (claro ? c.menta300 : c.verde) : claro ? c.crema : c.tinta,
            translate: `0 ${lineal(frame, 2 + i * 3, 12 + i * 3, tam * 1.1, 0)}px` }}>{l.t}</div>
        </div>
      ))}
    </div>
  );
};

/** Pulso que viaja de un aparato al otro (la información pasa del celular a la PC). */
export const Pulso: React.FC<{ de: [number, number]; a: [number, number]; desde: number; dura?: number; curva?: number }> = ({ de, a, desde, dura = 10, curva = -160 }) => {
  const frame = useCurrentFrame();
  const t = lineal(frame, desde, desde + dura, 0, 1, Easing.bezier(0.5, 0, 0.3, 1));
  if (frame < desde - 1 || frame > desde + dura + 8) return null;
  const mx = (de[0] + a[0]) / 2, my = (de[1] + a[1]) / 2 + curva;
  const d = `M ${de[0]} ${de[1]} Q ${mx} ${my} ${a[0]} ${a[1]}`;
  const p = (u: number) => [(1 - u) * (1 - u) * de[0] + 2 * (1 - u) * u * mx + u * u * a[0], (1 - u) * (1 - u) * de[1] + 2 * (1 - u) * u * my + u * u * a[1]];
  const [px, py] = p(t);
  const fuera = lineal(frame, desde + dura, desde + dura + 8, 1, 0);
  return (
    <svg width="2400" height="2400" style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', opacity: fuera }}>
      <path d={d} fill="none" stroke={c.menta} strokeWidth={6} strokeDasharray="2 16" strokeLinecap="round" pathLength={1000}
        style={{ strokeDashoffset: -frame * 6 }} opacity={0.7} />
      <circle cx={px} cy={py} r={18} fill={c.menta} />
      <circle cx={px} cy={py} r={34} fill={c.menta} opacity={0.25} />
    </svg>
  );
};

/** Entrada de un aparato: sube 70 px y aparece en 9 cuadros. */
export const entra = (frame: number, desde: number) => ({
  opacity: lineal(frame, desde, desde + 6, 0, 1),
  translate: `0 ${lineal(frame, desde, desde + 10, 70, 0)}px`,
});

export const ruido = (semilla: string) => random(semilla);
