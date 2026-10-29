/**
 * Pruebas del puntaje de sospecha del control de anulaciones (lo que se quita del ticket).
 * Casos típicos del mostrador: el error de escaneo corregido al instante no tiene que alarmar
 * a nadie; cobrar, vaciar el ticket y no vender nada, sí.
 *
 *   npm run test:anulaciones
 */
import * as assert from 'assert';
import { scoreVoid, flagCashiers, FollowUp } from '../src/modules/pos-trail/void-score';

let fallas = 0;
let ok = 0;
const t = (nombre: string, fn: () => void) => {
  try { fn(); ok++; console.log(`ok    ${nombre}`); } catch (e: any) { fallas++; console.log(`FALLA ${nombre}\n      ${e.message}`); }
};
const noSale: FollowUp = { saleAfter: false, sameProductResold: false };
const sale: FollowUp = { saleAfter: true, sameProductResold: false };
const resold: FollowUp = { saleAfter: true, sameProductResold: true };
const item = (secondsInCart: number | null) => ({ productId: 'p1', secondsInCart });

t('escaneo doble corregido al instante: normal', () => {
  const r = scoreVoid({ action: 'QTY_REDUCED', amount: 1500, totalAfter: 4000, items: [item(3)] }, sale);
  assert.strictEqual(r.level, 'normal');
  assert.strictEqual(r.score, 0);
});

t('vació el ticket después de abrir el cobro y no vendió: sospechoso', () => {
  const r = scoreVoid({ action: 'CART_CLEARED', amount: 6000, totalAfter: 0, totalShown: true, items: [item(90)] }, noSale);
  assert.strictEqual(r.level, 'sospechoso');
  assert.ok(r.reasons.some((x) => x.includes('abrir el cobro')));
  assert.ok(r.reasons.some((x) => x.includes('3 minutos')));
});

t('vació el ticket sin abrir el cobro pero no vendió, a los 2 min: revisar', () => {
  const r = scoreVoid({ action: 'CART_CLEARED', amount: 3000, totalAfter: 0, items: [item(130)] }, noSale);
  assert.strictEqual(r.level, 'revisar');
});

t('vació el ticket y enseguida vendió lo mismo (lo rehízo): normal', () => {
  const r = scoreVoid({ action: 'CART_CLEARED', amount: 3000, totalAfter: 0, items: [item(20)] }, resold);
  assert.strictEqual(r.level, 'normal');
});

t('cliente que no le alcanza: quita un producto chico después de abrir el cobro y paga el resto: revisar', () => {
  const r = scoreVoid({ action: 'ITEM_REMOVED', amount: 1200, totalAfter: 5000, totalShown: true, items: [item(40)] }, sale);
  assert.strictEqual(r.level, 'revisar');
});

t('quita algo caro después de abrir el cobro, mucho después de escanearlo: sospechoso', () => {
  const r = scoreVoid({ action: 'ITEM_REMOVED', amount: 15000, totalAfter: 2000, totalShown: true, items: [item(240)] }, sale);
  assert.strictEqual(r.level, 'sospechoso');
  assert.ok(r.reasons.some((x) => x.includes('4 min')));
});

t('lo quitó después de abrir el cobro pero lo volvió a cobrar: baja a normal', () => {
  const r = scoreVoid({ action: 'ITEM_REMOVED', amount: 2000, totalAfter: 0, totalShown: true, items: [item(30)] }, resold);
  assert.strictEqual(r.level, 'normal');
});

t('monto grande usa el ajuste del dueño', () => {
  const chico = scoreVoid({ action: 'ITEM_REMOVED', amount: 8000, totalAfter: 3000, items: [item(30)] }, sale, 10000);
  const grande = scoreVoid({ action: 'ITEM_REMOVED', amount: 8000, totalAfter: 3000, items: [item(30)] }, sale, 5000);
  assert.strictEqual(chico.score, 0);
  assert.strictEqual(grande.score, 20);
});

t('sin los 3 minutos cumplidos queda pendiente', () => {
  const r = scoreVoid({ action: 'CART_CLEARED', amount: 3000, totalAfter: 0, items: [item(20)] }, undefined);
  assert.strictEqual(r.pending, true);
});

t('borrar un ticket en espera viejo sin vender: revisar', () => {
  const r = scoreVoid({ action: 'HELD_CART_DELETED', amount: 4000, totalAfter: 0, items: [item(null)] }, noSale);
  assert.strictEqual(r.level, 'revisar');
  const caro = scoreVoid({ action: 'HELD_CART_DELETED', amount: 40000, totalAfter: 0, items: [item(null)] }, noSale);
  assert.strictEqual(caro.level, 'sospechoso');
});

t('el dueño borra un producto sin stock: revisar como mucho', () => {
  const r = scoreVoid({ action: 'PRODUCT_DELETED', amount: 0, byAdmin: true, stock: 0, count: 1 }, undefined);
  assert.strictEqual(r.level, 'revisar');
});

t('un cajero borra productos con stock: sospechoso', () => {
  const r = scoreVoid({ action: 'PRODUCTS_BULK_DELETED', amount: 50000, byAdmin: false, stock: 12, count: 4 }, undefined);
  assert.strictEqual(r.level, 'sospechoso');
});

t('cajero que quita el doble que el resto cada 100 ventas', () => {
  const flagged = flagCashiers([
    { userId: 'ana', sales: 200, voids: 6 },
    { userId: 'beto', sales: 180, voids: 5 },
    { userId: 'lucas', sales: 150, voids: 18 },
  ]);
  assert.deepStrictEqual([...flagged], ['lucas']);
});

t('con pocas ventas no se marca a nadie', () => {
  assert.strictEqual(flagCashiers([{ userId: 'a', sales: 5, voids: 5 }, { userId: 'b', sales: 5, voids: 0 }]).size, 0);
});

console.log(`\n${ok} ok, ${fallas} fallas`);
if (fallas) process.exit(1);
