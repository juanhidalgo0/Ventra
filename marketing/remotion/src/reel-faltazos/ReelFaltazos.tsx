import type React from 'react';
import { AbsoluteFill, Img, continueRender, delayRender, staticFile, useCurrentFrame } from 'remotion';
import { Audio } from '@remotion/media';
import { AMano, BOTON, CADA, Cinta, DYMO, Dymo, FIBRA, FUENTES_CSS, Mano, Papel, Recortes, Sello, Trazo, azar, circulo, salto, tiembla, zigzag } from './papel';
import guion from './guion.json';

// "Chau faltazos": stop-motion de papel sobre una plancha de corte. Ver .claude/skills/ventra-video.
// Fuentes del sistema (Windows/Office) a propósito: nada de Bricolage/Inter en este reel.

// Que las fuentes del sistema estén cargadas antes del primer cuadro
const espera = delayRender('fuentes del sistema');
const estilo = document.createElement('style');
estilo.textContent = FUENTES_CSS;
document.head.appendChild(estilo);
Promise.all(['VDymo', 'VBoton', 'VSello', 'Ink Free', 'Segoe Print', 'Lucida Sans Typewriter', 'Cooper Black', 'Stencil', 'Playbill']
  .map((fam) => document.fonts.load(`700 40px '${fam}'`).catch(() => null)))
  .then(() => continueRender(espera));

const E = guion.escenas;
const G = guion;
const TINTA = '#22388C'; // birome azul
const ROJO = '#C9252C';
const MANO_BLANCA = "'Segoe Print'";
const entre = (f: number, [a, b]: number[]) => f >= a && f < b;

// ── Plancha de corte verde (la mesa) ─────────────────────────────────────────
const Plancha = ({ f }: { f: number }) => {
  const k = Math.floor(f / CADA);
  return (
    <AbsoluteFill style={{ background: '#1A5C4A', overflow: 'hidden' }}>
      <AbsoluteFill style={{
        backgroundImage: [
          'linear-gradient(rgba(255,255,255,.2) 2px, transparent 2px)', 'linear-gradient(90deg, rgba(255,255,255,.2) 2px, transparent 2px)',
          'linear-gradient(rgba(255,255,255,.09) 1px, transparent 1px)', 'linear-gradient(90deg, rgba(255,255,255,.09) 1px, transparent 1px)',
        ].join(','),
        backgroundSize: '270px 270px, 270px 270px, 54px 54px, 54px 54px', backgroundPosition: '-20px -34px',
      }} />
      <svg width={1080} height={1920} style={{ position: 'absolute', inset: 0 }}>
        <line x1={-100} y1={1500} x2={1180} y2={220} stroke="rgba(255,255,255,.1)" strokeWidth={2} />
        <line x1={-100} y1={1960} x2={1180} y2={680} stroke="rgba(255,255,255,.07)" strokeWidth={2} strokeDasharray="12 10" />
        {Array.from({ length: 19 }, (_, i) => (
          <text key={i} x={250 + i * 54 - 270} y={22} fill="rgba(255,255,255,.4)" fontFamily={DYMO} fontSize={20} textAnchor="middle">{i}</text>
        ))}
        {Array.from({ length: 35 }, (_, i) => (
          <text key={`v${i}`} x={12} y={20 + i * 54} fill="rgba(255,255,255,.4)" fontFamily={DYMO} fontSize={20}>{i}</text>
        ))}
      </svg>
      <AbsoluteFill style={{ backgroundImage: FIBRA, opacity: 0.6 }} />
      {/* la luz del velador se mueve apenas entre cuadros, como en una toma de stop-motion */}
      <AbsoluteFill style={{ background: `radial-gradient(85% 60% at ${22 + azar(k) * 2}% ${8 + azar(k + 3) * 2}%, rgba(255,236,200,.22), transparent 70%)` }} />
    </AbsoluteFill>
  );
};

// ── Agenda de papel ──────────────────────────────────────────────────────────
const FILA0 = 215, ALTO_FILA = 150;

const Agenda = ({ f, modo, x, y, escala = 1, rot, llega = -99 }: {
  f: number; modo: 'faltazos' | 'sellos'; x: number; y: number; escala?: number; rot: number; llega?: number;
}) => {
  const ag = G.agenda;
  const t = tiembla(11, f, 0.9);
  const entra = (1 - salto(f, llega, 4)) * 1400;
  const escrita = modo === 'sellos'; // en la segunda parte ya está escrita de antes
  return (
    <div style={{ position: 'absolute', left: x, top: y, width: 820, height: 1110, transformOrigin: '0 0',
      transform: `translate(${t.x}px,${t.y + entra}px) rotate(${rot + t.r}deg) scale(${escala})` }}>
      <Papel semilla={3} color="#FBF8F0" amp={0.5} style={{ inset: 0 }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: `repeating-linear-gradient(180deg, transparent 0 ${ALTO_FILA - 3}px, rgba(70,110,170,.28) ${ALTO_FILA - 3}px ${ALTO_FILA}px)`, backgroundPosition: `0 ${FILA0 - ALTO_FILA}px`, top: FILA0 - 10 }} />
        <div style={{ position: 'absolute', top: 0, bottom: 0, left: 100, width: 3, background: 'rgba(205,60,60,.5)' }} />
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} style={{ position: 'absolute', left: 34, top: 80 + i * 150, width: 30, height: 30, borderRadius: 15, background: '#1A5C4A', boxShadow: 'inset 2px 3px 4px rgba(0,0,0,.4)' }} />
        ))}
      </Papel>
      <AMano txt={ag.titulo.txt} f={f} a={escrita ? -99 : ag.titulo.a} dur={ag.titulo.dur} tam={92} color={TINTA} style={{ position: 'absolute', left: 130, top: 50 }} />
      {ag.filas.map((r, i) => {
        const a = escrita ? -99 : r.a;
        const top = FILA0 + i * ALTO_FILA;
        return (
          <div key={i} style={{ position: 'absolute', left: 0, top, width: 820, height: ALTO_FILA }}>
            <AMano txt={r.h} f={f} a={a} dur={4} tam={58} color={TINTA} style={{ position: 'absolute', left: 125, top: 42 }} />
            <AMano txt={r.n} f={f} a={a + 3} dur={5} tam={72} color={TINTA} style={{ position: 'absolute', left: 310, top: 30 }} />
            <AMano txt={r.s} f={f} a={a + 5} dur={4} tam={40} color="#5A6A9E" style={{ position: 'absolute', left: 310 + r.n.length * 40 + 30, top: 62 }} />
          </div>
        );
      })}
      {modo === 'faltazos' && ag.tachones.map((tc, i) => {
        const top = FILA0 + tc.fila * ALTO_FILA;
        return (
          <div key={i}>
            <Trazo d={zigzag(470, 120, i * 9 + 4)} f={f} a={tc.a} dur={9} w={470} h={120} style={{ left: 110, top: top + 12 }} />
            <AMano txt="no vino" f={f} a={tc.a + 9} dur={6} fuente={MANO_BLANCA} peso={700} tam={46} color={ROJO} style={{ position: 'absolute', left: 600, top: top + 36, transform: `rotate(${-6 + i * 3}deg)` }} />
          </div>
        );
      })}
      {modo === 'sellos' && G.aviso.clientas.map((c, i) => {
        const cambio = c.elige === 'cambio';
        return (
          <Sello key={i} txt={cambio ? 'PASÓ AL VIERNES' : 'CONFIRMÓ'} f={f} a={c.sello} semilla={40 + i} tam={cambio ? 38 : 46}
            color={cambio ? '#1F3FA8' : '#0E7A50'} rot={(azar(70 + i) - 0.5) * 12}
            style={{ left: cambio ? 300 : 462, top: FILA0 + c.fila * ALTO_FILA + (cambio ? 22 : 18) }} />
        );
      })}
      {modo === 'sellos' && (
        <>
          <AMano txt={G.aviso.cero.txt} f={f} a={G.aviso.cero.a} dur={G.aviso.cero.dur} fuente={MANO_BLANCA} peso={700} tam={60} color={ROJO}
            style={{ position: 'absolute', left: 330, top: 975, transform: 'rotate(-4deg)' }} />
          <Trazo d={circulo(420, 130)} f={f} a={G.aviso.cero.circulo} dur={9} w={420} h={130} grosor={9} style={{ left: 270, top: 965 }} />
        </>
      )}
    </div>
  );
};

// ── Etiqueta de precio: lo que costaron los faltazos ─────────────────────────
const Etiqueta = ({ f }: { f: number }) => {
  const et = G.etiqueta;
  const cae = (1 - salto(f, et.llega, 3)) * -900;
  const t = tiembla(21, f, 1);
  return (
    <div style={{ position: 'absolute', left: 120, top: 330, width: 840, height: 520, transform: `translate(${t.x}px,${t.y + cae}px) rotate(${6 + t.r}deg)` }}>
      <svg width={900} height={900} style={{ position: 'absolute', left: -500, top: -620, overflow: 'visible' }}>
        <path d="M 0 0 C 200 300, 380 420, 560 690" stroke="#F4EFE4" strokeWidth={5} fill="none" />
      </svg>
      <Papel semilla={22} color="#E2C28C" amp={0.6} style={{ inset: 0 }}>
        <div style={{ position: 'absolute', left: 36, top: 230, width: 54, height: 54, borderRadius: 27, background: '#1A5C4A', boxShadow: 'inset 2px 3px 5px rgba(0,0,0,.45)' }} />
      </Papel>
      <AMano txt={et.lineas[0].txt} f={f} a={et.lineas[0].a} dur={et.lineas[0].dur} fuente={MANO_BLANCA} peso={700} tam={70} color="#2A1F14" style={{ position: 'absolute', left: 140, top: 40 }} />
      <AMano txt={et.lineas[1].txt} f={f} a={et.lineas[1].a} dur={et.lineas[1].dur} fuente={MANO_BLANCA} peso={700} tam={124} color={ROJO} style={{ position: 'absolute', left: 120, top: 120 }} />
      <AMano txt={et.lineas[2].txt} f={f} a={et.lineas[2].a} dur={et.lineas[2].dur} fuente={MANO_BLANCA} peso={700} tam={58} color="#2A1F14" style={{ position: 'absolute', left: 150, top: 375 }} />
    </div>
  );
};

// ── Celular de papel con el recordatorio de WhatsApp ─────────────────────────
const TEL = { x: 50, y: 160, w: 580, h: 1010, rot: -3 };
const PANT = 22;
const BURBUJA = { x: 26, y: 168, w: 484, h: 250 };
const BOTON_H = 80;
const botonY = (i: number) => BURBUJA.y + BURBUJA.h + 14 + i * (BOTON_H + 10);

/** Centro de un botón en coordenadas del cuadro (con la rotación del teléfono). */
const centroBoton = (i: number) => {
  const lx = TEL.x + PANT + BURBUJA.x + BURBUJA.w / 2, ly = TEL.y + PANT + botonY(i) + BOTON_H / 2;
  const cx = TEL.x + TEL.w / 2, cy = TEL.y + TEL.h / 2, a = (TEL.rot * Math.PI) / 180;
  return { x: cx + (lx - cx) * Math.cos(a) - (ly - cy) * Math.sin(a), y: cy + (lx - cx) * Math.sin(a) + (ly - cy) * Math.cos(a) };
};

const clientaActual = (f: number) => [...G.aviso.clientas].reverse().find((c) => f >= c.a);

const Check = ({ color }: { color: string }) => (
  <svg width={34} height={34} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={3.4} strokeLinecap="round" strokeLinejoin="round"><path d="M4 12.5 9.5 18 20 6.5" /></svg>
);
const Vuelta = ({ color }: { color: string }) => (
  <svg width={34} height={34} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round"><path d="M4 12a8 8 0 1 0 2.5-5.8M4 4v4.5h4.5" /></svg>
);

const Telefono = ({ f }: { f: number }) => {
  const c = clientaActual(f);
  const entra = (1 - salto(f, G.aviso.telefono, 4)) * -900;
  const t = tiembla(31, f, 0.9);
  const msg = c ? `Hola ${c.n}! Te recordamos tu turno en Estudio Martina: ${c.servicio}, mañana jueves a las ${c.hora} h.` : '';
  const escribe = c ? c.a + 6 : 0;
  const letras = c ? Math.min(msg.length, Math.max(0, Math.ceil(((f - escribe + 1) / c.escribe) * msg.length))) : 0;
  const botones = c ? escribe + c.escribe + 1 : 9999;
  const tocado = c && f >= c.toque ? (c.elige === 'cambio' ? 1 : 0) : -1;
  const burbuja = c ? salto(f, c.a + 3, 2) : 0;
  return (
    <div style={{ position: 'absolute', left: TEL.x, top: TEL.y, width: TEL.w, height: TEL.h, transform: `translate(${t.x + entra}px,${t.y}px) rotate(${TEL.rot + t.r}deg)` }}>
      <Papel semilla={32} color="#1F2124" amp={0.4} style={{ inset: 0 }} />
      <div style={{ position: 'absolute', inset: PANT, borderRadius: 4, overflow: 'hidden', background: '#EDE3D2' }}>
        <div style={{ position: 'absolute', inset: 0, backgroundImage: FIBRA }} />
        {/* cabecera del chat: el aviso sale del número de Ventra con el nombre del negocio */}
        <Papel semilla={33} color="#136B57" amp={1.5} sombra="drop-shadow(0 5px 0 rgba(0,0,0,.18))" style={{ left: -10, top: -10, right: -10, height: 140 }}>
          <Img src={staticFile('ventra-logo.png')} style={{ position: 'absolute', left: 34, top: 44, width: 72, height: 72, borderRadius: 36, border: '4px solid #F4EFE4' }} />
          <div style={{ position: 'absolute', left: 124, top: 44, color: '#F4EFE4', fontFamily: BOTON, fontSize: 44, lineHeight: 1 }}>Ventra</div>
          <div style={{ position: 'absolute', left: 124, top: 92, color: '#BDEFD6', fontFamily: "'Lucida Sans Typewriter'", fontSize: 21 }}>Estudio Martina · turnos</div>
        </Papel>
        {c && burbuja > 0 && (
          <div style={{ position: 'absolute', left: BURBUJA.x, top: BURBUJA.y, width: BURBUJA.w, height: BURBUJA.h, transform: `scale(${0.9 + burbuja * 0.1})`, transformOrigin: '0 0', opacity: burbuja }}>
            <Papel semilla={50 + G.aviso.clientas.indexOf(c)} color="#FFFFFF" amp={0.8} style={{ inset: 0 }} />
            <svg width={40} height={40} style={{ position: 'absolute', left: -22, top: 0 }}><path d="M40 0 L0 0 L40 34 Z" fill="#fff" /></svg>
            <div style={{ position: 'absolute', left: 24, top: 20, right: 22, fontFamily: "'Lucida Sans Typewriter'", fontWeight: 700, fontSize: 27, lineHeight: 1.34, color: '#16241F' }}>
              {msg.slice(0, letras)}<span style={{ opacity: 0 }}>{msg.slice(letras)}</span>
            </div>
            <div style={{ position: 'absolute', right: 20, bottom: 12, fontFamily: "'Lucida Sans Typewriter'", fontSize: 19, color: '#7C8A84' }}>miércoles 20:00</div>
          </div>
        )}
        {c && f >= botones && ['Confirmo', 'Necesito cambiarlo'].map((txt, i) => {
          if (f < botones + i * 2) return null;
          const elegido = tocado === i;
          return (
            <div key={i} style={{ position: 'absolute', left: BURBUJA.x, top: botonY(i), width: BURBUJA.w, height: BOTON_H, transform: elegido ? 'translateY(4px)' : undefined }}>
              <Papel semilla={60 + i + G.aviso.clientas.indexOf(c) * 3} color={elegido ? '#CFEFDD' : '#FFFFFF'} amp={1.2}
                sombra={elegido ? 'drop-shadow(1px 2px 0 rgba(0,0,0,.2))' : undefined} style={{ inset: 0 }} />
              <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
                fontFamily: BOTON, fontSize: 40, color: '#136B57' }}>
                {i === 0 ? <Check color="#136B57" /> : <Vuelta color="#136B57" />}{txt}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ position: 'absolute', left: '50%', top: 34, width: 150, height: 34, marginLeft: -75, borderRadius: 17, background: '#0E0F11' }} />
    </div>
  );
};

/** Cartelito atado al celular: de quién es el celular que recibe el aviso. */
const DeQuien = ({ f }: { f: number }) => {
  const c = clientaActual(f);
  if (!c || f < c.a) return null;
  const i = G.aviso.clientas.indexOf(c);
  const t = tiembla(80 + i, f, 1);
  const golpe = f - c.a < CADA ? 1.08 : 1;
  return (
    <div style={{ position: 'absolute', left: 560, top: 110, width: 430, height: 130, transform: `translate(${t.x}px,${t.y}px) rotate(${5 + (azar(i) - 0.5) * 6 + t.r}deg) scale(${golpe})` }}>
      <Papel semilla={81 + i} color="#F2D04B" amp={1.6} style={{ inset: 0 }} />
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: MANO_BLANCA, fontWeight: 700, fontSize: 50, color: '#16241F' }}>
        el celu de {c.n}
      </div>
    </div>
  );
};

const Anotacion = ({ f }: { f: number }) => {
  const an = G.aviso.anotacion;
  const por = an.dur / an.txt.length;
  return (
    <>
      {an.txt.map((l, i) => (
        <AMano key={i} txt={l} f={f} a={an.a + i * por} dur={por} fuente={MANO_BLANCA} peso={700} tam={50} color="#F4EFE4"
          style={{ position: 'absolute', left: 660, top: 330 + i * 70, transform: 'rotate(-3deg)' }} />
      ))}
      <Trazo d="M 760 560 C 730 610, 680 620, 615 585 M 615 585 L 640 548 M 615 585 L 660 600" f={f} a={an.flecha} dur={6}
        w={1080} h={1920} color="#F4EFE4" grosor={7} tinta={false} style={{ left: 0, top: 0 }} />
    </>
  );
};

/** La mano de papel: entra, toca el botón de cada clienta y se va. */
const ManoQueToca = ({ f }: { f: number }) => {
  const m = G.aviso.mano;
  if (f < m.entra) return null;
  const c = clientaActual(f)!;
  const btn = centroBoton(c.elige === 'cambio' ? 1 : 0);
  const reposo = { x: centroBoton(0).x + 60, y: centroBoton(0).y + 120 };
  let p = reposo;
  if (f >= c.toque && f < c.toque + 6) p = btn;
  else if (f >= c.toque - CADA && f < c.toque) p = { x: (btn.x + reposo.x) / 2, y: (btn.y + reposo.y) / 2 };
  const entra = 1 - salto(f, m.entra, 4);
  const sale = salto(f, m.sale, 3);
  const fuera = Math.max(entra, sale);
  return <Mano x={p.x - fuera * 520} y={p.y + fuera * 1000} rot={22} f={f} semilla={91} />;
};

// ── Composición ──────────────────────────────────────────────────────────────
const LuzYGrano = ({ f }: { f: number }) => {
  const k = Math.floor(f / CADA);
  return (
    <>
      <AbsoluteFill style={{ pointerEvents: 'none', background: 'radial-gradient(80% 65% at 50% 45%, transparent 55%, rgba(10,20,15,.42) 100%)' }} />
      <AbsoluteFill style={{ pointerEvents: 'none', mixBlendMode: 'overlay', opacity: 0.16 }}>
        <svg width={1080} height={1920}>
          <filter id="grano"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={k % 50} /><feColorMatrix type="saturate" values="0" /></filter>
          <rect width={1080} height={1920} filter="url(#grano)" />
        </svg>
      </AbsoluteFill>
    </>
  );
};

export const ReelFaltazos = () => {
  const f = useCurrentFrame();
  const enAviso = f >= E.aviso[0] && f < E.cierre[0];
  const hojaVerde = f >= G.giro.hoja && f < E.aviso[0];
  const hojaX = (1 - salto(f, G.giro.hoja, 3)) * 1200;
  const ci = G.cierre;

  let escena: React.ReactNode = null;
  if (f < E.aviso[0]) {
    escena = (
      <>
        <Agenda f={f} modo="faltazos" x={130} y={640} rot={-2} llega={G.agenda.llega} />
        <Cinta x={170} y={610} rot={-14} semilla={1} f={f} a={G.agenda.cintas[0]} />
        <Cinta x={780} y={605} rot={11} semilla={2} f={f} a={G.agenda.cintas[1]} />
        {entre(f, E.faltazos) && (
          <Recortes lineas={G.plantada.lineas} f={f} a={G.plantada.a} cada={G.plantada.cada} tam={128} semilla={7} style={{ left: 60, top: 150 }} />
        )}
        {f >= E.costo[0] && <Etiqueta f={f} />}
        {hojaVerde && (
          <div style={{ position: 'absolute', left: -60 + hojaX, top: -60, width: 1220, height: 2060 }}>
            <Papel semilla={99} color="#136B57" amp={0.6} style={{ inset: 0 }} />
            <Recortes lineas={G.giro.lineas} f={f} a={G.giro.a} cada={G.giro.cada} tam={128} semilla={13} sinVerde style={{ left: 110, top: 640 }} />
          </div>
        )}
      </>
    );
  } else if (enAviso) {
    escena = (
      <>
        <Agenda f={f} modo="sellos" x={300} y={985} escala={0.86} rot={3} />
        <Telefono f={f} />
        <Cinta x={-30} y={640} rot={84} semilla={4} f={f} a={G.aviso.cintas[0]} w={170} />
        <Cinta x={470} y={1100} rot={-30} semilla={5} f={f} a={G.aviso.cintas[1]} w={170} />
        <DeQuien f={f} />
        <Anotacion f={f} />
        <ManoQueToca f={f} />
        {f >= E.chau[0] && (
          <Recortes lineas={G.chau.lineas} f={f} a={G.chau.a} cada={G.chau.cada} tam={136} semilla={17} style={{ left: 50, top: 170 }} />
        )}
      </>
    );
  } else {
    escena = (
      <>
        {f >= ci.logo && (
          <div style={{ position: 'absolute', left: 80, top: 300, width: 210, height: 210, transform: `rotate(-7deg) scale(${f - ci.logo < CADA ? 1.1 : 1})` }}>
            <Papel semilla={120} color="#FBF8F0" amp={2} style={{ inset: 0 }}>
              <Img src={staticFile('ventra-logo.png')} style={{ position: 'absolute', left: 25, top: 25, width: 160, height: 160 }} />
            </Papel>
          </div>
        )}
        {ci.etiquetas.map((e, i) => (
          <Dymo key={i} txt={e.txt} f={f} a={e.a} cada={e.cada} cinta={e.cinta} semilla={130 + i}
            tam={i === 0 ? 86 : i === 3 ? 84 : 62} style={{ left: 70, top: [580, 760, 880, 1010][i] }} />
        ))}
        <AMano txt={ci.mano[0].txt} f={f} a={ci.mano[0].a} dur={ci.mano[0].dur} fuente={MANO_BLANCA} peso={700} tam={60} color="#F4EFE4"
          style={{ position: 'absolute', left: 90, top: 1250, transform: 'rotate(-3deg)' }} />
        <AMano txt={ci.mano[1].txt} f={f} a={ci.mano[1].a} dur={ci.mano[1].dur} fuente={MANO_BLANCA} peso={700} tam={130} color="#7FE3B8"
          style={{ position: 'absolute', left: 70, top: 1320, transform: 'rotate(-3deg)' }} />
        <Trazo d="M 10 40 C 200 10, 420 30, 640 12 C 700 8, 760 20, 800 30" f={f} a={ci.subrayado} dur={6} w={820} h={60}
          color="#7FE3B8" grosor={10} tinta={false} style={{ left: 80, top: 1500 }} />
      </>
    );
  }

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Audio src={staticFile('reel-faltazos/audio.wav')} />
      <Plancha f={f} />
      {escena}
      <LuzYGrano f={f} />
    </AbsoluteFill>
  );
};
