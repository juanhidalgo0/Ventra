import React from 'react';
import { AbsoluteFill, Easing, Img, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { Audio, Video } from '@remotion/media';
import { inter } from '../marca';
import { lineal } from '../comunes';
import { CREMA, VERDE, VERDE_CLARO, grupos, letra, type Frase } from '../ventri/comun';
import { ChatJefe, ChatVentra } from './WhatsApp';
import guion from './guion-origen.json';
import tqCelu from '../../public/app/b20-celu.json';
import tqPrecios from '../../public/origen/app/precios-pc.json';

// Reel "Me hice mi propio sistema" (guion para grabar: marketing/origen/GUION.md).
// Nativo de Instagram: el dueño a cámara en el kiosco en el gancho y el cierre (cartel blanco arriba en el
// gancho), y en el medio la app a pantalla completa (grabada en limpio) con su voz y su cara en un círculo
// chico arriba a la derecha. Si la toma del medio es solo audio, no hay círculo. Subtítulos gruesos.
// Sin grano ni cámara simulada: la toma es real. Mientras no lleguen las tomas, un cartel provisorio.

// En el cuerpo, el punto de la pantalla que se quiere mostrar (cx, cy) cae en x 540, y FOCO: arriba de los
// subtítulos (y 1440) y del texto de Instagram de abajo. La grabación nunca deja huecos: se corre hasta el borde.
const FOCO = 820;
const SUBS_CUERPO = 1440;
const BURBUJA = { x: 772, y: 236, d: 268 }; // arriba a la derecha: debajo del encabezado de Instagram y lejos de sus botones
const esAudio = (archivo: string) => /\.(m4a|mp3|wav|aac|ogg|opus)$/i.test(archivo);

type TomaDef = { archivo: string | null; desde: number; encuadre: string; zoom?: number };
type FraseO = Frase & { oculta?: boolean };
type Bloque = { toma: TomaDef; dura: number; frases: FraseO[] };
export type PantallaDef = {
  en: number; dura: number; tipo?: 'wa-jefe' | 'wa-ventra'; src?: string; imagen?: string; toques?: 'b20-celu' | 'precios-pc';
  css?: [number, number]; desde?: number; vel?: number; k?: number; cx?: number; cy?: number; cy2?: number;
  mensajes?: number[]; pregunta?: number; responde?: number;
  /** Alto (y) del círculo de la cara en esta toma, si arriba tapa algo importante. */
  burbuja?: number;
};
export type Gancho = 'a' | 'b' | 'c';

const G = guion as unknown as {
  cartel: string;
  ganchos: Record<Gancho, Bloque>;
  cuerpo: Bloque & { pantallas: PantallaDef[] };
  cierre: Bloque & { placa: { en: number; arriba: string; grande: string; pastilla: string } };
};
const TOQUES: Record<string, { t: number; x: number; y: number }[]> = { 'b20-celu': tqCelu.toques, 'precios-pc': tqPrecios.toques };

export const duracionOrigen = (g: Gancho) => G.ganchos[g].dura + G.cuerpo.dura + G.cierre.dura;

/** La toma del dueño, recortada a la caja; sin archivo, un cartel provisorio con lo que tiene que decir. */
const Cara: React.FC<{ toma: TomaDef; top: number; alto: number; titulo: string; dice: string }> = ({ toma, top, alto, titulo, dice }) => (
  <div style={{ position: 'absolute', left: 0, right: 0, top, height: alto, overflow: 'hidden', background: '#2B2621' }}>
    {toma.archivo ? (
      <Video src={staticFile(toma.archivo)} trimBefore={Math.round(toma.desde * 30)}
        style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: toma.encuadre, display: 'block' }} />
    ) : (
      <div style={{ position: 'absolute', inset: 36, border: '4px dashed rgba(255,255,255,.28)', borderRadius: 36, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: alto > 1000 ? 'flex-start' : 'center', paddingTop: alto > 1000 ? 560 : 0, gap: 22, fontFamily: inter, textAlign: 'center' }}>
        <div style={{ fontSize: 40, fontWeight: 800, color: 'rgba(255,255,255,.7)', letterSpacing: 1 }}>{titulo}</div>
        <div style={{ fontSize: 34, fontWeight: 500, color: 'rgba(255,255,255,.5)', maxWidth: 860, lineHeight: 1.3 }}>"{dice}"</div>
      </div>
    )}
  </div>
);

/** El cartel blanco de Instagram arriba del gancho. " / " corta el renglón. */
export const Cartel: React.FC<{ texto: string }> = ({ texto }) => (
  <div style={{ position: 'absolute', top: 250, left: 0, right: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
    {texto.split(' / ').map((r, i) => (
      <div key={i} style={{ background: '#fff', color: '#000', fontFamily: inter, fontWeight: 800, fontSize: 56, lineHeight: 1.15, padding: '10px 26px',
        borderRadius: i === 0 ? '18px 18px 0 0' : '0 0 18px 18px', marginTop: i ? -1 : 0, letterSpacing: -0.5 }}>{r}</div>
    ))}
  </div>
);

/** Subtítulos de a 2 o 3 palabras (mismo estilo que la serie de Ventri), con el centro en `centro`. */
export const Subtitulos: React.FC<{ frases: FraseO[]; centro: number; hasta?: number; tam?: number }> = ({ frases, centro, hasta = Infinity, tam = 86 }) => {
  const f = useCurrentFrame();
  if (f >= hasta) return null;
  for (const fr of frases) {
    if (fr.oculta) continue;
    for (const g of grupos(fr)) {
      if (f >= g.en && f < g.hasta) {
        return (
          <div style={{ position: 'absolute', top: centro, left: 50, right: 50, textAlign: 'center', transform: 'translateY(-50%)' }}>
            {g.texto.join(' ').split(' / ').map((renglon, r) => (
              <div key={r} style={letra(tam)}>
                {renglon.split(' ').map((w, j) => (
                  <span key={j} style={{ color: fr.resaltar?.includes(w) ? VERDE_CLARO : '#fff' }}>{w} </span>
                ))}
              </div>
            ))}
          </div>
        );
      }
    }
  }
  return null;
};

/** Una porción de una grabación de la app, agrandada para que se lea en el celular, con los toques marcados. */
export const Ventana: React.FC<{ p: PantallaDef }> = ({ p }) => {
  const f = useCurrentFrame();
  const [w, h] = p.css!;
  const k = p.k!, vel = p.vel ?? 1;
  const cy = p.cy2 != null ? lineal(f, 0, p.dura, p.cy!, p.cy2, Easing.inOut(Easing.ease)) : p.cy!;
  const tClip = (p.desde ?? 0) + (f / 30) * vel;
  const toques = (p.toques ? TOQUES[p.toques] : []).filter((t) => tClip >= t.t && tClip - t.t < 0.45);
  const llena: React.CSSProperties = { width: '100%', height: '100%', display: 'block' };
  const acota = (v: number, lado: number, total: number) => (lado >= total ? Math.min(0, Math.max(total - lado, v)) : v);
  const left = acota(540 - p.cx! * k, w * k, 1080), top = acota(FOCO - cy * k, h * k, 1920);
  return (
    <AbsoluteFill style={{ overflow: 'hidden', background: '#fff' }}>
      <div style={{ position: 'absolute', left, top, width: w * k, height: h * k }}>
        {p.imagen ? <Img src={staticFile(p.imagen)} style={llena} />
          : <Video src={staticFile(p.src!)} trimBefore={Math.round(p.desde! * 30)} playbackRate={vel} muted style={llena} />}
        {toques.map((t, i) => {
          const a = (tClip - t.t) / 0.45;
          const d = 64 + a * 46;
          return <div key={i} style={{ position: 'absolute', left: t.x * k - d / 2, top: t.y * k - d / 2, width: d, height: d, borderRadius: d,
            background: `rgba(30,40,36,${0.32 * (1 - a)})`, border: `3px solid rgba(255,255,255,${0.7 * (1 - a)})` }} />;
        })}
      </div>
    </AbsoluteFill>
  );
};

const Pantalla: React.FC<{ p: PantallaDef }> = ({ p }) =>
  p.tipo === 'wa-jefe' ? <ChatJefe mensajes={p.mensajes!} />
  : p.tipo === 'wa-ventra' ? <ChatVentra pregunta={p.pregunta!} responde={p.responde!} />
  : <Ventana p={p} />;

/** La cara del dueño en un círculo chico mientras se ve la app (de la toma 2; su audio sale de acá).
 *  El video (vertical 9:16) se agranda `zoom` veces y se centra en la cara según `encuadre` ("50% 26%"). */
const Burbuja: React.FC<{ toma: TomaDef; pantallas: PantallaDef[] }> = ({ toma, pantallas }) => {
  const f = useCurrentFrame();
  const { x, d } = BURBUJA;
  // se corre junto con el corte de la pantalla que tapaba (sin animación: corte seco, como el resto)
  const y = pantallas.find((p) => f >= p.en && f < p.en + p.dura)?.burbuja ?? BURBUJA.y;
  const [fx, fy] = toma.encuadre.split(' ').map((v) => parseFloat(v) / 100);
  const W = d * (toma.zoom ?? 1.9), H = (W * 16) / 9;
  const k = lineal(f, 0, 7, 0.6, 1);
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: d, height: d, borderRadius: d, overflow: 'hidden', background: '#2B2621',
      border: '7px solid #fff', boxShadow: '0 10px 30px rgba(0,0,0,.35)', opacity: lineal(f, 0, 5, 0, 1), scale: `${k}`, transformOrigin: '100% 0' }}>
      {toma.archivo ? (
        <Video src={staticFile(toma.archivo)} trimBefore={Math.round(toma.desde * 30)}
          style={{ position: 'absolute', width: W, height: H, left: d / 2 - W * fx, top: d / 2 - H * fy, objectFit: 'cover' }} />
      ) : (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: inter, fontWeight: 800,
          fontSize: 34, color: 'rgba(255,255,255,.75)', textAlign: 'center', lineHeight: 1.15 }}>TOMA 2<br />VOS</div>
      )}
    </div>
  );
};

/** Lo último: "Comentá CAJA" y la pastilla, abajo de la cara (dentro de la zona segura de Instagram). */
export const Placa: React.FC<{ arriba: string; grande: string; pastilla: string }> = ({ arriba, grande, pastilla }) => {
  const f = useCurrentFrame();
  const entra = (d: number) => ({ opacity: lineal(f, d, d + 6, 0, 1), transform: `translateY(${lineal(f, d, d + 8, 24, 0)}px)` });
  return (
    <div style={{ position: 'absolute', top: 1170, left: 40, right: 40, textAlign: 'center' }}>
      <div style={{ ...letra(92), ...entra(0) }}>{arriba}</div>
      <div style={{ ...letra(176), color: VERDE_CLARO, ...entra(4) }}>{grande}</div>
      <div style={{ display: 'inline-block', marginTop: 26, padding: '16px 34px', borderRadius: 999, background: CREMA, border: '5px solid #000',
        fontFamily: inter, fontWeight: 800, fontSize: 46, color: VERDE, ...entra(12) }}>{pastilla}</div>
    </div>
  );
};

const dice = (b: Bloque) => b.frases.map((x) => x.texto).join(' ');

export const Origen: React.FC<{ gancho: Gancho }> = ({ gancho }) => {
  const A = G.ganchos[gancho], C = G.cuerpo, Z = G.cierre;
  const t1 = A.dura, t2 = A.dura + C.dura;
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Sequence durationInFrames={A.dura} name={`Gancho ${gancho}`}>
        <Cara toma={A.toma} top={0} alto={1920} titulo={`TOMA 1${gancho.toUpperCase()} · VOS A CÁMARA`} dice={dice(A)} />
        <Cartel texto={G.cartel} />
        <Subtitulos frases={A.frases} centro={1300} />
      </Sequence>
      <Sequence from={t1} durationInFrames={C.dura} name="Cuerpo">
        {C.pantallas.map((p, i) => (
          <Sequence key={i} from={p.en} durationInFrames={p.dura} name={p.tipo ?? `pantalla ${i + 1}`}>
            <Pantalla p={p} />
          </Sequence>
        ))}
        {C.toma.archivo && esAudio(C.toma.archivo)
          ? <Audio src={staticFile(C.toma.archivo)} trimBefore={Math.round(C.toma.desde * 30)} />
          : <Burbuja toma={C.toma} pantallas={C.pantallas} />}
        <Subtitulos frases={C.frases} centro={SUBS_CUERPO} tam={84} />
      </Sequence>
      <Sequence from={t2} durationInFrames={Z.dura} name="Cierre">
        <Cara toma={Z.toma} top={0} alto={1920} titulo="TOMA 3 · VOS A CÁMARA" dice={dice(Z)} />
        <Subtitulos frases={Z.frases} centro={1300} hasta={Z.placa.en} />
        <Sequence from={Z.placa.en}><Placa arriba={Z.placa.arriba} grande={Z.placa.grande} pastilla={Z.placa.pastilla} /></Sequence>
      </Sequence>
    </AbsoluteFill>
  );
};
