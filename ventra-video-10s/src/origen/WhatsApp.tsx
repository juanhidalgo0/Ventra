import React from 'react';
import { AbsoluteFill, Img, useCurrentFrame } from 'remotion';
import { c, inter } from '../marca';
import { lineal } from '../comunes';
import { LogoV } from '../placas/Logo';

// WhatsApp recreado a pantalla completa (1080 × 1920), como una grabación de pantalla del celular.
// 1) El jefe que pregunta todo el día cuánto vendimos. 2) El dueño le pregunta a Ventra y le contesta con el
// formato real del resumen (firebase/functions/wa-owner.js, summaryText: "*Hoy vendiste $ …* en N ventas (+x% vs. el … pasado)").
// Números inventados.

const Tilde: React.FC = () => (
  <svg width="40" height="24" viewBox="0 0 34 20" style={{ marginLeft: 6 }}>
    <path d="M2 11 L8 17 L20 3" stroke="#53BDEB" strokeWidth="3" fill="none" strokeLinecap="round" />
    <path d="M12 15 L14 17 L26 3" stroke="#53BDEB" strokeWidth="3" fill="none" strokeLinecap="round" />
  </svg>
);
const Burbuja: React.FC<{ sale?: boolean; children: React.ReactNode }> = ({ sale, children }) => (
  <div style={{ alignSelf: sale ? 'flex-end' : 'flex-start', maxWidth: 860, background: sale ? c.waSale : '#fff', borderRadius: sale ? '28px 8px 28px 28px' : '8px 28px 28px 28px',
    padding: '18px 26px 12px', boxShadow: '0 1px 2px rgba(0,0,0,.12)' }}>{children}</div>
);
const Hora: React.FC<{ h: string; leido?: boolean }> = ({ h, leido }) => (
  <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', fontSize: 24, color: '#667781', marginTop: 2 }}>{h}{leido ? <Tilde /> : null}</div>
);
const texto: React.CSSProperties = { fontSize: 42, color: '#111B21', lineHeight: 1.28 };

/** Un mensaje nuevo que entra empujando a los de arriba, como en WhatsApp. */
const Entra: React.FC<{ desde: number; alto: number; children: React.ReactNode }> = ({ desde, alto, children }) => {
  const f = useCurrentFrame();
  if (f < desde) return null;
  const k = lineal(f, desde, desde + 7, 0, 1);
  return (
    <div style={{ height: alto * k, flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end' }}>
      <div style={{ opacity: lineal(f, desde, desde + 5, 0, 1), display: 'flex', flexDirection: 'column' }}>{children}</div>
    </div>
  );
};

// Teclado abierto (como cuando uno tiene el chat en la mano): deja los mensajes arriba de los subtítulos
// y del texto de Instagram de abajo.
const FILAS = ['q w e r t y u i o p', 'a s d f g h j k l ñ', 'z x c v b n m'];
const Teclado: React.FC = () => (
  <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 440, background: '#E8EAED', padding: '22px 8px 0', boxSizing: 'border-box',
    display: 'flex', flexDirection: 'column', gap: 16, fontFamily: inter }}>
    {FILAS.map((fila, i) => (
      <div key={i} style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
        {i === 2 ? <div style={{ width: 128, height: 82, borderRadius: 12, background: '#C9CDD2' }} /> : null}
        {fila.split(' ').map((t) => (
          <div key={t} style={{ width: 96, height: 82, borderRadius: 12, background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 40, color: '#202124', boxShadow: '0 2px 0 #B7BBC0' }}>{t}</div>
        ))}
        {i === 2 ? <div style={{ width: 128, height: 82, borderRadius: 12, background: '#C9CDD2' }} /> : null}
      </div>
    ))}
    <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
      <div style={{ width: 150, height: 82, borderRadius: 12, background: '#C9CDD2' }} />
      <div style={{ width: 600, height: 82, borderRadius: 12, background: '#fff', boxShadow: '0 2px 0 #B7BBC0' }} />
      <div style={{ width: 150, height: 82, borderRadius: 12, background: '#C9CDD2' }} />
    </div>
  </div>
);

/** Pantalla de WhatsApp a pantalla completa (1080 × 1920): encabezado, mensajes pegados abajo, barra y teclado. */
const Pantalla: React.FC<{ nombre: string; estado: string; avatar: React.ReactNode; children: React.ReactNode }> = ({ nombre, estado, avatar, children }) => (
  <AbsoluteFill style={{ background: c.waFondo, fontFamily: inter }}>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 210, bottom: 548, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 18, padding: '0 30px 18px', overflow: 'hidden' }}>
      {children}
    </div>
    <div style={{ position: 'absolute', left: 0, right: 0, top: 0, height: 210, background: '#008069', display: 'flex', alignItems: 'flex-end', padding: '0 30px 28px', boxSizing: 'border-box', gap: 22, color: '#fff' }}>
      <svg width="40" height="40" viewBox="0 0 24 24" style={{ marginBottom: 22 }}><path d="M15 5 L8 12 L15 19" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" /></svg>
      {avatar}
      <div>
        <div style={{ fontSize: 42, fontWeight: 650 }}>{nombre}</div>
        <div style={{ fontSize: 28, opacity: 0.85 }}>{estado}</div>
      </div>
    </div>
    <div style={{ position: 'absolute', left: 18, right: 18, bottom: 452, height: 88, display: 'flex', alignItems: 'center', gap: 14 }}>
      <div style={{ flex: 1, height: 88, borderRadius: 44, background: '#fff', display: 'flex', alignItems: 'center', padding: '0 32px', fontSize: 34, color: '#8696A0' }}>Mensaje</div>
      <div style={{ width: 88, height: 88, borderRadius: 44, background: '#1DAA61' }} />
    </div>
    <Teclado />
  </AbsoluteFill>
);

const Fecha: React.FC<{ t: string }> = ({ t }) => (
  <div style={{ alignSelf: 'center', background: '#fff', color: '#54656F', fontSize: 26, fontWeight: 600, padding: '8px 20px', borderRadius: 14 }}>{t}</div>
);

/** El jefe preguntando a cada rato. `mensajes`: cuadro en que entra cada uno. */
export const ChatJefe: React.FC<{ mensajes: number[]; lista?: [string, string][] }> = ({ mensajes, lista = [['¿Cuánto vendimos?', '10:14'], ['¿Y ahora?', '13:02'], ['¿Cuánto llevamos?', '17:45'], ['Che, ¿cuánto vendimos hoy?', '21:30']] }) => {
  return (
    <Pantalla nombre="Jefe" estado="en línea" avatar={
      <div style={{ width: 84, height: 84, borderRadius: 42, background: '#DFE5E7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 40, fontWeight: 700, color: '#54656F' }}>J</div>}>
      <Fecha t="HOY" />
      {lista.map(([m, h], i) => (
        <Entra key={i} desde={mensajes[i] ?? 0} alto={140}>
          <Burbuja><div style={texto}>{m}</div><Hora h={h} /></Burbuja>
        </Entra>
      ))}
    </Pantalla>
  );
};

/** El dueño le pregunta a Ventra y le contesta con el resumen del día. */
export const ChatVentra: React.FC<{ pregunta: number; responde: number }> = ({ pregunta, responde }) => {
  const f = useCurrentFrame();
  const escribe = f >= pregunta + 8 && f < responde;
  const marca = lineal(f, responde + 10, responde + 20, 0, 1);
  return (
    <Pantalla nombre="Ventra" estado={escribe ? 'escribiendo…' : 'en línea'} avatar={<LogoV tam={84} style={{ borderRadius: 42 }} />}>
      <Fecha t="HOY" />
      <Entra desde={pregunta} alto={140}>
        <Burbuja sale><div style={texto}>¿Cuánto vendimos hoy?</div><Hora h="21:31" leido /></Burbuja>
      </Entra>
      {escribe ? (
        <div style={{ alignSelf: 'flex-start', background: '#fff', borderRadius: '8px 28px 28px 28px', padding: '28px 32px', display: 'flex', gap: 12 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ width: 18, height: 18, borderRadius: 9, background: '#8696A0', translate: `0 ${Math.sin((f - pregunta) * 0.9 - i * 1.1) * 6}px` }} />
          ))}
        </div>
      ) : null}
      <Entra desde={responde} alto={372}>
        <Burbuja>
          <div style={texto}>
            <span style={{ fontWeight: 750, backgroundImage: `linear-gradient(${c.menta}55, ${c.menta}55)`, backgroundSize: `${marca * 100}% 42%`, backgroundPosition: '0 88%', backgroundRepeat: 'no-repeat' }}>Hoy vendiste $ 486.300</span>
            {' '}en 112 ventas (+9% vs. el martes pasado).
          </div>
          <div style={{ ...texto, marginTop: 8 }}>- Lo más vendido: Coca-Cola 500 ml, Bon o Bon blanco, Takis Fuego</div>
          <div style={texto}>- Hay 1 caja abierta</div>
          <Hora h="21:31" />
        </Burbuja>
      </Entra>
    </Pantalla>
  );
};

/** Escribiendo… (los tres puntitos) mientras `f` está entre `desde` y `hasta`. */
const Escribiendo: React.FC<{ f: number }> = ({ f }) => (
  <div style={{ alignSelf: 'flex-start', background: '#fff', borderRadius: '8px 28px 28px 28px', padding: '28px 32px', display: 'flex', gap: 12, flexShrink: 0 }}>
    {[0, 1, 2].map((i) => (
      <div key={i} style={{ width: 18, height: 18, borderRadius: 9, background: '#8696A0', translate: `0 ${Math.sin(f * 0.9 - i * 1.1) * 6}px` }} />
    ))}
  </div>
);

export type Pregunta = { q: string; a: React.ReactNode; alto: number; hora: string; pregunta: number; responde: number };

/** Varias preguntas seguidas a Ventra, cada una con su respuesta (los mensajes viejos suben y se van por arriba). */
export const ChatPreguntas: React.FC<{ preguntas: Pregunta[] }> = ({ preguntas }) => {
  const f = useCurrentFrame();
  const escribe = preguntas.some((p) => f >= p.pregunta + 6 && f < p.responde);
  return (
    <Pantalla nombre="Ventra" estado={escribe ? 'escribiendo…' : 'en línea'} avatar={<LogoV tam={84} style={{ borderRadius: 42 }} />}>
      {preguntas.map((p, i) => (
        <React.Fragment key={i}>
          <Entra desde={p.pregunta} alto={140}>
            <Burbuja sale><div style={texto}>{p.q}</div><Hora h={p.hora} leido /></Burbuja>
          </Entra>
          {f >= p.pregunta + 6 && f < p.responde ? <Escribiendo f={f} /> : null}
          <Entra desde={p.responde} alto={p.alto}>
            <Burbuja><div style={texto}>{p.a}</div><Hora h={p.hora} /></Burbuja>
          </Entra>
        </React.Fragment>
      ))}
    </Pantalla>
  );
};

/** La foto de la boleta mandada por WhatsApp y lo que contesta Ventra al leerla (formato de wa-owner-invoice.js). */
export const ChatBoleta: React.FC<{ foto: string; manda: number; responde: number }> = ({ foto, manda, responde }) => {
  const f = useCurrentFrame();
  return (
    <Pantalla nombre="Ventra" estado={f >= manda + 6 && f < responde ? 'escribiendo…' : 'en línea'} avatar={<LogoV tam={84} style={{ borderRadius: 42 }} />}>
      <Entra desde={manda} alto={700}>
        <div style={{ alignSelf: 'flex-end', background: c.waSale, borderRadius: '28px 8px 28px 28px', padding: 8, boxShadow: '0 1px 2px rgba(0,0,0,.12)' }}>
          <div style={{ width: 470, height: 640, borderRadius: 22, overflow: 'hidden', position: 'relative' }}>
            <Img src={foto} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: '50% 20%', display: 'block' }} />
            <div style={{ position: 'absolute', right: 16, bottom: 10, fontSize: 24, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,.6)' }}>19:42</div>
          </div>
        </div>
      </Entra>
      {f >= manda + 6 && f < responde ? <Escribiendo f={f} /> : null}
      <Entra desde={responde} alto={250}>
        <Burbuja>
          <div style={texto}>🧾 <b>Distribuidora Norte</b> · N° 0003-00018427: leí <b>20 renglones</b>.</div>
          <div style={texto}>✅ 20 los reconocí seguro</div>
          <Hora h="19:42" />
        </Burbuja>
      </Entra>
    </Pantalla>
  );
};
