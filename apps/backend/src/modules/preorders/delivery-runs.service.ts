import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { numberRange, nextDocNumber } from '../sync/numbering';
import { SalesService } from '../sales/sales.service';
import { FiscalService } from '../fiscal/fiscal.service';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
/** Medio de pago de las transferencias que cobra el chofer (el cierre de caja suma cualquier medio) */
export const TRANSFER_METHOD = 'TRANSFERENCIA';

/** Unidades entregadas de cada renglón: las que cargó el chofer, o todo el pedido si no hubo cambios */
export function deliveredLines(order: any) {
  if (order.deliveryStatus === 'NOT_DELIVERED' || !order.deliveryStatus) return [];
  let changes: Record<string, number> = {};
  try { changes = order.deliveredItems ? JSON.parse(order.deliveredItems) : {}; } catch { changes = {}; }
  return (order.items || [])
    .map((it: any) => ({ ...it, quantity: order.deliveryStatus === 'PARTIAL' && changes[it.id] !== undefined ? Math.max(0, Math.min(Number(changes[it.id]) || 0, it.quantity)) : it.quantity }))
    .filter((it: any) => it.quantity > 0);
}
export const deliveredTotal = (order: any) => round2(deliveredLines(order).reduce((s: number, it: any) => s + it.quantity * it.unitPrice, 0));

const ORDER_INCLUDE = {
    client: { select: { id: true, name: true, address: true, locality: true, phone: true, cuit: true, dni: true, ivaCondition: true, balance: true, creditLimit: true } },
  user: { select: { fullName: true, username: true } },
  items: true,
};

/** Lo que el cliente no se quedó: lo pedido menos lo entregado, renglón por renglón */
export function rejectedLines(order: any) {
  const left = new Map(deliveredLines(order).map((it: any) => [it.id, it.quantity]));
  return (order.items || [])
    .map((it: any) => ({ ...it, quantity: it.quantity - Number(left.get(it.id) || 0) }))
    .filter((it: any) => it.quantity > 0);
}

const packOf = (it: any) => (Number(it.packSize) > 1 && it.quantity % it.packSize === 0 ? it.packSize : undefined);

/**
 * Reparto: los pedidos de preventa que salen juntos un día (un camión o un chofer).
 *
 * 1. Armado: se eligen los pedidos y su orden (hoja de carga y de ruta). Nada se mueve todavía.
 * 2. Salida ("Salió a reparto"): cada pedido queda como venta con su mismo número, a la cuenta
 *    corriente del cliente; el stock sale (la mercadería está en el camión) y, si la facturación
 *    está activa, la factura queda en cola: viaja con la mercadería.
 * 3. Ruta: el chofer anota qué entregó en cada parada y cómo pagó.
 * 4. Rendición: lo cobrado entra a la caja como cobro de la cuenta corriente; lo rechazado (o no
 *    entregado) vuelve al stock con una devolución y su nota de crédito. Lo no entregado vuelve a
 *    quedar pendiente con un número nuevo, para otro reparto.
 * Salida y rendición se pueden repetir si se cortan: cada paso lleva el id del pedido.
 */
@Injectable()
export class DeliveryRunsService {
  constructor(private prisma: PrismaService, private sales: SalesService, private fiscal: FiscalService) {}

  private get db(): any { return this.prisma as any; }

    async list(status?: string, driverUserId?: string) {
    const where: any = {};
    if (status && status !== 'ALL') where.status = status;
    if (driverUserId) where.driverUserId = driverUserId;
    const runs = await this.db.deliveryRun.findMany({
      where, orderBy: [{ date: 'desc' }, { runNumber: 'desc' }], take: 200,
      include: { orders: { select: { id: true, status: true, total: true, items: { select: { quantity: true, packSize: true } }, client: { select: { locality: true } } } } },
    });
    // Resumen para la lista: paradas, bultos, total y zonas
    return runs.map((r: any) => {
      const live = r.orders.filter((o: any) => o.status !== 'CANCELLED');
      const bultos = live.reduce((s: number, o: any) => s + o.items.reduce((t: number, i: any) => t + (Number(i.packSize) > 1 ? i.quantity / i.packSize : 0), 0), 0);
      const zones = Array.from(new Set(live.map((o: any) => (o.client?.locality || '').trim()).filter(Boolean))).sort();
      const { orders, ...run } = r;
      return { ...run, stops: live.length, bultos, total: Math.round(live.reduce((s: number, o: any) => s + (o.total || 0), 0) * 100) / 100, zones };
    });
  }

  async findOne(id: string) {
    const run = await this.db.deliveryRun.findUnique({
      where: { id },
      include: { orders: { include: ORDER_INCLUDE, orderBy: [{ stopOrder: 'asc' }, { createdAt: 'asc' }] } },
    });
        if (!run) throw new NotFoundException('Reparto no encontrado');
    return this.decorate(run);
  }

  /**
   * Lo que el reparto necesita saber además de sus pedidos:
   * - prevDebt: lo que cada cliente ya debía antes de este reparto (su saldo sin lo que se le está
   *   entregando), para cobrárselo en la parada si paga.
   * - shortages: lo que no alcanza en el depósito para cargar el camión (solo mientras se arma).
   */
  private async decorate(run: any) {
    const onRoute = new Map<string, number>();
    if (run.status === 'EN_REPARTO') {
      for (const o of run.orders) if (o.status === 'BILLED' && o.saleId && o.clientId) onRoute.set(o.clientId, (onRoute.get(o.clientId) || 0) + (o.total || 0));
    }
    for (const o of run.orders) {
      o.prevDebt = o.clientId ? round2(Math.max(0, (Number(o.client?.balance) || 0) - (onRoute.get(o.clientId) || 0))) : 0;
    }
    run.shortages = [];
    if (run.status === 'ARMANDO') {
      const need = new Map<string, { name: string; units: number }>();
      for (const o of run.orders) {
        if (o.status !== 'PENDING') continue;
        for (const it of o.items || []) {
          if (!it.productId) continue;
          const n = need.get(it.productId) || { name: it.productName, units: 0 };
          n.units += it.quantity;
          need.set(it.productId, n);
        }
      }
      if (need.size) {
        const products = await this.db.product.findMany({ where: { id: { in: Array.from(need.keys()) } }, select: { id: true, name: true, stock: true, unitsPerPack: true } });
        run.shortages = products
          .filter((p: any) => (p.stock || 0) < need.get(p.id)!.units - 1e-9)
          .map((p: any) => ({ productId: p.id, name: p.name, needed: need.get(p.id)!.units, stock: p.stock || 0, packSize: p.unitsPerPack > 1 ? p.unitsPerPack : null }));
      }
    }
    return run;
  }

    async drivers() {
    const users = await this.db.user.findMany({ where: { isActive: true }, select: { id: true, username: true, fullName: true, role: true, workRole: true } });
    const rank = (u: any) => (u.workRole === 'CHOFER' ? 0 : u.role === 'ADMIN' ? 1 : 2);
    return users
      .map((u: any) => ({ id: u.id, name: u.fullName || u.username, role: u.role, workRole: u.workRole }))
      .sort((a: any, b: any) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'es'));
  }

  /** El chofer elegido de la lista de usuarios: su nombre queda impreso en las hojas */
  private async driverFields(data: any) {
    if (data?.driverUserId === undefined) return {};
    if (!data.driverUserId) return { driverUserId: null };
    const u = await this.db.user.findUnique({ where: { id: String(data.driverUserId) }, select: { id: true, username: true, fullName: true } });
    if (!u) throw new BadRequestException('Ese chofer ya no existe');
    return { driverUserId: u.id, driverName: data?.driverName ? String(data.driverName).slice(0, 80) : (u.fullName || u.username) };
  }

  async create(data: any) {
    const date = data?.date && !isNaN(new Date(data.date).getTime()) ? new Date(data.date) : new Date();
    const orderIds: string[] = Array.isArray(data?.orderIds) ? data.orderIds.map(String) : [];
    if (!orderIds.length) throw new BadRequestException('Elegí al menos un pedido para el reparto');
        const driver = await this.driverFields(data);
    const id = await this.prisma.$transaction(async (tx: any) => {
      const range = await numberRange(tx);
      const last = await tx.deliveryRun.findFirst({ where: { runNumber: { gte: range.from, lt: range.to } }, orderBy: { runNumber: 'desc' } });
      const run = await tx.deliveryRun.create({
        data: {
          runNumber: (last ? last.runNumber : range.from) + 1,
          date,
          driverName: data?.driverName ? String(data.driverName).slice(0, 80) : null,
          vehicle: data?.vehicle ? String(data.vehicle).slice(0, 80) : null,
                    notes: data?.notes ? String(data.notes).slice(0, 500) : null,
          ...driver,
        },
      });
      await this.assign(tx, run.id, orderIds);
      return run.id;
    });
    return this.findOne(id);
  }

  async update(id: string, data: any) {
    const patch: any = {};
    if (data?.driverName !== undefined) patch.driverName = data.driverName ? String(data.driverName).slice(0, 80) : null;
    if (data?.vehicle !== undefined) patch.vehicle = data.vehicle ? String(data.vehicle).slice(0, 80) : null;
    if (data?.notes !== undefined) patch.notes = data.notes ? String(data.notes).slice(0, 500) : null;
        if (data?.date !== undefined && !isNaN(new Date(data.date).getTime())) patch.date = new Date(data.date);
    // Escribir un nombre a mano suelta al usuario chofer; elegirlo de la lista lo ata
    if (data?.driverName !== undefined && data?.driverUserId === undefined) patch.driverUserId = null;
    Object.assign(patch, await this.driverFields(data));
    const current = await this.db.deliveryRun.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Reparto no encontrado');
    if (data?.status !== undefined && data.status !== current.status) {
      throw new BadRequestException(data.status === 'EN_REPARTO' ? 'Usá "Salió a reparto"' : 'El reparto se cierra rindiéndolo');
    }
    await this.db.deliveryRun.update({ where: { id }, data: patch });
    return this.findOne(id);
  }

  async setStops(id: string, orderIds: string[]) {
    const run = await this.db.deliveryRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Reparto no encontrado');
    if (run.status !== 'ARMANDO') throw new BadRequestException('El reparto ya salió: no se pueden cambiar las paradas');
    await this.prisma.$transaction(async (tx: any) => {
      const ids = (Array.isArray(orderIds) ? orderIds : []).map(String);
      await tx.preOrder.updateMany({ where: { runId: id, id: { notIn: ids } }, data: { runId: null, stopOrder: null } });
      await this.assign(tx, id, ids);
    });
    return this.findOne(id);
  }

  /** Deshace el reparto: los pedidos vuelven a estar sueltos para armar otro */
  async remove(id: string) {
    const run = await this.db.deliveryRun.findUnique({ where: { id } });
    if (!run) throw new NotFoundException('Reparto no encontrado');
    if (run.status !== 'ARMANDO') throw new BadRequestException('El reparto ya salió: no se puede deshacer');
    await this.prisma.$transaction(async (tx: any) => {
      await tx.preOrder.updateMany({ where: { runId: id }, data: { runId: null, stopOrder: null } });
      await tx.deliveryRun.delete({ where: { id } });
    });
    return { ok: true };
  }

  async saveDelivery(runId: string, orderId: string, data: any) {
    const run = await this.db.deliveryRun.findUnique({ where: { id: runId } });
    if (!run) throw new NotFoundException('Reparto no encontrado');
    if (run.status !== 'EN_REPARTO') throw new BadRequestException(run.status === 'ARMANDO' ? 'Primero marcá que el reparto salió' : 'El reparto ya se rindió');
    const order = await this.db.preOrder.findUnique({ where: { id: orderId }, include: { items: true } });
    if (!order || order.runId !== runId) throw new NotFoundException('El pedido no está en este reparto');
    if (order.status !== 'BILLED' || !order.saleId) throw new BadRequestException('Este pedido no salió en el reparto');

    const status = String(data?.status || '');
    if (!['DELIVERED', 'PARTIAL', 'NOT_DELIVERED'].includes(status)) throw new BadRequestException('Elegí qué pasó con la entrega');
    const reason = data?.reason ? String(data.reason).slice(0, 200) : null;
    let deliveredItems: string | null = null;
    if (status === 'PARTIAL') {
      const map: Record<string, number> = {};
      for (const it of order.items) {
        const q = Number(data?.items?.[it.id]);
        map[it.id] = Number.isFinite(q) ? Math.max(0, Math.min(q, it.quantity)) : it.quantity;
      }
      deliveredItems = JSON.stringify(map);
    }
    const next = { ...order, deliveryStatus: status, deliveredItems };
    const total = deliveredTotal(next);
    if (status === 'PARTIAL' && total <= 0) throw new BadRequestException('Si no se entregó nada, elegí "No se entregó"');
    const cash = status === 'NOT_DELIVERED' ? 0 : round2(Math.max(0, Number(data?.cash) || 0));
    const transfer = status === 'NOT_DELIVERED' ? 0 : round2(Math.max(0, Number(data?.transfer) || 0));
    if (cash + transfer > total + 0.01) throw new BadRequestException(`Se cobró más de lo entregado (${total})`);
        if (cash + transfer < total - 0.01 && !order.clientId) throw new BadRequestException('Un pedido sin cliente tiene que cobrarse completo');

    // Además pagó algo de lo que ya debía (si no viene, queda lo que estaba anotado)
    const prev: any = {};
    if (data?.prevCash !== undefined || data?.prevTransfer !== undefined) {
      const prevCash = round2(Math.max(0, Number(data?.prevCash) || 0));
      const prevTransfer = round2(Math.max(0, Number(data?.prevTransfer) || 0));
      if (prevCash + prevTransfer > 0) {
        if (!order.clientId) throw new BadRequestException('Un pedido sin cliente no tiene deuda anterior');
        const full = await this.findOne(runId);
        const owed = full.orders.find((o: any) => o.id === orderId)?.prevDebt || 0;
        if (prevCash + prevTransfer > owed + 0.01) throw new BadRequestException(`De antes debía ${owed}: no se puede cobrar más que eso`);
      }
      prev.prevCash = prevCash;
      prev.prevTransfer = prevTransfer;
    }

    await this.db.preOrder.update({
      where: { id: orderId },
      data: { deliveryStatus: status, deliveryReason: reason, deliveredItems, paidCash: cash, paidTransfer: transfer, deliveredAt: new Date(), ...prev },
    });
    return this.findOne(runId);
  }

  /** Marca varias paradas como "Entregado todo", con el mismo medio de pago para todas */
  async saveManyDelivered(runId: string, orderIds: string[], payment: string) {
    const ids = (Array.isArray(orderIds) ? orderIds : []).map(String);
    if (!ids.length) throw new BadRequestException('Elegí las paradas');
    if (!['cash', 'transfer', 'debt'].includes(payment)) throw new BadRequestException('Elegí cómo pagaron');
    const orders = await this.db.preOrder.findMany({ where: { id: { in: ids }, runId }, include: { items: true } });
    if (payment === 'debt' && orders.some((o: any) => !o.clientId)) throw new BadRequestException('Hay paradas sin cliente: esas tienen que cobrarse');
    for (const o of orders) {
      if (o.status !== 'BILLED' || !o.saleId) continue;
      const total = deliveredTotal({ ...o, deliveryStatus: 'DELIVERED', deliveredItems: null });
      await this.saveDelivery(runId, o.id, {
        status: 'DELIVERED',
        cash: payment === 'cash' ? total : 0,
        transfer: payment === 'transfer' ? total : 0,
      });
    }
    return this.findOne(runId);
  }

  /**
   * "Salió a reparto": cada pedido pendiente del reparto queda como venta a la cuenta corriente
   * del cliente, con el número del pedido, y el stock sale. Con la facturación activa, su
   * factura queda en cola (sale sola apenas ARCA responde). Si algo falla, el reparto sigue
   * armándose y se puede volver a intentar: lo que ya salió no se repite.
   */
  async dispatch(runId: string, data: any, userId: string) {
    const run = await this.findOne(runId);
    if (run.status !== 'ARMANDO') throw new BadRequestException('El reparto ya salió');
    const live = run.orders.filter((o: any) => o.status !== 'CANCELLED');
    if (!live.length) throw new BadRequestException('El reparto no tiene pedidos');
    const sessionId = await this.dayCash(userId);
    const invoice = data?.invoice !== 'none' && await this.fiscal.isEnabled();
    const errors: string[] = [];
    const warnings: string[] = [];
    let created = 0;

    for (const order of live) {
      const who = order.client?.name || `Pedido N° ${order.orderNumber}`;
      let saleId = order.saleId as string | null;
      if (order.status === 'PENDING') {
        if (!order.clientId) { errors.push(`${who}: el pedido no tiene cliente`); continue; }
        const total = round2((order.items || []).reduce((s: number, it: any) => s + it.quantity * it.unitPrice, 0));
        try {
          const sale = await this.sales.create(userId, {
            clientSaleId: `run-${order.id}-${order.orderNumber}`,
            sessionId,
            clientId: order.clientId,
            orderId: order.id,
            notes: `Reparto N° ${run.runNumber}${order.notes ? ` · ${order.notes}` : ''}`,
            items: (order.items || []).map((it: any) => ({ productId: it.productId, productName: it.productName, quantity: it.quantity, price: it.unitPrice, packSize: packOf(it) })),
            payments: [{ method: 'DEBT', amount: total }],
          } as any);
          saleId = sale.id;
          created++;
        } catch (err: any) {
          errors.push(`${who}: ${err?.message || 'no se pudo registrar la venta'}`);
          continue;
        }
      }
      if (invoice && saleId) {
        try { await this.fiscal.queueInvoice(saleId, userId); }
        catch (err: any) {
          // Ya facturada (reintento) no es problema; otro motivo se avisa y se factura después desde Facturación
          if (!/ya tiene/i.test(err?.message || '')) warnings.push(`${who}: ${err?.message || 'no se pudo preparar la factura'}`);
        }
      }
    }

    if (!errors.length) await this.db.deliveryRun.update({ where: { id: runId }, data: { status: 'EN_REPARTO' } });
    return { created, errors, warnings, invoiced: invoice, run: await this.findOne(runId) };
  }

  /**
   * Rendición: lo cobrado entra a la caja del día como cobro de la cuenta corriente de cada
   * cliente; lo rechazado o no entregado vuelve al stock con una devolución (que le baja la deuda
   * al cliente) y su nota de crédito si la venta tenía factura. Lo que no se entregó vuelve a
   * quedar pendiente con un número nuevo (o se cancela). Repetirla no duplica nada.
   */
    async settle(runId: string, data: any, userId: string) {
    // La plata la cuenta el encargado: un usuario que solo hace el reparto no rinde su propio camión
    const who = userId ? await this.db.user.findUnique({ where: { id: userId }, select: { role: true, workRole: true } }) : null;
    if (who && who.role !== 'ADMIN' && who.workRole === 'CHOFER') throw new ForbiddenException('La rendición la hace el encargado cuando el camión vuelve');
    const run = await this.findOne(runId);
    if (run.status === 'CERRADO') throw new BadRequestException('El reparto ya se rindió');
    if (run.status !== 'EN_REPARTO') throw new BadRequestException('El reparto todavía no salió');
        const sessionId = data?.sessionId || await this.dayCash(userId);
    const undelivered = data?.undelivered === 'CANCEL' ? 'CANCEL' : 'REPROGRAM';
    // Gastos que el chofer pagó con lo cobrado: salen de la caja y bajan lo que tiene que traer
    const expenses = (Array.isArray(data?.expenses) ? data.expenses : [])
      .map((e: any) => ({ concept: String(e?.concept || 'Gasto').trim().slice(0, 60) || 'Gasto', amount: round2(Number(e?.amount) || 0) }))
      .filter((e: any) => e.amount > 0)
      .slice(0, 20);
    const expensesTotal = round2(expenses.reduce((s: number, e: any) => s + e.amount, 0));
    const invoicing = await this.fiscal.isEnabled();
    const errors: string[] = [];
    const warnings: string[] = [];
    let expectedCash = 0;

    for (const order of run.orders) {
      if (order.status !== 'BILLED' || !order.saleId) continue;
      const who = order.client?.name || `Pedido N° ${order.orderNumber}`;
      const key = `${order.id}-${order.orderNumber}`;
      try {
        // 1. Lo que volvió: devolución por lo rechazado (todo, si no se entregó)
        const back = rejectedLines(order);
        if (back.length) {
          const amount = round2(back.reduce((s: number, it: any) => s + it.quantity * it.unitPrice, 0));
          const reason = order.deliveryStatus === 'NOT_DELIVERED' || !order.deliveryStatus
            ? `No se entregó${order.deliveryReason ? `: ${order.deliveryReason}` : ''}`
            : `Rechazo en la entrega${order.deliveryReason ? `: ${order.deliveryReason}` : ''}`;
          const ret = await this.sales.create(userId, {
            clientSaleId: `rech-${key}`,
            sessionId,
            clientId: order.clientId || undefined,
            notes: `${reason} · Venta N° ${order.orderNumber} · Reparto N° ${run.runNumber}`,
            items: back.map((it: any) => ({ productId: it.productId, productName: it.productName, quantity: -it.quantity, price: it.unitPrice, packSize: packOf(it) })),
            payments: [{ method: 'DEBT', amount: -amount }],
          } as any);
          if (invoicing) {
            try { await this.fiscal.partialCreditNote(order.saleId, ret.id, `${reason} (venta N° ${order.orderNumber})`, userId); }
            catch (err: any) { warnings.push(`${who}: ${err?.message || 'la nota de crédito quedó pendiente'}`); }
          }
        }

                // 2. Lo que pagó: cobro de la cuenta corriente, en la caja del día
        const cash = round2(order.paidCash || 0);
        const transfer = round2(order.paidTransfer || 0);
        if (cash + transfer > 0 && order.clientId) {
          await this.registerCobro(order, run, `cobro-${key}`, cash, transfer, `Cobro en la entrega · Venta N° ${order.orderNumber} · Reparto N° ${run.runNumber}`, sessionId, userId);
          expectedCash += cash;
        }
        // 2b. Lo que pagó de lo que ya debía de antes
        const prevCash = round2(order.prevCash || 0);
        const prevTransfer = round2(order.prevTransfer || 0);
        if (prevCash + prevTransfer > 0 && order.clientId) {
          await this.registerCobro(order, run, `cobroant-${key}`, prevCash, prevTransfer, `Cobro de deuda anterior en la entrega · Reparto N° ${run.runNumber}`, sessionId, userId);
          expectedCash += prevCash;
        }

        // 3. Lo que no se entregó: vuelve a pendiente con número nuevo (el suyo ya es de la venta)
        if (!deliveredLines(order).length) {
          if (undelivered === 'CANCEL') {
            await this.db.preOrder.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
          } else {
            await this.prisma.$transaction(async (tx: any) => {
              const orderNumber = await nextDocNumber(tx);
              await tx.preOrder.update({
                where: { id: order.id },
                data: {
                  status: 'PENDING', saleId: null, runId: null, stopOrder: null, orderNumber,
                                    deliveryStatus: null, deliveryReason: null, deliveredItems: null, paidCash: null, paidTransfer: null, prevCash: null, prevTransfer: null, deliveredAt: null,
                  notes: [order.notes, `Reprogramado (antes N° ${order.orderNumber})`].filter(Boolean).join(' · ').slice(0, 500),
                },
              });
            });
          }
        }
      } catch (err: any) {
        errors.push(`${who}: ${err?.message || 'no se pudo registrar'}`);
      }
    }

    // Con algún error el reparto queda abierto: se corrige y se vuelve a rendir (lo hecho no se repite)
        if (!errors.length) {
      const cashReceived = Number.isFinite(Number(data?.cashReceived)) ? round2(Number(data.cashReceived)) : null;
      const allCash = round2(run.orders.reduce((s: number, o: any) => s + (o.status === 'BILLED' ? (o.paidCash || 0) + (o.prevCash || 0) : 0), 0));
      await this.prisma.$transaction(async (tx: any) => {
        // Cada gasto, como salida de la caja del día (el efectivo cobrado ya entró entero)
        for (let i = 0; i < expenses.length; i++) {
          await tx.cashMovement.create({
            data: { sessionId, userId, type: 'EXPENSE', amount: expenses[i].amount, description: `Gasto del reparto N° ${run.runNumber}: ${expenses[i].concept} [gasto-${runId}-${i}]` },
          });
        }
        await tx.deliveryRun.update({
          where: { id: runId },
          data: {
            status: 'CERRADO', settledAt: new Date(), expectedCash: round2(allCash - expensesTotal), cashReceived, settledBy: userId || null,
            expenses: expenses.length ? JSON.stringify(expenses) : null, expensesTotal: expenses.length ? expensesTotal : null,
          },
        });
      });
    }
    return { errors, warnings, expectedCash: round2(expectedCash - (errors.length ? 0 : expensesTotal)), run: await this.findOne(runId) };
  }

    /**
   * Un cobro de la cuenta corriente del cliente en la caja del día: baja su saldo y queda como
   * venta de "pago de cuenta corriente" (efectivo y/o transferencia). La clave lo hace repetible.
   */
  private async registerCobro(order: any, run: any, key: string, cash: number, transfer: number, description: string, sessionId: string, userId: string) {
    const tag = `[${key}]`;
    const amount = round2(cash + transfer);
    await this.prisma.$transaction(async (tx: any) => {
      if (await tx.accountMovement.findFirst({ where: { clientId: order.clientId, description: { contains: tag } }, select: { id: true } })) return;
      const client = await tx.client.findUnique({ where: { id: order.clientId } });
      await tx.accountMovement.create({
        data: {
          clientId: order.clientId, userId, type: 'PAYMENT', amount,
          balanceBefore: client.balance, balanceAfter: client.balance - amount,
          description: `${description} ${tag}`,
        },
      });
      await tx.client.update({ where: { id: order.clientId }, data: { balance: client.balance - amount } });
    });
    await this.sales.create(userId, {
      clientSaleId: key,
      sessionId,
      clientId: order.clientId,
      notes: description,
      items: [{ productId: 'PAGO_CTA_CTE', productName: `PAGO CUENTA CORRIENTE - ${order.client?.name || ''}`.trim(), quantity: 1, price: amount }],
      payments: [
        ...(cash > 0 ? [{ method: 'CASH', amount: cash }] : []),
        ...(transfer > 0 ? [{ method: TRANSFER_METHOD, amount: transfer }] : []),
      ],
    } as any);
  }

  /**
   * Caja donde entra lo que trae el chofer: la que el usuario tenga abierta o, si no tiene, se
   * abre sola la "caja del día". En una distribuidora nadie abre una caja para rendir un reparto,
   * y un arqueo viejo sin hacer no puede frenar la rendición.
   */
  private async dayCash(userId: string): Promise<string> {
    const open = await this.prisma.cashRegisterSession.findFirst({ where: { userId, status: 'OPEN' }, orderBy: { openedAt: 'desc' } });
    if (open) return open.id;
    const session = await this.prisma.cashRegisterSession.create({
      data: { userId, terminalName: 'Caja del día', openingAmount: 0, openingNotes: 'Abierta sola para la rendición del reparto' },
    });
    await this.prisma.auditLog.create({ data: { userId, entityType: 'CASH_REGISTER', entityId: session.id, action: 'OPEN', newValues: JSON.stringify({ terminalName: 'Caja del día', auto: 'rendición de reparto' }) } });
    return session.id;
  }

  /** Pone los pedidos en el reparto, en ese orden. Un pedido de otro reparto que todavía se arma se pasa a este. */
  private async assign(tx: any, runId: string, orderIds: string[]) {
    const orders = await tx.preOrder.findMany({ where: { id: { in: orderIds } }, include: { run: { select: { status: true } } } });
    const byId = new Map(orders.map((o: any) => [o.id, o]));
    let stop = 1;
    for (const oid of orderIds) {
      const o: any = byId.get(oid);
      if (!o) continue;
      if (o.status !== 'PENDING') continue; // cobrado o cancelado: no sale a repartir
      if (o.runId && o.runId !== runId && o.run?.status !== 'ARMANDO') continue; // ya salió en otro camión
      await tx.preOrder.update({ where: { id: oid }, data: { runId, stopOrder: stop++ } });
    }
  }
}
