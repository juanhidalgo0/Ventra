// Música y efectos del video, hechos con código (osciladores, ruido, envolventes y filtros). No usa
// ningún archivo de audio de afuera. Lee los tiempos del guion (los mismos que usa el video).
//   node scripts/audio.mjs                      → 10 s: src/guion.json   → public/audio/*.wav
//   node scripts/audio.mjs src/guion15.json audio15 → 15 s: src/guion15.json → public/audio15/*.wav
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [, , archivoGuion = 'src/guion.json', carpeta = 'audio'] = process.argv;
const G = JSON.parse(fs.readFileSync(path.join(RAIZ, archivoGuion), 'utf8'));
const SR = 44100;
const DUR = G.total / G.fps; // 10 o 15 s exactos
const N = Math.round(DUR * SR);
const cuadro = (f) => f / G.fps; // cuadro → segundos
const TIEMPO = 60 / G.bpm; // 0,6 s = 18 cuadros
const FFMPEG = path.join(RAIZ, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);

// ── Pistas estéreo ──────────────────────────────────────────────────────────────────
const pista = () => ({ L: new Float32Array(N), R: new Float32Array(N) });
const musica = pista(), efectos = pista(), eco = pista();
// Suma una voz: fn(t) devuelve la muestra en el segundo t desde el inicio de la voz
function sumar(p, t0, dur, fn, gan = 1, pan = 0, envio = 0) {
  const i0 = Math.max(0, Math.round(t0 * SR)), i1 = Math.min(N, Math.round((t0 + dur) * SR));
  const gl = gan * Math.cos((pan + 1) * Math.PI / 4), gr = gan * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = i0; i < i1; i++) {
    const v = fn((i - Math.round(t0 * SR)) / SR);
    p.L[i] += v * gl; p.R[i] += v * gr;
    if (envio) { eco.L[i] += v * gl * envio; eco.R[i] += v * gr * envio; }
  }
}
// Envolventes
const ad = (t, a, d) => (t < a ? t / a : Math.exp(-(t - a) / d));
const adsr = (t, a, d, s, len, r) => (t < a ? t / a : t < a + d ? 1 - (1 - s) * ((t - a) / d) : t < len ? s : s * Math.exp(-(t - len) / r));
// Osciladores
const TAU = Math.PI * 2;
const seno = (f, t) => Math.sin(TAU * f * t);
const tri = (f, t) => 2 * Math.abs(2 * ((f * t) % 1) - 1) - 1;
const sierra = (f, t) => 2 * ((f * t) % 1) - 1;
const cuadrada = (f, t) => ((f * t) % 1 < 0.5 ? 1 : -1);
let semilla = 7;
const ruido = () => { semilla = (semilla * 16807) % 2147483647; return (semilla / 2147483647) * 2 - 1; };
// Filtros con memoria (uno por voz)
const pasaBajos = (fc) => { let y = 0; const a = 1 - Math.exp(-TAU * fc / SR); return (x, f2) => { const b = f2 ? 1 - Math.exp(-TAU * f2 / SR) : a; y += b * (x - y); return y; }; };
const pasaBanda = (q = 0.5) => { let lo = 0, bp = 0; return (x, fc) => { const f = 2 * Math.sin(Math.PI * Math.min(fc, SR / 6) / SR); lo += f * bp; const hi = x - lo - q * bp; bp += f * hi; return bp; }; };

// ── Música: 100 BPM, cada placa 3 tiempos, final en el cuadro 279 ──────────────────────
const ACORDES = {
  Dmaj9: { bajo: 38, notas: [50, 54, 57, 61, 64] },
  Bm7: { bajo: 35, notas: [47, 50, 54, 57] },
  Gmaj7: { bajo: 31, notas: [43, 47, 50, 54] },
  'D/F#': { bajo: 30, notas: [42, 45, 50, 54] },
  A: { bajo: 33, notas: [45, 49, 52, 57] },
  D: { bajo: 38, notas: [50, 54, 57, 62] },
};
const FIN = cuadro(G.finalMusica); // 9,3 s: golpe final
const acordeEn = (t) => { let a = G.placas[0]; for (const p of G.placas) if (t >= cuadro(p.desde)) a = p; return ACORDES[a.acorde]; };

function bombo(t0, gan = 0.72) {
  // seno que cae de 141 a 46 Hz (el "golpe") más un clic cortito de ataque
  sumar(musica, t0, 0.45, (t) => {
    const fase = TAU * (46 * t + 95 * 0.035 * (1 - Math.exp(-t / 0.035)));
    return Math.sin(fase) * ad(t, 0.002, 0.16) + (t < 0.003 ? ruido() * 0.25 : 0);
  }, gan);
}
function palmas(t0, gan = 0.32) {
  const bp = pasaBanda(0.9);
  sumar(musica, t0, 0.3, (t) => {
    const golpes = [0, 0.011, 0.023].reduce((s, d) => s + (t >= d ? Math.exp(-(t - d) / (d === 0.023 ? 0.09 : 0.006)) : 0), 0);
    return bp(ruido(), 1300) * golpes * 1.6;
  }, gan, 0.05, 0.25);
}
function platillo(t0, abierto = false, gan = 0.1) {
  const lp = pasaBajos(6500);
  sumar(musica, t0, abierto ? 0.22 : 0.06, (t) => { const n = ruido(); return (n - lp(n)) * ad(t, 0.001, abierto ? 0.07 : 0.018); }, gan, 0.25);
}
function bajo(t0, m, dur, gan = 0.34) {
  const lp = pasaBajos(380);
  const f = midi(m);
  sumar(musica, t0, dur + 0.15, (t) => lp(0.7 * seno(f, t) + 0.45 * sierra(f, t) + 0.25 * seno(f * 2, t)) * adsr(t, 0.006, 0.12, 0.6, dur, 0.05), gan);
}
function punteo(t0, m, gan = 0.085, pan = 0) {
  const lp = pasaBajos(2600);
  const f = midi(m);
  sumar(musica, t0, 0.5, (t) => lp(tri(f, t) * 0.8 + sierra(f * 1.003, t) * 0.35) * ad(t, 0.003, 0.11), gan, pan, 0.35);
}
function colchon(t0, dur, notas, gan = 0.05) {
  for (const [k, m] of notas.entries()) {
    const lp = pasaBajos(900), f = midi(m + 12);
    sumar(musica, t0, dur + 0.4, (t) => lp(sierra(f * 0.997, t) + sierra(f * 1.004, t)) * adsr(t, 0.12, 0.2, 0.75, dur, 0.18), gan, k % 2 ? 0.45 : -0.45, 0.2);
  }
}

// Intro (placa 1): el acorde entra abriéndose, con el bombo marcando cada tiempo de la primera placa
// (en los videos de 10 y 15 s son 2 tiempos; en el de boletas, 5)
{
  const p0 = G.placas[0];
  const a = ACORDES[p0.acorde];
  const largo = cuadro(p0.dura), tiempos = Math.round(p0.dura / 18);
  for (const [k, m] of a.notas.entries()) {
    const lp = pasaBajos(300), f = midi(m + 12);
    sumar(musica, 0, largo + 0.1, (t) => lp(sierra(f, t) + 0.6 * seno(f, t), 300 + 3200 * Math.min(1, t / (largo - 0.1))) * adsr(t, 0.05, 0.3, 0.8, largo - 0.15, 0.05), 0.045, k % 2 ? 0.5 : -0.5, 0.25);
  }
  for (let b = 0; b < tiempos; b++) {
    bombo(b * TIEMPO, 0.8);
    if (b >= 1) platillo(b * TIEMPO + TIEMPO / 2, true, 0.08);
  }
  for (let k = 0; k < tiempos * 2; k++) punteo(TIEMPO * (k / 2), [74, 78, 81, 85][k % 4], 0.05, k % 2 ? 0.3 : -0.3);
}
// Cuerpo (placas 2 a 5): pulso marcado, del tiempo en que entra la placa 2 hasta el cierre
const PATRON = [0, 2, 1, 3, 2, 1];
const B0 = Math.round(G.placas[1].desde / 18), BC = Math.round(G.placas.find((p) => p.id === 'cierre').desde / 18);
const inicioDePlaca = new Set(G.placas.map((p) => Math.round(p.desde / 18)));
for (let b = B0; b < BC; b++) {
  const t = b * TIEMPO;
  const a = acordeEn(t + 0.01);
  bombo(t);
  if (b % 2 === 1) palmas(t);
  platillo(t + TIEMPO / 2, true, 0.09);
  platillo(t, false, 0.06);
  bajo(t, a.bajo + 12 * (b % 3 === 2 ? 0 : 0), TIEMPO * 0.45);
  bajo(t + TIEMPO / 2, a.bajo + 12, TIEMPO * 0.3, 0.22);
  for (let k = 0; k < 2; k++) {
    const paso = ((b - B0) * 2 + k) % PATRON.length;
    punteo(t + (k * TIEMPO) / 2, a.notas[PATRON[paso] % a.notas.length] + 24, 0.075, k ? 0.35 : -0.35);
  }
  if (inicioDePlaca.has(b)) {
    const placa = G.placas.find((p) => Math.round(p.desde / 18) === b);
    colchon(t, cuadro(placa.dura) - 0.05, a.notas);
  }
}
// Cierre: en el tiempo del cierre entra el acorde de Re y el golpe final cae en G.finalMusica
{
  const t14 = BC * TIEMPO;
  const resto = DUR - FIN;
  if (FIN - t14 >= TIEMPO) {
    bombo(t14); platillo(t14 + TIEMPO / 2, true, 0.08); bajo(t14, 38, TIEMPO * 0.45);
    colchon(t14, FIN - t14 - 0.05, ACORDES.D.notas, 0.045);
    punteo(t14, 74, 0.07, -0.3); punteo(t14 + TIEMPO / 2, 78, 0.07, 0.3); punteo(t14 + TIEMPO, 81, 0.07, -0.3);
  } else {
    // el golpe cae justo al entrar el cierre (video con voz): queda un colchón suave debajo de la última frase
    colchon(FIN, resto - 0.35, ACORDES.D.notas, 0.035);
  }
  // redoble corto que anuncia el golpe
  for (let k = 0; k < 4; k++) palmas(FIN - 0.2 + k * 0.05, 0.08 + k * 0.04);
  // golpe final: bombo, acorde completo y platillo que se apagan solos antes del final
  bombo(FIN, 1);
  sumar(musica, FIN, resto, (t) => { const n = ruido(); return n * ad(t, 0.002, 0.18) * 0.5; }, 0.12, 0, 0.3);
  for (const [k, m] of [38, 50, 57, 62, 66, 69, 76].entries()) {
    const lp = pasaBajos(4200), f = midi(m);
    sumar(musica, FIN, resto, (t) => lp(sierra(f, t) * 0.6 + seno(f, t), 4200 * Math.exp(-t / 0.35) + 300) * ad(t, 0.004, 0.32), k === 0 ? 0.28 : 0.06, k % 2 ? 0.35 : -0.35, 0.3);
  }
}

// ── Efectos ─────────────────────────────────────────────────────────────────────────
const EFECTOS = {
  logo: (t0) => { for (const [k, m] of [74, 81].entries()) sumar(efectos, t0 + k * 0.06, 0.8, (t) => (seno(midi(m), t) + 0.3 * seno(midi(m) * 2.76, t)) * ad(t, 0.002, 0.25), 0.16, k ? 0.2 : -0.2, 0.4); },
  pase: (t0) => {
    const bp = pasaBanda(0.7);
    sumar(efectos, t0, 0.24, (t) => bp(ruido(), 500 + 5200 * Math.pow(t / 0.24, 1.6)) * Math.pow(t / 0.24, 1.4) * (t > 0.22 ? (0.24 - t) / 0.02 : 1), 0.3);
  },
  obturador: (t0) => {
    const lp = pasaBajos(5000);
    sumar(efectos, t0, 0.12, (t) => { const n = ruido(); const c1 = t < 0.006 ? 1 : 0, c2 = t > 0.055 && t < 0.063 ? 0.8 : 0; return (n - lp(n)) * (c1 + c2) + seno(160, t) * ad(t, 0.001, 0.02) * 0.5; }, 0.55);
  },
  listo: (t0) => { for (const [k, m] of [83, 90].entries()) sumar(efectos, t0 + k * 0.08, 0.7, (t) => (seno(midi(m), t) + 0.25 * seno(midi(m) * 2, t)) * ad(t, 0.003, 0.2), 0.17, 0, 0.35); },
  envio: (t0) => { sumar(efectos, t0, 0.3, (t) => seno(700 + 1600 * (t / 0.3), t) * ad(t, 0.02, 0.09) * 0.6, 0.09, -0.3, 0.4); },
  aviso: (t0) => { sumar(efectos, t0, 0.8, (t) => (seno(1318, t) + 0.4 * seno(2637, t) + 0.15 * seno(3950, t)) * ad(t, 0.002, 0.22), 0.16, 0.25, 0.35); },
  toque: (t0) => { sumar(efectos, t0, 0.05, (t) => seno(1900 - 9000 * t, t) * ad(t, 0.0008, 0.012), 0.18); },
  enviado: (t0) => { sumar(efectos, t0, 0.14, (t) => seno(520 + 4200 * t, t) * ad(t, 0.004, 0.035), 0.2, 0.2, 0.2); },
  whatsapp: (t0) => { for (const [k, f] of [1046, 1568].entries()) sumar(efectos, t0 + k * 0.09, 0.4, (t) => (seno(f, t) + 0.3 * seno(f * 2, t)) * ad(t, 0.003, 0.08), 0.17, -0.15, 0.3); },
  // la línea de lectura pasa los 20 renglones en 82 cuadros, con la misma curva que el video (seno de ida y vuelta)
  renglones: (t0) => { for (let i = 1; i <= 20; i++) { const tt = t0 + (82 / G.fps) * (Math.acos(1 - i / 10) / Math.PI); const f = 1500 + i * 45; sumar(efectos, tt, 0.04, (t) => seno(f, t) * ad(t, 0.0008, 0.009), 0.11, i % 2 ? 0.2 : -0.2); } },
  graba: (t0) => { for (const [k, f] of [880, 1320].entries()) sumar(efectos, t0 + k * 0.05, 0.12, (t) => seno(f, t) * ad(t, 0.004, 0.03), 0.14, 0.15); },
  sinsenal: (t0) => { sumar(efectos, t0, 0.42, (t) => seno(880 * Math.pow(0.32, t / 0.42), t) * ad(t, 0.01, 0.16) * (1 + 0.3 * seno(18, t)), 0.15, 0, 0.25); },
  pitido: (t0) => { const lp = pasaBajos(5000); sumar(efectos, t0, 0.075, (t) => lp(cuadrada(2750, t)) * (t < 0.07 ? 1 : (0.075 - t) / 0.005) * 0.5, 0.13, 0.15); },
  caja: (t0) => {
    const lp = pasaBajos(700);
    sumar(efectos, t0, 0.12, (t) => lp(ruido()) * ad(t, 0.002, 0.03) * 1.5, 0.3);
    sumar(efectos, t0 + 0.05, 1.0, (t) => [2093, 2794, 4186, 5274].reduce((s, f, k) => s + seno(f, t) * Math.exp(-t / (0.35 - k * 0.06)) / (k + 1), 0), 0.15, 0.2, 0.35);
  },
  sincronizado: (t0) => { for (const [k, m] of [76, 83, 88].entries()) sumar(efectos, t0 + k * 0.055, 0.6, (t) => (seno(midi(m), t) + 0.2 * seno(midi(m) * 2, t)) * ad(t, 0.003, 0.15), 0.13, -0.1, 0.35); },
  pedido: (t0) => { for (const [k, m] of [79, 83, 86, 91].entries()) sumar(efectos, t0 + k * 0.06, 0.9, (t) => (seno(midi(m), t) + 0.35 * seno(midi(m) * 3, t) * Math.exp(-t / 0.05)) * ad(t, 0.002, 0.28), 0.14, 0.25, 0.4); },
};
for (const e of G.efectos) {
  if (!EFECTOS[e.tipo]) throw new Error(`Efecto sin sonido: ${e.tipo}`);
  EFECTOS[e.tipo](cuadro(e.t));
}

// ── Eco/ambiente (dos retardos cruzados) para lo que pidió envío ───────────────────────
function ambiente() {
  const d1 = Math.round(0.137 * SR), d2 = Math.round(0.211 * SR);
  const lp = [pasaBajos(3000), pasaBajos(3000)];
  const salida = pista();
  for (let i = 0; i < N; i++) {
    const l = eco.L[i] + (i >= d1 ? salida.R[i - d1] * 0.38 : 0);
    const r = eco.R[i] + (i >= d2 ? salida.L[i - d2] * 0.38 : 0);
    salida.L[i] = lp[0](l); salida.R[i] = lp[1](r);
  }
  return salida;
}
const amb = ambiente();

// ── Mezcla, cierre limpio y archivos ─────────────────────────────────────────────────
function escribirWav(archivo, p, gan = 1) {
  const datos = Buffer.alloc(N * 4);
  for (let i = 0; i < N; i++) {
    // los últimos 20 ms bajan a cero: el video termina en silencio, sin chasquido
    const cola = i > N - 0.02 * SR ? (N - i) / (0.02 * SR) : 1;
    const l = Math.tanh(p.L[i] * gan) * cola, r = Math.tanh(p.R[i] * gan) * cola;
    datos.writeInt16LE(Math.round(Math.max(-1, Math.min(1, l)) * 32767), i * 4);
    datos.writeInt16LE(Math.round(Math.max(-1, Math.min(1, r)) * 32767), i * 4 + 2);
  }
  const cab = Buffer.alloc(44);
  cab.write('RIFF', 0); cab.writeUInt32LE(36 + datos.length, 4); cab.write('WAVE', 8); cab.write('fmt ', 12);
  cab.writeUInt32LE(16, 16); cab.writeUInt16LE(1, 20); cab.writeUInt16LE(2, 22); cab.writeUInt32LE(SR, 24);
  cab.writeUInt32LE(SR * 4, 28); cab.writeUInt16LE(4, 32); cab.writeUInt16LE(16, 34); cab.write('data', 36); cab.writeUInt32LE(datos.length, 40);
  fs.writeFileSync(archivo, Buffer.concat([cab, datos]));
}
const dir = path.join(RAIZ, 'public', carpeta);
fs.mkdirSync(dir, { recursive: true });
// ── Voz (si el guion la trae): cada frase en su cuadro y la música más baja mientras habla ───
const voz = new Float32Array(N), baja = new Float32Array(N);
if (G.voz) {
  const archivoVoz = path.join(RAIZ, G.voz.archivo);
  // nivel parejo: la voz se lleva a -16 LUFS antes de mezclar
  const mv = spawnSync(FFMPEG, ['-hide_banner', '-i', archivoVoz, '-af', 'loudnorm=I=-16:TP=-2:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
  const ganVoz = Math.pow(10, (-16 - Number(JSON.parse(mv.stderr.slice(mv.stderr.lastIndexOf('{'))).input_i)) / 20);
  const pcm = spawnSync(FFMPEG, ['-v', 'error', '-i', archivoVoz, '-f', 'f32le', '-ac', '1', '-ar', String(SR), '-'], { maxBuffer: 1 << 28 }).stdout;
  const fuente = new Float32Array(pcm.length / 4);
  for (let j = 0; j < fuente.length; j++) fuente[j] = pcm.readFloatLE(j * 4);
  const fundido = Math.round(0.01 * SR), rampa = Math.round(0.12 * SR);
  for (const tr of G.voz.tramos) {
    const a = Math.round(tr.desde * SR), b = Math.min(fuente.length, Math.round(tr.hasta * SR)), i0 = Math.round(cuadro(tr.en) * SR);
    for (let j = a; j < b; j++) {
      const i = i0 + (j - a);
      if (i >= 0 && i < N) voz[i] += fuente[j] * ganVoz * Math.min(1, (j - a) / fundido, (b - j) / fundido);
    }
    // la música baja 0,12 s antes de que hable y vuelve 0,1 s después
    const s0 = i0 - rampa, s1 = i0 + (b - a) + Math.round(0.1 * SR);
    for (let i = Math.max(0, s0); i < Math.min(N, s1 + rampa); i++) {
      const v = i < s0 + rampa ? (i - s0) / rampa : i > s1 ? 1 - (i - s1) / rampa : 1;
      baja[i] = Math.max(baja[i], Math.max(0, Math.min(1, v)));
    }
  }
  const pv = pista(); pv.L.set(voz); pv.R.set(voz);
  fs.mkdirSync(path.join(RAIZ, 'public', carpeta), { recursive: true });
  escribirWav(path.join(RAIZ, 'public', carpeta, 'voz.wav'), pv);
}
const mezcla = pista();
for (let i = 0; i < N; i++) {
  // debajo de la voz: música -9 dB, efectos -3 dB, ambiente -6 dB
  const gm = 1 - 0.65 * baja[i], ge = 1 - 0.3 * baja[i], ga = 1 - 0.5 * baja[i];
  mezcla.L[i] = musica.L[i] * 0.9 * gm + efectos.L[i] * 1.5 * ge + amb.L[i] * 0.5 * ga + voz[i];
  mezcla.R[i] = musica.R[i] * 0.9 * gm + efectos.R[i] * 1.5 * ge + amb.R[i] * 0.5 * ga + voz[i];
}
escribirWav(path.join(dir, 'musica.wav'), musica);
escribirWav(path.join(dir, 'efectos.wav'), efectos);
const crudo = path.join(dir, '_mezcla-cruda.wav');
escribirWav(crudo, mezcla);

// Volumen de redes: -14 LUFS con pico verdadero de -1 dB (loudnorm de ffmpeg, dos pasadas)
const medir = spawnSync(FFMPEG, ['-hide_banner', '-i', crudo, '-af', 'loudnorm=I=-14:TP=-1:LRA=9:print_format=json', '-f', 'null', '-'], { encoding: 'utf8' });
const m = JSON.parse(medir.stderr.slice(medir.stderr.lastIndexOf('{')));
const filtro = `loudnorm=I=-14:TP=-1:LRA=9:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true`;
const r = spawnSync(FFMPEG, ['-hide_banner', '-y', '-loglevel', 'error', '-i', crudo, '-af', filtro, '-ar', String(SR), '-t', String(DUR), path.join(dir, 'mezcla.wav')], { stdio: 'inherit' });
if (r.status !== 0) throw new Error('ffmpeg falló');
fs.rmSync(crudo);
console.log(`ok public/${carpeta}/mezcla.wav · ${DUR} s · antes ${m.input_i} LUFS → -14 LUFS`);
