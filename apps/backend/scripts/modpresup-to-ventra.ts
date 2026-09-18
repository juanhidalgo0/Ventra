/**
 * Convierte la base de productos de modpresup (Access .mdb) a un archivo en
 * formato Ventra (.xlsx), por ejemplo para revisarlo en Excel antes de importar.
 * Ventra también acepta el .mdb directamente desde Productos > Importar.
 *
 * Uso:
 *   npx tsx scripts/modpresup-to-ventra.ts <ruta a provlocal.mdb> [carpeta de salida]
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildVentraWorkbook, parseVentraWorkbook } from '../src/modules/products/ventra-format';
import { convertModpresup } from '../src/modules/products/modpresup-converter';

const [, , mdbPath, outDirArg] = process.argv;
if (!mdbPath) {
  console.error('Uso: npx tsx scripts/modpresup-to-ventra.ts <provlocal.mdb> [carpeta de salida]');
  process.exit(1);
}
const outDir = outDirArg || path.dirname(path.resolve(mdbPath));

const conversion = convertModpresup(fs.readFileSync(mdbPath));
const buffer = buildVentraWorkbook(conversion.rows);
const check = parseVentraWorkbook(buffer);

const lines: string[] = [
  `Conversión modpresup -> Ventra (${new Date().toLocaleString('es-AR')})`,
  `Origen: ${path.resolve(mdbPath)}`,
  `Productos en modpresup: ${conversion.sourceCount}`,
  `Productos convertidos:  ${conversion.rows.length}`,
  '',
];
for (const [title, items] of Object.entries(conversion.report)) {
  lines.push(`== ${title}: ${items.length}`, ...items.map(i => `   ${i}`), '');
}
const withIssues = check.rows.filter(r => r.errors.length > 0 || r.warnings.length > 0);
lines.push(`== Filas con errores o advertencias: ${withIssues.length}`);
for (const r of withIssues) {
  lines.push(`   ${r.data.codigo}  ${r.data.nombre}: ${[...r.errors, ...r.warnings].join('; ')}`);
}

fs.mkdirSync(outDir, { recursive: true });
const xlsxPath = path.join(outDir, 'ventra_productos_modpresup.xlsx');
const reportPath = path.join(outDir, 'reporte_conversion.txt');
fs.writeFileSync(xlsxPath, buffer);
fs.writeFileSync(reportPath, lines.join('\r\n'), 'utf8');

console.log(lines.slice(0, 4).join('\n'));
console.log(`\nArchivo: ${xlsxPath}\nReporte: ${reportPath}`);
process.exit(check.rows.some(r => r.errors.length > 0) ? 2 : 0);
