// Busca Fernet Branca 750 y Coca-Cola 2,25 L en los supermercados VTEX que usa el bot, toma el código
// de barras y baja la foto oficial con el mismo hdPhoto del bot (firebase/functions/promo-images/photos).
//   node scripts/reel-bot-fotos-reales.cjs
const fs = require("fs");
const path = require("path");
const photos = require(path.resolve(__dirname, "../../../firebase/functions/promo-images/photos"));

const HOSTS = ["https://www.carrefour.com.ar", "https://www.jumbo.com.ar", "https://www.disco.com.ar", "https://diaonline.supermercadosdia.com.ar", "https://www.masonline.com.ar"];
const BUSCAR = [
  { archivo: "real-fernet.png", q: "fernet branca 750", ok: /^(?!.*menta).*fernet branca.*750/i },
  { archivo: "real-coca.png", q: "coca cola 2.25", ok: /coca.?cola (sabor original )?(x )?2[.,]25/i },
];

(async () => {
  const dir = path.resolve(__dirname, "../public/reel-bot");
  for (const b of BUSCAR) {
    let hecho = false;
    for (const host of HOSTS) {
      try {
        const r = await fetch(`${host}/api/catalog_system/pub/products/search?ft=${encodeURIComponent(b.q)}&_from=0&_to=9`, { headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" } });
        if (!r.ok) { console.log(host, r.status); continue; }
        const lista = await r.json();
        for (const p of lista) {
          const ean = p.items && p.items[0] && p.items[0].ean;
          if (!b.ok.test(p.productName) || !photos.isEan(ean)) continue;
          const foto = await photos.hdPhoto(ean);
          if (!foto) continue;
          fs.writeFileSync(path.join(dir, b.archivo), foto.buf);
          console.log("ok", b.archivo, "|", p.productName, "|", ean, "|", foto.source);
          hecho = true;
          break;
        }
      } catch (e) { console.log(host, e.message); }
      if (hecho) break;
    }
    if (!hecho) console.log("NO ENCONTRÉ", b.q);
  }
})();
