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
const { DeliveryRunsService } = require('../src/modules/preorders/delivery-runs.service');
const { PreOrdersService } = require('../src/modules/preorders/preorders.service');
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
  const runs = new DeliveryRunsService(prisma, sales, mute());

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

  await t('anular dos veces a la vez: el stock vuelve una sola vez', async () => {
    const p = await nuevo('MANAOS', 10);
    const s = await vender([{ productId: p.id, quantity: 4 }]);
    const r = await Promise.allSettled([sales.cancel(s.id, admin.id), sales.cancel(s.id, admin.id)]);
    assert.strictEqual(r.filter((x) => x.status === 'fulfilled').length, 1);
    assert.strictEqual(await stockDe(p.id), 10);
    assert.strictEqual(await prisma.inventoryMovement.count({ where: { productId: p.id, type: 'RETURN' } }), 1);
  });

  await t('venta sin conexión mandada dos veces (y a la vez): se registra una sola', async () => {
    const p = await nuevo('PEPSI', 10);
    const dto = () => ({ clientSaleId: 'off-test-0001', sessionId: session.id, items: [{ productId: p.id, quantity: 2 }], payments: [{ method: 'CASH', amount: 2000 }] });
    const r = await Promise.allSettled([crear(dto(), cajero.id), crear(dto(), cajero.id)]);
    assert.ok(r.every((x) => x.status === 'fulfilled'), 'los dos envíos responden bien');
    const again = await crear(dto(), cajero.id);
    assert.strictEqual(again.id, 'off-test-0001');
    assert.strictEqual(await prisma.sale.count({ where: { id: 'off-test-0001' } }), 1);
    assert.strictEqual(await stockDe(p.id), 8);
  });

  await t('pedido de preventa cobrado en la caja: queda como venta', async () => {
    const p = await nuevo('FERNET', 10);
    const order = await (prisma as any).preOrder.create({ data: { id: 'po-test-0001', orderNumber: 1, userId: cajero.id, total: 2000, items: { create: [{ productId: p.id, productName: 'FERNET', quantity: 2, unitPrice: 1000, total: 2000 }] } } });
    assert.strictEqual(await stockDe(p.id), 10, 'el pedido no mueve stock');
    const s = await crear({ sessionId: session.id, orderId: order.id, items: [{ productId: p.id, quantity: 2, price: 1000 }], payments: [{ method: 'CASH', amount: 2000 }] }, cajero.id);
    const after = await (prisma as any).preOrder.findUnique({ where: { id: order.id } });
    assert.strictEqual(after.status, 'BILLED');
    assert.strictEqual(after.saleId, s.id);
    assert.strictEqual(await stockDe(p.id), 8);
  });

  await t('reparto: entran solo pedidos pendientes, en orden, y deshacerlo los libera', async () => {
    const p = await nuevo('SPRITE', 10);
    const mk = (id: string, n: number, status = 'PENDING') => (prisma as any).preOrder.create({ data: { id, orderNumber: 100 + n, userId: cajero.id, status, total: 1000, items: { create: [{ productId: p.id, productName: 'SPRITE', quantity: 1, unitPrice: 1000, total: 1000 }] } } });
    await mk('po-run-a', 1); await mk('po-run-b', 2); await mk('po-run-c', 3, 'BILLED');
    const run = await runs.create({ driverName: 'Chofer', orderIds: ['po-run-b', 'po-run-a', 'po-run-c'] });
    assert.deepStrictEqual(run.orders.map((o: any) => o.id), ['po-run-b', 'po-run-a'], 'el cobrado no entra; el orden se respeta');
    const again = await runs.setStops(run.id, ['po-run-a']);
    assert.deepStrictEqual(again.orders.map((o: any) => o.id), ['po-run-a']);
    assert.strictEqual((await (prisma as any).preOrder.findUnique({ where: { id: 'po-run-b' } })).runId, null);
    await assert.rejects(() => runs.update(run.id, { status: 'EN_REPARTO' }), 'la salida es con "Salió a reparto"');
    const failed = await runs.dispatch(run.id, {}, cajero.id);
    assert.strictEqual(failed.errors.length, 1, 'un pedido sin cliente no puede salir a cuenta');
    assert.strictEqual(failed.run.status, 'ARMANDO');
    await runs.remove(run.id);
    assert.strictEqual((await (prisma as any).preOrder.findUnique({ where: { id: 'po-run-a' } })).runId, null);
    assert.strictEqual(await stockDe(p.id), 10, 'armar o deshacer no mueve stock');
  });

  await t('reparto: sale con venta a cuenta y el número del pedido; la rendición cobra, devuelve y reprograma', async () => {
    const p = await nuevo('QUILMES', 100);
    const cli = await prisma.client.create({ data: { name: 'Almacén Rendición' } });
    const saldo = async () => (await prisma.client.findUnique({ where: { id: cli.id } }))!.balance;
    const mk = (id: string, n: number, q: number) => (prisma as any).preOrder.create({ data: { id, orderNumber: 900200 + n, clientId: cli.id, userId: cajero.id, total: q * 100, items: { create: [{ id: id + '-i', productId: p.id, productName: 'QUILMES', quantity: q, packSize: 6, unitPrice: 100, total: q * 100 }] } } });
    await mk('po-set-a', 1, 12); await mk('po-set-b', 2, 12); await mk('po-set-c', 3, 6);
    const run = await runs.create({ orderIds: ['po-set-a', 'po-set-b', 'po-set-c'] });
    await assert.rejects(() => runs.saveDelivery(run.id, 'po-set-a', { status: 'DELIVERED', cash: 1200 }), 'antes de salir no se registran entregas');

    const out = await runs.dispatch(run.id, {}, cajero.id);
    assert.deepStrictEqual(out.errors, []);
    assert.strictEqual(out.created, 3);
    assert.strictEqual(out.run.status, 'EN_REPARTO');
    assert.strictEqual(await stockDe(p.id), 100 - 30, 'el stock sale con el camión');
    assert.strictEqual(await saldo(), 3000, 'las ventas quedan a cuenta del cliente');
    const saleA = await prisma.sale.findFirst({ where: { id: 'run-po-set-a-900201' } });
    assert.strictEqual(saleA!.saleNumber, 900201, 'la venta lleva el número del pedido');
    assert.strictEqual(saleA!.sessionId, 'reparto-cash', 'va a la cuenta fija del reparto, no a una caja');
    const abiertas = await prisma.cashRegisterSession.count({ where: { status: 'OPEN' } });
    await assert.rejects(() => runs.dispatch(run.id, {}, cajero.id), 'no sale dos veces');

    await runs.saveDelivery(run.id, 'po-set-a', { status: 'DELIVERED', cash: 1200 });
    await assert.rejects(() => runs.saveDelivery(run.id, 'po-set-b', { status: 'PARTIAL', items: { 'po-set-b-i': 6 }, cash: 700 }), 'no se puede cobrar más de lo entregado');
    await runs.saveDelivery(run.id, 'po-set-b', { status: 'PARTIAL', items: { 'po-set-b-i': 6 }, transfer: 400, reason: 'Rechazó un bulto' });
    await runs.saveDelivery(run.id, 'po-set-c', { status: 'NOT_DELIVERED', reason: 'Cerrado' });

    const r = await runs.settle(run.id, { cashReceived: 1200 }, cajero.id);
    assert.deepStrictEqual(r.errors, []);
    assert.strictEqual(r.expectedCash, 1200);
    assert.strictEqual(await prisma.cashRegisterSession.count({ where: { status: 'OPEN' } }), abiertas, 'rendir no abre ninguna caja');
    assert.strictEqual((await prisma.cashRegisterSession.findUnique({ where: { id: 'reparto-cash' } }))!.status, 'REPARTO');
    assert.strictEqual(await stockDe(p.id), 100 - 12 - 6, 'lo rechazado y lo no entregado vuelven');
    assert.strictEqual(await saldo(), 200, 'debe solo lo que recibió y no pagó');
    const cobroB = await prisma.sale.findUnique({ where: { id: 'cobro-po-set-b-900202' }, include: { payments: true } });
    assert.deepStrictEqual(cobroB!.payments.map((x: any) => x.method), ['TRANSFERENCIA']);
    assert.ok(await prisma.sale.findUnique({ where: { id: 'rech-po-set-b-900202' } }), 'el rechazo queda como devolución');
    const c = await (prisma as any).preOrder.findUnique({ where: { id: 'po-set-c' } });
    assert.strictEqual(c.status, 'PENDING'); assert.strictEqual(c.runId, null); assert.strictEqual(c.saleId, null);
    assert.notStrictEqual(c.orderNumber, 900203, 'vuelve con número nuevo: el suyo ya es de la venta');
    assert.strictEqual((await (prisma as any).deliveryRun.findUnique({ where: { id: run.id } })).status, 'CERRADO');
    await assert.rejects(() => runs.settle(run.id, {}, cajero.id), 'no se rinde dos veces');

    // Varias de una vez: entregadas completas, todas a cuenta
    await mk('po-many-a', 4, 6); await mk('po-many-b', 5, 6);
    const run2 = await runs.create({ orderIds: ['po-many-a', 'po-many-b'] });
    await runs.dispatch(run2.id, {}, cajero.id);
    const after = await runs.saveManyDelivered(run2.id, ['po-many-a', 'po-many-b'], 'debt');
    assert.ok(after.orders.every((o: any) => o.deliveryStatus === 'DELIVERED' && o.paidCash === 0 && o.paidTransfer === 0));
    await runs.settle(run2.id, {}, cajero.id);
    assert.strictEqual(await saldo(), 200 + 1200, 'las dos quedan a cuenta');
  });

  await t('pedidos y ventas comparten numeración: el pedido nuevo nunca pisa una venta', async () => {
    const p = await nuevo('FANTA', 10);
    const s = await vender([{ productId: p.id, quantity: 1 }]);
    const preorders = new PreOrdersService(prisma);
    const o = await preorders.save('po-num-0001', { items: [{ productId: p.id, productName: 'FANTA', quantity: 1, unitPrice: 100 }] }, cajero.id);
    assert.ok(o.orderNumber > s.saleNumber, 'el pedido sigue la numeración de las ventas');
    const s2 = await vender([{ productId: p.id, quantity: 1 }]);
    assert.ok(s2.saleNumber > o.orderNumber, 'una venta de mostrador no usa el número de un pedido');
  });

  await t('anular una venta fiada devuelve la deuda; con saldo a favor, lo saca', async () => {
    const p = await nuevo('YERBA', 10);
    const cli = await prisma.client.create({ data: { name: 'Doña Rosa' } });
    const fiada = await crear({ sessionId: session.id, clientId: cli.id, items: [{ productId: p.id, quantity: 1 }], payments: [{ method: 'DEBT', amount: 1000 }] }, cajero.id);
    assert.strictEqual((await prisma.client.findUnique({ where: { id: cli.id } }))!.balance, 1000);
    await sales.cancel(fiada.id, admin.id);
    assert.strictEqual((await prisma.client.findUnique({ where: { id: cli.id } }))!.balance, 0);
    const devolucion = await crear({ sessionId: session.id, clientId: cli.id, items: [{ productId: p.id, quantity: -1, price: 1000 }], payments: [{ method: 'DEBT', amount: -1000 }] }, cajero.id);
    assert.strictEqual((await prisma.client.findUnique({ where: { id: cli.id } }))!.balance, -1000);
    await sales.cancel(devolucion.id, admin.id);
    assert.strictEqual((await prisma.client.findUnique({ where: { id: cli.id } }))!.balance, 0);
    assert.strictEqual(await stockDe(p.id), 10);
  });

  await t('un precio, descuento o pago que no es número se rechaza sin tocar el stock', async () => {
    const p = await nuevo('TURRON', 5);
    await assert.rejects(() => crear({ sessionId: session.id, items: [{ productId: p.id, quantity: 1, price: 'abc' }], payments: [{ method: 'CASH', amount: 1000 }] }, cajero.id));
    await assert.rejects(() => crear({ sessionId: session.id, items: [{ productId: p.id, quantity: 1, discount: 'x' }], payments: [{ method: 'CASH', amount: 1000 }] }, cajero.id));
    await assert.rejects(() => crear({ sessionId: session.id, items: [{ productId: p.id, quantity: 1 }], payments: [{ method: 'CASH', amount: 'mil' }] }, cajero.id));
    assert.strictEqual(await stockDe(p.id), 5);
    // Números que llegan como texto siguen andando como antes
    await crear({ sessionId: session.id, items: [{ productId: p.id, quantity: '1', price: '1000' }], payments: [{ method: 'CASH', amount: '1000' }] }, cajero.id);
    assert.strictEqual(await stockDe(p.id), 4);
  });

  await t('movimientos de caja: el cajero agrega en su caja abierta; en una cerrada, solo el administrador', async () => {
    await cash.addCashMovement(session.id, cajero.id, { type: 'EXPENSE', amount: 100, description: 'Hielo' }, 'CASHIER');
    const cerrada = (await prisma.cashRegisterSession.findFirst({ where: { terminalName: 'Caja 2', status: 'CLOSED' } }))!;
    await assert.rejects(() => cash.addCashMovement(cerrada.id, cajero.id, { type: 'EXPENSE', amount: 100, description: 'Tarde' }, 'CASHIER'));
    await cash.addCashMovement(cerrada.id, admin.id, { type: 'EXPENSE', amount: 100, description: 'Corrección' }, 'ADMIN');
    await assert.rejects(() => cash.addCashMovement(session.id, cajero.id, { type: 'EXPENSE', amount: NaN }, 'CASHIER'));
  });

  await t('chofer usuario: el reparto queda a su nombre, ve los suyos y no rinde su camión', async () => {
    const chofer = await prisma.user.create({ data: { username: 'TOTO', passwordHash: 'x', fullName: 'Toto', role: 'CASHIER', workRole: 'CHOFER' } as any });
    const drivers = await runs.drivers();
    assert.strictEqual(drivers[0].id, chofer.id, 'los choferes primero');
    const cli = await prisma.client.create({ data: { name: 'Kiosco Toto', locality: 'Bavio' } });
    const p = await nuevo('Agua chofer', 50);
    await (prisma as any).preOrder.create({ data: { id: 'po-drv-a', orderNumber: 990001, clientId: cli.id, userId: cajero.id, total: 1000, items: { create: [{ productId: p.id, productName: p.name, quantity: 1, unitPrice: 1000, total: 1000 }] } } });
    const run = await runs.create({ driverUserId: chofer.id, orderIds: ['po-drv-a'] });
    assert.strictEqual(run.driverName, 'Toto', 'toma el nombre del usuario');
    const mios = await runs.list('ALL', chofer.id);
    assert.deepStrictEqual(mios.map((r: any) => r.id), [run.id]);
    // Escribir otro nombre a mano lo desata del usuario
    const editado: any = await runs.update(run.id, { driverName: 'Otro' });
    assert.strictEqual(editado.driverUserId, null);
    await runs.update(run.id, { driverUserId: chofer.id });
    await runs.dispatch(run.id, {}, cajero.id);
    await assert.rejects(() => runs.settle(run.id, {}, chofer.id), /encargado/);
    const r = await runs.settle(run.id, {}, admin.id);
    assert.strictEqual(r.run.status, 'CERRADO');
  });

  await t('deuda anterior: se cobra en la parada, entra a la rendición y baja el saldo', async () => {
    const cli = await prisma.client.create({ data: { name: 'Debe de antes', locality: 'Bavio', balance: 5000 } });
    const p = await nuevo('Galletitas deuda', 50);
    await (prisma as any).preOrder.create({ data: { id: 'po-prev-a', orderNumber: 990101, clientId: cli.id, userId: cajero.id, total: 1000, items: { create: [{ productId: p.id, productName: p.name, quantity: 1, unitPrice: 1000, total: 1000 }] } } });
    const run = await runs.create({ orderIds: ['po-prev-a'] });
    assert.strictEqual(run.orders[0].prevDebt, 5000, 'antes de salir debe lo de antes');
    await runs.dispatch(run.id, {}, cajero.id);
    const salio = await runs.findOne(run.id);
    assert.strictEqual(salio.orders[0].prevDebt, 5000, 'sin contar lo que se le está entregando');
    await assert.rejects(() => runs.saveDelivery(run.id, 'po-prev-a', { status: 'DELIVERED', cash: 1000, prevCash: 6000 }), /debía/);
    await runs.saveDelivery(run.id, 'po-prev-a', { status: 'DELIVERED', cash: 1000, prevCash: 2000, prevTransfer: 1000 });
    // Marcar de nuevo sin decir nada de la deuda vieja no la borra
    await runs.saveDelivery(run.id, 'po-prev-a', { status: 'DELIVERED', cash: 1000 });
    const r = await runs.settle(run.id, { cashReceived: 3000 }, admin.id);
    assert.strictEqual(r.expectedCash, 3000);
    assert.strictEqual(r.run.expectedCash, 3000);
    assert.strictEqual((await prisma.client.findUnique({ where: { id: cli.id } }))!.balance, 2000);
    await assert.rejects(() => runs.settle(run.id, {}, admin.id));
  });

  await t('stock comprometido y faltantes para cargar el camión', async () => {
    const pre = new PreOrdersService(prisma);
    const cli = await prisma.client.create({ data: { name: 'Pide mucho', locality: 'Verónica' } });
    const p = await nuevo('Lavandina faltante', 5);
    await (prisma as any).preOrder.create({ data: { id: 'po-short-a', orderNumber: 990201, clientId: cli.id, userId: cajero.id, total: 12000, items: { create: [{ productId: p.id, productName: p.name, quantity: 12, unitPrice: 1000, total: 12000 }] } } });
    assert.strictEqual((await pre.committed())[p.id], 12);
    const run = await runs.create({ orderIds: ['po-short-a'] });
    const falta = run.shortages.find((x: any) => x.productId === p.id);
    assert.ok(falta, 'avisa el faltante');
    assert.strictEqual(falta.needed, 12);
    assert.strictEqual(falta.stock, 5);
    await assert.rejects(() => runs.dispatch(run.id, {}, cajero.id), /No alcanza el stock/, 'sin confirmar no sale');
    const out = await runs.dispatch(run.id, { allowShortages: true }, cajero.id);
    assert.deepStrictEqual(out.errors, []);
    assert.strictEqual(await stockDe(p.id), -7, 'con "Salir igual" sale y el stock queda en negativo');
  });

  await t('último pedido de cada cliente: el más nuevo, sin los cancelados', async () => {
    const pre = new PreOrdersService(prisma);
    const cli = await prisma.client.create({ data: { name: 'Repite siempre', locality: 'Bavio' } });
    const p = await nuevo('Fideos repetir', 100);
    const item = (q: number) => ({ create: [{ productId: p.id, productName: p.name, quantity: q, packSize: 20, unitPrice: 600, total: q * 600 }] });
    await (prisma as any).preOrder.create({ data: { id: 'po-last-old', orderNumber: 990301, clientId: cli.id, userId: cajero.id, status: 'BILLED', total: 24000, createdAt: new Date(Date.now() - 7 * 86400000), items: item(40) } });
    await (prisma as any).preOrder.create({ data: { id: 'po-last-new', orderNumber: 990302, clientId: cli.id, userId: cajero.id, status: 'PENDING', total: 36000, createdAt: new Date(Date.now() - 86400000), items: item(60) } });
    await (prisma as any).preOrder.create({ data: { id: 'po-last-cancel', orderNumber: 990303, clientId: cli.id, userId: cajero.id, status: 'CANCELLED', total: 1, items: item(20) } });
    const last = (await pre.lastByClient())[cli.id];
    assert.strictEqual(last.id, 'po-last-new');
    assert.strictEqual(last.items[0].quantity, 60);
    assert.strictEqual(last.items[0].packSize, 20);
  });

  await t('gastos del reparto: salen de la caja y bajan lo que tiene que traer', async () => {
    const cli = await prisma.client.create({ data: { name: 'Con gastos', locality: 'Bavio' } });
    const p = await nuevo('Gaseosa gastos', 50);
    await (prisma as any).preOrder.create({ data: { id: 'po-gas-a', orderNumber: 990401, clientId: cli.id, userId: cajero.id, total: 1000, items: { create: [{ productId: p.id, productName: p.name, quantity: 1, unitPrice: 1000, total: 1000 }] } } });
    const run = await runs.create({ orderIds: ['po-gas-a'] });
    await runs.dispatch(run.id, {}, admin.id);
    await runs.saveDelivery(run.id, 'po-gas-a', { status: 'DELIVERED', cash: 1000 });
    const r = await runs.settle(run.id, { cashReceived: 700, expenses: [{ concept: 'Nafta', amount: 250 }, { concept: 'Peaje', amount: 50 }, { concept: 'Nada', amount: 0 }] }, admin.id);
    assert.strictEqual(r.run.status, 'CERRADO');
    assert.strictEqual(r.run.expectedCash, 700, 'lo cobrado menos los gastos');
    assert.strictEqual(r.run.expensesTotal, 300);
    assert.strictEqual(JSON.parse(r.run.expenses).length, 2, 'los de $0 no cuentan');
    const movs = await prisma.cashMovement.findMany({ where: { description: { contains: `[gasto-${run.id}-` } } });
    assert.strictEqual(movs.length, 2);
    assert.ok(movs.every((m: any) => m.type === 'EXPENSE'));
    assert.strictEqual(movs.reduce((s: number, m: any) => s + m.amount, 0), 300);
  });

  await t('certificado propio: la clave se guarda cifrada y se abre para firmar', async () => {
    const forge = require('node-forge');
    const { FiscalService } = require('../src/modules/fiscal/fiscal.service');
    const { WsaaService } = require('../src/modules/fiscal/wsaa.service');
    const { WsfeService } = require('../src/modules/fiscal/wsfe.service');
    const llave = require('crypto').randomBytes(32);
    const vinculada: any = { fiscalKey: async () => llave, getDeviceCredentials: () => ({ deviceId: 'd', deviceSecret: 's' }) };
    const fiscal = new FiscalService(prisma, new WsaaService(prisma), new WsfeService(), mute(), vinculada);
    await fiscal.updateConfig({ cuit: '20000000001', razonSocial: 'Prueba Cifrado' });
    const pedido = await fiscal.createCertificateRequest();
    let fila: any = await prisma.fiscalConfig.findUnique({ where: { id: 'fiscal_config' } });
    assert.ok(String(fila.pendingKeyPem).startsWith('enc:v1:'), 'el pedido guarda la clave cifrada');
    // Lo que haría ARCA con el pedido
    const csr = forge.pki.certificationRequestFromPem(pedido.csr);
    const ca = forge.pki.rsa.generateKeyPair(1024);
    const cert = forge.pki.createCertificate();
    cert.publicKey = csr.publicKey; cert.serialNumber = '02';
    cert.validity.notBefore = new Date(); cert.validity.notAfter = new Date(Date.now() + 365 * 86400000);
    cert.setSubject(csr.subject.attributes); cert.setIssuer([{ name: 'commonName', value: 'Computadores Test' }]);
    cert.sign(ca.privateKey, forge.md.sha256.create());
    const cfg = await fiscal.installCertificate({ certPem: forge.pki.certificateToPem(cert) });
    assert.strictEqual(cfg.hasOwnCertificate, true);
    assert.ok(!('keyPem' in cfg), 'la clave no sale del servidor');
    fila = await prisma.fiscalConfig.findUnique({ where: { id: 'fiscal_config' } });
    assert.ok(String(fila.keyPem).startsWith('enc:v1:') && !String(fila.keyPem).includes('PRIVATE'), 'queda cifrada en la base (así viaja a la nube)');
    const transporte = await (fiscal as any).transportFor(fila);
    assert.strictEqual(transporte.kind, 'direct');
    // Otra caja sin la llave no la puede abrir
    const sinLlave: any = { fiscalKey: async () => null, getDeviceCredentials: () => ({ deviceId: 'x', deviceSecret: 'y' }) };
    const otra = new FiscalService(prisma, new WsaaService(prisma), new WsfeService(), mute(), sinLlave);
    await assert.rejects(() => (otra as any).transportFor(fila), /necesita conexión/);
    // Vinculada y sin poder pedir la llave: no se guarda una clave legible
    await assert.rejects(() => otra.createCertificateRequest(), /hace falta conexión/);
    // PC sin vincular: no sincroniza nada, la guarda tal cual
    const suelta: any = { fiscalKey: async () => null, getDeviceCredentials: () => null };
    const local = new FiscalService(prisma, new WsaaService(prisma), new WsfeService(), mute(), suelta);
    await local.createCertificateRequest();
    fila = await prisma.fiscalConfig.findUnique({ where: { id: 'fiscal_config' } });
    assert.ok(String(fila.pendingKeyPem).includes('PRIVATE KEY'));
    // Y apenas tiene la llave, la cifra
    await fiscal.getConfig();
    await new Promise((r) => setTimeout(r, 200));
    fila = await prisma.fiscalConfig.findUnique({ where: { id: 'fiscal_config' } });
    assert.ok(String(fila.pendingKeyPem).startsWith('enc:v1:') && String(fila.keyPem).startsWith('enc:v1:'));
    // Solo con su propio certificado: ni la autorización a Ventra ni un certificado de otra CUIT
    await assert.rejects(() => fiscal.updateConfig({ certSource: 'DELEGATED' }), /propio certificado/);
    await fiscal.updateConfig({ cuit: '20111111112' });
    await assert.rejects(() => fiscal.updateConfig({ enabled: true }), /es de la CUIT 20000000001/);
    fila = await prisma.fiscalConfig.findUnique({ where: { id: 'fiscal_config' } });
    await assert.rejects(() => (fiscal as any).transportFor(fila), /es de la CUIT 20000000001/);
    await fiscal.updateConfig({ cuit: '20000000001' });
    await prisma.fiscalConfig.update({ where: { id: 'fiscal_config' }, data: { certSource: 'DELEGATED' } });
    await assert.rejects(() => fiscal.updateConfig({ enabled: true }), /tu certificado de ARCA/);
  });

  await t('auditoría: pedido cobrado en el mostrador sale del reparto; el vendedor no pone precios', async () => {
    const pre = new PreOrdersService(prisma);
    const cli = await prisma.client.create({ data: { name: 'Mostrador y reparto', locality: 'Bavio' } });
    const p = await nuevo('Arroz auditoria', 100, { unitsPerPack: 10, packPrice: 9000 });
    // Precio inventado desde el celular: se toma el del catálogo (bulto 9000 → 900 la unidad)
    const o: any = await pre.save('po-aud-a', { clientId: cli.id, items: [{ productId: p.id, productName: p.name, quantity: 20, packSize: 10, unitPrice: 1 }] }, cajero.id, false);
    assert.strictEqual(o.items[0].unitPrice, 900);
    assert.strictEqual(o.total, 18000);
    // El dueño sí puede poner un precio especial
    const o2: any = await pre.save('po-aud-b', { clientId: cli.id, items: [{ productId: p.id, productName: p.name, quantity: 1, unitPrice: 500 }] }, admin.id, true);
    assert.strictEqual(o2.items[0].unitPrice, 500);
    const run = await runs.create({ orderIds: ['po-aud-a', 'po-aud-b'] });
    // Cobrado en la caja mientras el reparto se arma
    await crear({ sessionId: session.id, clientId: cli.id, orderId: 'po-aud-a', items: [{ productId: p.id, quantity: 20, price: 900 }], payments: [{ method: 'CASH', amount: 18000 }] }, cajero.id);
    const after = await runs.findOne(run.id);
    assert.deepStrictEqual(after.orders.map((x: any) => x.id), ['po-aud-b'], 'el cobrado en la caja ya no está en el reparto');
  });

  await t('preventa: vale el precio del momento en que se armó el pedido', async () => {
    const pre = new PreOrdersService(prisma);
    const cli = await prisma.client.create({ data: { name: 'Precio viejo', locality: 'Verónica' } });
    const p = await nuevo('Fideos precio', 100, { salePrice: 100, unitsPerPack: 10, packPrice: 900 });
    const antes = new Date(Date.now() - 60_000).toISOString();
    await new Promise((r) => setTimeout(r, 20));
    // Aumento mientras el vendedor estaba sin señal
    await prisma.product.update({ where: { id: p.id }, data: { salePrice: 120, packPrice: 1100 } });
    const sin: any = await pre.save('po-precio-a', { takenAt: antes, clientId: cli.id, items: [
      { productId: p.id, productName: p.name, quantity: 10, packSize: 10, unitPrice: 90 },
      { productId: p.id, productName: p.name, quantity: 2, unitPrice: 100 },
    ] }, cajero.id, false);
    assert.deepStrictEqual(sin.items.map((i: any) => i.unitPrice).sort(), [100, 90], 'entra con los precios de antes del aumento');
    // Un precio que el producto nunca tuvo no pasa: va el actual
    const inventado: any = await pre.save('po-precio-b', { takenAt: antes, clientId: cli.id, items: [{ productId: p.id, productName: p.name, quantity: 1, unitPrice: 50 }] }, cajero.id, false);
    assert.strictEqual(inventado.items[0].unitPrice, 120);
    // Armado después del aumento: precio nuevo
    const nuevoPedido: any = await pre.save('po-precio-c', { takenAt: new Date().toISOString(), clientId: cli.id, items: [{ productId: p.id, productName: p.name, quantity: 1, unitPrice: 100 }] }, cajero.id, false);
    assert.strictEqual(nuevoPedido.items[0].unitPrice, 120);
    // Editar un pedido no le cambia el precio a lo que ya tenía, aunque haya otro aumento
    await prisma.product.update({ where: { id: p.id }, data: { salePrice: 150 } });
    const editado: any = await pre.save('po-precio-c', { clientId: cli.id, items: [{ productId: p.id, productName: p.name, quantity: 3, unitPrice: 150 }] }, cajero.id, false);
    assert.strictEqual(editado.items[0].unitPrice, 120);
    assert.strictEqual(editado.total, 360);
  });

  await t('preventa: oferta por cantidad', async () => {
    const pre = new PreOrdersService(prisma);
    const p = await nuevo('Cerveza oferta', 500, { salePrice: 1000, unitsPerPack: 6, packPrice: 5400, wholesalePrice: 850, wholesaleMinQty: 60 });
    const poco: any = await pre.save('po-oferta-a', { items: [{ productId: p.id, productName: p.name, quantity: 12, packSize: 6, unitPrice: 900 }] }, cajero.id, false);
    assert.strictEqual(poco.items[0].unitPrice, 900, 'menos de 60 unidades: precio del bulto');
    const mucho: any = await pre.save('po-oferta-b', { items: [
      { productId: p.id, productName: p.name, quantity: 54, packSize: 6, unitPrice: 900 },
      { productId: p.id, productName: p.name, quantity: 6, unitPrice: 1000 },
    ] }, cajero.id, false);
    assert.deepStrictEqual(mucho.items.map((i: any) => i.unitPrice), [850, 850], 'llegando a 60 entre bultos y sueltas, todo a 850');
  });

  await t('reparto: recuerda el orden de visita de cada cliente', async () => {
    const p = await nuevo('Agua visita', 100);
    const cs = [];
    for (const n of ['Visita A', 'Visita B', 'Visita C']) cs.push(await prisma.client.create({ data: { name: n, locality: 'Bavio' } }));
    let k = 0;
    const pedido = async (c: any) => {
      const id = `po-visita-${++k}`;
      await (prisma as any).preOrder.create({ data: { id, orderNumber: 990400 + k, clientId: c.id, userId: cajero.id, total: 1000, items: { create: [{ productId: p.id, productName: p.name, quantity: 1, unitPrice: 1000, total: 1000 }] } } });
      return id;
    };
    const [a, b, c] = [await pedido(cs[0]), await pedido(cs[1]), await pedido(cs[2])];
    const run = await runs.create({ orderIds: [a, b, c] });
    await runs.setStops(run.id, [c, a, b]);
    await runs.remove(run.id);
    const [a2, b2, c2] = [await pedido(cs[0]), await pedido(cs[1]), await pedido(cs[2])];
    const otra = await runs.create({ orderIds: [a2, b2, c2] });
    assert.deepStrictEqual(otra.orders.map((o: any) => o.client.name), ['Visita C', 'Visita A', 'Visita B'], 'sale en el orden que dejó el dueño');
  });

  await t('informes de la distribuidora y sugerencia de compra', async () => {
    const { DistribReportsService } = require('../src/modules/preorders/distrib-reports.service');
    const rep = new DistribReportsService(prisma);
    const r = await rep.report({ from: new Date(Date.now() - 86400000).toISOString() });
    assert.ok(r.totals.orders > 0);
    assert.ok(r.sellers.length > 0 && r.sellers.every((x: any) => typeof x.delivered === 'number'));
    const set = r.sellers.reduce((s: number, x: any) => s + x.ordered, 0);
    assert.ok(Math.abs(set - r.totals.ordered) < 0.01, 'los vendedores suman el total');
    assert.ok(r.reasons.some((x: any) => x.reason === 'Rechazó un bulto'), 'cuenta los rechazos por motivo');
    assert.ok(r.zones.some((z: any) => z.zone === 'Bavio'));
    const p = await nuevo('Gaseosa a comprar', 2, { unitsPerPack: 6, minStock: 6 });
    await (prisma as any).preOrder.create({ data: { id: 'po-compra-1', orderNumber: 990601, userId: cajero.id, total: 0, items: { create: [{ productId: p.id, productName: p.name, quantity: 10, unitPrice: 0, total: 0 }] } } });
    const sug = await rep.purchaseSuggestion();
    const it = sug.flatMap((x: any) => x.items).find((x: any) => x.productId === p.id);
    assert.ok(it, 'sugiere comprarlo');
    assert.strictEqual(it.units, 18, 'faltan 14 (10 pedidos + 6 mínimo - 2): se redondea a 3 bultos de 6');
    assert.strictEqual(it.bultos, 3);
  });

  await t('encargos: seña, entrega y recordatorio', async () => {
    const { WorkOrdersService } = require('../src/modules/workorders/workorders.service');
    const avisos: any[] = [];
    const notifyStub: any = { enqueue: (type: string, data: any) => avisos.push({ type, data }) };
    const wo = new WorkOrdersService(prisma, sales, notifyStub);
    const papel = await nuevo('Resma A4', 50, { salePrice: 9000 });
    const manana = new Date(Date.now() + 86400000);
    // Cliente nuevo por nombre y teléfono; un trabajo a mano y un producto del catálogo
    const o: any = await wo.save('wo-test-0001', {
      clientName: 'Estudio Jurídico Pérez', clientPhone: '221 555-0199', priority: 'ALTA', dueAt: manana.toISOString(),
      items: [
        { description: 'Tarjetas personales', specs: '9x5 cm, ilustración 300 g, laminado mate', quantity: 500, unitPrice: 30 },
        { productId: papel.id, description: 'Resma A4', quantity: 1, unitPrice: 9000 },
      ],
    }, cajero.id);
    assert.strictEqual(o.total, 24000);
    assert.ok(o.clientId && o.number > 0);
    const otra: any = await wo.save('wo-test-0002', { clientName: 'Otro nombre', clientPhone: '2215550199', items: [{ description: 'Volantes', quantity: 1, unitPrice: 100 }] }, cajero.id);
    assert.strictEqual(otra.clientId, o.clientId, 'mismo teléfono = mismo cliente');
    // Seña: entra a la caja y le queda a favor
    await wo.collect(o.id, { amount: 10000, method: 'CASH', sessionId: session.id, key: 'a' }, cajero.id);
    await wo.collect(o.id, { amount: 10000, method: 'CASH', sessionId: session.id, key: 'a' }, cajero.id); // repetido: no cobra dos veces
    let c: any = await prisma.client.findUnique({ where: { id: o.clientId } });
    assert.strictEqual(c.balance, -10000, 'la seña queda a favor');
    assert.strictEqual((await wo.findOne(o.id)).deposit, 10000);
    await assert.rejects(() => wo.collect(o.id, { amount: 20000, method: 'CASH', sessionId: session.id, key: 'b' }, cajero.id), /mayor/);
    // Recordatorio: vence mañana
    const r = await wo.remind(new Date(new Date().setHours(10, 0, 0, 0)));
    assert.ok(r.some((x: any) => x.number === o.number) && avisos[0]?.type === 'workOrderDue');
    assert.strictEqual((await wo.remind(new Date(new Date().setHours(11, 0, 0, 0)))).length, 0, 'una vez por día');
    // Estados y entrega
    await wo.setStatus(o.id, 'LISTO');
    await assert.rejects(() => wo.deliver(o.id, { sessionId: session.id, payments: [{ method: 'CASH', amount: 1000 }] }, cajero.id), /Falta cobrar/);
    const stockAntes = await stockDe(papel.id);
    const d: any = await wo.deliver(o.id, { sessionId: session.id, payments: [{ method: 'CASH', amount: 14000 }] }, cajero.id);
    assert.strictEqual(d.status, 'ENTREGADO');
    const venta: any = await prisma.sale.findUnique({ where: { id: d.saleId }, include: { payments: true, items: true } });
    assert.strictEqual(venta.total, 24000);
    assert.deepStrictEqual(venta.payments.map((p: any) => [p.method, p.amount]).sort(), [['CASH', 14000], ['DEBT', 10000]]);
    assert.strictEqual(await stockDe(papel.id), stockAntes - 1, 'el producto del catálogo sale del stock');
    c = await prisma.client.findUnique({ where: { id: o.clientId } });
    assert.strictEqual(c.balance, 0, 'la seña se usó en la venta: no debe ni le deben');
    await assert.rejects(() => wo.save(o.id, { clientId: o.clientId, items: [{ description: 'x', quantity: 1, unitPrice: 1 }] }, cajero.id), /ya se entregó/);
  });

  await t('clientes: un empleado no cambia el saldo editando; el dueño sí', async () => {
    const { ClientsService } = require('../src/modules/clients/clients.service');
    const svc = new ClientsService(prisma);
    const c = await svc.create({ name: 'Saldo inicial', balance: 500 }, false);
    assert.strictEqual(c.balance, 0, 'el empleado no pone saldo inicial');
    const c2 = await svc.create({ name: 'Saldo inicial dueño', balance: 500 }, true);
    assert.strictEqual(c2.balance, 500);
    const e = await svc.update(c2.id, { name: 'Editado', balance: 0 }, false);
    assert.strictEqual(e.balance, 500, 'editar no borra la deuda');
    assert.strictEqual(e.name, 'Editado');
    const a = await svc.update(c2.id, { balance: 100 }, true);
    assert.strictEqual(a.balance, 100);
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
