// ═══════════════════════════════════════════════════
// Diseños de las imágenes de promos (HTML que se dibuja con Chromium, ver render.js).
//
// Tres estilos, cada uno en post (1080 × 1080) e historia (1080 × 1920), con o sin precio y
// para uno o varios productos (combo):
//   nocturno    fondo oscuro con rayos y el precio en un sticker del color de acento
//   precio      fondo claro, el producto grande y el precio en una estrella
//   invitacion  sin precio (o con el precio chico): invita a pedir
//
// Todo lo que sale escrito (nombre, precio, textos) lo pone el diseño: nunca lo dibuja una IA,
// así sale exacto. Los colores vienen del kit de marca (brand.js). Las medidas van en cqw
// (1/100 del ancho), así el mismo diseño sirve para cualquier tamaño.
// Los textos se achican solos hasta entrar en su lugar (fitText, al final de la página).
// ═══════════════════════════════════════════════════

const FORMATS = { post: { width: 1080, height: 1080 }, story: { width: 1080, height: 1920 } };
const FONTS = "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Oswald:wght@500;600;700&family=Inter:wght@500;600&family=Caveat:wght@700&display=block";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = (n) => `$${Math.round(Number(n) || 0).toLocaleString("es-AR")}`;
const img = (p) => `data:${p.mime || "image/png"};base64,${p.buf.toString("base64")}`;

/** Texto que se achica solo: caja de ancho y alto fijos, letra máxima en cqw */
const fit = (cls, text, { max, min = 3 }) => `<div class="${cls} fit" data-max="${max}" data-min="${min}"><span>${text}</span></div>`;

/** Los productos, uno al lado del otro y apoyados en la misma línea (con "+" entre ellos si es combo) */
function productRow(products, { box, plus, accent, accentInk }) {
  const n = products.length;
  const gap = n > 1 ? 3 : 0;
  // Cada producto ocupa un ancho proporcional a su forma; todos con la misma altura máxima
  const ratios = products.map((p) => p.width / p.height);
  const total = ratios.reduce((a, r) => a + r, 0);
  const usableW = box.w - gap * (n - 1);
  const h = Math.min(box.h, usableW / total);
  let x = box.x + (box.w - (total * h + gap * (n - 1))) / 2;
  const parts = [];
  products.forEach((p, i) => {
    const w = ratios[i] * h;
    parts.push(`<img class="prod" src="${img(p)}" style="left:${x.toFixed(2)}cqw;top:${(box.y + box.h - h).toFixed(2)}cqw;width:${w.toFixed(2)}cqw;height:${h.toFixed(2)}cqw">`);
    if (plus && i < n - 1) {
      const px = x + w + gap / 2 - 5.5;
      parts.push(`<div class="plus" style="left:${px.toFixed(2)}cqw;top:${(box.y + box.h - h * 0.62).toFixed(2)}cqw;background:${accent};color:${accentInk}">+</div>`);
    }
    x += w + gap;
  });
  return parts.join("");
}

function baseCss(c, t) {
  const priceScale = Number(t.priceScale) || 1;
  return `
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{width:100%;height:100%;background:${c.dark}}
  .c{position:relative;width:100vw;height:100vh;overflow:hidden;container-type:inline-size;font-family:Inter,sans-serif}
  .c>*{position:absolute}
  .fit{display:flex;overflow:hidden}
  .fit>span{display:block;width:100%}
  .rays{inset:-30%}
  .scene{inset:0;width:100%;height:100%;object-fit:cover}
  .prod{object-fit:contain;filter:drop-shadow(0 2.2cqw 2.4cqw rgba(0,0,0,.45))}
  .plus{width:11cqw;height:11cqw;border-radius:50%;font:400 10cqw/11.6cqw 'Bebas Neue';text-align:center;box-shadow:0 0 0 1cqw rgba(0,0,0,.35);z-index:3}
  .logo{border-radius:50%;object-fit:contain;z-index:4}
  .logo.sq{border-radius:2cqw}
  .bebas{font-family:'Bebas Neue',sans-serif;font-weight:400;line-height:.88}
  .price{font-family:'Bebas Neue',sans-serif;line-height:1;white-space:nowrap;--ps:${priceScale}}
  .was{font:600 4.2cqw/1 Oswald;text-decoration:line-through;opacity:.7}
  .save{font:700 3.6cqw/1 Oswald;letter-spacing:.08em}
  .small{font:600 3cqw/1.25 Oswald;letter-spacing:.12em;text-transform:uppercase}
  .hand{font-family:Caveat,cursive;font-weight:700;line-height:1}`;
}

/** Lo común de cada pedido: textos ya escapados y con valores por defecto */
function copyOf(spec) {
  const k = spec.texts || {};
  const many = spec.products.length > 1;
  const title = k.titulo || (many ? "COMBO" : spec.products[0].display);
  // La etiqueta no repite lo que ya dice el título ("COMBO" arriba de "COMBO PREVIA")
  let kicker = String(k.etiqueta || (spec.price ? "PROMO" : "")).toUpperCase();
  if (kicker && String(title).toUpperCase().includes(kicker)) kicker = "";
  return {
    kicker: esc(kicker),
    title: esc(String(title).toUpperCase()),
    detail: esc((k.detalle || (many ? spec.products.map((p) => p.display).join(" + ") : "")).toUpperCase()),
    tagline: esc(k.frase || ""),
    cta: esc((k.accion || "PEDILO YA").toUpperCase()),
    footer: esc(k.cierre || (spec.tweaks && spec.tweaks.signature) || ""),
    price: spec.price ? money(spec.price) : "",
    was: spec.oldPrice && spec.oldPrice > spec.price ? money(spec.oldPrice) : "",
    save: spec.oldPrice && spec.oldPrice > spec.price ? `AHORRÁS ${money(spec.oldPrice - spec.price)}` : "",
  };
}

const logoTag = (spec, style) => (spec.logo ? `<img class="logo${spec.logoSquare ? " sq" : ""}" src="data:image/png;base64,${spec.logo.toString("base64")}" style="${style}">` : "");
const sceneTag = (spec, overlay) => (spec.scene ? `<img class="scene" src="data:${spec.scene.mime || "image/jpeg"};base64,${(spec.scene.buf || spec.scene).toString("base64")}"><div style="inset:0;background:${overlay}"></div>` : "");

// ── Estilo 1: nocturno ──
function nocturno(spec, format) {
  const c = spec.colors, t = copyOf(spec), story = format === "story";
  const many = spec.products.length > 1;
  const H = story ? 177.78 : 100;
  const bg = `radial-gradient(circle at ${many || story ? 50 : 66}% ${story ? 52 : 48}%, ${mix(c.dark, "#ffffff", 0.16)} 0, ${c.dark} 64%)`;
  const rays = `repeating-conic-gradient(from 0deg at ${many || story ? 50 : 66}% ${story ? 55 : 50}%, ${hexA(c.light, 0.1)} 0deg 1.2deg, transparent 1.2deg 9deg)`;
  const glow = `<div style="left:${many || story ? 15 : 36}cqw;top:${story ? 62 : 14}cqw;width:${story ? 70 : 60}cqw;height:${story ? 70 : 60}cqw;border-radius:50%;background:radial-gradient(circle, ${hexA(c.accent, 0.42)} 0, transparent 66%)"></div>`;
  let body;
  if (story) {
    body = `${logoTag(spec, "left:38cqw;top:7cqw;width:24cqw;height:24cqw")}
      ${t.kicker ? `<div class="small" style="left:0;right:0;top:37cqw;text-align:center;color:${c.accent};font-size:4.4cqw;letter-spacing:.3em">${t.kicker}</div>` : ""}
      ${fit("bebas", t.title, { max: 20 }).replace('class="bebas fit"', `class="bebas fit" style="left:6cqw;width:88cqw;top:44cqw;height:38cqw;align-items:center;text-align:center;color:${c.light}"`)}
      ${productRow(spec.products, { box: { x: 10, y: 82, w: 80, h: 52 }, plus: many, accent: c.accent, accentInk: c.accentInk })}
      ${t.price ? `<div class="price" style="left:0;right:0;top:${t.was ? 143 : 141}cqw;text-align:center;color:${c.accentInk}"><span style="display:inline-block;background:${c.accent};padding:1.4cqw 5cqw .2cqw;font-size:calc(19cqw * var(--ps));transform:rotate(-3deg);box-shadow:1.2cqw 1.2cqw 0 ${c.light}">${t.price}</span></div>` : `<div class="bebas" style="left:0;right:0;top:144cqw;text-align:center;font-size:12cqw"><span style="display:inline-block;background:${c.light};color:${c.dark};padding:2cqw 6cqw 1cqw;border-radius:99cqw">${t.cta}</span></div>`}
      ${t.was ? `<div class="save" style="left:0;right:0;top:137cqw;text-align:center;color:${c.accent}">${t.save} · <span class="was" style="color:${c.light}">${t.was}</span></div>` : ""}
      <div class="small" style="left:6cqw;right:6cqw;bottom:3.5cqw;text-align:center;color:${hexA(c.light, 0.8)};font-size:3.6cqw">${[t.detail, t.footer].filter(Boolean).join("<br>")}</div>`;
  } else if (many) {
    body = `${logoTag(spec, "left:5cqw;top:5cqw;width:17cqw;height:17cqw")}
      ${fit("bebas", t.title !== "COMBO" ? t.title : t.kicker || t.title, { max: 6.4, min: 3.6 }).replace('class="bebas fit"', `class="bebas fit" style="right:5cqw;top:6cqw;max-width:60cqw;height:9.6cqw;color:${c.dark};background:${c.light};padding:1.6cqw 3cqw .8cqw;border-radius:2cqw;transform:rotate(3deg);white-space:nowrap"`).replace("<span>", '<span style="width:auto">')}
      ${productRow(spec.products, { box: { x: 10, y: 14, w: 80, h: 50 }, plus: true, accent: c.accent, accentInk: c.accentInk })}
      ${fit("bebas", t.detail || t.title, { max: 7, min: 3.4 }).replace('class="bebas fit"', `class="bebas fit" style="left:6cqw;width:88cqw;top:66cqw;height:8cqw;align-items:center;text-align:center;color:${c.light}"`)}
      ${t.save ? `<div class="save" style="left:6cqw;bottom:12cqw;color:${c.accent}">${t.save}</div><div class="was" style="left:6cqw;bottom:6cqw;color:${c.light}">ANTES ${t.was}</div>` : `<div class="small" style="left:6cqw;bottom:7cqw;width:40cqw;color:${hexA(c.light, 0.75)}">${t.footer}</div>`}
      ${t.price ? `<div class="price" style="right:6cqw;bottom:5cqw;font-size:min(calc(15cqw * var(--ps)), 18.5cqw);color:${c.accentInk};background:${c.accent};padding:1.2cqw 3cqw .2cqw;transform:rotate(-3deg);box-shadow:1.2cqw 1.2cqw 0 ${c.light}">${t.price}</div>` : `<div class="bebas" style="right:6cqw;bottom:6cqw;font-size:7cqw;color:${c.dark};background:${c.light};padding:2cqw 4cqw 1.2cqw;border-radius:99cqw">${t.cta} →</div>`}`;
  } else {
    body = `${logoTag(spec, "left:5cqw;top:5cqw;width:21cqw;height:21cqw")}
      ${productRow(spec.products, { box: { x: 44, y: 8, w: 50, h: 84 }, plus: false, accent: c.accent, accentInk: c.accentInk })}
      ${t.kicker ? `<div class="bebas" style="left:6cqw;top:31cqw;width:40cqw;font-size:6.2cqw;color:${c.accent};letter-spacing:.05em">${t.kicker}</div>` : ""}
      ${fit("bebas", t.title, { max: 13 }).replace('class="bebas fit"', `class="bebas fit" style="left:6cqw;top:38cqw;width:40cqw;height:28cqw;align-items:flex-start;color:${c.light}"`)}
      ${t.price ? `<div class="price" style="left:6cqw;bottom:${t.detail || t.footer ? 14 : 8}cqw;font-size:min(calc(14.5cqw * var(--ps)), 17cqw);color:${c.accentInk};background:${c.accent};padding:1.4cqw 3cqw .4cqw;transform:rotate(-4deg);box-shadow:1.2cqw 1.2cqw 0 ${c.light}">${t.price}</div>` : `<div class="bebas" style="left:6cqw;bottom:${t.detail || t.footer ? 14 : 8}cqw;font-size:7cqw;color:${c.dark};background:${c.light};padding:2cqw 4cqw 1.2cqw;border-radius:99cqw">${t.cta} →</div>`}
      ${t.detail || t.footer ? fit("small", t.detail || t.footer, { max: 3.2, min: 2 }).replace('class="small fit"', `class="small fit" style="left:6cqw;bottom:5cqw;width:46cqw;height:4.4cqw;align-items:flex-end;white-space:nowrap;color:${hexA(c.light, 0.7)}"`) : ""}`;
  }
  return frame(spec, format, `background:${bg}`, `${sceneTag(spec, `linear-gradient(180deg, ${hexA(c.dark, 0.35)}, ${hexA(c.dark, 0.85)})`)}<div class="rays" style="background:${rays}"></div>${glow}${body}`, H);
}

// ── Estilo 2: precio protagonista ──
function precio(spec, format) {
  const c = spec.colors, t = copyOf(spec), story = format === "story";
  const many = spec.products.length > 1;
  const paper = spec.tweaks && spec.tweaks.lightBackground === false ? mix(c.dark, "#ffffff", 0.12) : "#fbfaf6";
  const ink = luminanceOf(paper) > 0.45 ? c.dark : c.light;
  const star = "polygon(50% 0,61% 13%,77% 6%,79% 23%,96% 25%,88% 40%,100% 52%,86% 62%,92% 79%,75% 79%,70% 96%,56% 87%,44% 100%,36% 85%,20% 93%,19% 76%,3% 72%,12% 58%,0 46%,13% 35%,7% 19%,24% 18%,28% 2%,42% 12%)";
  const starColor = c.accent2 && c.accent2 !== "#ffffff" ? c.accent2 : c.accent;
  const starInk = c.accent2 && c.accent2 !== "#ffffff" ? c.accent2Ink : c.accentInk;
  let body;
  if (story) {
    body = `<div style="left:0;right:0;bottom:0;height:52cqw;background:${c.dark}"></div>
      ${logoTag(spec, "left:38cqw;top:7cqw;width:24cqw;height:24cqw")}
      ${t.kicker && t.kicker !== "PROMO" ? `<div class="small" style="left:0;right:0;top:35cqw;text-align:center;color:${starColor};font-size:4.4cqw;letter-spacing:.3em">${t.kicker}</div>` : ""}
      ${fit("bebas", t.title, { max: 17 }).replace('class="bebas fit"', `class="bebas fit" style="left:6cqw;width:88cqw;top:41cqw;height:28cqw;align-items:center;text-align:center;color:${ink}"`)}
      ${productRow(spec.products, many ? { box: { x: 10, y: 70, w: 80, h: 64 }, plus: true, accent: c.accent, accentInk: c.accentInk } : { box: { x: 14, y: 68, w: 72, h: 76 }, plus: false, accent: c.accent, accentInk: c.accentInk })}
      <div style="right:5cqw;top:120cqw;width:44cqw;height:44cqw;background:${starColor};clip-path:${star}"></div>
      <div class="price" style="right:5cqw;top:${t.price ? (t.was ? 135 : 137) : 135}cqw;width:44cqw;text-align:center;color:${starInk};font-size:${t.price ? "calc(12cqw * var(--ps))" : "8.5cqw"};line-height:.9;white-space:normal;transform:rotate(-8deg)">${t.price || t.cta.replace(" ", "<br>")}</div>
      ${t.was ? `<div class="was" style="left:6cqw;bottom:24cqw;color:${c.light}">ANTES ${t.was}</div><div class="save" style="left:6cqw;bottom:30cqw;color:${c.accent}">${t.save}</div>` : ""}
      <div class="bebas" style="left:6cqw;bottom:13cqw;width:50cqw;font-size:7cqw;color:${c.light}">${t.detail || t.kicker}</div>
      <div style="left:6cqw;bottom:7cqw;font:500 3.4cqw/1.3 Inter;color:${hexA(c.light, 0.7)}">${t.footer}</div>`;
  } else {
    body = `<div style="left:0;right:0;bottom:0;height:30cqw;background:${c.dark}"></div>
      ${productRow(spec.products, { box: many ? { x: 3, y: 10, w: 48, h: 62 } : { x: 4, y: 6, w: 50, h: 78 }, plus: many, accent: c.accent, accentInk: c.accentInk })}
      ${logoTag(spec, "right:6cqw;top:6cqw;width:17cqw;height:17cqw")}
      ${t.kicker && t.kicker !== "PROMO" ? `<div class="small" style="right:6cqw;top:26cqw;width:44cqw;text-align:right;color:${starColor};font-size:3.4cqw;letter-spacing:.18em">${t.kicker}</div>` : ""}
      ${fit("bebas", t.title, { max: 11 }).replace('class="bebas fit"', `class="bebas fit" style="right:6cqw;top:31cqw;width:44cqw;height:26cqw;align-items:flex-start;text-align:right;color:${ink}"`)}
      <div style="right:4cqw;bottom:8cqw;width:36cqw;height:36cqw;background:${starColor};clip-path:${star}"></div>
      <div class="price" style="right:4cqw;bottom:${t.price ? (t.was ? 21 : 19) : 18}cqw;width:36cqw;text-align:center;color:${starInk};font-size:${t.price ? "calc(11cqw * var(--ps))" : "7.6cqw"};line-height:.9;white-space:normal;transform:rotate(-8deg)">${t.price || t.cta.replace(" ", "<br>")}</div>
      ${t.was ? `<div class="save" style="left:6cqw;bottom:19.5cqw;color:${c.accent}">${t.save}</div>` : ""}
      ${fit("bebas", t.detail || t.kicker || t.cta, { max: 7, min: 3.6 }).replace('class="bebas fit"', `class="bebas fit" style="left:6cqw;bottom:11cqw;width:52cqw;height:7.5cqw;align-items:flex-end;color:${c.light}"`)}
      <div style="left:6cqw;bottom:5cqw;width:52cqw;font:500 3cqw/1.2 Inter;color:${hexA(c.light, 0.65)}">${t.was ? `Antes ${t.was}` : t.footer}</div>`;
  }
  return frame(spec, format, `background:${paper}`, `${sceneTag(spec, `linear-gradient(180deg, ${hexA(paper, 0.55)}, ${hexA(paper, 0.2)})`)}${body}`, story ? 177.78 : 100);
}

// ── Estilo 3: invitación (pensado sin precio) ──
function invitacion(spec, format) {
  const c = spec.colors, t = copyOf(spec), story = format === "story";
  const many = spec.products.length > 1;
  const bg = `linear-gradient(160deg, ${mix(c.dark, "#ffffff", 0.06)} 0, ${c.dark} 55%, ${mix(c.dark, c.accent, 0.28)} 100%)`;
  const rays = `repeating-conic-gradient(from 0deg at 30% ${story ? 66 : 62}%, ${hexA(c.accent, 0.12)} 0deg 1.2deg, transparent 1.2deg 10deg)`;
  const hook = t.kicker && t.kicker !== "PROMO" ? t.kicker : "¿SALE?";
  const title = `<span style="color:${c.light}">${hook}</span><br><span style="color:${c.accent}">${t.title}</span>`;
  let body;
  if (story) {
    body = `${logoTag(spec, "right:6cqw;top:6cqw;width:20cqw;height:20cqw")}
      ${fit("bebas", title, { max: 18 }).replace('class="bebas fit"', 'class="bebas fit" style="left:6cqw;top:8cqw;width:66cqw;height:44cqw;align-items:flex-start"')}
      ${productRow(spec.products, { box: { x: 8, y: 60, w: 84, h: 70 }, plus: many, accent: c.accent, accentInk: c.accentInk })}
      ${t.tagline ? `<div class="hand" style="left:6cqw;right:6cqw;top:134cqw;text-align:center;font-size:9cqw;color:${c.light};transform:rotate(-3deg)">${t.tagline}</div>` : ""}
      ${t.price ? `<div class="price" style="left:0;right:0;top:146cqw;text-align:center;font-size:calc(10cqw * var(--ps));color:${c.accent}">${t.price}</div>` : ""}
      <div class="bebas" style="left:0;right:0;bottom:7cqw;text-align:center;font-size:9cqw"><span style="display:inline-block;background:${c.light};color:${c.dark};padding:2cqw 6cqw 1cqw;border-radius:99cqw">${t.cta} →</span></div>`;
  } else {
    body = `${logoTag(spec, "right:6cqw;top:6cqw;width:16cqw;height:16cqw")}
      ${fit("bebas", title, { max: 14 }).replace('class="bebas fit"', 'class="bebas fit" style="left:6cqw;top:6cqw;width:68cqw;height:30cqw;align-items:flex-start"')}
      ${productRow(spec.products, { box: many ? { x: 2, y: 36, w: 58, h: 58 } : { x: 6, y: 34, w: 44, h: 62 }, plus: many, accent: c.accent, accentInk: c.accentInk })}
      ${t.tagline ? `<div class="hand" style="right:6cqw;top:44cqw;width:40cqw;text-align:right;font-size:7cqw;color:${c.light};transform:rotate(-5deg)">${t.tagline}</div>` : ""}
      ${t.price ? `<div class="price" style="right:6cqw;bottom:${t.was ? 24 : 20}cqw;font-size:calc(11cqw * var(--ps));color:${c.accent}">${t.price}</div>${t.was ? `<div class="was" style="right:6cqw;bottom:19cqw;color:${c.light}">${t.was}</div>` : ""}` : ""}
      <div class="bebas" style="right:6cqw;bottom:7cqw;font-size:6.6cqw;color:${c.dark};background:${c.light};padding:2cqw 4cqw 1.2cqw;border-radius:99cqw;letter-spacing:.04em">${t.cta} →</div>`;
  }
  return frame(spec, format, `background:${bg}`, `${sceneTag(spec, `linear-gradient(160deg, ${hexA(c.dark, 0.55)}, ${hexA(c.dark, 0.88)})`)}<div class="rays" style="background:${rays}"></div>${body}`, story ? 177.78 : 100);
}

// ── Página ──
function frame(spec, format, canvasStyle, inner) {
  return `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${FONTS}"><style>${baseCss(spec.colors, spec.tweaks || {})}</style></head>
<body><div class="c" style="${canvasStyle}">${inner}</div>
<script>
// Achica cada texto hasta que entra en su caja (alto y ancho)
window.fitText = function () {
  const W = document.querySelector('.c').clientWidth / 100;
  for (const el of document.querySelectorAll('.fit')) {
    const span = el.firstElementChild;
    let size = Number(el.dataset.max), min = Number(el.dataset.min);
    span.style.fontSize = size * W + 'px';
    while (size > min && (span.scrollHeight > el.clientHeight + 1 || span.scrollWidth > el.clientWidth + 1)) {
      size -= 0.25;
      span.style.fontSize = size * W + 'px';
    }
  }
  return true;
};
</script></body></html>`;
}

// ── Colores (sin depender de brand.js, para que el diseño se pueda probar solo) ──
function rgb(h) { const n = parseInt(String(h).replace("#", ""), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function hexA(h, a) { const [r, g, b] = rgb(h); return `rgba(${r},${g},${b},${a})`; }
function mix(a, b, t) { const x = rgb(a), y = rgb(b); return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("")}`; }
function luminanceOf(h) { const [r, g, b] = rgb(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }

const BUILDERS = { nocturno, precio, invitacion };

/**
 * HTML de una imagen. spec: { style, colors, tweaks, logo (Buffer), products: [{ buf, mime, width,
 * height, display }], price, oldPrice, texts: { etiqueta, titulo, detalle, frase, accion, cierre },
 * scene (Buffer, opcional) }. format: "post" | "story".
 */
function html(spec, format = "post") {
  const build = BUILDERS[spec.style] || nocturno;
  return build(spec, format);
}

module.exports = { html, FORMATS, STYLES: Object.keys(BUILDERS), money, copyOf };
