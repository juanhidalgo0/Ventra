// Graba en VIDEO la app real (scroll, toques y tipeo de verdad) para los reels: maneja Chrome por CDP,
// junta los cuadros del screencast y arma un mp4 a 60 fps con el ffmpeg de ffmpeg-static. Sin dependencias.
//
//   node scripts/grabar-app.mjs <guion.json> <carpeta de salida>
//
// guion.json: { "base": "http://localhost:5174/", "ancho": 390, "alto": 844, "escala": 2, "movil": true,
//   "storage": {...}, "sesion": {...}, "geo": { "lat": -35.08, "lng": -57.51 }, "zona": "Pacific/Pago_Pago" (hora que ve la app),
//   "tomas": [ { "nombre": "pedido", "pasos": [...] } ] }
// Cada toma sale como <nombre>.mp4 + <nombre>.json (toques y marcas, en segundos desde que empieza a grabar
// y en px de la pantalla). Pasos:
//   { "ir": "#/ruta" } · { "espera": 800 } · { "js": "código" } · { "grabar": true } (empieza el video)
//   { "toque": "texto" } o { "toque": { "sel": "css" } }: toca el centro del elemento (táctil en celular)
//   { "deslizar": 600, "ms": 700 }: desliza el dedo hacia arriba 600 px (negativo: hacia abajo)
//   { "hasta": "expresión", "max": 60000 }: espera a que la expresión dé verdadero
//   { "escribir": "coca", "ms": 120 } · { "marca": "nombre" } · { "log": "expresión" } (la imprime)
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [, , archivo, salida] = process.argv;
const cfg = JSON.parse(fs.readFileSync(archivo, 'utf8'));
fs.mkdirSync(salida, { recursive: true });
const RAIZ = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FFMPEG = path.join(RAIZ, 'node_modules', 'ffmpeg-static', 'ffmpeg.exe');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PUERTO = 9334;
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'grabar-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${perfil}`, '--hide-scrollbars', '--no-first-run', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

let ws;
for (let i = 0; i < 50 && !ws; i++) {
  try {
    const lista = await (await fetch(`http://127.0.0.1:${PUERTO}/json/list`)).json();
    const pag = lista.find((t) => t.type === 'page');
    if (pag) ws = new WebSocket(pag.webSocketDebuggerUrl);
  } catch { await pausa(200); }
}
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pendientes = new Map();
const oyentes = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pendientes.has(m.id)) { pendientes.get(m.id)(m); pendientes.delete(m.id); }
  else if (m.method && oyentes.has(m.method)) oyentes.get(m.method)(m.params);
});
const cdp = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id;
  pendientes.set(n, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluar = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;

const ancho = cfg.ancho || 390, alto = cfg.alto || 844, escala = cfg.escala || 2, movil = cfg.movil !== false;
await cdp('Page.enable');
await cdp('Runtime.enable');
await cdp('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: escala, mobile: movil });
if (movil) await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
if (cfg.zona) await cdp('Emulation.setTimezoneOverride', { timezoneId: cfg.zona });
if (cfg.geo) {
  await cdp('Browser.grantPermissions', { permissions: ['geolocation', 'notifications'] }).catch(() => {});
  await cdp('Emulation.setGeolocationOverride', { latitude: cfg.geo.lat, longitude: cfg.geo.lng, accuracy: 20 });
}
const storage = JSON.stringify(cfg.storage || {}), sesion = JSON.stringify(cfg.sesion || {});
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = ${storage}; for (const k in s) localStorage.setItem(k, s[k]); const t = ${sesion}; for (const k in t) sessionStorage.setItem(k, t[k]); } catch {}` });

// El elemento visible más chico cuyo texto contiene `t` (o el primero que coincide con un selector)
const BUSCAR = `(q) => { if (q && q.sel) { return [...document.querySelectorAll(q.sel)].find((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; }) || null; }
  const els = [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && (el.innerText || '').includes(q); });
  return els.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0] || null; }`;

// ── Screencast ──────────────────────────────────────────────────────────────────────
let cuadros = null, t0 = 0;
oyentes.set('Page.screencastFrame', (p) => {
  cdp('Page.screencastFrameAck', { sessionId: p.sessionId }).catch(() => {});
  if (cuadros) cuadros.push({ t: p.metadata.timestamp, data: p.data });
});
const ahora = () => (cuadros && cuadros.length ? cuadros[cuadros.length - 1].t : 0);
const reloj = () => (t0 ? (Date.now() / 1000 - t0) : 0);

async function tocar(x, y) {
  if (movil) {
    await cdp('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await pausa(70);
    await cdp('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await pausa(60);
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  }
}

for (const toma of cfg.tomas) {
  const eventos = { toques: [], marcas: {} };
  cuadros = null; t0 = 0;
  for (const p of toma.pasos) {
    if (p.ir != null) {
      await cdp('Page.navigate', { url: p.ir.startsWith('http') ? p.ir : cfg.base + p.ir });
      await pausa(p.carga ?? 4000);
    } else if (p.grabar) {
      cuadros = [];
      await cdp('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: ancho * escala, maxHeight: alto * escala, everyNthFrame: 1 });
      t0 = Date.now() / 1000;
      await pausa(300);
    } else if (p.toque) {
      const r = await evaluar(`(() => { const el = (${BUSCAR})(${JSON.stringify(p.toque)}); if (!el) return null; const b = (el.closest('button,a,[role=button]') || el).getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; })()`);
      if (!r) { console.warn(`  [${toma.nombre}] no encontré`, p.toque); continue; }
      const x = p.dx != null ? r.x + p.dx : r.x, y = p.dy != null ? r.y + p.dy : r.y;
      eventos.toques.push({ t: +reloj().toFixed(3), x: +x.toFixed(1), y: +y.toFixed(1) });
      await tocar(x, y);
      await pausa(p.espera ?? 900);
    } else if (p.deslizar != null) {
      const dy = p.deslizar;
      const y0 = dy > 0 ? alto * 0.72 : alto * 0.3;
      eventos.toques.push({ t: +reloj().toFixed(3), x: ancho / 2, y: y0, desliza: dy });
      await cdp('Input.synthesizeScrollGesture', { x: ancho / 2, y: y0, yDistance: -dy, speed: Math.round(Math.abs(dy) / ((p.ms ?? 700) / 1000)), gestureSourceType: movil ? 'touch' : 'mouse', preventFling: p.fling === false });
      await pausa(p.espera ?? 500);
    } else if (p.escribir != null) {
      for (const c of p.escribir) { await cdp('Input.insertText', { text: c }); await pausa(p.ms ?? 120); }
      await pausa(p.espera ?? 600);
    } else if (p.marca) {
      eventos.marcas[p.marca] = +reloj().toFixed(3);
    } else if (p.hasta) {
      const fin = Date.now() + (p.max ?? 60000);
      while (Date.now() < fin && !(await evaluar(p.hasta))) await pausa(p.cada ?? 500);
      if (Date.now() >= fin) console.warn(`  [${toma.nombre}] no se cumplió`, p.hasta);
      await pausa(p.espera ?? 0);
    } else if (p.log) {
      console.log(`  [${toma.nombre}]`, JSON.stringify(await evaluar(p.log)));
    } else if (p.js) {
      await evaluar(p.js);
      await pausa(p.espera ?? 400);
    } else if (p.espera) await pausa(p.espera);
  }
  if (!cuadros) continue;
  await pausa(400);
  await cdp('Page.stopScreencast');
  const lista = cuadros; cuadros = null;
  // Cuadros con su duración real → mp4 a 60 fps constantes
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `cuadros-${toma.nombre}-`));
  let concat = 'ffconcat version 1.0\n';
  lista.forEach((c, i) => {
    const f = path.join(dir, `${String(i).padStart(5, '0')}.jpg`);
    fs.writeFileSync(f, Buffer.from(c.data, 'base64'));
    const dur = i + 1 < lista.length ? lista[i + 1].t - c.t : 0.3;
    concat += `file '${f.replace(/\\/g, '/')}'\nduration ${Math.max(0.001, dur).toFixed(4)}\n`;
  });
  concat += `file '${path.join(dir, `${String(lista.length - 1).padStart(5, '0')}.jpg`).replace(/\\/g, '/')}'\n`;
  fs.writeFileSync(path.join(dir, 'lista.txt'), concat);
  const destino = path.join(salida, `${toma.nombre}.mp4`);
  const r = spawnSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(dir, 'lista.txt'),
    '-vf', 'fps=60,format=yuv420p,pad=ceil(iw/2)*2:ceil(ih/2)*2', '-c:v', 'libx264', '-crf', '14', '-preset', 'slow', destino], { stdio: 'inherit' });
  if (r.status !== 0) throw new Error('ffmpeg falló');
  // el video arranca en el primer cuadro: los tiempos de los eventos se corren a ese origen
  const corr = lista.length ? lista[0].t - t0 : 0;
  for (const e of eventos.toques) e.t = +(e.t - corr).toFixed(3);
  for (const k in eventos.marcas) eventos.marcas[k] = +(eventos.marcas[k] - corr).toFixed(3);
  eventos.duracion = +(lista[lista.length - 1].t - lista[0].t + 0.3).toFixed(3);
  eventos.cuadros = lista.length;
  eventos.ancho = ancho; eventos.alto = alto;
  fs.writeFileSync(path.join(salida, `${toma.nombre}.json`), JSON.stringify(eventos, null, 1));
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('ok', destino, `${lista.length} cuadros, ${eventos.duracion} s`);
}
ws.close();
chrome.kill();
