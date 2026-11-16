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
const { CommissionsService } = require('../src/modules/preorders/commissions.service');
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

  await t('deshacer boleta: saca el stock, vuelve costo y precio, oculta el producto nuevo y anula la compra', async () => {
    const p = await nuevo('GALLETITAS', 4, { costPrice: 500, salePrice: 1000, wholesalePrice: 900 });
    const c = await purchases.create({ supplierId: supplier.id, userId: admin.id, paymentStatus: 'OWED', items: [
      { productId: p.id, quantity: 10, cost: 600 },
      { productId: p.id, quantity: 2, cost: 600 }, // el mismo producto en otro renglón
      { quantity: 3, cost: 200, newProductData: { name: 'PRODUCTO NUEVO DE LA BOLETA', salePrice: 400 } },
    ] });
    const nuevoId = (await prisma.purchaseItem.findFirst({ where: { purchaseId: c.id, productName: 'PRODUCTO NUEVO DE LA BOLETA' } }))!.productId;
    assert.strictEqual(await stockDe(p.id), 16);
    const subido = await prisma.product.findUnique({ where: { id: p.id } });
    assert.ok(subido!.costPrice > 500 && subido!.salePrice > 1000, 'la compra cambió costo y precio');
    const r = await purchases.undoPurchase(c.id);
    const vuelto = await prisma.product.findUnique({ where: { id: p.id } });
    assert.strictEqual(vuelto!.stock, 4);
    assert.strictEqual(vuelto!.costPrice, 500);
    assert.strictEqual(vuelto!.salePrice, 1000);
    assert.strictEqual(vuelto!.wholesalePrice, 900);
    assert.strictEqual((await prisma.product.findUnique({ where: { id: nuevoId } }))!.isActive, false, 'el nuevo queda oculto');
    assert.strictEqual(r.restored, 1);
    assert.strictEqual(r.hidden, 1);
    assert.strictEqual((await prisma.purchase.findUnique({ where: { id: c.id } }))!.status, 'CANCELLED');
    await assert.rejects(() => purchases.undoPurchase(c.id), /confirmada/);
    assert.strictEqual(await stockDe(p.id), 4, 'dos veces no saca dos veces');
  });

  await t('remito en $0 y después su factura: el costo no queda en 0 y el stock no se duplica', async () => {
    const p = await nuevo('LAVANDINA REMITO', 2, { costPrice: 500, salePrice: 1000 });
    const prov = await prisma.supplier.create({ data: { name: 'Limpieza SA' } });
    const remito = await purchases.create({ supplierId: prov.id, userId: admin.id, paymentStatus: 'OWED', manualTotal: 0, docType: 'remito', items: [{ productId: p.id, quantity: 6, cost: 0 }] });
    let d = await prisma.product.findUnique({ where: { id: p.id } });
    assert.strictEqual(d!.stock, 8);
    assert.strictEqual(d!.costPrice, 500, 'el remito sin precios no toca el costo');
    // Llega la factura: mismos productos y cantidades → se reconoce el remito
    const match = await purchases.findRemitoFor(prov.id, [{ productId: p.id, quantity: 6 }]);
    assert.strictEqual(match?.id, remito.id);
    const pend = await prisma.purchase.create({ data: { supplierId: prov.id, userId: admin.id, total: 4356, status: 'PENDING', paymentStatus: 'OWED', invoiceNumber: '1-55' } });
    await prisma.$executeRawUnsafe(`UPDATE purchases SET draft = ? WHERE id = ?`, JSON.stringify({ items: [{ name: 'LAVANDINA', quantity: 6, cost: 600 }], remitoMatch: match }), pend.id);
    await purchases.confirmPending(pend.id, { supplierId: prov.id, userId: admin.id, paymentStatus: 'OWED', invoiceNumber: '1-55', manualTotal: 4356, items: [{ productId: p.id, quantity: 6, cost: 600 }], fromRemitoId: remito.id } as any);
    d = await prisma.product.findUnique({ where: { id: p.id } });
    assert.strictEqual(d!.stock, 8, 'la factura no vuelve a sumar');
    assert.strictEqual(Math.round(d!.costPrice), 726, 'toma el costo de la factura');
    const r = await prisma.purchase.findUnique({ where: { id: remito.id } });
    assert.strictEqual(r!.total, 4356, 'el remito queda con la deuda de la factura');
    assert.strictEqual(r!.invoiceNumber, '1-55');
    assert.strictEqual(await prisma.purchase.findUnique({ where: { id: pend.id } }), null, 'la pendiente se borra');
    // Una factura con otros productos no es la de ese remito
    assert.strictEqual(await purchases.findRemitoFor(prov.id, [{ productId: p.id, quantity: 6 }]), null, 'ya tiene factura');
  });

  await t('nota de crédito: resta deuda; el stock solo si se devolvió la mercadería, y no toca precios', async () => {
    const p = await nuevo('GASEOSA NC', 10, { costPrice: 500, salePrice: 1000 });
    const prov = await prisma.supplier.create({ data: { name: 'Bebidas NC' } });
    const nc1 = await prisma.purchase.create({ data: { supplierId: prov.id, userId: admin.id, total: 0, status: 'PENDING', paymentStatus: 'OWED' } });
    await purchases.confirmCreditNote(nc1.id, { supplierId: prov.id, userId: admin.id, total: 1210, returnStock: false, items: [{ productId: p.id, quantity: 2 }] });
    assert.strictEqual(await stockDe(p.id), 10, 'sin devolución no toca el stock');
    assert.strictEqual((await prisma.purchase.findUnique({ where: { id: nc1.id } }))!.total, -1210);
    const nc2 = await prisma.purchase.create({ data: { supplierId: prov.id, userId: admin.id, total: 0, status: 'PENDING', paymentStatus: 'OWED' } });
    await purchases.confirmCreditNote(nc2.id, { supplierId: prov.id, userId: admin.id, total: 605, returnStock: true, items: [{ productId: p.id, quantity: 2 }] });
    const d = await prisma.product.findUnique({ where: { id: p.id } });
    assert.strictEqual(d!.stock, 8, 'devolución: resta');
    assert.strictEqual(d!.costPrice, 500);
    assert.strictEqual(d!.salePrice, 1000);
    await assert.rejects(() => purchases.confirmCreditNote(nc2.id, { supplierId: prov.id, userId: admin.id, total: 605 }), /ya fue cargada/);
  });

  await t('automático por proveedor: 5 boletas sin tocar lo ofrecen; una corregida lo apaga', async () => {
    const p = await nuevo('AGUA AUTO', 0, { costPrice: 500, salePrice: 1000 });
    const prov = await prisma.supplier.create({ data: { name: 'Aguas del Sur' } });
    // Con buscador y nube mudos: confirmar aprende códigos y manda correcciones (acá no hacen nada)
    const purchases = new PurchasesService(prisma, mute(), mute(), mute());
    const boleta = async (qty: number, confirmQty: number) => {
      const pend = await prisma.purchase.create({ data: { supplierId: prov.id, userId: admin.id, total: 0, status: 'PENDING', paymentStatus: 'OWED' } });
      await prisma.$executeRawUnsafe(`UPDATE purchases SET draft = ? WHERE id = ?`, JSON.stringify({ items: [{ name: 'AGUA 2L', quantity: qty, cost: 413.22 }] }), pend.id);
      return purchases.confirmPending(pend.id, { supplierId: prov.id, userId: admin.id, paymentStatus: 'OWED', items: [{ productId: p.id, quantity: confirmQty, cost: 413.22, source: { name: 'AGUA 2L' } }] } as any);
    };
    for (let k = 1; k <= 4; k++) assert.ok(!(await boleta(6, 6) as any).offerAuto, `la ${k}ª todavía no`);
    const fifth: any = await boleta(6, 6);
    assert.strictEqual(fifth.offerAuto?.supplierId, prov.id, 'a la 5ª se ofrece');
    await purchases.setSupplierAuto(prov.id, true);
    assert.strictEqual(await purchases.supplierAuto(prov.id), true);
    // Una boleta que hubo que corregir (la cantidad) apaga el automático
    await boleta(6, 12);
    assert.strictEqual(await purchases.supplierAuto(prov.id), false);
    // Si el dueño dijo que no, no se vuelve a ofrecer en la misma racha
    for (let k = 1; k <= 5; k++) await boleta(6, 6);
    await purchases.setSupplierAuto(prov.id, false);
    assert.ok(!(await boleta(6, 6) as any).offerAuto);
  });

  await t('caja: un código no registrado se asocia a un producto recién comprado sin código', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ProductsController } = require('../src/modules/products/products.controller');
    const ctrl = new ProductsController(null, { findByBarcode: (c: string) => prisma.product.findFirst({ where: { barcode: c } }) }, null, null, null, null, null, prisma);
    const sinCodigo = await nuevo('PAN DE CAMPO SIN CODIGO', 0);
    const conCodigo = await nuevo('GALLETITA CON CODIGO', 0, { barcode: '7790001234561' });
    await purchases.create({ supplierId: supplier.id, userId: admin.id, paymentStatus: 'OWED', items: [{ productId: sinCodigo.id, quantity: 3, cost: 100 }, { productId: conCodigo.id, quantity: 3, cost: 100 }] });
    const list = await ctrl.recentWithoutBarcode();
    assert.ok(list.some((p: any) => p.id === sinCodigo.id), 'aparece el que no tiene código');
    assert.ok(!list.some((p: any) => p.id === conCodigo.id), 'el que ya tiene, no');
    const linked = await ctrl.assignBarcode(sinCodigo.id, { barcode: '7790009876543' });
    assert.strictEqual(linked.id, sinCodigo.id);
    await assert.rejects(() => ctrl.assignBarcode(sinCodigo.id, { barcode: '7790001234561' }), /ya es de/);
  });

  await t('avisos al comercio: aumento fuerte de un proveedor y factura que no cierra', async () => {
    const events: any[] = [];
    const svc = new PurchasesService(prisma, mute(), mute(), mute(), undefined, { enqueue: (type: string, data: any) => events.push({ type, data }) } as any);
    const prov = await prisma.supplier.create({ data: { name: 'Distri Aumentos' } });
    const yerba = await nuevo('YERBA AVISO', 0, { costPrice: 1000, salePrice: 1500 });
    const sal = await nuevo('SAL AVISO', 0, { costPrice: 500, salePrice: 800 });
    // Yerba +30% (1000 → 1300 con IVA), sal +2%: solo avisa la yerba
    const c = await svc.create({ supplierId: prov.id, userId: admin.id, paymentStatus: 'OWED', items: [{ productId: yerba.id, quantity: 1, cost: 1300 / 1.21 }, { productId: sal.id, quantity: 1, cost: 510 / 1.21 }] });
    await svc.afterConfirmAlerts(c.id, prov.id);
    const raise = events.find((e) => e.data.kind === 'raise');
    assert.deepStrictEqual(raise.data.items.map((i: any) => i.name), ['YERBA AVISO']);
    assert.strictEqual(raise.data.items[0].pct, 30);
    // Boleta que no cerraba y se confirmó sin tocar nada: la cuenta del proveedor está mal
    await svc.afterConfirmAlerts(c.id, prov.id, { check: { ok: false }, printedTotal: 20000, items: [{ total: 10000 }], invoiceNumber: '3-1' }, true);
    const math = events.find((e) => e.data.kind === 'math');
    assert.strictEqual(math.data.total, 20000);
    assert.strictEqual(math.data.sum, 12100);
    // Si el dueño corrigió renglones, no se acusa al proveedor
    events.length = 0;
    await svc.afterConfirmAlerts(c.id, prov.id, { check: { ok: false }, printedTotal: 20000, items: [{ total: 10000 }] }, false);
    assert.ok(!events.some((e) => e.data.kind === 'math'));
  });

  await t('deshacer boleta: un precio que cambiaron después no se pisa', async () => {
    const p = await nuevo('ACEITE', 0, { costPrice: 500, salePrice: 1000 });
    const c = await purchases.create({ supplierId: supplier.id, userId: admin.id, paymentStatus: 'OWED', items: [{ productId: p.id, quantity: 5, cost: 600 }] });
    await prisma.product.update({ where: { id: p.id }, data: { salePrice: 1999 } });
    const r = await purchases.undoPurchase(c.id);
    const d = await prisma.product.findUnique({ where: { id: p.id } });
    assert.strictEqual(d!.salePrice, 1999);
    assert.strictEqual(d!.stock, 0, 'el stock sale igual');
    assert.deepStrictEqual(r.keptChanged, ['ACEITE']);
  });

  await t('deshacer boleta: una compra vieja sin datos guardados se rechaza sin tocar nada', async () => {
    const p = await nuevo('SAL', 0);
    const c = await purchases.create({ supplierId: supplier.id, userId: admin.id, paymentStatus: 'OWED', items: [{ productId: p.id, quantity: 5, cost: 100 }] });
    await prisma.$executeRawUnsafe(`UPDATE purchases SET undo_info = NULL WHERE id = ?`, c.id);
    await assert.rejects(() => purchases.undoPurchase(c.id), /antes de que existiera/);
    assert.strictEqual(await stockDe(p.id), 5);
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

  await t('comisiones: % general o propio sobre lo entregado en repartos rendidos, y pagos que salen de la caja elegida', async () => {
    const comm = new CommissionsService(prisma, cash);
    const p = await nuevo('FERNET', 100);
    const cli = await prisma.client.create({ data: { name: 'Kiosco Comisión' } });
    const vende = await prisma.user.create({ data: { username: 'VENDE1', passwordHash: 'x', fullName: 'Rocío Vende', role: 'CASHIER', workRole: 'VENDEDOR' } as any });
    const quieto = await prisma.user.create({ data: { username: 'VENDE2', passwordHash: 'x', fullName: 'Nico Quieto', role: 'CASHIER', workRole: 'VENDEDOR' } as any });
    const mk = (id: string, n: number, q: number) => (prisma as any).preOrder.create({ data: { id, orderNumber: 930000 + n, clientId: cli.id, userId: vende.id, total: q * 1000, items: { create: [{ id: id + '-i', productId: p.id, productName: 'FERNET', quantity: q, unitPrice: 1000, total: q * 1000 }] } } });
    await mk('po-com-a', 1, 10); await mk('po-com-b', 2, 10);
    await prisma.storeSetting.upsert({ where: { id: 'seller_commission_pct' }, create: { id: 'seller_commission_pct', value: '5' }, update: { value: '5' } });

    const run = await runs.create({ orderIds: ['po-com-a', 'po-com-b'] });
    await runs.dispatch(run.id, {}, admin.id);
    await runs.saveDelivery(run.id, 'po-com-a', { status: 'DELIVERED' });
    await runs.saveDelivery(run.id, 'po-com-b', { status: 'PARTIAL', items: { 'po-com-b-i': 4 }, reason: 'Rechazó 6' });
    let m = await comm.month();
    let r = m.sellers.find((x: any) => x.userId === vende.id);
    assert.strictEqual(r.delivered, 0, 'antes de rendir no cuenta');
    assert.ok(m.sellers.some((x: any) => x.userId === quieto.id), 'el vendedor sin ventas aparece para ponerle su %');

    await runs.settle(run.id, {}, admin.id);
    m = await comm.month();
    r = m.sellers.find((x: any) => x.userId === vende.id);
    assert.strictEqual(r.delivered, 14000, 'lo rechazado no cuenta');
    assert.strictEqual(r.pct, 5); assert.strictEqual(r.commission, 700);

    await comm.setPct(vende.id, '8');
    r = (await comm.month()).sellers.find((x: any) => x.userId === vende.id);
    assert.strictEqual(r.pct, 8); assert.strictEqual(r.commission, 1120, 'su % propio gana al general');
    await assert.rejects(() => comm.setPct(vende.id, 150), /entre 0 y 100/);

    // Pago en dos partes: transferencia (solo se anota) y efectivo de la caja del mes (gasto)
    await assert.rejects(() => comm.pay(admin.id, { userId: vende.id, amount: 2000, source: 'TRANSFER' }), /no se le puede pagar más/);
    await comm.pay(admin.id, { userId: vende.id, amount: 500, source: 'TRANSFER' });
    const after = await comm.pay(admin.id, { userId: vende.id, amount: 620, source: 'FUND' });
    r = after.sellers.find((x: any) => x.userId === vende.id);
    assert.strictEqual(r.paid, 1120); assert.strictEqual(r.owed, 0);
    const gasto = await prisma.cashMovement.findFirst({ where: { sessionId: 'caja-del-mes', type: 'EXPENSE', description: { contains: 'COMISION ROCÍO VENDE' } } });
    assert.ok(gasto && gasto.amount === 620, 'el efectivo sale de la caja del mes como gasto');
    await assert.rejects(() => comm.pay(admin.id, { userId: vende.id, amount: 10, source: 'SESSION', sessionId: 'no-existe' }), /caja abierta|pagar más/);

    // Volver al general
    await comm.setPct(vende.id, '');
    r = (await comm.month()).sellers.find((x: any) => x.userId === vende.id);
    assert.strictEqual(r.ownPct, null); assert.strictEqual(r.pct, 5);
    await prisma.storeSetting.delete({ where: { id: 'seller_commission_pct' } });
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

    // Transferencia comprobada en el banco: se tilda, se borra si cambia el monto, y no hay en efectivo
    await assert.rejects(() => runs.checkTransfer(run.id, 'po-set-a', true, cajero.id), /no hubo transferencia/);
    let vista = (await runs.checkTransfer(run.id, 'po-set-b', true, cajero.id)).orders.find((o: any) => o.id === 'po-set-b');
    assert.ok(vista.transferCheckedAt, 'queda tildada');
    await runs.saveDelivery(run.id, 'po-set-b', { status: 'PARTIAL', items: { 'po-set-b-i': 6 }, transfer: 400, reason: 'Rechazó un bulto' });
    vista = await (prisma as any).preOrder.findUnique({ where: { id: 'po-set-b' } });
    assert.ok(vista.transferCheckedAt, 'mismo monto: sigue tildada');
    await runs.saveDelivery(run.id, 'po-set-b', { status: 'PARTIAL', items: { 'po-set-b-i': 6 }, transfer: 300, reason: 'Rechazó un bulto' });
    vista = await (prisma as any).preOrder.findUnique({ where: { id: 'po-set-b' } });
    assert.strictEqual(vista.transferCheckedAt, null, 'cambió el monto: se destilda');
    await runs.saveDelivery(run.id, 'po-set-b', { status: 'PARTIAL', items: { 'po-set-b-i': 6 }, transfer: 400, reason: 'Rechazó un bulto' });

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
    vista = (await runs.checkTransfer(run.id, 'po-set-b', true, cajero.id)).orders.find((o: any) => o.id === 'po-set-b');
    assert.ok(vista.transferCheckedAt, 'después de rendir también se puede tildar');

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

  await t('caja del mes: le entra lo que trae el chofer y el Z una sola vez, y el balance deja la diferencia', async () => {
    const { MONTH_FUND_ID, readMonthFund } = require('../src/modules/cash-register/month-fund');
    // La rendición de arriba (Con gastos): trajo 700 contados
    const gas = await (prisma as any).deliveryRun.findFirst({ where: { orders: { some: { id: 'po-gas-a' } } } });
    const delReparto = await prisma.cashMovement.findMany({ where: { sessionId: MONTH_FUND_ID, description: { contains: `[reparto:${gas.id}]` } } });
    assert.strictEqual(delReparto.length, 1);
    assert.strictEqual(delReparto[0].amount, 700, 'entra lo que contó, no lo cobrado');
    const fondo = await prisma.cashRegisterSession.findUnique({ where: { id: MONTH_FUND_ID } });
    assert.strictEqual(fondo!.status, 'FONDO');
    assert.strictEqual((await cash.getActiveSessions()).some((x: any) => x.id === MONTH_FUND_ID), false, 'no aparece como caja abierta');

    const antes = (await cash.getMonthFund(admin.id)).balance;
    const z = await prisma.dailyZReport.create({ data: { generatedById: admin.id, totalExpected: 5000, totalDeclared: 5000, differenceTotal: 0 } });
    await cash.monthFundFromZ(cajero.id, { zReportId: z.id, amount: 4500 });
    await cash.monthFundFromZ(cajero.id, { zReportId: z.id, amount: 4500 });
    let f = await cash.getMonthFund(admin.id);
    assert.strictEqual(f.balance, antes + 4500, 'el mismo Z no entra dos veces');
    assert.ok(f.totals.fromZ >= 4500 && f.totals.fromReparto >= 700);

    await cash.addCashMovement(MONTH_FUND_ID, admin.id, { type: 'EXPENSE', amount: 1000, description: '[Otro] LUZ | METODO: CASH' }, 'ADMIN');
    await assert.rejects(() => cash.addCashMovement(MONTH_FUND_ID, cajero.id, { type: 'WITHDRAWAL', amount: 10 }, 'CAJERO'), 'solo el administrador saca de la caja del mes');
    f = await cash.getMonthFund(admin.id);
    assert.strictEqual(f.balance, antes + 3500);

    await assert.rejects(() => cash.closeMonthFund(cajero.id, 'CAJERO', { counted: 1 }), 'el balance lo hace el administrador');
    const cerrado = await cash.closeMonthFund(admin.id, 'ADMIN', { counted: f.balance - 200, notes: 'vuelto' });
    assert.strictEqual(cerrado.closed.difference, -200, 'faltan 200');
    assert.strictEqual(cerrado.balance, f.balance - 200, 'sigue con lo contado');
    await assert.rejects(() => cash.closeMonthFund(admin.id, 'ADMIN', { counted: 0 }), 'un mes, un balance');
    const prox = new Date(); prox.setMonth(prox.getMonth() + 1);
    const siguiente = await readMonthFund(prisma, `${prox.getFullYear()}-${String(prox.getMonth() + 1).padStart(2, '0')}`);
    assert.strictEqual(siguiente.opening, f.balance - 200, 'el mes siguiente arranca con lo contado');
  });

  await t('cobro de cuenta corriente a la caja del mes: baja la deuda, no pasa por el mostrador y el efectivo entra una vez', async () => {
    const { MONTH_FUND_ID } = require('../src/modules/cash-register/month-fund');
    const cli = await prisma.client.create({ data: { name: 'Almacén Cobro', balance: 5000 } });
    const antes = (await cash.getMonthFund(admin.id)).balance;
    const datos = { key: 'k-cobro-1', clientId: cli.id, payments: [{ method: 'CASH', amount: 3000 }, { method: 'TRANSFERENCIA', amount: 1000 }] };
    const r = await runs.collectToMonthFund(admin.id, datos);
    await runs.collectToMonthFund(admin.id, datos);
    assert.strictEqual(r.balance, 1000, 'debe lo que no pagó');
    assert.strictEqual((await prisma.client.findUnique({ where: { id: cli.id } }))!.balance, 1000, 'el reintento no cobra dos veces');
    const venta = await prisma.sale.findUnique({ where: { id: 'cobrofondo-k-cobro-1' } });
    assert.strictEqual(venta!.sessionId, 'reparto-cash', 'no entra al cajón del mostrador');
    const f = await cash.getMonthFund(admin.id);
    assert.strictEqual(f.balance, antes + 3000, 'solo el efectivo entra a la caja del mes');
    assert.ok(f.totals.fromCollections >= 3000);
    assert.strictEqual(await prisma.cashMovement.count({ where: { sessionId: MONTH_FUND_ID, description: { contains: '[cobro:k-cobro-1]' } } }), 1);
  });

  await t('factura del mes: varias ventas a cuenta de una escuela en una sola factura, sin facturarlas de nuevo', async () => {
    const { FiscalService } = require('../src/modules/fiscal/fiscal.service');
    const { WsaaService } = require('../src/modules/fiscal/wsaa.service');
    // ARCA de mentira: numera y autoriza todo
    let ultimo = 0;
    const pedidos: any[] = [];
    const wsfe: any = {
      ultimoAutorizado: async () => ultimo,
      solicitarCae: async (_ctx: any, req: any) => { ultimo = req.numero; pedidos.push(req); return { cae: `CAE${req.numero}`, caeVencimiento: '20991231', numero: req.numero, fecha: req.fecha, observaciones: [], replayed: false }; },
      consultar: async () => null,
    };
    const fiscal = new FiscalService(prisma, new WsaaService(prisma), wsfe, mute(), mute());
    (fiscal as any).transportFor = async () => ({ kind: 'direct' });
    await prisma.fiscalConfig.upsert({
      where: { id: 'fiscal_config' },
      create: { id: 'fiscal_config', enabled: true, cuit: '20000000001', razonSocial: 'Libreria Prueba', ivaCondition: 'RESPONSABLE_INSCRIPTO', pointOfSale: 3, autoInvoice: true, autoInvoiceSince: new Date(Date.now() - 60_000) } as any,
      update: { enabled: true, cuit: '20000000001', ivaCondition: 'RESPONSABLE_INSCRIPTO', pointOfSale: 3, autoInvoice: true, autoInvoiceSince: new Date(Date.now() - 60_000) } as any,
    });

    const escuela = await prisma.client.create({ data: { name: 'Escuela N° 12', monthlyInvoice: true } as any });
    const resma = await nuevo('Resma A4 factura mes', 100, { salePrice: 1000, taxRate: 21 });
    const tiza = await nuevo('Tiza factura mes', 100, { salePrice: 200, taxRate: 21 });
    const fiado = (items: any[]) => crear({ sessionId: session.id, clientId: escuela.id, items, payments: [{ method: 'DEBT', amount: items.reduce((t: number, i: any) => t + i.quantity * i.price, 0) }] }, cajero.id);
    const v1 = await fiado([{ productId: resma.id, quantity: 5, price: 1000 }]);
    const v2 = await fiado([{ productId: resma.id, quantity: 2, price: 1000 }, { productId: tiza.id, quantity: 10, price: 200 }]);
    const v3 = await fiado([{ productId: tiza.id, quantity: 5, price: 200 }]);
    const dev = await fiado([{ productId: resma.id, quantity: -1, price: 1000 }]);

    // La factura automática no las toca: el cliente es de factura mensual
    await (fiscal as any).sweepAuto(await prisma.fiscalConfig.findUnique({ where: { id: 'fiscal_config' } }), 0);
    await fiscal.onSaleCreated(v1.id);
    assert.strictEqual(await prisma.fiscalDocument.count({ where: { saleId: { in: [v1.id, v2.id, v3.id, dev.id] } } }), 0, 'sin facturas sueltas');
    assert.strictEqual(await fiscal.queueInvoice(v2.id, admin.id), null, 'el reparto tampoco la factura suelta');

    const cand = await fiscal.monthlyCandidates(escuela.id, {});
    assert.deepStrictEqual(cand.sales.map((x: any) => x.id), [v1.id, v2.id, v3.id, dev.id]);
    assert.strictEqual(cand.total, 5000 + 4000 + 1000 - 1000);

    await assert.rejects(() => fiscal.invoiceGroup(escuela.id, [dev.id], undefined, admin.id), /devoluciones solas/);
    const doc = await fiscal.invoiceGroup(escuela.id, [v1.id, v2.id, v3.id, dev.id], undefined, admin.id);
    assert.strictEqual(doc.status, 'AUTHORIZED');
    assert.strictEqual(doc.total, 9000, 'una sola factura con todo, menos la devolución');
    assert.strictEqual(pedidos.length, 1, 'un solo pedido a ARCA');
    assert.deepStrictEqual(doc.lines.map((l: any) => [l.name, l.quantity, l.total]), [['Resma A4 factura mes', 6, 6000], ['Tiza factura mes', 15, 3000]], 'el mismo producto se suma');
    assert.strictEqual(doc.group.length, 4);

    // Ninguna se puede facturar de nuevo, y todas muestran la factura del mes
    assert.strictEqual((await fiscal.getSaleFiscal(v2.id)).invoice.id, doc.id);
    await assert.rejects(() => fiscal.invoiceSale(v2.id, {}, admin.id), /factura del mes/);
    await assert.rejects(() => fiscal.invoiceSale(v1.id, {}, admin.id), /factura del mes|ya tiene/);
    assert.strictEqual((await fiscal.monthlyCandidates(escuela.id, {})).sales.length, 0);
    const sueltas = await fiscal.listUninvoiced({ from: new Date(Date.now() - 3600_000).toISOString() });
    assert.ok(!sueltas.some((x: any) => [v1.id, v2.id, v3.id].includes(x.id)), 'no aparecen como sin factura');
    const lista = await fiscal.listDocuments({});
    assert.ok(!lista.documents.some((d: any) => d.status === 'GROUPED'), 'las marcas no son comprobantes');

    // Se anula una venta después de facturar: nota de crédito solo por esa venta
    await fiscal.onSaleCancelled(v3.id, admin.id);
    const nc = await prisma.fiscalDocument.findUnique({ where: { id: `${v3.id}:NCG` } });
    assert.ok(nc && nc.kind === 'NOTA_CREDITO' && nc.assocDocumentId === doc.id);
    assert.strictEqual(nc!.total, 1000);
    assert.strictEqual(await prisma.fiscalDocument.count({ where: { id: `${doc.id}:NC` } }), 0, 'la factura del mes no se anula entera');

    // Con una venta anulada en la cola, la factura sale sin ella
    const v4 = await fiado([{ productId: resma.id, quantity: 1, price: 1000 }]);
    const v5 = await fiado([{ productId: tiza.id, quantity: 1, price: 200 }]);
    (fiscal as any).transportFor = async () => { throw new Error('sin señal'); };
    const enCola = await fiscal.invoiceGroup(escuela.id, [v4.id, v5.id], undefined, admin.id);
    assert.strictEqual(enCola.status, 'PENDING');
    await prisma.sale.update({ where: { id: v5.id }, data: { status: 'CANCELLED' } });
    (fiscal as any).transportFor = async () => ({ kind: 'direct' });
    await fiscal.retryDocument(enCola.id);
    const salio = await fiscal.documentViewById(enCola.id);
    assert.strictEqual(salio.status, 'AUTHORIZED'); assert.strictEqual(salio.total, 1000, 'la anulada quedó afuera');
    assert.strictEqual((await prisma.fiscalDocument.findFirst({ where: { saleId: v5.id, assocDocumentId: enCola.id } }))!.status, 'VOID');

    await prisma.fiscalConfig.update({ where: { id: 'fiscal_config' }, data: { enabled: false, autoInvoice: false } as any });
  });

  await t('pagar una compra o a un proveedor: la plata sale de la caja elegida', async () => {
    const { PurchasesController } = require('../src/modules/purchases/purchases.controller');
    const { SuppliersController } = require('../src/modules/suppliers/suppliers.controller');
    const { SuppliersService } = require('../src/modules/suppliers/suppliers.service');
    const ctrl = new PurchasesController(purchases, mute(), cash, prisma);
    const supCtrl = new SuppliersController(new SuppliersService(prisma), cash);
    const prov = await prisma.supplier.create({ data: { name: 'Mayorista Pagos' } });
    const caja = await cash.open(admin.id, { terminalName: 'Caja pagos', openingAmount: 10000 });
    const gastos = async (sessionId: string) => (await prisma.cashMovement.findMany({ where: { sessionId, type: 'EXPENSE' } })).reduce((t: number, m: any) => t + m.amount, 0);
    const dueno = { user: { sub: admin.id, role: 'ADMIN' } };
    const cajera = { user: { sub: cajero.id, role: 'CASHIER' } };

    // Compra pagada en efectivo del cajón
    await ctrl.create({ supplierId: prov.id, manualTotal: 3000, items: [], paymentStatus: 'PAID', paymentMethod: 'Efectivo', cashSource: { source: 'SESSION', sessionId: caja.id } }, dueno);
    assert.strictEqual(await gastos(caja.id), 3000, 'sale del cajón');
    const mv = await prisma.cashMovement.findFirst({ where: { sessionId: caja.id, type: 'EXPENSE' } });
    assert.ok(/^PAGO PROVEEDOR: MAYORISTA PAGOS/.test(mv!.description || ''), 'se lee como pago a proveedor');
    // A deber: no sale nada aunque venga la caja
    await ctrl.create({ supplierId: prov.id, manualTotal: 500, items: [], paymentStatus: 'OWED', cashSource: { source: 'SESSION', sessionId: caja.id } }, dueno);
    assert.strictEqual(await gastos(caja.id), 3000);
    // De la caja del mes: solo el dueño
    const antes = (await cash.getMonthFund(admin.id)).balance;
    await ctrl.create({ supplierId: prov.id, manualTotal: 1000, items: [], paymentStatus: 'PAID', paymentMethod: 'Efectivo', cashSource: { source: 'FUND' } }, dueno);
    assert.strictEqual((await cash.getMonthFund(admin.id)).balance, antes - 1000);
    await assert.rejects(() => ctrl.create({ supplierId: prov.id, manualTotal: 1000, items: [], paymentStatus: 'PAID', cashSource: { source: 'FUND' } }, cajera), /solo paga el dueño/);
    // Transferencia: no sale de ninguna caja
    await ctrl.create({ supplierId: prov.id, manualTotal: 700, items: [], paymentStatus: 'PAID', paymentMethod: 'Transferencia', cashSource: { source: 'NONE' } }, dueno);
    assert.strictEqual(await gastos(caja.id), 3000);

    // Pago de deuda al proveedor desde el cajón; con una caja cerrada no se anota nada
    await supCtrl.addPayment(prov.id, { amount: 2000, method: 'Efectivo', cashSource: { source: 'SESSION', sessionId: caja.id } }, dueno);
    assert.strictEqual(await gastos(caja.id), 5000);
    const pagos = await (prisma as any).supplierPayment.count({ where: { supplierId: prov.id } });
    await assert.rejects(() => supCtrl.addPayment(prov.id, { amount: 10, method: 'Efectivo', cashSource: { source: 'SESSION', sessionId: 'no-existe' } }, dueno), /caja abierta/);
    assert.strictEqual(await (prisma as any).supplierPayment.count({ where: { supplierId: prov.id } }), pagos, 'si la caja no sirve, el pago no queda anotado');
    const fuentes = await cash.paySources(admin.id, 'ADMIN');
    assert.ok(fuentes.sessions.some((x: any) => x.id === caja.id && x.mine)); assert.ok(fuentes.fund != null);
    assert.strictEqual((await cash.paySources(cajero.id, 'CASHIER')).fund, null, 'la cajera no ve la caja del mes');
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

  await t('tienda online: el pedido aceptado entra una vez, con precios del catálogo, y el stock sale con el reparto', async () => {
    const pre = new PreOrdersService(prisma);
    const cli = await prisma.client.create({ data: { name: 'Almacén con link', locality: 'Bavio' } });
    const p = await nuevo('Galletitas tienda', 100, { salePrice: 500, unitsPerPack: 12, packPrice: 5400 });
    const pedido = (unitPrice: number) => ({ fromOnline: true, takenAt: new Date().toISOString(), clientId: cli.id, notes: 'Pedido por la tienda #K7P2', items: [
      { productId: p.id, productName: p.name, quantity: 24, packSize: 12, unitPrice },
      { productId: p.id, productName: p.name, quantity: 3, unitPrice: 500 },
    ] });
    // Lo acepta el dueño, pero con el precio del catálogo (el pedido lo armó el cliente en la tienda)
    const o: any = await pre.save('tienda-orden-0001', pedido(1), admin.id, true);
    assert.deepStrictEqual(o.items.map((i: any) => i.unitPrice), [450, 500]);
    assert.strictEqual(o.total, 12300);
    assert.strictEqual(await stockDe(p.id), 100, 'aceptar no mueve stock');
    assert.strictEqual((await pre.committed())[p.id], 27, 'queda comprometido');
    // Otro equipo lo acepta de nuevo: no se duplica ni se pisa
    const otra: any = await pre.save('tienda-orden-0001', pedido(450), cajero.id, false);
    assert.strictEqual(otra.orderNumber, o.orderNumber);
    assert.strictEqual(await (prisma as any).preOrder.count({ where: { id: 'tienda-orden-0001' } }), 1);
    // El dueño lo corrige en Pedidos (le saca las sueltas) y llega tarde otra aceptación: queda lo corregido
    await pre.save('tienda-orden-0001', { clientId: cli.id, items: [{ productId: p.id, productName: p.name, quantity: 24, packSize: 12, unitPrice: 450 }] }, admin.id, true);
    const tarde: any = await pre.save('tienda-orden-0001', pedido(450), cajero.id, false);
    assert.strictEqual(tarde.items.length, 1);
    assert.strictEqual(tarde.total, 10800);
    assert.strictEqual((await pre.committed())[p.id], 24);
    // Sale el reparto: recién ahí baja el stock, una sola vez
    const run = await runs.create({ orderIds: ['tienda-orden-0001'] });
    await runs.dispatch(run.id, {}, admin.id);
    assert.strictEqual(await stockDe(p.id), 76);
    const despues: any = await pre.save('tienda-orden-0001', pedido(450), cajero.id, false);
    assert.strictEqual(despues.status, 'BILLED', 'aceptarlo después de que salió no lo toca');
    assert.strictEqual(await stockDe(p.id), 76);
    assert.ok(!(await pre.committed())[p.id], 'ya no está comprometido');
    // Lo que no se entrega vuelve al stock en la rendición
    const renglon = await (prisma as any).preOrderItem.findFirst({ where: { orderId: 'tienda-orden-0001' } });
    await runs.saveDelivery(run.id, 'tienda-orden-0001', { status: 'PARTIAL', items: { [renglon.id]: 12 }, cash: 5400 });
    await runs.settle(run.id, { cashReceived: 5400 }, admin.id);
    assert.strictEqual(await stockDe(p.id), 88, 'el bulto rechazado vuelve');
    // Uno rechazado antes de salir (cancelado) tampoco vuelve a entrar ni mueve stock
    await pre.save('tienda-orden-0002', pedido(450), admin.id, true);
    await pre.cancel('tienda-orden-0002');
    const cancelado: any = await pre.save('tienda-orden-0002', pedido(450), admin.id, true);
    assert.strictEqual(cancelado.status, 'CANCELLED');
    assert.strictEqual(await stockDe(p.id), 88);
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
    const caja = { sub: cajero.id, role: 'CASHIER' };
    const papel = await nuevo('Resma A4', 50, { salePrice: 9000 });
    const manana = new Date(Date.now() + 86400000);
    // Cliente nuevo por nombre y teléfono; un trabajo a mano y un producto del catálogo
    const o: any = await wo.save('wo-test-0001', {
      clientName: 'Estudio Jurídico Pérez', clientPhone: '221 555-0199', priority: 'ALTA', dueAt: manana.toISOString(),
      items: [
        { description: 'Tarjetas personales', specs: '9x5 cm, ilustración 300 g, laminado mate', quantity: 500, unitPrice: 30 },
        { productId: papel.id, description: 'Resma A4', quantity: 1, unitPrice: 9000 },
      ],
    }, caja);
    assert.strictEqual(o.total, 24000);
    assert.ok(o.clientId && o.number > 0);
    const otra: any = await wo.save('wo-test-0002', { clientName: 'Otro nombre', clientPhone: '2215550199', items: [{ description: 'Volantes', quantity: 1, unitPrice: 100 }] }, caja);
    assert.strictEqual(otra.clientId, o.clientId, 'mismo teléfono = mismo cliente');
    // Seña: entra a la caja y le queda a favor
    await wo.collect(o.id, { amount: 10000, method: 'CASH', sessionId: session.id, key: 'a' }, caja);
    await wo.collect(o.id, { amount: 10000, method: 'CASH', sessionId: session.id, key: 'a' }, caja); // repetido: no cobra dos veces
    let c: any = await prisma.client.findUnique({ where: { id: o.clientId } });
    assert.strictEqual(c.balance, -10000, 'la seña queda a favor');
    assert.strictEqual((await wo.findOne(o.id)).deposit, 10000);
    await assert.rejects(() => wo.collect(o.id, { amount: 20000, method: 'CASH', sessionId: session.id, key: 'b' }, caja), /mayor/);
    // Recordatorio: vence mañana
    const r = await wo.remind(new Date(new Date().setHours(10, 0, 0, 0)));
    assert.ok(r.some((x: any) => x.number === o.number) && avisos[0]?.type === 'workOrderDue');
    assert.strictEqual((await wo.remind(new Date(new Date().setHours(11, 0, 0, 0)))).length, 0, 'una vez por día');
    // Estados y entrega
    await wo.setStatus(o.id, 'LISTO', caja);
    await assert.rejects(() => wo.deliver(o.id, { sessionId: session.id, payments: [{ method: 'CASH', amount: 1000 }] }, caja), /Falta cobrar/);
    const stockAntes = await stockDe(papel.id);
    const d: any = await wo.deliver(o.id, { sessionId: session.id, payments: [{ method: 'CASH', amount: 14000 }] }, caja);
    assert.strictEqual(d.status, 'ENTREGADO');
    const venta: any = await prisma.sale.findUnique({ where: { id: d.saleId }, include: { payments: true, items: true } });
    assert.strictEqual(venta.total, 24000);
    assert.deepStrictEqual(venta.payments.map((p: any) => [p.method, p.amount]).sort(), [['CASH', 14000], ['DEBT', 10000]]);
    assert.strictEqual(await stockDe(papel.id), stockAntes - 1, 'el producto del catálogo sale del stock');
    c = await prisma.client.findUnique({ where: { id: o.clientId } });
    assert.strictEqual(c.balance, 0, 'la seña se usó en la venta: no debe ni le deben');
    await assert.rejects(() => wo.save(o.id, { clientId: o.clientId, items: [{ description: 'x', quantity: 1, unitPrice: 1 }] }, caja), /ya se entregó/);
  });

  await t('encargos: roles de la imprenta y lo que autoriza el dueño', async () => {
    const bcrypt = require('bcrypt');
    const { WorkOrdersService } = require('../src/modules/workorders/workorders.service');
    const wo = new WorkOrdersService(prisma, sales, { enqueue: () => {} } as any);
    await prisma.user.update({ where: { id: admin.id }, data: { passwordHash: await bcrypt.hash('clave-del-duenio', 4) } });
    const caja = { sub: cajero.id, role: 'CASHIER', workRole: 'MOSTRADOR' };
    const dueno = { sub: admin.id, role: 'ADMIN' };
    const tallerU = await prisma.user.create({ data: { username: 'TALLER1', passwordHash: 'x', fullName: 'Pedro Taller', role: 'CASHIER', workRole: 'TALLER' } as any });
    const disenoU = await prisma.user.create({ data: { username: 'DISENO1', passwordHash: 'x', fullName: 'Lu Diseño', role: 'CASHIER', workRole: 'DISENO' } as any });
    const taller = { sub: tallerU.id, role: 'CASHIER', workRole: 'TALLER' };
    const diseno = { sub: disenoU.id, role: 'CASHIER', workRole: 'DISENO' };
    const item = { description: 'Banner', specs: '1x2 m', quantity: 1, unitPrice: 5000 };
    const o: any = await wo.save('wo-rol-0001', { clientName: 'Cliente Roles', clientPhone: '2215550777', items: [item] }, caja);
    // Taller y Diseño: no atienden, no ven precios, sí mueven el estado
    await assert.rejects(() => wo.save('wo-rol-0002', { clientName: 'X', items: [item] }, taller), /mostrador o el dueño/);
    await assert.rejects(() => wo.collect(o.id, { amount: 100, sessionId: session.id, key: 'r1' }, diseno), /mostrador o el dueño/);
    await assert.rejects(() => wo.deliver(o.id, { sessionId: session.id, payments: [] }, taller), /mostrador o el dueño/);
    await assert.rejects(() => wo.cancel(o.id, {}, taller), /mostrador o el dueño/);
    const visto: any = await wo.findForUser(o.id, taller);
    assert.strictEqual(visto.total, null, 'el taller no ve el total');
    assert.strictEqual(visto.items[0].unitPrice, null, 'ni los precios');
    assert.ok((await wo.list({}, diseno)).every((x: any) => x.total === null && x.deposit === null));
    const st: any = await wo.setStatus(o.id, 'EN_PROCESO', taller);
    assert.strictEqual(st.status, 'EN_PROCESO');
    // Notas: Diseño sí, Taller no
    await assert.rejects(() => wo.updateNotes(o.id, { notes: 'x' }, taller), /diseño/);
    const n: any = await wo.updateNotes(o.id, { notes: 'Usar logo nuevo', specs: { [o.items[0].id]: '1x2 m, lona front' } }, diseno);
    assert.strictEqual(n.notes, 'Usar logo nuevo');
    assert.strictEqual(n.items[0].specs, '1x2 m, lona front');
    // Con seña: cambiar el total o cancelar pide la clave del dueño
    await wo.collect(o.id, { amount: 2000, method: 'CASH', sessionId: session.id, key: 'r2' }, caja);
    const masBarato = { clientId: o.clientId, items: [{ ...item, unitPrice: 4000 }] };
    await assert.rejects(() => wo.save(o.id, masBarato, caja), (e: any) => e.getResponse?.().needsAdmin === true);
    await assert.rejects(() => wo.save(o.id, { ...masBarato, adminPassword: 'mal' }, caja), /no es correcta/);
    const editado: any = await wo.save(o.id, { ...masBarato, adminPassword: 'clave-del-duenio' }, caja);
    assert.strictEqual(editado.total, 4000);
    // Sin cambiar el total, editar no pide clave
    await wo.save(o.id, { ...masBarato, notes: 'otra nota' }, caja);
    await assert.rejects(() => wo.cancel(o.id, {}, caja), (e: any) => e.getResponse?.().needsAdmin === true);
    const cancelado: any = await wo.cancel(o.id, {}, dueno);
    assert.strictEqual(cancelado.status, 'CANCELADO', 'el dueño cancela sin clave');
    // Sin seña, el mostrador cancela solo
    const libre: any = await wo.save('wo-rol-0003', { clientName: 'Sin seña', items: [item] }, caja);
    assert.strictEqual((await wo.cancel(libre.id, {}, caja)).status, 'CANCELADO');
    // Quién hizo cada cosa
    const h: any = await wo.findForUser(o.id, dueno);
    const acciones = h.history.map((x: any) => `${x.action}:${x.who}`);
    for (const a of ['CREATE:Mica', 'STATUS:Pedro Taller', 'NOTES:Lu Diseño', 'COLLECT:Mica', 'EDIT:Mica', 'CANCEL:Dueño']) assert.ok(acciones.includes(a), `historial con ${a}: ${acciones}`);
    assert.ok(h.history.some((x: any) => x.action === 'EDIT' && x.byOwner), 'queda anotado que se usó la clave del dueño');
    const hTaller: any = await wo.findForUser(o.id, taller);
    assert.ok(hTaller.history.every((x: any) => !/\d{3}/.test(String(x.detail || ''))), 'el taller no ve importes en el historial');
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

  await t('boletas por foto: varios comprobantes en las mismas fotos salen por separado (y el remito nunca se carga solo)', async () => {
    const { ProductMatcherService } = require('../src/modules/ai/product-matcher.service');
    const doc = (o: any) => ({ supplierName: '', supplierCuit: '', invoiceNumber: '', date: '2026-11-11', totalFacturaAPagar: '', subtotalNeto: '', docType: 'factura', items: [], ...o });
    const line = (name: string, qty: number, total: string, sku = '') => ({ sku, barcode: '', name, packageQuantity: qty, unitsPerPack: 1, total });
    const calls: any[] = [];
    const fakeAi: any = {
      shrink: async (files: any[]) => files.map(() => ({ data: 'x', mediaType: 'image/jpeg' })),
      call: async (kind: string, body: any) => {
        calls.push({ kind, body });
        if (kind === 'match') return { result: { matches: [] } };
        return { result: { failedImages: [], documents: [
          { ...doc({ supplierName: 'BEBIDAS PRUEBA SA', supplierCuit: '30-22222222-2', invoiceNumber: '0001-00000100', totalFacturaAPagar: '1.452,00', items: [line('GASEOSA PRUEBA 2500', 3, '900,00', 'G25'), line('VASO PRUEBA', 1, '300,00', 'V1')] }), images: [0], closes: true },
          { ...doc({ supplierName: 'BEBIDAS PRUEBA SA', supplierCuit: '30-22222222-2', invoiceNumber: '0002-00000555', docType: 'remito', totalFacturaAPagar: '0,00', items: [line('ENERGIZANTE PRUEBA', 1, '4.132,76', 'E1')] }), images: [1], closes: null },
          { ...doc({ supplierName: 'PANIFICADORA PRUEBA', invoiceNumber: '0002-00019258', docType: 'nota', totalFacturaAPagar: '2.200,00', items: [line('PAN PRUEBA X6', 2, '2.200,00', 'P6')] }), images: [2], closes: true, reread: true },
        ] } };
      },
    };
    const matcher = new ProductMatcherService(prisma, fakeAi);
    const svc = new PurchasesService(prisma, mute(), fakeAi, matcher);
    const file = (n: string) => ({ buffer: Buffer.from('x'), size: 1, mimetype: 'image/jpeg', originalname: n }) as any;

    // En la PC (vista previa): el primero para revisar ahí y los otros dos aparte, sin guardar nada
    const before = await (prisma as any).purchase.count();
    const r = await svc.scanInvoice([file('a.jpg'), file('b.jpg'), file('c.jpg')], undefined, admin.id, { inline: true });
    assert.strictEqual(calls.find((c) => c.kind === 'invoice').body.multi, true, 'pide una lectura por foto');
    assert.strictEqual(r.documentsFound, 3);
    assert.strictEqual(r.status, 'INLINE');
    assert.strictEqual(r.items.length, 2);
    assert.deepStrictEqual(r.images, [0]);
    assert.deepStrictEqual(r.others.map((o: any) => [o.invoiceNumber, o.docType, o.items.length]), [['0002-00000555', 'remito', 1], ['0002-00019258', 'nota', 1]]);
    assert.strictEqual(r.others[1].reread, true);
    assert.strictEqual(await (prisma as any).purchase.count(), before, 'la vista previa no guarda nada');

    // Los otros quedan para revisar (lo que hace la PC con "Por revisar"); el mismo comprobante dos veces, no
    const p1 = await svc.pendingFromPreview(r.others[1], admin.id, 'fotos');
    assert.strictEqual(p1.status, 'PENDING');
    const row = await (prisma as any).purchase.findUnique({ where: { id: p1.purchaseId } });
    assert.match(row.notes, /Otro comprobante de las fotos/);
    const pend = (await svc.pending()).find((x: any) => x.id === p1.purchaseId);
    assert.strictEqual(pend.items, 1);
    assert.strictEqual(pend.via, 'scan');
    assert.strictEqual((await svc.pendingFromPreview(r.others[1], admin.id, 'fotos')).status, 'DUPLICATE');

    // Desde el celular con la carga automática prendida: la factura que cierra entra sola, el remito queda para revisar
    await prisma.storeSetting.upsert({ where: { id: 'purchase_auto' }, create: { id: 'purchase_auto', value: JSON.stringify({ enabled: true, keepMargin: true, round: 10 }) }, update: { value: JSON.stringify({ enabled: true, keepMargin: true, round: 10 }) } });
    const m = await svc.scanInvoice([file('a.jpg'), file('b.jpg'), file('c.jpg')], undefined, admin.id, {});
    const remito = m.others.find((o: any) => o.docType === 'remito');
    assert.strictEqual(remito.status, 'PENDING');
    assert.ok(remito.why.some((w: string) => /es un remito/.test(w)), remito.why.join(' | '));
    await prisma.storeSetting.delete({ where: { id: 'purchase_auto' } }).catch(() => {});
  });

  await t('lectura en segundo plano: foto por foto, hojas juntas, hoja ajena aparte, foto ilegible y todo a "Por revisar"', async () => {
    const { ProductMatcherService } = require('../src/modules/ai/product-matcher.service');
    const { ScanJobsService } = require('../src/modules/purchases/scan-jobs.service');
    // El mismo armado de hojas que la nube (firebase/functions/ai.js), sin IA
    const cloud = require('../../../firebase/functions/ai.js');
    const line = (name: string, qty: number, total: string, extra: any = {}) => ({ sku: '', barcode: '', name, packageQuantity: qty, unitsPerPack: 1, total, unitPrice: '', ...extra });
    const page = (o: any) => ({ supplierName: 'MAYORISTA PRUEBA SA', supplierCuit: '', invoiceNumber: '1124-00000777', date: '2026-10-08', totalFacturaAPagar: '', subtotalNeto: '', ivaTotal: '', otrosImpuestos: '',
      condicionVenta: 'contado', docType: 'factura', pageNumber: 0, pageCount: 0, verified: 'dos lecturas', items: [], ...o });
    const reads: any[] = [
      page({ pageNumber: 1, pageCount: 6, items: [line('GOTITAS PRUEBA 35 G', 12, '3.756,00', { handPrice: '600' })] }),
      page({ pageNumber: 2, pageCount: 6, items: [line('LANA DE ACERO PRUEBA', 5, '5.726,45')] }),
      // La lista de cervezas: tomó el número de la factura de atrás y trae su total
      page({ totalFacturaAPagar: '2.793.498,08', condicionVenta: '', items: [line('CERVEZA PRUEBA LATA X24', 5, '214.500,00')] }),
      { error: 'está muy oscura', unreadable: true, items: [] },
    ];
    const seen: number[] = [];
    const fakeAi: any = {
      shrink: async (files: any[]) => files.map(() => ({ data: 'x', mediaType: 'image/jpeg' })),
      call: async (kind: string, body: any) => {
        if (kind === 'match') return { result: { matches: [] } };
        if (body.stage === 'page') { seen.push(body.index); return { result: { read: { image: body.index, ...reads[body.index] } }, left: 50 }; }
        if (body.stage === 'group') return { result: cloud.finishInvoices(cloud.cleanReads(body.reads)).result, left: 48 };
        throw new Error('no debería leer todo junto');
      },
    };
    const purchases = new PurchasesService(prisma, mute(), fakeAi, new ProductMatcherService(prisma, fakeAi));
    const jobs = new ScanJobsService(fakeAi, purchases);
    const file = (n: string) => ({ buffer: Buffer.from('x'), size: 1, mimetype: 'image/jpeg', originalname: n }) as any;
    const started = jobs.start([file('1.jpg'), file('2.jpg'), file('3.jpg'), file('4.jpg')], admin.id);
    assert.strictEqual(started.total, 4);
    assert.throws(() => jobs.get(started.id, 'otro-usuario'), /ya no está/, 'cada lectura es de quien la empezó');
    let j: any = started;
    for (let k = 0; k < 200 && (j.status === 'reading' || j.status === 'grouping'); k++) { await new Promise((r) => setTimeout(r, 10)); j = jobs.get(started.id, admin.id); }
    assert.strictEqual(j.status, 'done', j.error || '');
    assert.deepStrictEqual([...seen].sort(), [0, 1, 2, 3], 'una lectura por foto');
    assert.strictEqual(j.photos[3].state, 'failed');
    assert.match(j.photos[3].error, /muy oscura.*de nuevo/);
    assert.strictEqual(j.photos[0].found.pageNumber, 1);
    assert.strictEqual(j.documents.length, 2, 'la factura (2 hojas) y la lista aparte');
    const [fact, lista] = j.documents;
    assert.deepStrictEqual(fact.images, [0, 1]);
    assert.ok(fact.why.some((w: string) => /faltan hojas \(3, 4, 5, 6\)/.test(w)), fact.why.join(' | '));
    assert.match(fact.message, /Faltan las hojas 3, 4, 5 y 6 \(de 6\)/);
    assert.ok(lista.why.some((w: string) => /otra factura de atrás/.test(w)), lista.why.join(' | '));
    assert.strictEqual(lista.invoiceNumber, '');
    assert.strictEqual(jobs.latest(admin.id).id, started.id);
    // Quedan en "Por revisar" con lo leído: precio anotado a mano y contado
    const rows = await purchases.findByIds([lista.purchaseId, fact.purchaseId]);
    assert.deepStrictEqual(rows.map((r: any) => r.id), [lista.purchaseId, fact.purchaseId], 'en el orden pedido');
    assert.ok(rows.every((r: any) => r.status === 'PENDING'));
    const d = rows[1].draft;
    assert.strictEqual(d.items.find((i: any) => /GOTITAS/.test(i.name)).suggestedSalePrice, 600, 'manda el precio escrito a mano');
    assert.strictEqual(d.paymentSuggested, 'PAID');
    assert.deepStrictEqual(d.missingPageNumbers, [3, 4, 5, 6]);
  });

  await t('al confirmar una boleta corregida, las diferencias van a la nube para aprender del proveedor', async () => {
    const { ProductMatcherService } = require('../src/modules/ai/product-matcher.service');
    const calls: any[] = [];
    const fakeAi: any = { call: async (kind: string, body: any) => { calls.push({ kind, body }); return { result: { matches: [] } }; } };
    const svc = new PurchasesService(prisma, mute(), fakeAi, new ProductMatcherService(prisma, fakeAi));
    const draft = { supplierCuit: '30-44444444-4', supplierName: 'MAYORISTA PRUEBA', items: [
      { name: 'GOTITAS PRUEBA 35 G', quantity: 1, cost: 3756 },
      { name: 'LANA DE ACERO PRUEBA', quantity: 5, cost: 1145.29 },
      { name: 'PROMOCION 181820', quantity: 1, cost: 378.73 },
    ] };
    const diffs = svc.correctionsOf(draft, [
      { quantity: 12, cost: 313, source: { name: 'GOTITAS PRUEBA 35 G' } },
      { quantity: 5, cost: 1150, source: { name: 'LANA DE ACERO PRUEBA' } }, // menos de 3%: decisión del dueño, no error
    ]);
    assert.deepStrictEqual(diffs.map((d: any) => d.renglon), ['GOTITAS PRUEBA 35 G', 'PROMOCION 181820']);
    assert.match(diffs[0].corregido, /cantidad x12/);
    assert.match(diffs[1].corregido, /sacó este renglón/);
    // Confirmar de verdad: la compra se carga y, aparte, se manda lo aprendido
    const sup = await prisma.supplier.create({ data: { name: 'MAYORISTA PRUEBA' } });
    const p = await svc.pendingFromPreview({ ...draft, matchedSupplier: { id: sup.id, name: sup.name }, items: draft.items.map((i) => ({ ...i, total: i.quantity * i.cost })) }, admin.id, 'fotos');
    const prod = await prisma.product.findFirst({ where: { isActive: true } });
    await svc.confirmPending(p.purchaseId, { supplierId: sup.id, userId: admin.id, paymentStatus: 'PAID', items: [{ productId: prod!.id, quantity: 12, cost: 313, source: { name: 'GOTITAS PRUEBA 35 G' } }] } as any);
    await new Promise((r) => setTimeout(r, 50));
    const lesson = calls.find((c) => c.kind === 'lesson');
    assert.ok(lesson, 'mandó las correcciones');
    assert.strictEqual(lesson.body.supplierCuit, '30444444444');
    assert.strictEqual(lesson.body.diffs.length, 3);
  });

  await t('boletas reales: bultos en el nombre, renglones en $0, remito sin deuda y total con percepciones', async () => {
    const { unitsInName } = require('../src/modules/purchases/purchases.service');
    // Cómo escriben los bultos las distribuidoras (y lo que NO es un bulto)
    assert.deepStrictEqual(['COCA-COLA 600*12 PET', 'COCA-COLA 1000*08 VR', 'MONSTER ENERGY GREEN 473ML*6L', 'COCA-COLA 2500*8 RPET', 'Albertus Viena X6', 'Albertus Lactal Blanco X350gr', 'VASO XMAS COCA-COLA X12U', 'CERVEZA ANDES 500CC X 24'].map(unitsInName), [12, 8, 6, 8, 0, 0, 0, 0]);
    const { ProductMatcherService } = require('../src/modules/ai/product-matcher.service');
    const line = (name: string, qty: number, total: string, sku = '') => ({ sku, barcode: '', name, packageQuantity: qty, unitsPerPack: 1, total });
    const fakeAi: any = {
      shrink: async (files: any[]) => files.map(() => ({ data: 'x', mediaType: 'image/jpeg' })),
      call: async (kind: string) => kind === 'match' ? { result: { matches: [] } } : { result: { failedImages: [], documents: [
        { supplierName: 'GASEOSAS PRUEBA SA', supplierCuit: '30-33333333-3', invoiceNumber: '5623-00000001', date: '2026-11-11', docType: 'factura', images: [0], closes: true,
          subtotalNeto: '110.054,40', totalFacturaAPagar: '139.896,67',
          items: [line('GASEOSA PRUEBA 600*12 PET', 2, '44.000,12', '120'), line('VASO PRUEBA X12U', 1, '49.200,00', '8511'), line('PEDIDO AC DIGITAL', 3, '0,00', '9930')] },
        { supplierName: 'GASEOSAS PRUEBA SA', supplierCuit: '30-33333333-3', invoiceNumber: '6246-00000002', date: '2026-11-11', docType: 'remito', images: [1], closes: null,
          totalFacturaAPagar: '0,00', subtotalNeto: '0,00', items: [line('ENERGIZANTE PRUEBA 473ML*6L', 0.33, '4.132,76', '3860')] },
      ] } },
    };
    const svc = new PurchasesService(prisma, mute(), fakeAi, new ProductMatcherService(prisma, fakeAi));
    const file = (n: string) => ({ buffer: Buffer.from('x'), size: 1, mimetype: 'image/jpeg', originalname: n }) as any;
    const r = await svc.scanInvoice([file('a.jpg'), file('b.jpg')], undefined, admin.id, { inline: true });
    // "PEDIDO AC DIGITAL" en $0 no es mercadería: no se ofrece para crear, pero se avisa
    assert.deepStrictEqual(r.items.map((i: any) => i.name), ['GASEOSA PRUEBA 600*12 PET', 'VASO PRUEBA X12U']);
    assert.deepStrictEqual(r.skippedLines, ['PEDIDO AC DIGITAL']);
    // 2 bultos de 12 = 24 botellas, con el costo por botella
    const g = r.items[0];
    assert.strictEqual(g.quantity, 24);
    assert.strictEqual(g.packFromName, 12);
    assert.ok(Math.abs(g.cost * 24 - g.total) < 0.5, 'el total del renglón no cambia: ' + g.cost * 24 + ' vs ' + g.total);
    assert.strictEqual(r.items[1].quantity, 1, 'X12U es la presentación del vaso, no un bulto');
    assert.strictEqual(r.printedTotal, 139896.67, 'el total a pagar, con la percepción');
    // El remito: 0,33 bultos de 6 = 2 latas, y como pendiente no deja deuda
    const rem = r.others[0];
    assert.strictEqual(Math.round(rem.items[0].quantity), 2);
    assert.strictEqual(rem.printedTotal, 0);
    const pr = await svc.pendingFromPreview(rem, admin.id, 'fotos');
    const row = await (prisma as any).purchase.findUnique({ where: { id: pr.purchaseId } });
    assert.strictEqual(row.total, 0, 'un remito en $0 no es deuda');
    const draft = JSON.parse((await prisma.$queryRawUnsafe<any[]>('SELECT draft FROM purchases WHERE id = ?', pr.purchaseId))[0].draft);
    assert.ok(draft.why.some((w: string) => /remito/.test(w)), draft.why.join(' | '));
    const pf = await svc.pendingFromPreview(r, admin.id, 'fotos');
    assert.strictEqual((await (prisma as any).purchase.findUnique({ where: { id: pf.purchaseId } })).total, 139896.67);
    // Las pendientes no son deuda ni gasto todavía
    const dash: any = await sales.getTodaySummary();
    assert.ok(dash.totalSupplierDebt < 139896, 'la boleta sin confirmar no suma a la deuda: ' + dash.totalSupplierDebt);
  });

  await t('descuento "15%" de un solo producto: baja el costo de ese producto, no el de todos (Vital)', async () => {
    const { ProductMatcherService } = require('../src/modules/ai/product-matcher.service');
    const line = (name: string, qty: number, total: string) => ({ sku: '', barcode: '', name, packageQuantity: qty, quantity: qty, unitsPerPack: 1, total });
    const fakeAi: any = {
      shrink: async (files: any[]) => files.map(() => ({ data: 'x', mediaType: 'image/jpeg' })),
      call: async (kind: string) => kind === 'match' ? { result: { matches: [] } } : { result: { failedImages: [], documents: [
        { supplierName: 'SUPERMAYORISTA PRUEBA', invoiceNumber: '00984-00000001', date: '2026-10-08', docType: 'factura', images: [0], closes: true,
          ivaTotal: '12.047,22', totalFacturaAPagar: '73.430,67', otrosImpuestos: '4.015,74',
          items: [line('DURAZNO MITAD X820G', 6, '11.400,00'), line('JABON LIQ X800ML', 4, '10.905,80'), line('LUSTRAMUEBLES X360ML', 3, '12.979,35'),
            line('PAPEL ALUMINIO 28CM', 4, '9.451,24'), line('PROT COLALESS X20U', 10, '8.917,40'), line('PROT MULTIESTILO X20U', 6, '4.953,72'),
            line('TOA NOCTURNA X8U', 3, '2.342,97'), line('LIMPIEZA DEL HOGAR 15%', 4, '-1.635,87'), line('LIMPIEZA DEL HOGAR 15%', 3, '-1.946,90')] },
      ] } },
    };
    const svc = new PurchasesService(prisma, mute(), fakeAi, new ProductMatcherService(prisma, fakeAi));
    const r = await svc.scanInvoice([{ buffer: Buffer.from('x'), size: 1, mimetype: 'image/jpeg', originalname: 'v.jpg' } as any], undefined, admin.id, { inline: true });
    const by = (n: string) => r.items.find((i: any) => i.name.startsWith(n));
    assert.strictEqual(by('DURAZNO').cost, 1900, 'el durazno no tenía descuento');
    assert.ok(Math.abs(by('JABON').cost - 2317.48) < 0.02, 'jabón con el 15%: ' + by('JABON').cost);
    assert.ok(Math.abs(by('LUSTRAMUEBLES').cost - 3677.48) < 0.02, 'lustramuebles con el 15%: ' + by('LUSTRAMUEBLES').cost);
    assert.strictEqual(r.check?.ok, true, r.check?.message);
  });

  await t('lista "Exento" a la que le falta una hoja: los precios son finales, no se les suma el 21%', async () => {
    const { ProductMatcherService } = require('../src/modules/ai/product-matcher.service');
    const fakeAi: any = {
      shrink: async (files: any[]) => files.map(() => ({ data: 'x', mediaType: 'image/jpeg' })),
      call: async (kind: string) => kind === 'match' ? { result: { matches: [] } } : { result: { failedImages: [], documents: [
        { supplierName: '', invoiceNumber: '', docType: 'nota', images: [0], precios: 'finales', totalFacturaAPagar: '2.793.498,08',
          items: [{ sku: '', barcode: '', name: 'CERVEZA PRUEBA 500CC LATA', packageQuantity: 15, unitsPerPack: 1, total: '577.500,00' }] },
      ] } },
    };
    const svc = new PurchasesService(prisma, mute(), fakeAi, new ProductMatcherService(prisma, fakeAi));
    const r = await svc.scanInvoice([{ buffer: Buffer.from('x'), size: 1, mimetype: 'image/jpeg', originalname: 'l.jpg' } as any], undefined, admin.id, { inline: true });
    assert.ok(Math.abs(r.items[0].cost * 1.21 - 38500) < 0.05, 'costo con IVA = lo impreso: ' + r.items[0].cost * 1.21);
    assert.ok(/suman \$ 577\.500 con IVA/.test(r.check?.message || ''), r.check?.message);
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
