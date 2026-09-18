import JsBarcode from 'jsbarcode';

export interface LabelProduct {
  id: string;
  name: string;
  barcode?: string | null;
  salePrice?: number;
}

export interface LabelFormat {
  id: string;
  name: string;
  description: string;
  kind: 'a4' | 'thermal';
  labelW: number; // mm
  labelH: number; // mm
  // A4 sheet layout (ignored for thermal rolls)
  cols?: number;
  rows?: number;
  marginTop?: number;
  marginLeft?: number;
  gapX?: number;
  gapY?: number;
  cutGuides?: boolean;
}

export const LABEL_FORMATS: LabelFormat[] = [
  {
    id: 'a4-plain-48x25', name: 'Hoja A4 común', description: '40 etiquetas de 48×25 mm con guías de corte',
    kind: 'a4', labelW: 48, labelH: 25, cols: 4, rows: 10, marginTop: 14.5, marginLeft: 6, gapX: 2, gapY: 2, cutGuides: true,
  },
  {
    id: 'a4-24-70x37', name: 'A4 autoadhesiva 24', description: '3×8 etiquetas de 70×37 mm',
    kind: 'a4', labelW: 70, labelH: 37, cols: 3, rows: 8, marginTop: 0.5, marginLeft: 0, gapX: 0, gapY: 0,
  },
  {
    id: 'a4-21-63x38', name: 'A4 autoadhesiva 21', description: '3×7 etiquetas de 63,5×38,1 mm',
    kind: 'a4', labelW: 63.5, labelH: 38.1, cols: 3, rows: 7, marginTop: 15.15, marginLeft: 7.25, gapX: 2.5, gapY: 0,
  },
  {
    id: 'a4-65-38x21', name: 'A4 autoadhesiva 65', description: '5×13 etiquetas chicas de 38,1×21,2 mm',
    kind: 'a4', labelW: 38.1, labelH: 21.2, cols: 5, rows: 13, marginTop: 10.7, marginLeft: 4.75, gapX: 2.5, gapY: 0,
  },
  { id: 'thermal-50x25', name: 'Térmica 50×25 mm', description: 'Rollo de etiquetas, la más común', kind: 'thermal', labelW: 50, labelH: 25 },
  { id: 'thermal-40x30', name: 'Térmica 40×30 mm', description: 'Rollo de etiquetas', kind: 'thermal', labelW: 40, labelH: 30 },
  { id: 'thermal-60x40', name: 'Térmica 60×40 mm', description: 'Rollo de etiquetas grandes', kind: 'thermal', labelW: 60, labelH: 40 },
];

export interface LabelOptions {
  showName: boolean;
  showPrice: boolean;
  /** A4 only: skip the first N positions of an already partially used sheet. */
  startPosition: number;
}

/** GTIN (EAN-8, UPC-A, EAN-13) check digit validation. */
function isValidGtin(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  const digits = code.split('').map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((acc, d, i) => acc + d * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
}

function barcodeFormatFor(code: string): string {
  if (code.length === 13 && isValidGtin(code)) return 'EAN13';
  if (code.length === 8 && isValidGtin(code)) return 'EAN8';
  if (code.length === 12 && isValidGtin(code)) return 'UPC';
  return 'CODE128';
}

/**
 * Renders a scannable barcode as an SVG string that stretches to fill its container.
 * Bars are scaled uniformly on each axis, which keeps the symbol readable.
 * Human-readable digits are drawn separately as HTML so they don't get distorted.
 */
export function renderBarcodeSvg(code: string): string | null {
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    JsBarcode(svg, code, {
      format: barcodeFormatFor(code),
      displayValue: false,
      margin: 0,
      width: 2,
      height: 60,
      flat: true,
    });
    const w = svg.getAttribute('width')?.replace('px', '') || '200';
    const h = svg.getAttribute('height')?.replace('px', '') || '60';
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.removeAttribute('style');
    return svg.outerHTML;
  } catch {
    return null;
  }
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const formatPrice = (n: number) => {
  const decimals = Number.isInteger(n) ? 0 : 2;
  return '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

/**
 * Tamaño del número impreso debajo de las barras. Se calcula según el ancho de la
 * etiqueta para que SIEMPRE entre completo: si el lector no lee el código, el
 * número tiene que poder tipearse a mano.
 */
function codeSize(code: string, format: LabelFormat): number {
  const usableWidth = format.labelW - 3; // márgenes internos
  const charWidth = 0.62; // ancho aproximado de un dígito monoespaciado
  const ideal = format.labelH < 24 ? 2.6 : 3.2;
  const maxThatFits = usableWidth / (Math.max(code.length, 1) * charWidth);
  return Math.max(1.7, Math.min(ideal, maxThatFits));
}

function labelHtml(p: LabelProduct, format: LabelFormat, opts: LabelOptions, svgCache: Map<string, string | null>): string {
  const code = (p.barcode || '').trim();
  if (!svgCache.has(code)) svgCache.set(code, code ? renderBarcodeSvg(code) : null);
  const svg = svgCache.get(code);

  const small = format.labelH < 24;
  const nameSize = small ? 2.3 : format.labelH >= 35 ? 3.2 : 2.7; // mm
  const priceSize = small ? 3 : format.labelH >= 35 ? 5 : 3.8;
  const nameLines = format.labelH >= 30 ? 2 : 1;

  return `
    <div class="lbl${format.cutGuides ? ' guides' : ''}" style="width:${format.labelW}mm;height:${format.labelH}mm">
      ${opts.showName ? `<div class="name" style="font-size:${nameSize}mm;-webkit-line-clamp:${nameLines}">${escapeHtml(p.name)}</div>` : ''}
      <div class="bars">${svg ?? `<div class="nobc">${code ? 'Código inválido' : 'Sin código'}</div>`}</div>
      <div class="foot">
        ${opts.showPrice && p.salePrice != null ? `<span class="price" style="font-size:${priceSize}mm">${formatPrice(p.salePrice)}</span>` : ''}
        <span class="code" style="font-size:${codeSize(code, format)}mm">${escapeHtml(code)}</span>
      </div>
    </div>`;
}

/** Builds a complete, self-contained printable HTML document. */
export function buildLabelsDocument(labels: LabelProduct[], format: LabelFormat, opts: LabelOptions): string {
  const svgCache = new Map<string, string | null>();
  const pages: string[] = [];

  if (format.kind === 'thermal') {
    for (const p of labels) {
      pages.push(`<div class="page" style="width:${format.labelW}mm;height:${format.labelH}mm">${labelHtml(p, format, opts, svgCache)}</div>`);
    }
  } else {
    const perPage = format.cols! * format.rows!;
    const slots: (LabelProduct | null)[] = [
      ...Array(Math.min(Math.max(0, opts.startPosition), perPage - 1)).fill(null),
      ...labels,
    ];
    for (let start = 0; start < slots.length; start += perPage) {
      const cells = slots.slice(start, start + perPage).map((p, i) => {
        if (!p) return '';
        const col = i % format.cols!;
        const row = Math.floor(i / format.cols!);
        const left = format.marginLeft! + col * (format.labelW + format.gapX!);
        const top = format.marginTop! + row * (format.labelH + format.gapY!);
        return `<div class="cell" style="left:${left}mm;top:${top}mm">${labelHtml(p, format, opts, svgCache)}</div>`;
      });
      pages.push(`<div class="page" style="width:210mm;height:297mm">${cells.join('')}</div>`);
    }
  }

  const pageSize = format.kind === 'thermal' ? `${format.labelW}mm ${format.labelH}mm` : 'A4 portrait';

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Etiquetas</title>
<style>
  @page { size: ${pageSize}; margin: 0; }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; font-family: Arial, Helvetica, sans-serif; color: #000; }
  .page { position: relative; overflow: hidden; background: #fff; break-after: page; page-break-after: always; }
  .page:last-child { break-after: auto; page-break-after: auto; }
  .cell { position: absolute; }
  .lbl { display: flex; flex-direction: column; padding: 1.2mm 2.5mm 1mm; overflow: hidden; }
  .lbl.guides { outline: 0.2mm dashed #999; }
  .name { font-weight: 700; line-height: 1.12; text-align: center; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; word-break: break-word; flex-shrink: 0; }
  .bars { flex: 1; min-height: 5mm; margin: 0.8mm 0 0.4mm; display: flex; }
  .bars svg { width: 100%; height: 100%; display: block; }
  .nobc { flex: 1; display: flex; align-items: center; justify-content: center; font-size: 2.5mm; color: #b91c1c; border: 0.2mm dashed #b91c1c; }
  /* El precio arriba y el número en su propio renglón: nunca se recorta */
  .foot { display: flex; flex-direction: column; align-items: center; flex-shrink: 0; line-height: 1.05; gap: 0.3mm; }
  .code { font-family: 'Courier New', monospace; font-weight: 700; letter-spacing: 0.15mm; white-space: nowrap; overflow: visible; color: #000; }
  .price { font-weight: 800; white-space: nowrap; }
  @media screen {
    body { background: #e2e8f0; padding: 16px; display: flex; flex-direction: column; align-items: center; gap: 16px; }
    .page { box-shadow: 0 2px 10px rgba(0,0,0,.18); flex-shrink: 0; }
    .lbl:not(.guides) { outline: 0.2mm solid #e2e8f0; }
  }
</style></head>
<body>${pages.join('')}</body></html>`;
}
