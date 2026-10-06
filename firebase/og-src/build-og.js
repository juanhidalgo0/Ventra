// Genera las imágenes para compartir (1200×630) de cada página a partir de og.html, con Chrome sin
// ventana, y las guarda en firebase/web/og/<página>.jpg (JPG liviano: WhatsApp no muestra vistas
// previas pesadas). Uso: node firebase/og-src/build-og.js
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const SRC = path.join(__dirname, 'og.html').replace(/\\/g, '/');
const OUT = path.join(__dirname, '..', 'web', 'og');
const PAGES = ['home', 'tienda-online', 'turnos', 'peluquerias'];

fs.mkdirSync(OUT, { recursive: true });
for (const page of PAGES) {
  const png = path.join(OUT, `${page}.png`);
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
    '--window-size=1200,630', '--virtual-time-budget=6000', '--allow-file-access-from-files',
    `--screenshot=${png}`, `file:///${SRC}?v=${page}`,
  ], { stdio: 'ignore' });
  // PNG → JPG con Pillow (calidad 86)
  execFileSync('python', ['-c', `from PIL import Image; im = Image.open(r"${png}").convert("RGB"); im.save(r"${png.replace(/\.png$/, '.jpg')}", "JPEG", quality=86, optimize=True, progressive=True)`]);
  fs.unlinkSync(png);
  console.log(page, Math.round(fs.statSync(png.replace(/\.png$/, '.jpg')).size / 1024) + ' KB');
}
