/**
 * Lector de boletas de proveedores (facturas A/B/C, remitos, listas de distribuidores) a partir
 * de renglones de texto: los de un PDF con texto o los de una planilla Excel/CSV.
 *
 * No usa IA: reconoce los encabezados más comunes en Argentina, arma los productos, lee los
 * totales del pie y controla que las cuentas cierren antes de cargar nada.
 */
import { closeEnough, isNumberText, parseArNumber, round2 } from './numbers';

export interface Cell {
  text: string;
  /** Posición en la hoja (PDF); en planillas se usa el número de columna */
  x?: number;
  x2?: number;
  raw?: unknown;
}

export interface Row {
  cells: Cell[];
  text: string;
  page?: number;
}

type ColKind =
  | 'code' | 'barcode' | 'qty' | 'description' | 'unit' | 'unitsPerPack'
  | 'listPrice' | 'discount' | 'discountAmount' | 'unitPrice' | 'ivaRate' | 'total' | 'totalWithIva';

export interface InvoiceItem {
  sku: string;
  barcode: string;
  name: string;
  quantity: number;
  unitsPerPack: number;
  unitPrice: number | null;
  discountPct: number | null;
  ivaRate: number | null;
  /** Importe del renglón tal como está impreso */
  lineTotal: number;
  /** Importe del renglón sin IVA (el que usa la compra para el costo) */
  netTotal: number;
}

export interface InvoiceTotals {
  neto: number | null;
  ivas: { rate: number; amount: number }[];
  otherTaxes: { label: string; amount: number }[];
  generalDiscount: number;
  total: number | null;
}

export interface InvoiceCheck {
  ok: boolean;
  message: string;
  details: string[];
  /** Total que se calcula con los productos (más IVA y percepciones si la boleta los discrimina) */
  computedTotal: number;
}

export interface ParsedInvoice {
  docType: 'FACTURA' | 'NOTA_CREDITO' | 'NOTA_DEBITO' | 'REMITO' | 'PRESUPUESTO' | 'DESCONOCIDO';
  letter: 'A' | 'B' | 'C' | 'M' | 'X' | null;
  supplierName: string;
  supplierCuit: string;
  invoiceNumber: string;
  /** YYYY-MM-DD */
  date: string;
  pricesIncludeIva: boolean;
  items: InvoiceItem[];
  totals: InvoiceTotals;
  check: InvoiceCheck;
}

// ─── Encabezados ───

const norm = (s: string) =>
  String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%]+/g, ' ')
    .replace(/%/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** En orden de prioridad: lo más específico primero ("precio lista" antes que "precio") */
const HEADER_SYNONYMS: [ColKind, string[]][] = [
  ['totalWithIva', ['subtotal c iva', 'total c iva', 'importe c iva', 'total con iva', 'subtotal con iva', 'importe con iva', 'total final']],
  ['discountAmount', ['imp bonif', 'importe bonif', 'importe bonificacion', 'monto bonif', 'imp desc', 'importe descuento']],
  ['ivaRate', ['alicuota iva', 'alicuota', 'alic iva', 'alic', 'tasa iva', 'iva']],
  ['discount', ['bonificacion', 'bonif', 'bon', 'descuento', 'desc', 'dto', 'dcto']],
  ['listPrice', ['precio lista', 'precio de lista', 'p lista', 'lista']],
  ['unitsPerPack', ['unidades por bulto', 'unid x bulto', 'unid bulto', 'u x b', 'uxb', 'u b', 'x bulto']],
  ['unit', ['unidad de medida', 'unidad medida', 'u medida', 'medida', 'u m', 'um']],
  ['barcode', ['codigo de barras', 'codigo barras', 'codigo barra', 'cod barras', 'cod barra', 'ean13', 'ean', 'gtin', 'barras']],
  ['unitPrice', ['precio unitario', 'precio unit', 'p unitario', 'p unit', 'valor unitario', 'costo unitario', 'neto unitario', 'unitario', 'precio u', 'p u', 'pu', 'precio', 'costo', 'p neto']],
  ['total', ['total item', 'total linea', 'total renglon', 'total neto', 'importe neto', 'imp total', 'sub total', 'subtotal', 'importe', 'total', 'neto']],
  ['qty', ['cantidad', 'cant', 'unidades', 'unid', 'qty', 'bultos']],
  ['code', ['codigo articulo', 'codigo producto', 'cod articulo', 'cod art', 'cod prod', 'codigo', 'cod', 'sku', 'referencia', 'ref', 'item', 'art']],
  ['description', ['descripcion del producto', 'producto servicio', 'descripcion', 'producto', 'detalle', 'nombre', 'concepto', 'denominacion', 'material', 'articulo']],
];

const ALL_PHRASES = new Set(HEADER_SYNONYMS.flatMap(([, list]) => list));

function phraseMatches(n: string, p: string) {
  return n === p || n.startsWith(p + ' ') || n.endsWith(' ' + p) || n.includes(' ' + p + ' ');
}

function headerKind(text: string): ColKind | null {
  const n = norm(text);
  if (!n || n.length > 40) return null;
  for (const [kind, list] of HEADER_SYNONYMS) {
    if (list.some((p) => phraseMatches(n, p))) return kind;
  }
  return null;
}

interface HeaderCol {
  kind: ColKind;
  index: number;
  x?: number;
  x2?: number;
}

/** Une celdas de encabezado partidas ("Precio" + "Lista") cuando juntas forman un nombre conocido */
function joinSplitHeaderCells(cells: Cell[]): Cell[] {
  const out: Cell[] = [];
  for (const c of cells) {
    const prev = out[out.length - 1];
    if (prev && prev.x2 !== undefined && c.x !== undefined && c.x - prev.x2 < 12 && ALL_PHRASES.has(norm(`${prev.text} ${c.text}`))) {
      out[out.length - 1] = { text: `${prev.text} ${c.text}`, x: prev.x, x2: c.x2 };
    } else {
      out.push({ ...c });
    }
  }
  return out;
}

function detectHeader(row: Row, mode: 'pdf' | 'sheet'): HeaderCol[] | null {
  // En una planilla cada título ya está en su columna: no se une nada
  const cells = mode === 'pdf' ? joinSplitHeaderCells(row.cells) : row.cells;
  const cols: HeaderCol[] = [];
  cells.forEach((c, index) => {
    const kind = headerKind(c.text);
    if (kind && !cols.some((h) => h.kind === kind)) cols.push({ kind, index, x: c.x, x2: c.x2 });
  });
  const kinds = new Set(cols.map((c) => c.kind));
  // "Artículo" es el código si también hay una columna de descripción; si no, es el nombre
  if (!kinds.has('description')) {
    const art = cols.find((c) => c.kind === 'code' && /articulo|^art$/.test(norm(cells[c.index]?.text || '')));
    if (art) { art.kind = 'description'; kinds.delete('code'); kinds.add('description'); }
  }
  const hasName = kinds.has('description');
  const hasMoney = kinds.has('total') || kinds.has('unitPrice') || kinds.has('totalWithIva');
  if (!hasName || !hasMoney || cols.length < 3) return null;
  return cols;
}

// ─── Productos ───

const PLAUSIBLE_IVA = [0, 2.5, 5, 10.5, 21, 27];
const isRateLike = (n: number | null) => n !== null && PLAUSIBLE_IVA.some((r) => Math.abs(r - n) < 0.001);

const FOOTER_START = /^(sub ?total|importe neto|neto gravado|neto no gravado|importe total|total|son pesos|son |iva|i v a|percep|perc |otros tributos|importe otros|no gravado|exento|cae|observaciones|cantidad de items|bonificacion general|descuento general|recargo general|total a pagar)/;
const SKIP_LINE = /^(pagina|pag |hoja|transporte|viene de|pasa a|continua|original|duplicado|triplicado)/;

type Fields = Partial<Record<ColKind, string | number>>;

const CODE_TOKEN = /^(?=.*\d)[A-Za-z0-9][\w./-]{0,24}$/;

/** PDF: asigna los textos de un renglón a las columnas por orden (las cifras se leen desde la derecha) */
function fieldsByOrder(row: Row, header: HeaderCol[]): Fields | null {
  const ordered = [...header].sort((a, b) => (a.x ?? a.index) - (b.x ?? b.index));
  const d = ordered.findIndex((h) => h.kind === 'description');
  const pre = ordered.slice(0, d).map((h) => h.kind);
  const post = ordered.slice(d + 1).map((h) => h.kind);
  const texts = row.cells.map((c) => c.text.trim()).filter(Boolean);
  const f: Fields = {};

  // Desde la derecha: importes y columnas cortas que van después de la descripción
  let j = texts.length - 1;
  for (let k = post.length - 1; k >= 0 && j >= 0; k--) {
    const kind = post[k];
    const t = texts[j];
    if (kind === 'unit') {
      if (!isNumberText(t) && t.length <= 12 && !/\s{2,}/.test(t)) { f.unit = t; j--; }
      continue;
    }
    if (kind === 'code' || kind === 'barcode') {
      if (CODE_TOKEN.test(t) && !isNumberText(t)) { f[kind] = t; j--; }
      continue;
    }
    if (isNumberText(t)) { f[kind] = t; j--; }
    else if (kind === 'total' || kind === 'unitPrice') return null; // un renglón de producto termina en importes
  }

  // Desde la izquierda: código, cantidad, etc. (pueden venir pegados en una misma celda)
  const tokens: string[] = [];
  let i = 0;
  let restOfFirst = '';
  const wanted = [...pre];
  while (wanted.length && i <= j) {
    const parts = texts[i].split(/\s+/);
    let consumed = 0;
    while (wanted.length && consumed < parts.length) {
      const kind = wanted[0];
      const t = parts[consumed];
      const fits = kind === 'qty' || kind === 'unitsPerPack' ? isNumberText(t)
        : kind === 'barcode' ? /^\d{8,14}$/.test(t)
        : kind === 'code' ? CODE_TOKEN.test(t)
        : isNumberText(t);
      wanted.shift();
      if (fits) { f[kind] = t; consumed++; tokens.push(t); }
    }
    if (consumed < parts.length) { restOfFirst = parts.slice(consumed).join(' '); i++; break; }
    i++;
  }

  const middle = [restOfFirst, ...texts.slice(i, j + 1)].filter(Boolean);
  // Columna de alícuota sin título (ej. "21,00" entre la descripción y el precio)
  if (middle.length > 1 && f.ivaRate === undefined && isNumberText(middle[middle.length - 1]) && isRateLike(parseArNumber(middle[middle.length - 1]))) {
    f.ivaRate = middle.pop() as string;
  }
  f.description = middle.join(' ').trim();
  return f;
}

/** Planilla: cada columna está en su lugar */
function fieldsByIndex(row: Row, header: HeaderCol[]): Fields {
  const f: Fields = {};
  for (const h of header) {
    const cell = row.cells[h.index];
    if (!cell) continue;
    const v = cell.raw !== undefined && cell.raw !== '' ? cell.raw : cell.text;
    if (v === '' || v === null || v === undefined) continue;
    f[h.kind] = typeof v === 'number' ? v : String(v).trim();
  }
  return f;
}

function buildItem(f: Fields): InvoiceItem | null {
  const name = String(f.description ?? '').replace(/\s+/g, ' ').replace(/^[\s\-–•*]+|[\s\-–]+$/g, '').trim();
  if (!name || name.length < 2 || FOOTER_START.test(norm(name))) return null;

  let qty = parseArNumber(f.qty);
  const listPrice = parseArNumber(f.listPrice);
  let unitPrice = parseArNumber(f.unitPrice);
  const discount = parseArNumber(f.discount);
  const discountAmount = parseArNumber(f.discountAmount);
  let ivaRate = parseArNumber(f.ivaRate);
  if (!isRateLike(ivaRate)) ivaRate = null;
  let lineTotal = parseArNumber(f.total);
  const withIva = parseArNumber(f.totalWithIva);
  const unitsPerPack = Math.max(1, parseArNumber(f.unitsPerPack) || 1);

  // Si hay precio de lista y precio unitario, la bonificación ya está aplicada en el unitario
  const discountOnUnit = listPrice === null && discount ? discount : 0;
  if (unitPrice === null && listPrice !== null) unitPrice = round2(listPrice * (1 - (discount || 0) / 100));
  if (lineTotal === null && withIva !== null) lineTotal = ivaRate !== null ? round2(withIva / (1 + ivaRate / 100)) : withIva;
  if (qty === null && lineTotal !== null && unitPrice) qty = Math.round((lineTotal / (unitPrice * (1 - discountOnUnit / 100))) * 1000) / 1000;
  if (qty === null) qty = 1;
  if (lineTotal === null && unitPrice !== null) lineTotal = round2(qty * unitPrice * (1 - discountOnUnit / 100) - (discountAmount || 0));
  if (lineTotal === null) return null;
  if (qty === 0 && lineTotal === 0) return null;

  return {
    sku: f.code !== undefined ? String(f.code).trim() : '',
    barcode: f.barcode !== undefined ? String(f.barcode).replace(/\D/g, '') : '',
    name,
    quantity: qty,
    unitsPerPack,
    unitPrice,
    discountPct: discount,
    ivaRate,
    lineTotal: round2(lineTotal),
    netTotal: round2(lineTotal),
  };
}

/** Sin encabezado reconocible: renglones que terminan en importes y donde cantidad × precio = total */
function fallbackItem(row: Row): InvoiceItem | null {
  const texts = row.cells.map((c) => c.text.trim()).filter(Boolean);
  const nums: number[] = [];
  let j = texts.length - 1;
  while (j >= 0 && isNumberText(texts[j])) { nums.unshift(parseArNumber(texts[j]) as number); j--; }
  if (nums.length < 2) return null;
  const words = texts.slice(0, j + 1);
  const leadQty = words.length && isNumberText(words[0].split(/\s+/)[0]) ? parseArNumber(words[0].split(/\s+/)[0]) : null;
  const total = nums[nums.length - 1];
  const candidates = [...(leadQty !== null ? [leadQty] : []), ...nums.slice(0, -1)];
  for (const q of candidates) {
    for (const p of nums.slice(0, -1)) {
      if (q > 0 && p > 0 && q !== p && closeEnough(q * p, total, 0.05)) {
        const name = words.join(' ').replace(leadQty !== null && q === leadQty ? /^\S+\s*/ : /$^/, '').trim();
        if (!name || FOOTER_START.test(norm(name))) return null;
        return { sku: '', barcode: '', name, quantity: q, unitsPerPack: 1, unitPrice: p, discountPct: null, ivaRate: null, lineTotal: round2(total), netTotal: round2(total) };
      }
    }
  }
  return null;
}

// ─── Datos del comprobante ───

function validCuit(digits: string) {
  if (!/^(20|23|24|25|26|27|30|33|34)\d{9}$/.test(digits)) return false;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = w.reduce((s, k, i) => s + k * Number(digits[i]), 0);
  let dv = 11 - (sum % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) dv = 9;
  return dv === Number(digits[10]);
}

const CODE_TO_TYPE: Record<number, [ParsedInvoice['docType'], ParsedInvoice['letter']]> = {
  1: ['FACTURA', 'A'], 2: ['NOTA_DEBITO', 'A'], 3: ['NOTA_CREDITO', 'A'],
  6: ['FACTURA', 'B'], 7: ['NOTA_DEBITO', 'B'], 8: ['NOTA_CREDITO', 'B'],
  11: ['FACTURA', 'C'], 12: ['NOTA_DEBITO', 'C'], 13: ['NOTA_CREDITO', 'C'],
  51: ['FACTURA', 'M'], 91: ['REMITO', 'X'],
};

function toIsoDate(d: string, m: string, y: string) {
  const year = y.length === 2 ? `20${y}` : y;
  const dd = Number(d), mm = Number(m);
  if (!(dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12)) return '';
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

const COMPANY = /\b(s\.?\s?a\.?|s\.?\s?r\.?\s?l\.?|s\.?\s?a\.?\s?s\.?|s\.?\s?c\.?|sociedad|hnos?\.?|y cia\.?|& cia\.?|srl|sa)\s*$/i;
const NOT_A_NAME = /factura|original|duplicado|triplicado|codigo|cod\.|fecha|cuit|c\.u\.i\.t|ingresos brutos|ing\.? brutos|iibb|inicio de actividad|domicilio|condicion|responsable|monotributo|punto de venta|comp\.? nro|n[°º]|nro|telefono|tel\.|e-?mail|www\.|@|remito|presupuesto|nota de|pagina|hoja/i;
const CUSTOMER_BLOCK = /^(senor|sr\.?\s|cliente|apellido y nombre|razon social del cliente|destinatario|facturar a|comprador)/;

function readHeaderData(lines: Row[], untilIndex: number) {
  const top = lines.slice(0, Math.max(untilIndex, Math.min(lines.length, 40)));
  const text = top.map((l) => l.text).join('\n');
  const n = norm(text);

  let docType: ParsedInvoice['docType'] = 'DESCONOCIDO';
  let letter: ParsedInvoice['letter'] = null;
  const codeMatch = text.match(/c[oó]d(?:igo)?\.?\s*(?:n[°º]\s*)?0*(\d{1,3})\b/i);
  if (codeMatch && CODE_TO_TYPE[Number(codeMatch[1])]) [docType, letter] = CODE_TO_TYPE[Number(codeMatch[1])];
  if (docType === 'DESCONOCIDO') {
    if (/nota de credito/.test(n)) docType = 'NOTA_CREDITO';
    else if (/nota de debito/.test(n)) docType = 'NOTA_DEBITO';
    else if (/\bfactura\b/.test(n)) docType = 'FACTURA';
    else if (/\bremito\b/.test(n)) docType = 'REMITO';
    else if (/\bpresupuesto\b/.test(n)) docType = 'PRESUPUESTO';
  }
  if (!letter) {
    const m = text.match(/factura\s+([ABCM])\b/i) || text.match(/\b(?:tipo|comprobante)\s*:?\s*([ABCM])\b/);
    if (m) letter = m[1].toUpperCase() as any;
    else {
      // La letra suele estar sola en un recuadro arriba
      const solo = top.slice(0, 15).flatMap((l) => l.cells).find((c) => /^[ABCM]$/.test(c.text.trim()));
      if (solo) letter = solo.text.trim() as any;
    }
  }

  let invoiceNumber = '';
  const pvNum = text.match(/(?:n[°ºo]\.?|nro\.?|n[uú]mero|comprobante)\s*:?\s*(\d{1,5})\s*-\s*(\d{1,8})\b/i) || text.match(/\b(\d{4,5})-(\d{8})\b/);
  if (pvNum) invoiceNumber = `${pvNum[1].padStart(pvNum[1].length > 4 ? 5 : 4, '0')}-${pvNum[2].padStart(8, '0')}`;
  else {
    const pv = text.match(/punto de venta\s*:?\s*(\d{1,5})/i);
    const num = text.match(/comp(?:robante)?\.?\s*n(?:ro|[°º])\.?\s*:?\s*(\d{1,8})/i);
    if (pv && num) invoiceNumber = `${pv[1].padStart(pv[1].length > 4 ? 5 : 4, '0')}-${num[1].padStart(8, '0')}`;
    else if (num) invoiceNumber = num[1];
  }

  let date = '';
  const dm = text.match(/fecha(?:\s+de)?(?:\s+emisi[oó]n)?\s*:?\s*(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/i) || text.match(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/);
  if (dm) date = toIsoDate(dm[1], dm[2], dm[3]);

  let supplierCuit = '';
  for (const m of text.matchAll(/\b(\d{2})[-\s.]?(\d{8})[-\s.]?(\d)\b/g)) {
    const digits = `${m[1]}${m[2]}${m[3]}`;
    if (validCuit(digits)) { supplierCuit = `${m[1]}-${m[2]}-${m[3]}`; break; }
  }

  // Proveedor: "Razón Social: …" del emisor, o la primera línea con forma de empresa
  let supplierName = '';
  const issuerLines: Row[] = [];
  for (const l of top) {
    if (CUSTOMER_BLOCK.test(norm(l.cells[0]?.text || l.text))) break;
    issuerLines.push(l);
  }
  // Celda por celda: en el mismo renglón suele estar "Punto de Venta", "Fecha", etc.
  const rs = issuerLines.flatMap((l) => l.cells).map((c) => c.text.match(/raz[oó]n social\s*:?\s*(.+)$/i)).find(Boolean);
  if (rs) supplierName = rs[1].split(/\s{2,}|fecha|cuit/i)[0].trim();
  if (!supplierName) {
    const pieces = issuerLines.flatMap((l) => l.cells.map((c) => c.text.trim()));
    supplierName = pieces.find((t) => COMPANY.test(t) && !NOT_A_NAME.test(t) && t.length > 4)
      || pieces.find((t) => /[a-z]{3}/i.test(t) && t.length > 3 && !NOT_A_NAME.test(t) && !/^\W*[ABCM]\W*$/.test(t) && !isNumberText(t)) || '';
  }

  return { docType, letter, invoiceNumber, date, supplierCuit, supplierName: supplierName.slice(0, 80) };
}

// ─── Pie: neto, IVA, percepciones y total ───

type TotalLabel = { kind: 'neto' | 'iva' | 'tax' | 'discount' | 'total' | 'exento'; rate?: number; label: string };

function totalLabel(text: string): TotalLabel | null {
  const n = norm(text.replace(/\./g, ''));
  if (!n || n.length > 45) return null;
  if (/^(?:importe\s+)?iva\b/.test(n) && !/inscripto|responsable|condicion/.test(n)) {
    // La alícuota se lee del texto original: "IVA 10.5%" o "IVA 10,5 %"
    const m = text.match(/i\.?\s*v\.?\s*a\.?\s*(\d+(?:[.,]\d+)?)/i);
    const rate = m ? Number(m[1].replace(',', '.')) : 21;
    return { kind: 'iva', rate: isRateLike(rate) ? rate : 21, label: text };
  }
  if (/percep|^perc\b|retencion|^ret\b|ingresos brutos|\biibb\b|otros tributos|impuestos? internos?|^imp int/.test(n)) return { kind: 'tax', label: text.replace(/[:$]+\s*$/, '').trim() };
  if (/(no gravado|exento)/.test(n)) return { kind: 'exento', label: text };
  if (/^(bonificacion|descuento|dto)(\s+(general|global|comercial))?/.test(n) && !/item/.test(n)) return { kind: 'discount', label: text };
  if (/^(importe\s+)?(neto\s+gravado|neto|subtotal(\s+neto)?|sub total)\b/.test(n) && !/c iva|con iva/.test(n)) return { kind: 'neto', label: text };
  if (/^(importe\s+)?total(\s+(final|a pagar|factura|general|comprobante|pesos))?$|^total a pagar|^importe total|^total\b(?!\s+(item|linea|neto|iva|bonif))/.test(n)) return { kind: 'total', label: text };
  return null;
}

function readTotals(lines: Row[]): InvoiceTotals {
  const totals: InvoiceTotals = { neto: null, ivas: [], otherTaxes: [], generalDiscount: 0, total: null };
  const put = (lab: TotalLabel, value: number) => {
    if (lab.kind === 'neto' && totals.neto === null) totals.neto = value;
    else if (lab.kind === 'iva' && value > 0) totals.ivas.push({ rate: lab.rate || 21, amount: value });
    else if (lab.kind === 'tax' && value > 0) totals.otherTaxes.push({ label: lab.label, amount: value });
    else if (lab.kind === 'discount') totals.generalDiscount += Math.abs(value);
    else if (lab.kind === 'total') totals.total = value; // el último (el de más abajo) es el final
  };

  for (let li = 0; li < lines.length; li++) {
    const cells = lines[li].cells;
    const labels = cells.map((c) => {
      // "IVA 21%: 238.798,43" en una sola celda
      const inline = c.text.match(/^(.*?[a-z%:)\s])\s*\$?\s*([-−]?[\d.,]+)\s*$/i);
      return { lab: totalLabel(c.text) || (inline ? totalLabel(inline[1]) : null), inline: inline ? parseArNumber(inline[2]) : null };
    });
    const found = labels.filter((l) => l.lab);
    if (!found.length) continue;

    const numbersHere = cells.filter((c) => isNumberText(c.text));
    if (found.length >= 2 && numbersHere.length === 0) {
      // Títulos en un renglón y los importes en el de abajo, en el mismo orden
      const next = lines[li + 1];
      const values = next ? next.cells.filter((c) => isNumberText(c.text)).map((c) => parseArNumber(typeof c.raw === 'number' ? c.raw : c.text) as number) : [];
      if (values.length === found.length) { found.forEach((f, k) => put(f.lab!, values[k])); li++; }
      continue;
    }
    labels.forEach((l, k) => {
      if (!l.lab) return;
      // El importe es el número que sigue a la derecha del título (o el que viene en la misma celda)
      const after = cells.slice(k + 1).find((c) => isNumberText(c.text));
      const isLabelOnly = l.inline === null || totalLabel(cells[k].text) !== null;
      // En planillas se usa el número de la celda, no su texto
      const value = after && isLabelOnly ? parseArNumber(typeof after.raw === 'number' ? after.raw : after.text) : l.inline;
      if (value !== null && value !== undefined) put(l.lab, value);
    });
  }
  return totals;
}

// ─── Lectura completa ───

/** Facturas de ARCA que vienen con ORIGINAL / DUPLICADO / TRIPLICADO: alcanza con la primera copia */
function firstCopyOnly(lines: Row[]): Row[] {
  const pages = [...new Set(lines.map((l) => l.page ?? 1))];
  if (pages.length < 2) return lines;
  const copyWord = (p: number) => lines.filter((l) => (l.page ?? 1) === p).slice(0, 8).map((l) => norm(l.text)).join(' ').match(/\b(original|duplicado|triplicado|cuadruplicado)\b/)?.[1];
  if (!pages.some((p) => /duplicado|triplicado/.test(copyWord(p) || ''))) return lines;
  return lines.filter((l) => !/duplicado|triplicado|cuadruplicado/.test(copyWord(l.page ?? 1) || ''));
}

export function parseInvoiceRows(input: Row[], mode: 'pdf' | 'sheet', manualTotal?: number): ParsedInvoice {
  const lines = mode === 'pdf' ? firstCopyOnly(input) : input;

  let header: HeaderCol[] | null = null;
  let headerIndex = -1;
  const items: InvoiceItem[] = [];
  let inFooter = false;
  let firstFooterIndex = -1;
  let lastItemIndex = -1;
  let lastWasItem = false;

  for (let i = 0; i < lines.length; i++) {
    const row = lines[i];
    const h = detectHeader(row, mode);
    if (h) {
      // Encabezado (o el mismo encabezado repetido en otra página)
      if (!header) { header = h; headerIndex = i; }
      inFooter = false;
      lastWasItem = false;
      continue;
    }
    if (!header || inFooter) continue;

    const first = norm(row.cells[0]?.text || '');
    if (SKIP_LINE.test(first)) { lastWasItem = false; continue; }

    const fields = mode === 'pdf' ? fieldsByOrder(row, header) : fieldsByIndex(row, header);
    const item = fields ? buildItem(fields) : null;
    if (item) {
      items.push(item);
      lastItemIndex = i;
      lastWasItem = true;
      continue;
    }
    if (FOOTER_START.test(first) || (row.cells.length <= 3 && totalLabel(row.cells[0]?.text || ''))) {
      inFooter = true;
      if (firstFooterIndex < 0) firstFooterIndex = i;
      continue;
    }
    // PDF: descripción larga que sigue en el renglón de abajo, sin importes
    const hasNumbers = row.cells.some((c) => isNumberText(c.text));
    if (mode === 'pdf' && lastWasItem && !hasNumbers && items.length) {
      const prev = items[items.length - 1];
      prev.name = `${prev.name} ${row.text}`.replace(/\s+/g, ' ').trim();
      continue;
    }
    lastWasItem = false;
  }

  // Sin encabezado reconocible: se intenta renglón por renglón
  if (!header) {
    for (let i = 0; i < lines.length; i++) {
      const it = fallbackItem(lines[i]);
      if (it) { items.push(it); lastItemIndex = i; }
    }
  }

  const meta = readHeaderData(lines, headerIndex >= 0 ? headerIndex : 25);
  const footerFrom = firstFooterIndex >= 0 ? firstFooterIndex : lastItemIndex + 1;
  const totals = readTotals(lines.slice(Math.max(0, footerFrom)));

  // ¿Los precios incluyen IVA? Factura B/C sí; sin letra, se decide por el pie
  const sumLines = round2(items.reduce((s, it) => s + it.lineTotal, 0));
  const otherTaxes = totals.otherTaxes.reduce((s, t) => s + t.amount, 0);
  const ivaTotal = totals.ivas.reduce((s, t) => s + t.amount, 0);
  let pricesIncludeIva: boolean;
  if (meta.letter === 'B' || meta.letter === 'C') pricesIncludeIva = true;
  else if (meta.letter === 'A' || meta.letter === 'M' || ivaTotal > 0) pricesIncludeIva = false;
  else pricesIncludeIva = totals.total !== null && closeEnough(sumLines - totals.generalDiscount + otherTaxes, totals.total, Math.max(1, items.length * 0.02));

  for (const it of items) {
    it.netTotal = pricesIncludeIva ? round2(it.lineTotal / (1 + (it.ivaRate ?? 21) / 100)) : it.lineTotal;
  }

  const check = checkInvoice(items, totals, pricesIncludeIva, sumLines, manualTotal);
  return { ...meta, pricesIncludeIva, items, totals, check };
}

function checkInvoice(items: InvoiceItem[], totals: InvoiceTotals, pricesIncludeIva: boolean, sumLines: number, manualTotal?: number): InvoiceCheck {
  const fmt = (n: number) => `$ ${n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const details: string[] = [];
  const ivaTotal = totals.ivas.reduce((s, t) => s + t.amount, 0);
  const otherTaxes = totals.otherTaxes.reduce((s, t) => s + t.amount, 0);

  if (!items.length) {
    return { ok: false, message: 'No se encontraron productos en la boleta.', details, computedTotal: 0 };
  }

  // Renglones donde cantidad × precio no da el importe
  items.forEach((it, idx) => {
    if (it.unitPrice === null) return;
    const expected = it.quantity * it.unitPrice;
    const withDisc = expected * (1 - (it.discountPct || 0) / 100);
    // El unitario impreso está redondeado a centavos: el error crece con la cantidad
    const tol = Math.max(1, Math.abs(it.quantity) * 0.006);
    if (!closeEnough(expected, it.lineTotal, tol) && !closeEnough(withDisc, it.lineTotal, tol)) {
      details.push(`Renglón ${idx + 1} (${it.name.slice(0, 40)}): ${it.quantity} × ${fmt(it.unitPrice)} no da ${fmt(it.lineTotal)}`);
    }
  });

  const net = round2(sumLines - totals.generalDiscount);
  // Redondeos: hasta 2 centavos por renglón y por importe del pie
  const tol = Math.max(1, (items.length + totals.ivas.length + totals.otherTaxes.length) * 0.02);
  const computedTotal = round2(pricesIncludeIva ? net + otherTaxes : net + (ivaTotal || (totals.total === null ? net * 0.21 : 0)) + otherTaxes);
  let ok = details.length === 0;
  let message = '';

  if (!pricesIncludeIva && totals.neto !== null && !closeEnough(sumLines, totals.neto, tol) && !closeEnough(net, totals.neto, tol)) {
    ok = false;
    message = `La suma de los productos (${fmt(sumLines)}) no coincide con el neto de la boleta (${fmt(totals.neto)}): diferencia ${fmt(round2(sumLines - totals.neto))}.`;
  } else if (totals.total !== null && ivaTotal + otherTaxes + (pricesIncludeIva ? 1 : 0) > 0 && !closeEnough(computedTotal, totals.total, tol)) {
    ok = false;
    message = `Lo leído suma ${fmt(computedTotal)} y la boleta dice ${fmt(totals.total)}: diferencia ${fmt(round2(computedTotal - totals.total))}.`;
  }
  // Sin total ni neto impresos no hay con qué comparar: no se da por buena
  if (ok && totals.total === null && totals.neto === null) {
    ok = false;
    message = 'No se encontró el total impreso de la boleta: revisá los importes antes de confirmar.';
  }
  const finalTotal = totals.total ?? computedTotal;
  if (ok && manualTotal !== undefined && manualTotal !== null && !closeEnough(finalTotal, manualTotal, tol)) {
    ok = false;
    message = `El total que ingresaste (${fmt(manualTotal)}) no coincide con el de la boleta (${fmt(finalTotal)}).`;
  }
  if (!message) {
    message = ok
      ? `La boleta cierra: ${items.length} productos por ${fmt(finalTotal)}.`
      : `Revisá ${details.length === 1 ? 'un renglón' : `${details.length} renglones`}: la cuenta de cantidad × precio no da el importe.`;
  } else if (details.length) {
    message += ` Puede venir de ${details.length === 1 ? 'este renglón' : 'estos renglones'}.`;
  }
  return { ok, message, details: details.slice(0, 10), computedTotal };
}
