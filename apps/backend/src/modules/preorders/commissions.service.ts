import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { deliveredLines } from './delivery-runs.service';
import { ensureMonthFund, monthRange, MONTH_FUND_ID } from '../cash-register/month-fund';
import { CashRegisterService } from '../cash-register/cash-register.service';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Clave del ajuste compartido con la PC: % de comisión de todos los vendedores (Informes) */
export const GENERAL_PCT_KEY = 'seller_commission_pct';
/** De dónde sale la plata con la que se le paga al vendedor */
export type CommissionSource = 'FUND' | 'SESSION' | 'TRANSFER';

/**
 * Comisiones de los vendedores de la preventa.
 *
 * - Cada vendedor cobra un % de lo que el cliente recibió (lo rechazado no cuenta). Si el dueño
 *   no le puso un % propio, vale el general de Informes.
 * - Cuenta para el mes en que se rindió el reparto: ahí se sabe qué se entregó.
 * - Los pagos quedan anotados por vendedor y mes (se puede pagar en partes). El efectivo sale de la
 *   caja del mes o de una caja abierta como gasto "Sueldos / Adelantos"; la transferencia solo se anota.
 */
@Injectable()
export class CommissionsService {
  constructor(private prisma: PrismaService, private cash: CashRegisterService) {}

  private get db(): any { return this.prisma as any; }

  private async generalPct(): Promise<number> {
    const row = await this.db.storeSetting.findUnique({ where: { id: GENERAL_PCT_KEY } }).catch(() => null);
    let v: any = row?.value;
    try { v = JSON.parse(v); } catch { /* ya era texto */ }
    const n = Number(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
  }

  async month(month?: string) {
    const { from, to, key } = monthRange(month);
    const general = await this.generalPct();
    const orders: any[] = await this.db.preOrder.findMany({
      where: { deliveryStatus: { in: ['DELIVERED', 'PARTIAL'] }, run: { status: 'CERRADO', settledAt: { gte: from, lt: to } } },
      include: { items: true },
      take: 50000,
    });
    const payments: any[] = await this.db.sellerCommissionPayment.findMany({ where: { month: key }, orderBy: { createdAt: 'asc' } });

    const bySeller = new Map<string, { delivered: number; orders: number }>();
    for (const o of orders) {
      const got = round2(deliveredLines(o).reduce((s: number, it: any) => s + it.quantity * it.unitPrice, 0));
      const s = bySeller.get(o.userId) || { delivered: 0, orders: 0 };
      s.delivered += got; s.orders++;
      bySeller.set(o.userId, s);
    }
    // Los vendedores aparecen aunque este mes no hayan vendido (para ponerles su %)
    const users: any[] = await this.db.user.findMany({
      where: { OR: [{ id: { in: [...bySeller.keys(), ...payments.map((p) => p.userId)] } }, { workRole: 'VENDEDOR', isActive: true }] },
      select: { id: true, fullName: true, username: true, workRole: true, commissionPct: true },
    });
    const sellers = users.map((u) => {
      const s = bySeller.get(u.id) || { delivered: 0, orders: 0 };
      const pct = u.commissionPct ?? general;
      const commission = round2(s.delivered * pct / 100);
      const paidList = payments.filter((p) => p.userId === u.id);
      const paid = round2(paidList.reduce((t, p) => t + p.amount, 0));
      return {
        userId: u.id, name: u.fullName || u.username, workRole: u.workRole,
        orders: s.orders, delivered: round2(s.delivered),
        pct, ownPct: u.commissionPct ?? null, commission, paid, owed: round2(Math.max(0, commission - paid)),
        payments: paidList.map((p) => ({ id: p.id, amount: p.amount, source: p.source, notes: p.notes, by: p.createdBy, at: p.createdAt })),
      };
    }).sort((a, b) => b.commission - a.commission || a.name.localeCompare(b.name));

    return {
      month: key, generalPct: general, sellers,
      totals: {
        commission: round2(sellers.reduce((t, s) => t + s.commission, 0)),
        paid: round2(sellers.reduce((t, s) => t + s.paid, 0)),
        owed: round2(sellers.reduce((t, s) => t + s.owed, 0)),
      },
    };
  }

  /** % propio de un vendedor; null vuelve al general */
  async setPct(userId: string, pct: any) {
    const user = await this.db.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    let value: number | null = null;
    if (pct !== null && pct !== undefined && String(pct).trim() !== '') {
      value = Number(String(pct).replace(',', '.'));
      if (!Number.isFinite(value) || value < 0 || value > 100) throw new BadRequestException('El % tiene que estar entre 0 y 100');
      value = round2(value);
    }
    await this.db.user.update({ where: { id: userId }, data: { commissionPct: value } });
    return { userId, ownPct: value };
  }

  async pay(byUserId: string, data: { userId: string; month?: string; amount: number; source: CommissionSource; sessionId?: string; notes?: string }) {
    const { key } = monthRange(data?.month);
    const amount = round2(Number(data?.amount));
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('Ingresá cuánto le pagás');
    if (!['FUND', 'SESSION', 'TRANSFER'].includes(data?.source)) throw new BadRequestException('Elegí de dónde sale la plata');
    const state = await this.month(key);
    const seller = state.sellers.find((s) => s.userId === data.userId);
    if (!seller) throw new NotFoundException('Vendedor no encontrado');
    if (amount > seller.owed + 0.01) throw new BadRequestException(`Le corresponden ${seller.owed} de ${key}: no se le puede pagar más`);
    const by = await this.db.user.findUnique({ where: { id: byUserId }, select: { fullName: true, username: true } }).catch(() => null);
    const notes = String(data?.notes || '').trim().slice(0, 200) || null;

    let sessionId: string | null = null;
    if (data.source === 'FUND') {
      await ensureMonthFund(this.db, byUserId);
      sessionId = MONTH_FUND_ID;
    } else if (data.source === 'SESSION') {
      const s = data.sessionId ? await this.db.cashRegisterSession.findUnique({ where: { id: data.sessionId } }) : null;
      if (!s || s.status !== 'OPEN') throw new BadRequestException('Elegí una caja abierta');
      sessionId = s.id;
    }

    // El gasto entra por el mismo camino que uno cargado a mano: descuenta del efectivo y se ve en Gastos
    let movementId: string | null = null;
    if (sessionId) {
      const mv: any = await this.cash.addCashMovement(sessionId, byUserId, {
        type: 'EXPENSE', amount, description: `[Sueldos / Adelantos] COMISION ${String(seller.name).toUpperCase()} ${key} | METODO: CASH`,
      }, 'ADMIN');
      movementId = mv?.id || null;
    }
    let payment: any;
    try {
      payment = await this.db.sellerCommissionPayment.create({
        data: { userId: data.userId, month: key, amount, source: data.source, sessionId, movementId, notes, createdBy: by?.fullName || by?.username || null },
      });
    } catch (err) {
      if (movementId) await this.db.cashMovement.delete({ where: { id: movementId } }).catch(() => {});
      throw err;
    }
    return { payment, ...(await this.month(key)) };
  }
}
