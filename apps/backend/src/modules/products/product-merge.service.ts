import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { PrismaService } from '../../database/prisma.service';
import { BackupService } from '../system/backup.service';

/**
 * Productos repetidos: encontrarlos, juntarlos y separarlos.
 *
 * Reglas (nada se borra nunca):
 *  - Juntar deja uno ("el que queda") y OCULTA los otros (isActive = false). Los códigos de barras
 *    de los ocultos pasan al que queda como códigos adicionales: escanear cualquiera de los dos en la
 *    caja sigue encontrando el producto. El stock de los ocultos se suma al que queda (con su
 *    movimiento de inventario) y sus lotes de vencimiento pasan también.
 *  - Cada juntada queda guardada en la auditoría (PRODUCT_MERGE) con todo lo necesario para
 *    "Separar": los productos vuelven a quedar como estaban, con su stock, códigos y lotes.
 *  - Antes de la primera juntada del día se hace una copia de seguridad completa (SAFETY).
 *  - No se juntan: productos de un combo o kit, de una promoción activa, ni variantes de talle/color
 *    (eso se arregla desde Ventra).
 *  - "Son distintos" queda anotado (store_settings product_distinct_groups) y no se vuelve a ofrecer.
 */

const DISTINCT_KEY = 'product_distinct_groups';
const BACKUP_KEY = 'product_merge_backup_day';
const SKIP = ['VENTA_RAPIDA', 'SERVICIO', 'PAGO_CTA_CTE'];

const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/(\d),(\d)/g, '$1.$2').replace(/(\d)([a-z])/g, '$1 $2').replace(/[^a-z0-9. ]/g, ' ').replace(/\s+/g, ' ').trim();
/** Unidades que no cambian el producto ("x 200" = "x 200 gr") */
const UNITS = new Set(['gr', 'g', 'grs', 'gramos', 'ml', 'cc', 'cm3', 'lt', 'l', 'lts', 'litro', 'litros', 'kg', 'kgs', 'un', 'u', 'unid', 'unidades', 'x', 'de', 'del', 'la', 'el', 'con', 'en', 'y']);
const words = (s: string) => norm(s).split(' ').filter((w) => w && !UNITS.has(w) && !/^\d+(\.\d+)?$/.test(w));
const numbers = (s: string) => (norm(s).match(/\d+(?:\.\d+)?/g) || []).map((n) => String(Number(n))).sort().join(',');
/** Palabras que distinguen variantes: talles, colores y sabores cortos (FR/CR, M/G, XL) */
const SIZE_WORDS = new Set(['xs', 's', 'm', 'l', 'xl', 'xxl', 'p', 'g', 'xg', 'xxg', 'chico', 'mediano', 'grande', 'negro', 'blanco', 'rojo', 'azul', 'verde', 'rosa', 'amarillo', 'gris', 'light', 'zero', 'diet', 'clasico', 'clasica', 'original', 'menta', 'frutilla', 'limon', 'naranja', 'chocolate', 'vainilla', 'dulce', 'leche', 'blanca', 'negra']);
const isBarcode = (c?: string | null) => {
  const s = String(c || '').trim();
  if (!/^(\d{8}|\d{12,14})$/.test(s)) return false;
  const d = s.split('').map(Number);
  const check = d.pop()!;
  const sum = d.reverse().reduce((a, x, i) => a + x * (i % 2 === 0 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === check;
};
const groupKey = (ids: string[]) => [...ids].sort().join('|');

export interface DupProduct {
  id: string; name: string; barcode: string | null; extraBarcodes: string[]; salePrice: number; costPrice: number; stock: number;
  sold: number; lastSale: string | null; createdAt: string; isActive: boolean;
}
export interface DupGroup { key: string; kind: 'igual' | 'parecido'; looksDistinct: boolean; why: string | null; keepId: string; products: DupProduct[] }

@Injectable()
export class ProductMergeService {
  // BackupService vive en SystemModule, que ya importa ProductsModule: se busca recién al usarlo
  constructor(private prisma: PrismaService, @Optional() private moduleRef?: ModuleRef, @Optional() private backupsForTests?: Pick<BackupService, 'createBackup'>) {}

  private get backups(): Pick<BackupService, 'createBackup'> | null {
    if (this.backupsForTests) return this.backupsForTests;
    try { return this.moduleRef ? this.moduleRef.get(BackupService, { strict: false }) : null; } catch { return null; }
  }

  private async distinct(): Promise<Set<string>> {
    const row = await this.prisma.storeSetting.findUnique({ where: { id: DISTINCT_KEY } }).catch(() => null);
    try { return new Set(JSON.parse(row?.value || '[]')); } catch { return new Set(); }
  }

  /**
   * Los grupos de repetidos: nombre igual (sin importar mayúsculas, tildes ni "gr"), o las mismas
   * palabras y los mismos tamaños en otro orden. Los que el dueño marcó como distintos no salen.
   */
  async duplicates(limit = 200): Promise<{ total: number; groups: DupGroup[] }> {
    const prods = await this.prisma.product.findMany({
      where: { isActive: true, id: { notIn: SKIP } },
      select: { id: true, name: true, barcode: true, salePrice: true, costPrice: true, stock: true, createdAt: true, isActive: true, variantGroupId: true, additionalBarcodes: { select: { barcode: true } } },
    });
    const byName = new Map<string, typeof prods>();
    const bySig = new Map<string, typeof prods>();
    for (const p of prods) {
      if (p.variantGroupId) continue; // las variantes de talle/color no son repetidos
      const n = norm(p.name);
      byName.set(n, [...(byName.get(n) || []), p]);
      const sig = `${numbers(p.name)}|${[...new Set(words(p.name))].sort().join(' ')}`;
      bySig.set(sig, [...(bySig.get(sig) || []), p]);
    }
    const seen = new Set<string>();
    const raw: { kind: 'igual' | 'parecido'; list: typeof prods }[] = [];
    for (const list of byName.values()) if (list.length > 1) { raw.push({ kind: 'igual', list }); seen.add(groupKey(list.map((p) => p.id))); }
    for (const list of bySig.values()) {
      if (list.length < 2) continue;
      const k = groupKey(list.map((p) => p.id));
      if (seen.has(k) || list.every((p) => list.every((q) => norm(p.name) === norm(q.name)))) continue;
      seen.add(k);
      raw.push({ kind: 'parecido', list });
    }
    const skip = await this.distinct();
    const groups = raw.filter((g) => !skip.has(groupKey(g.list.map((p) => p.id))));
    // Ventas de cada producto (cuántas y la última)
    const ids = groups.flatMap((g) => g.list.map((p) => p.id));
    const sales = ids.length ? await this.prisma.$queryRawUnsafe<{ product_id: string; n: number; last: any }[]>(
      `SELECT si.product_id, COUNT(*) AS n, MAX(s.created_at) AS last FROM sale_items si JOIN sales s ON s.id = si.sale_id WHERE si.product_id IN (${ids.map(() => '?').join(',')}) GROUP BY si.product_id`, ...ids,
    ).catch((): any[] => []) : [];
    // SQLite devuelve la fecha como número (a veces BigInt) o como texto, según cómo se guardó
    const when = (v: any) => {
      if (v === null || v === undefined || v === '') return null;
      const raw = typeof v === 'bigint' ? Number(v) : /^\d+$/.test(String(v)) ? Number(v) : String(v);
      const d = new Date(raw);
      return isNaN(d.getTime()) ? null : d.toISOString();
    };
    const sold = new Map(sales.map((s) => [s.product_id, { n: Number(s.n) || 0, last: when(s.last) }]));
    const out: DupGroup[] = groups.map(({ kind, list }) => {
      const products: DupProduct[] = list.map((p) => ({
        id: p.id, name: p.name, barcode: p.barcode, extraBarcodes: p.additionalBarcodes.map((b) => b.barcode),
        salePrice: p.salePrice, costPrice: p.costPrice, stock: p.stock, sold: sold.get(p.id)?.n || 0, lastSale: sold.get(p.id)?.last || null,
        createdAt: p.createdAt.toISOString(), isActive: p.isActive,
      }));
      // Distintos a la vista: talles, colores o sabores que difieren ("GUANTES M" / "GUANTES G")
      let why: string | null = null;
      if (kind === 'parecido') {
        const sets = list.map((p) => new Set(norm(p.name).split(' ')));
        const diff = [...new Set(list.flatMap((p) => norm(p.name).split(' ')))].filter((w) => !sets.every((s) => s.has(w)));
        const marker = diff.find((w) => SIZE_WORDS.has(w) || (w.length <= 3 && !UNITS.has(w) && !/^\d/.test(w)));
        if (marker) why = `difieren en "${marker.toUpperCase()}" (puede ser un talle, color o sabor)`;
      }
      // Códigos de barras distintos y se venden todos: suelen ser sabores o presentaciones distintas
      // cargadas con el mismo nombre (5 "BEL BOMBON" con 5 códigos que se venden)
      const selling = products.filter((p) => p.sold > 0);
      const codes = new Set(selling.map((p) => p.barcode).filter((b) => isBarcode(b)));
      if (!why && selling.length >= 2 && codes.size >= 2) {
        why = `${selling.length === products.length ? 'tienen códigos de barras distintos y se venden todos' : `${selling.length} tienen códigos distintos y se venden`}: pueden ser sabores o presentaciones distintas con el mismo nombre`;
      }
      if (!why && new Set(products.map((p) => Math.round(p.salePrice))).size > 1 && products.every((p) => p.sold > 0)) {
        const lo = Math.min(...products.map((p) => p.salePrice)), hi = Math.max(...products.map((p) => p.salePrice));
        if (hi > lo * 1.5) why = 'tienen precios muy distintos y los dos se venden';
      }
      // El que queda: el que más vende, después el que tiene código de barras válido, después el más viejo
      const keep = [...products].sort((a, b) => (b.sold - a.sold) || (Number(isBarcode(b.barcode)) - Number(isBarcode(a.barcode))) || a.createdAt.localeCompare(b.createdAt))[0];
      return { key: groupKey(products.map((p) => p.id)), kind, looksDistinct: !!why, why, keepId: keep.id, products };
    });
    // Primero los iguales y los más vendidos (los que más importan para los precios)
    out.sort((a, b) => (Number(a.looksDistinct) - Number(b.looksDistinct)) || (a.kind === b.kind ? 0 : a.kind === 'igual' ? -1 : 1)
      || (b.products.reduce((s, p) => s + p.sold, 0) - a.products.reduce((s, p) => s + p.sold, 0)));
    return { total: out.length, groups: out.slice(0, Math.max(1, Math.min(500, limit))) };
  }

  /** "Son distintos": ese grupo no se vuelve a ofrecer */
  async markDistinct(ids: string[]) {
    if (!Array.isArray(ids) || ids.length < 2) throw new BadRequestException('Hacen falta al menos dos productos');
    const set = await this.distinct();
    set.add(groupKey(ids.map(String)));
    await this.prisma.storeSetting.upsert({ where: { id: DISTINCT_KEY }, create: { id: DISTINCT_KEY, value: JSON.stringify([...set]) }, update: { value: JSON.stringify([...set]) } });
    return { ok: true };
  }

  /** Una copia de seguridad completa antes de la primera juntada del día */
  private async safetyBackup() {
    if (!this.backups) return null;
    const day = new Date().toISOString().slice(0, 10);
    const row = await this.prisma.storeSetting.findUnique({ where: { id: BACKUP_KEY } }).catch(() => null);
    if (row?.value === JSON.stringify(day)) return null;
    const b = await this.backups.createBackup('SAFETY');
    await this.prisma.storeSetting.upsert({ where: { id: BACKUP_KEY }, create: { id: BACKUP_KEY, value: JSON.stringify(day) }, update: { value: JSON.stringify(day) } });
    return b.filename;
  }

  /** Junta mergeIds en keepId. Devuelve { mergeId (para separar), kept, hidden, barcodesMoved, stockMoved, backup } */
  async merge(keepId: string, mergeIds: string[], userId: string) {
    const ids = [...new Set((mergeIds || []).map(String))].filter((id) => id && id !== keepId);
    if (!keepId || !ids.length) throw new BadRequestException('Decime cuál queda y cuáles se juntan');
    if (ids.length > 10) throw new BadRequestException('Como mucho 10 productos por vez');
    const all = await this.prisma.product.findMany({
      where: { id: { in: [keepId, ...ids] } },
      include: { additionalBarcodes: true, promotions: { include: { promotion: { select: { name: true, isActive: true } } } }, kitItems: true, parentKits: true },
    });
    const keep = all.find((p) => p.id === keepId);
    if (!keep) throw new NotFoundException('No encontré el producto que queda');
    if (!keep.isActive) throw new BadRequestException(`"${keep.name}" está oculto: elegí uno que esté a la venta`);
    for (const id of ids) {
      const p = all.find((x) => x.id === id);
      if (!p) throw new NotFoundException('Uno de los productos ya no existe');
      if (!p.isActive) throw new BadRequestException(`"${p.name}" ya está oculto (se juntó antes)`);
    }
    for (const p of all) {
      const promo = p.promotions.find((x) => x.promotion?.isActive);
      if (promo) throw new BadRequestException(`"${p.name}" está en la promo "${promo.promotion.name}": juntalos desde Ventra o sacalo de la promo primero`);
      if (p.kitItems.length || p.parentKits.length) throw new BadRequestException(`"${p.name}" es parte de un combo o kit: juntalos desde Ventra`);
      if (p.variantGroupId) throw new BadRequestException(`"${p.name}" es una variante (talle o color): no se junta`);
    }
    const backup = await this.safetyBackup().catch(() => null);

    const merged: any[] = [];
    let stockMoved = 0;
    await this.prisma.$transaction(async (tx) => {
      for (const id of ids) {
        const p = all.find((x) => x.id === id)!;
        const snap: any = { id: p.id, name: p.name, barcode: p.barcode, wasActive: p.isActive, stock: p.stock, extraBarcodes: p.additionalBarcodes.map((b) => b.barcode), lots: [] as string[] };
        // Códigos de barras: el principal y los adicionales pasan al que queda (sin repetir)
        if (p.barcode) {
          await tx.product.update({ where: { id: p.id }, data: { barcode: null } });
          if (p.barcode !== keep.barcode) {
            const taken = await tx.productBarcode.findUnique({ where: { barcode: p.barcode } });
            if (!taken) await tx.productBarcode.create({ data: { barcode: p.barcode, productId: keep.id } });
          }
        }
        for (const b of p.additionalBarcodes) await tx.productBarcode.update({ where: { id: b.id }, data: { productId: keep.id } });
        // Stock: lo del oculto se suma al que queda (con su movimiento, así queda el rastro)
        if (p.stock !== 0) {
          const keepNow = await tx.product.findUnique({ where: { id: keep.id }, select: { stock: true } });
          await tx.product.update({ where: { id: keep.id }, data: { stock: { increment: p.stock } } });
          await tx.product.update({ where: { id: p.id }, data: { stock: { decrement: p.stock } } });
          await tx.inventoryMovement.create({ data: { productId: keep.id, userId, type: 'ADJUSTMENT', quantity: p.stock, stockBefore: keepNow!.stock, stockAfter: keepNow!.stock + p.stock, reason: `Unificado con "${p.name}"` } });
          await tx.inventoryMovement.create({ data: { productId: p.id, userId, type: 'ADJUSTMENT', quantity: -p.stock, stockBefore: p.stock, stockAfter: 0, reason: `Unificado en "${keep.name}"` } });
          stockMoved += p.stock;
        }
        // Lotes de vencimiento vigentes
        const lots = await tx.productLot.findMany({ where: { productId: p.id, status: 'ACTIVE' }, select: { id: true } });
        if (lots.length) await tx.productLot.updateMany({ where: { id: { in: lots.map((l) => l.id) } }, data: { productId: keep.id } });
        snap.lots = lots.map((l) => l.id);
        await tx.product.update({ where: { id: p.id }, data: { isActive: false } });
        merged.push(snap);
      }
    });
    const audit = await this.prisma.auditLog.create({
      data: {
        userId, entityType: 'PRODUCT_MERGE', entityId: keep.id, action: 'MERGE',
        oldValues: JSON.stringify({ keepId: keep.id, keepName: keep.name, keepBarcode: keep.barcode, merged }),
        newValues: JSON.stringify({ at: Date.now(), backup }),
      },
    });
    return {
      mergeId: audit.id, kept: { id: keep.id, name: keep.name }, hidden: merged.map((m) => ({ id: m.id, name: m.name })),
      barcodesMoved: merged.reduce((a, m) => a + (m.barcode && m.barcode !== keep.barcode ? 1 : 0) + m.extraBarcodes.length, 0), stockMoved, backup,
    };
  }

  /** Separar: deja los productos como estaban antes de juntarlos */
  async undo(mergeId: string, userId: string) {
    const log = await this.prisma.auditLog.findUnique({ where: { id: mergeId } });
    if (!log || log.entityType !== 'PRODUCT_MERGE' || log.action !== 'MERGE') throw new NotFoundException('No encontré esa unificación');
    const done = await this.prisma.auditLog.findFirst({ where: { entityType: 'PRODUCT_MERGE', action: 'UNMERGE', entityId: mergeId } });
    if (done) return { ok: true, already: true, restored: [] };
    const data = JSON.parse(log.oldValues || '{}');
    const keepId: string = data.keepId;
    const restored: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      for (const m of data.merged || []) {
        const p = await tx.product.findUnique({ where: { id: m.id } });
        if (!p) continue;
        // Códigos: vuelven al producto separado
        if (m.barcode) {
          await tx.productBarcode.deleteMany({ where: { barcode: m.barcode, productId: keepId } });
          const elsewhere = await tx.product.findFirst({ where: { barcode: m.barcode, id: { not: m.id } }, select: { id: true } });
          if (!elsewhere) await tx.product.update({ where: { id: m.id }, data: { barcode: m.barcode } });
        }
        for (const b of m.extraBarcodes || []) await tx.productBarcode.updateMany({ where: { barcode: b, productId: keepId }, data: { productId: m.id } });
        // Stock y lotes
        if (m.stock) {
          const keepNow = await tx.product.findUnique({ where: { id: keepId }, select: { stock: true } });
          await tx.product.update({ where: { id: keepId }, data: { stock: { decrement: m.stock } } });
          await tx.product.update({ where: { id: m.id }, data: { stock: { increment: m.stock } } });
          if (keepNow) await tx.inventoryMovement.create({ data: { productId: keepId, userId, type: 'ADJUSTMENT', quantity: -m.stock, stockBefore: keepNow.stock, stockAfter: keepNow.stock - m.stock, reason: `Separado de "${m.name}"` } });
          await tx.inventoryMovement.create({ data: { productId: m.id, userId, type: 'ADJUSTMENT', quantity: m.stock, stockBefore: p.stock, stockAfter: p.stock + m.stock, reason: `Separado de "${data.keepName}"` } });
        }
        if (m.lots && m.lots.length) await tx.productLot.updateMany({ where: { id: { in: m.lots }, productId: keepId }, data: { productId: m.id } });
        await tx.product.update({ where: { id: m.id }, data: { isActive: !!m.wasActive } });
        restored.push(m.name);
      }
    });
    await this.prisma.auditLog.create({ data: { userId, entityType: 'PRODUCT_MERGE', entityId: mergeId, action: 'UNMERGE', newValues: JSON.stringify({ at: Date.now(), restored }) } });
    return { ok: true, restored };
  }

  /** Las últimas unificaciones (para separarlas desde la lista de ocultos) */
  async recent(limit = 30) {
    const logs = await this.prisma.auditLog.findMany({ where: { entityType: 'PRODUCT_MERGE' }, orderBy: { createdAt: 'desc' }, take: 300 });
    const undone = new Set(logs.filter((l) => l.action === 'UNMERGE').map((l) => l.entityId));
    return logs.filter((l) => l.action === 'MERGE' && !undone.has(l.id)).slice(0, limit).map((l) => {
      const d = JSON.parse(l.oldValues || '{}');
      return { mergeId: l.id, at: l.createdAt, kept: d.keepName, hidden: (d.merged || []).map((m: any) => m.name) };
    });
  }
}
