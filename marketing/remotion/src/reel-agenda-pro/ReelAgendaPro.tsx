import type React from 'react';
import { AbsoluteFill, Img, continueRender, delayRender, staticFile, useCurrentFrame } from 'remotion';
import { Audio } from '@remotion/media';
import { AVISO, CLIENTES, ESCENAS as E, FALTARON, GOLPE, MENSAJE, t } from './guion';
import { Captura, ChatWhatsApp, CREMA, ent, INTER, JAKARTA, MENTA, Notificacion, OSCURO, Resalte, suave, Telefono, Titular, VERDE } from './piezas';
import agendaLista from '../../public/reel-agenda-pro/app/agenda-lista.json';
import config from '../../public/reel-agenda-pro/app/config-recordatorios.json';

// Estilo "fintech cálido": crema y verde Ventra, Plus Jakarta Sans (la de la app y la web),
// la app real en primer plano y cada corte en el golpe de la música. Ver .claude/skills/ventra-video.

const espera = delayRender('fuentes');
Promise.all([
  new FontFace('Jakarta', `url(${staticFile('fuentes/plus-jakarta-sans-latin-wght-normal.woff2')})`, { weight: '200 800' }).load(),
  new FontFace('Jakarta', `url(${staticFile('fuentes/plus-jakarta-sans-latin-ext-wght-normal.woff2')})`, { weight: '200 800', unicodeRange: 'U+0100-024F, U+1E00-1EFF' }).load(),
  new FontFace('Inter', `url(${staticFile('inter.woff2')})`, { weight: '100 900' }).load(),
]).then((fs) => { fs.forEach((x) => document.fonts.add(x)); continueRender(espera); });

const entre = (f: number, [a, b]: readonly number[]) => f >= a && f < b;
const TEL_Y = 560; // dónde queda la parte de arriba del celular (grande: la parte de abajo queda fuera del cuadro)

// ── Fondo: crema, y el verde entra como un círculo que crece desde el celular ─────────
const Fondo = ({ f }: { f: number }) => {
  const circulo = (a: number, color: string, cx = 540, cy = 1500) => {
    const p = suave(f, a, 14);
    return p > 0 ? <AbsoluteFill style={{ background: color, clipPath: `circle(${p * 2300}px at ${cx}px ${cy}px)` }} /> : null;
  };
  return (
    <AbsoluteFill style={{ background: CREMA }}>
      {f < E.aviso[0] + 16 && circulo(E.whatsapp[0], VERDE)}
      {f >= E.aviso[0] && f < E.cierre[0] + 16 && circulo(E.aviso[0], CREMA, 540, 760)}
      {f >= E.cierre[0] && circulo(E.cierre[0], VERDE, 540, 1900)}
      {/* luz suave de arriba, para que el color no quede plano */}
      <AbsoluteFill style={{ background: 'radial-gradient(120% 60% at 20% 0%, rgba(255,255,255,.22), transparent 60%)' }} />
    </AbsoluteFill>
  );
};

// ── Los 7 clientes (escenas del principio) ───────────────────────────────────────────
const Clientas = ({ f }: { f: number }) => {
  if (f >= E.whatsapp[0] + 10) return null;
  const sale = ent(f, E.whatsapp[0] - 2, 10);
  return (
    <div style={{ position: 'absolute', left: 0, right: 0, top: 700, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '56px 30px', padding: '0 40px', opacity: 1 - sale, transform: `translateY(${sale * -60}px)` }}>
      {CLIENTES.map((c, i) => {
        const p = ent(f, t(0, 1) + i * 4, 14);
        const pregunta = ent(f, t(1, 1) + i * 3, 10);
        const mensaje = ent(f, t(2, 1) + i * 3, 10);
        const falto = FALTARON.includes(i) ? ent(f, t(3, 1) + FALTARON.indexOf(i) * GOLPE, 12) : 0;
        return (
          <div key={c.n} style={{ width: 220, display: 'flex', flexDirection: 'column', alignItems: 'center', opacity: p, transform: `translateY(${(1 - p) * 40}px)` }}>
            <div style={{ position: 'relative', width: 196, height: 196 }}>
              <div style={{
                width: 196, height: 196, borderRadius: 98, background: falto > 0 ? `color-mix(in srgb, ${c.c} ${100 - falto * 70}%, #E8E4DC)` : c.c,
                display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: JAKARTA, fontWeight: 800, fontSize: 80, color: OSCURO,
                opacity: 1 - falto * 0.45, border: falto > 0 ? `4px dashed rgba(120,110,95,${falto})` : '4px solid transparent', boxSizing: 'border-box',
              }}>{c.n[0]}</div>
              {/* globito: primero "?", después el mensaje que le mandabas a mano */}
              {pregunta > 0 && (
                <div style={{
                  position: 'absolute', right: -6, top: -4, width: 68, height: 68, borderRadius: 34, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: mensaje > 0.5 ? '#25A35A' : '#FFFFFF', boxShadow: '0 6px 14px -4px rgba(0,0,0,.25)', transform: `scale(${pregunta})`,
                  fontFamily: JAKARTA, fontWeight: 800, fontSize: 38, color: '#8A8275',
                }}>
                  {mensaje > 0.5
                    ? <svg width="36" height="36" viewBox="0 0 24 24" fill="#fff"><path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Z" /></svg>
                    : '?'}
                </div>
              )}
            </div>
            <div style={{ marginTop: 16, fontFamily: JAKARTA, fontWeight: 700, fontSize: 40, color: OSCURO, opacity: 1 - falto * 0.5 }}>{c.n}</div>
            <div style={{ height: 40, fontFamily: JAKARTA, fontWeight: 700, fontSize: 32, color: '#C2412D', opacity: falto }}>no vino</div>
          </div>
        );
      })}
    </div>
  );
};

// ── El celular según la escena ───────────────────────────────────────────────────────
const Celulares = ({ f }: { f: number }) => {
  if (f < E.whatsapp[0]) return null;
  // Celular de la clienta: entra desde abajo y se va a la izquierda cuando aparece el de la dueña
  const entra = ent(f, E.whatsapp[0] + 4, 18);
  const vaSe = ent(f, E.aviso[0] - 2, 12);
  const llegaDuena = ent(f, E.aviso[0] + 2, 14);
  const vaSeDuena = ent(f, E.cierre[0] - 2, 14);
  return (
    <>
      {f < E.aviso[0] + 14 && (
        <div style={{ position: 'absolute', inset: 0, transform: `translate(${-vaSe * 1100}px, ${(1 - entra) * 1400}px) rotate(${-vaSe * 6}deg)` }}>
          <Telefono x={540} y={TEL_Y} escala={1.3}>
            <ChatWhatsApp f={f} mensaje={MENSAJE} escribe={t(4, 2)} llega={t(5, 0)} botones={t(5, 1)} toque={t(6, 1)} enviado={t(6, 2)} leido={t(6, 3)} />
          </Telefono>
        </div>
      )}
      {f >= E.aviso[0] && f < E.cierre[0] + 16 && (
        <div style={{ position: 'absolute', inset: 0, transform: `translate(${(1 - llegaDuena) * 1100}px, ${vaSeDuena * 1400}px) rotate(${(1 - llegaDuena) * 6}deg)` }}>
          <Telefono x={540} y={TEL_Y + 30} escala={1.22}>
            <Pantallas f={f} />
          </Telefono>
        </div>
      )}
    </>
  );
};

/** Lo que muestra el celular de la dueña: la agenda, el aviso, la lista confirmada y la configuración. */
const Pantallas = ({ f }: { f: number }) => {
  const lista = ent(f, E.agenda[0], 10);
  const conf = ent(f, E.solo[0], 10);
  const confirmados = agendaLista['Confirmó por WhatsApp'].filter((r) => r.y < 830);
  return (
    <>
      <Captura src="reel-agenda-pro/app/agenda-hoy.png" />
      <Notificacion f={f} a={t(7, 1)} hasta={t(8) - 8} titulo={AVISO.titulo} cuerpo={AVISO.cuerpo} />
      {f >= E.agenda[0] && (
        <div style={{ position: 'absolute', inset: 0, opacity: lista, isolation: 'isolate' }}>
          <Captura src="reel-agenda-pro/app/agenda-lista.png" />
          {confirmados.map((r, i) => <Resalte key={i} f={f} a={t(8, 1) + i * (GOLPE / 2)} r={r} />)}
        </div>
      )}
      {f >= E.solo[0] && (
        <div style={{ position: 'absolute', inset: 0, opacity: conf, isolation: 'isolate' }}>
          <Captura src="reel-agenda-pro/app/config-recordatorios.png" />
          <Resalte f={f} a={t(10, 1)} r={{ x: 16, y: 170, w: 358, h: 102 }} />
          <Resalte f={f} a={t(10, 2)} r={{ x: 33, y: 312, w: 324, h: 46 }} pad={4} />
          <Resalte f={f} a={t(11, 1)} r={{ x: config['Recordatorios de este mes'][0].x - 14, y: config['Recordatorios de este mes'][0].y - 14, w: 326, h: 64 }} pad={4} />
        </div>
      )}
    </>
  );
};

// ── Etiqueta que sale del celular ────────────────────────────────────────────────────
const Etiqueta = ({ f, a, hasta, txt, sub, top, right = 40 }: { f: number; a: number; hasta: number; txt: string; sub?: string; top: number; right?: number }) => {
  if (f < a || f >= hasta + 8) return null;
  const p = ent(f, a, 14) * (1 - ent(f, hasta, 8));
  return (
    <div style={{
      position: 'absolute', right, top, background: '#fff', borderRadius: 28, padding: '22px 28px', boxShadow: '0 24px 50px -18px rgba(11,40,30,.45)',
      opacity: p, transform: `translateY(${(1 - p) * 30}px) scale(${0.94 + p * 0.06})`, fontFamily: JAKARTA, zIndex: 6,
    }}>
      <div style={{ fontSize: 50, fontWeight: 800, color: VERDE, letterSpacing: '-0.03em', lineHeight: 1 }}>{txt}</div>
      {sub && <div style={{ fontSize: 24, fontWeight: 600, color: '#41524B', marginTop: 8 }}>{sub}</div>}
    </div>
  );
};

// ── Cierre ───────────────────────────────────────────────────────────────────────────
const Cierre = ({ f }: { f: number }) => {
  const a = E.cierre[0];
  const pieza = (d: number, contenido: React.ReactNode, estilo: React.CSSProperties = {}) => {
    const p = ent(f, a + d, 16);
    return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 40}px)`, ...estilo }}>{contenido}</div>;
  };
  return (
    <AbsoluteFill style={{ padding: '0 72px', justifyContent: 'center', fontFamily: JAKARTA, color: '#fff' }}>
      {pieza(2, <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
        <Img src={staticFile('ventra-logo.png')} style={{ width: 96, height: 96, borderRadius: 24, boxShadow: '0 0 0 3px rgba(255,255,255,.35)' }} />
        <span style={{ fontSize: 54, fontWeight: 800, letterSpacing: '-0.03em' }}>Ventra Agenda Pro</span>
      </div>)}
      {pieza(6, <div style={{ fontSize: 112, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.02, marginTop: 64 }}>Tus turnos,<br /><span style={{ color: MENTA }}>confirmados.</span></div>)}
      {pieza(12, <div style={{ fontSize: 36, fontWeight: 600, lineHeight: 1.4, marginTop: 44, color: 'rgba(255,255,255,.88)' }}>Recordatorios automáticos por WhatsApp.<br />200 por mes, sin hacer nada.</div>)}
      {pieza(18, <div style={{ display: 'flex', alignItems: 'center', gap: 26, marginTop: 64 }}>
        <span style={{ background: '#fff', color: VERDE, fontSize: 40, fontWeight: 800, padding: '26px 40px', borderRadius: 999, letterSpacing: '-0.01em' }}>Probalo gratis</span>
        <span style={{ fontSize: 40, fontWeight: 700 }}>ventra.store</span>
      </div>)}
      {pieza(24, <div style={{ fontSize: 30, fontWeight: 600, marginTop: 34, color: 'rgba(255,255,255,.75)' }}>$19.900 por mes · sin contrato</div>)}
    </AbsoluteFill>
  );
};

// ── Composición ──────────────────────────────────────────────────────────────────────
export const ReelAgendaPro = () => {
  const f = useCurrentFrame();
  const blanco = '#FFFFFF';
  return (
    <AbsoluteFill style={{ background: CREMA, fontFamily: INTER }}>
      <Audio src={staticFile('reel-agenda-pro/audio.wav')} />
      <Fondo f={f} />
      <Clientas f={f} />
      <Celulares f={f} />

      <Titular f={f} a={t(0, 0)} hasta={t(1) - 4} color={OSCURO} lineas={[['Mañana tenés'], [['7 turnos.', VERDE]]]} />
      <Titular f={f} a={t(1, 0)} hasta={t(2) - 4} color={OSCURO} lineas={[['¿Van a'], [['venir?', VERDE]]]} />
      <Titular f={f} a={t(2, 0)} hasta={t(3) - 4} color={OSCURO} lineas={[['Antes: un mensaje'], ['a cada cliente…']]} />
      <Titular f={f} a={t(3, 0)} hasta={t(4) - 4} color={OSCURO} lineas={[['…y a cruzar'], [['los dedos.', VERDE]]]} />
      <Titular f={f} a={t(4, 0) + 4} hasta={t(6) - 4} color={blanco} lineas={[['Ahora Ventra'], ['les escribe por'], [['WhatsApp.', MENTA]]]} />
      <Titular f={f} a={t(6, 0)} hasta={t(7) - 4} color={blanco} lineas={[['Confirman'], [['con un toque.', MENTA]]]} />
      <Titular f={f} a={t(7, 0) + 4} hasta={t(8) - 4} color={OSCURO} lineas={[['Y vos te enterás'], [['al instante.', VERDE]]]} />
      <Titular f={f} a={t(8, 0)} hasta={t(10) - 4} color={OSCURO} lineas={[['A la mañana,'], ['tu agenda ya'], [['confirmada.', VERDE]]]} />
      <Titular f={f} a={t(10, 0)} hasta={t(11) - 4} color={OSCURO} lineas={[['Sale solo,'], ['el día anterior'], [['a las 20 h.', VERDE]]]} />
      <Titular f={f} a={t(11, 0)} hasta={t(12) - 4} color={OSCURO} lineas={[[['200', VERDE], ' recordatorios'], ['por mes.']]} />

      <Etiqueta f={f} a={t(9, 1)} hasta={t(10) - 2} txt="6 de 7" sub="confirmaron por WhatsApp" top={1560} right={70} />
      {entre(f, E.cierre) && <Cierre f={f} />}
    </AbsoluteFill>
  );
};
