import { Injectable, BadRequestException, NotFoundException, ForbiddenException, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { SalesService } from '../sales/sales.service';
import { NotifyService } from '../subscription/notify.service';
import { numberRange } from '../sync/numbering';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const STATUSES = ['PENDIENTE', 'EN_PROCESO', 'LISTO', 'ENTREGADO', 'CANCELADO'];
const PRIORITIES = ['ALTA', 'MEDIA', 'BAJA'];
const OPEN = ['PENDIENTE', 'EN_PROCESO', 'LISTO'];
/** Cada cuánto se revisa si hay encargos para avisar (el aviso sale una vez por encargo y por día) */
const REMINDER_EVERY_MS = 30 * 60_000;

/**
 * Roles de la imprenta (los elige el dueño en Usuarios). Mostrador, o un empleado sin rol, atiende:
 * toma encargos, cobra y entrega. Taller y Diseño solo trabajan: ven los trabajos sin precios y
 * cambian el estado; Diseño además corrige las notas y el detalle. El dueño hace todo, y lo que
 * toca plata ya cobrada (cancelar con seña, cambiar el total con seña) pide su clave.
 */
const PRODUCTION_ROLES = ['TALLER', 'DISENO'];
export interface Actor { sub: string; role?: string; workRole?: string | null }
const isOwner = (u?: Actor) => u?.role === 'ADMIN';
const productionRole = (u?: Actor) => (!isOwner(u) && PRODUCTION_ROLES.includes(String(u?.workRole)) ? String(u?.workRole) : null);

const ACTION_LABEL: Record<string, string> = {
  CREATE: 'Tomó el encargo', EDIT: 'Editó el encargo', STATUS: 'Cambió el estado', NOTES: 'Corrigió las notas',
  NOTIFIED: 'Avisó por WhatsApp', COLLECT: 'Cobró una seña', DELIVER: 'Entregó', CANCEL: 'Canceló',
};

const INCLUDE = {
  client: { select: { id: true, name: true, phone: true, address: true, locality: true, cuit: true, balance: true } },
  user: { select: { fullName: true, username: true } },
  items: true,
};

/**
 * Encargos (imprenta, trabajos a pedido): se toman con o sin seña, se trabajan por estados
 * (pendiente → en proceso → listo) y se entregan en una fecha. Al entregarse se vuelven una venta.
 *
 * La seña es un cobro a cuenta del cliente: entra a la caja ese día y le queda a favor (saldo
 * negativo). Al entregar, la venta se paga con ese saldo (cuenta corriente) y el resto con el
 * medio que elija. Así la plata se ve el día que entró y la venta el día que se entregó, sin
 * contar nada dos veces.
 */
@Injectable()
export class WorkOrdersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Encargos');
  private timer: NodeJS.Timeout | null = null;

  constructor(private prisma: PrismaService, private sales: SalesService, private notify: NotifyService) {}

  private get db(): any { return this.prisma as any; }

  onModuleInit() {
    this.timer = setInterval(() => this.remind().catch(() => {}), REMINDER_EVERY_MS);
    this.timer.unref?.();
    setTimeout(() => this.remind().catch(() => {}), 90_000).unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  list(q: { status?: string; search?: string; from?: string; to?: string; clientId?: string }, user?: Actor) {
    return this.listAll(q).then((rows: any[]) => (productionRole(user) ? rows.map((o) => this.withoutPrices(o)) : rows));
  }

  private listAll(q: { status?: string; search?: string; from?: string; to?: string; clientId?: string }) {
    const where: any = {};
    if (!q.status || q.status === 'ACTIVOS') where.status = { in: OPEN };
    else if (q.status !== 'TODOS') where.status = q.status;
    if (q.clientId) where.clientId = q.clientId;
    if (q.from || q.to) {
      where.receivedAt = {};
      if (q.from) where.receivedAt.gte = new Date(q.from);
      if (q.to) where.receivedAt.lte = new Date(q.to);
    }
    if (q.search) {
      const s = String(q.search).trim();
      const n = Number(s);
      where.OR = [
        { client: { name: { contains: s } } },
        { notes: { contains: s } },
        { items: { some: { description: { contains: s } } } },
        ...(Number.isInteger(n) && n > 0 ? [{ number: n }] : []),
      ];
    }
    return this.db.workOrder.findMany({ where, include: INCLUDE, orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }], take: 500 });
  }

  async findOne(id: string) {
    const order = await this.db.workOrder.findUnique({ where: { id }, include: INCLUDE });
    if (!order) throw new NotFoundException('Encargo no encontrado');
    return order;
  }

  /** El encargo como lo ve quien pregunta (Taller y Diseño, sin precios), con quién hizo cada cosa */
  async findForUser(id: string, user?: Actor) {
    const order = await this.findOne(id);
    const logs = await this.db.auditLog.findMany({
      where: { entityType: 'WORK_ORDER', entityId: id },
      include: { user: { select: { fullName: true, username: true } } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    });
    const hide = !!productionRole(user);
    const history = logs.map((l: any) => {
      let extra: any = {};
      try { extra = l.newValues ? JSON.parse(l.newValues) : {}; } catch { /* sin detalle */ }
      return {
        at: l.createdAt,
        who: l.user?.fullName || l.user?.username || 'Alguien',
        action: l.action,
        label: ACTION_LABEL[l.action] || l.action,
        // Taller y Diseño no ven importes: solo el estado
        detail: hide ? extra.status || null : extra.detail || extra.status || null,
        byOwner: !!extra.ownerKey,
      };
    });
    return { ...(hide ? this.withoutPrices(order) : order), history };
  }

  /** Taller y Diseño no ven importes: ni precios, ni total, ni seña */
  private withoutPrices(o: any) {
    return { ...o, total: null, deposit: null, pricesHidden: true, items: (o.items || []).map((i: any) => ({ ...i, unitPrice: null, total: null })) };
  }

  private log(userId: string | undefined, id: string, action: string, extra: any = {}) {
    return this.db.auditLog.create({ data: { userId: userId || null, entityType: 'WORK_ORDER', entityId: id, action, newValues: JSON.stringify(extra) } })
      .catch((e: any) => this.logger.warn(`No se pudo anotar el movimiento del encargo: ${e?.message}`));
  }

  /** Atender (tomar, cobrar, entregar, avisar, cancelar) es de Mostrador y del dueño, no de Taller ni Diseño */
  private assertCanAttend(user?: Actor) {
    if (productionRole(user)) throw new ForbiddenException('Eso lo hace el mostrador o el dueño');
  }

  /**
   * Lo que toca plata ya cobrada lo hace el dueño: o es él, o un empleado pone su clave en el momento.
   * Sin la clave responde needsAdmin, así la pantalla la pide y vuelve a intentar.
   * Devuelve true si se autorizó con la clave (queda anotado en el historial).
   */
  private async assertOwner(user: Actor | undefined, adminPassword: any, what: string): Promise<boolean> {
    if (isOwner(user)) return false;
    const pass = String(adminPassword || '');
    if (pass) {
      const admins = await this.db.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { passwordHash: true } });
      for (const a of admins) if (await bcrypt.compare(pass, a.passwordHash)) return true;
      throw new ForbiddenException({ message: 'La clave del administrador no es correcta', needsAdmin: true });
    }
    throw new ForbiddenException({ message: `${what} lo autoriza el dueño: hace falta la clave del administrador`, needsAdmin: true });
  }

  /**
   * Crea o corrige un encargo. El id lo pone la pantalla: repetir el envío no lo duplica.
   * El cliente puede venir elegido (clientId) o nuevo (clientName + clientPhone): se da de alta,
   * o se usa el que ya tenga ese teléfono, porque el aviso de "listo" va por WhatsApp.
   */
  async save(id: string, data: any, user?: Actor) {
    this.assertCanAttend(user);
    const userId = user?.sub as string;
    if (!/^[\w-]{8,64}$/.test(id || '')) throw new BadRequestException('Encargo inválido');
    const items = (Array.isArray(data?.items) ? data.items : [])
      .map((i: any) => {
        const quantity = Number(i.quantity);
        const unitPrice = Number(i.unitPrice);
        return {
          productId: i.productId ? String(i.productId) : null,
          description: String(i.description || '').trim().slice(0, 200),
          specs: i.specs ? String(i.specs).trim().slice(0, 1000) : null,
          quantity, unitPrice,
          total: round2(quantity * unitPrice),
        };
      })
      .filter((i: any) => i.description && Number.isFinite(i.quantity) && i.quantity > 0 && Number.isFinite(i.unitPrice) && i.unitPrice >= 0);
    if (!items.length) throw new BadRequestException('Cargá al menos un trabajo');
    const total = round2(items.reduce((s: number, i: any) => s + i.total, 0));
    const priority = PRIORITIES.includes(data?.priority) ? data.priority : 'MEDIA';
    const dueAt = data?.dueAt && !isNaN(new Date(data.dueAt).getTime()) ? new Date(data.dueAt) : null;
    const receivedAt = data?.receivedAt && !isNaN(new Date(data.receivedAt).getTime()) ? new Date(data.receivedAt) : undefined;
    const notes = data?.notes ? String(data.notes).slice(0, 2000) : null;

    // Con seña cobrada, cambiar el total (precio o descuento) lo autoriza el dueño
    const before = await this.db.workOrder.findUnique({ where: { id } });
    let ownerKey = false;
    if (before && OPEN.includes(before.status) && before.deposit > 0 && Math.abs(total - before.total) > 0.009) {
      ownerKey = await this.assertOwner(user, data?.adminPassword, 'Cambiar el precio de un encargo con seña');
    }

    const saved = await this.prisma.$transaction(async (tx: any) => {
      const clientId = await this.clientFor(tx, data);
      const existing = await tx.workOrder.findUnique({ where: { id } });
      if (existing) {
        if (!OPEN.includes(existing.status)) throw new BadRequestException(existing.status === 'ENTREGADO' ? 'Este encargo ya se entregó: no se puede cambiar' : 'Este encargo está cancelado');
        if (total + 0.009 < existing.deposit) throw new BadRequestException(`El total no puede ser menor que la seña cobrada (${existing.deposit})`);
        if (existing.deposit > 0 && clientId !== existing.clientId) throw new BadRequestException('Este encargo ya tiene seña: no se le puede cambiar el cliente');
        await tx.workOrderItem.deleteMany({ where: { orderId: id } });
        return tx.workOrder.update({
          where: { id },
          data: { clientId, priority, dueAt, notes, total, ...(receivedAt ? { receivedAt } : {}), items: { create: items } },
          include: INCLUDE,
        });
      }
      const range = await numberRange(tx);
      const last = await tx.workOrder.findFirst({ where: { number: { gte: range.from, lt: range.to } }, orderBy: { number: 'desc' } });
      return tx.workOrder.create({
        data: {
          id, number: (last ? last.number : range.from) + 1, clientId, userId, priority, dueAt, notes, total,
          source: data?.source === 'TIENDA' ? 'TIENDA' : 'LOCAL',
          onlineOrderId: data?.onlineOrderId ? String(data.onlineOrderId).slice(0, 100) : null,
          ...(receivedAt ? { receivedAt } : {}),
          items: { create: items },
        },
        include: INCLUDE,
      });
    });
    if (!before) await this.log(userId, id, 'CREATE', { detail: `Total ${total}` });
    else await this.log(userId, id, 'EDIT', { detail: Math.abs(total - before.total) > 0.009 ? `Total ${before.total} → ${total}` : null, ownerKey });
    return saved;
  }

  private async clientFor(tx: any, data: any): Promise<string | null> {
    if (data?.clientId) {
      const c = await tx.client.findUnique({ where: { id: String(data.clientId) }, select: { id: true } });
      if (!c) throw new BadRequestException('El cliente del encargo no existe');
      return c.id;
    }
    const name = String(data?.clientName || '').trim();
    if (!name) return null;
    const phone = String(data?.clientPhone || '').replace(/[^\d+]/g, '').slice(0, 30) || null;
    if (phone) {
      const digits = phone.replace(/\D/g, '').slice(-10);
      const same = (await tx.client.findMany({ where: { isActive: true, phone: { not: null } }, select: { id: true, phone: true } }))
        .find((c: any) => String(c.phone).replace(/\D/g, '').slice(-10) === digits);
      if (same) return same.id;
    }
    const c = await tx.client.create({ data: { name: name.slice(0, 120), phone } });
    return c.id;
  }

  /** Pendiente, en proceso o listo. Entregar y cancelar tienen su propio paso. */
  async setStatus(id: string, status: string, user?: Actor) {
    if (!['PENDIENTE', 'EN_PROCESO', 'LISTO'].includes(status)) throw new BadRequestException('Estado inválido');
    const order = await this.findOne(id);
    if (!OPEN.includes(order.status)) throw new BadRequestException('Este encargo ya está cerrado');
    await this.db.workOrder.update({ where: { id }, data: { status, readyAt: status === 'LISTO' ? (order.readyAt || new Date()) : null } });
    if (order.status !== status) await this.log(user?.sub, id, 'STATUS', { status });
    return this.findForUser(id, user);
  }

  /** Notas del encargo y detalle de cada trabajo: lo corrige Diseño (y Mostrador o el dueño). Taller no. */
  async updateNotes(id: string, data: any, user?: Actor) {
    if (productionRole(user) === 'TALLER') throw new ForbiddenException('Las notas las corrige diseño, el mostrador o el dueño');
    const order = await this.findOne(id);
    if (!OPEN.includes(order.status)) throw new BadRequestException('Este encargo ya está cerrado');
    const specs = data?.specs && typeof data.specs === 'object' ? data.specs : {};
    await this.prisma.$transaction(async (tx: any) => {
      if (data?.notes !== undefined) await tx.workOrder.update({ where: { id }, data: { notes: data.notes ? String(data.notes).slice(0, 2000) : null } });
      for (const it of order.items) {
        if (specs[it.id] === undefined) continue;
        await tx.workOrderItem.update({ where: { id: it.id }, data: { specs: specs[it.id] ? String(specs[it.id]).trim().slice(0, 1000) : null } });
      }
    });
    await this.log(user?.sub, id, 'NOTES');
    return this.findForUser(id, user);
  }

  /** Se avisó al cliente por WhatsApp (el mensaje lo manda la persona desde su teléfono) */
  async markNotified(id: string, user?: Actor) {
    this.assertCanAttend(user);
    await this.findOne(id);
    await this.db.workOrder.update({ where: { id }, data: { notifiedAt: new Date() } });
    await this.log(user?.sub, id, 'NOTIFIED');
    return this.findForUser(id, user);
  }

  /**
   * Cobra una seña (o un pago a cuenta antes de entregar): entra a la caja como cobro a cuenta del
   * cliente y le queda a favor. `key` hace idempotente el cobro (repetir el envío no cobra dos veces).
   */
  async collect(id: string, data: any, user?: Actor) {
    this.assertCanAttend(user);
    const userId = user?.sub as string;
    const order = await this.findOne(id);
    if (!OPEN.includes(order.status)) throw new BadRequestException('Este encargo ya está cerrado');
    if (!order.clientId) throw new BadRequestException('Para cobrar una seña, el encargo tiene que tener cliente');
    const amount = round2(Number(data?.amount) || 0);
    if (!(amount > 0)) throw new BadRequestException('Poné cuánto deja de seña');
    if (amount > round2(order.total - order.deposit) + 0.009) throw new BadRequestException('La seña no puede ser mayor que lo que falta pagar');
    const method = String(data?.method || 'CASH');
    const key = String(data?.key || '').replace(/[^\w-]/g, '').slice(0, 40) || `${Date.now()}`;
    const saleId = `sena-${id}-${key}`;
    if (await this.db.sale.findUnique({ where: { id: saleId } })) return this.findForUser(id, user);
    const tag = `[${saleId}]`;
    await this.prisma.$transaction(async (tx: any) => {
      const client = await tx.client.findUnique({ where: { id: order.clientId } });
      await tx.accountMovement.create({
        data: {
          clientId: order.clientId, userId, type: 'PAYMENT', amount,
          balanceBefore: client.balance, balanceAfter: client.balance - amount,
          description: `Seña del encargo N° ${order.number} ${tag}`,
        },
      });
      await tx.client.update({ where: { id: order.clientId }, data: { balance: client.balance - amount } });
    });
    await this.sales.create(userId, {
      clientSaleId: saleId,
      sessionId: data?.sessionId,
      clientId: order.clientId,
      notes: `Seña del encargo N° ${order.number}`,
      items: [{ productId: 'PAGO_CTA_CTE', productName: `SEÑA ENCARGO N° ${order.number} - ${order.client?.name || ''}`.trim(), quantity: 1, price: amount }],
      payments: [{ method, amount }],
    } as any);
    await this.db.workOrder.update({ where: { id }, data: { deposit: round2(order.deposit + amount) } });
    await this.log(userId, id, 'COLLECT', { detail: `${amount} (${method})` });
    return this.findForUser(id, user);
  }

  /**
   * Entrega: el encargo se vuelve una venta con sus trabajos. La seña ya cobrada se descuenta del
   * saldo a favor del cliente; el resto se paga con lo que mande `payments` (o queda a cuenta).
   */
  async deliver(id: string, data: any, user?: Actor) {
    this.assertCanAttend(user);
    const userId = user?.sub as string;
    const order = await this.findOne(id);
    if (order.status === 'ENTREGADO') return this.findForUser(id, user);
    if (!OPEN.includes(order.status)) throw new BadRequestException('Este encargo está cancelado');
    const rest = round2(order.total - order.deposit);
    const payments = (Array.isArray(data?.payments) ? data.payments : [])
      .map((p: any) => ({ method: String(p.method || 'CASH'), amount: round2(Number(p.amount) || 0) }))
      .filter((p: any) => p.amount > 0);
    const paid = round2(payments.reduce((s: number, p: any) => s + p.amount, 0));
    if (Math.abs(paid - rest) > 0.009) throw new BadRequestException(`Falta cobrar ${rest}: lo que se pagó no coincide`);
    if (payments.some((p: any) => p.method === 'DEBT') && !order.clientId) throw new BadRequestException('Para dejarlo a cuenta, el encargo tiene que tener cliente');
    const saleId = `enc-${id}`;
    if (!(await this.db.sale.findUnique({ where: { id: saleId } }))) {
      await this.sales.create(userId, {
        clientSaleId: saleId,
        sessionId: data?.sessionId,
        clientId: order.clientId || undefined,
        notes: `Encargo N° ${order.number}`,
        items: order.items.map((it: any) => ({
          productId: it.productId || 'VENTA_RAPIDA',
          productName: it.productId ? it.description : `${it.description}${it.specs ? ` (${it.specs.slice(0, 80)})` : ''}`,
          quantity: it.quantity, price: it.unitPrice,
        })),
        payments: [
          ...(order.deposit > 0 ? [{ method: 'DEBT', amount: round2(order.deposit) }] : []),
          ...payments,
        ],
      } as any);
    }
    await this.db.workOrder.update({ where: { id }, data: { status: 'ENTREGADO', saleId, deliveredAt: new Date(), readyAt: order.readyAt || new Date() } });
    await this.log(userId, id, 'DELIVER', { detail: rest > 0 ? `Cobró ${rest}` : null });
    return this.findForUser(id, user);
  }

  /** Cancela. Si había seña, queda a favor del cliente (se le devuelve o se usa en otro encargo). */
  async cancel(id: string, data: any, user?: Actor) {
    this.assertCanAttend(user);
    const order = await this.findOne(id);
    if (order.status === 'ENTREGADO') throw new BadRequestException('Este encargo ya se entregó: para devolverlo, anulá la venta');
    if (order.status === 'CANCELADO') return this.findForUser(id, user);
    // Con seña cobrada, la plata queda a favor del cliente: eso lo decide el dueño
    const ownerKey = order.deposit > 0 ? await this.assertOwner(user, data?.adminPassword, 'Cancelar un encargo con seña') : false;
    await this.db.workOrder.update({ where: { id }, data: { status: 'CANCELADO' } });
    await this.log(user?.sub, id, 'CANCEL', { detail: order.deposit > 0 ? `Seña de ${order.deposit} a favor del cliente` : null, ownerKey });
    return this.findForUser(id, user);
  }

  /**
   * Recordatorio al dueño: los encargos sin entregar que vencen mañana o ya se atrasaron, una vez
   * por día (desde las 9). Va a la campanita y al celular, agrupados en un solo aviso.
   */
  async remind(now = new Date()) {
    if (now.getHours() < 9) return [];
    const tomorrowEnd = new Date(now); tomorrowEnd.setDate(tomorrowEnd.getDate() + 1); tomorrowEnd.setHours(23, 59, 59, 999);
    const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
    const due: any[] = await this.db.workOrder.findMany({
      where: { status: { in: OPEN }, dueAt: { not: null, lte: tomorrowEnd }, OR: [{ remindedAt: null }, { remindedAt: { lt: dayStart } }] },
      include: { client: { select: { name: true } } },
      orderBy: { dueAt: 'asc' },
    });
    if (!due.length) return [];
    const fmt = (d: Date) => d.toLocaleString('es-AR', { weekday: 'short', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' });
    const items = due.map((o) => ({ number: o.number, client: o.client?.name || 'Sin cliente', when: fmt(new Date(o.dueAt)), late: new Date(o.dueAt).getTime() < now.getTime() }));
    this.notify.enqueue('workOrderDue', { items });
    await this.db.workOrder.updateMany({ where: { id: { in: due.map((o) => o.id) } }, data: { remindedAt: now } });
    this.logger.log(`Recordatorio de ${items.length} encargo(s) para entregar`);
    return items;
  }
}
