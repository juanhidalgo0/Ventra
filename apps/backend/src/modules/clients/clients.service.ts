import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.client.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: {
        movements: {
          include: {
            sale: {
              include: {
                items: true
              }
            }
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
      },
    });
    if (!client) throw new NotFoundException('Cliente no encontrado');
    return client;
  }

  /**
   * Resumen de cuenta del período (por defecto, el mes en curso): el saldo con el que arrancó, cada
   * movimiento con lo que dejó debiendo, y el saldo al cierre. Las devoluciones (cargos negativos)
   * van del lado de los pagos. Si una venta ya tiene factura, lleva su número.
   */
  async statement(id: string, q: { from?: string; to?: string }) {
    const client = await this.prisma.client.findUnique({ where: { id } });
    if (!client) throw new NotFoundException('Cliente no encontrado');
    const now = new Date();
    const from = q.from && !isNaN(Date.parse(q.from)) ? new Date(q.from) : new Date(now.getFullYear(), now.getMonth(), 1);
    const to = q.to && !isNaN(Date.parse(q.to)) ? new Date(q.to) : now;
    const moves = await this.prisma.accountMovement.findMany({
      where: { clientId: id, createdAt: { gte: from, lte: to } },
      orderBy: { createdAt: 'asc' },
      take: 2000,
      include: { sale: { select: { saleNumber: true, items: { select: { productName: true, quantity: true } }, fiscalDocuments: { select: { kind: true, status: true, invoiceType: true, pointOfSale: true, number: true, assocDocumentId: true } } } } },
    });
    const before = await this.prisma.accountMovement.findFirst({ where: { clientId: id, createdAt: { lt: from } }, orderBy: { createdAt: 'desc' } });
    const after = moves.length ? null : await this.prisma.accountMovement.findFirst({ where: { clientId: id, createdAt: { gt: to } }, orderBy: { createdAt: 'asc' } });
    const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
    const opening = round2(moves[0]?.balanceBefore ?? before?.balanceAfter ?? after?.balanceBefore ?? (before || after ? 0 : client.balance));
    // Número de la factura (suelta o la del mes) de cada venta
    const groupIds = moves.flatMap((m: any) => (m.sale?.fiscalDocuments || []).filter((d: any) => d.status === 'GROUPED' && d.assocDocumentId).map((d: any) => d.assocDocumentId));
    const groups = groupIds.length ? await this.prisma.fiscalDocument.findMany({ where: { id: { in: groupIds } } }) : [];
    const label = (d: any) => d && d.number ? `${(d.invoiceType || 'FACTURA').replace('FACTURA_', 'Factura ')} ${String(d.pointOfSale).padStart(5, '0')}-${String(d.number).padStart(8, '0')}` : null;
    const rows = moves.map((m: any) => {
      const docs = m.sale?.fiscalDocuments || [];
      const own = docs.find((d: any) => d.kind === 'FACTURA' && d.status === 'AUTHORIZED');
      const grouped = docs.find((d: any) => d.status === 'GROUPED');
      const inv = own || (grouped ? groups.find((g) => g.id === grouped.assocDocumentId && g.status === 'AUTHORIZED') : null);
      const items = (m.sale?.items || []).filter((i: any) => i.productName);
      const detail = items.slice(0, 3).map((i: any) => `${Math.abs(i.quantity)} ${i.productName}`).join(', ') + (items.length > 3 ? ` y ${items.length - 3} más` : '');
      const isReturn = m.type === 'DEBT' && m.amount < 0;
      const concept = m.sale
        ? `${isReturn ? 'Devolución' : 'Compra'} N° ${m.sale.saleNumber}`
        : m.type === 'PAYMENT' ? (m.description || 'Pago') : (m.description || 'Cargo');
      return {
        id: m.id, date: m.createdAt, concept, detail: m.sale ? detail : (m.type === 'PAYMENT' ? '' : ''),
        invoice: label(inv), pickedUpBy: m.pickedUpBy || null,
        charge: m.type === 'DEBT' && m.amount > 0 ? round2(m.amount) : 0,
        credit: m.type === 'PAYMENT' ? round2(m.amount) : isReturn ? round2(-m.amount) : 0,
        balance: round2(m.balanceAfter),
      };
    });
    const charges = round2(rows.reduce((t, r) => t + r.charge, 0));
    const credits = round2(rows.reduce((t, r) => t + r.credit, 0));
    return {
      client: { id: client.id, name: client.name, cuit: client.cuit, dni: client.dni, address: client.address, locality: (client as any).locality, phone: client.phone, ivaCondition: client.ivaCondition },
      from, to, opening, charges, credits,
      closing: rows.length ? rows[rows.length - 1].balance : opening,
      currentBalance: client.balance,
      rows,
    };
  }

  /**
   * El saldo se mueve con cobros y ventas a cuenta (addMovement). Ponerlo a mano (saldo inicial,
   * corregirlo) solo puede el administrador: un empleado no puede borrar una deuda editando.
   */
  private clean(data: any, canSetBalance: boolean) {
    const { id, createdAt, updatedAt, balance, ...rest } = data || {};
    return canSetBalance && balance !== undefined ? { ...rest, balance } : rest;
  }

  async create(data: any, canSetBalance = false) {
    return this.prisma.client.create({ data: this.clean(data, canSetBalance) });
  }

  async update(id: string, data: any, canSetBalance = false) {
    return this.prisma.client.update({ where: { id }, data: this.clean(data, canSetBalance) });
  }

  async addMovement(clientId: string, data: { type: 'DEBT' | 'PAYMENT', amount: number, description?: string, saleId?: string, userId: string }) {
    return this.prisma.$transaction(async (tx) => {
      const client = await tx.client.findUnique({ where: { id: clientId } });
      if (!client) throw new NotFoundException('Cliente no encontrado');

      const balanceBefore = client.balance;
      const balanceAfter = data.type === 'DEBT' ? balanceBefore + data.amount : balanceBefore - data.amount;

      const movement = await tx.accountMovement.create({
        data: {
          clientId,
          saleId: data.saleId,
          userId: data.userId,
          type: data.type,
          amount: data.amount,
          balanceBefore,
          balanceAfter,
          description: data.description,
        },
      });

      await tx.client.update({
        where: { id: clientId },
        data: { balance: balanceAfter },
      });

      return movement;
    });
  }

  async remove(id: string) {
    return this.prisma.$transaction(async (tx) => {
      // 1. Delete all current account movements for this client
      await tx.accountMovement.deleteMany({ where: { clientId: id } });
      // 2. Dissociate the client from sales to preserve sales reports
      await tx.sale.updateMany({ where: { clientId: id }, data: { clientId: null } });
      // 3. Delete the client record
      return tx.client.delete({ where: { id } });
    });
  }
}
