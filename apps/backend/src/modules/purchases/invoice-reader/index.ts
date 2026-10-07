/** Lectura de boletas de proveedores en PDF, Excel o CSV, en la PC y sin IA */
import { parseInvoiceRows, type ParsedInvoice, type Row } from './invoice-parser';
import { readPdfLines } from './pdf-text';
import { readSheetFiles } from './sheet-rows';

export type { ParsedInvoice, InvoiceItem } from './invoice-parser';

export class InvoiceReadError extends Error {}

export const isPdfFile = (name: string, mime = '') => /\.pdf$/i.test(name) || mime.toLowerCase() === 'application/pdf';
export const isSheetFile = (name: string, mime = '') =>
  /\.(xlsx|xls|csv|txt)$/i.test(name) || /spreadsheet|excel|csv/i.test(mime);

export async function readInvoiceFile(buffer: Buffer, fileName: string, mime = '', manualTotal?: number): Promise<ParsedInvoice> {
  if (isPdfFile(fileName, mime)) {
    let lines;
    try {
      lines = await readPdfLines(buffer);
    } catch {
      throw new InvoiceReadError('No se pudo abrir el PDF. Puede estar dañado o protegido con contraseña.');
    }
    if (lines.filter((l) => /[a-z]{3}/i.test(l.text)).length < 5) {
      throw new InvoiceReadError('Este PDF es una imagen escaneada y no trae texto. La lectura de fotos llega próximamente: por ahora pedile al proveedor la factura original en PDF o la planilla Excel.');
    }
    const rows: Row[] = lines.map((l) => ({ cells: l.cells, text: l.text, page: l.page }));
    return parseInvoiceRows(rows, 'pdf', manualTotal);
  }

  if (isSheetFile(fileName, mime)) {
    let sheets: Row[][];
    try {
      sheets = readSheetFiles(buffer, fileName);
    } catch {
      throw new InvoiceReadError('No se pudo abrir la planilla. Probá guardándola de nuevo como .xlsx o .csv.');
    }
    // La hoja que tenga la tabla de productos (y, si hay varias, la que cierre)
    const results = sheets.map((rows) => parseInvoiceRows(rows, 'sheet', manualTotal));
    const best = results.sort((a, b) => Number(b.check.ok) - Number(a.check.ok) || b.items.length - a.items.length)[0];
    if (!best) throw new InvoiceReadError('La planilla está vacía.');
    return best;
  }

  throw new InvoiceReadError('Formato no soportado: subí la boleta en PDF, Excel (.xlsx/.xls) o CSV.');
}
