// Arma src/origen/guion-voz.json (palabras de la voz del dueño, en cuadros) a partir de las transcripciones de
// whisper (marketing/origen/tomas/voz/gN.subs.json, hechas con marketing/remotion/scripts/transcribir.mjs).
// Uso: node scripts/origen-voz-guion.mjs
// Whisper inventa frases en el silencio del final ("¡Gracias por ver!"): se corta en `hasta`.
// `texto` corrige la ortografía; tiene que tener la misma cantidad de palabras que lo que oyó whisper.
import { readFileSync, writeFileSync } from 'node:fs';

const VOZ = '../marketing/origen/tomas/voz/';
const FPS = 30;

const TOMAS = {
  a: { archivo: 'g2', hasta: 3990, primera: 100, frases: ['Trabajo en un kiosco hace cinco años y hice mi propio sistema.'] },
  b: { archivo: 'g3', hasta: 7500, frases: ['Mi jefe me preguntaba cuánto vendimos como 50 veces por día,', 'así que hice que le conteste el WhatsApp.'] },
  c: { archivo: 'g5', hasta: 4800, primera: 80, frases: ['Soy empleado de kiosco, me programé un sistema', 'y lo más loco es lo que hace por WhatsApp.'] },
  cuerpo: { archivo: 'g6', hasta: 22100, frases: [
    'Mi jefe me escribía todo el día', '"¿Cuánto vendimos? ¿Queda Coca?".',
    'Ahora se lo pregunta directamente al sistema por WhatsApp', 'y le contesta al toque con lo que hay en la caja.',
    'Le pregunta qué hay que reponer, quién nos debe plata, cómo viene el día', 'y le responde como si fuera una persona.',
    'Y cuando viene el proveedor le saca una foto a la boleta,', 'le manda la boleta por el mismo WhatsApp', 'y se carga sola en el sistema.',
  ] },
  cierre: { archivo: 'g7', hasta: 6100, frases: ['Lo usamos todos los días acá,', 'si tenés un comercio comentá CAJA y te lo dejo probar siete días gratis.'] },
};
// palabras que van en verde
const RESALTAR = ['sistema.', 'WhatsApp.', 'WhatsApp', 'persona.', 'sola', 'CAJA', 'gratis.'];

const salida = {};
for (const [id, t] of Object.entries(TOMAS)) {
  const subs = JSON.parse(readFileSync(VOZ + t.archivo + '.subs.json', 'utf8'));
  const oidas = [];
  for (const s of subs) {
    if (s.startMs >= t.hasta) break;
    if (!s.text.trim()) continue;
    if (s.text.startsWith(' ') || !oidas.length) oidas.push({ a: s.startMs, b: s.endMs });
    else oidas[oidas.length - 1].b = s.endMs;
  }
  // whisper a veces le pone a la primera palabra un comienzo posterior al de la segunda
  if (oidas.length > 1 && oidas[0].a > oidas[1].a) oidas[0].a = t.primera ?? 0;
  const palabras = t.frases.join(' ').split(/\s+/);
  if (palabras.length !== oidas.length) throw new Error(`${id}: ${palabras.length} palabras escritas y ${oidas.length} oídas`);
  let k = 0;
  const frases = t.frases.map((texto) => {
    const ws = texto.split(/\s+/).map((w) => {
      const o = oidas[k++];
      const en = Math.round((o.a / 1000) * FPS);
      return { w, en, dura: Math.max(3, Math.round((o.b / 1000) * FPS) - en) };
    });
    const ultima = ws[ws.length - 1];
    return { texto, en: ws[0].en, dura: ultima.en + ultima.dura - ws[0].en, palabras: ws, resaltar: RESALTAR.filter((r) => ws.some((x) => x.w === r)) };
  });
  const fin = Math.round((oidas[oidas.length - 1].b / 1000) * FPS);
  salida[id] = { audio: `origen/tomas/${t.archivo}.m4a`, fin, frases };
}
writeFileSync('src/origen/guion-voz.json', JSON.stringify(salida, null, 1));
for (const [id, v] of Object.entries(salida)) console.log(id, 'termina en el cuadro', v.fin);
