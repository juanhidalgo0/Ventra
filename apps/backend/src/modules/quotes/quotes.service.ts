import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class QuotesService {
  constructor(private prisma: PrismaService) {}

  async findAll(status?: string) {
    const where: any = {};
    if (status) {
      where.status = status;
    }
    return (this.prisma as any).quote.findMany({
      where,
      include: {
        user: { select: { id: true, fullName: true, username: true } },
        items: { include: { product: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async findOne(id: string) {
    const quote = await (this.prisma as any).quote.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, fullName: true, username: true } },
        items: { include: { product: true } }
      }
    });
    if (!quote) throw new NotFoundException(`Presupuesto ${id} no encontrado`);
    return quote;
  }

  async create(data: {
    clientName?: string;
    clientPhone?: string;
    userId: string;
    notes?: string;
    validDays?: number;
    items: Array<{
      productId?: string;
      productName: string;
      unitPrice: number;
      quantity: number;
    }>;
  }) {
    const count = await (this.prisma as any).quote.count();
    const quoteNumber = `PRE-${String(count + 1).padStart(4, '0')}`;

    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + (data.validDays || 7));

    const total = (data.items || []).reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);

    return (this.prisma as any).quote.create({
      data: {
        quoteNumber,
        clientName: data.clientName || 'Cliente Ocasional',
        clientPhone: data.clientPhone || null,
        userId: data.userId,
        total: Math.round(total * 100) / 100,
        status: 'PENDING',
        validUntil,
        notes: data.notes || null,
        items: {
          create: (data.items || []).map(item => ({
            productId: item.productId || null,
            productName: item.productName,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            subtotal: Math.round(item.unitPrice * item.quantity * 100) / 100,
          }))
        }
      },
      include: {
        user: { select: { id: true, fullName: true, username: true } },
        items: { include: { product: true } }
      }
    });
  }

  async updateStatus(id: string, status: 'PENDING' | 'CONVERTED' | 'EXPIRED' | 'CANCELLED') {
    return (this.prisma as any).quote.update({
      where: { id },
      data: { status },
      include: { items: true }
    });
  }

  async delete(id: string) {
    return (this.prisma as any).quote.delete({
      where: { id }
    });
  }
}
