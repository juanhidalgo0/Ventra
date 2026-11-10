import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../websockets/events.gateway';
import { FirebaseSyncService } from './firebase-sync.service';

/**
 * Aumento de precios por grupos (pantalla "Aumentar precios" en Productos).
 *
 * El cálculo (%, monto fijo, redondeo, mantener margen) lo hace la pantalla, que muestra cada precio
 * nuevo antes de guardar. El servidor recibe la lista explícita {id, precios nuevos}: así lo que se
 * guarda es exactamente lo que el dueño vio, y no un "subí 10 % a la marca X" que podría tocar
 * productos que no estaban en pantalla.
 *
 * Cada guardado queda en price_batches con los precios de antes, para poder deshacerlo.
 */

/** Los precios que puede mover la pantalla (nombre en Prisma → columna) */
export const PRICE_FIELDS = ['salePrice', 'costPrice', 'wholesalePrice', 'tradePrice', 'packPrice'] as const;
type PriceField = typeof PRICE_FIELDS[number];
type Prices = Partial<Record<PriceField, number | null>>;

const MAX_ITEMS = 5000;
const MAX_ROWS = 3000;
const CENT = 0.005;

const money = (v: any) => Math.round(Number(v) * 100) / 100;
const same = (a: any, b: any) => (a == null && b == null) || (a != null && b != null && Math.abs(Number(a) - Number(b)) < CENT);

@Injectable()
export class PriceEditorService {
  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
    private firebaseSync: FirebaseSyncService,
  ) {}

  /** Lo que coincide con los filtros (combinables), con los precios de hoy */
  async search(q: { search?: string; brandId?: string; categoryId?: string; supplierId?: string; staleDays?: number }) {
    const where: string[] = [`p.is_active = 1`, `p.id NOT IN ('VENTA_RAPIDA', 'SERVICIO')`];
    const args: any[] = [];
    // Cada palabra tiene que estar en el nombre o en un código ("papas kento" encuentra "PAPAS FRITAS KENTO 80G")
    for (const word of String(q.search || '').trim().split(/\s+/).filter(Boolean).slice(0, 6)) {
      where.push(`(p.name LIKE ? OR p.barcode LIKE ? OR p.sku LIKE ?)`);
      const like = `%${word}%`;
      args.push(like, like, like);
    }
    if (q.brandId === 'none') where.push(`p.brand_id IS NULL`);
    else if (q.brandId) { where.push(`p.brand_id = ?`); args.push(q.brandId); }
    if (q.supplierId === 'none') where.push(`p.supplier_id IS NULL`);
    else if (q.supplierId) { where.push(`p.supplier_id = ?`); args.push(q.supplierId); }
    if (q.categoryId) {
      // La categoría y sus subcategorías
      where.push(`(p.category_id = ? OR p.category_id IN (SELECT id FROM categories WHERE parent_category_id = ?))`);
      args.push(q.categoryId, q.categoryId);
    }
    const stale = Math.round(Number(q.staleDays) || 0);
    if (stale > 0) {
      // Sin cambio de precio de venta en N días (o nunca desde que se anota)
      where.push(`(p.price_changed_at IS NULL OR p.price_changed_at < ?)`);
      args.push(Date.now() - stale * 86400000);
    }
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT p.id, p.name, p.barcode, p.sku, b.name AS brand, c.name AS category, s.name AS supplier,
              CAST(p.cost_price AS REAL) AS costPrice, CAST(p.sale_price AS REAL) AS salePrice,
              CAST(p.wholesale_price AS REAL) AS wholesalePrice, CAST(p.trade_price AS REAL) AS tradePrice,
              CAST(p.pack_price AS REAL) AS packPrice, p.units_per_pack AS unitsPerPack,
              CAST(p.price_changed_at AS REAL) AS priceChangedAt
         FROM products p
         LEFT JOIN brands b ON b.id = p.brand_id
         LEFT JOIN categories c ON c.id = p.category_id
         LEFT JOIN suppliers s ON s.id = p.supplier_id
        WHERE ${where.join(' AND ')}
        ORDER BY p.name COLLATE NOCASE
        LIMIT ${MAX_ROWS + 1}`,
      ...args,
    );
    const num = (v: any) => (v === null || v === undefined ? null : Number(v));
    return {
      truncated: rows.length > MAX_ROWS,
      products: rows.slice(0, MAX_ROWS).map((r) => ({
        id: r.id, name: r.name, barcode: r.barcode, sku: r.sku, brand: r.brand, category: r.category, supplier: r.supplier,
        costPrice: Number(r.costPrice) || 0, salePrice: Number(r.salePrice) || 0,
        wholesalePrice: num(r.wholesalePrice), tradePrice: num(r.tradePrice), packPrice: num(r.packPrice),
        unitsPerPack: Number(r.unitsPerPack) || 1, priceChangedAt: num(r.priceChangedAt),
      })),
    };
  }

  /**
   * Guarda los precios nuevos de todos los productos en UNA transacción: o se guardan todos o
   * ninguno. Anota los precios de antes (para Deshacer) y el historial de precios de venta.
   */
  async apply(body: { items: { id: string; prices: Prices }[]; label?: string }, userId?: string) {
    const items = Array.isArray(body?.items) ? body.items.filter((i) => i && typeof i.id === 'string' && i.prices) : [];
    if (!items.length) throw new BadRequestException('No hay precios para guardar.');
    if (items.length > MAX_ITEMS) throw new BadRequestException(`Son demasiados productos juntos (máximo ${MAX_ITEMS}).`);

    // Validar: solo los precios conocidos, números >= 0; el de venta no puede quedar en 0
    const wanted = new Map<string, Prices>();
    for (const it of items) {
      const clean: Prices = {};
      for (const f of PRICE_FIELDS) {
        if (!(f in it.prices)) continue;
        const v = (it.prices as any)[f];
        if (v === null && f !== 'salePrice' && f !== 'costPrice') { clean[f] = null; continue; }
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) throw new BadRequestException('Hay un precio que no es un número válido.');
        if (f === 'salePrice' && n <= 0) throw new BadRequestException('El precio de venta tiene que ser mayor a 0.');
        clean[f] = money(n);
      }
      if (Object.keys(clean).length) wanted.set(it.id, clean);
    }

    const ids = [...wanted.keys()];
    const current = await this.prisma.product.findMany({
      where: { id: { in: ids }, isActive: true },
      select: { id: true, name: true, barcode: true, stock: true, salePrice: true, costPrice: true, wholesalePrice: true, tradePrice: true, packPrice: true },
    });

    // Solo lo que de verdad cambia
    const changes: { id: string; name: string; barcode: string | null; stock: number; old: Prices; next: Prices }[] = [];
    for (const p of current) {
      const w = wanted.get(p.id)!;
      const old: Prices = {}; const next: Prices = {};
      for (const f of PRICE_FIELDS) {
        if (!(f in w) || same((p as any)[f], w[f])) continue;
        old[f] = (p as any)[f]; next[f] = w[f];
      }
      if (Object.keys(next).length) changes.push({ id: p.id, name: p.name, barcode: p.barcode, stock: p.stock, old, next });
    }
    if (!changes.length) return { batchId: null, updated: 0, missing: ids.length - current.length };

    const user = userId ? await this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true, username: true } }).catch(() => null) : null;
    const batchId = randomUUID();
    const label = String(body.label || '').trim().slice(0, 200) || `${changes.length} productos`;

    await this.prisma.$transaction([
      ...changes.map((c) => this.prisma.product.update({ where: { id: c.id }, data: c.next as any })),
      ...changes
        .filter((c) => 'salePrice' in c.next && userId)
        .map((c) => this.prisma.priceHistory.create({ data: { productId: c.id, userId: userId!, oldPrice: Number(c.old.salePrice), newPrice: Number(c.next.salePrice) } })),
      this.prisma.$executeRawUnsafe(
        `INSERT INTO price_batches (id, created_at, user_id, user_name, label, count, items) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        batchId, Date.now(), userId || null, user?.fullName || user?.username || null, label, changes.length,
        JSON.stringify(changes.map((c) => ({ id: c.id, name: c.name, old: c.old, new: c.next }))),
      ),
    ]);

    this.afterChange(changes);
    return { batchId, updated: changes.length, missing: ids.length - current.length };
  }

  /** El último guardado que se puede deshacer (de esta caja o de otra) */
  async lastBatch() {
    const rows = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT id, CAST(created_at AS REAL) AS createdAt, user_name AS userName, label, count FROM price_batches
        WHERE undone_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    ).catch((): any[] => []);
    const r = rows[0];
    return r ? { id: r.id, createdAt: Number(r.createdAt), userName: r.userName, label: r.label, count: Number(r.count) } : null;
  }

  /**
   * Vuelve a poner los precios de antes. Si después alguien cambió el precio de un producto
   * (a mano, una boleta, otra caja), ese producto NO se toca: se respeta el cambio más nuevo y se avisa.
   */
  async undo(batchId: string, userId?: string) {
    // Las fechas (milisegundos) se leen como REAL: Prisma falla con enteros grandes en consultas directas
    const rows = await this.prisma.$queryRawUnsafe<any[]>(`SELECT id, items, CAST(undone_at AS REAL) AS undoneAt FROM price_batches WHERE id = ?`, batchId);
    const batch = rows[0];
    if (!batch) throw new NotFoundException('No se encontró ese aumento.');
    if (batch.undoneAt) throw new BadRequestException('Ese aumento ya se deshizo.');
    const saved: { id: string; name: string; old: Prices; new: Prices }[] = JSON.parse(batch.items || '[]');

    const current = await this.prisma.product.findMany({
      where: { id: { in: saved.map((s) => s.id) } },
      select: { id: true, name: true, barcode: true, stock: true, salePrice: true, costPrice: true, wholesalePrice: true, tradePrice: true, packPrice: true },
    });
    const byId = new Map(current.map((p) => [p.id, p]));

    const restore: { id: string; name: string; barcode: string | null; stock: number; old: Prices; next: Prices }[] = [];
    const skipped: string[] = [];
    for (const s of saved) {
      const p: any = byId.get(s.id);
      if (!p) { skipped.push(s.name); continue; }
      const untouched = Object.keys(s.new).every((f) => same(p[f], (s.new as any)[f]));
      if (!untouched) { skipped.push(p.name); continue; }
      restore.push({ id: p.id, name: p.name, barcode: p.barcode, stock: p.stock, old: s.new, next: s.old });
    }

    await this.prisma.$transaction([
      ...restore.map((r) => this.prisma.product.update({ where: { id: r.id }, data: r.next as any })),
      ...restore
        .filter((r) => 'salePrice' in r.next && userId)
        .map((r) => this.prisma.priceHistory.create({ data: { productId: r.id, userId: userId!, oldPrice: Number(r.old.salePrice), newPrice: Number(r.next.salePrice) } })),
      this.prisma.$executeRawUnsafe(`UPDATE price_batches SET undone_at = ? WHERE id = ?`, Date.now(), batchId),
    ]);

    if (restore.length) this.afterChange(restore);
    return { restored: restore.length, skipped };
  }

  /** Avisar a las otras cajas y a GoDelivery (igual que el aumento masivo de antes) */
  private afterChange(changed: { id: string; barcode: string | null; stock: number; next: Prices }[]) {
    try { this.events.emitPricesUpdated(changed.map((c) => ({ id: c.id, ...c.next }))); } catch { /* sin clientes conectados */ }
    // GO: con el puente nuevo alcanza con un aviso (publica solo lo que cambió); con el viejo se sube
    // uno por uno, de a poco y sin frenar la respuesta.
    (async () => {
      for (const c of changed) {
        const fresh = await this.prisma.product.findUnique({ where: { id: c.id }, select: { stock: true, salePrice: true } }).catch(() => null);
        if (!fresh) continue;
        await this.firebaseSync.syncProductToFirestore(c.barcode || c.id, fresh.stock, fresh.salePrice).catch(() => {});
      }
    })().catch(() => {});
  }
}
