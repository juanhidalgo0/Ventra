import React from 'react';
import { AbsoluteFill, Img, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { Video } from '@remotion/media';
import { inter } from '../marca';
import { lineal, suave } from '../comunes';

// Piezas comunes de la serie de Ventri (las usan VentriEp01 y VentriEp02, y las que vengan).
// Pasadas acá desde VentriEp01.tsx sin cambiar cómo se ve el ep. 1 (comprobado con cuadros antes/después).

export const VERDE_CLARO = '#7FE3B8';
export const VERDE = '#167160';
export const CREMA = '#F7F3EC';

export type Fuente = { video?: string; imagen?: string; desde?: number; vel?: number };
export type Escena = { id: string; desde: number; dura: number; fuente?: Fuente; zoom?: number[]; celular?: { desde: number; hasta: number; vel: number }[] };
export type Palabra = { w: string; en: number; dura: number };
export type Frase = {
  texto: string; en: number; dura: number; resaltar?: string[];
  fija?: { desde: number; renglones: string[]; nota?: string };
  cierre?: boolean; palabras?: Palabra[];
  /** Cortes a mano de los subtítulos, por sentido (ep. 2 en adelante). Cada texto es un cartel; deben sumar las palabras de la frase. */
  grupos?: string[];
};

export const cubrir: React.CSSProperties = { width: '100%', height: '100%', objectFit: 'cover', display: 'block' };

/** Una toma: video o imagen, con un empuje lento y una deriva chiquita de cámara en mano.
 *  Lo que va en children (p. ej. el texto de una tira) se mueve junto con la toma. */
export const Toma: React.FC<{ e: Escena; children?: React.ReactNode }> = ({ e, children }) => {
  const f = useCurrentFrame(); // relativo a la escena
  const [z0, z1] = e.zoom ?? [1, 1];
  const z = interpolate(f, [0, e.dura], [z0, z1], { extrapolateRight: 'clamp' });
  const s = (f + e.desde) / 30;
  const dx = Math.sin(s * 1.3) * 4 + Math.sin(s * 2.7 + 1) * 2;
  const dy = Math.sin(s * 1.1 + 2) * 3;
  const fu = e.fuente!;
  return (
    <AbsoluteFill style={{ transform: `translate(${dx}px, ${dy}px) scale(${z * 1.012})`, background: '#1d3b31' }}>
      {fu.video ? (
        <Video src={staticFile(fu.video)} trimBefore={Math.round((fu.desde ?? 0) * 30)} playbackRate={fu.vel ?? 1} muted style={cubrir} />
      ) : (
        <Img src={staticFile(fu.imagen!)} style={cubrir} />
      )}
      {children}
    </AbsoluteFill>
  );
};

// ── Subtítulos estilo Instagram: blancos, muy gruesos, contorno negro, de a 2 o 3 palabras ──────────────
export const letra = (tam: number): React.CSSProperties => ({
  fontFamily: inter, fontWeight: 900, fontSize: tam, lineHeight: 1.08, color: '#fff', letterSpacing: -1,
  WebkitTextStroke: `${Math.round(tam * 0.17)}px #000`, paintOrder: 'stroke fill', textShadow: '0 6px 0 rgba(0,0,0,.35)',
});

export function grupos(fr: Frase): { texto: string[]; en: number; hasta: number }[] {
  const palabras: Palabra[] = fr.palabras ?? (() => {
    const ws = fr.texto.split(/\s+/);
    const paso = fr.dura / ws.length;
    return ws.map((w, i) => ({ w, en: fr.en + i * paso, dura: paso }));
  })();
  const out: { texto: string[]; en: number; hasta: number }[] = [];
  if (fr.grupos) {
    let k = 0;
    for (const g of fr.grupos) {
      // " / " dentro de un cartel es un cambio de renglón a mano
      const toks = g.split(/\s+/);
      const n = toks.filter((w) => w !== '/').length;
      const ps = palabras.slice(k, k + n);
      let j = 0;
      if (ps.length) out.push({ texto: toks.map((w) => (w === '/' ? '/' : ps[j++]?.w ?? w)), en: ps[0].en, hasta: 0 });
      k += n;
    }
    out.forEach((g, i) => (g.hasta = i < out.length - 1 ? out[i + 1].en : fr.en + fr.dura + 6));
    return out;
  }
  let cur: Palabra[] = [];
  palabras.forEach((p, i) => {
    cur.push(p);
    // de a 3 palabras, cortando en la puntuación; una 4.ª entra si cierra la frase ("y la leo yo:")
    const sig = palabras[i + 1];
    const llena = cur.length >= 4 || (cur.length === 3 && !(sig && /[.,:;?!…]$/.test(sig.w)));
    const corte = /[.,:;?!…]$/.test(p.w) || llena || i === palabras.length - 1;
    if (corte) {
      out.push({ texto: cur.map((x) => x.w), en: cur[0].en, hasta: 0 });
      cur = [];
    }
  });
  out.forEach((g, i) => (g.hasta = i < out.length - 1 ? out[i + 1].en : fr.en + fr.dura + 6));
  return out;
}

export const Subtitulos: React.FC<{ frases: Frase[] }> = ({ frases }) => {
  const f = useCurrentFrame();
  for (const fr of frases) {
    if (fr.cierre) continue;
    if (fr.fija && f >= fr.fija.desde && f < fr.en + fr.dura) {
      return (
        <div style={{ position: 'absolute', top: 250, left: 40, right: 40, textAlign: 'center' }}>
          {fr.fija.renglones.map((r, i) => (
            <div key={i} style={letra(96)}>
              {r.split(' ').map((w, j) => (
                <span key={j} style={{ color: fr.resaltar?.some((x) => w.endsWith(x.replace(/[?.:…,]$/, '')) || w === x) ? VERDE_CLARO : '#fff' }}>{w} </span>
              ))}
            </div>
          ))}
          {fr.fija.nota ? <div style={{ ...letra(46), marginTop: 14, letterSpacing: 0 }}>{fr.fija.nota}</div> : null}
        </div>
      );
    }
    if (fr.fija) continue;
    for (const g of grupos(fr)) {
      if (f >= g.en && f < g.hasta) {
        return (
          <div style={{ position: 'absolute', top: 300, left: 50, right: 50, textAlign: 'center' }}>
            {g.texto.join(' ').split(' / ').map((renglon, r) => (
              <div key={r} style={letra(104)}>
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

/** Placa final de la serie: una línea arriba (opcional), la palabra grande en verde claro, una línea abajo
 *  y la pastilla crema con la web. Ep. 1: "Comentá / BOLETA / y te escribo yo"; ep. 2: "Guardalo". */
export const Placa: React.FC<{ arriba?: string; grande: string; abajo: string; pastilla: string; tamGrande?: number }> = ({ arriba, grande, abajo, pastilla, tamGrande = 168 }) => {
  const f = useCurrentFrame(); // relativo a la placa
  const entra = (d: number) => ({ opacity: lineal(f, d, d + 6, 0, 1), transform: `translateY(${lineal(f, d, d + 8, 24, 0, suave)}px)` });
  return (
    <div style={{ position: 'absolute', top: 210, left: 40, right: 40, textAlign: 'center' }}>
      {arriba ? <div style={{ ...letra(92), ...entra(0) }}>{arriba}</div> : null}
      <div style={{ ...letra(tamGrande), color: VERDE_CLARO, ...entra(4) }}>{grande}</div>
      <div style={{ ...letra(74), whiteSpace: 'pre-line', ...entra(12) }}>{abajo}</div>
      <div style={{ display: 'inline-block', marginTop: 34, padding: '16px 34px', borderRadius: 999, background: CREMA, border: '5px solid #000',
        fontFamily: inter, fontWeight: 800, fontSize: 46, color: VERDE, ...entra(26) }}>
        {pastilla}
      </div>
    </div>
  );
};
