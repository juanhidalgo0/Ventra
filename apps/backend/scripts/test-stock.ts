/**
 * Pruebas de stock y caja con los servicios reales (ventas, anulaciones, kits, lotes, consumo de
 * empleados, ajustes, ficha del producto, compras y cierre) sobre una base SQLite temporal.
 * No se conecta a nada: la nube, GoDelivery, los avisos y la facturación están reemplazados por
 * piezas mudas. Correr antes de publicar cada versión.
 *
 *   npm run test:stock
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ventra-stock-'));
const DB = path.join(DIR, 'test.db').replace(/\\/g, '/');
process.env.DATABASE_URL = `file:${DB}`;
// Por las dudas: nada de nube aunque algo intente llamarla
process.env.VENTRA_SUBSCRIPTION_EXEMPT = 'true';
process.env.VENTRA_FUNCTIONS_URL = 'http://127.0.0.1:9';

execSync('npx prisma db push --skip-generate', { cwd: path.resolve(__dirname, '..'), env: process.env, stdio: 'ignore' });

/* eslint-disable @typescript-eslint/no-var-requires */
const { PrismaService } = require('../src/database/prisma.service');
const { SalesService } = require('../src/modules/sales/sales.service');
const { ProductsService } = require('../src/modules/products/products.service');
const { PurchasesService } = require('../src/modules/purchases/purchases.service');
const { CashRegisterService } = require('../src/modules/cash-register/cash-register.service');

/** Pieza muda: cualquier método existe y no hace nada */
const mute = (): any => new Proxy({}, { get: (_t, k) => (k === 'then' ? undefined : () => Promise.resolve(undefined)) });

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

async function main() {
  const prisma = new PrismaService();
  await prisma.onModuleInit();
  // Como una PC vinculada (numeración de ventas): evita ruido de tabla faltante
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT)`);
  const events = mute();
  const firebase = mute();
  const notify = mute();
  const cash = new CashRegisterService(prisma, events, mute(), notify);
  const sales = new SalesService(prisma, events, firebase, notify, cash, mute());
  const products = new ProductsService(prisma, events, firebase, mute());
  const purchases = new PurchasesService(prisma, firebase);

  const crear = (dto: any, userId: string) => sales.create(userId, dto);
  const admin = await prisma.user.create({ data: { username: 'ADMIN', passwordHash: 'x', fullName: 'Dueño', role: 'ADMIN' } });
  const cajero = await prisma.user.create({ data: { username: 'MICA', passwordHash: 'x', fullName: 'Mica', role: 'CASHIER' } });
  const session = await cash.open(cajero.id, { terminalName: 'Caja 1', openingAmount: 0 });
  const supplier = await prisma.supplier.create({ data: { name: 'Proveedor' } });

  const nuevo = (name: string, stock: number, extra: any = {}) =>
    prisma.product.create({ data: { name, salePrice: 1000, costPrice: 500, stock, ...extra } });
  const stockDe = async (id: string) => (await prisma.product.findUnique({ where: { id } }))!.stock;
  const vender = (items: any[], extra: any = {}) =>
    crear({ sessionId: session.id, items, payments: [{ method: 'CASH', amount: items.reduce((s, i) => s + (i.price ?? 1000) * i.quantity, 0) }], ...extra }, cajero.id);

  await t('una venta descuenta el stock y deja el movimiento correcto', async () => {
    const p = await nuevo('COCA', 10);
    await vender([{ productId: p.id, quantity: 3 }]);
    assert.strictEqual(await stockDe(p.id), 7);
    const m = await prisma.inventoryMovement.findFirst({ where: { productId: p.id } });
    assert.deepStrictEqual([m.stockBefore, m.stockAfter, m.quantity], [10, 7, -3]);
  });

  await t('el mismo producto dos veces en una venta: stock y movimientos encadenados', async () => {
    const p = await nuevo('ALFAJOR', 10);
    await vender([{ productId: p.id, quantity: 2 }, { productId: p.id, quantity: 3 }]);
    assert.strictEqual(await stockDe(p.id), 5);
    const ms = await prisma.inventoryMovement.findMany({ where: { productId: p.id }, orderBy: { createdAt: 'asc' } });
    assert.deepStrictEqual(ms.map((m: any) => [m.stockBefore, m.stockAfter]).sort((a: number[], b: number[]) => b[0] - a[0]), [[10, 8], [8, 5]]);
  });

  await t('anular una venta devuelve el stock', async () => {
    const p = await nuevo('AGUA', 10);
    const s = await vender([{ productId: p.id, quantity: 4 }]);
    await sales.cancel(s.id, admin.id);
    assert.strictEqual(await stockDe(p.id), 10);
  });

  await t('kit: la venta descuenta los componentes y la anulación los devuelve (no al kit)', async () => {
    const a = await nuevo('FERNET', 10);
    const b = await nuevo('COCA 2L', 10);
    const kit = await nuevo('COMBO FERNET', 0, { isKit: true });
    await prisma.productKitItem.createMany({ data: [{ parentProductId: kit.id, childProductId: a.id, quantity: 1 }, { parentProductId: kit.id, childProductId: b.id, quantity: 2 }] });
    const s = await vender([{ productId: kit.id, quantity: 2 }]);
    assert.deepStrictEqual([await stockDe(a.id), await stockDe(b.id), await stockDe(kit.id)], [8, 6, 0]);
    await sales.cancel(s.id, admin.id);
    assert.deepStrictEqual([await stockDe(a.id), await stockDe(b.id), await stockDe(kit.id)], [10, 10, 0]);
  });

  await t('stock ilimitado: ni la venta ni la anulación lo tocan', async () => {
    const p = await nuevo('CARGA SUBE', 0, { unlimitedStock: true });
    const s = await vender([{ productId: p.id, quantity: 5 }]);
    await sales.cancel(s.id, admin.id);
    assert.strictEqual(await stockDe(p.id), 0);
    assert.strictEqual(await prisma.inventoryMovement.count({ where: { productId: p.id } }), 0);
  });

  await t('devolución (cantidad negativa) suma al stock', async () => {
    const p = await nuevo('GALLETITAS', 5);
    await crear({ sessionId: session.id, items: [{ productId: p.id, quantity: -2, price: 1000 }], payments: [{ method: 'CASH', amount: -2000 }] }, cajero.id);
    assert.strictEqual(await stockDe(p.id), 7);
  });

  await t('una cantidad inválida se rechaza sin tocar el stock', async () => {
    const p = await nuevo('CHICLES', 5);
    await assert.rejects(() => vender([{ productId: p.id, quantity: NaN, price: 1000 }]));
    assert.strictEqual(await stockDe(p.id), 5);
  });

  await t('lotes: la venta saca del que vence primero y la anulación lo devuelve', async () => {
    const p = await nuevo('YOGUR', 10, { trackExpiry: true });
    const pronto = await prisma.productLot.create({ data: { productId: p.id, expiresAt: new Date('2026-10-10'), quantity: 4 } });
    const tarde = await prisma.productLot.create({ data: { productId: p.id, expiresAt: new Date('2026-11-10'), quantity: 6 } });
    const s = await vender([{ productId: p.id, quantity: 5 }]);
    const [a1, b1] = [await prisma.productLot.findUnique({ where: { id: pronto.id } }), await prisma.productLot.findUnique({ where: { id: tarde.id } })];
    assert.deepStrictEqual([a1.quantity, a1.status, b1.quantity], [0, 'SOLD', 5]);
    await sales.cancel(s.id, admin.id);
    const lotes = await prisma.productLot.findMany({ where: { productId: p.id, status: 'ACTIVE' } });
    assert.strictEqual(lotes.reduce((n: number, l: any) => n + l.quantity, 0), 10);
    assert.strictEqual(await stockDe(p.id), 10);
  });

  await t('consumo de empleados: apagado se rechaza', async () => {
    const p = await nuevo('CAFE', 10);
    await assert.rejects(() => crear({ sessionId: session.id, employeeConsumption: true, payments: [], items: [{ productId: p.id, quantity: 1 }] }, cajero.id));
    assert.strictEqual(await stockDe(p.id), 10);
  });

  let consumoId = '';
  await t('consumo de empleados: descuenta stock, queda a $0 y aparte de las ventas', async () => {
    await prisma.$executeRawUnsafe(`INSERT OR REPLACE INTO store_settings (id, value) VALUES ('employee_consumption', '"1"')`).catch(async () => {
      await prisma.$executeRawUnsafe(`INSERT OR REPLACE INTO store_settings (id, value) VALUES ('employee_consumption', '1')`);
    });
    const p = await nuevo('MEDIALUNA', 10);
    const s = await crear({ sessionId: session.id, employeeConsumption: true, payments: [], items: [{ productId: p.id, quantity: 2 }] }, cajero.id);
    consumoId = s.id;
    assert.deepStrictEqual([s.status, s.total, await stockDe(p.id)], ['INTERNAL', 0, 8]);
    const consumo = await cash.employeeConsumptionOf(session.id);
    assert.deepStrictEqual(consumo.map((e: any) => [e.name, e.units]), [['Mica', 2]]);
  });

  await t('anular un consumo devuelve el stock', async () => {
    const s = await prisma.sale.findUnique({ where: { id: consumoId }, include: { items: true } });
    await sales.cancel(consumoId, admin.id);
    assert.strictEqual(await stockDe(s.items[0].productId), 10);
  });

  await t('ajuste manual: entra y sale sobre el stock actual; cantidad 0 se rechaza', async () => {
    const p = await nuevo('ARROZ', 10);
    await products.addMovement(p.id, { type: 'ENTRY', quantity: 5, reason: 'Compra', userId: admin.id });
    await products.addMovement(p.id, { type: 'EXIT', quantity: 3, reason: 'Rotura', userId: admin.id });
    assert.strictEqual(await stockDe(p.id), 12);
    await assert.rejects(() => products.addMovement(p.id, { type: 'EXIT', quantity: 0, reason: 'x', userId: admin.id }));
  });

  await t('guardar la ficha no borra una venta hecha mientras estaba abierta', async () => {
    const p = await nuevo('ACEITE', 10);
    const visto = 10; // stock que mostraba la ficha al abrirse
    await vender([{ productId: p.id, quantity: 2 }]); // otra caja vende mientras tanto
    await products.update(p.id, { salePrice: 1200, stock: visto, stockBase: visto }, admin.id); // solo cambió el precio
    assert.strictEqual(await stockDe(p.id), 8);
    await products.update(p.id, { stock: 13, stockBase: 8 }, admin.id); // carga +5 a mano
    assert.strictEqual(await stockDe(p.id), 13);
  });

  let compraId = '';
  await t('compra: suma el stock (por paquete) y borrarla lo saca exacto', async () => {
    const p = await nuevo('CERVEZA', 2, { presentationType: 'PACK', unitsPerPack: 6 });
    const c = await purchases.create({ supplierId: supplier.id, userId: admin.id, paymentStatus: 'PAID', items: [{ productId: p.id, quantity: 2, cost: 600, buyFormat: 'PACK' }] });
    compraId = c.id;
    assert.strictEqual(await stockDe(p.id), 14);
    await prisma.product.update({ where: { id: p.id }, data: { unitsPerPack: 12 } }); // cambian las unidades por paquete
    await purchases.deleteOne(c.id);
    assert.strictEqual(await stockDe(p.id), 2);
  });

  await t('compra pendiente: borrarla no resta; confirmarla dos veces no suma dos veces', async () => {
    const p = await nuevo('HARINA', 3);
    const pend = await prisma.purchase.create({ data: { supplierId: supplier.id, userId: admin.id, total: 0, status: 'PENDING', paymentStatus: 'OWED' } });
    await purchases.confirmPending(pend.id, { supplierId: supplier.id, userId: admin.id, paymentStatus: 'PAID', items: [{ productId: p.id, quantity: 4, cost: 100 }] });
    assert.strictEqual(await stockDe(p.id), 7);
    await assert.rejects(() => purchases.confirmPending(pend.id, { supplierId: supplier.id, userId: admin.id, paymentStatus: 'PAID', items: [{ productId: p.id, quantity: 4, cost: 100 }] }));
    assert.strictEqual(await stockDe(p.id), 7);
    const otra = await prisma.purchase.create({ data: { supplierId: supplier.id, userId: admin.id, total: 0, status: 'PENDING', paymentStatus: 'OWED', items: { create: [{ productId: p.id, productName: 'HARINA', quantity: 9, cost: 1, total: 9 }] } } });
    await purchases.deleteOne(otra.id);
    assert.strictEqual(await stockDe(p.id), 7);
  });

  await t('"Restaurar compra" no vuelve a sumar una compra que ya está contada', async () => {
    const p = await nuevo('FIDEOS', 0);
    const c = await purchases.create({ supplierId: supplier.id, userId: admin.id, paymentStatus: 'PAID', items: [{ productId: p.id, quantity: 5, cost: 100 }] });
    await purchases.restorePurchase(c.id);
    assert.strictEqual(await stockDe(p.id), 5);
    void compraId;
  });

  await t('cierre de caja: el consumo no suma a la plata y queda en el resumen', async () => {
    const ses = await cash.open(admin.id, { terminalName: 'Caja 2', openingAmount: 0 });
    const p = await nuevo('TORTA', 10);
    await crear({ sessionId: ses.id, items: [{ productId: p.id, quantity: 1 }], payments: [{ method: 'CASH', amount: 1000 }] }, admin.id);
    await crear({ sessionId: ses.id, employeeConsumption: true, payments: [], items: [{ productId: p.id, quantity: 2 }] }, cajero.id);
    const closed = await cash.close(ses.id, admin.id, { closingAmountCounted: 1000 });
    const sum = JSON.parse(closed.closingSummary || '{}');
    assert.strictEqual(sum.totalRevenue, 1000);
    assert.deepStrictEqual((sum.employeeConsumption || []).map((e: any) => [e.name, e.units]), [['Mica', 2]]);
    assert.strictEqual(await stockDe(p.id), 7);
  });

  await prisma.$disconnect();
  fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${ok} bien, ${fallas} con falla`);
  process.exit(fallas ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
