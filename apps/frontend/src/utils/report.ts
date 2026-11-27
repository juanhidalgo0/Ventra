/**
 * Informes descargables: cada pantalla arma un `Report` (título, período, resumen y tablas) y
 * de ahí salen los dos archivos con el mismo diseño de Ventra:
 *  - Excel (.xlsx real): una hoja por tabla, encabezado verde, números como números con
 *    formato de pesos, totales, filtros y la fila de títulos fija.
 *  - PDF nativo (texto nítido, se puede buscar y copiar): encabezado con el nombre y el logo
 *    del comercio, tarjetas de resumen, tablas que no se cortan a mitad de fila y repiten el
 *    encabezado en cada página, totales y "Página X de Y".
 */
import { buildXlsx, toDate, toNumber, type CellType, type CellValue, type XlsxSheet } from './xlsx';

export type { CellType, CellValue };

export interface ReportColumn {
  header: string;
  type?: CellType;
  /** Ancho en Excel (caracteres); si no, se calcula */
  width?: number;
}
export interface ReportTable {
  title?: string;
  columns: ReportColumn[];
  rows: CellValue[][];
  /** Fila de totales (la primera celda suele ser "Total") */
  totals?: CellValue[];
  /** Texto cuando no hay filas */
  emptyText?: string;
}
export interface ReportSummaryItem {
  label: string;
  value: CellValue;
  type?: CellType;
  tone?: 'good' | 'bad' | 'warn';
}
export interface Report {
  title: string;
  subtitle?: string;
  /** Nombre del archivo sin extensión (se le agrega el comercio si no lo tiene) */
  fileName: string;
  summary?: ReportSummaryItem[];
  tables: ReportTable[];
  notes?: string[];
  orientation?: 'portrait' | 'landscape';
}

// ---------- formato ----------
const nf0 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 0 });
const nf2 = new Intl.NumberFormat('es-AR', { maximumFractionDigits: 2 });
const nfMoney = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nfPct = new Intl.NumberFormat('es-AR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function formatCell(v: CellValue, t: CellType = 'text'): string {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (t === 'date' || t === 'datetime') {
    const d = toDate(v);
    if (!d) return String(v);
    const day = d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    return t === 'date' ? day : `${day} ${d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false })}`;
  }
  if (t === 'text') return v instanceof Date ? formatCell(v, 'datetime') : String(v);
  const n = toNumber(v);
  if (n === null) return String(v);
  if (t === 'money') return `${n < 0 ? '-' : ''}$ ${nfMoney.format(Math.abs(n))}`;
  if (t === 'percent') return `${nfPct.format(n)}%`;
  if (t === 'int') return nf0.format(n);
  return nf2.format(n);
}

/** Nombre y datos del comercio guardados en Configuración → Tu comercio */
export function storeInfo() {
  const get = (k: string) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
  return { name: get('gd_store_name').trim(), logo: get('gd_store_logo'), cuit: get('gd_store_cuit').trim(), address: get('gd_store_address').trim() };
}

// Las fechas (27/11/2026) quedan 27-11-2026; el resto de lo que Windows no acepta, espacio
const cleanFileName = (s: string) => s.replace(/(\d)\/(?=\d)/g, '$1-').replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Informe';

function fullFileName(r: Report) {
  const store = storeInfo().name;
  const base = r.fileName || r.title;
  return cleanFileName(store && !base.toLowerCase().includes(store.toLowerCase()) ? `${base} - ${store}` : base);
}

export function saveBlobAs(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10000);
}

/** "noviembre 2026", "01/11/2026 al 27/11/2026" o "Hoy, 27/11/2026" */
export function periodLabel(from?: Date | string | null, to?: Date | string | null) {
  const f = toDate(from ?? null), t = toDate(to ?? null);
  if (!f && !t) return '';
  const d = (x: Date) => x.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  if (f && t) {
    const last = new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate();
    if (f.getDate() === 1 && f.getMonth() === t.getMonth() && f.getFullYear() === t.getFullYear() && t.getDate() === last) {
      return f.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' }).replace(' de ', ' ');
    }
    if (d(f) === d(t)) return d(f);
    return `${d(f)} al ${d(t)}`;
  }
  return d((f || t)!);
}

// ---------- Excel ----------
export function downloadReportXlsx(r: Report) {
  const store = storeInfo().name;
  const subtitle = [store, r.subtitle].filter(Boolean).join(' · ');
  const sheets: XlsxSheet[] = [];
  const many = r.tables.length > 1;
  const generated = `Generado el ${formatCell(new Date(), 'datetime')} con Ventra`;
  if (r.summary?.length && (many || !r.tables.length)) {
    sheets.push({ name: 'Resumen', title: r.title, subtitle, summary: r.summary, columns: [], rows: [], notes: [...(r.notes || []), generated] });
  }
  r.tables.forEach((t, i) => {
    const first = i === 0 && !sheets.length;
    sheets.push({
      name: t.title || r.title,
      title: many && t.title ? `${r.title} · ${t.title}` : r.title,
      subtitle,
      summary: first ? r.summary : undefined,
      columns: t.columns,
      rows: t.rows.length ? t.rows : [[t.emptyText || 'Sin datos']],
      totals: t.rows.length ? t.totals : undefined,
      notes: first && !many ? [...(r.notes || []), generated] : undefined,
    });
  });
  if (!sheets.length) sheets.push({ name: 'Resumen', title: r.title, subtitle, columns: [], rows: [], notes: [generated] });
  saveBlobAs(buildXlsx(sheets, { title: r.title, author: store || 'Ventra' }), `${fullFileName(r)}.xlsx`);
}

// ---------- PDF ----------
const C = {
  brand: [14, 110, 82] as const, // #0E6E52
  brandDark: [11, 90, 67] as const,
  brandSoft: [234, 247, 241] as const,
  ink: [15, 23, 42] as const,
  text: [30, 41, 59] as const,
  muted: [100, 116, 139] as const,
  line: [226, 232, 240] as const,
  zebra: [247, 249, 248] as const,
  card: [244, 247, 246] as const,
  good: [14, 110, 82] as const,
  bad: [190, 18, 60] as const,
  warn: [161, 98, 7] as const,
};

/** Las fuentes estándar del PDF solo tienen Latin-1: se reemplaza lo demás */
function pdfText(s: string) {
  return s
    .replace(/[–—−]/g, '-')
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/…/g, '...')
    .replace(/[•●]/g, '·')
    .replace(/→/g, '->')
    .replace(/ | /g, ' ')
    .replace(/[^\u0000-ÿ]/g, '');
}

const isNumeric = (t?: CellType) => t === 'int' || t === 'number' || t === 'money' || t === 'percent';

export async function downloadReportPdf(r: Report) {
  const { jsPDF } = await import('jspdf');
  const store = storeInfo();
  // Apaisado solo si alguna tabla no entra parada (medido con la letra de las tablas)
  let orientation = r.orientation;
  if (!orientation) {
    const probe = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const room = probe.internal.pageSize.getWidth() - 28;
    const need = (t: ReportTable) => t.columns.reduce((sum, c, i) => {
      probe.setFont('helvetica', 'bold'); probe.setFontSize(7.5);
      let w = Math.max(...pdfText(c.header.toUpperCase()).split(' ').map((x) => probe.getTextWidth(x)));
      probe.setFont('helvetica', 'normal'); probe.setFontSize(8);
      const text = !isNumeric(c.type) && c.type !== 'date' && c.type !== 'datetime';
      let cell = 0;
      for (const row of t.rows.slice(0, 300)) cell = Math.max(cell, probe.getTextWidth(pdfText(formatCell(row[i], c.type))));
      w = Math.max(w, text ? Math.min(cell, 60) : cell);
      return sum + w + 4.4;
    }, 0);
    orientation = r.tables.some((t) => need(t) > room) ? 'landscape' : 'portrait';
  }
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 14; // margen
  const CW = W - M * 2;
  const BOTTOM = H - 16;
  let y = M;

  const color = (c: readonly number[]) => doc.setTextColor(c[0], c[1], c[2]);
  const fill = (c: readonly number[]) => doc.setFillColor(c[0], c[1], c[2]);
  const stroke = (c: readonly number[]) => doc.setDrawColor(c[0], c[1], c[2]);
  const font = (style: 'normal' | 'bold' | 'italic', size: number) => { doc.setFont('helvetica', style); doc.setFontSize(size); };

  // Encabezado de la primera página
  let logoW = 0;
  if (/^data:image\/(png|jpe?g);base64,/i.test(store.logo)) {
    try {
      const props = doc.getImageProperties(store.logo);
      const ratio = props.width / props.height || 1;
      let h = 13, w = ratio * h;
      if (w > 34) { w = 34; h = w / ratio; }
      doc.addImage(store.logo, /png/i.test(store.logo.slice(0, 20)) ? 'PNG' : 'JPEG', M, y + (13 - h) / 2 - 1, w, h);
      logoW = w + 4;
    } catch { logoW = 0; }
  }
  font('bold', 13); color(C.brandDark);
  doc.text(pdfText(store.name || 'Mi comercio'), M + logoW, y + 5);
  font('normal', 8); color(C.muted);
  const storeLine = [store.cuit && `CUIT ${store.cuit}`, store.address].filter(Boolean).join(' · ');
  if (storeLine) doc.text(pdfText(storeLine), M + logoW, y + 10);
  font('normal', 8); color(C.muted);
  doc.text(pdfText(`Emitido el ${formatCell(new Date(), 'datetime')}`), W - M, y + 5, { align: 'right' });
  font('bold', 8); color(C.brand);
  doc.text('Ventra', W - M, y + 10, { align: 'right' });
  y += 17;
  stroke(C.brand); doc.setLineWidth(0.6); doc.line(M, y, W - M, y);
  y += 9;

  font('bold', 19); color(C.ink);
  for (const line of doc.splitTextToSize(pdfText(r.title), CW)) { doc.text(line, M, y); y += 7.5; }
  if (r.subtitle) {
    y -= 1.5;
    font('normal', 10); color(C.muted);
    for (const line of doc.splitTextToSize(pdfText(r.subtitle), CW)) { doc.text(line, M, y); y += 5; }
  }
  y += 4;

  const newPage = () => { doc.addPage(); y = M + 4; };
  const ensure = (h: number) => { if (y + h > BOTTOM) { newPage(); return true; } return false; };

  // Tarjetas de resumen
  if (r.summary?.length) {
    const max = orientation === 'landscape' ? 5 : 4;
    const lines = Math.ceil(r.summary.length / max);
    const perRow = Math.ceil(r.summary.length / lines);
    const gap = 3.5;
    const cardW = (CW - gap * (perRow - 1)) / perRow;
    const cardH = 17;
    r.summary.forEach((it, i) => {
      const col = i % perRow;
      if (col === 0 && i > 0) y += cardH + gap;
      if (col === 0) ensure(cardH + 2);
      const x = M + col * (cardW + gap);
      fill(C.card); stroke(C.line); doc.setLineWidth(0.2);
      doc.roundedRect(x, y, cardW, cardH, 2, 2, 'FD');
      fill(it.tone === 'bad' ? C.bad : it.tone === 'warn' ? C.warn : C.brand);
      doc.rect(x, y + 3, 0.9, cardH - 6, 'F');
      font('bold', 6.5); color(C.muted);
      doc.text(doc.splitTextToSize(pdfText(it.label.toUpperCase()), cardW - 7)[0], x + 4, y + 6);
      const val = pdfText(formatCell(it.value, it.type || (typeof it.value === 'number' ? 'number' : 'text')));
      let size = 13;
      font('bold', size);
      while (size > 8 && doc.getTextWidth(val) > cardW - 7) { size -= 0.5; doc.setFontSize(size); }
      color(it.tone === 'bad' ? C.bad : it.tone === 'warn' ? C.warn : it.tone === 'good' ? C.good : C.ink);
      doc.text(doc.splitTextToSize(val, cardW - 7)[0], x + 4, y + 13);
    });
    y += cardH + 8;
  }

  // Tablas
  const PAD = 2.2;
  for (const t of r.tables) {
    const cols = t.columns;
    if (!cols.length) continue;
    const rows = t.rows.map((row) => cols.map((c, i) => pdfText(formatCell(row[i], c.type))));
    const totals = t.totals ? cols.map((c, i) => pdfText(formatCell(t.totals![i], i === 0 ? 'text' : c.type))) : null;
    let fs = cols.length > 9 ? 7 : 8;

    // Anchos: lo natural de cada columna, el texto se achica (y se parte en renglones) si no entra
    const measure = () => {
      const nat = cols.map((c, i) => {
        font('bold', fs - 0.5);
        let w = Math.max(...pdfText(c.header.toUpperCase()).split(' ').map((p) => doc.getTextWidth(p)));
        const head = doc.getTextWidth(pdfText(c.header.toUpperCase()));
        font('normal', fs);
        for (const row of rows.slice(0, 400)) w = Math.max(w, doc.getTextWidth(row[i]));
        if (totals) { font('bold', fs); w = Math.max(w, doc.getTextWidth(totals[i])); }
        return { w: w + PAD * 2, head: head + PAD * 2, text: !isNumeric(c.type) && c.type !== 'date' && c.type !== 'datetime' };
      });
      return nat;
    };
    let nat = measure();
    let widths = nat.map((n) => Math.max(n.w, n.text ? 14 : 0));
    let sum = widths.reduce((a, b) => a + b, 0);
    if (sum > CW && fs > 6.5) { fs = Math.max(6.5, fs - 1); nat = measure(); widths = nat.map((n) => Math.max(n.w, n.text ? 14 : 0)); sum = widths.reduce((a, b) => a + b, 0); }
    if (sum > CW) {
      const fixed = widths.reduce((a, w, i) => a + (nat[i].text ? 0 : w), 0);
      const textTotal = widths.reduce((a, w, i) => a + (nat[i].text ? w : 0), 0);
      const room = CW - fixed;
      if (textTotal > 0 && room > nat.filter((n) => n.text).length * 14) {
        widths = widths.map((w, i) => (nat[i].text ? Math.max(14, (w / textTotal) * room) : w));
      }
      sum = widths.reduce((a, b) => a + b, 0);
      if (sum > CW) widths = widths.map((w) => (w / sum) * CW);
    } else {
      // Sobra lugar: primero que los títulos entren en una línea, el resto para las columnas de texto
      let extra = CW - sum;
      const wantHead = nat.map((n, i) => Math.max(0, n.head - widths[i]));
      const headTotal = wantHead.reduce((a, b) => a + b, 0);
      if (headTotal > 0) {
        const k = Math.min(1, extra / headTotal);
        widths = widths.map((w, i) => w + wantHead[i] * k);
        extra -= headTotal * k;
      }
      const textIdx = nat.map((n, i) => (n.text ? i : -1)).filter((i) => i >= 0);
      const targets = textIdx.length ? textIdx : nat.map((_, i) => i);
      const tsum = targets.reduce((a, i) => a + widths[i], 0) || 1;
      widths = widths.map((w, i) => (targets.includes(i) ? w + (extra * w) / tsum : w));
    }

    const headerLines = cols.map((c, i) => { font('bold', fs - 0.5); return doc.splitTextToSize(pdfText(c.header.toUpperCase()), widths[i] - PAD * 2 + 0.6); });
    const headH = Math.max(...headerLines.map((l) => l.length)) * (fs - 0.5) * 0.42 + 4.2;
    const lineH = fs * 0.42;

    const drawHeader = () => {
      fill(C.brand);
      doc.rect(M, y, CW, headH, 'F');
      font('bold', fs - 0.5); doc.setTextColor(255, 255, 255);
      let x = M;
      cols.forEach((c, i) => {
        const lines = headerLines[i];
        const ty = y + (headH - lines.length * (fs - 0.5) * 0.42) / 2 + (fs - 0.5) * 0.34;
        lines.forEach((ln: string, k: number) => {
          const yy = ty + k * (fs - 0.5) * 0.42;
          if (isNumeric(c.type)) doc.text(ln, x + widths[i] - PAD, yy, { align: 'right' });
          else doc.text(ln, x + PAD, yy);
        });
        x += widths[i];
      });
      y += headH;
    };

    const rowHeight = (cells: string[], bold = false) => {
      font(bold ? 'bold' : 'normal', fs);
      const lines = cells.map((s, i) => (nat[i].text ? doc.splitTextToSize(s, widths[i] - PAD * 2 + 0.3) : [s]));
      return { lines, h: Math.max(1, ...lines.map((l) => l.length)) * lineH + 3.4 };
    };
    const drawRow = (cells: string[], idx: number, kind: 'row' | 'total') => {
      const bold = kind === 'total';
      const { lines, h } = rowHeight(cells, bold);
      if (y + h > BOTTOM) { newPage(); drawHeader(); }
      if (kind === 'total') { fill(C.brandSoft); doc.rect(M, y, CW, h, 'F'); stroke(C.brand); doc.setLineWidth(0.4); doc.line(M, y, M + CW, y); }
      else if (idx % 2 === 1) { fill(C.zebra); doc.rect(M, y, CW, h, 'F'); }
      font(bold ? 'bold' : 'normal', fs);
      color(bold ? C.ink : C.text);
      let x = M;
      cols.forEach((c, i) => {
        const ls = lines[i];
        ls.forEach((ln: string, k: number) => {
          const yy = y + 1.7 + fs * 0.34 + k * lineH;
          if (isNumeric(c.type)) {
            const n = toNumber(t.rows[idx]?.[i] ?? null);
            if (kind === 'row' && c.type === 'money' && n !== null && n < 0) color(C.bad);
            doc.text(ln, x + widths[i] - PAD, yy, { align: 'right' });
            color(bold ? C.ink : C.text);
          } else doc.text(ln, x + PAD, yy);
        });
        x += widths[i];
      });
      y += h;
      if (kind === 'row') { stroke(C.line); doc.setLineWidth(0.15); doc.line(M, y, M + CW, y); }
      if (kind === 'total') { stroke(C.brand); doc.setLineWidth(0.4); doc.line(M, y, M + CW, y); }
    };

    // El título de la tabla no queda solo al pie de una página
    const firstH = rows.length ? rowHeight(rows[0]).h : 8;
    ensure((t.title ? 9 : 0) + headH + firstH + 2);
    if (t.title) {
      fill(C.brand); doc.rect(M, y - 3.6, 1.1, 4.6, 'F');
      font('bold', 11); color(C.ink);
      doc.text(pdfText(t.title), M + 3, y);
      font('normal', 8); color(C.muted);
      if (rows.length) doc.text(`${rows.length} ${rows.length === 1 ? 'fila' : 'filas'}`, W - M, y, { align: 'right' });
      y += 4;
    }
    drawHeader();
    if (!rows.length) {
      font('italic', fs + 0.5); color(C.muted);
      doc.text(pdfText(t.emptyText || 'Sin datos en este período'), M + CW / 2, y + 6, { align: 'center' });
      y += 9.5;
      stroke(C.line); doc.setLineWidth(0.15); doc.line(M, y, M + CW, y);
    } else {
      rows.forEach((row, i) => drawRow(row, i, 'row'));
      if (totals) drawRow(totals, -1, 'total');
    }
    y += t === r.tables[r.tables.length - 1] ? 5 : 9;
  }

  if (r.notes?.length) {
    font('italic', 8); color(C.muted);
    for (const n of r.notes) {
      const lines = doc.splitTextToSize(pdfText(n), CW);
      ensure(lines.length * 3.8 + 1);
      lines.forEach((ln: string) => { doc.text(ln, M, y); y += 3.8; });
      y += 1;
    }
  }

  // Pie de página en todas las hojas
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    stroke(C.line); doc.setLineWidth(0.2); doc.line(M, H - 11, W - M, H - 11);
    font('normal', 7.5); color(C.muted);
    doc.text(pdfText([store.name, r.title, r.subtitle].filter(Boolean).join(' · ')).slice(0, 120), M, H - 7);
    doc.text(`Página ${p} de ${pages}`, W - M, H - 7, { align: 'right' });
  }
  doc.setProperties({ title: pdfText(r.title), creator: 'Ventra', author: pdfText(store.name || 'Ventra') });
  saveBlobAs(doc.output('blob'), `${fullFileName(r)}.pdf`);
}

export async function downloadReport(r: Report, kind: 'xlsx' | 'pdf') {
  if (kind === 'xlsx') downloadReportXlsx(r);
  else await downloadReportPdf(r);
}
