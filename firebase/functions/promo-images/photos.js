// ═══════════════════════════════════════════════════
// Fotos de productos para las imágenes de promos.
//
// - La mejor foto: la oficial en alta de los supermercados online (VTEX, por código de barras
//   exacto, la misma fuente que usan la caja y GO); si no hay, la de la caja (300 px, en Storage).
// - Recorte: casi todas son de catálogo, sobre fondo blanco. Se borra el fondo que toca los bordes
//   y se queda solo con el producto (el pedazo más grande y lo que está encima de él): así se van
//   los carteles de costado ("2,25 litros", "menos azúcares") que traen algunas fotos.
//   Una foto que no es de catálogo (fondo que no es blanco) no se recorta: cut = false.
// ═══════════════════════════════════════════════════
const crypto = require("crypto");
const sharp = require("sharp");

const VTEX_HOSTS = [
  "https://www.carrefour.com.ar", "https://www.jumbo.com.ar", "https://www.disco.com.ar",
  "https://www.veasupermercados.com.ar", "https://diaonline.supermercadosdia.com.ar", "https://www.masonline.com.ar",
];
const HD = 800;
const PLACEHOLDERS = new Set(["II2I+lU6vOq2ZewYyBjAsg=="]);
const isEan = (code) => /^\d{8}$|^\d{12,14}$/.test(String(code || ""));
const imagePath = (uid, productId) => `tenants/${uid}/products/${String(productId).replace(/[^A-Za-z0-9_-]/g, "_")}`;

async function fetchBuf(url, ms = 8000, json = false) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0", Accept: json ? "application/json" : "image/*" } });
    if (!r.ok) return null;
    return json ? await r.json() : Buffer.from(await r.arrayBuffer());
  } catch { return null; } finally { clearTimeout(t); }
}

/** Foto oficial en alta por código de barras (o null) */
async function hdPhoto(barcode, { fetchJson = (u) => fetchBuf(u, 5000, true), fetchImage = (u) => fetchBuf(u, 10000) } = {}) {
  if (!isEan(barcode)) return null;
  for (const host of VTEX_HOSTS) {
    const data = await fetchJson(`${host}/api/catalog_system/pub/products/search?fq=alternateIds_Ean:${barcode}`);
    const product = Array.isArray(data) ? data[0] : null;
    const item = product && (product.items || []).find((i) => String(i.ean || "") === String(barcode));
    const url = item && item.images && item.images[0] && item.images[0].imageUrl;
    if (!url) continue;
    const buf = await fetchImage(url.replace(/\/ids\/(\d+)(-\d+-\d+)?\//, `/ids/$1-${HD}-${HD}/`));
    if (!buf || buf.length < 8000 || buf.length > 4_000_000) continue;
    if (PLACEHOLDERS.has(crypto.createHash("md5").update(buf).digest("base64"))) continue;
    return { buf, source: new URL(host).hostname.replace(/^www\./, "") };
  }
  return null;
}

/** La foto de un producto: alta por código de barras, si no la de la caja. { buf, source } o null */
async function productPhoto({ bucket, uid, hd = hdPhoto }, product) {
  const big = product.barcode ? await hd(product.barcode).catch(() => null) : null;
  if (big) return big;
  if (!bucket || !product.hasImage) return null;
  const [buf] = await bucket.file(imagePath(uid, product.id)).download().catch(() => [null]);
  if (!buf) return null;
  // La caja la guarda como bytes o, en versiones viejas, como data URL en texto
  const head = buf.toString("utf8", 0, 30);
  return { buf: head.startsWith("data:") ? Buffer.from(buf.toString("utf8").split(",")[1], "base64") : buf, source: "caja" };
}

/**
 * Recorta el producto. Devuelve { png, cut, width, height } (png con fondo transparente si cut).
 * tolerance: cuánto puede alejarse del color del borde un píxel para contar como fondo.
 */
async function cutout(input, { maxSide = 900, tolerance = 34 } = {}) {
  const img = sharp(input).rotate().ensureAlpha().resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true });
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, N = W * H;
  const px = (i) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]];

  // Color del fondo: el más repetido del borde (un cartel que toca el borde no lo cambia), si es
  // claro y ocupa la mayor parte del borde (foto de catálogo)
  const border = [];
  for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x);
  for (let y = 0; y < H; y++) border.push(y * W, y * W + W - 1);
  const groups = new Map();
  let opaque = 0;
  for (const i of border) {
    const p = px(i);
    if (p[3] < 20) continue;
    opaque++;
    const key = `${p[0] >> 4},${p[1] >> 4},${p[2] >> 4}`;
    const gr = groups.get(key) || { n: 0, r: 0, g: 0, b: 0 };
    gr.n++; gr.r += p[0]; gr.g += p[1]; gr.b += p[2];
    groups.set(key, gr);
  }
  const transparentBorder = opaque < border.length * 0.5;
  const top = [...groups.values()].sort((a, c) => c.n - a.n)[0];
  const bg = top ? [top.r / top.n, top.g / top.n, top.b / top.n] : [255, 255, 255];
  const bgLight = Math.min(...bg) > 200;
  const near = (i) => {
    const p = px(i);
    if (p[3] < 20) return true;
    return Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]) <= tolerance * 3 && Math.max(Math.abs(p[0] - bg[0]), Math.abs(p[1] - bg[1]), Math.abs(p[2] - bg[2])) <= tolerance * 1.4;
  };
  const evenBorder = border.filter((i) => near(i)).length / border.length;
  if (!transparentBorder && (!bgLight || evenBorder < 0.6)) {
    const png = await sharp(input).rotate().resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    return { png, cut: false, width: W, height: H };
  }

  // 1. Fondo: todo lo parecido al borde que se puede alcanzar desde el borde
  const isBg = new Uint8Array(N);
  const queue = new Int32Array(N);
  let qh = 0, qt = 0;
  for (const i of border) if (!isBg[i] && near(i)) { isBg[i] = 1; queue[qt++] = i; }
  while (qh < qt) {
    const i = queue[qh++], x = i % W, y = (i / W) | 0;
    const next = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
    for (const j of next) if (j >= 0 && !isBg[j] && near(j)) { isBg[j] = 1; queue[qt++] = j; }
  }

  // 2. Pedazos que quedan (el producto y, a veces, carteles o textos sueltos)
  const comp = new Int32Array(N).fill(-1);
  const parts = [];
  for (let s = 0; s < N; s++) {
    if (isBg[s] || comp[s] >= 0) continue;
    const id = parts.length;
    const part = { id, area: 0, x0: W, y0: H, x1: 0, y1: 0 };
    qh = 0; qt = 0; queue[qt++] = s; comp[s] = id;
    while (qh < qt) {
      const i = queue[qh++], x = i % W, y = (i / W) | 0;
      part.area++;
      if (x < part.x0) part.x0 = x; if (x > part.x1) part.x1 = x;
      if (y < part.y0) part.y0 = y; if (y > part.y1) part.y1 = y;
      const next = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, y > 0 ? i - W : -1, y < H - 1 ? i + W : -1];
      for (const j of next) if (j >= 0 && !isBg[j] && comp[j] < 0) { comp[j] = id; queue[qt++] = j; }
    }
    parts.push(part);
  }
  if (!parts.length) {
    const png = await sharp(input).rotate().resize(maxSide, maxSide, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    return { png, cut: false, width: W, height: H };
  }
  // El producto: el pedazo grande con forma de producto. Los carteles y las cajas que algunas fotos
  // traen al lado son rectángulos casi llenos: cuentan la mitad, así gana la botella o el paquete.
  // Lo que toca el costado de la foto (carteles de costado) cuenta todavía menos.
  const touchesSide = (p) => p.x0 <= 1 || p.x1 >= W - 2;
  const fill = (p) => p.area / ((p.x1 - p.x0 + 1) * (p.y1 - p.y0 + 1));
  const score = (p) => p.area * (fill(p) > 0.9 ? 0.5 : 1) * (touchesSide(p) ? 0.3 : 1);
  const main = parts.reduce((a, p) => (score(p) > score(a) ? p : a));
  // Se quedan el producto y lo que está casi todo dentro de su caja (tapa, etiqueta despegada).
  // Se va lo demás: carteles, cajas al costado, textos y cuadritos.
  const keep = new Set(parts.filter((p) => {
    if (p === main) return true;
    const ix = Math.max(0, Math.min(p.x1, main.x1) - Math.max(p.x0, main.x0) + 1);
    const iy = Math.max(0, Math.min(p.y1, main.y1) - Math.max(p.y0, main.y0) + 1);
    return (ix * iy) / ((p.x1 - p.x0 + 1) * (p.y1 - p.y0 + 1)) > 0.8;
  }).map((p) => p.id));

  // 3. Transparencia, con el borde del producto suavizado (medio transparente al lado del fondo)
  const out = Buffer.from(data);
  let x0 = W, y0 = H, x1 = 0, y1 = 0;
  for (let i = 0; i < N; i++) {
    const inside = !isBg[i] && keep.has(comp[i]);
    if (!inside) { out[i * 4 + 3] = 0; continue; }
    const x = i % W, y = (i / W) | 0;
    const edge = (x > 0 && isBg[i - 1]) || (x < W - 1 && isBg[i + 1]) || (y > 0 && isBg[i - W]) || (y < H - 1 && isBg[i + W]);
    if (edge) out[i * 4 + 3] = Math.min(out[i * 4 + 3], 150);
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const pad = 2;
  const left = Math.max(0, x0 - pad), topY = Math.max(0, y0 - pad);
  const width = Math.min(W - left, x1 - x0 + 1 + pad * 2), height = Math.min(H - topY, y1 - y0 + 1 + pad * 2);
  const png = await sharp(out, { raw: { width: W, height: H, channels: 4 } }).extract({ left, top: topY, width, height }).png().toBuffer();
  return { png, cut: true, width, height, dropped: parts.length - keep.size };
}

module.exports = { hdPhoto, productPhoto, cutout, isEan, imagePath };
