import type React from 'react';
import { AbsoluteFill, Easing, Img, continueRender, delayRender, interpolate, staticFile, useCurrentFrame } from 'remotion';
import { Audio } from '@remotion/media';
import { ESCENAS as E, TOTAL, t } from './guion';
import { BARRA, BarraEstado, CREMA, ent, ESC, INTER, JAKARTA, MENTA, OSCURO, PANT_W, Resalte, suave, Telefono, Titular, VERDE } from '../reel-agenda-pro/piezas';
import ficha from '../../public/reel-go/app/caja-prod-coca-4100.json';
import modal from '../../public/reel-go/app/caja-go-modal.json';

// Estilo "fintech cálido" (el de reel-agenda-pro): crema y verde Ventra, Plus Jakarta Sans y la app real
// en primer plano: la caja en un monitor (capturas de 1280x800) y GO en el celular (390 de ancho).

const espera = delayRender('fuentes');
Promise.all([
  new FontFace('Jakarta', `url(${staticFile('fuentes/plus-jakarta-sans-latin-wght-normal.woff2')})`, { weight: '200 800' }).load(),
  new FontFace('Jakarta', `url(${staticFile('fuentes/plus-jakarta-sans-latin-ext-wght-normal.woff2')})`, { weight: '200 800', unicodeRange: 'U+0100-024F, U+1E00-1EFF' }).load(),
  new FontFace('Inter', `url(${staticFile('inter.woff2')})`, { weight: '100 900' }).load(),
]).then((fs) => { fs.forEach((x) => document.fonts.add(x)); continueRender(espera); });

const entre = (f: number, [a, b]: readonly number[]) => f >= a && f < b;
const APP = (n: string) => `reel-go/app/${n}.png`;
type Rect = { x: number; y: number; w: number; h: number };

// ── Cámara del monitor: tramos [cuadro, zoom, foco x, foco y] en px de la caja (1280x800) ──
type Toma = [number, number, number, number];
const camara = (f: number, tomas: Toma[]) => {
  let [, z, x, y] = tomas[0];
  for (let i = 1; i < tomas.length; i++) {
    const [a, z2, x2, y2] = tomas[i];
    const p = suave(f, a, 16);
    z += (z2 - z) * p; x += (x2 - x) * p; y += (y2 - y) * p;
  }
  return { z, x, y };
};

// ── Monitor de la PC del kiosco ───────────────────────────────────────────────────────
const MON_W = 980, MON_H = 612, MARCO = 22;
const Monitor = ({ y, children }: { y: number; children: React.ReactNode }) => (
  <div style={{ position: 'absolute', left: 540 - MON_W / 2 - MARCO, top: y, width: MON_W + MARCO * 2 }}>
    <div style={{ background: '#15181B', borderRadius: 30, padding: MARCO, boxShadow: '0 0 0 2px #2B2F33, 0 50px 90px -30px rgba(11,40,30,.55)' }}>
      <div style={{ position: 'relative', width: MON_W, height: MON_H, borderRadius: 10, overflow: 'hidden', background: '#F7F8FA' }}>{children}</div>
    </div>
    {/* pie */}
    <div style={{ margin: '0 auto', width: 150, height: 90, background: 'linear-gradient(#2A2E33, #1C1F22)' }} />
    <div style={{ margin: '0 auto', width: 420, height: 22, borderRadius: '14px 14px 6px 6px', background: '#22262A', boxShadow: '0 20px 30px -16px rgba(0,0,0,.45)' }} />
  </div>
);

/** Una captura de la caja dentro del monitor, con su cámara; los hijos van en px de la caja. */
const PantallaPC = ({ src, cam, opacidad = 1, children }: { src: string; cam: { z: number; x: number; y: number }; opacidad?: number; children?: React.ReactNode }) => {
  const k = (MON_W / 1280) * cam.z;
  const left = Math.min(0, Math.max(MON_W - 1280 * k, MON_W / 2 - cam.x * k));
  const top = Math.min(0, Math.max(MON_H - 800 * k, MON_H / 2 - cam.y * k));
  return (
    <div style={{ position: 'absolute', left, top, width: 1280, height: 800, transform: `scale(${k})`, transformOrigin: '0 0', opacity: opacidad }}>
      <Img src={staticFile(src)} style={{ width: 1280, height: 800 }} />
      {children}
    </div>
  );
};

/** Resalta una zona de la caja (px de la caja). */
const ResaltePC = ({ f, a, r, pad = 5, hasta }: { f: number; a: number; r: Rect; pad?: number; hasta?: number }) => {
  if (f < a || (hasta != null && f >= hasta + 8)) return null;
  const p = ent(f, a, 12) * (hasta != null ? 1 - ent(f, hasta, 8) : 1);
  const pulso = 1 + 0.05 * Math.max(0, 1 - (f - a) / 10);
  return (
    <div style={{
      position: 'absolute', left: r.x - pad, top: r.y - pad, width: r.w + pad * 2, height: r.h + pad * 2, borderRadius: 10,
      border: `3px solid ${VERDE}`, background: 'rgba(127,227,184,.16)', opacity: p, transform: `scale(${(0.92 + p * 0.08) * pulso})`,
      boxShadow: '0 6px 18px -6px rgba(19,107,87,.5)',
    }} />
  );
};

/** Toque de un dedo: una onda que se abre desde el punto (en las coordenadas de quien la contiene). */
const Toque = ({ f, a, x, y, r = 22 }: { f: number; a: number; x: number; y: number; r?: number }) => {
  if (f < a - 3 || f >= a + 14) return null;
  const k = (f - (a - 3)) / 17;
  return <div style={{ position: 'absolute', left: x - r, top: y - r, width: r * 2, height: r * 2, borderRadius: r, background: 'rgba(17,27,33,.2)', border: '2px solid rgba(17,27,33,.3)', transform: `scale(${0.6 + k * 1.1})`, opacity: 1 - k }} />;
};

/** Captura de GO en el celular, debajo de la barra de estado. */
const CapturaGO = ({ src, opacidad = 1 }: { src: string; opacidad?: number }) => (
  <div style={{ position: 'absolute', inset: 0, opacity: opacidad }}>
    <BarraEstado fondo="#0B0B0B" hora="21:14" />
    <Img src={staticFile(src)} style={{ position: 'absolute', left: 0, top: BARRA, width: PANT_W, height: PANT_W * (2532 / 1170) }} />
  </div>
);

// ── Fondo: crema; el verde entra como un círculo cuando aparece GO y en el cierre ─────
const Fondo = ({ f }: { f: number }) => {
  const circulo = (a: number, color: string, cx = 540, cy = 1500) => {
    const p = suave(f, a, 14);
    return p > 0 ? <AbsoluteFill style={{ background: color, clipPath: `circle(${p * 2300}px at ${cx}px ${cy}px)` }} /> : null;
  };
  return (
    <AbsoluteFill style={{ background: CREMA }}>
      {f < E.aviso[0] + 16 && circulo(E.go[0], VERDE, 900, 1300)}
      {f >= E.aviso[0] && f < E.cierre[0] + 16 && circulo(E.aviso[0], CREMA, 200, 900)}
      {f >= E.cierre[0] && circulo(E.cierre[0], VERDE, 540, 1900)}
      <AbsoluteFill style={{ background: 'radial-gradient(120% 60% at 20% 0%, rgba(255,255,255,.22), transparent 60%)' }} />
    </AbsoluteFill>
  );
};

// ── La caja (monitor): la ficha de la Coca y, después, el pedido de GO ───────────────
const MON_Y = 660;
const precio = { x: ficha['Precio de venta final'][0].x, y: ficha['Precio de venta final'][0].y + 26, w: 226, h: 46 };
const guardar = ficha['Guardar cambios'][0];
const cobrar = modal['Cobrar en la caja'][0];
const filaCocaModal = { ...modal['COCA-COLA 2,25'][1], x: 396, w: 492, h: 32, y: modal['COCA-COLA 2,25'][1].y - 6 };
const BOTON_GO = { x: 672, y: 16, w: 96, h: 40 };
const FILA_COCA_TICKET = { x: 800, y: 226, w: 448, h: 40 };
const TOTAL_TICKET = { x: 1080, y: 632, w: 158, h: 52 };

const Caja = ({ f }: { f: number }) => {
  const vaSe = ent(f, E.go[0] - 2, 14, Easing.in(Easing.cubic));
  const vuelve = ent(f, E.aviso[0] + 2, 16);
  const vaSeFin = ent(f, E.cierre[0] - 2, 14);
  if (f >= E.go[0] + 14 && f < E.aviso[0]) return null;
  if (f >= E.cierre[0] + 16) return null;
  const primera = f < E.aviso[0];
  const dx = primera ? -vaSe * 1200 : (1 - vuelve) * -1200;
  const rot = primera ? -vaSe * 5 : -(1 - vuelve) * 5;
  return (
    <div style={{ position: 'absolute', inset: 0, transform: `translate(${dx}px, ${vaSeFin * 1300}px) rotate(${rot}deg)` }}>
      <Monitor y={MON_Y}>{primera ? <Ficha f={f} /> : <PedidoEnCaja f={f} />}</Monitor>
    </div>
  );
};

/** Ficha de la Coca: el precio pasa de $3.800 a $4.100 y se guarda. */
const Ficha = ({ f }: { f: number }) => {
  const cam = camara(f, [[0, 1, 640, 400], [t(0, 2), 1.18, 600, 420], [t(1), 2.3, 600, 370], [t(2, 1) - 4, 2.0, 1060, 640]]);
  const nuevo = ent(f, t(1, 2), 6);
  return (
    <PantallaPC src={APP('caja-prod-coca')} cam={cam}>
      <Img src={staticFile(APP('caja-prod-coca-4100'))} style={{ position: 'absolute', inset: 0, width: 1280, height: 800, opacity: nuevo }} />
      <ResaltePC f={f} a={t(1, 2) + 4} hasta={t(2, 1)} r={precio} />
      <ResaltePC f={f} a={t(2, 2)} r={guardar} />
      <Toque f={f} a={t(2, 2)} x={guardar.x + guardar.w / 2} y={guardar.y + guardar.h / 2} r={26} />
    </PantallaPC>
  );
};

/** La caja cuando entra el pedido de GO: el botón, "Pedidos de GO" y el ticket cargado. */
const PedidoEnCaja = ({ f }: { f: number }) => {
  const cam = camara(f, [[0, 2.4, 720, 60], [t(8) - 6, 1.95, 640, 470], [t(9) - 4, 1.9, 1030, 330], [t(10) - 2, 1.9, 1060, 600], [t(11), 1, 640, 400]]);
  const conModal = ent(f, t(8) - 4, 8);
  const cobrado = ent(f, t(9) - 4, 8);
  const onda = f >= t(7, 1) && f < t(8) ? ((f - t(7, 1)) % 24) / 24 : -1;
  return (
    <PantallaPC src={APP('caja-pos')} cam={cam}>
      {onda >= 0 && (
        <div style={{ position: 'absolute', left: BOTON_GO.x, top: BOTON_GO.y, width: BOTON_GO.w, height: BOTON_GO.h, borderRadius: 12, border: '3px solid #e11d48', transform: `scale(${1 + onda * 0.5})`, opacity: 1 - onda }} />
      )}
      <Img src={staticFile(APP('caja-go-modal'))} style={{ position: 'absolute', inset: 0, width: 1280, height: 800, opacity: conModal }} />
      {conModal > 0.5 && cobrado < 0.5 && (
        <>
          <ResaltePC f={f} a={t(8, 1)} hasta={t(8, 3)} r={filaCocaModal} pad={3} />
          <ResaltePC f={f} a={t(8, 3)} r={cobrar} />
          <Toque f={f} a={t(8, 3) + 6} x={cobrar.x + cobrar.w / 2} y={cobrar.y + cobrar.h / 2} r={24} />
        </>
      )}
      <Img src={staticFile(APP('caja-go-cobrar'))} style={{ position: 'absolute', inset: 0, width: 1280, height: 800, opacity: cobrado }} />
      {cobrado > 0.5 && (
        <>
          <ResaltePC f={f} a={t(9, 1)} hasta={t(10) - 4} r={FILA_COCA_TICKET} pad={3} />
          <ResaltePC f={f} a={t(10, 1)} hasta={t(11) - 4} r={TOTAL_TICKET} pad={3} />
        </>
      )}
    </PantallaPC>
  );
};

// ── El celular con GO: la tienda del kiosco ─────────────────────────────────────────
const TEL_Y = 540;
const PRECIO_GO: Rect = { x: 14, y: 586, w: 70, h: 24 };
const MAS_COCA = { x: 162, y: 556 }, MAS_AGUA = { x: 348, y: 556 };
const CARRITO: Rect = { x: 311, y: 762, w: 58, h: 57 };

const Celular = ({ f }: { f: number }) => {
  if (f < E.go[0] || f >= E.aviso[0] + 14) return null;
  const entra = ent(f, E.go[0] + 4, 18);
  const vaSe = ent(f, E.aviso[0] - 2, 14, Easing.in(Easing.cubic));
  const sube = suave(f, E.pedido[0], 18) * 230; // para que se vea el carrito
  const nuevo = ent(f, t(4), 6);
  const cat = ent(f, E.catalogo[0], 8);
  const ped = ent(f, E.pedido[0], 8);
  return (
    <div style={{ position: 'absolute', inset: 0, transform: `translate(${vaSe * 1200}px, ${(1 - entra) * 1400 - sube}px) rotate(${vaSe * 6}deg)` }}>
      <Telefono x={540} y={TEL_Y} escala={1.18}>
        <CapturaGO src={APP('go-bebidas-3800')} />
        <CapturaGO src={APP('go-bebidas-4100')} opacidad={nuevo} />
        {cat < 1 && <Resalte f={f} a={t(4) + 3} r={PRECIO_GO} />}
        {f >= E.catalogo[0] && <CapturaGO src={APP('go-inicio')} opacidad={cat} />}
        {f >= E.pedido[0] && (
          <div style={{ position: 'absolute', inset: 0, opacity: ped, isolation: 'isolate' }}>
            <CapturaGO src={APP('go-bebidas-4100')} />
            <CapturaGO src={APP('go-bebidas-carrito')} opacidad={ent(f, t(6, 1) + 2, 4)} />
            <div style={{ position: 'absolute', left: 0, top: BARRA, width: 390, height: 900, transform: `scale(${ESC})`, transformOrigin: '0 0' }}>
              <Toque f={f} a={t(6, 1)} x={MAS_COCA.x} y={MAS_COCA.y} r={18} />
              <Toque f={f} a={t(6, 2)} x={MAS_AGUA.x} y={MAS_AGUA.y} r={18} />
            </div>
            <Resalte f={f} a={t(6, 3)} r={CARRITO} pad={4} />
          </div>
        )}
      </Telefono>
    </div>
  );
};

// ── Etiqueta que sale de la pantalla ─────────────────────────────────────────────────
const Etiqueta = ({ f, a, hasta, txt, sub, top, right = 60 }: { f: number; a: number; hasta: number; txt: string; sub?: string; top: number; right?: number }) => {
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
        <span style={{ fontSize: 54, fontWeight: 800, color: MENTA }}>+</span>
        <Img src={staticFile('reel-go/go-logo.png')} style={{ width: 96, height: 96, borderRadius: 48, boxShadow: '0 0 0 3px rgba(255,255,255,.35)' }} />
      </div>)}
      {pieza(6, <div style={{ fontSize: 108, fontWeight: 800, letterSpacing: '-0.04em', lineHeight: 1.02, marginTop: 60 }}>Tu kiosco en GO,<br /><span style={{ color: MENTA }}>con los precios<br />de tu caja.</span></div>)}
      {pieza(12, <div style={{ fontSize: 34, fontWeight: 600, lineHeight: 1.42, marginTop: 44, color: 'rgba(255,255,255,.88)' }}>GO es la app de delivery de Magdalena.<br />Con Ventra Full, los precios y las fotos<br />se actualizan solos.</div>)}
      {pieza(18, <div style={{ display: 'flex', alignItems: 'center', gap: 26, marginTop: 60 }}>
        <span style={{ background: '#fff', color: VERDE, fontSize: 40, fontWeight: 800, padding: '26px 40px', borderRadius: 999, letterSpacing: '-0.01em' }}>Probalo gratis</span>
        <span style={{ fontSize: 40, fontWeight: 700 }}>ventra.store</span>
      </div>)}
      {pieza(24, <div style={{ fontSize: 30, fontWeight: 600, marginTop: 34, color: 'rgba(255,255,255,.75)' }}>Ventra Full $24.900 por mes · sin contrato</div>)}
    </AbsoluteFill>
  );
};

// ── Composición ──────────────────────────────────────────────────────────────────────
export const ReelGo = () => {
  const f = useCurrentFrame();
  const blanco = '#FFFFFF';
  return (
    <AbsoluteFill style={{ background: CREMA, fontFamily: INTER }}>
      <Audio src={staticFile('reel-go/audio.wav')} />
      <Fondo f={f} />
      <Caja f={f} />
      <Celular f={f} />

      <Titular f={f} a={t(0, 0)} hasta={t(1) - 4} color={OSCURO} lineas={[['Lunes, 8:40.'], [['Subió la Coca.', VERDE]]]} />
      <Titular f={f} a={t(1, 0)} hasta={t(3) - 4} color={OSCURO} lineas={[['La cambiás'], [['en la caja…', VERDE]]]} />
      <Titular f={f} a={t(3, 0) + 4} hasta={t(5) - 4} color={blanco} lineas={[['…y en GO'], [['ya está.', MENTA]]]} />
      <Titular f={f} a={t(5, 0)} hasta={t(6) - 4} color={blanco} lineas={[['Todo tu kiosco,'], [['con fotos.', MENTA]]]} />
      <Titular f={f} a={t(6, 0)} hasta={t(7) - 4} color={blanco} lineas={[['Un vecino ', ['pide.', MENTA]]]} />
      <Titular f={f} a={t(7, 0) + 4} hasta={t(8) - 4} color={OSCURO} lineas={[['En la caja,'], [['entra el pedido.', VERDE]]]} />
      <Titular f={f} a={t(8, 0)} hasta={t(9) - 4} color={OSCURO} lineas={[['El repartidor'], [['lo compra acá…', VERDE]]]} />
      <Titular f={f} a={t(9, 0)} hasta={t(11) - 4} color={OSCURO} tam={86} lineas={[['…y paga como'], [['cualquier cliente.', VERDE]]]} />
      <Titular f={f} a={t(11, 0)} hasta={t(12) - 4} color={OSCURO} lineas={[['Un solo precio.'], [['En la caja y en GO.', VERDE]]]} />

      <Etiqueta f={f} a={t(1, 3)} hasta={t(3) - 2} txt="$3.800 → $4.100" sub="Coca-Cola 2,25 L" top={1500} right={64} />
      <Etiqueta f={f} a={t(7, 2)} hasta={t(8) - 2} txt="Pedido #15" sub="Coca-Cola 2,25 L y agua · $5.700" top={1500} right={64} />
      <Etiqueta f={f} a={t(4, 1)} hasta={t(5) - 2} txt="$4.100" sub="se actualizó solo" top={1500} right={64} />
      <Etiqueta f={f} a={t(10, 1)} hasta={t(11) - 2} txt="$4.100" sub="el precio nuevo, también acá" top={1520} right={64} />
      {entre(f, [E.cierre[0], TOTAL]) && <Cierre f={f} />}
    </AbsoluteFill>
  );
};
