import { Injectable, NotFoundException, BadRequestException, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { PRODUCT_WITHOUT_IMAGE } from '../../database/product-select';

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

  private dueTimer: NodeJS.Timeout | null = null;
  private dueNotifiedDay = '';

  onModuleInit() {
    // Una vez por día (desde las 9): pagos a proveedores vencidos o por vencer → campanita
    this.dueTimer = setInterval(() => this.checkDueDaily().catch(() => {}), 60 * 60 * 1000);
    setTimeout(() => this.checkDueDaily().catch(() => {}), 3 * 60_000).unref?.();
  }

  onModuleDestroy() {
    if (this.dueTimer) clearInterval(this.dueTimer);
  }

  /**
   * Lo que se le debe a cada proveedor: las compras "a cuenta" menos lo pagado. Los pagos cubren
   * primero las compras más viejas; las que quedan sin cubrir vencen a los días del plazo de pago
   * del proveedor (si lo tiene cargado).
   */
  async debts(): Promise<Map<string, { debt: number; overdue: number; dueSoon: number; nextDueAt: string | null }>> {
    const [purchases, payments, extras] = await Promise.all([
      (this.prisma as any).purchase.findMany({ where: { paymentStatus: 'OWED', status: { not: 'CANCELLED' } }, select: { supplierId: true, total: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
      (this.prisma as any).supplierPayment.groupBy({ by: ['supplierId'], _sum: { amount: true } }),
      this.extras(),
    ]);
    const paid = new Map<string, number>(payments.map((p: any) => [p.supplierId, Number(p._sum.amount) || 0]));
    const now = Date.now();
    const out = new Map<string, { debt: number; overdue: number; dueSoon: number; nextDueAt: string | null }>();
    for (const p of purchases as any[]) {
      const cur = out.get(p.supplierId) || { debt: 0, overdue: 0, dueSoon: 0, nextDueAt: null };
      let left = paid.get(p.supplierId) || 0;
      const covered = Math.min(left, p.total);
      paid.set(p.supplierId, left - covered);
      const owed = p.total - covered;
      if (owed > 0.5) {
        cur.debt += owed;
        const days = extras.get(p.supplierId)?.paymentDays;
        if (days !== null && days !== undefined) {
          const due = new Date(p.createdAt).getTime() + days * 864e5;
          if (due < now) cur.overdue += owed;
          else if (due < now + 3 * 864e5) cur.dueSoon += owed;
          if (!cur.nextDueAt || due < new Date(cur.nextDueAt).getTime()) cur.nextDueAt = new Date(due).toISOString();
        }
      }
      out.set(p.supplierId, cur);
    }
    for (const v of out.values()) { v.debt = Math.round(v.debt * 100) / 100; v.overdue = Math.round(v.overdue * 100) / 100; v.dueSoon = Math.round(v.dueSoon * 100) / 100; }
    return out;
  }

  async checkDueDaily() {
    const now = new Date();
    const day = now.toDateString();
    if (now.getHours() < 9 || this.dueNotifiedDay === day) return;
    this.dueNotifiedDay = day;
    const [debts, suppliers] = await Promise.all([this.debts(), this.prisma.supplier.findMany({ select: { id: true, name: true } })]);
    const money = (n: number) => `$ ${Math.round(n).toLocaleString('es-AR')}`;
    const lines = suppliers.map((s) => ({ s, d: debts.get(s.id) })).filter((x) => x.d && (x.d.overdue > 0 || x.d.dueSoon > 0))
      .map(({ s, d }) => (d!.overdue > 0 ? `${s.name}: vencido ${money(d!.overdue)}` : `${s.name}: vence pronto ${money(d!.dueSoon)}`));
    if (!lines.length) return;
    await this.prisma.appNotification.create({
      data: { type: 'supplierDue', title: 'Pagos a proveedores', body: lines.slice(0, 5).join(' · ') + (lines.length > 5 ? ` y ${lines.length - 5} más` : ''), url: '/suppliers' },
    }).catch(() => {});
  }

  async findAll(startDate?: string, endDate?: string) {
    const suppliers = await this.prisma.supplier.findMany({
      include: { 
        _count: { select: { products: true, purchases: true } } 
      },
      orderBy: { name: 'asc' },
    });

    const dateFilter: any = {};
    if (startDate) {
      dateFilter.gte = new Date(startDate);
    }
    if (endDate) {
      dateFilter.lte = new Date(endDate);
    }

    const stats = await this.prisma.saleItem.findMany({
      where: {
        product: {
          supplierId: { not: null }
        },
        ...(Object.keys(dateFilter).length > 0 ? {
          sale: {
            createdAt: dateFilter
          }
        } : {})
      },
      select: {
        quantity: true,
        total: true,
        product: {
          select: {
            supplierId: true,
            costPrice: true,
          }
        }
      }
    });

    const supplierStats: Record<string, { productsSold: number; totalSales: number; netProfit: number }> = {};
    stats.forEach(item => {
      const supplierId = item.product.supplierId;
      if (!supplierId) return;

      if (!supplierStats[supplierId]) {
        supplierStats[supplierId] = { productsSold: 0, totalSales: 0, netProfit: 0 };
      }

      const statsObj = supplierStats[supplierId];
      statsObj.productsSold += item.quantity;
      statsObj.totalSales += item.total;
      
      const costOfGoodsSold = item.quantity * (item.product.costPrice || 0);
      statsObj.netProfit += (item.total - costOfGoodsSold);
    });

    const extras = await this.extras();
    const debts = await this.debts();
    return suppliers.map(supplier => ({
      ...supplier,
      ...(extras.get(supplier.id) || { cuit: null, paymentDays: null }),
      ...(debts.get(supplier.id) || { debt: 0, overdue: 0, dueSoon: 0, nextDueAt: null }),
      stats: supplierStats[supplier.id] || { productsSold: 0, totalSales: 0, netProfit: 0 }
    }));
  }

  async findOne(id: string, startDate?: string, endDate?: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: { products: { select: PRODUCT_WITHOUT_IMAGE }, purchases: true }
    });
    if (!supplier) throw new NotFoundException('Proveedor no encontrado');

    const dateFilter: any = {};
    if (startDate) {
      dateFilter.gte = new Date(startDate);
    }
    if (endDate) {
      dateFilter.lte = new Date(endDate);
    }

    const stats = await this.prisma.saleItem.findMany({
      where: {
        product: {
          supplierId: id
        },
        ...(Object.keys(dateFilter).length > 0 ? {
          sale: {
            createdAt: dateFilter
          }
        } : {})
      },
      select: {
        quantity: true,
        total: true,
        product: {
          select: {
            costPrice: true,
          }
        }
      }
    });

    let productsSold = 0;
    let totalSales = 0;
    let netProfit = 0;

    stats.forEach(item => {
      productsSold += item.quantity;
      totalSales += item.total;
      const costOfGoodsSold = item.quantity * (item.product.costPrice || 0);
      netProfit += (item.total - costOfGoodsSold);
    });

    return {
      ...supplier,
      ...((await this.extras()).get(id) || { cuit: null, paymentDays: null }),
      ...((await this.debts()).get(id) || { debt: 0, overdue: 0, dueSoon: 0, nextDueAt: null }),
      stats: {
        productsSold,
        totalSales,
        netProfit
      }
    };
  }

  async create(data: { name: string; contact?: string; phone?: string; email?: string; cuit?: string; paymentDays?: number | string }) {
    const { cuit, paymentDays, ...rest } = data as any;
    const supplier = await this.prisma.supplier.create({ data: rest });
    await this.saveExtras(supplier.id, { cuit, paymentDays });
    return { ...supplier, ...((await this.extras()).get(supplier.id) || {}) };
  }

  async update(id: string, data: any) {
    const { cuit, paymentDays, ...rest } = data || {};
    const supplier = Object.keys(rest).length
      ? await this.prisma.supplier.update({ where: { id }, data: rest })
      : await this.prisma.supplier.findUnique({ where: { id } });
    await this.saveExtras(id, { cuit, paymentDays });
    return { ...supplier, ...((await this.extras()).get(id) || {}) };
  }

  /** CUIT y plazo de pago (columnas fuera del esquema de Prisma, ver prisma.service) */
  private async extras(): Promise<Map<string, { cuit: string | null; paymentDays: number | null }>> {
    const rows = await this.prisma.$queryRawUnsafe<{ id: string; cuit: string | null; payment_days: number | null }[]>(
      `SELECT id, cuit, payment_days FROM suppliers`,
    ).catch((): any[] => []);
    return new Map(rows.map((r) => [r.id, { cuit: r.cuit || null, paymentDays: r.payment_days === null || r.payment_days === undefined ? null : Number(r.payment_days) }] as [string, { cuit: string | null; paymentDays: number | null }]));
  }

  private async saveExtras(id: string, v: { cuit?: string; paymentDays?: number | string }) {
    if (v.cuit !== undefined) {
      const d = String(v.cuit || '').replace(/\D/g, '');
      if (d && d.length !== 11) throw new BadRequestException('El CUIT tiene que tener 11 números');
      await this.prisma.$executeRawUnsafe(`UPDATE suppliers SET cuit = ? WHERE id = ?`, d ? `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}` : null, id);
    }
    if (v.paymentDays !== undefined) {
      const n = v.paymentDays === '' || v.paymentDays === null ? null : Math.max(0, Math.min(365, Math.round(Number(v.paymentDays))));
      await this.prisma.$executeRawUnsafe(`UPDATE suppliers SET payment_days = ? WHERE id = ?`, Number.isFinite(n as number) ? n : null, id);
    }
  }

  async remove(id: string) {
    return this.prisma.supplier.delete({ where: { id } });
  }

  async addPayment(data: { supplierId: string; userId: string; amount: number; method: string; reference?: string; notes?: string }) {
    return (this.prisma as any).supplierPayment.create({ data });
  }
}
