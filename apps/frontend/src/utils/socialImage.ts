/**
 * Imagen para redes de un grupo de productos (Instagram, estados de WhatsApp): se dibuja en un
 * lienzo del tamaño exacto (1080×1080 o 1080×1920), así se ve nítida y la vista previa es la
 * misma imagen que se descarga. Lleva el logo y el nombre del comercio, un título, los productos
 * en una grilla que se adapta a la cantidad, y el WhatsApp o la dirección al pie.
 */

export type SocialFormat = 'feed' | 'story';
export type SocialStyle = 'clasico' | 'oscuro' | 'color';

export interface SocialProduct {
  name: string;
  price: number;
  /** Precio anterior: si es mayor, se muestra tachado */
  prevPrice?: number | null;
  /** URL que se puede dibujar (data:, o de la PC con ?inline=1) */
  image?: string | null;
}

export interface SocialOptions {
  format: SocialFormat;
  style: SocialStyle;
  accent: string;
  title: string;
  subtitle?: string;
  storeName?: string;
  logo?: string | null;
  phone?: string;
  address?: string;
  showImages: boolean;
}

export const ACCENTS = [
  { id: '#e11d48', name: 'Rojo' }, { id: '#0e6e52', name: 'Verde' }, { id: '#2563eb', name: 'Azul' },
  { id: '#ea580c', name: 'Naranja' }, { id: '#7c3aed', name: 'Violeta' }, { id: '#111827', name: 'Negro' },
];

export const SOCIAL_SIZE: Record<SocialFormat, { w: number; h: number; max: number }> = {
  feed: { w: 1080, h: 1080, max: 9 },
  story: { w: 1080, h: 1920, max: 12 },
};

const FONT = `"Inter", "Segoe UI", Arial, sans-serif`;
const money = (n: number) => `$ ${Math.round(Number(n) || 0).toLocaleString('es-AR')}`;

const imageCache = new Map<string, Promise<HTMLImageElement | null>>();
export function loadImage(src: string): Promise<HTMLImageElement | null> {
  if (!imageCache.has(src)) {
    imageCache.set(src, new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
      setTimeout(() => resolve(null), 10000);
    }));
  }
  return imageCache.get(src)!;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Corta un texto en renglones que entren en el ancho (con "…" si sobra) */
function lines(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const out: string[] = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width <= maxW) { cur = t; continue; }
    if (cur) out.push(cur);
    cur = w;
    if (out.length === maxLines) break;
  }
  if (out.length < maxLines && cur) out.push(cur);
  if (out.length === maxLines && words.join(' ') !== out.join(' ')) {
    let last = out[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
    out[maxLines - 1] = `${last.replace(/[\s,.-]+$/, '')}…`;
  }
  return out;
}

/** Ajusta el tamaño de letra para que el texto entre en una línea */
function fit(ctx: CanvasRenderingContext2D, text: string, maxW: number, size: number, weight = 900, min = 18) {
  let s = size;
  ctx.font = `${weight} ${s}px ${FONT}`;
  while (s > min && ctx.measureText(text).width > maxW) { s -= 2; ctx.font = `${weight} ${s}px ${FONT}`; }
  return s;
}

/** Columnas y filas según cuántos productos hay */
function grid(n: number, format: SocialFormat): { cols: number; rows: number } {
  if (format === 'feed') {
    if (n <= 1) return { cols: 1, rows: 1 };
    if (n === 2) return { cols: 2, rows: 1 };
    if (n <= 4) return { cols: 2, rows: 2 };
    if (n <= 6) return { cols: 3, rows: 2 };
    return { cols: 3, rows: 3 };
  }
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n === 2) return { cols: 1, rows: 2 };
  if (n <= 4) return { cols: 2, rows: 2 };
  if (n <= 6) return { cols: 2, rows: 3 };
  if (n <= 8) return { cols: 2, rows: 4 };
  return { cols: 3, rows: 4 };
}

export async function drawSocialImage(canvas: HTMLCanvasElement, items: SocialProduct[], o: SocialOptions) {
  const { w: W, h: H, max } = SOCIAL_SIZE[o.format];
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const dark = o.style === 'oscuro';
  const filled = o.style === 'color';
  const bg = dark ? '#0f172a' : filled ? o.accent : '#f8fafc';
  const ink = dark || filled ? '#ffffff' : '#0f172a';
  const soft = dark || filled ? 'rgba(255,255,255,0.75)' : '#475569';
  const shown = items.slice(0, max);
  const extra = items.length - shown.length;

  // Fotos y logo antes de dibujar
  const [logo, ...photos] = await Promise.all([
    o.logo ? loadImage(o.logo) : Promise.resolve(null),
    ...shown.map((p) => (o.showImages && p.image ? loadImage(p.image) : Promise.resolve(null))),
  ]);

  // Alto del encabezado (comercio, título y bajada): la franja del estilo clásico lo cubre entero
  const story = o.format === 'story';
  const headTop = story ? 110 : 64;
  const storeRow = logo || o.storeName ? 84 + (story ? 40 : 22) : 0;
  const titleBase = story ? 92 : 72;
  const headBottom = headTop + storeRow + titleBase * 0.85 + (o.subtitle ? (story ? 58 : 46) : 0);

  // Fondo
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  if (o.style === 'clasico') {
    ctx.fillStyle = o.accent;
    ctx.fillRect(0, 0, W, headBottom + (story ? 60 : 40));
  } else {
    // Dos manchas suaves del color, para que no quede plano
    const blob = (x: number, y: number, r: number, color: string) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    };
    blob(W * 0.95, 0, 520, dark ? `${o.accent}66` : 'rgba(255,255,255,0.22)');
    blob(0, H, 560, dark ? `${o.accent}40` : 'rgba(0,0,0,0.12)');
  }

  const PAD = 64;
  const onBand = o.style === 'clasico';
  const headInk = onBand ? '#ffffff' : ink;
  const headSoft = onBand ? 'rgba(255,255,255,0.85)' : soft;
  let y = o.format === 'story' ? 110 : 64;

  // Comercio: logo y nombre
  if (logo || o.storeName) {
    let x = PAD;
    if (logo) {
      const s = 84;
      ctx.save();
      roundRect(ctx, x, y, s, s, 20); ctx.fillStyle = '#ffffff'; ctx.fill(); ctx.clip();
      const k = Math.min((s - 12) / logo.width, (s - 12) / logo.height);
      ctx.drawImage(logo, x + (s - logo.width * k) / 2, y + (s - logo.height * k) / 2, logo.width * k, logo.height * k);
      ctx.restore();
      x += s + 22;
    }
    if (o.storeName) {
      ctx.fillStyle = headInk;
      fit(ctx, o.storeName.toUpperCase(), W - x - PAD, 34, 800);
      ctx.textBaseline = 'middle';
      ctx.fillText(o.storeName.toUpperCase(), x, y + 42);
      ctx.textBaseline = 'alphabetic';
    }
    y += 84 + (o.format === 'story' ? 40 : 22);
  }

  // Título y bajada
  ctx.fillStyle = headInk;
  const titleSize = fit(ctx, o.title || 'Ofertas', W - PAD * 2, o.format === 'story' ? 92 : 72, 900, 40);
  y += titleSize * 0.85;
  ctx.fillText(o.title || 'Ofertas', PAD, y);
  if (o.subtitle) {
    ctx.fillStyle = headSoft;
    fit(ctx, o.subtitle, W - PAD * 2, o.format === 'story' ? 40 : 32, 600, 20);
    y += o.format === 'story' ? 58 : 46;
    ctx.fillText(o.subtitle, PAD, y);
  }
  y = onBand ? headBottom + (story ? 60 : 40) + (story ? 50 : 32) : y + (story ? 70 : 40);

  // Pie: WhatsApp, dirección y la marca de Ventra
  const footH = o.format === 'story' ? 170 : 104;
  const footY = H - footH;
  const contact = [o.phone ? `WhatsApp ${o.phone}` : '', o.address || ''].filter(Boolean).join('  ·  ');
  ctx.textBaseline = 'middle';
  if (contact) {
    ctx.fillStyle = ink;
    fit(ctx, contact, W - PAD * 2 - 220, o.format === 'story' ? 34 : 28, 700, 18);
    ctx.fillText(contact, PAD, footY + footH / 2);
  }
  ctx.fillStyle = dark || filled ? 'rgba(255,255,255,0.5)' : '#94a3b8';
  ctx.font = `600 20px ${FONT}`;
  const credit = 'Hecho con Ventra';
  ctx.fillText(credit, W - PAD - ctx.measureText(credit).width, footY + footH / 2);
  ctx.textBaseline = 'alphabetic';

  // Productos
  const { cols, rows } = grid(shown.length, o.format);
  const gap = 24;
  const areaH = footY - y - (extra > 0 ? 70 : 10);
  const cw = (W - PAD * 2 - gap * (cols - 1)) / cols;
  const ch = Math.min((areaH - gap * (rows - 1)) / rows, cols === 1 ? 760 : 9999);
  const top = y + Math.max(0, (areaH - (ch * rows + gap * (rows - 1))) / 2);
  shown.forEach((p, i) => {
    const cx = PAD + (i % cols) * (cw + gap);
    const cy = top + Math.floor(i / cols) * (ch + gap);
    ctx.save();
    ctx.shadowColor = 'rgba(15,23,42,0.18)'; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
    roundRect(ctx, cx, cy, cw, ch, 28);
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.08)' : '#ffffff';
    ctx.fill();
    ctx.restore();
    if (dark) { roundRect(ctx, cx, cy, cw, ch, 28); ctx.strokeStyle = 'rgba(255,255,255,0.14)'; ctx.lineWidth = 2; ctx.stroke(); }

    const inner = 22;
    const cardInk = dark ? '#ffffff' : '#0f172a';
    const priceSize = Math.max(30, Math.min(cols === 1 ? 120 : 72, cw / (cols === 1 ? 6 : 5.4), ch / 4.2));
    const nameSize = Math.max(20, Math.min(cols === 1 ? 46 : 30, cw / 13, ch / 10));
    ctx.font = `800 ${nameSize}px ${FONT}`;
    const nameLines = lines(ctx, p.name, cw - inner * 2, 2).length;
    const textH = nameSize * 1.18 * nameLines + priceSize * 1.15 + inner * 0.6;
    const photo = photos[i];
    const picH = o.showImages && photo ? Math.max(0, ch - textH - inner * 2) : 0;
    if (photo && picH > 40) {
      // En el oscuro, la foto va sobre un fondo blanco (casi todas tienen fondo blanco)
      if (dark) { roundRect(ctx, cx + inner, cy + inner, cw - inner * 2, picH, 18); ctx.fillStyle = '#ffffff'; ctx.fill(); }
      const pad = dark ? 12 : 0;
      const k = Math.min((cw - inner * 2 - pad * 2) / photo.width, (picH - pad * 2) / photo.height);
      const pw = photo.width * k, ph = photo.height * k;
      ctx.drawImage(photo, cx + (cw - pw) / 2, cy + inner + (picH - ph) / 2, pw, ph);
    }
    const prev = p.prevPrice && p.prevPrice > p.price ? p.prevPrice : null;
    if (prev) {
      // Cinta "OFERTA" arriba a la izquierda
      ctx.fillStyle = o.accent === '#111827' ? '#e11d48' : o.accent;
      roundRect(ctx, cx + 16, cy + 16, 150, 44, 22); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.font = `900 22px ${FONT}`; ctx.textBaseline = 'middle';
      ctx.fillText('OFERTA', cx + 16 + (150 - ctx.measureText('OFERTA').width) / 2, cy + 38); ctx.textBaseline = 'alphabetic';
    }
    let ty = o.showImages && picH > 40 ? cy + inner + picH + inner + nameSize : cy + Math.max(inner + nameSize, (ch - textH) / 2 + nameSize);
    ctx.fillStyle = cardInk;
    ctx.font = `800 ${nameSize}px ${FONT}`;
    const ls = lines(ctx, p.name, cw - inner * 2, 2);
    ls.forEach((l, k) => ctx.fillText(l, cx + (cw - ctx.measureText(l).width) / 2, ty + k * nameSize * 1.18));
    ty += (ls.length - 1) * nameSize * 1.18 + priceSize * 1.1;
    const price = money(p.price);
    ctx.fillStyle = dark ? '#ffffff' : (o.accent === '#111827' ? '#0f172a' : o.accent);
    fit(ctx, price, cw - inner * 2 - (prev ? 0 : 0), priceSize, 900, 24);
    let pw2 = ctx.measureText(price).width;
    let px = cx + (cw - pw2) / 2;
    if (prev) {
      const was = money(prev);
      const ws = Math.max(18, priceSize * 0.38);
      ctx.font = `700 ${ws}px ${FONT}`;
      const ww = ctx.measureText(was).width;
      const total = ww + 16 + pw2;
      if (total <= cw - inner * 2) {
        const sx = cx + (cw - total) / 2;
        ctx.fillStyle = dark ? 'rgba(255,255,255,0.6)' : '#94a3b8';
        ctx.fillText(was, sx, ty);
        ctx.fillRect(sx, ty - ws * 0.35, ww, Math.max(2, ws / 10));
        px = sx + ww + 16;
      }
      ctx.fillStyle = dark ? '#ffffff' : (o.accent === '#111827' ? '#0f172a' : o.accent);
      fit(ctx, price, cw - inner * 2, priceSize, 900, 24);
      pw2 = ctx.measureText(price).width;
    }
    ctx.fillText(price, px, ty);
  });

  if (extra > 0) {
    ctx.fillStyle = soft;
    ctx.font = `700 ${o.format === 'story' ? 34 : 28}px ${FONT}`;
    const t = `+ ${extra} ${extra === 1 ? 'producto más' : 'productos más'} en el local`;
    ctx.fillText(t, (W - ctx.measureText(t).width) / 2, footY - 24);
  }
}

/** Baja la imagen (o la comparte, en el celular, si se puede) */
export async function exportSocialImage(canvas: HTMLCanvasElement, fileName: string, share = false): Promise<'shared' | 'downloaded'> {
  const blob: Blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('sin imagen'))), 'image/png'));
  const file = new File([blob], fileName, { type: 'image/png' });
  const nav: any = navigator;
  if (share && nav.canShare && nav.canShare({ files: [file] })) {
    await nav.share({ files: [file] });
    return 'shared';
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'downloaded';
}
