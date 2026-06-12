import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class SuppliersService {
  constructor(private prisma: PrismaService) {}

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

    return suppliers.map(supplier => ({
      ...supplier,
      stats: supplierStats[supplier.id] || { productsSold: 0, totalSales: 0, netProfit: 0 }
    }));
  }

  async findOne(id: string, startDate?: string, endDate?: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: { products: true, purchases: true }
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
      stats: {
        productsSold,
        totalSales,
        netProfit
      }
    };
  }

  async create(data: { name: string; contact?: string; phone?: string; email?: string }) {
    return this.prisma.supplier.create({ data });
  }

  async update(id: string, data: any) {
    return this.prisma.supplier.update({
      where: { id },
      data
    });
  }

  async remove(id: string) {
    return this.prisma.supplier.delete({ where: { id } });
  }

  async addPayment(data: { supplierId: string; userId: string; amount: number; method: string; reference?: string; notes?: string }) {
    return (this.prisma as any).supplierPayment.create({ data });
  }
}
