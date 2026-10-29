import { AbsoluteFill, Easing, Img, continueRender, delayRender, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { Audio } from '@remotion/media';
import { verde } from '../marca';
import guion from './guion.json';

// "23:47": el celular de Martina, peluquera. Todo vive dentro de la escena (notificaciones,
// la pantalla de la app); los carteles son pocos, grandes y a la izquierda. Ver .claude/skills/ventra-video.

const E = guion.escenas;
const CREMA = '#F7F3EC';

// Fuentes antes del primer cuadro: si no, los primeros cuadros salen con la fuente del sistema
const espera = delayRender('fuentes');
Promise.all([
  new FontFace('Bricolage', `url(${staticFile('bricolage.woff2')})`, { weight: '200 800' }).load(),
  new FontFace('Inter', `url(${staticFile('inter.woff2')})`, { weight: '100 900' }).load(),
]).then((fs) => { fs.forEach((f) => document.fonts.add(f)); continueRender(espera); });

const sale = Easing.out(Easing.cubic);
/** 0 → 1 entre el cuadro `a` y `a + d`, con salida suave (sin rebote). */
const ent = (f: number, a: number, d = 8, curva = sale) =>
  interpolate(f, [a, a + d], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: curva });
const entre = (f: number, [a, b]: number[]) => f >= a && f < b;

// ── Cámara en mano: suma de senos lentos + vibración del celular ──────────────
const deriva = (f: number) => ({
  x: 5 * Math.sin(f / 37) + 2.5 * Math.sin(f / 11.3),
  y: 4 * Math.sin(f / 29 + 1) + 2 * Math.sin(f / 8.7),
  r: 0.35 * Math.sin(f / 47) + 0.15 * Math.sin(f / 17),
});
const vibracion = (f: number) => {
  let x = 0;
  for (const n of guion.caos) {
    const t = f - n.f;
    if (t >= 0 && t < 10) x += Math.sin(t * 2.9) * 9 * (1 - t / 10);
  }
  return x;
};

// ── Íconos ───────────────────────────────────────────────────────────────────
const IconoChat = () => (
  <div style={{ width: 66, height: 66, borderRadius: 16, background: '#25A35A', display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>
    <svg width="38" height="38" viewBox="0 0 24 24" fill="#fff"><path d="M12 3a9 9 0 0 0-7.8 13.5L3 21l4.6-1.2A9 9 0 1 0 12 3Z" /></svg>
  </div>
);
const IconoVentra = () => <Img src={staticFile('ventra-logo.png')} style={{ width: 66, height: 66, borderRadius: 16, flex: 'none' }} />;
const Microfono = () => (
  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" style={{ marginRight: 8, verticalAlign: '-4px' }}>
    <rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

// ── Notificación de la pantalla bloqueada ────────────────────────────────────
const ALTO = 158, PASO = 172, TOPE = 560, VISIBLES = 6;

const Tarjeta = ({ icono, app, titulo, txt, voz, y, op, claro }: {
  icono: React.ReactNode; app: string; titulo: string; txt: string; voz?: boolean; y: number; op: number; claro?: boolean;
}) => (
  <div style={{
    position: 'absolute', left: 30, right: 30, top: 0, height: ALTO, transform: `translateY(${y}px)`, opacity: op,
    borderRadius: 36, padding: '22px 26px', display: 'flex', gap: 22, alignItems: 'center',
    background: claro ? 'rgba(255,255,255,.78)' : 'rgba(38,40,48,.74)', backdropFilter: 'blur(24px)',
    color: claro ? '#16241F' : '#fff', fontFamily: 'Inter',
  }}>
    {icono}
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 23, fontWeight: 500, opacity: 0.6, letterSpacing: '.02em' }}>
        <span>{app}</span><span>ahora</span>
      </div>
      <div style={{ fontSize: 31, fontWeight: 650, marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{titulo}</div>
      <div style={{ fontSize: 29, marginTop: 2, opacity: 0.88, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {voz && <Microfono />}{txt}
      </div>
    </div>
  </div>
);

/** Pila de notificaciones: la nueva entra arriba y empuja a las demás. */
const Pila = <T extends { f: number }>({ f, items, render }: { f: number; items: T[]; render: (n: T, y: number, op: number) => React.ReactNode }) => {
  const llegadas = items.filter((n) => n.f <= f);
  const ocultas = Math.max(0, llegadas.length - VISIBLES);
  return (
    <>
      {llegadas.map((n, i) => {
        const p = ent(f, n.f, 7);
        // Cuántos lugares bajó: una posición por cada notificación posterior que ya entró
        const baja = llegadas.slice(i + 1).reduce((s, m) => s + ent(f, m.f, 7), 0);
        const op = p * Math.max(0, Math.min(1, VISIBLES - 0.4 - baja));
        if (op <= 0.01) return null;
        return <div key={i}>{render(n, TOPE + baja * PASO - (1 - p) * 34, op)}</div>;
      })}
      {ocultas > 0 && (
        <div style={{ position: 'absolute', left: 0, right: 0, top: TOPE + VISIBLES * PASO - 4, textAlign: 'center', fontFamily: 'Inter', fontSize: 25, fontWeight: 600, color: 'rgba(255,255,255,.7)' }}>
          + {ocultas} {ocultas === 1 ? 'notificación' : 'notificaciones'}
        </div>
      )}
    </>
  );
};

// ── Pantallas ────────────────────────────────────────────────────────────────
const reloj = (f: number) => [...guion.relojNoche].reverse().find(([d]) => f >= (d as number))![1] as string;

const Bloqueo = ({ hora, fecha, fondo, bateria, children, oscuro = true }: {
  hora: string; fecha: string; fondo: string; bateria: number; children?: React.ReactNode; oscuro?: boolean;
}) => (
  <AbsoluteFill style={{ background: fondo, color: oscuro ? '#fff' : '#16241F' }}>
    <div style={{ position: 'absolute', top: 34, left: 60, right: 52, display: 'flex', justifyContent: 'space-between', fontFamily: 'Inter', fontSize: 26, fontWeight: 600, opacity: 0.9 }}>
      <span>Personal</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {bateria}%
        <span style={{ width: 48, height: 24, borderRadius: 7, border: '2.5px solid currentColor', padding: 2.5, opacity: 0.9 }}>
          <span style={{ display: 'block', height: '100%', width: `${bateria}%`, borderRadius: 3, background: bateria < 15 ? '#FF6B5A' : 'currentColor' }} />
        </span>
      </span>
    </div>
    <div style={{ position: 'absolute', top: 150, left: 0, right: 0, textAlign: 'center' }}>
      <div style={{ fontFamily: 'Inter', fontSize: 36, fontWeight: 500, opacity: 0.85 }}>{fecha}</div>
      <div style={{ fontFamily: 'Bricolage', fontSize: 236, fontWeight: 600, letterSpacing: '-.04em', lineHeight: 1, marginTop: 6 }}>{hora}</div>
    </div>
    {children}
    <div style={{ position: 'absolute', bottom: 22, left: '50%', width: 270, height: 10, marginLeft: -135, borderRadius: 9, background: 'currentColor', opacity: 0.8 }} />
  </AbsoluteFill>
);

const FONDO_NOCHE = 'radial-gradient(120% 70% at 30% 20%, #2A2F55 0%, #12142A 45%, #07080F 100%)';
const FONDO_MANANA = 'radial-gradient(120% 80% at 80% 0%, #FFE3BF 0%, #F4C9A4 40%, #C9D8D2 100%)';

const PantallaNoche = ({ f }: { f: number }) => {
  const bat = Math.round(interpolate(f, [0, 330], [23, 9], { extrapolateRight: 'clamp' }));
  return (
    <Bloqueo hora={reloj(f)} fecha="miércoles 8 de octubre" fondo={FONDO_NOCHE} bateria={bat}>
      <Pila f={f} items={guion.caos} render={(n, y, op) => <Tarjeta icono={<IconoChat />} app="WHATSAPP" titulo={n.de} txt={n.txt} voz={'voz' in n} y={y} op={op} />} />
    </Bloqueo>
  );
};

const PantallaCalma = ({ f }: { f: number }) => (
  <Bloqueo hora="23:47" fecha="miércoles 8 de octubre" fondo={FONDO_NOCHE} bateria={64}>
    <Pila f={f} items={guion.calma} render={(n, y, op) => <Tarjeta icono={<IconoVentra />} app="VENTRA AGENDA" titulo={n.titulo} txt={n.txt} y={y} op={op} />} />
  </Bloqueo>
);

const AgendaApp = ({ f, desde }: { f: number; desde: number }) => {
  const confirmados = guion.agendaHoy.filter((t) => t.ok).length;
  return (
    <AbsoluteFill style={{ background: '#FBFAF7', fontFamily: 'Inter', color: '#16241F' }}>
      <div style={{ padding: '120px 54px 0' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <IconoVentra />
          <span style={{ fontSize: 28, fontWeight: 600, color: verde.base }}>Ventra Agenda</span>
        </div>
        <div style={{ fontFamily: 'Bricolage', fontSize: 96, fontWeight: 800, letterSpacing: '-.04em', marginTop: 34, lineHeight: 1 }}>Hoy</div>
        <div style={{ fontSize: 32, color: '#55645E', marginTop: 8 }}>jueves 9 de octubre</div>
        <div style={{ display: 'inline-flex', marginTop: 26, padding: '12px 22px', borderRadius: 999, background: '#E7F6EE', color: verde.oscuro, fontSize: 27, fontWeight: 600 }}>
          {guion.agendaHoy.length} turnos · {confirmados} confirmaron por WhatsApp
        </div>
      </div>
      <div style={{ position: 'absolute', top: 520, left: 40, right: 40 }}>
        {guion.agendaHoy.map((t, i) => {
          const p = ent(f, desde + 4 + i * 3, 9);
          return (
            <div key={t.h} style={{
              display: 'flex', alignItems: 'center', gap: 26, height: 128, padding: '0 22px', borderBottom: '2px solid #ECE7DE',
              opacity: p, transform: `translateY(${(1 - p) * 26}px)`,
            }}>
              <span style={{ width: 104, fontSize: 31, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{t.h}</span>
              <span style={{ width: 5, alignSelf: 'stretch', margin: '24px 0', borderRadius: 3, background: t.ok ? verde.base : '#C9C2B6' }} />
              <span style={{ flex: 1 }}>
                <span style={{ display: 'block', fontSize: 32, fontWeight: 650 }}>{t.n}</span>
                <span style={{ display: 'block', fontSize: 26, color: '#6B776F', marginTop: 2 }}>{t.s}</span>
              </span>
              <span style={{
                fontSize: 24, fontWeight: 600, padding: '9px 18px', borderRadius: 999,
                background: t.ok ? '#E7F6EE' : '#F1EDE6', color: t.ok ? verde.base : '#7A7368',
              }}>{t.ok ? 'Confirmó' : 'Sin confirmar'}</span>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

const PantallaManana = ({ f }: { f: number }) => {
  const destrabe = 676;
  const sube = ent(f, destrabe, 12, Easing.inOut(Easing.cubic));
  const aviso = { f: 652, titulo: 'Hoy tenés 9 turnos', txt: '8 clientas confirmaron por WhatsApp.' };
  return (
    <AbsoluteFill>
      <AgendaApp f={f} desde={destrabe} />
      <AbsoluteFill style={{ transform: `translateY(${-sube * 100}%)` }}>
        <Bloqueo hora="08:00" fecha="jueves 9 de octubre" fondo={FONDO_MANANA} bateria={100} oscuro={false}>
          <Pila f={f} items={[aviso]} render={(n, y, op) => <Tarjeta claro icono={<IconoVentra />} app="VENTRA AGENDA" titulo={n.titulo} txt={n.txt} y={y} op={op} />} />
        </Bloqueo>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── El celular en la escena ──────────────────────────────────────────────────
const PANT_W = 860, PANT_H = 1800, MARCO = 20;

const Celular = ({ f, children }: { f: number; children: React.ReactNode }) => {
  const d = deriva(f);
  let escala = 1, ty = 40;
  if (entre(f, E.noche)) {
    escala = interpolate(f, E.noche, [1.0, 1.1]);
    // Al final de la noche la mano se pone nerviosa
    const nervio = ent(f, 270, 60);
    d.x *= 1 + nervio * 1.5; d.r *= 1 + nervio * 2;
  } else if (f >= E.calma[0] && f < E.cierre[0] + 30) {
    escala = interpolate(f, [E.calma[0], E.manana[1]], [0.8, 0.85]);
    ty = 340 + ent(f, E.cierre[0], 22, Easing.in(Easing.cubic)) * 1500;
  }
  const vib = vibracion(f);
  return (
    <div style={{
      position: 'absolute', left: (1080 - PANT_W) / 2 - MARCO, top: (1920 - PANT_H) / 2 - MARCO,
      width: PANT_W + MARCO * 2, height: PANT_H + MARCO * 2, borderRadius: 120, background: '#0C0D10', padding: MARCO,
      boxShadow: '0 0 0 3px #2A2C31, 0 60px 120px rgba(0,0,0,.55)',
      transform: `translate(${d.x + vib}px, ${d.y + ty}px) rotate(${d.r + vib * 0.08}deg) scale(${escala})`,
    }}>
      <div style={{ position: 'relative', width: PANT_W, height: PANT_H, borderRadius: 100, overflow: 'hidden' }}>
        {children}
        <div style={{ position: 'absolute', top: 26, left: '50%', width: 230, height: 66, marginLeft: -115, borderRadius: 40, background: '#000' }} />
      </div>
    </div>
  );
};

// ── Carteles grandes, a la izquierda ─────────────────────────────────────────
const Cartel = ({ f, a, txt, color, top = 150 }: { f: number; a: number; txt: string; color: string; top?: number }) => {
  const p = ent(f, a, 10);
  return (
    <div style={{
      position: 'absolute', left: 80, right: 60, top, fontFamily: 'Bricolage', fontSize: 118, fontWeight: 800,
      letterSpacing: '-.045em', lineHeight: 0.98, color, opacity: p, transform: `translateY(${(1 - p) * 24}px)`,
    }}>{txt}</div>
  );
};

const Carteles = ({ f }: { f: number }) => {
  const c = guion.carteles.find((x) => f >= x.f && f < x.hasta);
  if (!c) return null;
  const manana = c.f >= E.manana[0];
  return (
    <>
      <Cartel f={f} a={c.f} txt={c.txt} color={manana ? verde.oscuro : '#fff'} />
      {'sigue' in c && c.sigue && f >= c.sigue.f && <Cartel f={f} a={c.sigue.f} txt={c.sigue.txt} color={verde.base} top={270} />}
    </>
  );
};

// ── Fondo de la habitación: la luz sale de la pantalla (o de la ventana) ─────
const Habitacion = ({ f }: { f: number }) => {
  const amanece = ent(f, E.manana[0], 24, Easing.inOut(Easing.cubic));
  // La pantalla ilumina más cuando entra un mensaje
  const destello = guion.caos.reduce((s, n) => s + Math.max(0, 1 - Math.abs(f - n.f - 2) / 8), 0);
  const luz = entre(f, E.noche) ? 0.16 + Math.min(destello, 1.4) * 0.08 : 0.12;
  const tono = f >= E.calma[0] ? '127,227,184' : '150,170,255';
  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ background: '#06070B' }} />
      <AbsoluteFill style={{ background: `radial-gradient(60% 45% at 50% 55%, rgba(${tono},${luz}) 0%, transparent 70%)` }} />
      <AbsoluteFill style={{ opacity: amanece, background: `radial-gradient(90% 60% at 85% 0%, #FFE6C4 0%, ${CREMA} 55%, #EFE8DC 100%)` }} />
    </AbsoluteFill>
  );
};

const Grano = ({ f, fuerza }: { f: number; fuerza: number }) => (
  <AbsoluteFill style={{ pointerEvents: 'none', mixBlendMode: 'overlay', opacity: fuerza }}>
    <svg width="1080" height="1920">
      <filter id="g"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed={f % 97} /><feColorMatrix type="saturate" values="0" /></filter>
      <rect width="1080" height="1920" filter="url(#g)" />
    </svg>
  </AbsoluteFill>
);

const Vineta = ({ claro }: { claro: boolean }) => (
  <AbsoluteFill style={{ pointerEvents: 'none', background: `radial-gradient(75% 60% at 50% 50%, transparent 55%, rgba(${claro ? '60,40,20,.18' : '0,0,0,.55'}) 100%)` }} />
);

// ── Cierre ───────────────────────────────────────────────────────────────────
const Cierre = ({ f }: { f: number }) => {
  const a = E.cierre[0];
  const linea = (d: number, extra: React.CSSProperties, txt: React.ReactNode) => {
    const p = ent(f, a + d, 10);
    return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 22}px)`, ...extra }}>{txt}</div>;
  };
  return (
    <AbsoluteFill style={{ padding: '0 80px', justifyContent: 'center', color: verde.oscuro }}>
      {linea(8, { display: 'flex', alignItems: 'center', gap: 22 }, <>
        <Img src={staticFile('ventra-logo.png')} style={{ width: 92, height: 92, borderRadius: 22 }} />
        <span style={{ fontFamily: 'Bricolage', fontSize: 64, fontWeight: 800, letterSpacing: '-.03em' }}>Ventra Agenda</span>
      </>)}
      {linea(20, { fontFamily: 'Bricolage', fontSize: 120, fontWeight: 800, letterSpacing: '-.045em', lineHeight: 0.98, marginTop: 70 }, 'Que reserven a las 23:47.')}
      {linea(40, { fontFamily: 'Bricolage', fontSize: 120, fontWeight: 800, letterSpacing: '-.045em', lineHeight: 0.98, marginTop: 14, color: verde.base }, 'Vos, a dormir.')}
      {linea(60, { fontFamily: 'Inter', fontSize: 36, lineHeight: 1.45, marginTop: 64, color: '#3E4D47' }, <>Tu página de turnos, recordatorios por WhatsApp<br />y seña con Mercado Pago.</>)}
      {linea(76, { display: 'flex', alignItems: 'center', gap: 28, marginTop: 64 }, <>
        <span style={{ fontFamily: 'Inter', fontSize: 40, fontWeight: 700, background: verde.base, color: '#fff', padding: '24px 38px', borderRadius: 999 }}>Probalo gratis en ventra.store</span>
      </>)}
      {linea(84, { fontFamily: 'Inter', fontSize: 32, marginTop: 30, color: '#55645E' }, 'Desde $9.900 por mes.')}
    </AbsoluteFill>
  );
};

// ── Composición ──────────────────────────────────────────────────────────────
export const Reel2347 = () => {
  const f = useCurrentFrame();
  const claro = f >= E.manana[0] + 12;
  let pantalla: React.ReactNode = null;
  if (entre(f, E.noche)) pantalla = <PantallaNoche f={f} />;
  else if (entre(f, E.calma)) pantalla = <PantallaCalma f={f} />;
  else if (f >= E.manana[0] && f < E.cierre[0] + 30) pantalla = <PantallaManana f={f} />;

  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Audio src={staticFile('reel-2347/audio.wav')} />
      {!entre(f, E.negro) && (
        <>
          <Habitacion f={f} />
          {pantalla && <Celular f={f}>{pantalla}</Celular>}
          <Carteles f={f} />
          {f >= E.cierre[0] && <Cierre f={f} />}
          <Vineta claro={claro} />
        </>
      )}
      {entre(f, E.negro) && f >= guion.negro.f && (
        <Cartel f={f} a={guion.negro.f} txt={guion.negro.txt} color="#fff" top={860} />
      )}
      <Grano f={f} fuerza={claro ? 0.12 : 0.18} />
    </AbsoluteFill>
  );
};
