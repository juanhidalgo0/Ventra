import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { deliveredLines } from './delivery-runs.service';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const DAY = 86400000;

/**
 * Informes de la distribuidora, armados con los pedidos y lo que pasó en cada entrega:
 * vendedores (para pagar comisiones), zonas, productos, rechazos, clientes que dejaron de
 * comprar, deuda por zona y qué hay que comprar.
 *
 * "Pedido" es lo que se tomó; "entregado" es lo que el cliente recibió (sale de la rendición del
 * reparto). Un pedido que todavía no se entregó cuenta como pedido pero no como entregado.
 */
@Injectable()
export class DistribReportsService {
  constructor(private prisma: PrismaService) {}

  private get db(): any { return this.prisma as any; }

  async report(q: { from?: string; to?: string; lostDays?: number }) {
    const to = q.to && !isNaN(new Date(q.to).getTime()) ? new Date(q.to) : new Date();
    const from = q.from && !isNaN(new Date(q.from).getTime()) ? new Date(q.from) : new Date(to.getTime() - 30 * DAY);
    const orders: any[] = await this.db.preOrder.findMany({
      where: { status: { not: 'CANCELLED' }, createdAt: { gte: from, lte: to } },
      include: {
        client: { select: { id: true, name: true, locality: true } },
        user: { select: { id: true, fullName: true, username: true } },
        items: true,
      },
      take: 20000,
    });

    const sellers = new Map<string, any>();
    const zones = new Map<string, any>();
    const products = new Map<string, any>();
    const reasons = new Map<string, { reason: string; count: number; amount: number }>();
    let ordered = 0, delivered = 0, rejected = 0;

    for (const o of orders) {
      const done = !!o.deliveryStatus;
      const lines = done ? deliveredLines(o) : [];
      const got = done ? round2(lines.reduce((s: number, it: any) => s + it.quantity * it.unitPrice, 0)) : 0;
      const lost = done ? round2((o.total || 0) - got) : 0;
      ordered += o.total || 0; delivered += got; rejected += lost;

      const sid = o.userId;
      const s = sellers.get(sid) || { userId: sid, name: o.user?.fullName || o.user?.username || 'Sin nombre', orders: 0, clients: new Set<string>(), ordered: 0, delivered: 0, rejected: 0, pending: 0 };
      s.orders++; s.ordered += o.total || 0; s.delivered += got; s.rejected += lost;
      if (!done) s.pending += o.total || 0;
      if (o.clientId) s.clients.add(o.clientId);
      sellers.set(sid, s);

      const zn = (o.client?.locality || '').trim() || 'Sin localidad';
      const z = zones.get(zn) || { zone: zn, orders: 0, clients: new Set<string>(), ordered: 0, delivered: 0, rejected: 0 };
      z.orders++; z.ordered += o.total || 0; z.delivered += got; z.rejected += lost;
      if (o.clientId) z.clients.add(o.clientId);
      zones.set(zn, z);

      // Productos: lo entregado si ya se rindió, si no lo pedido
      for (const it of done ? lines : o.items || []) {
        const p = products.get(it.productId) || { productId: it.productId, name: it.productName, units: 0, bultos: 0, amount: 0 };
        p.units += it.quantity;
        if (Number(it.packSize) > 1) p.bultos += it.quantity / Number(it.packSize);
        p.amount += it.quantity * it.unitPrice;
        products.set(it.productId, p);
      }

      if (done && (o.deliveryStatus === 'NOT_DELIVERED' || lost > 0.009)) {
        const r = (o.deliveryReason || '').trim() || (o.deliveryStatus === 'NOT_DELIVERED' ? 'No se entregó (sin motivo)' : 'Cambios (sin motivo)');
        const e = reasons.get(r) || { reason: r, count: 0, amount: 0 };
        e.count++; e.amount += lost;
        reasons.set(r, e);
      }
    }

    const fin = (x: any) => ({ ...x, clients: x.clients instanceof Set ? x.clients.size : x.clients, ordered: round2(x.ordered), delivered: round2(x.delivered), rejected: round2(x.rejected), ...(x.pending !== undefined ? { pending: round2(x.pending) } : {}) });

    return {
      from, to,
      totals: { orders: orders.length, ordered: round2(ordered), delivered: round2(delivered), rejected: round2(rejected) },
      sellers: [...sellers.values()].map(fin).sort((a, b) => b.delivered - a.delivered || b.ordered - a.ordered),
      zones: [...zones.values()].map(fin).sort((a, b) => b.ordered - a.ordered),
      products: [...products.values()].map((p) => ({ ...p, units: round2(p.units), bultos: round2(p.bultos), amount: round2(p.amount) })).sort((a, b) => b.amount - a.amount).slice(0, 50),
      reasons: [...reasons.values()].map((r) => ({ ...r, amount: round2(r.amount) })).sort((a, b) => b.count - a.count),
      lostClients: await this.lostClients(q.lostDays),
      debtByZone: await this.debtByZone(),
    };
  }

  /**
   * Clientes que venían comprando y hace un tiempo no piden: los que hicieron al menos 2 pedidos
   * en los últimos 4 meses y el último fue hace más de `days` días (21 por defecto).
   */
  private async lostClients(days = 21) {
    const since = new Date(Date.now() - 120 * DAY);
    const cut = Date.now() - Math.max(7, Math.min(120, Number(days) || 21)) * DAY;
    const orders: any[] = await this.db.preOrder.findMany({
      where: { status: { not: 'CANCELLED' }, clientId: { not: null }, createdAt: { gte: since } },
      select: { clientId: true, createdAt: true, total: true, client: { select: { name: true, locality: true, phone: true, isActive: true } } },
      take: 20000,
    });
    const by = new Map<string, any>();
    for (const o of orders) {
      const c = by.get(o.clientId) || { clientId: o.clientId, name: o.client?.name, locality: o.client?.locality || '', phone: o.client?.phone || null, active: o.client?.isActive !== false, count: 0, sum: 0, last: 0 };
      c.count++; c.sum += o.total || 0; c.last = Math.max(c.last, new Date(o.createdAt).getTime());
      by.set(o.clientId, c);
    }
    return [...by.values()]
      .filter((c) => c.active && c.count >= 2 && c.last < cut)
      .map((c) => ({ clientId: c.clientId, name: c.name, locality: c.locality, phone: c.phone, orders: c.count, average: round2(c.sum / c.count), lastOrderAt: new Date(c.last), days: Math.floor((Date.now() - c.last) / DAY) }))
      .sort((a, b) => b.average - a.average);
  }

  /** Lo que deben los clientes, por localidad (para cobrar en la ruta) */
  private async debtByZone() {
    const clients: any[] = await this.db.client.findMany({ where: { isActive: true, balance: { gt: 0.009 } }, select: { id: true, name: true, locality: true, balance: true, creditLimit: true } });
    const zones = new Map<string, any>();
    for (const c of clients) {
      const zn = (c.locality || '').trim() || 'Sin localidad';
      const z = zones.get(zn) || { zone: zn, total: 0, clients: [] as any[] };
      z.total += c.balance;
      z.clients.push({ id: c.id, name: c.name, balance: round2(c.balance), overLimit: c.creditLimit > 0 && c.balance > c.creditLimit });
      zones.set(zn, z);
    }
    return [...zones.values()]
      .map((z) => ({ ...z, total: round2(z.total), clients: z.clients.sort((a: any, b: any) => b.balance - a.balance) }))
      .sort((a, b) => b.total - a.total);
  }

  /**
   * Qué comprar: lo que falta para cubrir los pedidos pendientes (todavía no salieron) y dejar
   * el stock mínimo de cada producto, agrupado por proveedor y redondeado a bultos enteros.
   */
  async purchaseSuggestion() {
    const items: any[] = await this.db.preOrderItem.findMany({ where: { order: { status: 'PENDING' } }, select: { productId: true, quantity: true } });
    const need = new Map<string, number>();
    for (const it of items) need.set(it.productId, (need.get(it.productId) || 0) + it.quantity);
    const products: any[] = await this.db.product.findMany({
      where: { isActive: true, OR: [{ id: { in: [...need.keys()] } }, { minStock: { gt: 0 } }] },
      select: { id: true, name: true, stock: true, minStock: true, unitsPerPack: true, costPrice: true, supplier: { select: { id: true, name: true } } },
    });
    const bySupplier = new Map<string, any>();
    for (const p of products) {
      if (['VENTA_RAPIDA', 'PAGO_CTA_CTE'].includes(p.id)) continue;
      const committed = need.get(p.id) || 0;
      const missing = committed + (p.minStock || 0) - (p.stock || 0);
      if (missing <= 1e-9) continue;
      const pack = p.unitsPerPack > 1 ? p.unitsPerPack : 0;
      const units = pack ? Math.ceil(missing / pack - 1e-9) * pack : Math.ceil(missing - 1e-9);
      const key = p.supplier?.id || '';
      const s = bySupplier.get(key) || { supplierId: p.supplier?.id || null, supplier: p.supplier?.name || 'Sin proveedor', cost: 0, items: [] as any[] };
      s.items.push({ productId: p.id, name: p.name, stock: round2(p.stock || 0), committed: round2(committed), minStock: p.minStock || 0, units, bultos: pack ? units / pack : null, packSize: pack || null, cost: round2(units * (p.costPrice || 0)) });
      s.cost += units * (p.costPrice || 0);
      bySupplier.set(key, s);
    }
    return [...bySupplier.values()]
      .map((s) => ({ ...s, cost: round2(s.cost), items: s.items.sort((a: any, b: any) => a.name.localeCompare(b.name, 'es')) }))
      .sort((a, b) => b.cost - a.cost);
  }
}
