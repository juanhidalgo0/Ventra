/**
 * Pruebas de "Aumentar precios" (price-editor.service + las cuentas de la pantalla) sobre una base
 * SQLite temporal. No se conecta a nada: la nube, GoDelivery y los avisos son piezas mudas.
 *
 *   npm run test:precios
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ventra-precios-'));
const DB = path.join(DIR, 'test.db').replace(/\\/g, '/');
process.env.DATABASE_URL = `file:${DB}`;
process.env.VENTRA_SUBSCRIPTION_EXEMPT = 'true';
process.env.VENTRA_FUNCTIONS_URL = 'http://127.0.0.1:9';

execSync('npx prisma db push --skip-generate', { cwd: path.resolve(__dirname, '..'), env: process.env, stdio: 'ignore' });

/* eslint-disable @typescript-eslint/no-var-requires */
const { PrismaService } = require('../src/database/prisma.service');
const { PriceEditorService } = require('../src/modules/products/price-editor.service');
const M = require('../../frontend/src/components/products/priceEditorMath');

let fallas = 0;
let ok = 0;
const t = async (nombre: string, fn: () => Promise<void> | void) => {
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

  const avisos: any[] = [];
  const subidasGo: string[] = [];
  const events = { emitPricesUpdated: (l: any[]) => avisos.push(l) };
  const firebase = { syncProductToFirestore: async (code: string) => { subidasGo.push(code); } };
  const svc = new PriceEditorService(prisma, events, firebase);

  const admin = await prisma.user.create({ data: { username: 'ADMIN', passwordHash: 'x', fullName: 'Dueño', role: 'ADMIN' } });
  const kento = await prisma.brand.create({ data: { name: 'KENTO' } });
  const otra = await prisma.brand.create({ data: { name: 'LAYS' } });
  const snacks = await prisma.category.create({ data: { name: 'SNACKS' } });
  const papas = await prisma.category.create({ data: { name: 'PAPAS', parentCategoryId: snacks.id } });
  const bebidas = await prisma.category.create({ data: { name: 'BEBIDAS' } });
  const prov = await prisma.supplier.create({ data: { name: 'DISTRI SUR' } });

  const nuevo = (name: string, extra: any = {}) => prisma.product.create({ data: { name, salePrice: 1000, costPrice: 600, ...extra } });
  const p1 = await nuevo('PAPAS KENTO 200G', { brandId: kento.id, categoryId: papas.id, supplierId: prov.id, salePrice: 2500, costPrice: 1500, wholesalePrice: 2200, packPrice: 26000, unitsPerPack: 12 });
  const p2 = await nuevo('PAPAS KENTO 80G', { brandId: kento.id, categoryId: papas.id, salePrice: 1100, costPrice: 650 });
  const p3 = await nuevo('PALITOS KENTO 150G', { brandId: kento.id, categoryId: snacks.id, salePrice: 1800, costPrice: 1000 });
  await nuevo('PAPAS LAYS 100G', { brandId: otra.id, categoryId: papas.id });
  await nuevo('COCA COLA 2L', { categoryId: bebidas.id });
  await nuevo('PAPAS KENTO VIEJA', { brandId: kento.id, isActive: false });

  const precio = async (id: string) => prisma.product.findUnique({ where: { id }, select: { salePrice: true, costPrice: true, wholesalePrice: true, packPrice: true, tradePrice: true } });

  // ─── Búsqueda
  await t('filtros combinados: marca + categoría (incluye subcategorías)', async () => {
    const r = await svc.search({ brandId: kento.id, categoryId: snacks.id });
    assert.deepStrictEqual(r.products.map((p: any) => p.name), ['PALITOS KENTO 150G', 'PAPAS KENTO 200G', 'PAPAS KENTO 80G']);
  });
  await t('buscador por varias palabras + marca; no trae inactivos', async () => {
    const r = await svc.search({ search: 'papas kento', brandId: kento.id });
    assert.deepStrictEqual(r.products.map((p: any) => p.name), ['PAPAS KENTO 200G', 'PAPAS KENTO 80G']);
  });
  await t('proveedor y "sin proveedor"', async () => {
    assert.strictEqual((await svc.search({ supplierId: prov.id })).products.length, 1);
    assert.strictEqual((await svc.search({ supplierId: 'none', brandId: kento.id })).products.length, 2);
  });
  await t('la búsqueda trae los precios opcionales y las unidades del bulto', async () => {
    const r = await svc.search({ search: '200G' });
    const p = r.products[0];
    assert.deepStrictEqual([p.wholesalePrice, p.packPrice, p.unitsPerPack, p.tradePrice], [2200, 26000, 12, null]);
  });

  // ─── Cuentas de la pantalla
  const base = (await svc.search({ search: '200G' })).products[0];
  await t('cuentas: +12 % en venta con redondeo a $10 hacia arriba', () => {
    assert.deepStrictEqual(M.adjust(base, { direction: 'up', mode: 'pct', value: 12, fields: ['salePrice'], round: 10 }), { salePrice: 2800 });
    assert.deepStrictEqual(M.adjust(base, { direction: 'up', mode: 'pct', value: 10, fields: ['salePrice'], round: 100 }), { salePrice: 2800 });
  });
  await t('cuentas: el costo nunca se redondea', () => {
    assert.deepStrictEqual(M.adjust(base, { direction: 'up', mode: 'pct', value: 7, fields: ['costPrice'], round: 100 }), { costPrice: 1605 });
  });
  await t('cuentas: monto fijo es por unidad; el bulto suma por sus unidades', () => {
    assert.deepStrictEqual(M.adjust(base, { direction: 'up', mode: 'amount', value: 100, fields: ['salePrice', 'packPrice'], round: 0 }), { salePrice: 2600, packPrice: 27200 });
  });
  await t('cuentas: precios que el producto no tiene no se inventan', () => {
    assert.deepStrictEqual(M.adjust(base, { direction: 'down', mode: 'pct', value: 10, fields: ['tradePrice'], round: 0 }), {});
  });
  await t('cuentas: costo a mano con "mantener la ganancia" mueve la venta en la misma proporción', () => {
    // costo 1500 → 1620 (+8 %): venta 2500 → 2700, mayorista 2200 → 2376 → 2380, bulto 26000 → 28080
    assert.deepStrictEqual(M.followCost(base, 1620, 10), { costPrice: 1620, salePrice: 2700, wholesalePrice: 2380, packPrice: 28080 });
  });
  await t('cuentas: redondeo sin error de coma flotante (2800,0000001 no sube a 2810)', () => {
    assert.strictEqual(M.roundUp(2500 * 1.12, 10), 2800);
  });

  // ─── Guardar
  let batch1 = '';
  await t('guardar: un solo lote, precios nuevos, historial y aviso a las cajas', async () => {
    const r = await svc.apply({ label: 'Kento', items: [
      { id: p1.id, prices: { salePrice: 2800, costPrice: 1680, wholesalePrice: 2470, packPrice: 29120 } },
      { id: p2.id, prices: { salePrice: 1240 } },
      { id: p3.id, prices: { salePrice: 1800 } }, // no cambia: no cuenta
    ] }, admin.id);
    batch1 = r.batchId;
    assert.strictEqual(r.updated, 2);
    assert.deepStrictEqual(await precio(p1.id), { salePrice: 2800, costPrice: 1680, wholesalePrice: 2470, packPrice: 29120, tradePrice: null });
    assert.strictEqual((await precio(p2.id))!.salePrice, 1240);
    const h = await prisma.priceHistory.findMany({ where: { productId: p1.id } });
    assert.deepStrictEqual(h.map((x: any) => [x.oldPrice, x.newPrice]), [[2500, 2800]]);
    assert.strictEqual(avisos.at(-1).length, 2);
    assert.deepStrictEqual(avisos.at(-1).find((a: any) => a.id === p2.id), { id: p2.id, salePrice: 1240 });
  });
  await t('guardar: el trigger anota el precio anterior (etiquetas de precios cambiados)', async () => {
    const rows = await prisma.$queryRawUnsafe(`SELECT CAST(prev_sale_price AS REAL) AS prev FROM products WHERE id = ?`, p1.id);
    assert.strictEqual(Number(rows[0].prev), 2500);
  });
  await t('guardar: avisa a GoDelivery por cada producto que cambió', async () => {
    await new Promise((r) => setTimeout(r, 50));
    assert.ok(subidasGo.includes(p1.id) && subidasGo.includes(p2.id));
  });
  await t('guardar: un precio inválido no guarda NADA (todo o nada)', async () => {
    await assert.rejects(svc.apply({ items: [{ id: p3.id, prices: { salePrice: 1900 } }, { id: p2.id, prices: { salePrice: 0 } }] }, admin.id), /mayor a 0/);
    assert.strictEqual((await precio(p3.id))!.salePrice, 1800);
  });
  await t('guardar: campos desconocidos se ignoran (no se puede tocar el stock por acá)', async () => {
    const r = await svc.apply({ items: [{ id: p3.id, prices: { stock: 999, salePrice: 1890 } as any }] }, admin.id);
    assert.strictEqual(r.updated, 1);
    const p = await prisma.product.findUnique({ where: { id: p3.id } });
    assert.deepStrictEqual([p.stock, p.salePrice], [0, 1890]);
  });

  // ─── Deshacer
  await t('último aumento = el más nuevo sin deshacer', async () => {
    const last = await svc.lastBatch();
    assert.strictEqual(last.count, 1);
    assert.notStrictEqual(last.id, batch1);
  });
  await t('deshacer: vuelve lo de antes, salvo lo que alguien cambió después', async () => {
    // Deshacer el de palitos primero, y después alguien cambia a mano el 80G
    const last = await svc.lastBatch();
    assert.strictEqual((await svc.undo(last.id, admin.id)).restored, 1);
    assert.strictEqual((await precio(p3.id))!.salePrice, 1800);
    await prisma.product.update({ where: { id: p2.id }, data: { salePrice: 1300 } });
    const r = await svc.undo(batch1, admin.id);
    assert.strictEqual(r.restored, 1);
    assert.deepStrictEqual(r.skipped, ['PAPAS KENTO 80G']);
    assert.deepStrictEqual(await precio(p1.id), { salePrice: 2500, costPrice: 1500, wholesalePrice: 2200, packPrice: 26000, tradePrice: null });
    assert.strictEqual((await precio(p2.id))!.salePrice, 1300, 'el cambio más nuevo se respeta');
  });
  await t('deshacer: no se puede deshacer dos veces y ya no hay "último aumento"', async () => {
    await assert.rejects(svc.undo(batch1, admin.id), /ya se deshizo/);
    assert.strictEqual(await svc.lastBatch(), null);
  });
  await t('deshacer: también queda en el historial de precios', async () => {
    const h = await prisma.priceHistory.findMany({ where: { productId: p1.id }, orderBy: { changedAt: 'asc' } });
    assert.deepStrictEqual(h.map((x: any) => [x.oldPrice, x.newPrice]), [[2500, 2800], [2800, 2500]]);
  });
  await t('"sin aumento hace +30 días" no trae lo que cambió hoy', async () => {
    const r = await svc.search({ brandId: kento.id, staleDays: 30 });
    assert.ok(!r.products.some((p: any) => p.id === p1.id));
  });

  await new Promise((r) => setTimeout(r, 100));
  await prisma.$disconnect();
  fs.rmSync(DIR, { recursive: true, force: true });
  console.log(`\n${ok} bien, ${fallas} con falla`);
  process.exit(fallas ? 1 : 0);
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
