// Arma la imagen de promo del reel "Mi kiosco me contesta" con el MISMO generador que usa el bot
// del dueño por WhatsApp (firebase/functions/promo-images): recorte del producto, diseño y Chrome.
//   node scripts/reel-bot-promo.cjs
const fs = require("fs");
const path = require("path");
const fn = path.resolve(__dirname, "../../../firebase/functions");
const photos = require(path.join(fn, "promo-images/photos"));
const designs = require(path.join(fn, "promo-images/designs"));
const { render, close } = require(path.join(fn, "promo-images/render"));

(async () => {
  const dir = path.resolve(__dirname, "../public/reel-bot");
  const c = await photos.cutout(fs.readFileSync(path.join(dir, "prod-cola.png")));
  const prod = { buf: c.png, mime: "image/png", width: c.width, height: c.height, display: "Cola 2,25 L" };
  const colors = { dark: "#0B4A3C", light: "#F7F3EC", accent: "#FFD23F", accentInk: "#13241E" };
  for (const style of designs.STYLES) {
    const spec = { style, colors, tweaks: {}, products: [prod, prod], price: 5990, oldPrice: 7000, texts: { titulo: "2 Colas 2,25 L", etiqueta: "Combo" } };
    const jpg = await render(designs.html(spec, "post"), designs.FORMATS.post);
    fs.writeFileSync(path.join(dir, `promo-${style}.jpg`), jpg);
    console.log("ok", style);
  }
  await close();
})().catch((e) => { console.error(e); process.exit(1); });
