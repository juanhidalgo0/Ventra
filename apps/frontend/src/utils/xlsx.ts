/**
 * Planillas .xlsx de verdad, sin librerías: un .xlsx es un zip de archivos XML. Acá se arma
 * el XML de cada hoja con estilos (título, encabezado verde, números como números con su
 * formato, totales en negrita, filtros, primera fila fija) y se empaqueta en un zip sin
 * compresión (método "store"), que Excel, LibreOffice y Google Sheets abren sin quejarse.
 */

export type CellType = 'text' | 'int' | 'number' | 'money' | 'percent' | 'date' | 'datetime';
export type CellValue = string | number | Date | null | undefined | boolean;

export interface XlsxColumn { header: string; type?: CellType; width?: number }
export interface XlsxSheet {
  name: string;
  title?: string;
  subtitle?: string;
  /** Pares etiqueta / valor arriba de la tabla (el resumen) */
  summary?: { label: string; value: CellValue; type?: CellType }[];
  columns: XlsxColumn[];
  rows: CellValue[][];
  totals?: CellValue[];
  notes?: string[];
}

// ---------- zip (store) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(data: Uint8Array) {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zipStore(files: { name: string; data: string | Uint8Array }[]): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const now = new Date();
  const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // nombres en UTF-8
    lv.setUint16(8, 0, true);
    lv.setUint16(10, dosTime, true);
    lv.setUint16(12, dosDate, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true);
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    parts.push(local, data);

    const cd = new Uint8Array(46 + name.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, dosTime, true);
    cv.setUint16(14, dosDate, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cd.set(name, 46);
    central.push(cd);
    offset += local.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cdSize, true);
  ev.setUint32(16, offset, true);
  return new Blob([...parts, ...central, end] as BlobPart[], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ---------- estilos ----------
const TYPES: CellType[] = ['text', 'int', 'number', 'money', 'percent', 'date', 'datetime'];
const NUMFMT: Record<CellType, number> = { text: 0, int: 3, number: 4, money: 164, percent: 165, date: 166, datetime: 167 };
// Índices de cellXfs: base para títulos, después tipo × variante (normal, cebra, total)
const XF_TITLE = 1, XF_SUBTITLE = 2, XF_HEADER = 3, XF_HEADER_NUM = 4, XF_LABEL = 5, XF_NOTE = 6, XF_SECTION = 7;
const XF_BASE = 8;
const xfFor = (t: CellType, variant: 0 | 1 | 2) => XF_BASE + TYPES.indexOf(t) * 3 + variant;
const xfSummary = (t: CellType) => XF_BASE + TYPES.length * 3 + TYPES.indexOf(t);

function stylesXml() {
  const fonts = [
    '<font><sz val="10"/><color rgb="FF1E293B"/><name val="Calibri"/><family val="2"/></font>', // 0 normal
    '<font><b/><sz val="16"/><color rgb="FF0B5A43"/><name val="Calibri"/><family val="2"/></font>', // 1 título
    '<font><sz val="10"/><color rgb="FF64748B"/><name val="Calibri"/><family val="2"/></font>', // 2 gris
    '<font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>', // 3 encabezado
    '<font><b/><sz val="10"/><color rgb="FF0F172A"/><name val="Calibri"/><family val="2"/></font>', // 4 negrita
    '<font><i/><sz val="9"/><color rgb="FF64748B"/><name val="Calibri"/><family val="2"/></font>', // 5 nota
    '<font><b/><sz val="12"/><color rgb="FF0F172A"/><name val="Calibri"/><family val="2"/></font>', // 6 sección
  ];
  const fills = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    '<fill><patternFill patternType="solid"><fgColor rgb="FF0E6E52"/><bgColor indexed="64"/></patternFill></fill>', // 2 verde
    '<fill><patternFill patternType="solid"><fgColor rgb="FFF4F7F6"/><bgColor indexed="64"/></patternFill></fill>', // 3 cebra
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEAF7F1"/><bgColor indexed="64"/></patternFill></fill>', // 4 total
  ];
  const borders = [
    '<border><left/><right/><top/><bottom/><diagonal/></border>',
    '<border><left/><right/><top/><bottom style="thin"><color rgb="FFE2E8F0"/></bottom><diagonal/></border>', // 1 fila
    '<border><left/><right/><top style="medium"><color rgb="FF0E6E52"/></top><bottom style="medium"><color rgb="FF0E6E52"/></bottom><diagonal/></border>', // 2 total
  ];
  const xf = (numFmt: number, font: number, fill: number, border: number, align = '', extra = '') =>
    `<xf numFmtId="${numFmt}" fontId="${font}" fillId="${fill}" borderId="${border}" xfId="0"${numFmt ? ' applyNumberFormat="1"' : ''} applyFont="1" applyFill="1" applyBorder="1"${align ? ' applyAlignment="1"' : ''}>${align}${extra}</xf>`;
  const vcenter = '<alignment vertical="center"/>';
  const cellXfs = [
    xf(0, 0, 0, 0),
    xf(0, 1, 0, 0),
    xf(0, 2, 0, 0),
    xf(0, 3, 2, 0, '<alignment vertical="center" wrapText="1"/>'),
    xf(0, 3, 2, 0, '<alignment horizontal="right" vertical="center" wrapText="1"/>'),
    xf(0, 2, 0, 0),
    xf(0, 5, 0, 0, '<alignment wrapText="0"/>'),
    xf(0, 6, 0, 0),
  ];
  for (const t of TYPES) {
    const n = NUMFMT[t];
    const align = t === 'text' ? '<alignment vertical="center" wrapText="1"/>' : (t === 'date' || t === 'datetime') ? '<alignment horizontal="left" vertical="center"/>' : vcenter;
    cellXfs.push(xf(n, 0, 0, 1, align));
    cellXfs.push(xf(n, 0, 3, 1, align));
    cellXfs.push(xf(n, 4, 4, 2, t === 'text' ? vcenter : align));
  }
  for (const t of TYPES) cellXfs.push(xf(NUMFMT[t], 4, 0, 0, t === 'text' ? '' : '<alignment horizontal="left"/>'));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="4"><numFmt numFmtId="164" formatCode="&quot;$&quot;\\ #,##0.00;[Red]\\-&quot;$&quot;\\ #,##0.00"/><numFmt numFmtId="165" formatCode="0.0&quot;%&quot;"/><numFmt numFmtId="166" formatCode="dd/mm/yyyy"/><numFmt numFmtId="167" formatCode="dd/mm/yyyy\\ hh:mm"/></numFmts>
<fonts count="${fonts.length}">${fonts.join('')}</fonts>
<fills count="${fills.length}">${fills.join('')}</fills>
<borders count="${borders.length}">${borders.join('')}</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="${cellXfs.length}">${cellXfs.join('')}</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

// ---------- celdas ----------
const esc = (s: string) => s
  // Caracteres de control que rompen el XML
  // eslint-disable-next-line no-control-regex
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const colName = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

export function toDate(v: CellValue): Date | null {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' && v) { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  if (typeof v === 'number') { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  return null;
}
/** Fecha → número de serie de Excel en la hora local */
const excelSerial = (d: Date) => (d.getTime() - d.getTimezoneOffset() * 60000) / 86400000 + 25569;

export function toNumber(v: CellValue): number | null {
  if (typeof v === 'number') return isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'string') {
    const s = v.replace(/[$\s%]/g, '');
    if (!s || !/^-?[\d.,]+$/.test(s)) return null;
    // "1.234,56" (es-AR) o "1234.56"
    const n = s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s);
    return isFinite(n) ? n : null;
  }
  return null;
}

function cellXml(ref: string, v: CellValue, t: CellType, style: number) {
  if (v === null || v === undefined || v === '') return `<c r="${ref}" s="${style}"/>`;
  if (t === 'date' || t === 'datetime') {
    const d = toDate(v);
    if (d) return `<c r="${ref}" s="${style}"><v>${excelSerial(d)}</v></c>`;
  } else if (t !== 'text') {
    const n = toNumber(v);
    if (n !== null) return `<c r="${ref}" s="${style}"><v>${n}</v></c>`;
  }
  const text = typeof v === 'boolean' ? (v ? 'Sí' : 'No') : String(v);
  return `<c r="${ref}" s="${style}" t="inlineStr"><is><t xml:space="preserve">${esc(text)}</t></is></c>`;
}

const displayLen = (v: CellValue, t: CellType) => {
  if (v === null || v === undefined) return 0;
  const n = toNumber(v);
  const digits = (x: number) => String(Math.round(Math.abs(x))).length;
  if (t === 'money' && n !== null) return digits(n) * 1.33 + 6;
  if (t === 'date') return 10;
  if (t === 'datetime') return 16;
  if ((t === 'int' || t === 'number') && n !== null) return digits(n) * 1.33 + (Number.isInteger(n) ? 1 : 4);
  if (t === 'percent' && n !== null) return digits(n) + 4;
  return Math.max(...String(v).split('\n').map((l) => l.length));
};

function sheetXml(s: XlsxSheet) {
  const rows: string[] = [];
  const merges: string[] = [];
  const ncols = Math.max(1, s.columns.length);
  let r = 0;
  const addRow = (cells: string, height?: number) => {
    r++;
    rows.push(`<row r="${r}"${height ? ` ht="${height}" customHeight="1"` : ''}>${cells}</row>`);
  };
  // Título y subtítulo sin combinar celdas: el texto se ve entero sobre las columnas vacías
  if (s.title) addRow(cellXml(`A${r + 1}`, s.title, 'text', XF_TITLE), 24);
  if (s.subtitle) addRow(cellXml(`A${r + 1}`, s.subtitle, 'text', XF_SUBTITLE));
  if (s.summary?.length) {
    addRow('');
    for (const it of s.summary) {
      const t = it.type || (typeof it.value === 'number' ? 'number' : 'text');
      addRow(cellXml(`A${r + 1}`, it.label, 'text', XF_LABEL) + cellXml(`B${r + 1}`, it.value, t, xfSummary(t)));
    }
  }
  if ((s.title || s.subtitle || s.summary?.length) && s.columns.length) addRow('');
  const headerRow = r + 1;
  let filterRef = '';
  // Una columna "número" con solo enteros se muestra sin decimales (340 y no 340,00)
  const types: CellType[] = s.columns.map((c, i) => {
    const t = c.type || 'text';
    if (t !== 'number') return t;
    const vals = [...s.rows.map((row) => row[i]), ...(s.totals ? [s.totals[i]] : [])].map(toNumber).filter((x): x is number => x !== null);
    return vals.every((x) => Number.isInteger(x)) ? 'int' : 'number';
  });
  if (s.columns.length) {
    addRow(s.columns.map((c, i) => cellXml(`${colName(i)}${r + 1}`, c.header, 'text', c.type && c.type !== 'text' && c.type !== 'date' && c.type !== 'datetime' ? XF_HEADER_NUM : XF_HEADER)).join(''), 22);
    s.rows.forEach((row, ri) => {
      addRow(s.columns.map((_, i) => cellXml(`${colName(i)}${r + 1}`, row[i], types[i], xfFor(types[i], (ri % 2) as 0 | 1))).join(''));
    });
    filterRef = `A${headerRow}:${colName(ncols - 1)}${r}`;
    if (s.totals) {
      addRow(s.columns.map((_, i) => cellXml(`${colName(i)}${r + 1}`, s.totals![i], i === 0 ? 'text' : types[i], xfFor(i === 0 ? 'text' : types[i], 2))).join(''), 18);
    }
  }
  if (s.notes?.length) {
    addRow('');
    for (const n of s.notes) addRow(cellXml(`A${r + 1}`, n, 'text', XF_NOTE));
  }

  // Anchos según el contenido (con tope, el texto largo se acomoda en varias líneas)
  const widths = s.columns.map((c, i) => {
    if (c.width) return c.width;
    let w = c.header.length + 3;
    for (const row of s.rows.slice(0, 500)) w = Math.max(w, displayLen(row[i], c.type || 'text') + 2);
    if (s.totals) w = Math.max(w, displayLen(s.totals[i], c.type || 'text') + 2);
    return Math.min(Math.max(w, 9), c.type === 'text' || !c.type ? 55 : 22);
  });
  if (s.summary?.length) {
    widths[0] = Math.max(widths[0] ?? 0, ...s.summary.map((x) => x.label.length + 3));
    widths[1] = Math.max(widths[1] ?? 0, ...s.summary.map((x) => displayLen(x.value, x.type || 'text') + 3));
  }
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.min(Math.round(w * 10) / 10, 60)}" customWidth="1"/>`).join('')}</cols>` : '';
  const freeze = s.columns.length && s.rows.length > 15
    ? `<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
    : '<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>';
  const footer = `<headerFooter><oddFooter>&amp;L&amp;8${esc((s.subtitle || '').replace(/&/g, '&&'))}&amp;R&amp;8Página &amp;P de &amp;N</oddFooter></headerFooter>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>${freeze}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rows.join('')}</sheetData>${filterRef && s.rows.length ? `<autoFilter ref="${filterRef}"/>` : ''}${merges.length ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>` : ''}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.7" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="${s.columns.length > 6 ? 'landscape' : 'portrait'}" fitToWidth="1" fitToHeight="0"/>${footer}</worksheet>`;
}

function sheetNames(sheets: XlsxSheet[]) {
  const used = new Set<string>();
  return sheets.map((s, i) => {
    const base = (s.name || `Hoja ${i + 1}`).replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || `Hoja ${i + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 28)} ${n}`;
    used.add(name.toLowerCase());
    return name;
  });
}

export function buildXlsx(sheets: XlsxSheet[], meta: { title?: string; author?: string } = {}): Blob {
  const names = sheetNames(sheets);
  const nowIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const files: { name: string; data: string }[] = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${esc(meta.title || '')}</dc:title><dc:creator>${esc(meta.author || 'Ventra')}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${nowIso}</dcterms:modified></cp:coreProperties>` },
    { name: 'docProps/app.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Ventra</Application></Properties>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView/></bookViews><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets><definedNames>${sheets.map((s, i) => {
      if (!s.columns.length || !s.rows.length) return '';
      let header = 1 + (s.title ? 1 : 0) + (s.subtitle ? 1 : 0) + (s.summary?.length ? s.summary.length + 1 : 0);
      if (s.title || s.subtitle || s.summary?.length) header++;
      const last = header + s.rows.length;
      const ref = `'${esc(names[i].replace(/'/g, "''"))}'`;
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">${ref}!$A$${header}:$${colName(s.columns.length - 1)}$${last}</definedName><definedName name="_xlnm.Print_Titles" localSheetId="${i}">${ref}!$${header}:$${header}</definedName>`;
    }).join('')}</definedNames></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', data: stylesXml() },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
  return zipStore(files);
}
