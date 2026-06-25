import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../websockets/events.gateway';
import { FirebaseSyncService } from '../products/firebase-sync.service';

interface CreateSaleDto {
  sessionId: string;
  items: { productId: string; quantity: number; discount?: number; price?: number }[];
  payments: { method: string; amount: number; reference?: string }[];
  notes?: string;
  clientId?: string;
  appliedPromotions?: { promotionId: string; quantitySold: number }[];
}

@Injectable()
export class SalesService {
  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
    private firebaseSync: FirebaseSyncService,
  ) {}

  async create(userId: string, dto: CreateSaleDto) {
    const session = await this.prisma.cashRegisterSession.findUnique({ where: { id: dto.sessionId } });
    if (!session || session.status !== 'OPEN') throw new BadRequestException('No hay una caja abierta para esta sesión');

    const productsToSync: { barcode: string; newStock: number; salePrice: number }[] = [];

    const sale = await this.prisma.$transaction(async (tx) => {
      let subtotal = 0;
      const saleItems: any[] = [];

      const productIds = dto.items.map((i) => i.productId);
      const dbProducts = await tx.product.findMany({
        where: { id: { in: productIds } }
      });

      for (const item of dto.items) {
        const product = dbProducts.find((p) => p.id === item.productId);
        if (!product) throw new BadRequestException(`Producto no encontrado: ${item.productId}`);
        if (!product.isActive) throw new BadRequestException(`Producto inactivo: ${product.name}`);
        // Removed stock check to allow negative stock sales as per user request

        const unitPrice = item.price !== undefined ? item.price : product.salePrice;
        const itemSubtotal = unitPrice * item.quantity;
        const itemDiscount = item.discount || 0;
        const itemTotal = itemSubtotal - itemDiscount;
        saleItems.push({ productId: product.id, productName: product.name, unitPrice, quantity: item.quantity, subtotal: itemSubtotal, discount: itemDiscount, total: itemTotal });
        subtotal += itemTotal;

        // Skip stock decrement for unlimited stock products
        if (!product.unlimitedStock) {
          const stockBefore = product.stock;
          const newStock = stockBefore - item.quantity;
          await tx.product.update({ where: { id: product.id }, data: { stock: { decrement: item.quantity } } });
          await tx.inventoryMovement.create({ data: { productId: product.id, userId, type: 'SALE', quantity: -item.quantity, stockBefore, stockAfter: newStock, reference: 'Venta POS' } });
        }

        if (!product.unlimitedStock) {
          const currentStock = product.unlimitedStock ? product.stock : (product.stock - item.quantity);
          productsToSync.push({
            barcode: product.barcode || product.id,
            newStock: currentStock,
            salePrice: product.salePrice,
          });
        }
      }

      const totalPayments = dto.payments.reduce((sum, p) => sum + p.amount, 0);
      if (Math.abs(totalPayments - subtotal) > 0.01) throw new BadRequestException(`El total de pagos ($${totalPayments}) no coincide con el total de la venta ($${subtotal})`);

      const paymentMethodSummary = dto.payments.length === 1 ? dto.payments[0].method : 'MIXED';
      const lastSale = await tx.sale.findFirst({ orderBy: { saleNumber: 'desc' } });
      const saleNumber = (lastSale?.saleNumber || 0) + 1;

      const newSale = await tx.sale.create({
        data: {
          saleNumber, userId, sessionId: dto.sessionId, subtotal, total: subtotal, paymentMethodSummary, notes: dto.notes, clientId: dto.clientId,
          items: { create: saleItems },
          payments: { create: dto.payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference })) },
        },
        include: { items: true, payments: true, user: { select: { fullName: true, username: true } } },
      });

      // Handle Credit Account (DEBT)
      const debtAmount = dto.payments.filter(p => p.method === 'DEBT').reduce((sum, p) => sum + p.amount, 0);
      if (debtAmount > 0) {
        if (!dto.clientId) throw new BadRequestException('Se requiere un cliente para ventas a crédito');
        const client = await tx.client.findUnique({ where: { id: dto.clientId } });
        if (!client) throw new BadRequestException('Cliente no encontrado');

        const balanceBefore = client.balance;
        const balanceAfter = balanceBefore + debtAmount;

        await tx.accountMovement.create({
          data: {
            clientId: dto.clientId,
            saleId: newSale.id,
            userId,
            type: 'DEBT',
            amount: debtAmount,
            balanceBefore,
            balanceAfter,
            description: `Venta #${saleNumber}`,
          },
        });

        await tx.client.update({ where: { id: dto.clientId }, data: { balance: balanceAfter } });
      }

      // Process applied promotions to increment soldStock and check limits
      if (dto.appliedPromotions && dto.appliedPromotions.length > 0) {
        for (const ap of dto.appliedPromotions) {
          const promo = await tx.promotion.findUnique({ where: { id: ap.promotionId } });
          if (promo) {
            const newSoldStock = promo.soldStock + ap.quantitySold;
            const updates: any = { soldStock: newSoldStock };
            if (promo.limitType === 'STOCK' && promo.limitStock !== null && newSoldStock >= promo.limitStock) {
              updates.isActive = false;
            }
            await tx.promotion.update({
              where: { id: promo.id },
              data: updates
            });
          }
        }
      }

      await tx.auditLog.create({ data: { userId, entityType: 'SALE', entityId: newSale.id, action: 'CREATE', newValues: JSON.stringify({ saleNumber: newSale.saleNumber, total: newSale.total, paymentMethodSummary, itemCount: saleItems.length }) } });

      this.events.emitSaleCreated(newSale);
      this.events.emitStockUpdated(saleItems.map((i) => ({ productId: i.productId, newStock: 0 })));

      return newSale;
    });

    // Sync to Firestore outside transaction to avoid blocking SQLite writer lock
    for (const p of productsToSync) {
      this.firebaseSync.syncProductToFirestore(p.barcode, p.newStock, p.salePrice).catch(err => {
        console.error(`Error syncing product ${p.barcode} to Firestore after sale:`, err);
      });
    }

    return sale;
  }

  async findAll(params?: { sessionId?: string; userId?: string; from?: string; to?: string; paymentMethod?: string; limit?: number }) {
    const where: any = {};
    if (params?.sessionId) where.sessionId = params.sessionId;
    if (params?.userId) where.userId = params.userId;
    if (params?.paymentMethod) where.paymentMethodSummary = params.paymentMethod;
    if (params?.from || params?.to) {
      where.createdAt = {};
      if (params.from) where.createdAt.gte = new Date(params.from);
      if (params.to) where.createdAt.lte = new Date(params.to);
    }
    try {
      return await this.prisma.sale.findMany({
        where,
        include: {
          items: {
            include: {
              product: {
                select: {
                  costPrice: true
                }
              }
            }
          },
          payments: true,
          user: { select: { fullName: true, username: true } }
        },
        orderBy: { createdAt: 'desc' },
        take: params?.limit && !isNaN(params.limit) ? params.limit : 100,
      });
    } catch (err) {
      console.error('Error in findAll sales:', err);
      return [];
    }
  }

  async findById(id: string) {
    const sale = await this.prisma.sale.findUnique({
      where: { id },
      include: { items: { include: { product: { select: { barcode: true, imageUrl: true } } } }, payments: true, user: { select: { fullName: true, username: true } }, session: { select: { terminalName: true } } },
    });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    return sale;
  }

  async cancel(id: string, userId: string) {
    const sale = await this.prisma.sale.findUnique({ where: { id }, include: { items: true, payments: true } });
    if (!sale) throw new NotFoundException('Venta no encontrada');
    if (sale.status !== 'COMPLETED') throw new BadRequestException('Solo se pueden cancelar ventas completadas');

    const productsToSync: { barcode: string; newStock: number; salePrice: number }[] = [];

    const updatedSale = await this.prisma.$transaction(async (tx) => {
      // 1. Restore product stock levels
      for (const item of sale.items) {
        const product = await tx.product.findUnique({ where: { id: item.productId } });
        const stockBefore = product?.stock || 0;
        const newStock = stockBefore + item.quantity;
        await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
        await tx.inventoryMovement.create({ data: { productId: item.productId, userId, type: 'RETURN', quantity: item.quantity, stockBefore, stockAfter: newStock, reference: `Cancelación venta #${sale.saleNumber}` } });
        
        if (product) {
          productsToSync.push({
            barcode: product.barcode || product.id,
            newStock,
            salePrice: product.salePrice,
          });
        }
      }

      // 2. Reverse client credit account debt if it was checked out on credit
      const debtAmount = sale.payments.filter(p => p.method === 'DEBT').reduce((sum, p) => sum + p.amount, 0);
      if (debtAmount > 0 && sale.clientId) {
        const client = await tx.client.findUnique({ where: { id: sale.clientId } });
        if (client) {
          const balanceBefore = client.balance;
          const balanceAfter = balanceBefore - debtAmount;

          await tx.accountMovement.create({
            data: {
              clientId: sale.clientId,
              saleId: sale.id,
              userId,
              type: 'PAYMENT', // PAYMENT acts as credit reversal of DEBT
              amount: debtAmount,
              balanceBefore,
              balanceAfter,
              description: `Cancelación Venta #${sale.saleNumber}`,
            },
          });

          await tx.client.update({
            where: { id: sale.clientId },
            data: { balance: balanceAfter },
          });
        }
      }

      const updated = await tx.sale.update({ where: { id }, data: { status: 'CANCELLED' }, include: { items: true, payments: true } });
      await tx.auditLog.create({ data: { userId, entityType: 'SALE', entityId: sale.id, action: 'CANCEL', oldValues: JSON.stringify({ status: 'COMPLETED' }), newValues: JSON.stringify({ status: 'CANCELLED' }) } });
      return updated;
    });

    this.events.emitStockUpdated([]);

    // Sync to Firestore outside transaction
    for (const p of productsToSync) {
      this.firebaseSync.syncProductToFirestore(p.barcode, p.newStock, p.salePrice).catch(err => {
        console.error(`Error syncing product ${p.barcode} to Firestore after cancel:`, err);
      });
    }

    return updatedSale;
  }

  async getTodaySummary(from?: string, to?: string) {
    let today = new Date();
    today.setHours(0, 0, 0, 0);
    let endOfPeriod = new Date();
    endOfPeriod.setHours(23, 59, 59, 999);

    if (from) {
      today = new Date(from);
    }
    if (to) {
      endOfPeriod = new Date(to);
    }

    const salesFilter: any = { createdAt: { gte: today, lte: endOfPeriod }, status: 'COMPLETED' };
    const sales = await this.prisma.sale.findMany({
      where: salesFilter,
      include: { payments: true, items: { include: { product: { select: { costPrice: true } } } } },
    });

    const totalSales = sales.length;
    let totalRevenue = 0;
    let totalCost = 0;
    const paymentBreakdown: Record<string, number> = { CASH: 0 };

    for (const sale of sales) {
      totalRevenue += sale.total;
      for (const item of sale.items) {
        totalCost += (item.product?.costPrice || 0) * item.quantity;
      }
      for (const payment of sale.payments) {
        if (!paymentBreakdown[payment.method]) {
          paymentBreakdown[payment.method] = 0;
        }
        paymentBreakdown[payment.method] += payment.amount;
      }
    }

    const netProfit = totalRevenue - totalCost;

    // Get weekly stats or range stats
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);
    const weeklySales = await this.prisma.sale.findMany({
      where: { createdAt: { gte: lastWeek, lte: endOfPeriod }, status: 'COMPLETED' },
      select: { total: true },
    });
    const weeklyTotal = weeklySales.reduce((sum, s) => sum + s.total, 0);

    const startOfMonth = new Date(today);
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [monthlySales, monthlyPurchases, monthlySuppPayments] = await Promise.all([
      this.prisma.sale.findMany({
        where: { createdAt: { gte: startOfMonth, lte: endOfPeriod }, status: 'COMPLETED' },
        include: { payments: true }
      }),
      this.prisma.purchase.findMany({
        where: { createdAt: { gte: startOfMonth, lte: endOfPeriod }, status: 'COMPLETED' }
      }),
      this.prisma.supplierPayment.findMany({
        where: { createdAt: { gte: startOfMonth, lte: endOfPeriod } }
      })
    ]);

    const monthlyRevenue = monthlySales.reduce((sum, s) => sum + s.total, 0);
    const monthlyCash = monthlySales.reduce((sum, s) => {
      const cashPayments = s.payments.filter(p => p.method === 'CASH').reduce((ps, p) => ps + p.amount, 0);
      return sum + cashPayments;
    }, 0);
    const monthlyPurchaseTotal = monthlyPurchases.reduce((sum, p) => sum + p.total, 0);
    const monthlySuppPaymentTotal = monthlySuppPayments.reduce((sum, p) => sum + p.amount, 0);

    // Dynamic low stock count
    const allProductsCount = await this.prisma.product.findMany({ where: { isActive: true }, select: { stock: true, minStock: true } });
    const totalProducts = allProductsCount.length;
    const lowStockCount = allProductsCount.filter((p) => p.stock <= p.minStock).length;

    // Period's real out-of-pocket expenses
    const movements = await this.prisma.cashMovement.findMany({
      where: { createdAt: { gte: today, lte: endOfPeriod }, type: 'EXPENSE' },
      select: { amount: true }
    });
    const supplierPayments = await this.prisma.supplierPayment.findMany({
      where: { createdAt: { gte: today, lte: endOfPeriod } },
      select: { amount: true }
    });
    const purchases = await this.prisma.purchase.findMany({
      where: { createdAt: { gte: today, lte: endOfPeriod }, status: { not: 'CANCELLED' } },
      select: { total: true }
    });
    const expenses = 
      movements.reduce((sum, m) => sum + m.amount, 0) +
      supplierPayments.reduce((sum, p) => sum + p.amount, 0) +
      purchases.reduce((sum, p) => sum + p.total, 0);

    // Sum of all active client debt balances
    const clientBalanceAgg = await this.prisma.client.aggregate({
      _sum: { balance: true },
      where: { isActive: true }
    });
    const totalClientBalance = clientBalanceAgg._sum?.balance || 0;

    // Sum of all unpaid supplier purchases (OWED)
    const purchaseDebtAgg = await this.prisma.purchase.aggregate({
      _sum: { total: true },
      where: { paymentStatus: 'OWED', status: { not: 'CANCELLED' } }
    });
    const totalSupplierDebt = purchaseDebtAgg._sum?.total || 0;

    // Sum of all expected cash in drawers currently open
    const openSessions = await this.prisma.cashRegisterSession.findMany({
      where: { status: 'OPEN' },
      include: {
        sales: {
          where: { status: 'COMPLETED' },
          include: { payments: true }
        },
        cashMovements: true
      }
    });

    let activeSessionsCash = 0;
    for (const session of openSessions) {
      let cashPaymentsSum = 0;
      for (const sale of session.sales) {
        for (const payment of sale.payments) {
          if (payment.method === 'CASH') cashPaymentsSum += payment.amount;
        }
      }
      let movementsSum = 0;
      for (const mov of session.cashMovements) {
        if (mov.type === 'INCOME') movementsSum += mov.amount;
        else if (mov.type === 'EXPENSE') movementsSum -= mov.amount;
        else if (mov.type === 'WITHDRAWAL') movementsSum -= mov.amount;
      }
      activeSessionsCash += (session.openingAmount + cashPaymentsSum + movementsSum);
    }

    // Latest system audit movements
    const latestMovements = await this.prisma.auditLog.findMany({
      take: 6,
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { fullName: true, username: true } } }
    });

    return {
      totalSales,
      totalRevenue,
      totalCost,
      netProfit,
      weeklyTotal,
      paymentBreakdown,
      averageTicket: totalSales > 0 ? totalRevenue / totalSales : 0,
      totalProducts,
      lowStockCount,
      expenses,
      totalClientBalance,
      totalSupplierDebt,
      activeSessionsCash,
      activeSessionsCount: openSessions.length,
      latestMovements,
      monthlyStats: {
        revenue: monthlyRevenue,
        cash: monthlyCash,
        purchases: monthlyPurchaseTotal,
        supplierPayments: monthlySuppPaymentTotal,
        boxSales: monthlyRevenue,
        internalConsumption: 0
      }
    };
  }

  async getDashboardData(period: 'day' | 'week' | 'month' = 'day', from?: string, to?: string) {
    let whereClause: any = { status: 'COMPLETED' };
    if (from || to) {
      whereClause.createdAt = {};
      if (from) {
        whereClause.createdAt.gte = new Date(from);
      }
      if (to) {
        whereClause.createdAt.lte = new Date(to);
      }
    } else {
      const now = new Date();
      let fromDate = new Date();
      if (period === 'day') fromDate.setHours(0, 0, 0, 0);
      else if (period === 'week') fromDate.setDate(now.getDate() - 7);
      else if (period === 'month') fromDate.setMonth(now.getMonth() - 1);
      whereClause.createdAt = { gte: fromDate };
    }

    const sales = await this.prisma.sale.findMany({
      where: whereClause,
      include: {
        client: true,
        items: { include: { product: { select: { costPrice: true, stock: true } } } }
      },
      orderBy: { createdAt: 'asc' },
    });

    // Group by day for charts
    const chartData: any = {};
    const topProducts: any = {};
    const topClients: any = {};

    for (const sale of sales) {
      const dateKey = sale.createdAt.toISOString().split('T')[0];
      if (!chartData[dateKey]) chartData[dateKey] = { date: dateKey, sales: 0, profit: 0, count: 0 };
      
      chartData[dateKey].sales += sale.total;
      chartData[dateKey].count += 1;

      let saleCost = 0;
      for (const item of sale.items) {
        const itemProfit = (item.unitPrice - (item.product?.costPrice || 0)) * item.quantity;
        saleCost += (item.product?.costPrice || 0) * item.quantity;
        
        if (!topProducts[item.productId]) {
          topProducts[item.productId] = { 
            id: item.productId, 
            name: item.productName, 
            quantity: 0, 
            revenue: 0, 
            stock: item.product?.stock || 0 
          };
        }
        topProducts[item.productId].quantity += item.quantity;
        topProducts[item.productId].revenue += item.total;
      }
      chartData[dateKey].profit += (sale.total - saleCost);

      if (sale.clientId && sale.client) {
        if (!topClients[sale.clientId]) {
          topClients[sale.clientId] = {
            id: sale.clientId,
            name: sale.client.name,
            dni: sale.client.dni,
            phone: sale.client.phone,
            salesCount: 0,
            totalSpent: 0,
          };
        }
        topClients[sale.clientId].salesCount += 1;
        topClients[sale.clientId].totalSpent += sale.total;
      }
    }

    return {
      stats: chartData,
      history: Object.values(chartData),
      topProducts: Object.values(topProducts).sort((a: any, b: any) => b.quantity - a.quantity).slice(0, 10),
      topClients: Object.values(topClients).sort((a: any, b: any) => b.totalSpent - a.totalSpent).slice(0, 10),
    };
  }

  async getGoDeliveryMetrics(email: string, from?: string, to?: string) {
    const rawOrders = (await this.firebaseSync.getRawOrders(email)) as any[];
    
    // Filter by completed/delivered status
    let filteredOrders = rawOrders.filter(o => 
      o.status === 'completed' || o.status === 'delivered' || o.status === 'entregado'
    );

    // Filter by date range if provided
    if (from) {
      const fromDate = new Date(from);
      filteredOrders = filteredOrders.filter(o => new Date(o.createdAt) >= fromDate);
    }
    if (to) {
      const toDate = new Date(to);
      filteredOrders = filteredOrders.filter(o => new Date(o.createdAt) <= toDate);
    }

    let totalRevenue = 0;
    let totalCost = 0;
    let totalCommissions = 0;
    let totalDelivery = 0;
    const chartData: Record<string, { date: string; sales: number; profit: number; count: number }> = {};
    const detailedOrders: any[] = [];

    // Pre-cache local products cost price for faster matching
    const localProducts = await this.prisma.product.findMany({
      where: { isActive: true },
      include: { additionalBarcodes: true }
    });

    for (const order of filteredOrders) {
      const subtotal = order.subtotal || (order.total - (order.deliveryCost || 0) - (order.appUsageFee || 0));
      totalRevenue += subtotal;
      totalCommissions += order.appUsageFee || 0;
      totalDelivery += order.deliveryCost || 0;

      let orderCost = 0;
      const parsedItems = (order.items || []).map((item: any) => {
        // Match product in cache
        const matchedProduct = localProducts.find(p => 
          p.id === item.barcode ||
          p.barcode === item.barcode || 
          p.name === item.name?.toUpperCase() ||
          p.additionalBarcodes?.some(ab => ab.barcode === item.barcode)
        );

        const costPrice = matchedProduct ? matchedProduct.costPrice : 0;
        const itemQty = item.qty || item.quantity || 1;
        const itemPrice = item.price || 0;
        const itemCost = costPrice * itemQty;
        orderCost += itemCost;

        return {
          name: item.name,
          qty: itemQty,
          price: itemPrice,
          cost: costPrice,
          total: itemPrice * itemQty,
          profit: (itemPrice - costPrice) * itemQty
        };
      });

      totalCost += orderCost;
      const orderProfit = subtotal - orderCost;

      const dateKey = order.createdAt.split('T')[0];
      if (!chartData[dateKey]) {
        chartData[dateKey] = { date: dateKey, sales: 0, profit: 0, count: 0 };
      }
      chartData[dateKey].sales += subtotal;
      chartData[dateKey].profit += orderProfit;
      chartData[dateKey].count += 1;

      detailedOrders.push({
        id: order.id,
        orderId: order.orderId,
        clientName: order.clientName || order.userName || 'Cliente Web',
        total: order.total,
        subtotal: subtotal,
        profit: orderProfit,
        status: order.status,
        createdAt: order.createdAt,
        items: parsedItems
      });
    }

    // Sort history chronologically
    const history = Object.values(chartData).sort((a, b) => a.date.localeCompare(b.date));

    return {
      totalRevenue,
      totalCost,
      netProfit: totalRevenue - totalCost,
      totalCommissions,
      totalDelivery,
      totalOrders: filteredOrders.length,
      orders: detailedOrders.sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      history
    };
  }

  async getConsolidatedMetrics(email: string, from?: string, to?: string) {
    // 1. Get GoPortal (POS) metrics
    const posSalesFilter: any = {
      status: 'COMPLETED'
    };
    if (from || to) {
      posSalesFilter.createdAt = {};
      if (from) posSalesFilter.createdAt.gte = new Date(from);
      if (to) posSalesFilter.createdAt.lte = new Date(to);
    }

    const posSales = await this.prisma.sale.findMany({
      where: posSalesFilter,
      include: {
        items: {
          include: {
            product: { select: { costPrice: true } }
          }
        }
      }
    });

    let posBilling = 0;
    let posCost = 0;
    for (const sale of posSales) {
      posBilling += sale.total;
      for (const item of sale.items) {
        posCost += (item.product?.costPrice || 0) * item.quantity;
      }
    }
    const posNetProfit = posBilling - posCost;

    // 2. Get GoDelivery (Online App) metrics
    const goMetrics = await this.getGoDeliveryMetrics(email, from, to);

    const consolidatedBilling = posBilling + goMetrics.totalRevenue + goMetrics.totalCommissions + goMetrics.totalDelivery;
    const consolidatedNetProfit = posNetProfit + goMetrics.netProfit + goMetrics.totalCommissions + goMetrics.totalDelivery;

    return {
      pos: {
        billing: posBilling,
        cost: posCost,
        netProfit: posNetProfit,
        count: posSales.length
      },
      go: {
        billing: goMetrics.totalRevenue,
        cost: goMetrics.totalCost,
        netProfit: goMetrics.netProfit,
        commissions: goMetrics.totalCommissions,
        delivery: goMetrics.totalDelivery,
        count: goMetrics.totalOrders
      },
      consolidated: {
        billing: consolidatedBilling,
        netProfit: consolidatedNetProfit,
        splitPerPartner: consolidatedNetProfit / 3
      }
    };
  }
}

