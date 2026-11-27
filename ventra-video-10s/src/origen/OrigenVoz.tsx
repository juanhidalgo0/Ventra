import React from 'react';
import { AbsoluteFill, Sequence, staticFile, useCurrentFrame } from 'remotion';
import { Audio } from '@remotion/media';
import { lineal } from '../comunes';
import { Cartel, Placa, Subtitulos, Ventana, type Gancho, type PantallaDef } from './Origen';
import { ChatBoleta, ChatJefe, ChatPreguntas, ChatVentra, type Pregunta } from './WhatsApp';
import voz from './guion-voz.json';
import { Toma } from '../ventri/comun';

// "Me hice mi propio sistema", versión solo voz (marketing/origen/GUION-VOZ.md): el dueño no sale en cámara.
// Su voz real (grabada con el celular) sobre la app y el WhatsApp con Ventra a pantalla completa.
// Tiempos de las palabras: src/origen/guion-voz.json (scripts/origen-voz-guion.mjs, desde whisper).

type Bloque = { audio: string; fin: number; frases: { texto: string; en: number; dura: number }[] };
const V = voz as unknown as Record<Gancho | 'cuerpo' | 'cierre', Bloque>;

const CARTEL = 'Mi jefe le pregunta todo / al sistema por WhatsApp';
const RESPIRO = 10; // cuadros después de la última palabra de cada bloque

const dura = (b: Bloque) => b.fin + RESPIRO;
const CUERPO = Math.max(dura(V.cuerpo), 680);
const CIERRE = dura(V.cierre) + 45; // la placa queda un rato quieta al final
export const duracionOrigenVoz = (g: Gancho) => dura(V[g]) + CUERPO + CIERRE;

const PREGUNTAS: Pregunta[] = [
  { q: '¿Qué tengo que reponer?', hora: '19:40', pregunta: 4, responde: 30, alto: 300,
    a: <>Tenés <b>6 productos en el mínimo</b>. Los más urgentes: Coca-Cola 1,5 L (quedan 2), Marlboro Box 20 (3) y alfajor Jorgito (4).</> },
  { q: '¿Quién me debe plata?', hora: '19:40', pregunta: 54, responde: 74, alto: 250,
    a: <>Te deben <b>$ 38.500</b> entre 3 clientes. El que más: Nico, $ 21.000 (hace 12 días).</> },
  { q: '¿Cómo viene el día?', hora: '19:41', pregunta: 90, responde: 118, alto: 250,
    a: <>Bien 👌 Llevás <b>$ 214.800</b> en 51 ventas, 6% más que el martes pasado.</> },
];

const BOLETA: PantallaDef = { en: 0, dura: 70, imagen: 'origen/boleta-papel.png', css: [900, 1600], k: 1.45, cx: 450, cy: 565, cy2: 760 };
const PC_CARGADA: PantallaDef = { en: 0, dura: 60, src: 'app/b20-pc.mp4', css: [1280, 800], desde: 4.2, vel: 0.5, k: 1.9, cx: 900, cy: 330 };

/** El "click" de la cámara al sacarle la foto a la boleta. */
const Flash: React.FC<{ en: number }> = ({ en }) => {
  const f = useCurrentFrame();
  if (f < en) return null;
  return <AbsoluteFill style={{ background: '#fff', opacity: lineal(f, en, en + 8, 0.9, 0) }} />;
};

const Oscuro: React.FC<{ o?: number }> = ({ o = 0.5 }) => <AbsoluteFill style={{ background: `rgba(0,0,0,${o})` }} />;

// Fotos reales del kiosco que sacó el dueño (public/origen/tomas/fotos, fuera de git): f2 = el mate con la caja atrás,
// f3 = la PC con el lector. Empuje lento y deriva de cámara en mano.
const Foto: React.FC<{ archivo: string; dura: number; zoom: [number, number] }> = ({ archivo, dura, zoom }) => (
  <Toma e={{ id: archivo, desde: 0, dura, fuente: { imagen: `origen/tomas/fotos/${archivo}` }, zoom }} />
);

export const OrigenVoz: React.FC<{ gancho: Gancho }> = ({ gancho }) => {
  const A = V[gancho], C = V.cuerpo, Z = V.cierre;
  const t1 = dura(A), t2 = t1 + CUERPO;
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Sequence durationInFrames={t1} name={`Gancho ${gancho}`}>
        <Foto archivo="f2.jpg" dura={t1} zoom={[1.04, 1.14]} />
        <Oscuro o={0.2} />
        <Cartel texto={CARTEL} />
        <Audio src={staticFile(A.audio)} />
        <Subtitulos frases={A.frases} centro={1300} />
      </Sequence>

      <Sequence from={t1} durationInFrames={CUERPO} name="Cuerpo">
        <Sequence durationInFrames={150} name="El jefe preguntando">
          <ChatJefe mensajes={[6, 34, 70, 116]} lista={[['¿Cuánto vendimos?', '10:14'], ['¿Y ahora?', '13:02'], ['¿Cuánto llevamos?', '17:45'], ['¿Queda Coca?', '18:10']]} />
        </Sequence>
        <Sequence from={150} durationInFrames={150} name="Le pregunta a Ventra">
          <ChatVentra pregunta={10} responde={96} />
        </Sequence>
        <Sequence from={300} durationInFrames={178} name="Reponer, deudas, el día">
          <ChatPreguntas preguntas={PREGUNTAS} />
        </Sequence>
        <Sequence from={478} durationInFrames={70} name="La boleta de papel">
          <Ventana p={BOLETA} />
          <Flash en={56} />
        </Sequence>
        <Sequence from={548} durationInFrames={72} name="La boleta por WhatsApp">
          <ChatBoleta foto={staticFile('origen/boleta-papel.png')} manda={14} responde={48} />
        </Sequence>
        <Sequence from={620} durationInFrames={CUERPO - 620} name="Cargada en la PC">
          <Ventana p={{ ...PC_CARGADA, dura: CUERPO - 620 }} />
        </Sequence>
        <Audio src={staticFile(C.audio)} />
        <Subtitulos frases={C.frases} centro={1570} tam={84} />
      </Sequence>

      <Sequence from={t2} durationInFrames={CIERRE} name="Cierre">
        <Foto archivo="f3.jpg" dura={CIERRE} zoom={[1.12, 1.03]} />
        <Oscuro o={0.45} />
        <Audio src={staticFile(Z.audio)} />
        <Subtitulos frases={Z.frases} centro={1300} hasta={112} />
        <Sequence from={112}><Placa arriba="Comentá" grande="CAJA" pastilla="7 días gratis · ventra.store" /></Sequence>
      </Sequence>
    </AbsoluteFill>
  );
};
