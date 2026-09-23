import * as XLSX from 'xlsx';

/**
 * Formato propio de Ventra para importar/exportar productos (.xlsx).
 *
 * Es el único formato que entiende el importador "oficial": exportar y volver a
 * importar el mismo archivo deja la base igual. Cualquier sistema anterior
 * (modpresup, DBF, etc.) se convierte primero a este formato.
 */
export const VENTRA_FORMAT_NAME = 'VENTRA_PRODUCTOS';
export const VENTRA_FORMAT_VERSION = 2;
export const PRODUCTS_SHEET = 'Productos';
export const INFO_SHEET = 'Info';

export type ColumnType = 'text' | 'number' | 'boolean';

export interface VentraColumn {
  key: string;
  type: ColumnType;
  width: number;
  help: string;
}

export const VENTRA_COLUMNS: VentraColumn[] = [
  { key: 'codigo', type: 'text', width: 12, help: 'Código interno (único). Se usa para reconocer el producto al actualizar.' },
  { key: 'codigo_barras', type: 'text', width: 16, help: 'Código de barras principal (único). Vacío si no tiene.' },
  { key: 'codigos_adicionales', type: 'text', width: 18, help: 'Otros códigos de barras separados por "|".' },
  { key: 'nombre', type: 'text', width: 45, help: 'Nombre del producto. Obligatorio.' },
  { key: 'descripcion', type: 'text', width: 25, help: 'Descripción libre.' },
  { key: 'modelo', type: 'text', width: 30, help: 'Indumentaria: nombre del modelo. Las filas con el mismo modelo son variantes del mismo artículo.' },
  { key: 'talle', type: 'text', width: 8, help: 'Talle de la variante (S, M, L, 38, 40...). Necesita modelo.' },
  { key: 'color', type: 'text', width: 12, help: 'Color de la variante. Necesita modelo.' },
  { key: 'rubro', type: 'text', width: 20, help: 'Rubro / categoría. Se crea si no existe.' },
  { key: 'marca', type: 'text', width: 16, help: 'Marca. Se crea si no existe.' },
  { key: 'proveedor', type: 'text', width: 18, help: 'Proveedor habitual. Se crea si no existe.' },
  { key: 'unidad', type: 'text', width: 8, help: 'UNIT, MT, KG, L o PACK.' },
  { key: 'precio_lista', type: 'number', width: 12, help: 'Precio de lista del proveedor SIN IVA.' },
  { key: 'desc1', type: 'number', width: 7, help: 'Descuento 1 del proveedor (%).' },
  { key: 'desc2', type: 'number', width: 7, help: 'Descuento 2 del proveedor (%), se aplica sobre el anterior.' },
  { key: 'desc3', type: 'number', width: 7, help: 'Descuento 3 del proveedor (%), se aplica sobre el anterior.' },
  { key: 'iva', type: 'number', width: 6, help: 'Alícuota de IVA (%): 0, 10.5, 21 o 27.' },
  { key: 'costo', type: 'number', width: 12, help: 'Costo final CON IVA. Si está vacío se calcula: lista × descuentos × IVA.' },
  { key: 'margen', type: 'number', width: 8, help: 'Informativo (%). Solo se usa si precio_venta está vacío.' },
  { key: 'precio_venta', type: 'number', width: 12, help: 'Precio de venta final (con IVA). Obligatorio.' },
  { key: 'precio_mayorista', type: 'number', width: 12, help: 'Precio mayorista (opcional).' },
  { key: 'cantidad_mayorista', type: 'number', width: 10, help: 'Cantidad mínima para precio mayorista.' },
  { key: 'precio_gremio', type: 'number', width: 12, help: 'Precio para gremio (opcional).' },
  { key: 'stock', type: 'number', width: 9, help: 'Stock actual.' },
  { key: 'stock_minimo', type: 'number', width: 9, help: 'Stock mínimo para alertas.' },
  { key: 'ubicacion', type: 'text', width: 12, help: 'Ubicación en el local (gavetero, estante...).' },
  { key: 'activo', type: 'boolean', width: 7, help: 'SI o NO.' },
];

const COLUMN_KEYS = VENTRA_COLUMNS.map(c => c.key);
const VALID_UNITS = ['UNIT', 'MT', 'KG', 'L', 'PACK'];
const VALID_IVA = [0, 10.5, 21, 27];

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** Costo con IVA a partir del precio de lista sin IVA y los descuentos en cascada. */
export function computeCost(listPrice: number, d1: number, d2: number, d3: number, iva: number): number {
  return round2(listPrice * (1 - d1 / 100) * (1 - d2 / 100) * (1 - d3 / 100) * (1 + iva / 100));
}

export interface ExportableProduct {
  sku: string | null;
  barcode: string | null;
  additionalBarcodes?: { barcode: string }[];
  name: string;
  description: string | null;
  category?: { name: string } | null;
  brand?: { name: string } | null;
  supplier?: { name: string } | null;
  unit: string;
  listPrice: number | null;
  discount1: number;
  discount2: number;
  discount3: number;
  taxRate: number;
  costPrice: number;
  salePrice: number;
  wholesalePrice: number | null;
  wholesaleMinQty: number | null;
  tradePrice: number | null;
  stock: number;
  minStock: number;
  location: string | null;
  isActive: boolean;
  baseName?: string | null;
  variantAttrs?: string | null;
}

/** Los atributos de una variante se guardan como JSON: {"talle":"M","color":"NEGRO"} */
function attrsOf(raw?: string | null): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function productToRow(p: ExportableProduct): Record<string, string | number> {
  const margin = p.costPrice > 0 ? round2((p.salePrice / p.costPrice - 1) * 100) : '';
  const attrs = attrsOf(p.variantAttrs);
  return {
    codigo: p.sku || '',
    codigo_barras: p.barcode || '',
    codigos_adicionales: (p.additionalBarcodes || []).map(b => b.barcode).join(' | '),
    nombre: p.name,
    descripcion: p.description || '',
    modelo: p.baseName || '',
    talle: attrs.talle || '',
    color: attrs.color || '',
    rubro: p.category?.name || '',
    marca: p.brand?.name || '',
    proveedor: p.supplier?.name || '',
    unidad: p.unit || 'UNIT',
    precio_lista: p.listPrice ?? '',
    desc1: p.discount1 || 0,
    desc2: p.discount2 || 0,
    desc3: p.discount3 || 0,
    iva: p.taxRate || 0,
    costo: round2(p.costPrice || 0),
    margen: margin,
    precio_venta: round2(p.salePrice || 0),
    precio_mayorista: p.wholesalePrice ?? '',
    cantidad_mayorista: p.wholesaleMinQty ?? '',
    precio_gremio: p.tradePrice ?? '',
    stock: p.stock ?? 0,
    stock_minimo: p.minStock ?? 0,
    ubicacion: p.location || '',
    activo: p.isActive ? 'SI' : 'NO',
  };
}

/** Arma el libro .xlsx con la hoja de productos y la hoja de información del formato. */
export function buildVentraWorkbook(rows: Record<string, string | number>[]): Buffer {
  const wb = XLSX.utils.book_new();

  const aoa: any[][] = [COLUMN_KEYS, ...rows.map(r => COLUMN_KEYS.map(k => r[k] ?? ''))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Forzar columnas de texto como texto: evita que Excel convierta "04508" en 4508
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  VENTRA_COLUMNS.forEach((col, c) => {
    if (col.type !== 'text') return;
    for (let r = 1; r <= range.e.r; r++) {
      const cell = ws[XLSX.utils.encode_cell({ r, c })];
      if (cell) { cell.t = 's'; cell.v = String(cell.v); cell.z = '@'; }
    }
  });
  ws['!cols'] = VENTRA_COLUMNS.map(c => ({ wch: c.width }));
  ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: COLUMN_KEYS.length - 1 } }) };
  XLSX.utils.book_append_sheet(wb, ws, PRODUCTS_SHEET);

  const info: any[][] = [
    ['formato', VENTRA_FORMAT_NAME],
    ['version', VENTRA_FORMAT_VERSION],
    ['generado', new Date().toISOString()],
    ['productos', rows.length],
    [],
    ['columna', 'descripción'],
    ...VENTRA_COLUMNS.map(c => [c.key, c.help]),
  ];
  const infoWs = XLSX.utils.aoa_to_sheet(info);
  infoWs['!cols'] = [{ wch: 20 }, { wch: 90 }];
  XLSX.utils.book_append_sheet(wb, infoWs, INFO_SHEET);

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// ---------------------------------------------------------------------------
// Lectura y validación
// ---------------------------------------------------------------------------

export interface ParsedProduct {
  codigo: string | null;
  codigo_barras: string | null;
  codigos_adicionales: string[];
  nombre: string;
  descripcion: string | null;
  modelo: string | null;
  talle: string | null;
  color: string | null;
  rubro: string | null;
  marca: string | null;
  proveedor: string | null;
  unidad: string;
  precio_lista: number | null;
  desc1: number;
  desc2: number;
  desc3: number;
  iva: number;
  /** null = no se puede saber (sin costo ni precio de lista): al actualizar no se modifica */
  costo: number | null;
  precio_venta: number;
  precio_mayorista: number | null;
  cantidad_mayorista: number | null;
  precio_gremio: number | null;
  stock: number;
  stock_minimo: number;
  ubicacion: string | null;
  activo: boolean;
}

export interface ParsedRow {
  row: number; // número de fila en Excel (1 = encabezado)
  data: ParsedProduct;
  errors: string[];
  warnings: string[];
}

export interface ParseResult {
  /** Columnas presentes en el archivo: las ausentes no se modifican al actualizar. */
  presentColumns: string[];
  rows: ParsedRow[];
}

export class VentraFormatError extends Error {}

/**
 * Convierte un valor de celda en número. Acepta números nativos y texto en
 * formato argentino ("1.234,56") o internacional ("1234.56").
 * Devuelve null si la celda está vacía y NaN si no es un número.
 */
export function parseNumberCell(val: any): number | null {
  if (val === undefined || val === null) return null;
  if (typeof val === 'number') return val;
  let s = String(val).trim().replace(/\s/g, '').replace(/^\$/, '').replace(/%$/, '');
  if (s === '') return null;
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  return /^-?\d+(\.\d+)?$/.test(s) ? parseFloat(s) : NaN;
}

const textCell = (val: any): string | null => {
  if (val === undefined || val === null) return null;
  const s = String(val).replace(/\s+/g, ' ').trim();
  return s === '' ? null : s;
};

export function parseVentraWorkbook(buffer: Buffer): ParseResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(buffer, { type: 'buffer', raw: false, cellText: false });
  } catch {
    throw new VentraFormatError('El archivo no es un Excel válido.');
  }

  const sheetName = wb.SheetNames.includes(PRODUCTS_SHEET) ? PRODUCTS_SHEET : wb.SheetNames[0];
  if (!sheetName) throw new VentraFormatError('El archivo no tiene hojas.');

  const infoSheet = wb.Sheets[INFO_SHEET];
  if (infoSheet) {
    const info: any[][] = XLSX.utils.sheet_to_json(infoSheet, { header: 1, defval: '' });
    const version = Number(info.find(r => r[0] === 'version')?.[1]);
    if (version && version > VENTRA_FORMAT_VERSION) {
      throw new VentraFormatError(`El archivo usa la versión ${version} del formato Ventra y esta instalación solo soporta hasta la ${VENTRA_FORMAT_VERSION}. Actualizá Ventra.`);
    }
  }

  const sheet: any[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, defval: null, raw: true });
  if (sheet.length === 0) throw new VentraFormatError('La hoja de productos está vacía.');

  const header = (sheet[0] || []).map(h => String(h ?? '').trim().toLowerCase());
  const unknown = header.filter(h => h && !COLUMN_KEYS.includes(h));
  if (unknown.length > 0) {
    throw new VentraFormatError(`Columnas desconocidas: ${unknown.join(', ')}. El archivo no está en formato Ventra (descargá la plantilla para ver las columnas válidas).`);
  }
  const dupHeader = header.filter((h, i) => h && header.indexOf(h) !== i);
  if (dupHeader.length > 0) throw new VentraFormatError(`Columnas repetidas: ${dupHeader.join(', ')}.`);
  if ((!header.includes('nombre') && !header.includes('modelo')) || !header.includes('precio_venta')) {
    throw new VentraFormatError('Faltan columnas obligatorias: se requieren "nombre" (o "modelo" si son talles y colores) y "precio_venta".');
  }
  if (!header.includes('codigo') && !header.includes('codigo_barras')) {
    throw new VentraFormatError('Se requiere al menos una de las columnas "codigo" o "codigo_barras" para identificar los productos.');
  }

  const idx = (k: string) => header.indexOf(k);
  const rows: ParsedRow[] = [];

  for (let r = 1; r < sheet.length; r++) {
    const raw = sheet[r] || [];
    if (raw.every(v => v === null || String(v).trim() === '')) continue;

    const errors: string[] = [];
    const warnings: string[] = [];
    const cell = (k: string) => (idx(k) >= 0 ? raw[idx(k)] : null);

    const num = (k: string, label: string, opts: { min?: number; max?: number } = {}): number | null => {
      const v = parseNumberCell(cell(k));
      if (v === null) return null;
      if (isNaN(v)) { errors.push(`${label}: "${cell(k)}" no es un número`); return null; }
      if (opts.min !== undefined && v < opts.min) { errors.push(`${label} no puede ser menor a ${opts.min}`); return null; }
      if (opts.max !== undefined && v > opts.max) { errors.push(`${label} no puede ser mayor a ${opts.max}`); return null; }
      return v;
    };

    // Los códigos pueden venir como número desde Excel: se pasan a texto sin decimales
    const code = (k: string) => {
      const v = cell(k);
      if (typeof v === 'number') return String(v);
      return textCell(v);
    };

    const codigo = code('codigo');
    let codigo_barras = code('codigo_barras');
    if (codigo_barras && ['-', '0', 'sin codigo', 'sin código'].includes(codigo_barras.toLowerCase())) codigo_barras = null;
    const codigos_adicionales = (textCell(cell('codigos_adicionales')) || '')
      .split('|').map(s => s.trim()).filter(Boolean);

    const modelo = textCell(cell('modelo'));
    const talle = textCell(cell('talle'));
    const color = textCell(cell('color'));
    if (!modelo && (talle || color)) errors.push('Hay talle o color pero falta el modelo: no se sabe de qué artículo es la variante');

    // En una planilla de indumentaria el nombre de cada variante sale del modelo: MODELO TALLE COLOR
    const variantSuffix = [talle, color].filter(Boolean).join(' ');
    let nombre = textCell(cell('nombre'));
    if (!nombre && modelo) nombre = variantSuffix ? `${modelo} ${variantSuffix}` : modelo;
    if (!nombre) errors.push('Falta el nombre');
    // Una variante queda identificada por modelo + talle + color aunque no traiga código propio
    if (!codigo && !codigo_barras && !(modelo && variantSuffix)) {
      errors.push('Falta código y código de barras: no se puede identificar el producto');
    }

    let unidad = (textCell(cell('unidad')) || 'UNIT').toUpperCase();
    if (!VALID_UNITS.includes(unidad)) {
      warnings.push(`Unidad "${unidad}" desconocida, se usa UNIT`);
      unidad = 'UNIT';
    }

    const precio_lista = num('precio_lista', 'Precio de lista', { min: 0 });
    const desc1 = num('desc1', 'Desc. 1', { min: 0, max: 100 }) ?? 0;
    const desc2 = num('desc2', 'Desc. 2', { min: 0, max: 100 }) ?? 0;
    const desc3 = num('desc3', 'Desc. 3', { min: 0, max: 100 }) ?? 0;
    const iva = num('iva', 'IVA', { min: 0, max: 100 }) ?? 0;
    if (!VALID_IVA.includes(iva)) warnings.push(`IVA ${iva}% no es una alícuota habitual`);

    let costo = num('costo', 'Costo', { min: 0 });
    if (precio_lista !== null && precio_lista > 0) {
      const calc = computeCost(precio_lista, desc1, desc2, desc3, iva);
      if (costo === null) {
        costo = calc;
      } else if (Math.abs(costo - calc) > Math.max(0.05, calc * 0.01)) {
        warnings.push(`El costo (${costo}) no coincide con lista × descuentos × IVA (${calc}); se respeta el costo del archivo`);
      }
    }
    const errorsBeforePrice = errors.length;
    let precio_venta = num('precio_venta', 'Precio de venta', { min: 0 });
    if (precio_venta === null && errors.length === errorsBeforePrice) {
      const margen = num('margen', 'Margen');
      if (margen !== null && costo !== null && costo > 0) {
        precio_venta = round2(costo * (1 + margen / 100));
      } else {
        errors.push('Falta el precio de venta');
      }
    }
    precio_venta = precio_venta ?? 0;
    if (precio_venta === 0 && errors.length === 0) warnings.push('Precio de venta en 0');
    if (costo !== null && costo > 0 && precio_venta > 0 && precio_venta < costo) warnings.push('El precio de venta es menor al costo');

    const stock = num('stock', 'Stock') ?? 0;
    if (stock < 0) warnings.push('Stock negativo');
    if (stock > 1000 && !Number.isInteger(stock)) warnings.push(`Stock ${stock} parece un error de carga`);

    const activoRaw = textCell(cell('activo'));
    let activo = true;
    if (activoRaw) {
      const a = activoRaw.toUpperCase();
      if (['NO', 'N', 'FALSE', '0'].includes(a)) activo = false;
      else if (!['SI', 'SÍ', 'S', 'TRUE', '1'].includes(a)) warnings.push(`Valor "${activoRaw}" en activo no reconocido, se toma SI`);
    }

    rows.push({
      row: r + 1,
      errors,
      warnings,
      data: {
        codigo,
        codigo_barras,
        codigos_adicionales,
        nombre: nombre || '',
        descripcion: textCell(cell('descripcion')),
        modelo: modelo ? modelo.toUpperCase() : null,
        talle: talle ? talle.toUpperCase() : null,
        color: color ? color.toUpperCase() : null,
        rubro: textCell(cell('rubro')),
        marca: textCell(cell('marca')),
        proveedor: textCell(cell('proveedor')),
        unidad,
        precio_lista,
        desc1, desc2, desc3, iva,
        costo: costo === null ? null : round2(costo),
        precio_venta: round2(precio_venta),
        precio_mayorista: num('precio_mayorista', 'Precio mayorista', { min: 0 }),
        cantidad_mayorista: num('cantidad_mayorista', 'Cantidad mayorista', { min: 0 }),
        precio_gremio: num('precio_gremio', 'Precio gremio', { min: 0 }),
        stock,
        stock_minimo: num('stock_minimo', 'Stock mínimo', { min: 0 }) ?? 0,
        ubicacion: textCell(cell('ubicacion')),
        activo,
      },
    });
  }

  // Duplicados dentro del mismo archivo: la primera aparición gana
  const seenCodes = new Map<string, number>();
  const seenBarcodes = new Map<string, number>();
  const seenVariants = new Map<string, number>();
  for (const r of rows) {
    const { codigo, codigo_barras, codigos_adicionales } = r.data;
    if (codigo) {
      const key = codigo.toUpperCase();
      if (seenCodes.has(key)) r.errors.push(`Código "${codigo}" repetido (ya está en la fila ${seenCodes.get(key)})`);
      else seenCodes.set(key, r.row);
    }
    const { modelo, talle, color } = r.data;
    if (modelo && (talle || color)) {
      const key = `${modelo}|${talle || ''}|${color || ''}`;
      if (seenVariants.has(key)) r.errors.push(`La variante ${[talle, color].filter(Boolean).join(' / ')} de "${modelo}" está repetida (ya está en la fila ${seenVariants.get(key)})`);
      else seenVariants.set(key, r.row);
    }
    for (const bc of [codigo_barras, ...codigos_adicionales].filter(Boolean) as string[]) {
      if (seenBarcodes.has(bc) && seenBarcodes.get(bc) !== r.row) r.errors.push(`Código de barras "${bc}" repetido (ya está en la fila ${seenBarcodes.get(bc)})`);
      else seenBarcodes.set(bc, r.row);
    }
  }

  return { presentColumns: header.filter(Boolean), rows };
}
