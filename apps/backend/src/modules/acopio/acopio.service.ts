import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { numberRange } from '../sync/numbering';

@Injectable()
export class AcopioService {
  constructor(private readonly prisma: PrismaService) {}

  async getAcopios(query?: { search?: string; status?: string }) {
    const where: any = {
      isAcopio: true,
    };

    if (query?.status && query.status !== 'ALL') {
      where.acopioStatus = query.status;
    }

    if (query?.search) {
      const q = query.search.trim();
      where.OR = [
        { client: { name: { contains: q } } },
        { client: { dni: { contains: q } } },
        { notes: { contains: q } },
      ];
    }

    const sales = await this.prisma.sale.findMany({
      where,
      include: {
        client: true,
        user: { select: { id: true, fullName: true, username: true } },
        items: {
          include: {
            product: true,
          },
        },
        deliveryReceipts: {
          include: {
            items: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return sales.map(sale => {
      let totalQty = 0;
      let totalDelivered = 0;

      const itemsDetail = sale.items.map(it => {
        totalQty += it.quantity;
        totalDelivered += it.deliveredQuantity;
        return {
          ...it,
          pendingQuantity: Math.max(0, it.quantity - it.deliveredQuantity),
        };
      });

      return {
        ...sale,
        items: itemsDetail,
        totalQuantity: totalQty,
        totalDelivered,
        totalPending: Math.max(0, totalQty - totalDelivered),
      };
    });
  }

  async getAcopioById(saleId: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id: saleId },
      include: {
        client: true,
        user: { select: { id: true, fullName: true, username: true } },
        items: {
          include: {
            product: true,
          },
        },
        deliveryReceipts: {
          include: {
            items: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!sale) throw new NotFoundException('Venta en acopio no encontrada');

    return {
      ...sale,
      items: sale.items.map(it => ({
        ...it,
        pendingQuantity: Math.max(0, it.quantity - it.deliveredQuantity),
      })),
    };
  }

  async createDeliveryReceipt(saleId: string, userId: string, data: {
    receiverName?: string;
    driverName?: string;
    deliveryAddress?: string;
    notes?: string;
    items: { saleItemId: string; quantity: number }[];
  }) {
    if (!data.items || data.items.length === 0) {
      throw new BadRequestException('Debe incluir al menos un artículo para entregar');
    }

    return await this.prisma.$transaction(async (tx) => {
      const sale = await tx.sale.findUnique({
        where: { id: saleId },
        include: { items: { include: { product: true } }, client: true },
      });

      if (!sale) throw new NotFoundException('Venta no encontrada');

      // Validate quantities
      const receiptItemsData: { productId: string; productName: string; quantity: number }[] = [];

      for (const reqItem of data.items) {
        const saleItem = sale.items.find(si => si.id === reqItem.saleItemId);
        if (!saleItem) throw new BadRequestException(`Artículo de venta ${reqItem.saleItemId} no encontrado`);

        const pending = saleItem.quantity - saleItem.deliveredQuantity;
        if (reqItem.quantity <= 0) continue;
        if (reqItem.quantity > pending + 0.001) {
          throw new BadRequestException(
            `La cantidad a entregar (${reqItem.quantity}) de ${saleItem.productName} supera el saldo pendiente (${pending})`
          );
        }

        // Update delivered quantity on sale item
        await tx.saleItem.update({
          where: { id: saleItem.id },
          data: { deliveredQuantity: saleItem.deliveredQuantity + reqItem.quantity },
        });

        receiptItemsData.push({
          productId: saleItem.productId,
          productName: saleItem.productName,
          quantity: reqItem.quantity,
        });
      }

      if (receiptItemsData.length === 0) {
        throw new BadRequestException('No hay cantidades válidas mayores a 0 para despachar');
      }

      // Next remito number
      // Cada caja numera en su propio rango (ver sync/numbering)
      const range = await numberRange(tx);
      const maxRemito = await tx.deliveryReceipt.aggregate({
        where: { remitoNumber: { gte: range.from, lt: range.to } },
        _max: { remitoNumber: true },
      });
      const remitoNumber = (maxRemito._max.remitoNumber ?? range.from) + 1;

      // Create delivery receipt
      const receipt = await tx.deliveryReceipt.create({
        data: {
          remitoNumber,
          saleId: sale.id,
          clientId: sale.clientId,
          receiverName: data.receiverName || sale.client?.name || 'Cliente',
          driverName: data.driverName || null,
          deliveryAddress: data.deliveryAddress || sale.client?.address || null,
          notes: data.notes || null,
          items: {
            create: receiptItemsData,
          },
        },
        include: {
          items: true,
          sale: {
            include: { client: true },
          },
        },
      });

      // Recalculate sale acopio status
      const updatedSaleItems = await tx.saleItem.findMany({
        where: { saleId: sale.id },
      });

      const allDelivered = updatedSaleItems.every(si => si.deliveredQuantity >= si.quantity - 0.001);
      const someDelivered = updatedSaleItems.some(si => si.deliveredQuantity > 0);
      const newStatus = allDelivered ? 'COMPLETED' : (someDelivered ? 'PARTIAL' : 'PENDING');

      await tx.sale.update({
        where: { id: sale.id },
        data: { acopioStatus: newStatus },
      });

      return receipt;
    });
  }
}
