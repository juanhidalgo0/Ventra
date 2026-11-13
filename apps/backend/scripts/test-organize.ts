/**
 * Pruebas de "Organizar automáticamente" (organize.service + organize-match) sobre una base SQLite
 * temporal y con una IA falsa: no se conecta a nada.
 *
 *   npm run test:organizar
 */
import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execSync } from 'child_process';

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ventra-organizar-'));
const DB = path.join(DIR, 'test.db').replace(/\\/g, '/');
process.env.DATABASE_URL = `file:${DB}`;
process.env.VENTRA_SUBSCRIPTION_EXEMPT = 'true';
process.env.VENTRA_FUNCTIONS_URL = 'http://127.0.0.1:9';

execSync('npx prisma db push --skip-generate', { cwd: path.resolve(__dirname, '..'), env: process.env, stdio: 'ignore' });

/* eslint-disable @typescript-eslint/no-var-requires */
const { PrismaService } = require('../src/database/prisma.service');
const { OrganizeService } = require('../src/modules/ai/organize.service');
const M = require('../src/modules/ai/organize-match');

let fallas = 0;
let ok = 0;
const t = async (nombre: string, fn: () => Promise<void> | void) => {
  try { await fn(); ok++; console.log(`ok    ${nombre}`); } catch (e: any) { fallas++; console.log(`FALLA ${nombre}\n      ${e.message}`); }
};

async function main() {
  const prisma = new PrismaService();
  await prisma.onModuleInit();

  // IA falsa: responde según el nombre
  const pedidos: any[] = [];
  const RESP: Record<string, any> = {
    'COCA COLA 2.25': { category: 'Bebidas', subcategory: 'Gaseosas', brand: 'Coca Cola', sure: true },
    'SPRITE 500': { category: 'Bebidas', subcategory: 'gaseosa', brand: 'Sprite', sure: true },
    'ALF JORGITO CHOC': { category: 'Golosinas', subcategory: 'Alfajores', brand: 'JORGITO', sure: true },
    'LECHE SERENISIMA 1L': { category: 'Lácteos', subcategory: '', brand: 'Serenísima', sure: false },
    'JAMON COCIDO X KG': { category: 'Fiambres', subcategory: '', brand: '', sure: true },
    'GALL OREO 118G': { category: 'Galletitas', subcategory: '', brand: 'Oreo', sure: true },
  };
  let falla = false;
  const ai = {
    call: async (kind: string, body: any) => {
      pedidos.push({ kind, body });
      if (falla) throw new Error('sin internet');
      if (body.step === 'plan') return { result: { tree: [{ name: 'Bebidas', subs: ['Gaseosas'] }, { name: 'Golosinas', subs: ['Alfajores'] }] }, left: 100 };
      return { result: { items: body.items.map((x: any, i: number) => ({ i, ...(RESP[x.name] || { category: '', subcategory: '', brand: '', sure: false }) })) }, left: 100 };
    },
  };
  const svc = new OrganizeService(prisma, ai);

  const admin = await prisma.user.create({ data: { username: 'ADMIN', passwordHash: 'x', fullName: 'Dueño', role: 'ADMIN' } });
  const bebidas = await prisma.category.create({ data: { name: 'BEBIDAS' } });
  const gaseosa = await prisma.category.create({ data: { name: 'Gaseosa', parentCategoryId: bebidas.id } });
  const lacteos = await prisma.category.create({ data: { name: 'LACTEOS', isActive: false } });
  const coca = await prisma.brand.create({ data: { name: 'Coca-Cola' } });
  const ls = await prisma.brand.create({ data: { name: 'La Serenísima' } });
  const nuevo = (name: string, extra: any = {}) => prisma.product.create({ data: { name, salePrice: 1000, costPrice: 600, ...extra } });
  const pCoca = await nuevo('COCA COLA 2.25');
  const pSprite = await nuevo('SPRITE 500', { categoryId: gaseosa.id });
  const pAlf = await nuevo('ALF JORGITO CHOC');
  const pLeche = await nuevo('LECHE SERENISIMA 1L');
  const pJamon = await nuevo('JAMON COCIDO X KG');
  const pOreo = await nuevo('GALL OREO 118G', { categoryId: bebidas.id, brandId: coca.id });
  await nuevo('ALFAJOR JORGITO BLANCO');
  await nuevo('COCA VIEJA', { isActive: false });

  // ─── Funciones puras
  await t('claves: plurales, tildes, guiones y artículos', () => {
    assert.strictEqual(M.categoryKey('Gaseosas'), M.categoryKey('gaseosa'));
    assert.strictEqual(M.categoryKey('Lácteos'), M.categoryKey('LACTEO'));
    assert.strictEqual(M.categoryKey('Fiambres'), M.categoryKey('Fiambre'));
    assert.strictEqual(M.categoryKey('Panes'), M.categoryKey('Pan'));
    assert.notStrictEqual(M.categoryKey('Bebidas'), M.categoryKey('Bebidas alcohólicas'));
    assert.strictEqual(M.brandKey('Coca Cola'), M.brandKey('COCA-COLA'));
    assert.strictEqual(M.brandKey('Serenísima'), M.brandKey('La Serenisima'));
  });
  await t('marca dentro del nombre (sin IA), la más larga gana', () => {
    const brands = [{ name: 'Coca-Cola' }, { name: 'Cola' }, { name: 'Jorgito' }, { name: 'La Serenísima' }];
    assert.strictEqual(M.brandInName('GASEOSA COCA COLA 2L', brands)?.name, 'Coca-Cola');
    assert.strictEqual(M.brandInName('ALFAJOR JORGITO BLANCO', brands)?.name, 'Jorgito');
    assert.strictEqual(M.brandInName('LECHE SERENISIMA 1L', brands)?.name, 'La Serenísima');
    assert.strictEqual(M.brandInName('CHOCOLATADA X', brands), null);
  });
  await t('mayoría: al menos 2 y 60 %', () => {
    assert.strictEqual(M.majority(['a', 'a', 'b']), 'a');
    assert.strictEqual(M.majority(['a']), null);
    assert.strictEqual(M.majority(['a', 'a', 'b', 'b']), null);
  });

  // ─── Estado y plan
  await t('estado: cuenta los que no tienen categoría o marca (sin inactivos)', async () => {
    const s = await svc.status();
    assert.deepStrictEqual([s.total, s.noCategory, s.noBrand, s.missing], [7, 5, 6, 6]);
  });
  await t('plan: solo los que faltan; manda muestra y categorías con su padre', async () => {
    const r = await svc.plan({ scope: 'missing', rubro: 'Kiosco' });
    assert.strictEqual(r.ids.length, 6);
    assert.ok(!r.ids.includes(pOreo.id));
    const body = pedidos.at(-1).body;
    assert.ok(body.categories.some((c: any) => c.name === 'Gaseosa' && c.parent === 'BEBIDAS'));
    assert.strictEqual(r.tree[0].name, 'Bebidas');
  });

  // ─── Tanda
  let props: any[] = [];
  await t('tanda: reusa lo que existe y marca lo nuevo', async () => {
    const r = await svc.batch({ ids: [pCoca.id, pSprite.id, pAlf.id, pLeche.id, pJamon.id, pOreo.id], scope: 'missing', tree: [] });
    props = r.proposals;
    const by = (id: string) => props.find((p: any) => p.id === id);
    // "Gaseosas" = la "Gaseosa" que ya existe; "Coca Cola" = "Coca-Cola"
    assert.deepStrictEqual(by(pCoca.id).category, { id: gaseosa.id, name: 'Gaseosa', parent: 'BEBIDAS', isNew: false });
    assert.deepStrictEqual(by(pCoca.id).brand, { id: coca.id, name: 'Coca-Cola', isNew: false });
    // Sprite ya tenía categoría: solo la marca (nueva)
    assert.strictEqual(by(pSprite.id).category, null);
    assert.deepStrictEqual(by(pSprite.id).brand, { id: null, name: 'Sprite', isNew: true });
    assert.deepStrictEqual(by(pAlf.id).category, { id: null, name: 'Alfajores', parent: 'Golosinas', isNew: true });
    assert.deepStrictEqual(by(pLeche.id).brand, { id: ls.id, name: 'La Serenísima', isNew: false });
    assert.strictEqual(by(pLeche.id).category.id, lacteos.id, 'reusa la inactiva en vez de chocar con el nombre');
    assert.strictEqual(by(pLeche.id).sure, false);
    assert.strictEqual(by(pJamon.id).brand, null);
    // Oreo ya tenía las dos cosas: con "solo lo que falta" no se toca
    assert.strictEqual(by(pOreo.id), undefined);
    assert.ok(pedidos.at(-1).body.brands.includes('Coca-Cola'));
  });
  await t('tanda "reorganizar todo": corrige lo que estaba mal', async () => {
    const r = await svc.batch({ ids: [pOreo.id], scope: 'all', tree: [] });
    assert.strictEqual(r.proposals[0].category.name, 'Galletitas');
    assert.strictEqual(r.proposals[0].brand.name, 'Oreo');
    assert.deepStrictEqual(r.proposals[0].before, { category: 'BEBIDAS', brand: 'Coca-Cola' });
  });

  // ─── Guardar y deshacer
  let batchId = '';
  await t('guardar: crea cada categoría y marca nueva una sola vez, en una operación', async () => {
    const items = props.map((p: any) => ({ id: p.id, category: p.category, brand: p.brand }));
    // La misma categoría nueva escrita distinto en dos productos
    items.push({ id: pOreo.id, category: { name: 'FIAMBRE', parent: null }, brand: null });
    const r = await svc.apply({ items }, admin.id);
    batchId = r.batchId;
    assert.strictEqual(r.updated, 6);
    const jamon = await prisma.product.findUnique({ where: { id: pJamon.id }, include: { category: true } });
    assert.strictEqual(jamon.category.name, 'Fiambres');
    assert.strictEqual(await prisma.category.count({ where: { name: { in: ['Fiambres', 'FIAMBRE', 'Fiambre'] } } }), 1);
    const alf = await prisma.product.findUnique({ where: { id: pAlf.id }, include: { category: { include: { parentCategory: true } }, brand: true } });
    assert.strictEqual(alf.category.parentCategory.name, 'Golosinas');
    assert.strictEqual(alf.brand.name, 'JORGITO');
    assert.ok(await prisma.brand.findFirst({ where: { name: 'SPRITE' } }), 'marca nueva en mayúsculas, como las crea la pantalla');
    assert.strictEqual((await prisma.category.findUnique({ where: { id: lacteos.id } })).isActive, true);
    assert.strictEqual((await svc.lastBatch()).count, 6);
  });
  await t('deshacer: vuelve todo, respeta lo cambiado después y borra lo creado vacío', async () => {
    await prisma.product.update({ where: { id: pCoca.id }, data: { categoryId: bebidas.id } });
    const r = await svc.undo(batchId);
    assert.strictEqual(r.restored, 5);
    assert.strictEqual((await prisma.product.findUnique({ where: { id: pOreo.id } })).categoryId, bebidas.id);
    assert.deepStrictEqual(r.skipped, ['COCA COLA 2.25']);
    const alf = await prisma.product.findUnique({ where: { id: pAlf.id } });
    assert.deepStrictEqual([alf.categoryId, alf.brandId], [null, null]);
    assert.strictEqual(await prisma.category.count({ where: { name: { in: ['Golosinas', 'Alfajores', 'Fiambres'] } } }), 0);
    assert.strictEqual(await prisma.brand.count({ where: { name: { in: ['SPRITE', 'JORGITO'] } } }), 0);
    assert.strictEqual((await prisma.category.findUnique({ where: { id: lacteos.id } })).isActive, false);
    // La marca de Coca quedó (la sigue usando)
    assert.strictEqual(await prisma.brand.count({ where: { id: coca.id } }), 1);
    assert.strictEqual(await svc.lastBatch(), null);
    await assert.rejects(() => svc.undo(batchId), /ya se deshizo/);
  });

  // ─── Sugerencia al crear
  await t('sugerencia: sin IA si alcanza (marca en el nombre + productos parecidos)', async () => {
    const jor = await prisma.brand.create({ data: { name: 'Jorgito' } });
    const golosinas = await prisma.category.create({ data: { name: 'Golosinas' } });
    await prisma.product.updateMany({ where: { name: { startsWith: 'ALF' } }, data: { categoryId: golosinas.id, brandId: jor.id } });
    await nuevo('ALFAJOR JORGITO NEGRO', { categoryId: golosinas.id });
    const antes = pedidos.length;
    const r = await svc.suggest('ALFAJOR JORGITO DULCE DE LECHE');
    assert.strictEqual(r.source, 'local');
    assert.strictEqual(r.category.name, 'Golosinas');
    assert.strictEqual(r.brand.name, 'Jorgito');
    assert.strictEqual(pedidos.length, antes, 'no gastó IA');
  });
  await t('sugerencia: si falta algo pregunta a la IA; sin IA no falla', async () => {
    const r = await svc.suggest('GALL OREO 118G');
    assert.strictEqual(r.source, 'ai');
    assert.deepStrictEqual(r.category, { id: null, name: 'Galletitas', parent: null, isNew: true });
    falla = true;
    const r2 = await svc.suggest('PRODUCTO RARO XYZ');
    assert.deepStrictEqual([r2.category, r2.brand, r2.source], [null, null, null]);
    assert.deepStrictEqual(await svc.suggest('ab'), { category: null, brand: null, source: null });
  });

  await prisma.$disconnect();
  try { fs.rmSync(DIR, { recursive: true, force: true }); } catch { /* Windows a veces no suelta el archivo */ }
  console.log(`\n${ok} bien, ${fallas} con falla`);
  process.exit(fallas ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
