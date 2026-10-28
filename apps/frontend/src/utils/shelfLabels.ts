import { renderBarcodeSvg } from './barcodeLabels';
import { escapeHtml } from './escapeHtml';

/**
 * Etiquetas de góndola: el precio grande y claro, el nombre, el precio por litro o por kilo
 * (lo pide la ley de defensa del consumidor en las góndolas), y opcionalmente la foto, el
 * código de barras, la fecha del precio y el nombre del comercio. Se arman como un documento
 * HTML aparte (en mm) para que la impresión salga igual en cualquier impresora.
 */

export interface ShelfProduct {
  id: string;
  name: string;
  salePrice: number;
  barcode?: string | null;
  imageUrl?: string | null;
  brand?: string | null;
  unit?: string | null;
  /** Precio anterior (para el estilo "oferta": se muestra tachado si es mayor) */
  prevPrice?: number | null;
}

export interface ShelfFormat {
  id: string;
  name: string;
  description: string;
  kind: 'a4' | 'thermal';
  w: number; // mm
  h: number; // mm
  cols?: number;
  rows?: number;
  top?: number;
  left?: number;
  gapX?: number;
  gapY?: number;
  /** Hoja común: con guías para cortar */
  guides?: boolean;
}

export const SHELF_FORMATS: ShelfFormat[] = [
  { id: 'a4-60x35', name: 'Hoja A4 común', description: '24 etiquetas de 60×35 mm para recortar', kind: 'a4', w: 60, h: 35, cols: 3, rows: 8, top: 8.5, left: 12, gapX: 3, gapY: 0, guides: true },
  { id: 'a4-70x37', name: 'A4 autoadhesiva 24', description: '3×8 etiquetas de 70×37 mm', kind: 'a4', w: 70, h: 37.125, cols: 3, rows: 8, top: 0, left: 0 },
  { id: 'a4-63x38', name: 'A4 autoadhesiva 21', description: '3×7 etiquetas de 63,5×38,1 mm', kind: 'a4', w: 63.5, h: 38.1, cols: 3, rows: 7, top: 15.15, left: 7.25, gapX: 2.5, gapY: 0 },
  { id: 'a4-100x50', name: 'A4 grandes (ofertas)', description: '10 etiquetas de 100×50 mm', kind: 'a4', w: 100, h: 50, cols: 2, rows: 5, top: 23.5, left: 4, gapX: 2, gapY: 0, guides: true },
  { id: 'thermal-60x40', name: 'Térmica 60×40 mm', description: 'Rollo de etiquetas', kind: 'thermal', w: 60, h: 40 },
  { id: 'thermal-50x30', name: 'Térmica 50×30 mm', description: 'Rollo de etiquetas', kind: 'thermal', w: 50, h: 30 },
];

export interface ShelfOptions {
  showImage: boolean;
  showBarcode: boolean;
  showUnitPrice: boolean;
  showDate: boolean;
  showStore: boolean;
  offer: boolean;
  storeName?: string;
  /** Para resolver /api/... a una URL que cargue la etiqueta */
  resolveImage?: (url: string) => string | undefined;
}

/**
 * Contenido de la presentación según el nombre ("COCA-COLA 1,5 L" → 1,5 litros): para el
 * precio por litro o por kilo. null si no se entiende o es un pack ("6 x 500 ml").
 */
export function contentOf(name: string, unit?: string | null): { qty: number; per: 'litro' | 'kilo' } | null {
  const u = String(unit || '').toLowerCase();
  if (u === 'kg' || u === 'kilo') return { qty: 1, per: 'kilo' }; // se vende por kilo: el precio ya es por kilo
  if (u === 'l' || u === 'lt' || u === 'litro') return { qty: 1, per: 'litro' };
  const s = String(name || '').toLowerCase().replace(/(\d),(\d)/g, '$1.$2');
  if (/\b\d+\s*x\s*\d/.test(s)) return null; // packs: el precio por unidad confunde
  const re = /(\d+(?:\.\d+)?)\s*(kgs?|kilos?|grs?|gramos|g|lts?|litros?|l|ml|cc|cm3)\b/g;
  let m: RegExpExecArray | null;
  let last: RegExpExecArray | null = null;
  while ((m = re.exec(s))) last = m;
  if (!last) return null;
  const n = Number(last[1]);
  if (!(n > 0)) return null;
  const k = last[2];
  if (/^kg|^kilo/.test(k)) return { qty: n, per: 'kilo' };
  if (/^g/.test(k)) return { qty: n / 1000, per: 'kilo' };
  if (/^ml|^cc|^cm3/.test(k)) return { qty: n / 1000, per: 'litro' };
  return { qty: n, per: 'litro' };
}

const fmt = (n: number, dec = 0) => Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });

function priceParts(n: number): { int: string; dec: string } {
  const cents = Math.round((Number(n) || 0) * 100);
  const int = Math.floor(cents / 100);
  const dec = cents % 100;
  return { int: fmt(int), dec: dec ? String(dec).padStart(2, '0') : '' };
}

function labelHtml(p: ShelfProduct, f: ShelfFormat, o: ShelfOptions, today: string, svgCache: Map<string, string | null>): string {
  const big = f.h >= 45;
  const small = f.h < 33;
  const img = o.showImage && p.imageUrl ? (o.resolveImage ? o.resolveImage(p.imageUrl) : p.imageUrl) : null;
  const imgSize = Math.min(f.h * 0.62, f.w * 0.32);
  const { int, dec } = priceParts(p.salePrice);
  const priceSize = big ? 15 : small ? 8 : 10.5; // mm, el número entero
  const nameSize = big ? 4.2 : small ? 2.6 : 3.1;
  const content = o.showUnitPrice ? contentOf(p.name, p.unit) : null;
  const perUnit = content && p.salePrice > 0 && !(content.qty === 1 && /kg|kilo|^l$|litro/.test(String(p.unit || '').toLowerCase()))
    ? `Precio por ${content.per}: $ ${fmt(p.salePrice / content.qty, 2)}` : '';
  // Lo que se vende por peso o por litro: el precio ya es por kilo o por litro
  const u = String(p.unit || '').toLowerCase();
  const soldBy = /^(kg|kilo)/.test(u) ? 'el kilo' : /^(l|lt|litro)$/.test(u) ? 'el litro' : '';
  const code = o.showBarcode && p.barcode ? p.barcode : '';
  let svg: string | null = null;
  if (code) {
    if (!svgCache.has(code)) svgCache.set(code, renderBarcodeSvg(code));
    svg = svgCache.get(code) || null;
  }
  const was = o.offer && p.prevPrice && p.prevPrice > p.salePrice ? `<span class="was">$ ${fmt(p.prevPrice)}</span>` : '';
  const head = o.offer
    ? `<div class="band">OFERTA${o.showStore && o.storeName ? `<span>${escapeHtml(o.storeName)}</span>` : ''}</div>`
    : o.showStore && o.storeName ? `<div class="store">${escapeHtml(o.storeName)}</div>` : '';
  return `
    <div class="lbl${o.offer ? ' offer' : ''}${f.guides ? ' guides' : ''}" style="width:${f.w}mm;height:${f.h}mm">
      ${head}
      <div class="body">
        ${img ? `<div class="pic" style="width:${imgSize}mm;height:${imgSize}mm"><img src="${escapeHtml(img)}" alt=""></div>` : ''}
        <div class="main">
          <div class="name" style="font-size:${nameSize}mm;-webkit-line-clamp:${big ? 3 : 2}">${escapeHtml(p.name)}</div>
          ${p.brand && !small ? `<div class="brand">${escapeHtml(p.brand)}</div>` : ''}
          <div class="price">${was}<span class="cur" style="font-size:${priceSize * 0.42}mm">$</span><span class="int" style="font-size:${priceSize}mm">${int}</span>${dec ? `<span class="dec" style="font-size:${priceSize * 0.42}mm">${dec}</span>` : ''}</div>
          ${soldBy ? `<div class="by">${soldBy}</div>` : ''}
        </div>
      </div>
      <div class="foot">
        <div class="meta">
          ${perUnit ? `<div class="unit">${escapeHtml(perUnit)}</div>` : ''}
          ${o.showDate ? `<div class="date">Precio al ${today}</div>` : ''}
        </div>
        ${code ? `<div class="code">${svg ? `<div class="bars">${svg}</div>` : ''}<div class="num">${escapeHtml(code)}</div></div>` : ''}
      </div>
    </div>`;
}

export function buildShelfDocument(items: ShelfProduct[], f: ShelfFormat, o: ShelfOptions, startAt = 1): string {
  const today = new Date().toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  const svgCache = new Map<string, string | null>();
  const pages: string[] = [];
  if (f.kind === 'thermal') {
    for (const p of items) pages.push(`<div class="page" style="width:${f.w}mm;height:${f.h}mm">${labelHtml(p, f, o, today, svgCache)}</div>`);
  } else {
    const per = f.cols! * f.rows!;
    const slots: (ShelfProduct | null)[] = [...Array(Math.max(0, startAt - 1)).fill(null), ...items];
    for (let i = 0; i < slots.length; i += per) {
      const cells = slots.slice(i, i + per).map((p, j) => {
        if (!p) return '';
        const left = (f.left || 0) + (j % f.cols!) * (f.w + (f.gapX || 0));
        const top = (f.top || 0) + Math.floor(j / f.cols!) * (f.h + (f.gapY || 0));
        return `<div class="cell" style="left:${left}mm;top:${top}mm">${labelHtml(p, f, o, today, svgCache)}</div>`;
      });
      pages.push(`<div class="page" style="width:210mm;height:297mm">${cells.join('')}</div>`);
    }
  }
  const pageSize = f.kind === 'thermal' ? `${f.w}mm ${f.h}mm` : 'A4 portrait';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Etiquetas de góndola</title><style>
  @page { size: ${pageSize}; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { background: #fff; }
  body { font-family: 'Inter', 'Segoe UI', Arial, sans-serif; color: #0f172a; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .page { position: relative; overflow: hidden; page-break-after: always; break-after: page; background: #fff; }
  .page:last-child { page-break-after: auto; break-after: auto; }
  .cell { position: absolute; }
  .lbl { display: flex; flex-direction: column; overflow: hidden; padding: 1.6mm 2.2mm 1.4mm; border-radius: 1.2mm; border: 0.25mm solid #cbd5e1; background: #fff; }
  .lbl.guides { border: 0.2mm dashed #94a3b8; border-radius: 0; }
  .store { font-size: 2mm; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: 0.25mm; margin-bottom: 0.6mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .band { margin: -1.6mm -2.2mm 1.2mm; padding: 0.9mm 2.2mm; background: #dc2626; color: #fff; font-size: 2.8mm; font-weight: 900; letter-spacing: 0.6mm; display: flex; justify-content: space-between; align-items: center; }
  .band span { font-size: 1.9mm; font-weight: 700; letter-spacing: 0.2mm; opacity: .9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 60%; }
  .body { flex: 1; min-height: 0; display: flex; gap: 2mm; align-items: stretch; }
  .pic { flex-shrink: 0; display: flex; align-items: center; justify-content: center; }
  .pic img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .name { font-weight: 800; line-height: 1.12; text-transform: uppercase; display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; word-break: break-word; }
  .brand { font-size: 2.1mm; color: #64748b; font-weight: 600; margin-top: 0.3mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .price { margin-top: auto; display: flex; align-items: flex-start; justify-content: flex-end; line-height: 0.9; font-weight: 900; letter-spacing: -0.2mm; }
  .price .cur { margin-top: 0.6mm; margin-right: 0.5mm; font-weight: 800; }
  .price .dec { margin-top: 0.6mm; margin-left: 0.3mm; text-decoration: underline; }
  .by { text-align: right; font-size: 2.3mm; font-weight: 700; color: #334155; margin-top: 0.3mm; }
  .offer .price { color: #dc2626; }
  .was { align-self: center; margin-right: 1.5mm; font-size: 2.6mm; font-weight: 700; color: #64748b; text-decoration: line-through; }
  .foot { display: flex; justify-content: space-between; align-items: flex-end; gap: 1.5mm; margin-top: 0.8mm; flex-shrink: 0; }
  .meta { min-width: 0; line-height: 1.15; }
  .unit { font-size: 1.95mm; font-weight: 600; color: #334155; white-space: nowrap; }
  .date { font-size: 1.7mm; color: #94a3b8; white-space: nowrap; }
  .code { flex-shrink: 0; display: flex; flex-direction: column; align-items: center; }
  .bars { height: 4.5mm; width: 18mm; display: flex; }
  .bars svg { width: 100%; height: 100%; }
  .num { font-family: 'Courier New', monospace; font-size: 1.6mm; color: #475569; letter-spacing: 0.1mm; }
  @media screen {
    body { background: #e2e8f0; padding: 12px; }
    .page { margin: 0 auto 12px; box-shadow: 0 1px 4px rgba(15,23,42,.18); }
  }
  </style></head><body>${pages.join('') || '<p style="font-family:sans-serif;color:#64748b;text-align:center;margin-top:40px">Elegí productos para ver las etiquetas</p>'}</body></html>`;
}
