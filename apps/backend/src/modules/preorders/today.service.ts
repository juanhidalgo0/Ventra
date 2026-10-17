import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const bultosOf = (items: any[]) => items.reduce((s, i) => s + (Number(i.packSize) > 1 ? i.quantity / i.packSize : 0), 0);

/** Medianoche de hoy en Argentina (la caja de la nube corre en UTC) */
export function startOfTodayAR(now = new Date()): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Argentina/Buenos_Aires', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return new Date(`${ymd}T00:00:00-03:00`);
}

/**
 * Pantalla "Hoy" de la distribuidora: en un solo pedido, lo que hay que mirar al empezar y
 * durante el día. Pedidos sin reparto por zona, repartos activos y la plata (lo cobrado hoy,
 * lo que está en la calle y quién debe).
 */
@Injectable()
export class TodayService {
  constructor(private prisma: PrismaService) {}

  async summary() {
    const db: any = this.prisma;
    const since = startOfTodayAR();

    // ── Pedidos pendientes sin reparto, por zona ──
    const pending = await db.preOrder.findMany({
      where: { status: 'PENDING', runId: null },
      select: { total: true, createdAt: true, items: { select: { quantity: true, packSize: true } }, client: { select: { locality: true } } },
    });
    const zonesMap = new Map<string, { zone: string; count: number; bultos: number; total: number }>();
    for (const o of pending) {
      const zone = (o.client?.locality || '').trim() || 'Sin localidad';
      const z = zonesMap.get(zone) || { zone, count: 0, bultos: 0, total: 0 };
      z.count++; z.bultos += bultosOf(o.items); z.total += o.total || 0;
      zonesMap.set(zone, z);
    }
    const zones = Array.from(zonesMap.values())
      .map((z) => ({ ...z, total: round2(z.total) }))
      .sort((a, b) => (a.zone === 'Sin localidad' ? 1 : b.zone === 'Sin localidad' ? -1 : b.count - a.count || a.zone.localeCompare(b.zone, 'es')));
    const newToday = pending.filter((o: any) => new Date(o.createdAt) >= since).length;

    // ── Repartos: los que se arman, los que están en la calle y los rendidos hoy ──
    const runs = await db.deliveryRun.findMany({
      where: { OR: [{ status: { in: ['ARMANDO', 'EN_REPARTO'] } }, { status: 'CERRADO', settledAt: { gte: since } }] },
      orderBy: [{ date: 'asc' }, { runNumber: 'asc' }],
      include: { orders: { select: { status: true, saleId: true, total: true, deliveryStatus: true, paidCash: true, paidTransfer: true, prevCash: true, prevTransfer: true, items: { select: { quantity: true, packSize: true } }, client: { select: { locality: true } } } } },
    });
    const runList = runs.map((r: any) => {
      const live = r.orders.filter((o: any) => o.status !== 'CANCELLED');
      const onRoute = live.filter((o: any) => o.status === 'BILLED' && o.saleId);
      return {
        id: r.id, runNumber: r.runNumber, status: r.status, date: r.date, driverName: r.driverName,
        stops: live.length,
        registered: onRoute.filter((o: any) => o.deliveryStatus).length,
        bultos: round2(live.reduce((s: number, o: any) => s + bultosOf(o.items), 0)),
        total: round2(live.reduce((s: number, o: any) => s + (o.total || 0), 0)),
                cashSoFar: round2(onRoute.reduce((s: number, o: any) => s + (o.paidCash || 0) + (o.prevCash || 0), 0)),
        transferSoFar: round2(onRoute.reduce((s: number, o: any) => s + (o.paidTransfer || 0) + (o.prevTransfer || 0), 0)),
        expectedCash: r.expectedCash, cashReceived: r.cashReceived,
        zones: Array.from(new Set(live.map((o: any) => (o.client?.locality || '').trim()).filter(Boolean))).sort(),
      };
    });
    const onStreet = round2(runList.filter((r: any) => r.status === 'EN_REPARTO').reduce((s: number, r: any) => s + r.total, 0));

    // ── Plata de hoy: lo que entró (sin lo fiado) y lo que se vendió ──
    const sales = await db.sale.findMany({
      where: { createdAt: { gte: since }, status: 'COMPLETED' },
      select: { total: true, payments: { select: { method: true, amount: true } }, items: { select: { productId: true } } },
    });
    const byMethod: Record<string, number> = {};
    let sold = 0;
    let soldCount = 0;
    for (const s of sales) {
      for (const p of s.payments) if (p.method !== 'DEBT') byMethod[p.method] = round2((byMethod[p.method] || 0) + p.amount);
      if (!s.items.some((i: any) => i.productId === 'PAGO_CTA_CTE')) { sold += s.total; if (s.total > 0) soldCount++; }
    }
    const collected = round2(Object.values(byMethod).reduce((a, b) => a + b, 0));

    // ── Quién debe ──
    const debtors = await db.client.findMany({
      where: { isActive: true, balance: { gt: 0.009 } },
      select: { id: true, name: true, locality: true, balance: true, creditLimit: true, phone: true },
      orderBy: { balance: 'desc' },
    });
    const owed = round2(debtors.reduce((s: number, c: any) => s + c.balance, 0));
    const overLimit = debtors.filter((c: any) => c.creditLimit != null && c.creditLimit > 0 && c.balance > c.creditLimit);

    return {
      orders: { pending: pending.length, newToday, zones, bultos: round2(zones.reduce((s, z) => s + z.bultos, 0)), total: round2(zones.reduce((s, z) => s + z.total, 0)) },
      runs: runList,
      money: {
        collected, cash: byMethod.CASH || 0, transfer: byMethod.TRANSFERENCIA || 0,
        other: round2(collected - (byMethod.CASH || 0) - (byMethod.TRANSFERENCIA || 0)),
        sold: round2(sold), soldCount, onStreet,
        owed, debtorsCount: debtors.length,
        topDebtors: debtors.slice(0, 5),
        overLimit: overLimit.slice(0, 5),
        overLimitCount: overLimit.length,
      },
    };
  }
}
