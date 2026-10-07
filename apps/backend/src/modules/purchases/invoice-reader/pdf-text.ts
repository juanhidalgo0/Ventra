/**
 * Texto de un PDF con su posición en la hoja, agrupado en renglones.
 * Sirve para las facturas electrónicas y remitos que traen el texto adentro (los generan
 * los sistemas de facturación); un PDF escaneado (una foto) no trae texto y devuelve vacío.
 */
// Build "legacy" (CommonJS, apto para Node) y el worker cargado a mano: así funciona
// empaquetado con ncc, sin buscar archivos sueltos.
// Solo se lee texto, no se dibuja: estas piezas de dibujo no hacen falta (y evitan avisos de "canvas")
const g = globalThis as any;
g.DOMMatrix ??= class DOMMatrix {};
g.Path2D ??= class Path2D {};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
(globalThis as any).pdfjsWorker = require('pdfjs-dist/legacy/build/pdf.worker.js');

export interface PdfCell {
  text: string;
  x: number;
  x2: number;
}

export interface PdfLine {
  page: number;
  y: number;
  cells: PdfCell[];
  /** Texto completo del renglón, con un espacio entre celdas */
  text: string;
}

/** Dos trozos de texto en la misma altura (± esto) son del mismo renglón */
const SAME_LINE = 2.5;

export async function readPdfLines(buffer: Buffer): Promise<PdfLine[]> {
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // Los PDF vienen de terceros: nada de ejecutar código armado desde el archivo
    // (CVE-2024-4367) ni de cargar sus fuentes
    isEvalSupported: false,
    disableFontFace: true,
    useSystemFonts: false,
    verbosity: 0,
  }).promise;

  const lines: PdfLine[] = [];
  try {
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const pieces = (content.items as any[])
        .filter((it) => typeof it.str === 'string' && it.str.trim() !== '')
        .map((it) => {
          const x = it.transform[4];
          const y = it.transform[5];
          const width = it.width || it.str.length * Math.abs(it.transform[0]) * 0.5;
          return { text: it.str.replace(/\s+/g, ' ').trim(), x, x2: x + width, y };
        });

      // De arriba hacia abajo, y de izquierda a derecha en cada renglón
      pieces.sort((a, b) => b.y - a.y || a.x - b.x);
      const pageLines: { y: number; cells: PdfCell[] }[] = [];
      for (const piece of pieces) {
        const line = pageLines.find((l) => Math.abs(l.y - piece.y) <= SAME_LINE);
        if (line) line.cells.push(piece);
        else pageLines.push({ y: piece.y, cells: [piece] });
      }
      for (const l of pageLines) {
        l.cells.sort((a, b) => a.x - b.x);
        const cells = mergeTouching(l.cells);
        lines.push({ page: p, y: l.y, cells, text: cells.map((c) => c.text).join(' ') });
      }
      page.cleanup();
    }
  } finally {
    await doc.destroy();
  }
  return lines;
}

/** Une trozos pegados (un mismo valor partido en varios pedazos por el generador del PDF) */
function mergeTouching(cells: PdfCell[]): PdfCell[] {
  const out: PdfCell[] = [];
  for (const c of cells) {
    const prev = out[out.length - 1];
    if (prev && c.x - prev.x2 < 1.2) {
      prev.text = `${prev.text}${c.x - prev.x2 > 0.3 ? ' ' : ''}${c.text}`;
      prev.x2 = Math.max(prev.x2, c.x2);
    } else {
      out.push({ text: c.text, x: c.x, x2: c.x2 });
    }
  }
  return out;
}
