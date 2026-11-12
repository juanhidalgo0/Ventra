/**
 * Pruebas del lector de boletas de proveedores (PDF con texto, Excel y CSV, sin IA).
 * Arma en memoria boletas con los formatos más comunes de Argentina y controla que se lean los
 * productos, los datos del comprobante y que las cuentas cierren (o que avise cuando no).
 *
 *   npm run test:boletas
 */
import * as assert from 'assert';
import * as XLSX from 'xlsx';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { readInvoiceFile, InvoiceReadError } from '../src/modules/purchases/invoice-reader';
import { isBarcode, barcodeProblem, splitInvoiceCodes } from '../src/modules/purchases/invoice-reader/barcode-check';
import { SyncImageService } from '../src/modules/products/sync-image.service';
import { ProductMatcherService } from '../src/modules/ai/product-matcher.service';
import { mergeMissingPages } from '../src/modules/purchases/purchases.service';
import { parseArcaQrText, readArcaQr, qrKind, qrTotalPesos } from '../src/modules/purchases/invoice-reader/arca-qr';

let fallas = 0;
let ok = 0;
const t = async (nombre: string, fn: () => Promise<void>) => {
  try {
    await fn();
    ok++;
    console.log(`ok    ${nombre}`);
  } catch (e: any) {
    fallas++;
    console.log(`FALLA ${nombre}\n      ${e.message}`);
  }
};

// ─── Utilidades ───

type Txt = { x: number; y: number; text: string; size?: number };

async function pdf(pages: Txt[][]): Promise<Buffer> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const items of pages) {
    const page = doc.addPage([595, 842]);
    for (const it of items) page.drawText(it.text, { x: it.x, y: it.y, size: it.size ?? 7, font });
  }
  return Buffer.from(await doc.save());
}

/** CUIT con dígito verificador correcto */
function cuit(prefix: string, body: string) {
  const d = `${prefix}${body}`;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  let dv = 11 - (w.reduce((s, k, i) => s + k * Number(d[i]), 0) % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) dv = 9;
  return `${prefix}-${body}-${dv}`;
}

const near = (a: number, b: number, msg: string) => assert.ok(Math.abs(a - b) < 0.02, `${msg}: ${a} ≠ ${b}`);

// ─── 1. Factura A de distribuidor (formato de Electro Pereira, datos del cliente inventados) ───

const PEREIRA: [string, number, string[], string, string, string, string, string][] = [
  ['30343-B', 50, ['JELUZ (20059) VERONA MODULO TOMA 20A BLANCO'], '21,00', '978,54', '5,00', '929,61', '46480,65'],
  ['30482', 10, ['JELUZ (40002) VERONA ESTANCO 2 MOD.BAST.Y TAPA', 'TRANSP.'], '21,00', '1850,94', '5,00', '1758,39', '17583,93'],
  ['30501', 20, ['JELUZ (50401/2) VERONA 1 PUNTO C/BOLSA PERCHITA', 'BLANCO'], '21,00', '782,69', '5,00', '743,56', '14871,11'],
  ['30504', 40, ['JELUZ (50404/2) VERONA 1 TOMA COMBINADO C/BOLSA', 'PERCHITA BLANCO'], '21,00', '779,60', '5,00', '740,62', '29624,80'],
  ['94082', 20, ['JELUZ (50420/2) VERONA 1 TOMA 20 A C/BOLSA', 'PERCHITA BLANCO'], '21,00', '1605,09', '5,00', '1524,84', '30496,71'],
  ['19219', 25, ['KALOP (KD44920) FICHA ADAPTADORA 10A T/ NEUTRO A', 'T/ COMUN 3 A 2 (B/300)'], '21,00', '1387,69', '5,00', '1318,31', '32957,64'],
  ['11104', 100, ['KALOP (KL04033) CABLE CANAL 20X10 MM. CON', 'ADHESIVO (X MT.) (B/100)'], '21,00', '548,27', '5,00', '520,86', '52085,65'],
  ['94946', 200, ['KALOP (KL05601) GRAMPA DE PLASTICO GRIS 20MM', 'T/SICA (B/600) SICA'], '21,00', '115,56', '5,00', '109,78', '21956,40'],
  ['95126', 200, ['KALOP (KL05602) GRAMPA DE PLASTICO GRIS 22MM', 'T/SICA (B/180) SICA'], '21,00', '140,04', '5,00', '133,04', '26607,60'],
  ['19218', 50, ['KALOP (KL44930) FICHA ADAPTADORA 10A T/ COMUN A T/', 'NEUTRO 2 A 3 (B/600)'], '21,00', '1199,75', '5,00', '1139,76', '56988,12'],
  ['22409', 10, ['KALOP (KL95002N) FOTOCELULA 1200 W TODO TIPO DE', 'LAMPARA (B/80)'], '10,50', '9376,57', '5,00', '8907,74', '89077,42'],
  ['06406', 12, ['MAYVA (ELECA0-11) CALEFON TANQUE PLASTICO 20', 'LTS. RES.ALU.'], '21,00', '11046,00', '5,00', '10493,70', '125924,40'],
  ['196091', 10, ['MIG (142) FICHA MACHO BIPOLAR C/NEUTRO ALTO', 'CONSUMO 20A BLANCO'], '21,00', '1656,48', '5,00', '1573,66', '15736,56'],
  ['196092', 10, ['MIG (242) FICHA BIPOLAR C/TOMA 20A HEMBRA BLANCO'], '21,00', '1642,56', '5,00', '1560,43', '15604,32'],
  ['28704', 4, ['PRIOLO JABALINA C/ TOMA CABLE 1/2 X 1,5 MTS.'], '21,00', '9059,86', '5,00', '8606,87', '34427,47'],
  ['88545-R', 1, ['REFLEX (0301) CONDUCTOR UNIPOLAR 1.5 MM ROJO'], '21,00', '28254,36', '5,00', '26841,64', '26841,64'],
  ['88545-N', 1, ['REFLEX (0305) CONDUCTOR UNIPOLAR 1.5 MM NEGRO'], '21,00', '28254,36', '5,00', '26841,64', '26841,64'],
  ['88546-V', 2, ['REFLEX (0313) CONDUCTOR UNIPOLAR 2.5 MM VERDE'], '21,00', '42004,52', '5,00', '39904,29', '79808,59'],
  ['96376', 18, ['SICA (763225) TERMICA 2X25 4.5K'], '21,00', '5438,08', '5,00', '5166,18', '92991,17'],
  ['27517', 18, ['SICA (782240) TERMICA 2X40 "LIQUIDACION"'], '21,00', '6164,73', '5,00', '5856,49', '105416,88'],
  ['10002-N', 40, ['TACSA (PTTACSA015N) CINTA AISLADORA 10', 'MTS.NEGRO - PLUS (B/150)'], '21,00', '551,83', '5,00', '524,24', '20969,54'],
  ['10201-N', 40, ['TBCIN CINTA AISLADORA VINI TAPE 10 MTS. NEGRO'], '21,00', '1593,98', '5,00', '1514,28', '60571,24'],
  ['71988-15', 150, ['TECNOCOM (MR1315) MANGUERA DE RIEGO REFORZADA', '1/2 (X 15 MT)'], '21,00', '372,18', '5,00', '353,57', '53035,65'],
  ['71988-25', 250, ['TECNOCOM (MR1325) MANGUERA DE RIEGO REFORZADA', '1/2 (X 25 MT)'], '21,00', '372,18', '5,00', '353,57', '88392,75'],
  ['19702', 10, ['TOP (T152) MULTIFICHA DOBLE CON NEUTRO (MC-1001)/', 'TAAD'], '21,00', '1657,35', '5,00', '1574,48', '15744,82'],
  ['19704', 10, ['TOP (T164) MULTIFICHA LOGIC TRIPLE C/N (3001) (PC-', '1001)/ TAAD'], '21,00', '1848,96', '5,00', '1756,51', '17565,12'],
  ['91541', 5, ['VIYILANT (2359-1.5) AUTOMATICO FLOTANTE 1,5 MTS'], '21,00', '5812,84', '5,00', '5522,20', '27610,99'],
];

function pereiraPdf(alterLine?: { index: number; total: string }) {
  const p: Txt[] = [
    { x: 290, y: 790, text: 'A', size: 16 },
    { x: 400, y: 790, text: 'FACTURA', size: 10 },
    { x: 284, y: 776, text: 'Código 01', size: 5 },
    { x: 260, y: 765, text: 'Electro Pereira 22 S.A.' },
    { x: 440, y: 765, text: 'C.U.I.T.: 30-71683246-1' },
    { x: 260, y: 756, text: 'Camino Rivadavia Km 3,5' },
    { x: 440, y: 756, text: 'Ing. Brutos: 30-71683246-1' },
    { x: 260, y: 747, text: '1925 Ensenada' },
    { x: 440, y: 747, text: 'Inicio de Actividad: 07/2020' },
    { x: 260, y: 738, text: 'IVA RESPONSABLE INSCRIPTO' },
    { x: 40, y: 715, text: 'Cliente:' }, { x: 100, y: 715, text: 'COMERCIO DE PRUEBA (8384)' },
    { x: 330, y: 715, text: 'N° Comprobante:' }, { x: 470, y: 715, text: '0001-00059230' },
    { x: 40, y: 705, text: 'Domicilio:' }, { x: 100, y: 705, text: 'CALLE FALSA 123' },
    { x: 330, y: 705, text: 'Fecha Emisión:' }, { x: 470, y: 705, text: '08/06/2026' },
    { x: 40, y: 695, text: 'CUIT:' }, { x: 100, y: 695, text: cuit('20', '12345678') },
    // Encabezado de la tabla ("Precio Unitario" en dos renglones; la alícuota no tiene título)
    { x: 40, y: 660, text: 'Codigo' }, { x: 85, y: 660, text: 'Cantidad' }, { x: 230, y: 660, text: 'Descripción' },
    { x: 375, y: 660, text: 'Precio Lista' }, { x: 428, y: 660, text: '% Bon' },
    { x: 470, y: 662, text: 'Precio' }, { x: 468, y: 654, text: 'Unitario' }, { x: 520, y: 660, text: 'Total Item' },
  ];
  let y = 640;
  PEREIRA.forEach(([code, qty, desc, rate, list, bon, unit, total], i) => {
    const tot = alterLine && alterLine.index === i ? alterLine.total : total;
    p.push(
      { x: 40, y, text: code }, { x: 95, y, text: String(qty) }, { x: 135, y, text: desc[0] }, { x: 345, y, text: rate },
      { x: 380, y, text: list }, { x: 435, y, text: bon }, { x: 470, y, text: unit }, { x: 520, y, text: tot },
    );
    if (desc[1]) p.push({ x: 135, y: y - 8, text: desc[1] });
    y -= desc[1] ? 19 : 12;
  });
  y -= 15;
  for (const [label, value] of [['Neto Gravado:', '1.226.212,81'], ['IVA 21%:', '238.798,43'], ['IVA 10,5%:', '9.353,13'], ['Percepción IIBB PBA:', '49.048,51'], ['Importe Total:', '1.523.412,88']]) {
    p.push({ x: 380, y, text: label, size: 8 }, { x: 500, y, text: value, size: 8 });
    y -= 11;
  }
  p.push({ x: 150, y: y - 5, text: 'CAE Numero: 86238870608754' }, { x: 150, y: y - 15, text: 'Cantidad de Items: 27' }, { x: 480, y: y - 25, text: 'Página 1 de 1' });
  return pdf([p]);
}

// ─── 2. Factura A de ARCA (comprobante en línea) con original, duplicado y triplicado ───

const EMISOR = cuit('30', '71234567');

function arcaPage(copy: string, letter: 'A' | 'B' | 'C', rows: string[][], footer: [string, string][]): Txt[] {
  const code = { A: '01', B: '006', C: '011' }[letter];
  const p: Txt[] = [
    { x: 270, y: 815, text: copy, size: 10 },
    { x: 30, y: 780, text: 'DISTRIBUIDORA EL SOL S.R.L.', size: 12 },
    { x: 290, y: 780, text: letter, size: 18 }, { x: 283, y: 766, text: `COD. ${code}`, size: 6 },
    { x: 400, y: 780, text: 'FACTURA', size: 14 },
    { x: 30, y: 745, text: 'Razón Social: DISTRIBUIDORA EL SOL S.R.L.' },
    { x: 330, y: 745, text: 'Punto de Venta: 00003' }, { x: 450, y: 745, text: 'Comp. Nro: 00000123' },
    { x: 30, y: 733, text: 'Domicilio Comercial: Av. Siempreviva 742 - Córdoba' }, { x: 330, y: 733, text: 'Fecha de Emisión: 15/09/2026' },
    { x: 30, y: 721, text: 'Condición frente al IVA: IVA Responsable Inscripto' }, { x: 330, y: 721, text: `CUIT: ${EMISOR}` },
    { x: 330, y: 709, text: 'Ingresos Brutos: 123-456789-0' }, { x: 330, y: 697, text: 'Fecha de Inicio de Actividades: 01/03/2015' },
    { x: 30, y: 675, text: `CUIT: ${cuit('20', '23456789')}` }, { x: 220, y: 675, text: 'Apellido y Nombre / Razón Social: KIOSCO DE PRUEBA' },
    { x: 30, y: 663, text: 'Condición frente al IVA: IVA Responsable Inscripto' }, { x: 300, y: 663, text: 'Domicilio: Calle 1 234' },
  ];
  const heads = letter === 'A'
    ? [['Código', 25], ['Producto / Servicio', 60], ['Cantidad', 230], ['U. Medida', 272], ['Precio Unit.', 318], ['% Bonif', 370], ['Subtotal', 410], ['Alicuota IVA', 455], ['Subtotal c/IVA', 515]]
    : [['Código', 25], ['Producto / Servicio', 60], ['Cantidad', 250], ['U. Medida', 295], ['Precio Unit.', 345], ['% Bonif', 400], ['Imp. Bonif.', 440], ['Subtotal', 510]];
  heads.forEach(([text, x]) => p.push({ x: x as number, y: 640, text: text as string, size: 6.5 }));
  let y = 625;
  for (const r of rows) {
    r.forEach((text, i) => p.push({ x: (heads[i][1] as number) + (i >= 2 ? 3 : 0), y, text, size: 6.5 }));
    y -= 12;
  }
  y = 200;
  for (const [label, value] of footer) {
    p.push({ x: 360, y, text: label, size: 8 }, { x: 500, y, text: value, size: 8 });
    y -= 12;
  }
  p.push({ x: 30, y: 60, text: 'CAE N°: 76543210987654' }, { x: 30, y: 50, text: 'Fecha de Vto. de CAE: 25/09/2026' }, { x: 270, y: 50, text: 'Pág. 1/1' });
  return p;
}

const arcaA = () => {
  const rows = [
    ['001', 'Gaseosa cola 2,25 L', '10,00', 'unidades', '1500,00', '0,00', '15000,00', '21%', '18150,00'],
    ['002', 'Galletitas surtidas 300 g', '24,00', 'unidades', '850,00', '10,00', '18360,00', '21%', '22215,60'],
    ['003', 'Yerba mate 1 kg', '6,00', 'unidades', '3200,00', '0,00', '19200,00', '10,5%', '21216,00'],
  ];
  const footer: [string, string][] = [
    ['Importe Neto Gravado: $', '52560,00'], ['IVA 27%: $', '0,00'], ['IVA 21%: $', '7005,60'], ['IVA 10.5%: $', '2016,00'],
    ['IVA 5%: $', '0,00'], ['IVA 2.5%: $', '0,00'], ['IVA 0%: $', '0,00'], ['Importe Otros Tributos: $', '0,00'], ['Importe Total: $', '61581,60'],
  ];
  return pdf(['ORIGINAL', 'DUPLICADO', 'TRIPLICADO'].map((c) => arcaPage(c, 'A', rows, footer)));
};

const arcaBC = (letter: 'B' | 'C') => {
  const rows = [
    ['1', 'Alfajor triple x 24', '2,00', 'unidades', '14400,00', '10,00', '2880,00', '25920,00'],
    ['2', 'Caramelos surtidos x 1 kg', '3,00', 'unidades', '5000,00', '0,00', '0,00', '15000,00'],
  ];
  return pdf([arcaPage('ORIGINAL', letter, rows, [['Subtotal: $', '40920,00'], ['Importe Otros Tributos: $', '0,00'], ['Importe Total: $', '40920,00']])]);
};

// ─── 3. Planilla de mayorista y CSV de un sistema viejo ───

function mayoristaXlsx(): Buffer {
  const rows: unknown[][] = [
    ['DISTRIBUIDORA NORTE S.A.'],
    [`CUIT: ${cuit('30', '70111222')}`, '', '', 'Remito N° 0002-00004567'],
    ['Fecha: 10/09/2026'],
    [],
    ['Cod. Art', 'Descripción', 'U.x B.', 'Bultos', 'P. Unit.', 'Total'],
    ['A100', 'Coca Cola 500 ml', 12, 2, 9600, 19200],
    ['A200', 'Agua mineral 1,5 L', 6, 3, 4200.5, 12601.5],
    ['B300', 'Papas fritas 80 g', 20, 1, 15000, 15000],
    [],
    ['', '', '', '', 'SUBTOTAL', 46801.5],
    ['', '', '', '', 'IVA 21%', 9828.32],
    ['', '', '', '', 'TOTAL', 56629.82],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Notas'], ['Gracias por su compra']]), 'Portada');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'Remito');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function sistemaViejoCsv(): Buffer {
  const text = [
    'Código;Descripción;Cantidad;Precio Unitario;Importe',
    '0001;Azúcar común 1 kg;10;1.250,00;12.500,00',
    '0002;Fideos tirabuzón 500 g;20;980,50;19.610,00',
    ';;;Total;32.110,00',
  ].join('\r\n');
  return Buffer.from(text, 'latin1');
}

async function main() {
  await t('factura A de distribuidor: 27 productos, códigos, descripciones en dos renglones y alícuota sin título', async () => {
    const r = await readInvoiceFile(await pereiraPdf(), 'factura.pdf');
    assert.strictEqual(r.items.length, 27);
    assert.strictEqual(r.letter, 'A');
    assert.strictEqual(r.docType, 'FACTURA');
    assert.strictEqual(r.invoiceNumber, '0001-00059230');
    assert.strictEqual(r.date, '2026-06-08');
    assert.strictEqual(r.supplierCuit, '30-71683246-1');
    assert.strictEqual(r.supplierName, 'Electro Pereira 22 S.A.');
    assert.strictEqual(r.items[0].sku, '30343-B');
    assert.strictEqual(r.items[0].quantity, 50);
    assert.strictEqual(r.items[1].name, 'JELUZ (40002) VERONA ESTANCO 2 MOD.BAST.Y TAPA TRANSP.');
    assert.strictEqual(r.items[10].ivaRate, 10.5);
    assert.strictEqual(r.items[11].sku, '06406');
    near(r.items.reduce((s, i) => s + i.netTotal, 0), 1226212.81, 'neto');
    near(r.totals.total ?? 0, 1523412.88, 'total');
    assert.deepStrictEqual(r.totals.ivas.map((i) => [i.rate, i.amount]), [[21, 238798.43], [10.5, 9353.13]]);
    assert.strictEqual(r.totals.otherTaxes.length, 1);
    assert.ok(r.check.ok, r.check.message);
  });

  await t('factura A con un importe mal: avisa y señala el renglón', async () => {
    const r = await readInvoiceFile(await pereiraPdf({ index: 4, total: '30946,71' }), 'factura.pdf');
    assert.strictEqual(r.items.length, 27);
    assert.ok(!r.check.ok);
    assert.ok(/neto/.test(r.check.message), r.check.message);
    assert.ok(r.check.details.some((d) => d.startsWith('Renglón 5')), r.check.details.join(' | '));
  });

  await t('factura A de ARCA: usa solo el original, lee punto de venta, emisor y alícuotas', async () => {
    const r = await readInvoiceFile(await arcaA(), 'arca.pdf');
    assert.strictEqual(r.items.length, 3, `leyó ${r.items.length} productos`);
    assert.strictEqual(r.letter, 'A');
    assert.strictEqual(r.invoiceNumber, '00003-00000123');
    assert.strictEqual(r.date, '2026-09-15');
    assert.strictEqual(r.supplierCuit, EMISOR);
    assert.strictEqual(r.supplierName, 'DISTRIBUIDORA EL SOL S.R.L.');
    assert.strictEqual(r.items[1].quantity, 24);
    near(r.items[1].netTotal, 18360, 'galletitas con 10% de bonificación');
    assert.strictEqual(r.items[2].ivaRate, 10.5);
    near(r.totals.total ?? 0, 61581.6, 'total');
    assert.ok(r.check.ok, r.check.message);
  });

  for (const letter of ['B', 'C'] as const) {
    await t(`factura ${letter} de ARCA: precios con IVA, se pasan a neto para el costo`, async () => {
      const r = await readInvoiceFile(await arcaBC(letter), `arca-${letter}.pdf`);
      assert.strictEqual(r.letter, letter);
      assert.strictEqual(r.items.length, 2);
      assert.ok(r.pricesIncludeIva);
      near(r.items[0].lineTotal, 25920, 'renglón con bonificación');
      near(r.items[0].netTotal, 25920 / 1.21, 'neto');
      assert.ok(r.check.ok, r.check.message);
    });
  }

  await t('planilla de mayorista: elige la hoja con productos, bultos × unidades por bulto', async () => {
    const r = await readInvoiceFile(mayoristaXlsx(), 'remito.xlsx');
    assert.strictEqual(r.items.length, 3);
    assert.strictEqual(r.docType, 'REMITO');
    assert.strictEqual(r.invoiceNumber, '0002-00004567');
    assert.strictEqual(r.date, '2026-09-10');
    assert.strictEqual(r.supplierName, 'DISTRIBUIDORA NORTE S.A.');
    assert.strictEqual(r.items[0].unitsPerPack, 12);
    assert.strictEqual(r.items[0].quantity, 2);
    near(r.items[1].lineTotal, 12601.5, 'agua');
    near(r.totals.total ?? 0, 56629.82, 'total');
    assert.ok(r.check.ok, r.check.message);
  });

  await t('CSV de sistema viejo: punto y coma, acentos en Latin-1 y números con coma', async () => {
    const r = await readInvoiceFile(sistemaViejoCsv(), 'compra.csv');
    assert.strictEqual(r.items.length, 2);
    assert.strictEqual(r.items[0].name, 'Azúcar común 1 kg');
    assert.strictEqual(r.items[1].quantity, 20);
    near(r.items[1].lineTotal, 19610, 'fideos');
    near(r.totals.total ?? 0, 32110, 'total');
  });

  await t('el total que ingresa el usuario se compara con el de la boleta', async () => {
    const r = await readInvoiceFile(await arcaA(), 'arca.pdf', '', 60000);
    assert.ok(!r.check.ok);
    assert.ok(/ingresaste/.test(r.check.message), r.check.message);
  });

  await t('PDF escaneado (sin texto): avisa que las fotos llegan próximamente', async () => {
    const doc = await PDFDocument.create();
    doc.addPage([595, 842]).drawRectangle({ x: 50, y: 50, width: 400, height: 600 });
    await assert.rejects(readInvoiceFile(Buffer.from(await doc.save()), 'escaneo.pdf'), (e: any) => e instanceof InvoiceReadError && /próximamente/.test(e.message));
  });

  await t('archivo que no es boleta: rechaza con un mensaje claro', async () => {
    await assert.rejects(readInvoiceFile(Buffer.from('hola'), 'foto.jpg', 'image/jpeg'), (e: any) => e instanceof InvoiceReadError);
  });

  // ─── Código de barras o código del proveedor ───

  /** EAN-13 con el dígito verificador bien puesto */
  const ean = (first12: string) => {
    const sum = first12.split('').map(Number).reverse().reduce((a, x, i) => a + x * (i % 2 === 0 ? 3 : 1), 0);
    return first12 + ((10 - (sum % 10)) % 10);
  };
  /** El mismo, con el último dígito cambiado (mal leído) */
  const typo = (code: string) => code.slice(0, -1) + ((Number(code.slice(-1)) + 1) % 10);
  // La columna "ARTICULO" de la factura de Ricardo Nini S.A. (Nini mayorista), tal cual (08/10/2026)
  const NINI = ['1000014274', '000005341002', '000003863001', '1000000905', '1000113987', '1000100600001', '1000012424003',
    '1000003639001', '1000006852', '1000106262', '1000109697', '1000105255', '1000104962', '1000000539', '1000106802',
    '1000108704', '1000001077003', '1000014464', '1000001077002', '1000001077004', '1000012521004', '1000009507',
    '1000005744', '1000009506', '1000006446', '000106691', '000106690', '000003160002'];

  await t('códigos de Nini: ninguno es código de barras, quedan como código del proveedor', async () => {
    for (const where of ['sku', 'barcode'] as const) {
      const out = splitInvoiceCodes(NINI.map((c) => ({ [where]: c })));
      assert.deepStrictEqual(out.map((r) => r.barcode).filter(Boolean), [], `la IA los puso en ${where}`);
      assert.deepStrictEqual(out.map((r) => r.sku), NINI, 'el código del proveedor no se pierde');
    }
    for (const c of ['1000014274', '000005341002', '1000106262', '000003160002']) assert.ok(!isBarcode(c), `${c}: ${barcodeProblem(c)}`);
  });

  await t('uno que pasa el dígito verificador de casualidad no se cuela si la columna es de códigos internos', async () => {
    // 1000012521004 cumple el dígito verificador, pero el resto de la columna de Nini no
    assert.ok(isBarcode('1000012521004'), 'solo, pasaría');
    const out = splitInvoiceCodes(NINI.map((sku) => ({ sku })));
    assert.deepStrictEqual(out[NINI.indexOf('1000012521004')], { barcode: '', sku: '1000012521004' });
  });

  await t('EAN de verdad: van como código de barras aunque la IA los ponga en el SKU', async () => {
    const real = [ean('779089500010'), ean('779040000123'), ean('789100002045'), ean('750100011211'), '96385074'];
    for (const c of real) assert.ok(isBarcode(c), `${c}: ${barcodeProblem(c)}`);
    const out = splitInvoiceCodes(real.map((sku) => ({ sku })));
    assert.deepStrictEqual(out.map((r) => r.barcode), real);
    assert.deepStrictEqual(out.map((r) => r.sku), ['', '', '', '', '']);
    // Dos columnas: código del proveedor y EAN
    const both = splitInvoiceCodes([{ sku: 'A-15', barcode: real[0] }, { sku: '00231', barcode: real[1] }, { sku: '7', barcode: real[2] }]);
    assert.deepStrictEqual(both, [{ barcode: real[0], sku: 'A-15' }, { barcode: real[1], sku: '00231' }, { barcode: real[2], sku: '7' }]);
  });

  await t('una columna de EAN con un renglón mal leído: los buenos quedan, el malo va como código', async () => {
    const good = [ean('779089500010'), ean('779040000123'), ean('779000000777'), ean('779111111222')];
    const bad = typo(ean('779555000111'));
    const out = splitInvoiceCodes([...good, bad].map((barcode) => ({ barcode })));
    assert.deepStrictEqual(out.slice(0, 4).map((r) => r.barcode), good);
    assert.deepStrictEqual(out[4], { barcode: '', sku: bad });
  });

  await t('no es código de barras: largo, verificador, prefijos internos, ceros y patrones', async () => {
    const malos: [string, RegExp][] = [
      ['12345', /dígitos/], ['1000014274', /10 dígitos/], ['77908950001', /11 dígitos/], [typo(ean('779089500010')), /verificador/],
      [ean('200000123456'), /interno/], [ean('290123456789'), /interno/], [ean('020123456789'), /interno/], [ean('050000000001'), /cupones/],
      [ean('990000000001'), /cupones/], [ean('000005341000'), /ceros/], ['0000000000000', /iguales/], ['12345670', /seguidos/],
      ['ABC-123', /letras/], ['', /vacío/],
    ];
    for (const [c, why] of malos) {
      const p = barcodeProblem(c);
      assert.ok(p, `${c} no debería pasar`);
      assert.ok(why.test(p!), `${c}: ${p}`);
    }
  });

  // ─── Foto automática de los productos de la compra ───

  /** SyncImageService con la base y las búsquedas de mentira: anota qué buscó y qué guardó */
  const fotos = (products: { id: string; name: string; barcode: string | null; imageUrl: string | null }[], found: { byCode?: Record<string, string>; byName?: Record<string, string> }) => {
    const log = { codes: [] as string[], names: [] as string[], saved: {} as Record<string, string> };
    const missing = (p: any) => !p.imageUrl || p.imageUrl.includes('unsplash');
    const prisma: any = {
      product: {
        findMany: async ({ where }: any) => products.filter((p) => where.id.in.includes(p.id) && missing(p)),
        updateMany: async ({ where, data }: any) => {
          const p = products.find((x) => x.id === where.id);
          if (!p || (where.OR && !missing(p))) return { count: 0 };
          p.imageUrl = data.imageUrl; log.saved[p.id] = data.imageUrl;
          return { count: 1 };
        },
        findUnique: async ({ where }: any) => ({ ...products.find((x) => x.id === where.id), stock: 0, salePrice: 0, minStock: 0, category: null }),
      },
    };
    const svc = new SyncImageService(prisma, { emitProductUpdated: () => {} } as any,
      { compressRemoteImageToBase64: async (u: string) => `b64:${u}`, syncProductToFirestore: async () => {} } as any, {} as any);
    (svc as any).lookupBarcode = async (code: string) => {
      log.codes.push(code);
      const url = found.byCode?.[code] || null;
      return { name: null, imageUrl: url, source: url ? 'carrefour' : null, candidates: url ? [{ imageUrl: url, source: 'carrefour', name: null, doubtful: false }] : [] };
    };
    const byName = async (n: string) => { log.names.push(n); return found.byName?.[n] || null; };
    for (const m of ['fetchImageFromCarrefourByName', 'fetchImageFromDiaByName', 'fetchImageFromChangoMasByName', 'fetchImageFromJumboByName', 'fetchImageFromFarmacityByName']) (svc as any)[m] = byName;
    return { svc, log };
  };

  await t('foto automática: por código de barras real, por nombre si no hay, sin pisar las que ya tienen', async () => {
    const real = ean('779089500010');
    const { svc, log } = fotos([
      { id: 'a', name: 'Coca Cola 2,25 L', barcode: real, imageUrl: null },
      { id: 'b', name: 'Whiskas pescado 1 kg', barcode: null, imageUrl: '' },
      { id: 'c', name: 'Billiken gotitas 35 g', barcode: null, imageUrl: 'data:image/jpeg;base64,YA' },
      { id: 'd', name: 'Producto raro', barcode: null, imageUrl: null },
    ], { byCode: { [real]: 'https://x/coca.jpg' }, byName: { 'Whiskas pescado 1 kg': 'https://x/whiskas.jpg' } });
    const n = await svc.autoPhotos(['a', 'b', 'c', 'd', 'a']);
    assert.strictEqual(n, 2);
    assert.deepStrictEqual(log.saved, { a: 'b64:https://x/coca.jpg', b: 'b64:https://x/whiskas.jpg' });
    assert.ok(!log.names.includes('Coca Cola 2,25 L'), 'con el código ya alcanzó');
    assert.ok(!log.names.includes('Billiken gotitas 35 g'), 'el que tiene foto no se busca');
  });

  await t('foto automática: un código interno (Nini) no se busca como código de barras, va por el nombre', async () => {
    const { svc, log } = fotos([{ id: 'n', name: 'Pantene sh. prov. hid. fort 200 ml', barcode: '1000109697', imageUrl: null }],
      { byName: { 'Pantene sh. prov. hid. fort 200 ml': 'https://x/pantene.jpg' } });
    assert.strictEqual(await svc.autoPhotos(['n']), 1);
    assert.deepStrictEqual(log.codes, []);
    assert.strictEqual(log.saved.n, 'b64:https://x/pantene.jpg');
  });

  await t('foto automática: si el código no trae foto, prueba con el nombre', async () => {
    const real = ean('779040000123');
    const { svc, log } = fotos([{ id: 'p', name: 'Sugus max 525 g', barcode: real, imageUrl: null }], { byName: { 'Sugus max 525 g': 'https://x/sugus.jpg' } });
    assert.strictEqual(await svc.autoPhotos(['p']), 1);
    assert.deepStrictEqual(log.codes, [real]);
    assert.strictEqual(log.saved.p, 'b64:https://x/sugus.jpg');
  });

  // ─── Tanda 1 del plan de boletas: catálogos grandes, mismo producto en dos renglones, QR de ARCA ───

  /** Buscador con un catálogo en memoria y una IA falsa que solo "encuentra" lo que le mandaron */
  const matcherWith = (products: any[], learned: { id: string; product_id: string }[] = []) => {
    const sent: any[] = [];
    const prisma: any = {
      product: { findMany: async () => products.map((p) => ({ additionalBarcodes: [], supplierId: null, costPrice: 0, salePrice: 0, unitsPerPack: 1, barcode: null, sku: null, ...p })) },
      $queryRawUnsafe: async () => learned,
    };
    const ai: any = {
      call: async (_kind: string, body: any) => {
        sent.push(body);
        const ids = new Set(body.catalog.map((c: any) => c.id));
        // Contesta como la IA: el producto que buscaba, si estaba en lo que le llegó
        return { result: { matches: body.items.map((it: any, i: number) => ({ i, productId: ids.has(it.want) ? it.want : '', confianza: 'alta' })).filter((m: any) => m.productId) } };
      },
    };
    return { svc: new ProductMatcherService(prisma, ai), sent };
  };

  await t('catálogo de 6.000 productos: la IA encuentra uno que está en la posición 5.500', async () => {
    const products = Array.from({ length: 6000 }, (_, i) => ({ id: `p${i}`, name: i === 5500 ? 'ALFAJOR TRIPLE CHOCOLATE NEGRO 70 G' : `PRODUCTO GENERICO ${i} ${['YERBA', 'FIDEOS', 'ARROZ', 'GASEOSA'][i % 4]} ${i % 97} G` }));
    const { svc, sent } = matcherWith(products);
    // La IA falsa busca "want": se lo pasamos en el renglón (el buscador manda name y code)
    const real = (svc as any).ai.call;
    (svc as any).ai.call = (k: string, b: any) => real(k, { ...b, items: b.items.map((it: any) => ({ ...it, want: 'p5500' })) });
    const { matches } = await svc.match([{ name: 'BOCADITO TRIPLE ALF NEGRO 70G XL' }], { useAi: true });
    assert.strictEqual(matches[0]?.product?.id, 'p5500', 'lo encuentra');
    assert.strictEqual(matches[0]?.by, 'ia');
    assert.ok(sent[0].catalog.length <= 30, `solo los parecidos van a la IA (${sent[0].catalog.length})`);
    assert.ok(sent[0].catalog.some((c: any) => c.id === 'p5500'));
  });

  await t('catálogo chico: va entero a la IA, como antes', async () => {
    const { svc, sent } = matcherWith([{ id: 'a', name: 'COCA COLA 2,25 L' }, { id: 'b', name: 'FERNET 750' }]);
    await svc.match([{ name: 'CC 2.25' }], { useAi: true });
    assert.strictEqual(sent[0].catalog.length, 2);
  });

  await t('mismo producto en dos renglones: por código de barras quedan los dos', async () => {
    const real = ean('779040000999');
    const { svc } = matcherWith([{ id: 'coca', name: 'COCA COLA 2,25 L', barcode: real }]);
    const { matches } = await svc.match([{ name: 'COCA 2.25', barcode: real }, { name: 'COCA 2.25 PROMO', barcode: real }], { useAi: false });
    assert.strictEqual(matches[0]?.product.id, 'coca');
    assert.strictEqual(matches[1]?.product.id, 'coca');
  });

  await t('mismo producto en dos renglones: por lo aprendido del proveedor quedan los dos', async () => {
    const { svc } = matcherWith([{ id: 'yerba', name: 'YERBA PLAYADITO 1 KG' }], [{ id: 'S1|c:100', product_id: 'yerba' }, { id: 'S1|c:200', product_id: 'yerba' }]);
    const { matches } = await svc.match([{ name: 'YERBA PLAY 1K', code: '100' }, { name: 'YERBA PLAY 1K OF', code: '200' }], { supplierId: 'S1', useAi: false });
    assert.strictEqual(matches[0]?.by, 'learned');
    assert.strictEqual(matches[1]?.product.id, 'yerba');
  });

  await t('mismo producto por nombre en dos renglones: sigue quedando uno solo (el otro con sugerencias)', async () => {
    const { svc } = matcherWith([{ id: 'f', name: 'FIDEOS MOSTACHOL 500 G' }]);
    const { matches, candidates } = await svc.match([{ name: 'FIDEOS MOSTACHOL 500 G' }, { name: 'FIDEOS MOSTACHOL 500 G' }], { useAi: false });
    assert.strictEqual(matches.filter(Boolean).length, 1);
    assert.ok(candidates[1].length || candidates[0].length, 'el que quedó sin producto tiene sugerencias');
  });

  await t('código de barras le gana a un parecido por nombre del mismo producto', async () => {
    const real = ean('779040000888');
    const { svc } = matcherWith([{ id: 'x', name: 'GALLETITAS OREO 118 G', barcode: real }]);
    const { matches } = await svc.match([{ name: 'GALLETITAS OREO 118 G' }, { name: 'OREO', barcode: real }], { useAi: false });
    assert.strictEqual(matches[0], null);
    assert.strictEqual(matches[1]?.by, 'barcode');
  });

  await t('mapa compartido: lo que asoció un comercio le llega al otro; un voto solo no carga nada solo', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cloud = require('../../../firebase/functions/supplier-codes');
    const docs: Record<string, any> = {};
    const ref = (id: string) => ({ id, get: async () => ({ id, exists: !!docs[id], data: () => docs[id] }), set: async (v: any) => { docs[id] = v; } });
    const cloudDb: any = { collection: () => ({ doc: ref }), runTransaction: async (fn: any) => fn({ get: (r: any) => r.get(), set: (r: any, v: any) => r.set(v) }), getAll: (...refs: any[]) => Promise.all(refs.map((r) => r.get())) };
    const sharedFor = (uid: string): any => ({
      supplierCodes: async (c: string, codes: string[]) => (await cloud.get(cloudDb, uid, c, codes)).items,
      confirmSupplierCodes: (c: string, items: any[]) => cloud.confirm(cloudDb, uid, c, items),
    });
    const CUIT = cuit('30', '71555123');
    const YERBA = ean('779040000555');
    const shop = (products: any[]) => {
      const prisma: any = {
        product: {
          findMany: async () => products.map((p) => ({ additionalBarcodes: [], supplierId: null, costPrice: 0, salePrice: 0, unitsPerPack: 1, sku: null, ...p })),
          findUnique: async () => ({ sku: 'YA-TIENE' }), findFirst: async () => null, update: async () => ({}),
        },
        $queryRawUnsafe: async (sql: string) => (/FROM suppliers/.test(sql) ? [{ cuit: CUIT }] : []),
        $executeRawUnsafe: async () => 1,
      };
      return prisma;
    };
    const tick = () => new Promise((r) => setTimeout(r, 30));
    // Comercio A confirma una boleta: el código 100234 del proveedor es su yerba (con código de barras)
    const a = new ProductMatcherService(shop([{ id: 'a1', name: 'YERBA SUAVE X 1 KG', barcode: YERBA, unitsPerPack: 10 }]), {} as any, sharedFor('A'));
    await a.learn('SUP-A', [{ code: '100234', name: 'YERBA MATE SUAVE 1 KG', productId: 'a1' }]);
    await tick();
    // Comercio B, otra boleta del mismo proveedor, su yerba tiene otro nombre: la encuentra, pero con un voto queda dudosa
    const bProducts = [{ id: 'b7', name: 'Playadito suave 1kg', barcode: YERBA }];
    const b = new ProductMatcherService(shop(bProducts), {} as any, sharedFor('B'));
    let r = await b.match([{ code: '0100234', name: 'YERBA MATE SUAVE 1 KG' }], { supplierId: 'SUP-B', supplierCuit: CUIT, useAi: false });
    assert.strictEqual(r.matches[0]?.product.id, 'b7', 'le llega lo del primero');
    assert.strictEqual(r.matches[0]?.by, 'shared');
    assert.strictEqual(r.matches[0]?.confidence, 'baja', 'un voto solo: dudoso, no se carga solo');
    // Un tercer comercio coincide: ya es seguro
    const c = new ProductMatcherService(shop([{ id: 'c3', name: 'YERBA SUAVE', barcode: YERBA }]), {} as any, sharedFor('C'));
    await c.learn('SUP-C', [{ code: '100234', name: 'YERBA MATE SUAVE 1 KG', productId: 'c3' }]);
    await tick();
    r = await b.match([{ code: '100234', name: 'YERBA MATE SUAVE 1 KG' }], { supplierId: 'SUP-B', supplierCuit: CUIT, useAi: false });
    assert.strictEqual(r.matches[0]?.confidence, 'alta');
    // Comercio D no tiene esa yerba: viene como producto nuevo con código de barras, nombre y bulto
    const d = new ProductMatcherService(shop([{ id: 'd1', name: 'FIDEOS' }]), {} as any, sharedFor('D'));
    r = await d.match([{ code: '100234', name: 'YERBA MATE SUAVE 1 KG' }], { supplierId: 'SUP-D', supplierCuit: CUIT, useAi: false });
    assert.strictEqual(r.matches[0], null);
    assert.strictEqual(r.sharedHints[0]?.barcode, YERBA);
    assert.strictEqual(r.sharedHints[0]?.confidence, 'alta');
    assert.strictEqual(r.sharedHints[0]?.unitsPerPack, 10);
    // Comercios que no coinciden: dudoso
    await cloud.confirm(cloudDb, 'E', CUIT, [{ code: '100234', barcode: ean('779040000666'), name: 'OTRA' }]);
    r = await b.match([{ code: '100234', name: 'YERBA' }], { supplierId: 'SUP-B', supplierCuit: CUIT, useAi: false });
    assert.strictEqual(r.matches[0]?.confidence, 'baja');
    // Nunca precios ni cantidades en la nube; sin CUIT o sin internet, nada
    assert.ok(!JSON.stringify(docs).match(/cost|price|quantity/i));
    const off = new ProductMatcherService(shop(bProducts), {} as any, { supplierCodes: async () => { throw new Error('sin internet'); } } as any);
    r = await off.match([{ code: '100234', name: 'YERBA' }], { supplierId: 'SUP-B', supplierCuit: CUIT, useAi: false });
    assert.strictEqual(r.matches[0], null);
  });

  await t('sin internet: la foto queda en espera (en disco) y se lee sola cuando vuelve la conexión', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ScanJobsService } = require('../src/modules/purchases/scan-jobs.service');
    const { ServiceUnavailableException } = require('@nestjs/common');
    let online = false;
    const calls: string[] = [];
    const ai: any = {
      shrink: async (files: any[]) => files.map(() => ({ mediaType: 'image/jpeg', data: 'AAAA' })),
      call: async (_k: string, body: any) => {
        calls.push(body.stage);
        if (!online) throw new ServiceUnavailableException('sin internet');
        if (body.stage === 'page') return { result: { read: { image: body.index, supplierName: 'PROV', invoiceNumber: '1-9', items: [{ name: 'SAL', packageQuantity: 1, total: '100' }] } } };
        return { result: { documents: [{ supplierName: 'PROV', items: [{ name: 'SAL' }], images: [0] }] } };
      },
    };
    const saved: any[] = [];
    const purchases: any = { supplierCuits: async () => [], saveScannedDocument: async (d: any) => { saved.push(d); return { purchaseId: 'P1', status: 'PENDING', supplierName: 'PROV', items: [{}] }; }, notify: async () => {} };
    const svc = new ScanJobsService(ai, purchases);
    const job = svc.start([{ buffer: Buffer.from('x'), mimetype: 'image/jpeg', originalname: 'a.jpg' }], 'u1');
    await new Promise((r) => setTimeout(r, 50));
    let v = svc.get(job.id, 'u1');
    assert.strictEqual(v.status, 'waiting');
    assert.strictEqual(v.photos[0].state, 'waiting');
    assert.strictEqual(v.waiting, 1);
    // Vuelve internet: se lee sola y queda en Por revisar
    online = true;
    await svc.retryWaiting();
    v = svc.get(job.id, 'u1');
    assert.strictEqual(v.status, 'done');
    assert.strictEqual(saved.length, 1);
    assert.strictEqual(v.documents[0].purchaseId, 'P1');
  });

  await t('hojas que faltan: se suman a la factura pendiente y se controla el total', async () => {
    const old = { pageCount: 3, missingPageNumbers: [3], missingPages: 1, printedTotal: null, sampleIds: ['s1'], why: ['faltan hojas (3)', '1 renglón dudoso'],
      items: [{ name: 'A', total: 4000 }, { name: 'B', total: 3000 }] };
    const add = { pageCount: 3, missingPageNumbers: [1, 2], missingPages: 2, printedTotal: 12100, sampleIds: ['s2'], why: ['faltan hojas (1, 2)'], items: [{ name: 'C', total: 3000 }] };
    const m = mergeMissingPages(old, add)!;
    assert.ok(m, 'se juntan');
    assert.deepStrictEqual(m.items.map((i: any) => i.name), ['A', 'B', 'C']);
    assert.deepStrictEqual(m.missingPageNumbers, []);
    assert.strictEqual(m.check.ok, true);
    assert.deepStrictEqual(m.sampleIds, ['s1', 's2']);
    assert.ok(!m.why.some((w: string) => /falta/.test(w)) && m.why.includes('1 renglón dudoso'));
    // Repite una hoja que ya estaba: no se junta (duplicaría renglones)
    assert.strictEqual(mergeMissingPages(old, { ...add, missingPageNumbers: [1] }), null);
    // Llega solo una de dos que faltaban: quedan las otras
    const parcial = mergeMissingPages({ ...old, missingPageNumbers: [2, 3], missingPages: 2 }, { ...add, missingPageNumbers: [1, 2] })!;
    assert.deepStrictEqual(parcial.missingPageNumbers, [2]);
    assert.strictEqual(parcial.check.ok, false);
    // Una pendiente completa no se toca
    assert.strictEqual(mergeMissingPages({ ...old, missingPageNumbers: [], missingPages: 0 }, add), null);
  });

  await t('QR de ARCA: el ejemplo oficial de la especificación se decodifica entero', async () => {
    const url = 'https://www.afip.gob.ar/fe/qr/?p=eyJ2ZXIiOjEsImZlY2hhIjoiMjAyMC0xMC0xMyIsImN1aXQiOjMwMDAwMDAwMDA3LCJwdG9WdGEiOjEwLCJ0aXBvQ21wIjoxLCJucm9DbXAiOjk0LCJpbXBvcnRlIjoxMjEwMCwibW9uZWRhIjoiRE9MIiwiY3R6Ijo2NSwidGlwb0RvY1JlYyI6ODAsIm5yb0RvY1JlYyI6MjAwMDAwMDAwMDEsInRpcG9Db2RBdXQiOiJFIiwiY29kQXV0Ijo3MDQxNzA1NDM2NzQ3Nn0=';
    const q = parseArcaQrText(url)!;
    assert.ok(q, 'se lee');
    assert.deepStrictEqual([q.fecha, q.cuit, q.ptoVta, q.tipoCmp, q.nroCmp, q.importe, q.moneda, q.ctz, q.tipoDocRec, q.nroDocRec], ['2020-10-13', 30000000007, 10, 1, 94, 12100, 'DOL', 65, 80, 20000000001]);
    assert.strictEqual(qrTotalPesos(q), 786500, 'en dólares: importe por cotización');
    assert.strictEqual(qrKind(q), 'factura');
    assert.strictEqual(qrKind({ tipoCmp: 8 }), 'nota de crédito');
    assert.strictEqual(parseArcaQrText('https://www.arca.gob.ar/fe/qr/?p=bm8gZXMganNvbg=='), null, 'base64 que no es JSON');
    assert.strictEqual(parseArcaQrText('https://otra.com/?p=eyJ2ZXIiOjF9'), null, 'otra página');
  });

  await t('QR de ARCA: se lee de la foto (QR generado sobre una hoja blanca)', async () => {
    let QR: any;
    try { QR = require('../../frontend/node_modules/qrcode'); } catch { console.log('      (sin el paquete qrcode del frontend: se saltea)'); return; }
    const json = { ver: 1, fecha: '2026-11-12', cuit: 30712345675, ptoVta: 3, tipoCmp: 6, nroCmp: 4521, importe: 182400.5, moneda: 'PES', ctz: 1, tipoDocRec: 80, nroDocRec: 20111111112, tipoCodAut: 'E', codAut: 76123456789012 };
    const png: Buffer = await QR.toBuffer(`https://www.arca.gob.ar/fe/qr/?p=${Buffer.from(JSON.stringify(json)).toString('base64')}`, { width: 260, margin: 2 });
    // La "foto": una hoja grande con el QR chico en una esquina
    const { Jimp } = require('jimp');
    const page = new Jimp({ width: 2400, height: 3200, color: 0xffffffff });
    page.composite(await Jimp.read(png), 2050, 2850);
    const q = await readArcaQr(await page.getBuffer('image/jpeg', { quality: 90 }));
    assert.ok(q, 'encuentra el QR');
    assert.strictEqual(q!.nroCmp, 4521);
    assert.strictEqual(qrTotalPesos(q!), 182400.5);
    assert.strictEqual(await readArcaQr(Buffer.from('no es una foto')), null, 'sin foto: null, sin error');
  });

  console.log(`\n${ok} bien, ${fallas} con falla`);
  process.exit(fallas ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});

