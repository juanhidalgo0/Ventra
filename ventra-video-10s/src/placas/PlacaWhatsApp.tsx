import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';
import { c, inter } from '../marca';
import { Camara, Fondo, Telefono, Titular, entra, lineal, type Largo, type Toma } from '../comunes';
import { LogoV } from './Logo';

// Placa 3: el dueño le habla a Ventra por WhatsApp (graba un audio) y le contesta con sus números.
// Arriba queda una pregunta escrita de ayer: se puede escribir o mandar audios (la web: "Escribile o
// mandale un audio"). El chat se recrea (es WhatsApp, no la app), con el formato de respuesta de
// firebase/functions/wa-owner.js y los mismos números que muestra el Inicio de la app ($ 486.500 en 74 ventas).
const Tilde = ({ color = '#53BDEB' }) => (
  <svg width="34" height="20" viewBox="0 0 34 20" style={{ marginLeft: 6 }}>
    <path d="M2 11 L8 17 L20 3" stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" />
    <path d="M12 15 L14 17 L26 3" stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" />
  </svg>
);
const Mic = ({ color = '#fff', tam = 34 }) => (
  <svg width={tam} height={tam} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round">
    <rect x="9" y="3" width="6" height="11" rx="3" fill={color} /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);
// Alturas de la "onda" del audio (fijas, para que el mismo audio se vea igual en cada cuadro)
const ONDA = [6, 10, 18, 26, 14, 30, 22, 12, 28, 34, 20, 10, 24, 32, 16, 8, 20, 28, 12, 22, 30, 18, 10, 14, 24, 12, 8, 6];

// Cuadros locales: empieza a grabar, manda el audio, "escribiendo…", llega la respuesta
const T: Record<Largo, { graba: number; envia: number; responde: number; tomas: Toma[] }> = {
  10: { graba: 2, envia: 13, responde: 25, tomas: [{ f: 0, x: 540, y: 1150, z: 1.0 }, { f: 25, x: 540, y: 1120, z: 1.0 }, { f: 42, x: 530, y: 1085, z: 1.08 }, { f: 54, x: 530, y: 1080, z: 1.1 }] },
  15: { graba: 5, envia: 25, responde: 46, tomas: [{ f: 0, x: 540, y: 1170, z: 1.0 }, { f: 25, x: 540, y: 1150, z: 1.0 }, { f: 46, x: 540, y: 1120, z: 1.02 }, { f: 70, x: 530, y: 1088, z: 1.1 }, { f: 90, x: 528, y: 1085, z: 1.12 }] },
};

const Burbuja: React.FC<{ sale?: boolean; children: React.ReactNode; style?: React.CSSProperties }> = ({ sale, children, style }) => (
  <div style={{ alignSelf: sale ? 'flex-end' : 'flex-start', maxWidth: 470, background: sale ? c.waSale : '#fff', borderRadius: sale ? '22px 6px 22px 22px' : '6px 22px 22px 22px',
    padding: '14px 20px 10px', boxShadow: '0 1px 1px rgba(0,0,0,.1)', transformOrigin: sale ? '100% 100%' : '0 100%', ...style }}>{children}</div>
);
const Hora: React.FC<{ h: string; leido?: boolean }> = ({ h, leido }) => (
  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', fontSize: 19, color: '#667781', marginTop: 2 }}>{h}{leido && <Tilde />}</div>
);
const Fecha: React.FC<{ t: string }> = ({ t }) => (
  <div style={{ alignSelf: 'center', background: '#FFFFFF', color: '#54656F', fontSize: 21, fontWeight: 600, padding: '7px 16px', borderRadius: 12 }}>{t}</div>
);
/** Un mensaje nuevo que entra empujando a los de arriba (como en WhatsApp): crece desde 0 hasta `alto`. */
const Entra: React.FC<{ desde: number; alto: number; children: React.ReactNode }> = ({ desde, alto, children }) => {
  const f = useCurrentFrame();
  if (f < desde) return null;
  const k = lineal(f, desde, desde + 7, 0, 1);
  return (
    <div style={{ height: alto * k, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ opacity: lineal(f, desde, desde + 5, 0, 1), scale: `${0.94 + 0.06 * k}`, display: 'flex', flexDirection: 'column', transformOrigin: '50% 100%' }}>{children}</div>
    </div>
  );
};

const Chat: React.FC<{ graba: number; envia: number; responde: number }> = ({ graba, envia, responde }) => {
  const f = useCurrentFrame();
  const grabando = f >= graba && f < envia;
  const seg = Math.min(3, 1 + Math.floor(((f - graba) / Math.max(1, envia - graba)) * 3));
  const escribe = f >= envia + 5 && f < responde;
  const marca = lineal(f, responde + 9, responde + 18, 0, 1);
  return (
    <AbsoluteFill style={{ background: c.waFondo, fontFamily: inter }}>
      {/* mensajes, pegados abajo: los nuevos empujan a los viejos hacia arriba */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 170, bottom: 104, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 16, padding: '0 22px 16px', overflow: 'hidden' }}>
        <Fecha t="AYER" />
        <Burbuja sale><div style={{ fontSize: 31, color: '#111B21', lineHeight: 1.25 }}>¿Qué tengo que reponer?</div><Hora h="21:12" leido /></Burbuja>
        <Burbuja><div style={{ fontSize: 31, color: '#111B21', lineHeight: 1.3 }}>Finlandia, Mogul y Toddy: te quedan menos de 5 de cada uno.</div><Hora h="21:12" /></Burbuja>
        <Fecha t="HOY" />
        {/* el audio: play, onda, duración y la transcripción debajo */}
        <Entra desde={envia} alto={168}>
          <Burbuja sale style={{ width: 430 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <svg width="30" height="34" viewBox="0 0 12 14"><path d="M1 1 L11 7 L1 13 Z" fill="#54656F" /></svg>
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4, height: 40 }}>
                {ONDA.map((h, i) => <div key={i} style={{ width: 5, height: h, borderRadius: 3, background: i < 2 ? '#1DAA61' : '#8FA39A' }} />)}
              </div>
              <div style={{ width: 56, height: 56, borderRadius: 30, background: '#1DAA61', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Mic tam={30} /></div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 19, color: '#667781', marginTop: 4 }}><span>0:03</span><span style={{ display: 'flex', alignItems: 'center' }}>19:47<Tilde /></span></div>
            <div style={{ borderTop: '1px solid rgba(0,0,0,.08)', marginTop: 8, paddingTop: 8, fontSize: 26, color: '#3B4A54', fontStyle: 'italic' }}>"¿Cuánto vendí hoy?"</div>
          </Burbuja>
        </Entra>
        {escribe && (
          <div style={{ alignSelf: 'flex-start', background: '#fff', borderRadius: '6px 22px 22px 22px', padding: '22px 26px', display: 'flex', gap: 10 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} style={{ width: 14, height: 14, borderRadius: 8, background: '#8696A0', translate: `0 ${Math.sin((f - envia) * 0.9 - i * 1.1) * 5}px` }} />
            ))}
          </div>
        )}
        <Entra desde={responde} alto={262}>
          <Burbuja>
            <div style={{ fontSize: 32, color: '#111B21', lineHeight: 1.3 }}>
              Hoy vendiste{' '}
              <span style={{ fontWeight: 750, backgroundImage: `linear-gradient(${c.menta}55, ${c.menta}55)`, backgroundSize: `${marca * 100}% 42%`, backgroundPosition: '0 88%', backgroundRepeat: 'no-repeat' }}>$ 486.500</span>
              {' '}en 74 ventas, un 10% más que el sábado pasado.
            </div>
            <div style={{ fontSize: 32, color: '#111B21', lineHeight: 1.3, marginTop: 10 }}>Lo que más salió: Bon o Bon, Amstel lata y Takis.</div>
            <Hora h="19:47" />
          </Burbuja>
        </Entra>
      </div>
      {/* encabezado de WhatsApp */}
      <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 170, background: '#008069', display: 'flex', alignItems: 'flex-end', padding: '0 26px 22px', boxSizing: 'border-box', gap: 18, color: '#fff' }}>
        <svg width="34" height="34" viewBox="0 0 24 24"><path d="M15 5 L8 12 L15 19" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" /></svg>
        <LogoV tam={74} style={{ borderRadius: 40 }} />
        <div>
          <div style={{ fontSize: 34, fontWeight: 650 }}>Ventra</div>
          <div style={{ fontSize: 24, opacity: 0.85 }}>{escribe ? 'escribiendo…' : 'en línea'}</div>
        </div>
      </div>
      {/* barra de abajo: mientras graba, punto rojo, tiempo y onda en vivo; el botón del micrófono crece */}
      <div style={{ position: 'absolute', left: 14, right: 14, bottom: 16, height: 80, display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, height: 80, borderRadius: 40, background: '#fff', display: 'flex', alignItems: 'center', padding: '0 26px', gap: 16, fontSize: 28, color: '#8696A0', overflow: 'hidden' }}>
          {grabando ? (
            <>
              <div style={{ width: 18, height: 18, borderRadius: 10, background: '#F15C6D', opacity: Math.floor((f - graba) / 6) % 2 ? 0.35 : 1 }} />
              <span style={{ color: '#111B21', fontVariantNumeric: 'tabular-nums' }}>0:0{seg}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, height: 40 }}>
                {ONDA.slice(0, 14).map((h, i) => <div key={i} style={{ width: 5, height: Math.max(5, h * (0.5 + 0.5 * Math.abs(Math.sin((f - graba) * 0.7 + i)))), borderRadius: 3, background: '#54656F' }} />)}
              </div>
            </>
          ) : (
            <span>Mensaje</span>
          )}
        </div>
        <div style={{ width: 80, height: 80, borderRadius: 40, background: '#1DAA61', display: 'flex', alignItems: 'center', justifyContent: 'center',
          scale: `${grabando ? lineal(f, graba, graba + 5, 1, 1.28) : 1}` }}><Mic /></div>
      </div>
    </AbsoluteFill>
  );
};

export const PlacaWhatsApp: React.FC<{ largo?: Largo }> = ({ largo = 10 }) => {
  const f = useCurrentFrame();
  const t = T[largo];
  return (
    <AbsoluteFill>
      <Fondo />
      <Camara semilla={3} tomas={t.tomas}>
        <Telefono x={245} y={560} ancho={560} alto={1000} style={entra(f, 0)}>
          <Chat graba={t.graba} envia={t.envia} responde={t.responde} />
        </Telefono>
      </Camara>
      <Titular etiqueta="2 · Por WhatsApp" lineas={[{ t: 'Mandale un audio.' }, { t: 'Te contesta.', verde: true }]} />
    </AbsoluteFill>
  );
};
