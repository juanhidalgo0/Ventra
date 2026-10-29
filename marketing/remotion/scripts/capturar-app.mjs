// Captura pantallas reales de la app (vista de desarrollo con datos de prueba, sin nube) en tamaño
// celular y alta resolución, para usarlas en los videos. Maneja Chrome por CDP, sin dependencias.
//
//   node scripts/capturar-app.mjs <capturas.json> <carpeta de salida>
//
// capturas.json: { "base": "http://localhost:5181/reel-tienda.html?...", "ancho": 390, "alto": 844,
//   "movil": true (false = la caja de la PC, por ejemplo 1280x800 con escala 2), "storage": { "clave": "valor" },
//   "sesion": { "clave": "valor" } (sessionStorage), "tomas": [ { "nombre": "x", "ruta": "#/agenda", "pasos": [...], "completa": false } ] }
// Pasos: { "click": "texto" } · { "scroll": "texto" } · { "scrollY": 400 } · { "espera": 800 } · { "js": "código" }
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const [, , archivo, salida] = process.argv;
const cfg = JSON.parse(fs.readFileSync(archivo, 'utf8'));
fs.mkdirSync(salida, { recursive: true });
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PUERTO = 9333;
const perfil = fs.mkdtempSync(path.join(os.tmpdir(), 'captura-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PUERTO}`, `--user-data-dir=${perfil}`, '--hide-scrollbars', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
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
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pendientes.has(m.id)) { pendientes.get(m.id)(m); pendientes.delete(m.id); }
});
const cdp = (method, params = {}) => new Promise((res, rej) => {
  const n = ++id;
  pendientes.set(n, (m) => (m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result)));
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evaluar = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;

const ancho = cfg.ancho || 390, alto = cfg.alto || 844, escala = cfg.escala || 3;
await cdp('Page.enable');
await cdp('Runtime.enable');
const movil = cfg.movil !== false;
await cdp('Emulation.setDeviceMetricsOverride', { width: ancho, height: alto, deviceScaleFactor: escala, mobile: movil });
if (movil) await cdp('Emulation.setTouchEmulationEnabled', { enabled: true });
// localStorage antes de que arranque la app (oculta "Primeros pasos", recorridos, etc.)
const storage = JSON.stringify(cfg.storage || {}), sesion = JSON.stringify(cfg.sesion || {});
await cdp('Page.addScriptToEvaluateOnNewDocument', { source: `try { const s = ${storage}; for (const k in s) localStorage.setItem(k, s[k]); const t = ${sesion}; for (const k in t) sessionStorage.setItem(k, t[k]); } catch {}` });

// Busca el elemento visible más chico cuyo texto contiene `t`
const BUSCAR = `(t) => { const els = [...document.querySelectorAll('body *')].filter((el) => {
  const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (el.innerText || '').includes(t); });
  return els.sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0] || null; }`;

for (const toma of cfg.tomas) {
  await cdp('Page.navigate', { url: cfg.base + (toma.ruta || '') });
  await pausa(toma.carga || 3500);
  for (const p of toma.pasos || []) {
    if (p.click) {
      const ok = await evaluar(`(() => { const el = (${BUSCAR})(${JSON.stringify(p.click)}); if (!el) return false; (el.closest('button,a,[role=button]') || el).click(); return true; })()`);
      if (!ok) console.warn(`  [${toma.nombre}] no encontré "${p.click}"`);
      await pausa(p.espera ?? 900);
    } else if (p.scroll) {
      const ok = await evaluar(`(() => { const el = (${BUSCAR})(${JSON.stringify(p.scroll)}); if (!el) return false; el.scrollIntoView({ block: '${p.bloque || 'start'}' }); return true; })()`);
      if (!ok) console.warn(`  [${toma.nombre}] no encontré "${p.scroll}"`);
      await pausa(p.espera ?? 600);
    } else if (p.scrollY != null) {
      await evaluar(`window.scrollBy(0, ${p.scrollY}); document.querySelectorAll('*').forEach((el) => { if (el.scrollHeight > el.clientHeight + 20 && getComputedStyle(el).overflowY.match(/auto|scroll/)) el.scrollTop += ${p.scrollY}; })`);
      await pausa(p.espera ?? 500);
    } else if (p.js) {
      await evaluar(p.js);
      await pausa(p.espera ?? 400);
    } else if (p.espera) await pausa(p.espera);
  }
  // medir: dónde quedó cada texto (en px de la pantalla de 390), para resaltarlo en el video
  if (toma.medir) {
    const rects = await evaluar(`(() => { const out = {}; for (const t of ${JSON.stringify(toma.medir)}) {
      const els = [...document.querySelectorAll('body *')].filter((el) => { const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (el.innerText || '').trim().startsWith(t) && ![...el.children].some((c) => (c.innerText || '').trim().startsWith(t)); });
      out[t] = els.map((el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }); } return out; })()`);
    fs.writeFileSync(path.join(salida, `${toma.nombre}.json`), JSON.stringify(rects, null, 1));
  }
  const shot = await cdp('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!toma.completa });
  const destino = path.join(salida, `${toma.nombre}.png`);
  fs.writeFileSync(destino, Buffer.from(shot.data, 'base64'));
  console.log('ok', destino);
}
ws.close();
chrome.kill();
