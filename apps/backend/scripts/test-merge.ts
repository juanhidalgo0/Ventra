/**
 * Pruebas de "productos repetidos" (product-merge.service): encontrarlos, juntarlos y separarlos,
 * sobre una base SQLite temporal. Nada se borra: juntar oculta y se puede separar.
 *
 *   npm run test:repetidos
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ventra-repetidos-'));
const DB = path.join(DIR, 'test.db').replace(/\\/g, '/');
process.env.DATABASE_URL = `file:${DB}`;
process.env.VENTRA_SUBSCRIPTION_EXEMPT = 'true';
process.env.VENTRA_FUNCTIONS_URL = 'http://127.0.0.1:9';

execSync('npx prisma db push --skip-generate', { cwd: path.resolve(__dirname, '..'), env: process.env, stdio: 'ignore' });

/* eslint-disable @typescript-eslint/no-var-requires */
const { PrismaService } = require('../src/database/prisma.service');
const { ProductMergeService } = require('../src/modules/products/product-merge.service');

let fallas = 0;
let ok = 0;
const t = async (nombre: string, fn: () => Promise<void> | void) => {
  try { await fn(); ok++; console.log(`ok    ${nombre}`); } catch (e: any) { fallas++; console.log(`FALLA ${nombre}\n      ${e.stack || e.message}`); }
};

async function main() {
  const prisma = new PrismaService();
  await prisma.onModuleInit();
  const backups: string[] = [];
  const svc = new ProductMergeService(prisma, undefined, { createBackup: async (type: string) => { backups.push(type); return { filename: `seguridad-${backups.length}.db`, path: '', size: 1 }; } });

  const admin = await prisma.user.create({ data: { username: 'ADMIN', passwordHash: 'x', fullName: 'Dueño', role: 'ADMIN' } });
  const nuevo = (name: string, extra: any = {}) => prisma.product.create({ data: { name, salePrice: 2700, costPrice: 1500, ...extra } });
  // Repetidos de verdad
  const rad1 = await nuevo('RAD ENERGIZANTE X 500', { barcode: '7798113300013', stock: -125 });
  const rad2 = await nuevo('Rad energizante x 500', { barcode: '7790070318312', stock: -91 });
  const jam1 = await nuevo('PALADINI JAMON COCIDO X 200 GR', { stock: 5 });
  const jam2 = await nuevo('PALADINI JAMON COCIDO X 200', { barcode: '7790360021090', stock: 3 });
  // Parecidos que NO son el mismo (talle) y variantes de indumentaria
  const gM = await nuevo('MAKE GUANTES M');
  const gXG = await nuevo('MAKE GUANTES XG');
  await nuevo('REMERA BASICA', { variantGroupId: 'v1' });
  await nuevo('REMERA BASICA', { variantGroupId: 'v1' });
  // Uno que no tiene que aparecer
  await nuevo('COCA COLA 1.5');
  // Ventas: el RAD 1 se vende, el 2 no
  const caja = await prisma.cashRegisterSession.create({ data: { userId: admin.id, terminalName: 'Caja 1', openingAmount: 0 } as any });
  const venta = await prisma.sale.create({ data: { saleNumber: 1, userId: admin.id, sessionId: caja.id, subtotal: 2700, total: 2700, status: 'COMPLETED', paymentMethodSummary: 'CASH' } as any });
  await prisma.saleItem.create({ data: { saleId: venta.id, productId: rad1.id, productName: rad1.name, quantity: 1, unitPrice: 2700, subtotal: 2700, total: 2700 } as any });
  // Un lote de vencimiento en el repetido
  const lote = await prisma.productLot.create({ data: { productId: jam2.id, expiresAt: new Date(Date.now() + 10 * 864e5), quantity: 3 } });

  await t('encuentra los repetidos: mismo nombre (sin importar mayúsculas) y mismas palabras con "gr" de más', async () => {
    const r = await svc.duplicates();
    const keys = r.groups.map((g: any) => g.products.map((p: any) => p.id).sort().join('|'));
    assert.ok(keys.includes([rad1.id, rad2.id].sort().join('|')), 'RAD');
    assert.ok(keys.includes([jam1.id, jam2.id].sort().join('|')), 'jamón');
    assert.ok(!r.groups.some((g: any) => g.products.some((p: any) => p.name === 'REMERA BASICA')), 'las variantes no son repetidos');
    assert.ok(!r.groups.some((g: any) => g.products.some((p: any) => p.id === gM.id || p.id === gXG.id)), 'talles distintos no se agrupan');
    const rad = r.groups.find((g: any) => g.products.some((p: any) => p.id === rad1.id));
    assert.strictEqual(rad.kind, 'igual');
    assert.strictEqual(rad.keepId, rad1.id, 'queda el que se vende');
    assert.strictEqual(rad.products.find((x: any) => x.id === rad1.id).sold, 1);
    const p = rad.products.find((x: any) => x.id === rad2.id);
    assert.deepStrictEqual([p.barcode, p.stock], ['7790070318312', -91]);
  });

  let mergeId = '';
  await t('"parecen distintos": códigos distintos y se venden todos (sabores con el mismo nombre)', async () => {
    const b1 = await nuevo('BEL BOMBON', { barcode: '7896066767581' }), b2 = await nuevo('BEL BOMBON', { barcode: '7896066767628' });
    const s2 = await prisma.sale.create({ data: { saleNumber: 2, userId: admin.id, sessionId: caja.id, subtotal: 400, total: 400, paymentMethodSummary: 'CASH' } as any });
    for (const p of [b1, b2]) await prisma.saleItem.create({ data: { saleId: s2.id, productId: p.id, productName: p.name, quantity: 1, unitPrice: 200, subtotal: 200, total: 200 } as any });
    const g = (await svc.duplicates()).groups.find((x: any) => x.products.some((p: any) => p.id === b1.id));
    assert.strictEqual(g.looksDistinct, true);
    assert.match(g.why, /sabores o presentaciones distintas/);
    const rad = (await svc.duplicates()).groups.find((x: any) => x.products.some((p: any) => p.id === rad1.id));
    assert.strictEqual(rad.looksDistinct, false, 'si uno solo se vende, es un repetido de verdad');
    await svc.markDistinct([b1.id, b2.id]);
  });
  await t('juntar: el repetido se oculta (no se borra), su código pasa al que queda y el stock se suma', async () => {
    const r = await svc.merge(rad1.id, [rad2.id], admin.id);
    mergeId = r.mergeId;
    const hidden = await prisma.product.findUnique({ where: { id: rad2.id } });
    assert.ok(hidden, 'el producto sigue existiendo');
    assert.strictEqual(hidden.isActive, false);
    assert.strictEqual(hidden.barcode, null);
    const extra = await prisma.productBarcode.findUnique({ where: { barcode: '7790070318312' } });
    assert.strictEqual(extra.productId, rad1.id, 'escanear el código del oculto encuentra al que queda');
    const kept = await prisma.product.findUnique({ where: { id: rad1.id } });
    assert.strictEqual(kept.stock, -216);
    assert.strictEqual(kept.barcode, '7798113300013', 'el código propio no cambia');
    const movs = await prisma.inventoryMovement.findMany({ where: { productId: { in: [rad1.id, rad2.id] } } });
    assert.strictEqual(movs.length, 2, 'queda el rastro en los movimientos');
    assert.deepStrictEqual(backups, ['SAFETY'], 'copia de seguridad antes de juntar');
    assert.strictEqual(r.barcodesMoved, 1);
  });
  await t('la segunda juntada del día no hace otra copia; los lotes de vencimiento pasan', async () => {
    await svc.merge(jam1.id, [jam2.id], admin.id);
    assert.strictEqual(backups.length, 1);
    assert.strictEqual((await prisma.productLot.findUnique({ where: { id: lote.id } })).productId, jam1.id);
    assert.strictEqual((await prisma.product.findUnique({ where: { id: jam1.id } })).stock, 8);
  });
  await t('después de juntar, el grupo ya no aparece como repetido', async () => {
    const r = await svc.duplicates();
    assert.ok(!r.groups.some((g: any) => g.products.some((p: any) => p.id === rad1.id)));
  });
  await t('separar: todo vuelve como estaba (activo, código, stock), y separar dos veces no rompe nada', async () => {
    const r = await svc.undo(mergeId, admin.id);
    assert.deepStrictEqual(r.restored, ['Rad energizante x 500']);
    const back = await prisma.product.findUnique({ where: { id: rad2.id } });
    assert.deepStrictEqual([back.isActive, back.barcode, back.stock], [true, '7790070318312', -91]);
    assert.strictEqual((await prisma.product.findUnique({ where: { id: rad1.id } })).stock, -125);
    assert.strictEqual(await prisma.productBarcode.findUnique({ where: { barcode: '7790070318312' } }), null);
    assert.strictEqual((await svc.undo(mergeId, admin.id)).already, true);
    const list = await svc.recent();
    assert.ok(!list.some((m: any) => m.mergeId === mergeId), 'la separada ya no figura');
  });
  await t('"son distintos": el grupo no se vuelve a ofrecer', async () => {
    await svc.markDistinct([rad1.id, rad2.id]);
    const r = await svc.duplicates();
    assert.ok(!r.groups.some((g: any) => g.products.some((p: any) => p.id === rad1.id)));
  });
  await t('no junta productos de una promo activa, de un kit ni variantes; ni en uno oculto', async () => {
    const a = await nuevo('ALFAJOR TRIPLE'), b = await nuevo('ALFAJOR TRIPLE');
    const promo = await prisma.promotion.create({ data: { name: 'Promo alfajor', type: 'NX_M', nValue: 2, mValue: 1 } });
    await prisma.promotionProduct.create({ data: { promotionId: promo.id, productId: b.id } });
    await assert.rejects(svc.merge(a.id, [b.id], admin.id), /promo "Promo alfajor"/);
    const k1 = await nuevo('VASO'), k2 = await nuevo('VASO');
    const kit = await nuevo('COMBO VASOS');
    await prisma.productKitItem.create({ data: { parentProductId: kit.id, childProductId: k2.id } });
    await assert.rejects(svc.merge(k1.id, [k2.id], admin.id), /combo o kit/);
    await assert.rejects(svc.merge(rad2.id, [rad1.id], admin.id).then(() => svc.merge(rad2.id, [rad1.id], admin.id)), /oculto|no encontr/i);
  });
  await t('el que queda tiene que estar a la venta; ids que no existen no se tocan', async () => {
    await assert.rejects(svc.merge('no-existe', [rad1.id], admin.id), /No encontré/);
    await assert.rejects(svc.merge(rad1.id, [], admin.id), /cuál queda/);
  });

  await prisma.$disconnect();
  console.log(`\n${ok} bien, ${fallas} mal`);
  fs.rmSync(DIR, { recursive: true, force: true });
  process.exit(fallas ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
