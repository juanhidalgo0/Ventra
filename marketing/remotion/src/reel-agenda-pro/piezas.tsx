import type React from 'react';
import { Easing, Img, interpolate, staticFile } from 'remotion';

export const VERDE = '#136B57', OSCURO = '#0B4A3C', MENTA = '#7FE3B8', CREMA = '#F7F3EC', TINTA = '#13241E';
export const JAKARTA = "'Jakarta', sans-serif";
export const INTER = "'Inter', sans-serif";

const sale = Easing.bezier(0.16, 1, 0.3, 1); // ease-out "quint": entra rápido y se asienta suave
const entraYsale = Easing.bezier(0.65, 0, 0.35, 1);
/** 0 → 1 entre `a` y `a + d`. */
export const ent = (f: number, a: number, d = 14, curva = sale) =>
  interpolate(f, [a, a + d], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: curva });
export const suave = (f: number, a: number, d = 14) => ent(f, a, d, entraYsale);

// ── Titular: cada línea sube desde abajo de una máscara, y se va hacia arriba ───────────
export type Linea = (string | [string, string])[];
export const Titular = ({ f, a, hasta, lineas, color, tam = 92, top = 168 }: {
  f: number; a: number; hasta?: number; lineas: Linea[]; color: string; tam?: number; top?: number;
}) => {
  if (f < a || (hasta != null && f >= hasta + 10)) return null;
  return (
    <div style={{ position: 'absolute', left: 72, right: 60, top }}>
      {lineas.map((l, i) => {
        const p = ent(f, a + i * 4, 16);
        const s = hasta != null ? ent(f, hasta, 10, Easing.in(Easing.cubic)) : 0;
        return (
          <div key={i} style={{ overflow: 'hidden', paddingBottom: tam * 0.08, marginBottom: -tam * 0.08 }}>
            <div style={{
              transform: `translateY(${(1 - p) * 110 - s * 110}%)`, fontFamily: JAKARTA, fontWeight: 800, fontSize: tam,
              lineHeight: 1.04, letterSpacing: '-0.035em', color, whiteSpace: 'nowrap',
            }}>
              {l.map((seg, j) => (typeof seg === 'string' ? <span key={j}>{seg}</span> : <span key={j} style={{ color: seg[1] }}>{seg[0]}</span>))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ── Celular ────────────────────────────────────────────────────────────────────────────
export const PANT_W = 600, PANT_H = 1298, BISEL = 20;
export const ESC = PANT_W / 390; // de px de la app (390 de ancho) a px de la pantalla
export const BARRA = 50; // barra de estado del teléfono

export const Telefono = ({ x, y, escala = 1, rot = 0, children, sombra = true }: {
  x: number; y: number; escala?: number; rot?: number; children: React.ReactNode; sombra?: boolean;
}) => (
  <div style={{
    position: 'absolute', left: x - (PANT_W + BISEL * 2) / 2, top: y, width: PANT_W + BISEL * 2, height: PANT_H + BISEL * 2,
    borderRadius: 92, background: '#101214', padding: BISEL, transformOrigin: '50% 0%',
    transform: `scale(${escala}) rotate(${rot}deg)`,
    boxShadow: sombra ? '0 0 0 2px #2B2F33, 0 50px 90px -30px rgba(11,40,30,.55), 0 30px 60px -40px rgba(0,0,0,.5)' : undefined,
  }}>
    <div style={{ position: 'relative', width: PANT_W, height: PANT_H, borderRadius: 72, overflow: 'hidden', background: '#fff' }}>
      {children}
      <div style={{ position: 'absolute', top: 14, left: '50%', width: 150, height: 40, marginLeft: -75, borderRadius: 22, background: '#000' }} />
    </div>
  </div>
);

/** Barra de estado del teléfono (hora, señal y batería). */
export const BarraEstado = ({ fondo, claro = true, hora = '9:31' }: { fondo: string; claro?: boolean; hora?: string }) => {
  const c = claro ? '#fff' : '#111';
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: BARRA, background: fondo, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 46px 0 52px', color: c, fontFamily: INTER, fontWeight: 600, fontSize: 21, zIndex: 3 }}>
      <span>{hora}</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <svg width="24" height="16" viewBox="0 0 24 16" fill={c}><rect x="0" y="11" width="4" height="5" rx="1" /><rect x="6" y="8" width="4" height="8" rx="1" /><rect x="12" y="4" width="4" height="12" rx="1" /><rect x="18" y="0" width="4" height="16" rx="1" /></svg>
        <span style={{ width: 34, height: 17, border: `2px solid ${c}`, borderRadius: 5, padding: 2, opacity: 0.95 }}><span style={{ display: 'block', width: '78%', height: '100%', background: c, borderRadius: 2 }} /></span>
      </span>
    </div>
  );
};

/** Captura real de la app dentro de la pantalla, debajo de la barra de estado. */
export const Captura = ({ src, opacidad = 1 }: { src: string; opacidad?: number }) => (
  <div style={{ position: 'absolute', inset: 0, opacity: opacidad }}>
    <BarraEstado fondo="#0E6E52" />
    <Img src={staticFile(src)} style={{ position: 'absolute', left: 0, top: BARRA, width: PANT_W, height: PANT_W * (2532 / 1170) }} />
  </div>
);

/** Resalta una zona de la captura (coordenadas en px de la app de 390). */
export const Resalte = ({ f, a, r, pad = 6, color = VERDE }: { f: number; a: number; r: { x: number; y: number; w: number; h: number }; pad?: number; color?: string }) => {
  if (f < a) return null;
  const p = ent(f, a, 12);
  const pulso = 1 + 0.06 * Math.max(0, 1 - (f - a) / 10);
  return (
    <div style={{
      position: 'absolute', left: (r.x - pad) * ESC, top: (r.y - pad) * ESC + BARRA, width: (r.w + pad * 2) * ESC, height: (r.h + pad * 2) * ESC,
      borderRadius: 14 * ESC * 0.6, border: `${4}px solid ${color}`, background: 'rgba(127,227,184,.18)',
      opacity: p, transform: `scale(${(0.9 + p * 0.1) * pulso})`, boxShadow: '0 8px 24px -8px rgba(19,107,87,.5)',
    }} />
  );
};

// ── WhatsApp (el celular de la clienta), dibujado en px de 390 y escalado a la pantalla ──
const WA = { fondo: '#EFEAE2', burbuja: '#FFFFFF', enviado: '#D9FDD3', verde: '#008069', azul: '#53BDEB', gris: '#667781' };

const Tilde = ({ azul }: { azul: boolean }) => (
  <svg width="17" height="11" viewBox="0 0 17 11" fill="none" stroke={azul ? WA.azul : WA.gris} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 6l3 3 6-7.5M7 8.5l1 .8 6.5-8" />
  </svg>
);

export const ChatWhatsApp = ({ f, escribe, llega, botones, toque, enviado, leido, mensaje }: {
  f: number; escribe: number; llega: number; botones: number; toque: number; enviado: number; leido: number; mensaje: string;
}) => {
  const pLlega = ent(f, llega, 12);
  const pEnv = ent(f, enviado, 10);
  const tocado = f >= toque;
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <BarraEstado fondo="#FFFFFF" claro={false} hora="20:00" />
      <div style={{ position: 'absolute', left: 0, top: BARRA, width: 390, height: (PANT_H - BARRA) / ESC, transform: `scale(${ESC})`, transformOrigin: '0 0', background: WA.fondo, fontFamily: INTER }}>
        {/* cabecera */}
        <div style={{ height: 60, background: '#fff', display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', borderBottom: '1px solid #E9EDEF' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="2.2" strokeLinecap="round"><path d="M15 5l-7 7 7 7" /></svg>
          <Img src={staticFile('reel-agenda-pro/perfil-whatsapp.jpg')} style={{ width: 38, height: 38, borderRadius: 19 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16.5, fontWeight: 600, color: '#111' }}>Ventra</div>
            <div style={{ fontSize: 12.5, color: WA.gris }}>Cuenta de empresa</div>
          </div>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="2.5" y="6" width="13" height="12" rx="2.5" /><path d="M15.5 10.5 21 7.5v9l-5.5-3" /></svg>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 14 }}><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" /></svg>
        </div>
        {/* fecha */}
        <div style={{ textAlign: 'center', marginTop: 14 }}>
          <span style={{ background: '#fff', borderRadius: 8, padding: '5px 12px', fontSize: 12.5, color: WA.gris, boxShadow: '0 1px 0.5px rgba(11,20,26,.13)' }}>HOY</span>
        </div>
        {/* escribiendo… */}
        {f >= escribe && f < llega && (
          <div style={{ position: 'absolute', left: 12, top: 108, background: '#fff', borderRadius: 10, padding: '12px 16px', display: 'flex', gap: 5, boxShadow: '0 1px 0.5px rgba(11,20,26,.13)' }}>
            {[0, 1, 2].map((i) => <span key={i} style={{ width: 8, height: 8, borderRadius: 4, background: '#9AA5AC', opacity: 0.35 + 0.65 * Math.abs(Math.sin((f - escribe) / 4 + i)) }} />)}
          </div>
        )}
        {/* recordatorio con sus dos botones */}
        {f >= llega && (
          <div style={{ position: 'absolute', left: 12, top: 104, width: 300, opacity: pLlega, transform: `translateY(${(1 - pLlega) * 18}px) scale(${0.96 + 0.04 * pLlega})`, transformOrigin: '0 0' }}>
            <div style={{ background: WA.burbuja, borderRadius: '0 10px 10px 10px', padding: '8px 10px 6px', boxShadow: '0 1px 0.5px rgba(11,20,26,.13)', position: 'relative' }}>
              <svg width="10" height="13" viewBox="0 0 10 13" style={{ position: 'absolute', left: -8, top: 0 }}><path d="M10 0H2a2 2 0 0 0-1.5 3.3L10 13Z" fill="#fff" /></svg>
              <div style={{ fontSize: 15.5, lineHeight: 1.36, color: '#111B21' }}>{mensaje}</div>
              <div style={{ textAlign: 'right', fontSize: 11.5, color: WA.gris, marginTop: 2 }}>20:00</div>
            </div>
            {['Confirmo', 'Necesito cambiarlo'].map((txt, i) => {
              const p = ent(f, botones + i * 3, 10);
              const presion = i === 0 && f >= toque && f < toque + 8;
              return (
                <div key={txt} style={{
                  marginTop: 4, height: 42, borderRadius: 10, background: presion ? '#E4F2EC' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                  color: tocado && i === 0 ? '#7A8A84' : '#027EB5', fontSize: 15.5, fontWeight: 500, boxShadow: '0 1px 0.5px rgba(11,20,26,.13)',
                  opacity: p, transform: `translateY(${(1 - p) * 10}px)`,
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 14 4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 6 6v4" /></svg>
                  {txt}
                </div>
              );
            })}
          </div>
        )}
        {/* toque del dedo sobre "Confirmo" */}
        {f >= toque - 4 && f < toque + 14 && (() => {
          const k = (f - (toque - 4)) / 18;
          return <div style={{ position: 'absolute', left: 162 - 22, top: 222 - 22, width: 44, height: 44, borderRadius: 22, background: 'rgba(17,27,33,.18)', border: '2px solid rgba(17,27,33,.25)', transform: `scale(${0.6 + k * 1.1})`, opacity: 1 - k }} />;
        })()}
        {/* respuesta enviada */}
        {f >= enviado && (
          <div style={{ position: 'absolute', right: 12, top: 308, opacity: pEnv, transform: `translateY(${(1 - pEnv) * 18}px)` }}>
            <div style={{ background: WA.enviado, borderRadius: '10px 0 10px 10px', padding: '7px 10px 6px', boxShadow: '0 1px 0.5px rgba(11,20,26,.13)', display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <span style={{ fontSize: 15.5, color: '#111B21' }}>Confirmo</span>
              <span style={{ fontSize: 11.5, color: WA.gris, display: 'flex', alignItems: 'center', gap: 3 }}>20:03 <Tilde azul={f >= leido} /></span>
            </div>
          </div>
        )}
        {/* barra para escribir */}
        <div style={{ position: 'absolute', left: 8, right: 8, bottom: 40, display: 'flex', gap: 6, alignItems: 'center' }}>
          <div style={{ flex: 1, height: 46, borderRadius: 23, background: '#fff', display: 'flex', alignItems: 'center', padding: '0 16px', color: '#8696A0', fontSize: 16 }}>Mensaje</div>
          <div style={{ width: 46, height: 46, borderRadius: 23, background: '#00A884', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12Z" /></svg>
          </div>
        </div>
      </div>
    </div>
  );
};

/** Aviso del celular de la dueña (el que manda Ventra cuando la clienta confirma). */
export const Notificacion = ({ f, a, hasta, titulo, cuerpo }: { f: number; a: number; hasta: number; titulo: string; cuerpo: string }) => {
  if (f < a || f >= hasta + 12) return null;
  const p = ent(f, a, 16) - ent(f, hasta, 12);
  return (
    <div style={{
      position: 'absolute', left: 18, right: 18, top: BARRA + 8, zIndex: 5, transform: `translateY(${(1 - p) * -220}px)`,
      background: 'rgba(250,250,250,.97)', borderRadius: 34, padding: '20px 24px', boxShadow: '0 18px 40px -12px rgba(0,0,0,.35)',
      display: 'flex', gap: 18, fontFamily: INTER,
    }}>
      <Img src={staticFile('ventra-logo.png')} style={{ width: 62, height: 62, borderRadius: 15, flex: 'none' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 19, color: '#6B7280', fontWeight: 500 }}><span>VENTRA</span><span>ahora</span></div>
        <div style={{ fontSize: 22, fontWeight: 700, color: '#111', marginTop: 4, lineHeight: 1.25 }}>{titulo}</div>
        <div style={{ fontSize: 21, color: '#333', marginTop: 3, lineHeight: 1.3 }}>{cuerpo}</div>
      </div>
    </div>
  );
};
