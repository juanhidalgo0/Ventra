import MDBReader from 'mdb-reader';
import { computeCost, round2 } from './ventra-format';

/**
 * Convierte la base de productos de modpresup (Access .mdb, normalmente
 * Data\provlocal.mdb) a filas del formato Ventra.
 *
 * Mapeo de la tabla Productos de modpresup:
 *   codigo                     -> codigo
 *   codigobarras ("-")         -> codigo_barras (vacío)
 *   producto                   -> nombre
 *   rubro / marca ("-")        -> rubro / marca
 *   precio costo               -> precio_lista (sin IVA)
 *   porcentaje descuento / 2   -> desc1 / desc2
 *   iva                        -> iva
 *   precio costo × descs × IVA -> costo (con IVA)
 *   precio                     -> precio_venta (final con IVA)
 *   stock                      -> stock
 * La columna "costo" de modpresup NO es el costo: es el precio de venta sin IVA.
 */

export class ModpresupFormatError extends Error {}

export interface ModpresupConversion {
  rows: Record<string, string | number>[];
  sourceCount: number;
  /** Observaciones de la conversión por código final (se muestran como advertencias) */
  notes: Map<string, string[]>;
  report: Record<string, string[]>;
}

const text = (v: any) => (v === null || v === undefined ? '' : String(v).replace(/\s+/g, ' ').trim());
const num = (v: any) => (typeof v === 'number' && isFinite(v) ? v : parseFloat(String(v ?? '').replace(',', '.')) || 0);
const isPlaceholder = (s: string) => s === '' || s === '-' || s === '0';

/** true si el buffer es una base Access (Jet 3/4 o ACE) */
export function isAccessDatabase(buffer: Buffer): boolean {
  const signature = buffer.subarray(4, 20).toString('latin1');
  return signature === 'Standard Jet DB\0' || signature === 'Standard ACE DB\0';
}

export function convertModpresup(buffer: Buffer): ModpresupConversion {
  if (!isAccessDatabase(buffer)) throw new ModpresupFormatError('El archivo no es una base de datos Access (.mdb) válida.');

  let source: Record<string, any>[];
  try {
    const reader = new MDBReader(buffer);
    if (!reader.getTableNames().includes('Productos')) {
      throw new ModpresupFormatError('La base no tiene la tabla "Productos". Elegí el archivo provlocal.mdb de la carpeta Data de modpresup.');
    }
    source = reader.getTable('Productos').getData() as Record<string, any>[];
  } catch (err: any) {
    if (err instanceof ModpresupFormatError) throw err;
    throw new ModpresupFormatError(`No se pudo leer la base de modpresup: ${err.message}`);
  }

  const report: Record<string, string[]> = {
    'Códigos repetidos (se les agregó un sufijo)': [],
    'Productos sin código (se generó uno)': [],
    'Códigos de barras repetidos (se dejó solo el primero)': [],
  };
  const notes = new Map<string, string[]>();
  const note = (codigo: string, msg: string) => notes.set(codigo, [...(notes.get(codigo) || []), msg]);

  const usedCodes = new Set<string>();
  const usedBarcodes = new Set<string>();
  const rows: Record<string, string | number>[] = [];

  // Ante códigos duplicados conserva el código el cargado primero (menor id)
  const sorted = [...source].sort((a, b) => num(a.id) - num(b.id));

  for (const p of sorted) {
    const nombre = text(p.producto).toUpperCase();
    if (!nombre) continue;

    let codigo = text(p.codigo);
    if (!codigo) {
      codigo = `MP${num(p.id)}`;
      report['Productos sin código (se generó uno)'].push(`${codigo}  ${nombre}`);
      note(codigo, 'No tenía código en modpresup: se generó uno');
    }
    if (usedCodes.has(codigo.toUpperCase())) {
      let n = 2;
      while (usedCodes.has(`${codigo}-${n}`.toUpperCase())) n++;
      report['Códigos repetidos (se les agregó un sufijo)'].push(`${codigo} -> ${codigo}-${n}  ${nombre}`);
      note(`${codigo}-${n}`, `Código ${codigo} repetido en modpresup: se importa como ${codigo}-${n}`);
      codigo = `${codigo}-${n}`;
    }
    usedCodes.add(codigo.toUpperCase());

    let barcode = text(p.codigobarras);
    if (isPlaceholder(barcode)) barcode = '';
    if (barcode && usedBarcodes.has(barcode)) {
      report['Códigos de barras repetidos (se dejó solo el primero)'].push(`${barcode}  ${codigo}  ${nombre}`);
      note(codigo, `Código de barras ${barcode} repetido en modpresup: se omite`);
      barcode = '';
    }
    if (barcode) usedBarcodes.add(barcode);

    const marca = text(p.marca);
    const rubro = text(p.rubro);
    const lista = round2(num(p['precio costo']));
    const d1 = num(p['porcentaje descuento']);
    const d2 = num(p['porcentaje descuento2']);
    const iva = num(p.iva);
    const costo = lista > 0 ? computeCost(lista, d1, d2, 0, iva) : 0;
    const venta = round2(num(p.precio));

    rows.push({
      codigo,
      codigo_barras: barcode,
      codigos_adicionales: '',
      nombre,
      descripcion: '',
      rubro: isPlaceholder(rubro) ? '' : rubro.toUpperCase(),
      marca: isPlaceholder(marca) ? '' : marca.toUpperCase(),
      proveedor: isPlaceholder(text(p.proveedor)) ? '' : text(p.proveedor),
      unidad: 'UNIT',
      precio_lista: lista > 0 ? lista : '',
      desc1: d1,
      desc2: d2,
      desc3: 0,
      iva,
      costo,
      margen: costo > 0 ? round2((venta / costo - 1) * 100) : '',
      precio_venta: venta,
      precio_mayorista: '',
      cantidad_mayorista: '',
      precio_gremio: '',
      stock: round2(num(p.stock)),
      stock_minimo: 0,
      ubicacion: '',
      activo: 'SI',
    });
  }

  return { rows, sourceCount: source.length, notes, report };
}
