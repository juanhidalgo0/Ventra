// Pruebas de las etiquetas de balanza (utils/scaleLabel.ts).
// npm run test:balanza
import assert from 'node:assert/strict';
import {
  DEFAULT_SCALE_FORMAT, parseScaleLabel, buildScaleLabel, detectScaleFormat, cleanScaleFormat, buildPluIndex, scaleLine, eanCheckDigit,
  type ScaleFormat,
} from '../src/utils/scaleLabel';
import { gtinCheckOk } from '../src/utils/scanCheck';

let n = 0;
const t = (name: string, fn: () => void) => { fn(); n++; console.log('  ✓', name); };

const F = DEFAULT_SCALE_FORMAT;
const SEIS: ScaleFormat = { prefix: '2', pluStart: 2, pluLen: 4, kind: 'price', valueLen: 6, decimals: 0 };
const PESO: ScaleFormat = { prefix: '2', pluStart: 2, pluLen: 5, kind: 'weight', valueLen: 5, decimals: 3 };

t('dígito verificador EAN-13', () => {
  assert.equal(eanCheckDigit('779123456789'), '8');
  assert.ok(gtinCheckOk('7791234567898'));
});

t('formato de fábrica: 20 PPPPP IIIII V', () => {
  const code = buildScaleLabel(12, 15000, F);
  assert.equal(code.slice(0, 12), '200001215000');
  assert.ok(gtinCheckOk(code));
  assert.deepEqual(parseScaleLabel(code, F), { plu: '12', kind: 'price', amount: 15000 });
});

t('importe de 6 cifras ($120.000 de asado)', () => {
  const code = buildScaleLabel(7, 120000, SEIS);
  assert.equal(code.slice(0, 12), '200007120000');
  assert.deepEqual(parseScaleLabel(code, SEIS), { plu: '7', kind: 'price', amount: 120000 });
});

t('etiqueta con el peso en gramos', () => {
  const code = buildScaleLabel(33, 1.235, PESO);
  assert.deepEqual(parseScaleLabel(code, PESO), { plu: '33', kind: 'weight', kg: 1.235 });
});

t('no es etiqueta: código de fábrica, verificador malo, largo distinto', () => {
  assert.equal(parseScaleLabel('7791234567898', F), null);
  const ok = buildScaleLabel(12, 15000, F);
  const bad = ok.slice(0, 12) + String((Number(ok[12]) + 1) % 10);
  assert.equal(parseScaleLabel(bad, F), null);
  assert.equal(parseScaleLabel('20000121500', F), null);
  assert.equal(parseScaleLabel('', F), null);
});

t('detecta el formato con una etiqueta de muestra', () => {
  const [first] = detectScaleFormat(buildScaleLabel(12, 15000, F), 12, { amount: 15000 });
  assert.deepEqual(first, F);
  const [six] = detectScaleFormat(buildScaleLabel(7, 23450, SEIS), 7, { amount: 23450 });
  assert.equal(six.valueLen, 6);
  assert.equal(six.pluLen, 4);
  // Con el importe de muestra leído con el formato detectado, una etiqueta grande también da bien
  assert.equal(parseScaleLabel(buildScaleLabel(7, 154300, SEIS), six)!.amount, 154300);
  const [w] = detectScaleFormat(buildScaleLabel(33, 0.875, PESO), 33, { kg: 0.875 });
  assert.equal(w.kind, 'weight');
  assert.equal(parseScaleLabel(buildScaleLabel(33, 2.4, PESO), w)!.kg, 2.4);
});

t('detecta importes con centavos', () => {
  const cents: ScaleFormat = { prefix: '2', pluStart: 2, pluLen: 4, kind: 'price', valueLen: 6, decimals: 2 };
  const code = buildScaleLabel(5, 2345.67, cents);
  const [f] = detectScaleFormat(code, 5, { amount: 2345.67 });
  assert.equal(f.decimals, 2);
});

t('no detecta nada si el PLU o el importe no aparecen', () => {
  assert.deepEqual(detectScaleFormat(buildScaleLabel(12, 15000, F), 99, { amount: 15000 }), []);
  assert.deepEqual(detectScaleFormat(buildScaleLabel(12, 15000, F), 12, { amount: 14000 }), []);
  assert.deepEqual(detectScaleFormat('7791234567898', 12, { amount: 15000 }), []);
});

t('formato guardado roto vuelve al de fábrica', () => {
  assert.deepEqual(cleanScaleFormat(null), F);
  assert.deepEqual(cleanScaleFormat({ pluStart: 2, pluLen: 7, valueLen: 6 }), F);
  assert.equal(cleanScaleFormat({ ...PESO }).decimals, 3);
});

t('PLU por código interno o código corto; gana el producto por kilo', () => {
  const idx = buildPluIndex([
    { id: 'a', sku: '0012', unit: 'KG' },
    { id: 'b', barcode: '12', unit: 'UNIT' },
    { id: 'c', barcode: '7791234567898', unit: 'UNIT' },
    { id: 'd', sku: 'ABC', unit: 'KG' },
    { id: 'e', barcode: '30', unit: 'UNIT' },
    { id: 'f', sku: '30', unit: 'KG' },
    { id: 'g', sku: '40', unit: 'KG', isActive: false },
  ]);
  assert.equal(idx.get('12').id, 'a');
  assert.equal(idx.get('30').id, 'f');
  assert.equal(idx.has('40'), false);
  assert.equal(idx.size, 2);
});

t('renglón del ticket: el cliente paga lo que dice la etiqueta', () => {
  // 1,5 kg justos a $15.000: entra al precio del producto
  assert.deepEqual(scaleLine(10000, { plu: '12', kind: 'price', amount: 15000 }), { qty: 1.5 });
  // $22.437 a $15.000 el kilo: 1,496 kg, con el precio ajustado para cobrar $22.437
  const l = scaleLine(15000, { plu: '12', kind: 'price', amount: 22437 });
  assert.equal(l.qty, 1.496);
  // El precio va sin redondear a centavos (addToCart con exactPrice): el renglón da justo lo impreso
  assert.ok(Math.abs(l.qty * l.customPrice! - 22437) < 0.001);
  // Con el peso: entra el peso
  assert.deepEqual(scaleLine(15000, { plu: '12', kind: 'weight', kg: 0.8 }), { qty: 0.8 });
  // Producto sin precio: se cobra el importe de la etiqueta
  assert.deepEqual(scaleLine(0, { plu: '12', kind: 'price', amount: 5000 }), { qty: 1, customPrice: 5000 });
});

console.log(`\n${n} pruebas de balanza OK`);
