import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { AiService } from './ai.service';
import { brandInName, brandKey, categoryKey, majority, nameWords, spreadSample, tidyName } from './organize-match';

/**
 * Organizar automáticamente (Productos → Organizar): la IA (ventraAi, kind "organize") sugiere
 * categoría, subcategoría y marca de cada producto.
 *
 *  1. plan:  arma el árbol de categorías del comercio con una muestra del catálogo (reusa las que hay).
 *  2. batch: de a 100 productos, la sugerencia de cada uno, ya cruzada con lo que existe
 *            ("Gaseosa" y "Gaseosas" son la misma; "Coca Cola" y "Coca-Cola" también).
 *  3. apply: lo que el dueño dejó tildado en la vista previa, en una sola operación, con Deshacer.
 *
 * Nada se crea ni se cambia hasta "apply". Cada guardado queda en organize_batches (se sincroniza
 * sola, como price_batches) con lo de antes y lo que se creó, para poder deshacerlo.
 */

export type OrganizeScope = 'missing' | 'all';
export interface TreeNode { name: string; subs: string[] }
interface CatRow { id: string; name: string; parentCategoryId: string | null; isActive: boolean }
interface CatHit { id: string; name: string; parentId: string | null; parentName: string | null; isActive: boolean }
export interface CatSuggestion { id: string | null; name: string; parent: string | null; isNew: boolean }
export interface BrandSuggestion { id: string | null; name: string; isNew: boolean }

const SKIP_IDS = ['VENTA_RAPIDA', 'SERVICIO', 'PAGO_CTA_CTE'];
const BATCH_MAX = 100;
const APPLY_MAX = 20000;
const PLAN_SAMPLE = 300;
const BRANDS_TO_AI = 1500;
const PALETTE = ['#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981', '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899'];
const colorFor = (name: string) => PALETTE[[...categoryKey(name)].reduce((a, c) => a + c.charCodeAt(0), 0) % PALETTE.length];

/** Índice de categorías por clave (sin tildes ni plurales). Si dos chocan, gana la activa. Pura. */
export function categoryIndex(rows: CatRow[]) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const index = new Map<string, CatHit>();
  for (const r of rows) {
    const key = categoryKey(r.name);
    if (!key) continue;
    const prev = index.get(key);
    if (prev && prev.isActive && !r.isActive) continue;
    const parent = r.parentCategoryId ? byId.get(r.parentCategoryId) : null;
    index.set(key, { id: r.id, name: r.name, parentId: parent?.id || null, parentName: parent?.name || null, isActive: r.isActive });
  }
  return index;
}

/** Lo que sugirió la IA ("Bebidas" › "Gaseosas") cruzado con las categorías que existen. Pura. */
export function resolveCategory(cat: string, sub: string, index: Map<string, CatHit>): CatSuggestion | null {
  const c = String(cat || '').trim();
  const s = String(sub || '').trim();
  if (s) {
    const hit = index.get(categoryKey(s));
    if (hit) return { id: hit.id, name: hit.name, parent: hit.parentName, isNew: false };
    if (!c) return { id: null, name: tidyName(s), parent: null, isNew: true };
    const parent = index.get(categoryKey(c));
    return { id: null, name: tidyName(s), parent: parent ? parent.name : tidyName(c), isNew: true };
  }
  if (!c) return null;
  const hit = index.get(categoryKey(c));
  if (hit) return { id: hit.id, name: hit.name, parent: hit.parentName, isNew: false };
  return { id: null, name: tidyName(c), parent: null, isNew: true };
}

/** La marca que dijo la IA cruzada con las que existen. Pura. */
export function resolveBrand(name: string, index: Map<string, { id: string; name: string }>): BrandSuggestion | null {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 50);
  const key = brandKey(n);
  if (!key || key.length < 2) return null;
  const hit = index.get(key);
  return hit ? { id: hit.id, name: hit.name, isNew: false } : { id: null, name: n, isNew: true };
}

@Injectable()
export class OrganizeService {
  /** Sugerencias al crear un producto: el mismo nombre no vuelve a gastar IA */
  private suggestCache = new Map<string, any>();
  private tableReady = false;

  constructor(private prisma: PrismaService, private ai: AiService) {}

  private async ensureTable() {
    if (this.tableReady) return;
    await this.prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "organize_batches" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "created_at" INTEGER NOT NULL,
      "user_id" TEXT,
      "user_name" TEXT,
      "label" TEXT,
      "count" INTEGER NOT NULL DEFAULT 0,
      "items" TEXT NOT NULL,
      "created" TEXT,
      "undone_at" INTEGER
    );`);
    this.tableReady = true;
  }

  private where(scope: OrganizeScope) {
    const base: any = { isActive: true, id: { notIn: SKIP_IDS } };
    return scope === 'all' ? base : { ...base, OR: [{ categoryId: null }, { brandId: null }] };
  }

  private async categoriesTree(): Promise<TreeNode[]> {
    const cats = await this.prisma.category.findMany({ where: { isActive: true }, select: { id: true, name: true, parentCategoryId: true }, orderBy: { displayOrder: 'asc' } });
    const parents = cats.filter((c) => !c.parentCategoryId);
    return parents.map((p) => ({ name: p.name, subs: cats.filter((c) => c.parentCategoryId === p.id).map((c) => c.name) }));
  }

  private async brandNames(extra: string[] = []): Promise<string[]> {
    const rows = await this.prisma.brand.findMany({ select: { name: true, _count: { select: { products: true } } } });
    rows.sort((a, b) => b._count.products - a._count.products);
    const names = rows.map((r) => r.name);
    const seen = new Set(names.map(brandKey));
    for (const e of extra.slice(0, 300)) { const k = brandKey(e); if (k && !seen.has(k)) { seen.add(k); names.push(String(e).slice(0, 50)); } }
    return names.slice(0, BRANDS_TO_AI);
  }

  private async indexes() {
    const [cats, brands] = await Promise.all([
      this.prisma.category.findMany({ select: { id: true, name: true, parentCategoryId: true, isActive: true } }),
      this.prisma.brand.findMany({ select: { id: true, name: true } }),
    ]);
    const brandIdx = new Map<string, { id: string; name: string }>();
    for (const b of brands) { const k = brandKey(b.name); if (k && !brandIdx.has(k)) brandIdx.set(k, b); }
    return { catIdx: categoryIndex(cats), brandIdx, cats };
  }

  /** Cuántos productos hay para organizar y el último guardado que se puede deshacer */
  async status() {
    const base: any = { isActive: true, id: { notIn: SKIP_IDS } };
    const [total, noCategory, noBrand, missing, categories, brands, last] = await Promise.all([
      this.prisma.product.count({ where: base }),
      this.prisma.product.count({ where: { ...base, categoryId: null } }),
      this.prisma.product.count({ where: { ...base, brandId: null } }),
      this.prisma.product.count({ where: this.where('missing') }),
      this.prisma.category.count({ where: { isActive: true } }),
      this.prisma.brand.count(),
      this.lastBatch(),
    ]);
    return { total, noCategory, noBrand, missing, categories, brands, last };
  }

  /** Paso 1: qué productos se van a ordenar y el árbol de categorías (la IA, con una muestra) */
  async plan(body: { scope?: OrganizeScope; rubro?: string }) {
    const scope: OrganizeScope = body?.scope === 'all' ? 'all' : 'missing';
    const products = await this.prisma.product.findMany({ where: this.where(scope), select: { id: true, name: true }, orderBy: { name: 'asc' } });
    if (!products.length) return { ids: [], tree: await this.categoriesTree(), left: null };
    const cats = await this.prisma.category.findMany({
      where: { isActive: true },
      select: { name: true, parentCategory: { select: { name: true } }, _count: { select: { products: true } } },
    });
    const { result, left, leftToday } = await this.ai.call('organize', {
      step: 'plan',
      rubro: String(body?.rubro || '').slice(0, 80),
      names: spreadSample(products, PLAN_SAMPLE).map((p) => p.name),
      categories: cats.map((c) => ({ name: c.name, parent: c.parentCategory?.name || '', count: c._count.products })),
    }, { timeoutMs: 120_000 });
    const tree: TreeNode[] = Array.isArray(result?.tree) ? result.tree : [];
    return { ids: products.map((p) => p.id), tree: tree.length ? tree : await this.categoriesTree(), left, leftToday };
  }

  /** Paso 2: la sugerencia de hasta 100 productos, cruzada con lo que existe (no guarda nada) */
  async batch(body: { ids?: string[]; tree?: TreeNode[]; scope?: OrganizeScope; rubro?: string; extraBrands?: string[] }) {
    const ids = (Array.isArray(body?.ids) ? body.ids : []).filter((x) => typeof x === 'string').slice(0, BATCH_MAX);
    if (!ids.length) throw new BadRequestException('No hay productos para organizar.');
    const scope: OrganizeScope = body?.scope === 'all' ? 'all' : 'missing';
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true, name: true, categoryId: true, brandId: true, category: { select: { name: true, parentCategory: { select: { name: true } } } }, brand: { select: { name: true } } },
    });
    if (!products.length) return { proposals: [], unchanged: 0, noAnswer: 0, left: null };
    const catLabel = (p: any) => (p.category ? (p.category.parentCategory?.name ? `${p.category.parentCategory.name} › ${p.category.name}` : p.category.name) : null);
    const [brands, { catIdx, brandIdx }] = await Promise.all([this.brandNames(body?.extraBrands || []), this.indexes()]);
    const { result, left, leftToday } = await this.ai.call('organize', {
      step: 'items',
      rubro: String(body?.rubro || '').slice(0, 80),
      tree: Array.isArray(body?.tree) && body.tree.length ? body.tree : await this.categoriesTree(),
      brands,
      items: products.map((p) => ({ name: p.name, category: catLabel(p) || '' })),
    });
    const byI = new Map<number, any>((result?.items || []).map((x: any) => [Number(x.i), x]));
    const proposals: any[] = [];
    let unchanged = 0;
    let noAnswer = 0;
    products.forEach((p, i) => {
      const s = byI.get(i);
      if (!s || (!s.category && !s.brand)) { noAnswer++; return; }
      let category = scope === 'all' || !p.categoryId ? resolveCategory(s.category, s.subcategory, catIdx) : null;
      if (category && category.id && category.id === p.categoryId) category = null;
      let brand = scope === 'all' || !p.brandId ? resolveBrand(s.brand, brandIdx) : null;
      if (brand && brand.id && brand.id === p.brandId) brand = null;
      if (!category && !brand) { unchanged++; return; }
      proposals.push({
        id: p.id, name: p.name, sure: !!s.sure,
        before: { category: catLabel(p), brand: p.brand?.name || null },
        category, brand,
      });
    });
    return { proposals, unchanged, noAnswer, left, leftToday };
  }

  /**
   * Paso 3: guarda lo tildado. Las categorías y marcas nuevas se crean una sola vez aunque vengan
   * escritas distinto ("Gaseosa" / "gaseosas"); todo en una transacción, con lo de antes para Deshacer.
   */
  async apply(body: { items?: { id: string; category?: { name: string; parent?: string | null } | null; brand?: { name: string } | null }[]; label?: string }, userId?: string) {
    await this.ensureTable();
    // Un producto repetido: se juntan sus renglones (lo último manda)
    const merged = new Map<string, { id: string; category?: { name: string; parent?: string | null } | null; brand?: { name: string } | null }>();
    for (const i of Array.isArray(body?.items) ? body.items : []) {
      if (!i || typeof i.id !== 'string') continue;
      const prev = merged.get(i.id) || { id: i.id };
      merged.set(i.id, { id: i.id, category: i.category?.name ? i.category : prev.category, brand: i.brand?.name ? i.brand : prev.brand });
    }
    const items = [...merged.values()].filter((i) => i.category?.name || i.brand?.name);
    if (!items.length) throw new BadRequestException('No hay cambios para guardar.');
    if (items.length > APPLY_MAX) throw new BadRequestException(`Son demasiados productos juntos (máximo ${APPLY_MAX}).`);
    const user = userId ? await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true, username: true } }).catch(() => null) : null;
    const batchId = randomUUID();

    const out = await this.prisma.$transaction(async (tx) => {
      const { catIdx, brandIdx } = await this.indexes();
      const created = { categories: [] as string[], brands: [] as string[], reactivated: [] as string[] };

      const ensureCategory = async (name: string, parentName: string | null): Promise<string | null> => {
        const key = categoryKey(name);
        if (!key) return null;
        const hit = catIdx.get(key);
        if (hit) {
          if (!hit.isActive) {
            await tx.category.update({ where: { id: hit.id }, data: { isActive: true } });
            hit.isActive = true; created.reactivated.push(hit.id);
          }
          return hit.id;
        }
        const parentId = parentName && categoryKey(parentName) !== key ? await ensureCategory(parentName, null) : null;
        const parent = parentId ? [...catIdx.values()].find((c) => c.id === parentId) : null;
        const clean = tidyName(name);
        const row = await tx.category.create({ data: { name: clean, parentCategoryId: parentId, color: colorFor(parent?.name || clean) } });
        catIdx.set(key, { id: row.id, name: row.name, parentId, parentName: parent?.name || null, isActive: true });
        created.categories.push(row.id);
        return row.id;
      };
      const ensureBrand = async (name: string): Promise<string | null> => {
        const key = brandKey(name);
        if (!key) return null;
        const hit = brandIdx.get(key);
        if (hit) return hit.id;
        // En mayúsculas, como las crea la pantalla de marcas (POST /brands)
        const row = await tx.brand.create({ data: { name: String(name).replace(/\s+/g, ' ').trim().slice(0, 50).toUpperCase() } });
        brandIdx.set(key, row);
        created.brands.push(row.id);
        return row.id;
      };

      const current = await tx.product.findMany({ where: { id: { in: items.map((i) => i.id) }, isActive: true }, select: { id: true, name: true, categoryId: true, brandId: true } });
      const byId = new Map(current.map((p) => [p.id, p]));
      const changes: { id: string; name: string; old: any; new: any }[] = [];
      for (const it of items) {
        const p = byId.get(it.id);
        if (!p) continue;
        const next: any = {}; const old: any = {};
        if (it.category?.name) {
          const cid = await ensureCategory(it.category.name, it.category.parent || null);
          if (cid && cid !== p.categoryId) { next.categoryId = cid; old.categoryId = p.categoryId; }
        }
        if (it.brand?.name) {
          const bid = await ensureBrand(it.brand.name);
          if (bid && bid !== p.brandId) { next.brandId = bid; old.brandId = p.brandId; }
        }
        if (Object.keys(next).length) changes.push({ id: p.id, name: p.name, old, new: next });
      }
      for (const c of changes) await tx.product.update({ where: { id: c.id }, data: c.new });
      if (changes.length) {
        const label = String(body?.label || '').trim().slice(0, 200) || `${changes.length} productos organizados`;
        await tx.$executeRawUnsafe(
          `INSERT INTO organize_batches (id, created_at, user_id, user_name, label, count, items, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          batchId, Date.now(), userId || null, user?.fullName || user?.username || null, label, changes.length, JSON.stringify(changes), JSON.stringify(created),
        );
      }
      return { changes, created };
    }, { timeout: 180_000, maxWait: 20_000 });

    return {
      batchId: out.changes.length ? batchId : null,
      updated: out.changes.length,
      newCategories: out.created.categories.length,
      newBrands: out.created.brands.length,
    };
  }

  async lastBatch() {
    await this.ensureTable();
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, CAST(created_at AS REAL) AS createdAt, user_name AS userName, label, count FROM organize_batches
        WHERE undone_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    ).catch((): any[] => []);
    const r = rows[0];
    return r ? { id: r.id, createdAt: Number(r.createdAt), userName: r.userName, label: r.label, count: Number(r.count) } : null;
  }

  /**
   * Vuelve todo a como estaba. Un producto que alguien cambió después (a mano, desde otra caja) no
   * se toca. Las categorías y marcas que se crearon y quedaron vacías se borran.
   */
  async undo(batchId: string) {
    await this.ensureTable();
    const rows = await this.prisma.$queryRawUnsafe<any[]>(`SELECT id, items, created, CAST(undone_at AS REAL) AS undoneAt FROM organize_batches WHERE id = ?`, batchId);
    const batch = rows[0];
    if (!batch) throw new NotFoundException('No se encontró ese cambio.');
    if (batch.undoneAt) throw new BadRequestException('Ese cambio ya se deshizo.');
    const saved: { id: string; name: string; old: any; new: any }[] = JSON.parse(batch.items || '[]');
    const created: { categories?: string[]; brands?: string[]; reactivated?: string[] } = JSON.parse(batch.created || '{}');
    const current = await this.prisma.product.findMany({ where: { id: { in: saved.map((s) => s.id) } }, select: { id: true, name: true, categoryId: true, brandId: true } });
    const byId = new Map(current.map((p) => [p.id, p]));
    const restore: { id: string; data: any }[] = [];
    const skipped: string[] = [];
    for (const s of saved) {
      const p: any = byId.get(s.id);
      if (!p || !Object.keys(s.new).every((f) => p[f] === s.new[f])) { skipped.push(p?.name || s.name); continue; }
      restore.push({ id: s.id, data: s.old });
    }
    await this.prisma.$transaction([
      ...restore.map((r) => this.prisma.product.update({ where: { id: r.id }, data: r.data })),
      this.prisma.$executeRawUnsafe(`UPDATE organize_batches SET undone_at = ? WHERE id = ?`, Date.now(), batchId),
    ]);
    // Lo creado que quedó sin productos: primero las subcategorías, después las principales
    let removed = 0;
    const cats = await this.prisma.category.findMany({
      where: { id: { in: [...(created.categories || []), ...(created.reactivated || [])] } },
      select: { id: true, parentCategoryId: true, _count: { select: { products: true, subcategories: true } } },
    });
    for (const c of [...cats].sort((a, b) => (a.parentCategoryId ? 0 : 1) - (b.parentCategoryId ? 0 : 1))) {
      const fresh = await this.prisma.category.findUnique({ where: { id: c.id }, select: { _count: { select: { products: true, subcategories: true } } } });
      if (!fresh || fresh._count.products || fresh._count.subcategories) continue;
      if ((created.reactivated || []).includes(c.id)) { await this.prisma.category.update({ where: { id: c.id }, data: { isActive: false } }).catch(() => {}); continue; }
      await this.prisma.category.delete({ where: { id: c.id } }).then(() => removed++).catch(() => this.prisma.category.update({ where: { id: c.id }, data: { isActive: false } }).catch(() => {}));
    }
    for (const id of created.brands || []) {
      const n = await this.prisma.product.count({ where: { brandId: id } });
      if (!n) await this.prisma.brand.delete({ where: { id } }).then(() => removed++).catch(() => {});
    }
    return { restored: restore.length, skipped, removed };
  }

  /**
   * Sugerencia al crear un producto: primero sin IA (la marca que aparece en el nombre, la categoría
   * de los productos que empiezan igual); si falta algo, la IA (1 uso). Nunca falla: sin IA o sin
   * cupo devuelve lo que encontró sola.
   */
  async suggest(name: string, rubro?: string) {
    const clean = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const words = nameWords(clean);
    if (clean.length < 4 || !words.length) return { category: null, brand: null, source: null };
    const cacheKey = words.join(' ');
    if (this.suggestCache.has(cacheKey)) return this.suggestCache.get(cacheKey);

    const { catIdx, brandIdx, cats } = await this.indexes();
    const brands = [...brandIdx.values()];
    const localBrand = brandInName(clean, brands);
    let brand: BrandSuggestion | null = localBrand ? { id: localBrand.id, name: localBrand.name, isNew: false } : null;

    // Productos que empiezan con las mismas palabras ("ALFAJOR JORGITO …" → donde están los otros alfajores)
    let category: CatSuggestion | null = null;
    for (const n of [2, 1]) {
      if (category || words.length < n || words.slice(0, n).join('').length < 3) continue;
      const prefix = clean.split(' ').slice(0, n).join(' ');
      const near = await this.prisma.product.findMany({
        where: { isActive: true, categoryId: { not: null }, name: { startsWith: prefix } },
        select: { categoryId: true }, take: 40,
      });
      const best = majority(near.map((p) => p.categoryId));
      const row = best ? cats.find((c) => c.id === best && c.isActive) : null;
      if (row) {
        const parent = row.parentCategoryId ? cats.find((c) => c.id === row.parentCategoryId) : null;
        category = { id: row.id, name: row.name, parent: parent?.name || null, isNew: false };
      }
    }

    let source: 'local' | 'ai' = 'local';
    if (!category || !brand) {
      try {
        const { result } = await this.ai.call('organize', {
          step: 'items', rubro: String(rubro || '').slice(0, 80),
          tree: await this.categoriesTree(), brands: await this.brandNames(), items: [{ name: clean }],
        }, { timeoutMs: 30_000 });
        const s = result?.items?.[0];
        if (s) {
          if (!category) category = resolveCategory(s.category, s.subcategory, catIdx);
          if (!brand) brand = resolveBrand(s.brand, brandIdx);
          source = 'ai';
        }
      } catch { /* sin IA (PC sin vincular, sin internet o sin cupo): queda lo que se encontró solo */ }
    }
    const out = { category, brand, source: category || brand ? source : null };
    if (this.suggestCache.size > 500) this.suggestCache.clear();
    this.suggestCache.set(cacheKey, out);
    return out;
  }
}
