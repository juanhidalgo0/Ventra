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
  pickedUpBy?: string;
  appliedPromotions?: { promotionId: string; quantitySold: number }[];
  isAcopio?: boolean;
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
      
      // Ensure virtual products exist in the database
      for (const id of productIds) {
        if (id === 'VIRTUAL_LOAD_1' || id === 'VIRTUAL_LOAD_2' || id === 'PAGO_CTA_CTE' || id === 'VENTA_RAPIDA') {
          const exists = await tx.product.findUnique({ where: { id } });
          if (exists && !exists.isActive) {
            await tx.product.update({ where: { id }, data: { isActive: true } });
          }
          if (!exists) {
            let virtualName = 'Carga Virtual 1';
            if (id === 'VIRTUAL_LOAD_2') virtualName = 'Carga Virtual 2';
            else if (id === 'PAGO_CTA_CTE') virtualName = 'PAGO CUENTA CORRIENTE';
            // Venta rápida (código "1" / F1 en el POS): precio libre, sin stock.
            // Se recrea sola si se borra la base, así el atajo nunca deja de andar.
            else if (id === 'VENTA_RAPIDA') virtualName = 'Venta Rápida';

            await tx.product.create({
              data: {
                id,
                name: virtualName,
                // Sin código si otro producto ya lo usa (ej. uno creado a mano como parche)
                barcode: (await tx.product.findUnique({ where: { barcode: id } })) ? null : id,
                salePrice: 0,
                costPrice: 0,
                stock: 999999,
                unlimitedStock: true,
                isActive: true
              }
            });
          }
        }
      }

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
        saleItems.push({ productId: product.id, productName: (item as any).productName || product.name, unitPrice, quantity: item.quantity, subtotal: itemSubtotal, discount: itemDiscount, total: itemTotal });
        subtotal += itemTotal;

        // Deduct stock for product (or kit components if product.isKit)
        if (product.isKit) {
          const kitComponents = await tx.productKitItem.findMany({
            where: { parentProductId: product.id },
            include: { childProduct: true }
          });
          for (const kitComp of kitComponents) {
            const childQty = kitComp.quantity * item.quantity;
            if (!kitComp.childProduct.unlimitedStock) {
              const childStockBefore = kitComp.childProduct.stock;
              const childNewStock = childStockBefore - childQty;
              await tx.product.update({
                where: { id: kitComp.childProductId },
                data: { stock: { decrement: childQty } }
              });
              const isItemReturn = item.quantity < 0;
              await tx.inventoryMovement.create({
                data: {
                  productId: kitComp.childProductId,
                  userId,
                  type: isItemReturn ? 'RETURN' : 'SALE',
                  quantity: -childQty,
                  stockBefore: childStockBefore,
                  stockAfter: childNewStock,
                  reference: isItemReturn ? `Devolución Kit: ${product.name}` : `Despiece Kit: ${product.name}`
                }
              });
              productsToSync.push({
                barcode: kitComp.childProduct.barcode || kitComp.childProduct.id,
                newStock: childNewStock,
                salePrice: kitComp.childProduct.salePrice
              });
            }
          }
        } else if (!product.unlimitedStock) {
          const stockBefore = product.stock;
          const newStock = stockBefore - item.quantity;
          await tx.product.update({ where: { id: product.id }, data: { stock: { decrement: item.quantity } } });
          
          const isItemReturn = item.quantity < 0;
          await tx.inventoryMovement.create({ 
            data: { 
              productId: product.id, 
              userId, 
              type: isItemReturn ? 'RETURN' : 'SALE', 
              quantity: -item.quantity, 
              stockBefore, 
              stockAfter: newStock, 
              reference: isItemReturn ? 'Devolución en Venta POS' : 'Venta POS' 
            } 
          });

          productsToSync.push({
            barcode: product.barcode || product.id,
            newStock,
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
          saleNumber, userId, sessionId: dto.sessionId, subtotal, total: subtotal, paymentMethodSummary, notes: dto.notes, clientId: dto.clientId, pickedUpBy: dto.pickedUpBy || null,
          isAcopio: dto.isAcopio ? true : false,
          acopioStatus: dto.isAcopio ? 'PENDING' : 'NONE',
          items: { create: saleItems },
          payments: { create: dto.payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference })) },
        },
        include: { items: true, payments: true, user: { select: { fullName: true, username: true } } },
      });

      // Handle Credit Account (DEBT)
      const debtAmount = dto.payments.filter(p => p.method === 'DEBT').reduce((sum, p) => sum + p.amount, 0);
      if (debtAmount !== 0) {
        if (!dto.clientId) throw new BadRequestException('Se requiere un cliente para ventas a crédito o saldos a favor');
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
            description: dto.pickedUpBy ? `Venta #${saleNumber} (Retiró: ${dto.pickedUpBy})` : `Venta #${saleNumber}`,
            pickedUpBy: dto.pickedUpBy || null,
          },
        });

        await tx.client.update({ where: { id: dto.clientId }, data: { balance: balanceAfter } });
      }

      // Process applied promotions to increment soldStock and check limits
      if (dto.appliedPromotions && dto.appliedPromotions.length > 0) {
        for (const ap of dto.appliedPromotions) {
          const promoId = ap.promotionId || (ap as any).id;
          if (!promoId) continue;
          const promo = await tx.promotion.findUnique({ where: { id: promoId } });
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

  async findAll(params?: { sessionId?: string; userId?: string; from?: string; to?: string; paymentMethod?: string; limit?: number; search?: string; withCost?: string | boolean }) {
    const where: any = {};
    if (params?.sessionId) where.sessionId = params.sessionId;
    if (params?.userId) where.userId = params.userId;
    if (params?.paymentMethod) where.paymentMethodSummary = params.paymentMethod;
    if (params?.from || params?.to) {
      where.createdAt = {};
      if (params.from) where.createdAt.gte = new Date(params.from);
      if (params.to) where.createdAt.lte = new Date(params.to);
    }
    if (params?.search) {
      const searchVal = params.search.trim().toLowerCase();
      if (/^\d+$/.test(searchVal)) {
        where.saleNumber = parseInt(searchVal);
      } else {
        where.items = {
          some: {
            productName: {
              contains: searchVal
            }
          }
        };
      }
    }
    try {
      const includeCost = params?.withCost === true || params?.withCost === 'true';
      const queryOptions: any = {
        where,
        include: {
          items: includeCost ? {
            include: {
              product: {
                select: {
                  costPrice: true
                }
              }
            }
          } : true,
          payments: true,
          user: { select: { fullName: true, username: true } }
        },
        orderBy: { createdAt: 'desc' },
      };

      if (params?.limit && !isNaN(params.limit)) {
        queryOptions.take = params.limit;
      } else if (!params?.from && !params?.to) {
        queryOptions.take = 100;
      } else {
        // Safe upper bound for date ranges (prevents Node.js OOM if kiosk has 10,000+ sales)
        queryOptions.take = 2500;
      }

      return await this.prisma.sale.findMany(queryOptions);
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

  async getVirtualMetrics(from?: string, to?: string) {
    const where: any = {
      status: 'COMPLETED',
      items: {
        some: {
          OR: [
            { productId: 'VIRTUAL_LOAD_1' },
            { productId: 'VIRTUAL_LOAD_2' },
            { product: { barcode: { in: ['VIRTUAL1', 'VIRTUAL2'] } } }
          ]
        }
      }
    };
    
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }
    
    const sales = await this.prisma.sale.findMany({
      where,
      include: {
        items: {
          include: { product: true }
        }
      },
      orderBy: { createdAt: 'desc' }
    });
    
    let totalVirtual1 = 0;
    let totalVirtual2 = 0;
    const itemsList: any[] = [];
    
    for (const sale of sales) {
      for (const item of sale.items) {
        if (item.productId === 'VIRTUAL_LOAD_1' || item.product?.barcode === 'VIRTUAL1') {
          const amt = item.total;
          totalVirtual1 += amt;
          itemsList.push({
            id: sale.id,
            createdAt: sale.createdAt,
            type: 'Carga Virtual 1',
            amount: amt,
            quantity: item.quantity
          });
        } else if (item.productId === 'VIRTUAL_LOAD_2' || item.product?.barcode === 'VIRTUAL2') {
          const amt = item.total;
          totalVirtual2 += amt;
          itemsList.push({
            id: sale.id,
            createdAt: sale.createdAt,
            type: 'Carga Virtual 2',
            amount: amt,
            quantity: item.quantity
          });
        }
      }
    }
    
    return {
      totalVirtual1,
      totalVirtual2,
      totalVirtualAmount: totalVirtual1 + totalVirtual2,
      items: itemsList,
      salesCount: sales.length
    };
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
      select: {
        total: true,
        payments: { select: { method: true, amount: true } },
        items: {
          select: {
            quantity: true,
            product: { select: { costPrice: true } }
          }
        }
      },
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

    const [monthlySales, monthlyPurchasesAgg, monthlySuppPaymentsAgg] = await Promise.all([
      this.prisma.sale.findMany({
        where: { createdAt: { gte: startOfMonth, lte: endOfPeriod }, status: 'COMPLETED' },
        select: {
          total: true,
          payments: {
            where: { method: 'CASH' },
            select: { amount: true }
          }
        }
      }),
      this.prisma.purchase.aggregate({
        _sum: { total: true },
        where: { createdAt: { gte: startOfMonth, lte: endOfPeriod }, status: 'COMPLETED' }
      }),
      this.prisma.supplierPayment.aggregate({
        _sum: { amount: true },
        where: { createdAt: { gte: startOfMonth, lte: endOfPeriod } }
      })
    ]);

    const monthlyRevenue = monthlySales.reduce((sum, s) => sum + s.total, 0);
    const monthlyCash = monthlySales.reduce((sum, s) => {
      const cashPayments = s.payments.reduce((ps, p) => ps + p.amount, 0);
      return sum + cashPayments;
    }, 0);
    const monthlyPurchaseTotal = monthlyPurchasesAgg._sum?.total || 0;
    const monthlySuppPaymentTotal = monthlySuppPaymentsAgg._sum?.amount || 0;

    // Dynamic product and low stock count via fast DB queries
    const totalProducts = await this.prisma.product.count({ where: { isActive: true } });
    const lowStockRaw = await this.prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) as count FROM products WHERE is_active = 1 AND stock <= min_stock;`
    ).catch(() => [{ count: 0 }]);
    const lowStockCount = Number(lowStockRaw[0]?.count || 0);

    // Period's real out-of-pocket expenses via DB aggregations
    const [movementsAgg, supplierPaymentsAgg, purchasesAgg] = await Promise.all([
      this.prisma.cashMovement.aggregate({
        _sum: { amount: true },
        where: { createdAt: { gte: today, lte: endOfPeriod }, type: 'EXPENSE' }
      }),
      this.prisma.supplierPayment.aggregate({
        _sum: { amount: true },
        where: { createdAt: { gte: today, lte: endOfPeriod } }
      }),
      this.prisma.purchase.aggregate({
        _sum: { total: true },
        where: { createdAt: { gte: today, lte: endOfPeriod }, status: { not: 'CANCELLED' } }
      })
    ]);
    const expenses = 
      (movementsAgg._sum?.amount || 0) +
      (supplierPaymentsAgg._sum?.amount || 0) +
      (purchasesAgg._sum?.total || 0);

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
      select: {
        id: true,
        total: true,
        createdAt: true,
        clientId: true,
        client: {
          select: {
            id: true,
            name: true,
            dni: true,
            phone: true
          }
        },
        items: {
          select: {
            productId: true,
            productName: true,
            quantity: true,
            unitPrice: true,
            total: true,
            product: {
              select: {
                costPrice: true,
                stock: true
              }
            }
          }
        }
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
    // 1. Get Ventra (POS) metrics
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
      for (const item of sale.items) {
        if (item.productId === 'VIRTUAL_LOAD_1' || item.productId === 'VIRTUAL_LOAD_2') {
          continue;
        }
        posBilling += item.total;
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

