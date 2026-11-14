/**
 * Packs (pack de 6 latas = kit de una pieza): el stock se cuenta en latas, el del pack es lo que
 * alcanza, el costo del pack sigue al de la lata, el precio del pack es aparte y una compra de
 * packs entra como latas. Servicios reales sobre una base SQLite temporal, sin nube.
 *
 *   npm run test:packs
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ventra-packs-'));
const DB = path.join(DIR, 'test.db').replace(/\\/g, '/');
process.env.DATABASE_URL = `file:${DB}`;
process.env.VENTRA_SUBSCRIPTION_EXEMPT = 'true';
process.env.VENTRA_FUNCTIONS_URL = 'http://127.0.0.1:9';

execSync('npx prisma db push --skip-generate', { cwd: path.resolve(__dirname, '..'), env: process.env, stdio: 'ignore' });

/* eslint-disable @typescript-eslint/no-var-requires */
const { PrismaService } = require('../src/database/prisma.service');
const { SalesService } = require('../src/modules/sales/sales.service');
const { ProductsService } = require('../src/modules/products/products.service');
const { PurchasesService } = require('../src/modules/purchases/purchases.service');
const { CashRegisterService } = require('../src/modules/cash-register/cash-register.service');
const { kitStockFrom } = require('../src/modules/products/kit-stock');

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
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT)`);
  const events = mute();
  const firebase = mute();
  const notify = mute();
  const cash = new CashRegisterService(prisma, events, mute(), notify);
  const sales = new SalesService(prisma, events, firebase, notify, cash, mute());
  const products = new ProductsService(prisma, events, firebase, mute());
  const purchases = new PurchasesService(prisma, firebase);

  const admin = await prisma.user.create({ data: { username: 'ADMIN', passwordHash: 'x', fullName: 'Dueño', role: 'ADMIN' } });
  const cajero = await prisma.user.create({ data: { username: 'MICA', passwordHash: 'x', fullName: 'Mica', role: 'CASHIER' } });
  const session = await cash.open(cajero.id, { terminalName: 'Caja 1', openingAmount: 0 });
  const supplier = await prisma.supplier.create({ data: { name: 'Cervecería' } });

  const stockDe = async (id: string) => (await prisma.product.findUnique({ where: { id } }))!.stock;
  const costoDe = async (id: string) => (await prisma.product.findUnique({ where: { id } }))!.costPrice;
  const vender = (items: { productId: string; quantity: number; price: number }[]) =>
    sales.create(cajero.id, { sessionId: session.id, items, payments: [{ method: 'CASH', amount: items.reduce((s, i) => s + i.price * i.quantity, 0) }] });

  /** Lata + pack de 6 creado como lo crea la ficha ("También se vende en pack") */
  const lataYPack = async (nombre: string, latas: number) => {
    const lata = await prisma.product.create({ data: { name: `${nombre} LATA`, salePrice: 1800, costPrice: 1000, stock: latas, minStock: 12 } });
    const pack = await products.create({ name: `PACK ${nombre} X6`, barcode: `77${Math.floor(Math.random() * 1e10)}`, salePrice: 9000, costPrice: 0, stock: 0, isKit: true, kitItems: [{ childProductId: lata.id, quantity: 6 }] });
    return { lata, pack };
  };

  await t('cuántos packs alcanzan: redondea para abajo y nunca es negativo', async () => {
    assert.strictEqual(kitStockFrom([{ childProductId: 'a', quantity: 6, stock: 25, unlimitedStock: false }]), 4);
    assert.strictEqual(kitStockFrom([{ childProductId: 'a', quantity: 6, stock: -3, unlimitedStock: false }]), 0);
    assert.strictEqual(kitStockFrom([{ childProductId: 'a', quantity: 0.5, stock: 1.5, unlimitedStock: false }]), 3);
    assert.strictEqual(kitStockFrom([{ childProductId: 'a', quantity: 6, stock: 0, unlimitedStock: true }]), null);
    // Combo de dos piezas: manda la que alcanza para menos
    assert.strictEqual(kitStockFrom([
      { childProductId: 'a', quantity: 1, stock: 10, unlimitedStock: false },
      { childProductId: 'b', quantity: 2, stock: 5, unlimitedStock: false },
    ]), 2);
  });

  await t('el pack muestra lo que alcanza con las latas (caja, inventario, ficha, código y tienda)', async () => {
    const { lata, pack } = await lataYPack('QUILMES', 25);
    const cat = (await products.getPOSCatalog()).products;
    const enCaja = cat.find((p: any) => p.id === pack.id);
    assert.strictEqual(enCaja.stock, 4);
    assert.deepStrictEqual(enCaja.kitItems, [{ childProductId: lata.id, quantity: 6 }]);
    assert.strictEqual(cat.find((p: any) => p.id === lata.id).stock, 25);
    assert.strictEqual((await products.findAll({ search: 'PACK QUILMES' }))[0].stock, 4);
    assert.strictEqual((await products.findById(pack.id)).stock, 4);
    assert.strictEqual((await products.findByBarcode(pack.barcode)).stock, 4);
    assert.strictEqual(pack.stock, 4, 'lo que devuelve el alta');
    await prisma.product.update({ where: { id: pack.id }, data: { showOnline: true } });
    assert.strictEqual((await products.getOnlineSummary()).find((p: any) => p.id === pack.id).stock, 4);
    // La ficha de la lata lista sus packs
    const ficha = await products.findById(lata.id);
    assert.deepStrictEqual(ficha.parentKits.map((k: any) => k.parentProduct.id), [pack.id]);
  });

  await t('vender un pack descuenta 6 latas; vender latas sueltas baja los packs que alcanzan', async () => {
    const { lata, pack } = await lataYPack('BRAHMA', 24);
    await vender([{ productId: pack.id, quantity: 1, price: 9000 }]);
    assert.strictEqual(await stockDe(lata.id), 18);
    assert.strictEqual((await products.findById(pack.id)).stock, 3);
    await vender([{ productId: lata.id, quantity: 1, price: 1800 }]);
    assert.strictEqual(await stockDe(lata.id), 17);
    assert.strictEqual((await products.findById(pack.id)).stock, 2);
    // El precio del pack es el suyo, no 6 × la lata
    const venta = await prisma.saleItem.findFirst({ where: { productId: pack.id } });
    assert.strictEqual(venta.unitPrice, 9000);
  });

  await t('el costo del pack es 6 × el de la lata y la sigue cuando cambia', async () => {
    const { lata, pack } = await lataYPack('STELLA', 12);
    assert.strictEqual(await costoDe(pack.id), 6000);
    await products.update(lata.id, { costPrice: 1250 });
    assert.strictEqual(await costoDe(pack.id), 7500);
    // Lo cambia una boleta: también
    await purchases.create({ supplierId: supplier.id, userId: admin.id, paymentStatus: 'PAID', items: [{ productId: lata.id, quantity: 6, cost: 1000 }] });
    assert.strictEqual(await costoDe(pack.id), Math.round(6 * 1210 * 100) / 100);
    // Y el precio del pack no se tocó
    assert.strictEqual((await prisma.product.findUnique({ where: { id: pack.id } })).salePrice, 9000);
  });

  await t('sin costo cargado en la lata, el pack conserva el suyo', async () => {
    const lata = await prisma.product.create({ data: { name: 'ANDES LATA', salePrice: 1800, costPrice: 0, stock: 6 } });
    const pack = await products.create({ name: 'PACK ANDES X6', salePrice: 9000, costPrice: 5000, isKit: true, kitItems: [{ childProductId: lata.id, quantity: 6 }] });
    assert.strictEqual(await costoDe(pack.id), 5000);
  });

  await t('comprar packs suma latas (2 packs a $6.000 = 12 latas a $1.000)', async () => {
    const { lata, pack } = await lataYPack('HEINEKEN', 0);
    const c = await purchases.create({ supplierId: supplier.id, userId: admin.id, paymentStatus: 'PAID', items: [{ productId: pack.id, quantity: 2, cost: 6000, salePrice: 9500 }] });
    assert.strictEqual(await stockDe(lata.id), 12);
    assert.strictEqual(await stockDe(pack.id), 0, 'el pack no tiene stock propio');
    assert.strictEqual(await costoDe(lata.id), 1210, 'costo de la lata con IVA');
    assert.strictEqual(await costoDe(pack.id), 7260, 'el pack sigue a la lata');
    // El precio elegido en la boleta era el del pack: no se le pone a la lata
    assert.notStrictEqual((await prisma.product.findUnique({ where: { id: lata.id } })).salePrice, 9500);
    const item = await prisma.purchaseItem.findFirst({ where: { purchaseId: c.id } });
    assert.deepStrictEqual([item.productId, item.quantity], [lata.id, 12]);
    // Borrar la compra devuelve las latas
    await purchases.deleteOne(c.id);
    assert.strictEqual(await stockDe(lata.id), 0);
  });

  await t('el stock del pack no se ajusta a mano: se ajustan las latas', async () => {
    const { lata, pack } = await lataYPack('IMPERIAL', 10);
    await assert.rejects(() => products.addMovement(pack.id, { type: 'ENTRY', quantity: 5, reason: 'x', userId: admin.id }), /piezas/);
    // Guardar la ficha del pack con un número de stock no cambia nada
    await products.update(pack.id, { stock: 50, stockBase: 1, salePrice: 9200 }, admin.id);
    assert.strictEqual(await stockDe(pack.id), 0);
    assert.strictEqual(await stockDe(lata.id), 10);
    assert.strictEqual((await prisma.product.findUnique({ where: { id: pack.id } })).salePrice, 9200);
  });

  await t('guardar el pack desde la lista (sin las piezas) no le borra las latas', async () => {
    const { lata, pack } = await lataYPack('PATAGONIA', 12);
    // Así guarda la ficha abierta desde Inventario: isKit true y la lista de piezas vacía
    await products.update(pack.id, { isKit: true, kitItems: [], salePrice: 9900 }, admin.id);
    const piezas = await prisma.productKitItem.findMany({ where: { parentProductId: pack.id } });
    assert.deepStrictEqual(piezas.map((k: any) => [k.childProductId, k.quantity]), [[lata.id, 6]]);
    // Destildar "es un kit" sí lo vuelve un producto común
    await products.update(pack.id, { isKit: false, kitItems: [] }, admin.id);
    assert.strictEqual(await prisma.productKitItem.count({ where: { parentProductId: pack.id } }), 0);
  });

  await t('los packs no aparecen en "stock bajo" ni se borran con "sin stock"', async () => {
    const { lata, pack } = await lataYPack('SCHNEIDER', 3);
    const bajos = (await products.getLowStockIds()).map((r: any) => r.id);
    assert.ok(bajos.includes(lata.id), 'la lata sí avisa');
    assert.ok(!bajos.includes(pack.id), 'el pack no');
    assert.ok(!(await products.findAll({ lowStock: true })).some((p: any) => p.id === pack.id));
    await products.bulkDeleteZeroNegative(admin.id);
    assert.strictEqual((await prisma.product.findUnique({ where: { id: pack.id } })).isActive, true);
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
