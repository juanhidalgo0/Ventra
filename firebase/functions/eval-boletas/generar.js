// ═══════════════════════════════════════════════════
// Fotos de las boletas fabricadas (tanda 2.2): HTML → imagen con el Chrome de la PC (promo-images/render.js)
// y después arruinadas con sharp: girada, borrosa, con sombra, cortada y con otro papel atrás.
// Las imágenes NO van al repo (se generan iguales cada vez): quedan en .boletas-eval/fabricadas/.
//
//   node eval-boletas/generar.js            (todas)
//   node eval-boletas/generar.js factura-b  (las que empiezan así)
// ═══════════════════════════════════════════════════
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { BOLETAS, html, ARRUINAR } = require("./fabricadas");

const OUT = path.resolve(__dirname, "../../../.boletas-eval/fabricadas");
const W = 1240, H = 1754;

/** Una forma de arruinar la foto. base y otra: PNG de la hoja limpia (otra = otra boleta, para "papel-atras"). */
async function arruinar(kind, base, otra, rows = 8) {
  const img = () => sharp(base);
  if (kind === "limpia") return img().jpeg({ quality: 85 }).toBuffer();
  if (kind === "girada") return img().rotate(6, { background: "#d9d4c7" }).jpeg({ quality: 82 }).toBuffer();
  if (kind === "borrosa") return img().resize({ width: 1000 }).blur(2.2).jpeg({ quality: 78 }).toBuffer();
  if (kind === "sombra") {
    const shade = Buffer.from(`<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="0.55" stop-color="#000" stop-opacity="0.15"/><stop offset="1" stop-color="#000" stop-opacity="0.62"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/></svg>`);
    return img().composite([{ input: shade }]).jpeg({ quality: 80 }).toBuffer();
  }
  // Cortada abajo justo después de los renglones: se pierde el pie (el total)
  if (kind === "cortada") return img().extract({ left: 0, top: 0, width: W, height: Math.min(Math.round(H * 0.8), 340 + (rows + 1) * 38) }).jpeg({ quality: 82 }).toBuffer();
  if (kind === "papel-atras") {
    const back = await sharp(otra).rotate(-5, { background: "#00000000" }).resize({ width: Math.round(W * 0.95) }).png().toBuffer();
    const front = await sharp(base).resize({ width: Math.round(W * 0.86) }).png().toBuffer();
    return sharp({ create: { width: W + 200, height: H + 160, channels: 3, background: "#8a7f72" } })
      .composite([{ input: back, left: 10, top: -140 }, { input: front, left: 150, top: 230 }])
      .jpeg({ quality: 82 }).toBuffer();
  }
  throw new Error(`forma desconocida: ${kind}`);
}

async function main() {
  const filtro = process.argv[2] || "";
  fs.mkdirSync(OUT, { recursive: true });
  const render = require("../promo-images/render");
  const pngs = {};
  try {
    for (const b of BOLETAS) pngs[b.id] = await render.render(html(b), { width: W, height: H, format: "png" });
  } finally {
    await render.close();
  }
  let n = 0;
  for (const [k, b] of BOLETAS.entries()) {
    if (filtro && !b.id.startsWith(filtro)) continue;
    const otra = pngs[BOLETAS[(k + 1) % BOLETAS.length].id];
    for (const kind of ARRUINAR) {
      fs.writeFileSync(path.join(OUT, `${b.id}__${kind}.jpg`), await arruinar(kind, pngs[b.id], otra, b.items.length));
      n++;
    }
  }
  console.log(`${n} fotos en ${OUT}`);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { OUT, arruinar };
