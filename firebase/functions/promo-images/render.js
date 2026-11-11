// ═══════════════════════════════════════════════════
// HTML → imagen, con Chromium sin pantalla.
// En Cloud Functions usa @sparticuz/chromium (hace falta 2 GiB de memoria); en una PC, el
// Chrome instalado (o el de CHROME_PATH). Un mismo navegador sirve para varias imágenes seguidas.
// ═══════════════════════════════════════════════════
const fs = require("fs");
const sharp = require("sharp");

const LOCAL_CHROME = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

let browserPromise = null;

async function browser() {
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b && b.connected) return b;
  }
  const puppeteer = require("puppeteer-core");
  browserPromise = (async () => {
    const local = !process.env.K_SERVICE && LOCAL_CHROME.find((p) => fs.existsSync(p));
    if (local) return puppeteer.launch({ executablePath: local, headless: true, args: ["--no-sandbox", "--font-render-hinting=none"] });
    const chromium = require("@sparticuz/chromium");
    return puppeteer.launch({ executablePath: await chromium.executablePath(), headless: true, args: [...chromium.args, "--font-render-hinting=none"] });
  })();
  return browserPromise;
}

/**
 * Dibuja el HTML del tamaño pedido. Devuelve un JPG (o PNG si format: "png").
 * El HTML trae window.fitText (designs.js): se llama cuando cargaron las letras.
 */
async function render(html, { width, height, format = "jpeg", quality = 90 }) {
  const b = await browser();
  const page = await b.newPage();
  try {
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 25000 });
    await page.evaluate(async () => {
      await document.fonts.ready;
      if (window.fitText) window.fitText();
    });
    const png = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height } });
    return format === "png" ? Buffer.from(png) : sharp(png).jpeg({ quality, mozjpeg: true }).toBuffer();
  } finally {
    await page.close().catch(() => {});
  }
}

async function close() {
  if (!browserPromise) return;
  const b = await browserPromise.catch(() => null);
  browserPromise = null;
  if (b) await b.close().catch(() => {});
}

module.exports = { render, close };
