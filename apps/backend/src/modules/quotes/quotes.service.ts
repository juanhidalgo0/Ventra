import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { nodeIndex } from '../sync/numbering';
import { PRODUCT_WITHOUT_IMAGE } from '../../database/product-select';

@Injectable()
export class QuotesService {
  constructor(private prisma: PrismaService) {}

  async findAll(status?: string) {
    // Un pendiente con la validez cumplida se muestra y se filtra como vencido (no se reescribe la base)
    const now = new Date();
    const notExpired = { OR: [{ validUntil: null }, { validUntil: { gte: now } }] };
    let where: any = {};
    if (status === 'PENDING') where = { status: 'PENDING', ...notExpired };
    else if (status === 'EXPIRED') where = { OR: [{ status: 'EXPIRED' }, { status: 'PENDING', validUntil: { lt: now } }] };
    else if (status) where = { status };

    const quotes = await (this.prisma as any).quote.findMany({
      where,
      include: {
        user: { select: { id: true, fullName: true, username: true } },
        items: { include: { product: { select: PRODUCT_WITHOUT_IMAGE } } }
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return quotes.map((q: any) =>
      q.status === 'PENDING' && q.validUntil && new Date(q.validUntil) < now ? { ...q, status: 'EXPIRED' } : q);
  }

  async findOne(id: string) {
    const quote = await (this.prisma as any).quote.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, fullName: true, username: true } },
        items: { include: { product: { select: PRODUCT_WITHOUT_IMAGE } } }
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
    // Cada caja tiene su serie: PRE-0001 en la original, PRE-2-0001 en la caja 2, etc.
    const idx = await nodeIndex(this.prisma);
    const prefix = idx ? `PRE-${idx}-` : 'PRE-';
    const existing: { quoteNumber: string | null }[] = await (this.prisma as any).quote.findMany({
      where: { quoteNumber: { startsWith: prefix } }, select: { quoteNumber: true },
    });
    const pattern = new RegExp(`^${prefix}(\\d+)$`);
    const last = existing.reduce((max, q) => {
      const m = pattern.exec(q.quoteNumber || '');
      return m ? Math.max(max, Number(m[1])) : max;
    }, 0);
    const quoteNumber = `${prefix}${String(last + 1).padStart(4, '0')}`;

    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + (data.validDays || 7));

    const total = (data.items || []).reduce((sum, item) => sum + (item.quantity * item.unitPrice), 0);

    // Promos o productos borrados no existen en products: el ítem se guarda igual, sin el vínculo
    const askedIds = [...new Set((data.items || []).map((i) => i.productId).filter(Boolean))] as string[];
    const found = askedIds.length
      ? await this.prisma.product.findMany({ where: { id: { in: askedIds } }, select: { id: true } })
      : [];
    const existingIds = new Set(found.map((p) => p.id));

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
            productId: item.productId && existingIds.has(item.productId) ? item.productId : null,
            productName: item.productName,
            unitPrice: item.unitPrice,
            quantity: item.quantity,
            subtotal: Math.round(item.unitPrice * item.quantity * 100) / 100,
          }))
        }
      },
      include: {
        user: { select: { id: true, fullName: true, username: true } },
        items: { include: { product: { select: PRODUCT_WITHOUT_IMAGE } } }
      }
    });
  }

  async updateStatus(id: string, status: 'PENDING' | 'CONVERTED' | 'EXPIRED' | 'CANCELLED') {
    if (!['PENDING', 'CONVERTED', 'EXPIRED', 'CANCELLED'].includes(status)) throw new BadRequestException('Estado inválido');
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
