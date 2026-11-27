import type React from 'react';
import { AbsoluteFill, Img, OffthreadVideo, continueRender, delayRender, staticFile, useCurrentFrame } from 'remotion';
import { Audio } from '@remotion/media';
import G from './guion.json';
import { BARRA, BarraEstado, CREMA, ent, INTER, JAKARTA, MENTA, OSCURO, PANT_H, suave, Telefono, Titular, VERDE } from '../reel-agenda-pro/piezas';

// "Mi kiosco me contesta": el dueño le habla a su negocio por WhatsApp (bot del dueño, wa-owner.js).
// Estilo fintech cálido aprobado (crema + verde, Plus Jakarta Sans). Los textos del chat siguen el
// formato real del bot: "🎤 _lo que entendió_" arriba, la vista previa con Confirmar/Cancelar y la
// confirmación "Listo, cambié…" (wa-owner-edits.js). Las promos son las que dibuja promo-images.

const espera = delayRender('fuentes');
Promise.all([
  new FontFace('Jakarta', `url(${staticFile('fuentes/plus-jakarta-sans-latin-wght-normal.woff2')})`, { weight: '200 800' }).load(),
  new FontFace('Jakarta', `url(${staticFile('fuentes/plus-jakarta-sans-latin-ext-wght-normal.woff2')})`, { weight: '200 800', unicodeRange: 'U+0100-024F, U+1E00-1EFF' }).load(),
  new FontFace('Inter', `url(${staticFile('inter.woff2')})`, { weight: '100 900' }).load(),
]).then((fs) => { fs.forEach((x) => document.fonts.add(x)); continueRender(espera); });

export const TOTAL = G.total;
const E = G.escenas;
const WA = { fondo: '#EFEAE2', enviado: '#D9FDD3', gris: '#667781', azul: '#53BDEB', verde: '#00A884' };
const TEL_Y = 400, TEL_ESC = 1.22; // grande para que se lea en el celular; la barra de escribir queda justo al borde
const SOMBRA = '0 1px 0.5px rgba(11,20,26,.13)';

type Msg = (typeof G.chat)[number] & { graba?: number; texto?: string; botones?: string[]; toque?: number; resalta?: string; resaltaDesde?: number; fotos?: string[]; dura?: string; hasta?: number; hora?: string };
const CHAT = G.chat as Msg[];

// ── Texto con el formato de WhatsApp: *negrita*, _cursiva_ y saltos de línea ────────────
const Formato = ({ texto, resalta, pRes = 0 }: { texto: string; resalta?: string; pRes?: number }) => {
  const partes: React.ReactNode[] = [];
  const conResalte = (s: string, k: string) => {
    if (!resalta || !s.includes(resalta)) return [s];
    const [a, b] = s.split(resalta);
    return [a, <span key={k} style={{ background: `rgba(127,227,184,${0.75 * pRes})`, borderRadius: 4, boxShadow: `0 0 0 2px rgba(127,227,184,${0.75 * pRes})`, fontWeight: pRes > 0.5 ? 600 : 400 }}>{resalta}</span>, b];
  };
  texto.split(/(\*[^*]+\*|_[^_]+_)/g).forEach((s, i) => {
    if (/^\*[^*]+\*$/.test(s)) partes.push(<b key={i}>{s.slice(1, -1)}</b>);
    else if (/^_[^_]+_$/.test(s)) partes.push(<i key={i} style={{ color: '#3B4A54' }}>{s.slice(1, -1)}</i>);
    else partes.push(...conResalte(s, `r${i}`));
  });
  return <span style={{ whiteSpace: 'pre-wrap' }}>{partes}</span>;
};

const Tilde = ({ azul }: { azul: boolean }) => (
  <svg width="17" height="11" viewBox="0 0 17 11" fill="none" stroke={azul ? WA.azul : WA.gris} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1 6l3 3 6-7.5M7 8.5l1 .8 6.5-8" />
  </svg>
);

// Ondas fijas de la nota de voz (alturas "al azar" pero siempre iguales)
const ONDAS = Array.from({ length: 30 }, (_, i) => 4 + Math.round(14 * Math.abs(Math.sin(i * 1.7) * Math.cos(i * 0.6))));

const NotaDeVoz = ({ m, f }: { m: Msg; f: number }) => {
  const prog = Math.min(1, Math.max(0, (f - m.a - 4) / 40));
  return (
    <div style={{ background: WA.enviado, borderRadius: '10px 0 10px 10px', padding: '8px 10px 5px 8px', boxShadow: SOMBRA, width: 262, display: 'flex', alignItems: 'center', gap: 8 }}>
      <svg width="26" height="26" viewBox="0 0 24 24" fill="#54656F"><path d="M8 5.5v13l10.5-6.5Z" /></svg>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, height: 24, position: 'relative' }}>
          {ONDAS.map((h, i) => <span key={i} style={{ width: 3, height: h, borderRadius: 2, background: i / ONDAS.length < prog ? '#3B8E7A' : '#9DB5AC' }} />)}
          <span style={{ position: 'absolute', left: `${prog * 96}%`, width: 11, height: 11, borderRadius: 6, background: '#4FB3EC', top: 7 }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: WA.gris, marginTop: 2 }}>
          <span>{m.dura}</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>{m.hora} <Tilde azul={f > m.a + 20} /></span>
        </div>
      </div>
      <div style={{ width: 40, height: 40, borderRadius: 20, background: '#C9D3CF', position: 'relative', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: JAKARTA, fontWeight: 800, color: '#4B5B55', fontSize: 17 }}>
        V
        <svg width="14" height="14" viewBox="0 0 24 24" fill="#3B8E7A" style={{ position: 'absolute', left: -4, bottom: -2 }}><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12Z" /></svg>
      </div>
    </div>
  );
};

const Burbuja = ({ m, f }: { m: Msg; f: number }) => {
  const yo = m.de === 'yo';
  return (
    <div style={{ background: yo ? WA.enviado : '#fff', borderRadius: yo ? '10px 0 10px 10px' : '0 10px 10px 10px', padding: '7px 10px 5px', boxShadow: SOMBRA, maxWidth: 312, fontSize: 15.5, lineHeight: 1.36, color: '#111B21' }}>
      <Formato texto={m.texto || ''} resalta={m.resalta} pRes={m.resaltaDesde ? ent(f, m.resaltaDesde, 14) : 0} />
      <div style={{ textAlign: 'right', fontSize: 11.5, color: WA.gris, marginTop: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 3 }}>
        {m.hora}{yo && <Tilde azul={f > m.a + 12} />}
      </div>
    </div>
  );
};

const Botones = ({ m, f }: { m: Msg; f: number }) => (
  <>
    {(m.botones || []).map((txt, i) => {
      const presion = i === 0 && m.toque != null && f >= m.toque && f < m.toque + 8;
      const usado = m.toque != null && f >= m.toque;
      return (
        <div key={txt} style={{
          marginTop: 4, width: 312, height: 42, borderRadius: 10, background: presion ? '#E4F2EC' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: usado ? '#8A9A94' : '#027EB5', fontSize: 15.5, fontWeight: 500, boxShadow: SOMBRA, position: 'relative',
        }}>
          {txt}
          {i === 0 && m.toque != null && f >= m.toque - 4 && f < m.toque + 14 && (() => {
            const k = (f - (m.toque - 4)) / 18;
            return <span style={{ position: 'absolute', left: '50%', top: '50%', width: 44, height: 44, marginLeft: -22, marginTop: -22, borderRadius: 22, background: 'rgba(17,27,33,.18)', border: '2px solid rgba(17,27,33,.25)', transform: `scale(${0.6 + k * 1.1})`, opacity: 1 - k }} />;
          })()}
        </div>
      );
    })}
  </>
);

const Album = ({ m }: { m: Msg }) => {
  const [a, b, c] = m.fotos || [];
  const foto = (src: string, w: number) => <Img src={staticFile(src)} style={{ width: w, height: w, borderRadius: 6, objectFit: 'cover', display: 'block' }} />;
  return (
    <div style={{ background: '#fff', borderRadius: '0 10px 10px 10px', padding: 3, boxShadow: SOMBRA, width: 252 }}>
      {foto(a, 246)}
      <div style={{ display: 'flex', gap: 3, marginTop: 3 }}>{foto(b, 121.5)}{foto(c, 121.5)}</div>
      <div style={{ textAlign: 'right', fontSize: 11.5, color: WA.gris, padding: '3px 6px 1px' }}>{m.hora}</div>
    </div>
  );
};

const Escribiendo = ({ f, a }: { f: number; a: number }) => (
  <div style={{ background: '#fff', borderRadius: '0 10px 10px 10px', padding: '12px 16px', display: 'flex', gap: 5, boxShadow: SOMBRA }}>
    {[0, 1, 2].map((i) => <span key={i} style={{ width: 8, height: 8, borderRadius: 4, background: '#9AA5AC', opacity: 0.35 + 0.65 * Math.abs(Math.sin((f - a) / 4 + i)) }} />)}
  </div>
);

// ── El chat con Ventra, en px de 390 escalados a la pantalla ────────────────────────────
export const Chat = ({ f }: { f: number }) => {
  const esc = 600 / 390;
  const visibles = CHAT.filter((m) => f >= m.a && !(m.tipo === 'escribiendo' && f >= (m.hasta ?? 0)));
  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <BarraEstado fondo="#FFFFFF" claro={false} hora="21:47" />
      <div style={{ position: 'absolute', left: 0, top: BARRA, width: 390, height: (PANT_H - BARRA) / esc, transform: `scale(${esc})`, transformOrigin: '0 0', background: WA.fondo, fontFamily: INTER, overflow: 'hidden' }}>
        {/* cabecera */}
        <div style={{ position: 'absolute', left: 0, right: 0, top: 0, zIndex: 2, height: 60, background: '#fff', display: 'flex', alignItems: 'center', gap: 10, padding: '0 12px', borderBottom: '1px solid #E9EDEF' }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#111" strokeWidth="2.2" strokeLinecap="round"><path d="M15 5l-7 7 7 7" /></svg>
          <Img src={staticFile('reel-agenda-pro/perfil-whatsapp.jpg')} style={{ width: 38, height: 38, borderRadius: 19 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 16.5, fontWeight: 600, color: '#111', display: 'flex', alignItems: 'center', gap: 5 }}>
              Ventra
              <svg width="15" height="15" viewBox="0 0 24 24"><path fill="#00A884" d="m12 1 2.6 2.2 3.4-.4.9 3.3 3 1.7-1.3 3.2 1.3 3.2-3 1.7-.9 3.3-3.4-.4L12 23l-2.6-2.2-3.4.4-.9-3.3-3-1.7L3.4 13 2.1 9.8l3-1.7.9-3.3 3.4.4Z" /><path d="m7.5 12.2 3 3 6-6.2" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <div style={{ fontSize: 12.5, color: WA.gris }}>{CHAT.some((m) => m.tipo === 'escribiendo' && f >= m.a && f < (m.hasta ?? 0)) ? 'escribiendo…' : 'en línea'}</div>
          </div>
        </div>
        {/* mensajes: pegados abajo, cada uno nuevo empuja a los anteriores hacia arriba */}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 64, display: 'flex', flexDirection: 'column', gap: 6, padding: '0 10px' }}>
          {visibles.map((m) => {
            const p = ent(f, m.a, 12);
            const yo = m.de === 'yo';
            return (
              <div key={m.id} style={{ maxHeight: p * 720, overflow: 'visible', display: 'flex', flexDirection: 'column', alignItems: yo ? 'flex-end' : 'flex-start', opacity: Math.min(1, p * 1.6), transform: `translateY(${(1 - p) * 14}px)` }}>
                {m.tipo === 'audio' && <NotaDeVoz m={m} f={f} />}
                {m.tipo === 'texto' && <Burbuja m={m} f={f} />}
                {m.tipo === 'texto' && m.botones && <Botones m={m} f={f} />}
                {m.tipo === 'album' && <Album m={m} />}
                {m.tipo === 'escribiendo' && <Escribiendo f={f} a={m.a} />}
              </div>
            );
          })}
        </div>
        {/* barra para escribir; mientras se mantiene el micrófono, la grabación de WhatsApp */}
        {(() => {
          const grabando = CHAT.find((m) => m.tipo === 'audio' && m.graba != null && f >= m.graba && f < m.a);
          const seg = grabando ? Math.floor((f - (grabando.graba ?? 0)) / 30) : 0;
          return (
            <div style={{ position: 'absolute', left: 8, right: 8, bottom: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
              <div style={{ flex: 1, height: 46, borderRadius: 23, background: '#fff', display: 'flex', alignItems: 'center', padding: '0 16px', color: '#8696A0', fontSize: 16, gap: 10 }}>
                {grabando ? (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="#EA0038" style={{ opacity: 0.45 + 0.55 * Math.abs(Math.cos((f - (grabando.graba ?? 0)) / 9)) }}><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12Z" /></svg>
                    <span style={{ color: '#3B4A54', fontVariantNumeric: 'tabular-nums' }}>0:0{seg}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 14.5 }}>‹ Deslizá para cancelar</span>
                  </>
                ) : 'Mensaje'}
              </div>
              <div style={{ width: 46, height: 46, borderRadius: 23, background: WA.verde, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `scale(${grabando ? 1.55 : 1})`, transformOrigin: '70% 70%' }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3Zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12Z" /></svg>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
};

// ── La promo que sale del chat y queda grande ────────────────────────────────────────────
const PromoGrande = ({ f }: { f: number }) => {
  const a = G.promoGrande.a;
  if (f < a || f >= E.cierre[0] + 10) return null;
  const p = ent(f, a, 18);
  const sale = ent(f, E.cierre[0] - 4, 12);
  return (
    <div style={{
      position: 'absolute', left: 540 - 430, top: 700, width: 860, height: 860, borderRadius: 26, overflow: 'hidden', zIndex: 8,
      boxShadow: '0 60px 120px -40px rgba(11,40,30,.65), 0 0 0 10px #fff',
      opacity: p * (1 - sale), transform: `translateY(${(1 - p) * 260 - sale * 120}px) rotate(${(1 - p) * -5 + 1.5}deg) scale(${0.82 + p * 0.18})`,
    }}>
      <Img src={staticFile(G.promoGrande.foto)} style={{ width: 860, height: 860 }} />
    </div>
  );
};

// ── Cierre ───────────────────────────────────────────────────────────────────────────────
const Cierre = ({ f }: { f: number }) => {
  const a = E.cierre[0];
  if (f < a) return null;
  const circulo = suave(f, a, 14);
  const pieza = (d: number, contenido: React.ReactNode, estilo: React.CSSProperties = {}) => {
    const p = ent(f, a + d, 16);
    return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 40}px)`, ...estilo }}>{contenido}</div>;
  };
  return (
    <AbsoluteFill style={{ zIndex: 10 }}>
      <AbsoluteFill style={{ background: VERDE, clipPath: `circle(${circulo * 2300}px at 540px 1900px)` }} />
      <AbsoluteFill style={{ padding: '0 72px', justifyContent: 'center', fontFamily: JAKARTA, color: '#fff' }}>
        {pieza(2, <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
          <Img src={staticFile('ventra-logo.png')} style={{ width: 96, height: 96, borderRadius: 24, boxShadow: '0 0 0 3px rgba(255,255,255,.35)' }} />
          <span style={{ fontSize: 58, fontWeight: 800, letterSpacing: '-0.03em' }}>Ventra</span>
        </div>)}
        {pieza(18, <div style={{ fontSize: 120, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.0, marginTop: 64 }}>Hablale a<br /><span style={{ color: MENTA }}>tu negocio.</span></div>)}
        {pieza(30, <div style={{ fontSize: 38, fontWeight: 600, lineHeight: 1.4, marginTop: 44, color: 'rgba(255,255,255,.88)' }}>Preguntale, cambiá precios y pedile<br />promos. Por WhatsApp.</div>)}
        {pieza(40, <div style={{ display: 'flex', alignItems: 'center', gap: 26, marginTop: 64 }}>
          <span style={{ background: '#fff', color: VERDE, fontSize: 42, fontWeight: 800, padding: '26px 42px', borderRadius: 999, letterSpacing: '-0.01em' }}>ventra.store</span>
        </div>)}
        {pieza(48, <div style={{ fontSize: 31, fontWeight: 600, marginTop: 34, color: 'rgba(255,255,255,.75)' }}>Ventra Full · $24.900 por mes</div>)}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Composición ──────────────────────────────────────────────────────────────────────────
// ── Versión "PC de fondo": mostrador de kiosco (foto Soul 2.0) con la caja real de Ventra en el monitor,
//    y el celular nítido adelante. Cuando cambia el precio, el foco pasa del celular a la PC. ──
type Monitor = { matrix3d: number[]; ancho: number; alto: number; captura: string; precio: { x: number; y: number; w: number; h: number; antes: string; despues: string }; tarjeta: { x: number; y: number; w: number; h: number } };
const MON = (G as unknown as { monitor: Monitor }).monitor;
const FOCO = (G as unknown as { foco: { a: number; b: number } }).foco;

const FondoPC = ({ f, enfoque }: { f: number; enfoque: number }) => {
  const cambia = f >= FOCO.a + 14;
  const pTarjeta = ent(f, FOCO.a + 10, 12) * (1 - ent(f, FOCO.b - 10, 12));
  // empuje lento de cámara; en el foco, acercamiento a la tarjeta de la Coca (≈175,1205 en la foto) y la lleva al centro
  const zoom = 1 + (f / TOTAL) * 0.05 + 1.5 * enfoque;
  const CX = 175, CY = 1205;
  return (
    <AbsoluteFill style={{ overflow: 'hidden' }}>
      <div style={{
        position: 'absolute', inset: 0, transformOrigin: `${CX}px ${CY}px`,
        transform: `translate(${(470 - CX) * enfoque}px, ${(1120 - CY) * enfoque}px) scale(${zoom})`,
        filter: `blur(${3.2 * (1 - enfoque)}px) brightness(${0.82 + 0.1 * enfoque})`,
      }}>
        <Img src={staticFile('reel-bot/pc/fondo-pc.jpg')} style={{ position: 'absolute', inset: 0, width: 1080, height: 1920 }} />
        {/* la caja de Ventra en el monitor, con la perspectiva de la foto */}
        <div style={{
          position: 'absolute', left: 0, top: 0, width: MON.ancho, height: MON.alto, transformOrigin: '0 0',
          transform: `matrix3d(${MON.matrix3d.join(',')})`, overflow: 'hidden', filter: 'brightness(.9) saturate(.95)',
        }}>
          <Img src={staticFile(MON.captura)} style={{ width: MON.ancho, height: MON.alto }} />
          <div style={{
            position: 'absolute', left: MON.precio.x, top: MON.precio.y, width: MON.precio.w, height: MON.precio.h, background: '#fff',
            display: 'flex', alignItems: 'center', paddingLeft: 6, fontFamily: INTER, fontWeight: 600, fontSize: 44, color: cambia ? '#0E7A5C' : '#111827', letterSpacing: '-0.01em',
          }}>{cambia ? MON.precio.despues : MON.precio.antes}</div>
          <div style={{
            position: 'absolute', left: MON.tarjeta.x - 6, top: MON.tarjeta.y - 6, width: MON.tarjeta.w + 12, height: MON.tarjeta.h + 12, borderRadius: 30,
            border: '8px solid #19B587', boxShadow: '0 0 40px 10px rgba(25,181,135,.55)', opacity: pTarjeta,
          }} />
        </div>
        {/* luz del monitor sobre el mostrador */}
        <div style={{ position: 'absolute', left: 60, top: 1000, width: 960, height: 700, background: 'radial-gradient(closest-side, rgba(180,220,255,.10), transparent)', mixBlendMode: 'screen' }} />
      </div>
    </AbsoluteFill>
  );
};

export const ReelBotPC = ({ portada = false }: { portada?: boolean }) => {
  const f = useCurrentFrame();
  const color = (c: string) => (c === 'verde' ? MENTA : c);
  const enfoque = suave(f, FOCO.a, 16) * (1 - suave(f, FOCO.b, 16));
  const dx = 4 * Math.sin(f / 41) + 1.5 * Math.sin(f / 17);
  const dy = 5 * Math.sin(f / 33 + 1);
  const entra = ent(f, 0, 18);
  return (
    <AbsoluteFill style={{ background: '#000', fontFamily: INTER }}>
      <Audio src={staticFile('reel-bot/audio.wav')} />
      <FondoPC f={f} enfoque={enfoque} />
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,.66) 0%, rgba(0,0,0,.3) 20%, transparent 32%)' }} />
      {f < E.cierre[0] + 16 && (
        <div style={{
          position: 'absolute', inset: 0,
          transform: `translate(${dx + 470 * enfoque}px, ${dy + (1 - entra) * 600 + 60 * enfoque + (portada ? 190 : 0)}px) rotate(${-2 + 0.3 * Math.sin(f / 53) + 4 * enfoque}deg)`,
          filter: `blur(${3 * enfoque}px) brightness(${1 - 0.3 * enfoque})`,
        }}>
          <Telefono x={735} y={520} escala={1.08}><Chat f={f} /></Telefono>
        </div>
      )}
      <div style={{ position: 'absolute', inset: 0, filter: 'drop-shadow(0 4px 18px rgba(0,0,0,.55))' }}>
        {portada
          ? <Titular f={f} a={f - 60} color="#FFFFFF" tam={92} top={290} lineas={[['Le mando audios'], ['a mi kiosco'], [['y me contesta.', MENTA]]]} />
          : G.titulos.map((t, i) => (
            <Titular key={i} f={f} a={t.a} hasta={t.hasta} color="#FFFFFF" tam={88} top={96}
              lineas={t.lineas.map((l) => l.map((s) => (typeof s === 'string' ? s : [s[0], color(s[1])] as [string, string])))} />
          ))}
      </div>
      {!portada && <PromoGrande f={f} />}
      {!portada && <Cierre f={f} />}
    </AbsoluteFill>
  );
};

/** Versión con la mano real: el fondo es public/reel-bot/fondo.mp4 (scripts/reel-bot-componer.py). */
export const ReelBotMano = ({ capa = false }: { capa?: boolean }) => {
  const f = useCurrentFrame();
  const color = (c: string) => (c === 'verde' ? MENTA : c);
  // capa: solo lo de arriba (títulos, promo, cierre) con fondo transparente; ffmpeg lo pone sobre
  // fondo.mp4 y le suma el audio (scripts/reel-bot-final.sh). Así Chrome no carga el video.
  return (
    <AbsoluteFill style={{ background: capa ? 'transparent' : '#000', fontFamily: INTER }}>
      {!capa && <Audio src={staticFile('reel-bot/audio.wav')} />}
      {!capa && f < E.cierre[0] + 16 && <OffthreadVideo src={staticFile('reel-bot/fondo.mp4')} muted style={{ width: 1080, height: 1920 }} />}
      {/* sombra arriba para que los títulos se lean sobre el kiosco */}
      <AbsoluteFill style={{ background: 'linear-gradient(180deg, rgba(0,0,0,.62) 0%, rgba(0,0,0,.28) 22%, transparent 34%)' }} />
      <div style={{ position: 'absolute', inset: 0, filter: 'drop-shadow(0 4px 18px rgba(0,0,0,.55))' }}>
        {G.titulos.map((t, i) => (
          <Titular key={i} f={f} a={t.a} hasta={t.hasta} color="#FFFFFF" tam={88} top={96}
            lineas={t.lineas.map((l) => l.map((s) => (typeof s === 'string' ? s : [s[0], color(s[1])] as [string, string])))} />
        ))}
      </div>
      <PromoGrande f={f} />
      <Cierre f={f} />
    </AbsoluteFill>
  );
};

export const ReelBot = () => {
  const f = useCurrentFrame();
  // cámara en mano muy suave sobre el celular
  const dx = 5 * Math.sin(f / 37) + 2 * Math.sin(f / 13);
  const dy = 4 * Math.sin(f / 29 + 1);
  const rot = 0.35 * Math.sin(f / 53);
  const entra = ent(f, 0, 16);
  const color = (c: string) => (c === 'verde' ? VERDE : c);
  return (
    <AbsoluteFill style={{ background: CREMA, fontFamily: INTER }}>
      <Audio src={staticFile('reel-bot/audio.wav')} />
      <AbsoluteFill style={{ background: 'radial-gradient(120% 60% at 20% 0%, rgba(255,255,255,.5), transparent 60%)' }} />
      {f < E.cierre[0] + 16 && (
        <div style={{ position: 'absolute', inset: 0, transform: `translate(${dx}px, ${dy + (1 - entra) * 500}px) rotate(${rot}deg)` }}>
          <Telefono x={540} y={TEL_Y} escala={TEL_ESC}><Chat f={f} /></Telefono>
        </div>
      )}
      {G.titulos.map((t, i) => (
        <Titular key={i} f={f} a={t.a} hasta={t.hasta} color={OSCURO} tam={92} top={110}
          lineas={t.lineas.map((l) => l.map((s) => (typeof s === 'string' ? s : [s[0], color(s[1])] as [string, string])))} />
      ))}
      <PromoGrande f={f} />
      <Cierre f={f} />
    </AbsoluteFill>
  );
};
