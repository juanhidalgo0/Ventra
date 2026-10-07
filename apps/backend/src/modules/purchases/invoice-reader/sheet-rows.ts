/** Renglones de una planilla Excel o CSV de proveedor, listos para el lector de boletas */
import * as XLSX from 'xlsx';
import type { Row } from './invoice-parser';

/** CSV de sistemas viejos: suelen venir en Latin-1 y separados por ";" */
function decodeCsv(buffer: Buffer): string {
  const utf8 = buffer.toString('utf8');
  return utf8.includes('�') ? buffer.toString('latin1') : utf8.replace(/^﻿/, '');
}

function csvSeparator(text: string): string {
  const sample = text.split(/\r?\n/).slice(0, 10).join('\n');
  const count = (ch: string) => (sample.match(new RegExp(`\\${ch}`, 'g')) || []).length;
  const options = [';', ',', '\t', '|'].map((ch) => [ch, count(ch)] as const).sort((a, b) => b[1] - a[1]);
  return options[0][1] > 0 ? options[0][0] : ',';
}

function sheetToRows(sheet: XLSX.WorkSheet): Row[] {
  const grid: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  return grid.map((cols) => {
    const cells = cols.map((v, i) => ({ text: v === null || v === undefined ? '' : String(v).trim(), raw: v, x: i, x2: i + 0.9 }));
    return { cells, text: cells.map((c) => c.text).filter(Boolean).join(' ') };
  });
}

/** Todas las hojas del archivo (el lector elige la que tenga la tabla de productos) */
export function readSheetFiles(buffer: Buffer, fileName: string): Row[][] {
  const isCsv = /\.(csv|txt)$/i.test(fileName);
  const workbook = isCsv
    // raw: los números quedan como texto ("19.610,00") y se leen con formato argentino
    ? XLSX.read(decodeCsv(buffer), { type: 'string', FS: csvSeparator(decodeCsv(buffer)), raw: true } as any)
    : XLSX.read(buffer, { type: 'buffer' });
  return workbook.SheetNames.map((name) => sheetToRows(workbook.Sheets[name])).filter((rows) => rows.length > 0);
}
