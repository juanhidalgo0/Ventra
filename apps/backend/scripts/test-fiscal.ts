/**
 * Pruebas de las reglas de facturación (sin conexión a ARCA): importes por alícuota,
 * CUIT, receptor, fechas en hora argentina y QR. Es donde se juegan los rechazos más caros.
 *
 *   npm run test:fiscal
 */
import * as assert from 'assert';
import {
  buildImportes,
  ComprobanteError,
  cuitValida,
  decideCbteTipo,
  esFacturable,
  fechaArca,
  fechaArcaIso,
  Importes,
  notaCreditoDe,
  parseFechaArca,
  qrUrl,
  resolveReceptor,
  round2,
  tipoDesdeCodigo,
} from '../src/modules/fiscal/comprobante';

let fallas = 0;
let ok = 0;
const t = (nombre: string, fn: () => void) => {
  try {
    fn();
    ok++;
  } catch (e: any) {
    fallas++;
    console.log(`FALLA ${nombre}\n  ${e.message}`);
  }
};

const B = decideCbteTipo('RESPONSABLE_INSCRIPTO', 'CONSUMIDOR_FINAL');
const A = decideCbteTipo('RESPONSABLE_INSCRIPTO', 'RESPONSABLE_INSCRIPTO');
const C = decideCbteTipo('MONOTRIBUTO', 'RESPONSABLE_INSCRIPTO');
const cierra = (imp: Importes) => assert.strictEqual(round2(imp.ImpNeto + imp.ImpIVA), imp.ImpTotal, `neto + iva != total: ${JSON.stringify(imp)}`);

t('tipo de comprobante y su nota de crédito', () => {
  assert.strictEqual(B.cbteTipo, 6);
  assert.strictEqual(A.cbteTipo, 1);
  assert.strictEqual(C.cbteTipo, 11);
  assert.strictEqual(notaCreditoDe(B).cbteTipo, 8);
  assert.strictEqual(notaCreditoDe(A).cbteTipo, 3);
  assert.strictEqual(notaCreditoDe(C).cbteTipo, 13);
  assert.strictEqual(notaCreditoDe(B).invoiceType, 'NC_B');
  assert.strictEqual(tipoDesdeCodigo(11).discriminatesIva, false);
  assert.strictEqual(tipoDesdeCodigo(1).requiresCuit, true);
});

t('CUIT con dígito verificador', () => {
  assert.ok(cuitValida('20431856108'));
  assert.ok(cuitValida('20-43185610-8'));
  assert.ok(!cuitValida('20431856109'));
  assert.ok(!cuitValida('2043185610'));
});

t('factura C: el total va derecho, sin alícuotas', () => {
  const imp = buildImportes([{ total: 1500.5, taxRate: 21 }, { total: 99.99, taxRate: 0 }], 0, C);
  assert.deepStrictEqual([imp.ImpTotal, imp.ImpNeto, imp.ImpIVA, imp.Iva], [1600.49, 1600.49, 0, undefined]);
});

t('factura B: el producto sin alícuota toma la general del comercio', () => {
  const imp = buildImportes([{ total: 121, taxRate: 0 }], 0, B, 21);
  assert.deepStrictEqual(imp.Iva, [{ Id: 5, BaseImp: 100, Importe: 21, rate: 21 }]);
  cierra(imp);
});

t('factura B: tres alícuotas con centavos raros cierran exacto (rechazo 10048)', () => {
  for (let k = 0; k < 2000; k++) {
    const imp = buildImportes([
      { total: Math.round(Math.random() * 1e6) / 100, taxRate: 21 },
      { total: Math.round(Math.random() * 1e5) / 100, taxRate: 10.5 },
      { total: Math.round(Math.random() * 1e4) / 100, taxRate: 27 },
    ], 0, B);
    cierra(imp);
    assert.strictEqual(imp.Iva!.reduce((a, l) => round2(a + l.BaseImp + l.Importe), 0), imp.ImpTotal);
    for (const l of imp.Iva!) assert.ok(Math.abs((l.BaseImp * l.rate) / 100 - l.Importe) <= 0.011, `IVA fuera de tolerancia ${JSON.stringify(l)}`);
  }
});

t('una alícuota en negativo (devolución) no se factura', () => {
  assert.throws(() => buildImportes([{ total: 100, taxRate: 21 }, { total: -50, taxRate: 10.5 }], 0, B), ComprobanteError);
  assert.throws(() => buildImportes([{ total: 100, taxRate: 21 }, { total: -100, taxRate: 21 }], 0, C), ComprobanteError);
});

t('receptor', () => {
  assert.strictEqual(resolveReceptor(null).docTipo, 99);
  assert.strictEqual(resolveReceptor({ dni: '35.123.456' }).docTipo, 96);
  assert.strictEqual(resolveReceptor({ dni: '35123456', ivaCondition: 'RESPONSABLE_INSCRIPTO' }).ivaCondition, 'CONSUMIDOR_FINAL');
  const ri = resolveReceptor({ cuit: '20-43185610-8', ivaCondition: 'RESPONSABLE_INSCRIPTO' });
  assert.deepStrictEqual([ri.docTipo, ri.condicionIvaId], [80, 1]);
});

t('fechas en hora argentina (el servidor en UTC no puede pasar la venta al día siguiente)', () => {
  assert.strictEqual(fechaArca(new Date('2026-11-01T01:30:00Z')), '20261031');
  assert.strictEqual(fechaArcaIso('20261031'), '2026-10-31');
  for (const timeZone of ['America/Argentina/Buenos_Aires', 'UTC']) {
    assert.strictEqual(parseFechaArca('20261012')!.toLocaleDateString('es-AR', { timeZone }), '12/10/2026');
  }
});

t('QR de ARCA (RG 4892)', () => {
  const url = qrUrl({ issueDate: '20261002', cuit: '20431856108', pointOfSale: 1, cbteTipo: 11, number: 10, total: 1234.5, docTipo: 99, docNro: '0', cae: '86380921655822' });
  const json = JSON.parse(Buffer.from(url.split('?p=')[1], 'base64').toString('utf8'));
  assert.deepStrictEqual(json, {
    ver: 1, fecha: '2026-10-02', cuit: 20431856108, ptoVta: 1, tipoCmp: 11, nroCmp: 10, importe: 1234.5,
    moneda: 'PES', ctz: 1, tipoDocRec: 99, nroDocRec: 0, tipoCodAut: 'E', codAut: 86380921655822,
  });
});

t('pagos de cuenta corriente y cargas virtuales no se facturan', () => {
  assert.ok(!esFacturable('PAGO_CTA_CTE'));
  assert.ok(!esFacturable('VIRTUAL_LOAD_1'));
  assert.ok(esFacturable('VENTA_RAPIDA'));
});

console.log(`${ok} pruebas OK${fallas ? `, ${fallas} con fallas` : ''}`);
if (fallas) process.exit(1);
