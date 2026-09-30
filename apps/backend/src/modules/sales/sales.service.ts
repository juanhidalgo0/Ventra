import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { NotifyService } from '../subscription/notify.service';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../websockets/events.gateway';
import { FirebaseSyncService } from '../products/firebase-sync.service';
import { numberRange } from '../sync/numbering';
import { CashRegisterService } from '../cash-register/cash-register.service';
import { PRODUCT_WITHOUT_IMAGE } from '../../database/product-select';

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
    private notify: NotifyService,
    private cashRegister: CashRegisterService,
  ) {}

  async create(userId: string, dto: CreateSaleDto) {
    const session = await this.prisma.cashRegisterSession.findUnique({ where: { id: dto.sessionId } });
    if (!session || session.status !== 'OPEN') throw new BadRequestException('No hay una caja abierta para esta sesión');

    const productsToSync: { barcode: string; newStock: number; salePrice: number }[] = [];
    // Cuánto se descontó de cada producto (para el aviso de stock mínimo)
    const sold = new Map<string, number>();

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
              sold.set(kitComp.childProductId, (sold.get(kitComp.childProductId) || 0) + childQty);
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
          sold.set(product.id, (sold.get(product.id) || 0) + item.quantity);

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
      // Cada caja numera en su propio rango (ver sync/numbering)
      const range = await numberRange(tx);
      const lastSale = await tx.sale.findFirst({ where: { saleNumber: { gte: range.from, lt: range.to } }, orderBy: { saleNumber: 'desc' } });
      const saleNumber = (lastSale ? lastSale.saleNumber : range.from) + 1;

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

    // Aviso al dueño si algún producto llegó a su stock mínimo con esta venta
    const soldIds = [...sold.keys()].filter((id) => (sold.get(id) || 0) > 0);
    if (soldIds.length) {
      this.prisma.product.findMany({ where: { id: { in: soldIds } }, select: { id: true, name: true, stock: true, minStock: true, unlimitedStock: true } })
        .then((ps) => this.notify.checkLowStock(ps, sold))
        .catch(() => { /* el aviso no puede frenar la venta */ });
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

    // El Cierre Z es el cierre definitivo del día: si la venta ya entró en uno, anularla
    // dejaría el Z con números que no coinciden con la caja.
    const session = await this.prisma.cashRegisterSession.findUnique({ where: { id: sale.sessionId }, select: { status: true, zReportId: true } });
    if (session?.zReportId) {
      throw new BadRequestException('Esta venta es de un turno que ya entró en un Cierre Z: no se puede anular.');
    }

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

    // La venta sale de la caja. Con la caja abierta ya no cuenta (los totales solo suman
    // ventas COMPLETED); si el turno ya se cerró (Cierre X), se recalcula su resumen:
    // ventas, efectivo esperado y diferencia, sin la venta anulada.
    if (session?.status === 'CLOSED') {
      await this.cashRegister.recalculateSessionSummary(sale.sessionId).catch((err) => {
        console.error(`[Sales] No se pudo recalcular el cierre ${sale.sessionId} tras anular la venta #${sale.saleNumber}:`, err);
      });
    }
    this.events.emitCashUpdated({ action: 'SALE_CANCEL', sessionId: sale.sessionId });

    // Aviso al dueño de anulaciones grandes (el umbral evita avisar por errores de tipeo chicos)
    if (Math.abs(sale.total) >= 20000) {
      this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true, username: true } })
        .then((u) => this.notify.enqueue('saleCancel', { saleId: sale.id, saleNumber: sale.saleNumber, total: sale.total, user: u?.fullName || u?.username }))
        .catch(() => {});
    }

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
          include: { product: { select: PRODUCT_WITHOUT_IMAGE } }
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

  // Totales del Historial de Caja calculados sobre TODAS las ventas del período
  // (la lista de la pantalla viene recortada, así que no sirve para sumar).
  async getHistorySummary(from?: string, to?: string) {
    const createdAt: any = {};
    if (from) createdAt.gte = new Date(from);
    if (to) createdAt.lte = new Date(to);
    const period: any = from || to ? { createdAt } : {};
    const completed = { ...period, status: 'COMPLETED' };

    const [totals, cancelledCount, bySummary, byMethod, costItems] = await Promise.all([
      this.prisma.sale.aggregate({ where: completed, _sum: { total: true }, _count: { _all: true } }),
      this.prisma.sale.count({ where: { ...period, status: 'CANCELLED' } }),
      this.prisma.sale.groupBy({ by: ['paymentMethodSummary'], where: completed, _sum: { total: true }, _count: { _all: true } }),
      this.prisma.payment.groupBy({ by: ['method'], where: { sale: completed }, _sum: { amount: true } }),
      this.prisma.$queryRawUnsafe<any[]>(`
        SELECT COALESCE(SUM(si.quantity * COALESCE(p.cost_price, 0)), 0) AS cost
        FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN products p ON p.id = si.product_id
        WHERE s.status = 'COMPLETED' ${from ? 'AND s.created_at >= ?' : ''} ${to ? 'AND s.created_at <= ?' : ''}`,
        ...[from && createdAt.gte, to && createdAt.lte].filter(Boolean)),
    ]);

    const totalCost = Number(costItems[0]?.cost || 0);

    const payments: Record<string, number> = {};
    for (const p of byMethod) payments[p.method] = p._sum.amount || 0;

    const salesByMethod: Record<string, { count: number; total: number }> = {};
    for (const s of bySummary) salesByMethod[s.paymentMethodSummary] = { count: s._count._all, total: s._sum.total || 0 };

    return {
      completedCount: totals._count._all,
      cancelledCount,
      totalSold: totals._sum.total || 0,
      totalCost,
      payments,
      salesByMethod,
    };
  }

  /**
   * Reportes del mes calculados en la base, sobre TODAS las ventas del período (antes la
   * pantalla bajaba hasta 2500 ventas con sus ítems y sumaba ahí). `tzOffset` son los
   * minutos de getTimezoneOffset() del navegador: los días se cuentan en su hora local.
   */
  async getReport(type: string, from: string, to: string, tzOffset = 0) {
    const num = (v: any) => Number(v || 0);
    const range = [new Date(from), new Date(to)];
    const completedIn = `s.status = 'COMPLETED' AND s.created_at >= ? AND s.created_at <= ?`;
    const itemsJoin = `FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN products p ON p.id = si.product_id`;
    const itemCost = `si.quantity * COALESCE(p.cost_price, 0)`;

    if (type === 'rentabilidad') {
      const localDay = `CAST(strftime('%d', s.created_at / 1000 - ${Math.trunc(Number(tzOffset) || 0) * 60}, 'unixepoch') AS INTEGER)`;
      const [totals, products, daySales, dayItems] = await Promise.all([
        this.prisma.$queryRawUnsafe<any[]>(`
          SELECT (SELECT COALESCE(SUM(s.total), 0) FROM sales s WHERE ${completedIn}) AS sales,
                 (SELECT COALESCE(SUM(${itemCost}), 0) ${itemsJoin} WHERE ${completedIn}) AS cost`, ...range, ...range),
        this.prisma.$queryRawUnsafe<any[]>(`
          SELECT MAX(si.product_name) AS name, SUM(si.quantity) AS qty, SUM(si.total) AS revenue, SUM(${itemCost}) AS cost
          ${itemsJoin} WHERE ${completedIn} GROUP BY si.product_id ORDER BY SUM(si.total) - SUM(${itemCost}) DESC LIMIT 10`, ...range),
        this.prisma.$queryRawUnsafe<any[]>(`SELECT ${localDay} AS day, SUM(s.total) AS revenue FROM sales s WHERE ${completedIn} GROUP BY 1`, ...range),
        this.prisma.$queryRawUnsafe<any[]>(`
          SELECT ${localDay} AS day, SUM(${itemCost}) AS cost, SUM(si.total - ${itemCost}) AS profit
          ${itemsJoin} WHERE ${completedIn} GROUP BY 1`, ...range),
      ]);
      const totalSales = num(totals[0]?.sales);
      const totalCost = num(totals[0]?.cost);
      const byDay = new Map<number, { day: number; revenue: number; cost: number; profit: number }>();
      const dayRow = (d: any) => {
        const day = num(d);
        if (!byDay.has(day)) byDay.set(day, { day, revenue: 0, cost: 0, profit: 0 });
        return byDay.get(day)!;
      };
      for (const r of daySales) dayRow(r.day).revenue = num(r.revenue);
      for (const r of dayItems) Object.assign(dayRow(r.day), { cost: num(r.cost), profit: num(r.profit) });
      return {
        totalSales,
        totalCost,
        netProfit: totalSales - totalCost,
        margin: totalSales > 0 ? ((totalSales - totalCost) / totalSales) * 100 : 0,
        topProfitable: products.map((r) => ({
          name: r.name, qty: num(r.qty), revenue: num(r.revenue), cost: num(r.cost), profit: num(r.revenue) - num(r.cost),
        })),
        daily: [...byDay.values()],
      };
    }

    if (type === 'rentabilidad_categoria') {
      const rows = await this.prisma.$queryRawUnsafe<any[]>(`
        SELECT COALESCE(c.name, 'Otro') AS name, COALESCE(MAX(c.color), '#64748b') AS color,
               SUM(si.total) AS sales, SUM(${itemCost}) AS cost
        ${itemsJoin} LEFT JOIN categories c ON c.id = p.category_id
        WHERE ${completedIn} GROUP BY 1`, ...range);
      return rows.map((r) => ({ name: r.name, color: r.color, sales: num(r.sales), cost: num(r.cost), profit: num(r.sales) - num(r.cost) }));
    }

    if (type === 'rotacion_inventario') {
      const rows = await this.prisma.$queryRawUnsafe<any[]>(`
        SELECT si.product_id AS id, MAX(si.product_name) AS name, SUM(si.quantity) AS qty, SUM(si.total) AS revenue
        FROM sale_items si JOIN sales s ON s.id = si.sale_id
        WHERE ${completedIn} GROUP BY si.product_id ORDER BY revenue DESC`, ...range);
      const cumulativeSales = rows.reduce((sum, r) => sum + num(r.revenue), 0);
      let runningTotal = 0;
      return rows.map((r) => {
        runningTotal += num(r.revenue);
        const ratio = cumulativeSales > 0 ? runningTotal / cumulativeSales : 0;
        return { id: r.id, name: r.name, qty: num(r.qty), revenue: num(r.revenue), classification: ratio <= 0.8 ? 'A' : ratio <= 0.95 ? 'B' : 'C' };
      });
    }

    if (type === 'devoluciones') {
      const sales = await this.prisma.sale.findMany({
        where: {
          createdAt: { gte: range[0], lte: range[1] },
          OR: [{ status: 'CANCELLED' }, { status: 'COMPLETED', items: { some: { quantity: { lt: 0 } } } }],
        },
        include: { items: true, user: { select: { fullName: true, username: true } } },
        orderBy: { createdAt: 'desc' },
      });
      const totalRefunded = sales.reduce((sum, s) => sum + (s.status === 'CANCELLED'
        ? s.total || 0
        : s.items.filter((i) => i.quantity < 0).reduce((isum, i) => isum + Math.abs(i.total), 0)), 0);
      return { list: sales, totalRefunded };
    }

    if (type === 'valorizacion') {
      const [r] = await this.prisma.$queryRawUnsafe<any[]>(`
        SELECT COALESCE(SUM(cost_price * stock), 0) AS cost, COALESCE(SUM(sale_price * stock), 0) AS sale, COALESCE(SUM(stock), 0) AS items
        FROM products WHERE is_active = 1 AND id <> 'VENTA_RAPIDA' AND stock > 0`);
      const totalCost = num(r?.cost), totalSale = num(r?.sale);
      return {
        totalCost,
        totalSale,
        potentialProfit: totalSale - totalCost,
        margin: totalSale > 0 ? ((totalSale - totalCost) / totalSale) * 100 : 0,
        itemCount: num(r?.items),
      };
    }

    throw new BadRequestException('Reporte desconocido');
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

    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);
    const startOfMonth = new Date(today);
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    // Todo se suma en la base: traer las ventas para sumarlas acá tardaba cada vez más
    const num = (v: any) => Number(v || 0);
    const completedIn = `s.status = 'COMPLETED' AND s.created_at >= ? AND s.created_at <= ?`;
    const [
      totalsRows, costRows, paymentRows, weeklyRows, monthlyRows,
      monthlyPurchasesAgg, monthlySuppPaymentsAgg, totalProducts, lowStockRaw,
      movementsAgg, supplierPaymentsAgg, purchasesAgg, clientBalanceAgg, purchaseDebtAgg,
      openSessions, latestMovements,
    ] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) AS count, COALESCE(SUM(s.total), 0) AS total FROM sales s WHERE ${completedIn}`, today, endOfPeriod),
      this.prisma.$queryRawUnsafe<any[]>(`
        SELECT COALESCE(SUM(si.quantity * COALESCE(p.cost_price, 0)), 0) AS cost
        FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN products p ON p.id = si.product_id
        WHERE ${completedIn}`, today, endOfPeriod),
      this.prisma.$queryRawUnsafe<any[]>(`
        SELECT pay.method AS method, COALESCE(SUM(pay.amount), 0) AS total
        FROM payments pay JOIN sales s ON s.id = pay.sale_id
        WHERE ${completedIn} GROUP BY pay.method`, today, endOfPeriod),
      this.prisma.$queryRawUnsafe<any[]>(`SELECT COALESCE(SUM(s.total), 0) AS total FROM sales s WHERE ${completedIn}`, lastWeek, endOfPeriod),
      this.prisma.$queryRawUnsafe<any[]>(`
        SELECT (SELECT COALESCE(SUM(s.total), 0) FROM sales s WHERE ${completedIn}) AS revenue,
               (SELECT COALESCE(SUM(pay.amount), 0) FROM payments pay JOIN sales s ON s.id = pay.sale_id
                 WHERE pay.method = 'CASH' AND ${completedIn}) AS cash`, startOfMonth, endOfPeriod, startOfMonth, endOfPeriod),
      this.prisma.purchase.aggregate({
        _sum: { total: true },
        where: { createdAt: { gte: startOfMonth, lte: endOfPeriod }, status: 'COMPLETED' }
      }),
      this.prisma.supplierPayment.aggregate({
        _sum: { amount: true },
        where: { createdAt: { gte: startOfMonth, lte: endOfPeriod } }
      }),
      this.prisma.product.count({ where: { isActive: true } }),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*) as count FROM products WHERE is_active = 1 AND stock <= min_stock;`
      ).catch(() => [{ count: 0 }]),
      // Period's real out-of-pocket expenses
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
      }),
      // Sum of all active client debt balances
      this.prisma.client.aggregate({ _sum: { balance: true }, where: { isActive: true } }),
      // Sum of all unpaid supplier purchases (OWED)
      this.prisma.purchase.aggregate({
        _sum: { total: true },
        where: { paymentStatus: 'OWED', status: { not: 'CANCELLED' } }
      }),
      this.prisma.cashRegisterSession.findMany({ where: { status: 'OPEN' }, select: { id: true, openingAmount: true } }),
      // Latest system audit movements
      this.prisma.auditLog.findMany({
        take: 6,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { fullName: true, username: true } } }
      }),
    ]);

    const totalSales = num(totalsRows[0]?.count);
    const totalRevenue = num(totalsRows[0]?.total);
    const totalCost = num(costRows[0]?.cost);
    const netProfit = totalRevenue - totalCost;

    const paymentBreakdown: Record<string, number> = { CASH: 0 };
    for (const row of paymentRows) paymentBreakdown[row.method] = num(row.total);

    const weeklyTotal = num(weeklyRows[0]?.total);
    const monthlyRevenue = num(monthlyRows[0]?.revenue);
    const monthlyCash = num(monthlyRows[0]?.cash);
    const monthlyPurchaseTotal = monthlyPurchasesAgg._sum?.total || 0;
    const monthlySuppPaymentTotal = monthlySuppPaymentsAgg._sum?.amount || 0;
    const lowStockCount = num(lowStockRaw[0]?.count);

    const expenses =
      (movementsAgg._sum?.amount || 0) +
      (supplierPaymentsAgg._sum?.amount || 0) +
      (purchasesAgg._sum?.total || 0);
    const totalClientBalance = clientBalanceAgg._sum?.balance || 0;
    const totalSupplierDebt = purchaseDebtAgg._sum?.total || 0;

    // Sum of all expected cash in drawers currently open
    let activeSessionsCash = 0;
    if (openSessions.length > 0) {
      const sessionIds = openSessions.map((s) => s.id);
      const [cashAgg, movementsByType] = await Promise.all([
        this.prisma.payment.aggregate({
          _sum: { amount: true },
          where: { method: 'CASH', sale: { status: 'COMPLETED', sessionId: { in: sessionIds } } },
        }),
        this.prisma.cashMovement.groupBy({ by: ['type'], _sum: { amount: true }, where: { sessionId: { in: sessionIds } } }),
      ]);
      let movementsSum = 0;
      for (const m of movementsByType) {
        if (m.type === 'INCOME') movementsSum += m._sum.amount || 0;
        else if (m.type === 'EXPENSE' || m.type === 'WITHDRAWAL') movementsSum -= m._sum.amount || 0;
      }
      activeSessionsCash = openSessions.reduce((sum, s) => sum + s.openingAmount, 0) + (cashAgg._sum.amount || 0) + movementsSum;
    }

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

  /**
   * Resumen para la app móvil del dueño: ventas, ganancia real (ventas − costo − gastos
   * de caja), comparación con el período anterior equivalente y el estado del local.
   * La comparación usa el mismo tramo de tiempo transcurrido (hoy hasta ahora vs. el
   * mismo día de la semana pasada hasta la misma hora), para que sea justa a media jornada.
   */
  async getOwnerSummary(period: 'day' | 'week' | 'month' = 'day') {
    const now = new Date();
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    if (period === 'week') from.setDate(from.getDate() - 6);
    if (period === 'month') from.setDate(1);

    const prevFrom = new Date(from);
    if (period === 'month') prevFrom.setMonth(prevFrom.getMonth() - 1);
    else prevFrom.setDate(prevFrom.getDate() - 7);
    const prevTo = new Date(prevFrom.getTime() + (now.getTime() - from.getTime()));

    const periodTotals = async (gte: Date, lte: Date) => {
      const [sales, expensesAgg] = await Promise.all([
        this.prisma.sale.findMany({
          where: { createdAt: { gte, lte }, status: 'COMPLETED' },
          select: {
            total: true,
            createdAt: true,
            payments: { select: { method: true, amount: true } },
            items: { select: { productId: true, productName: true, quantity: true, total: true, product: { select: { costPrice: true } } } },
          },
        }),
        this.prisma.cashMovement.aggregate({ _sum: { amount: true }, where: { createdAt: { gte, lte }, type: 'EXPENSE' } }),
      ]);
      let revenue = 0;
      let cost = 0;
      for (const s of sales) {
        revenue += s.total;
        for (const it of s.items) cost += (it.product?.costPrice || 0) * it.quantity;
      }
      const expenses = expensesAgg._sum?.amount || 0;
      return { sales, revenue, cost, expenses, profit: revenue - cost - expenses, tickets: sales.length };
    };

    const [cur, prev] = await Promise.all([periodTotals(from, now), periodTotals(prevFrom, prevTo)]);

    // Por hora en el día; por día en semana y mes
    const buckets: { key: string; label: string; revenue: number }[] = [];
    if (period === 'day') {
      for (let h = 0; h < 24; h++) buckets.push({ key: String(h), label: `${h} h`, revenue: 0 });
    } else {
      const d = new Date(from);
      while (d <= now) {
        buckets.push({
          key: `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`,
          label: period === 'week' ? d.toLocaleDateString('es-AR', { weekday: 'short' }) : String(d.getDate()),
          revenue: 0,
        });
        d.setDate(d.getDate() + 1);
      }
    }
    const bucketIndex = new Map(buckets.map((b, i) => [b.key, i]));

    const paymentBreakdown: Record<string, number> = {};
    const top: Record<string, { name: string; quantity: number; revenue: number }> = {};
    for (const s of cur.sales) {
      const t = s.createdAt;
      const key = period === 'day' ? String(t.getHours()) : `${t.getFullYear()}-${t.getMonth()}-${t.getDate()}`;
      const idx = bucketIndex.get(key);
      if (idx !== undefined) buckets[idx].revenue += s.total;
      for (const p of s.payments) paymentBreakdown[p.method] = (paymentBreakdown[p.method] || 0) + p.amount;
      for (const it of s.items) {
        if (!top[it.productId]) top[it.productId] = { name: it.productName, quantity: 0, revenue: 0 };
        top[it.productId].quantity += it.quantity;
        top[it.productId].revenue += it.total;
      }
    }

    const [lowStockItems, lowStockCountRaw, openSessions] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, name, stock, min_stock AS minStock FROM products
         WHERE is_active = 1 AND unlimited_stock = 0 AND stock <= min_stock
         ORDER BY stock ASC LIMIT 5;`
      ).catch(() => []),
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*) AS count FROM products WHERE is_active = 1 AND unlimited_stock = 0 AND stock <= min_stock;`
      ).catch(() => [{ count: 0 }]),
      this.prisma.cashRegisterSession.findMany({
        where: { status: 'OPEN' },
        select: {
          id: true,
          terminalName: true,
          openingAmount: true,
          openedAt: true,
          user: { select: { fullName: true } },
          sales: { where: { status: 'COMPLETED' }, select: { payments: { where: { method: 'CASH' }, select: { amount: true } } } },
          cashMovements: { select: { type: true, amount: true } },
        },
      }),
    ]);

    return {
      period,
      from: from.toISOString(),
      to: now.toISOString(),
      revenue: cur.revenue,
      cost: cur.cost,
      grossProfit: cur.revenue - cur.cost,
      expenses: cur.expenses,
      profit: cur.profit,
      tickets: cur.tickets,
      averageTicket: cur.tickets > 0 ? cur.revenue / cur.tickets : 0,
      previous: { revenue: prev.revenue, profit: prev.profit, tickets: prev.tickets },
      buckets: buckets.map(({ label, revenue }) => ({ label, revenue })),
      paymentBreakdown,
      topProducts: Object.values(top).sort((a, b) => b.revenue - a.revenue).slice(0, 5),
      lowStock: {
        count: Number(lowStockCountRaw[0]?.count || 0),
        items: lowStockItems.map((p) => ({ id: p.id, name: p.name, stock: Number(p.stock), minStock: Number(p.minStock) })),
      },
      openSessions: openSessions.map((s) => {
        let cash = s.openingAmount;
        for (const sale of s.sales) for (const p of sale.payments) cash += p.amount;
        for (const m of s.cashMovements) cash += m.type === 'INCOME' ? m.amount : -m.amount;
        return { id: s.id, terminalName: s.terminalName, userName: s.user?.fullName || '', openedAt: s.openedAt, expectedCash: cash };
      }),
    };
  }

  async getDashboardData(period: 'day' | 'week' | 'month' = 'day', from?: string, to?: string) {
    const conditions = [`s.status = 'COMPLETED'`];
    const params: Date[] = [];
    if (from || to) {
      if (from) { conditions.push('s.created_at >= ?'); params.push(new Date(from)); }
      if (to) { conditions.push('s.created_at <= ?'); params.push(new Date(to)); }
    } else {
      const now = new Date();
      let fromDate = new Date();
      if (period === 'day') fromDate.setHours(0, 0, 0, 0);
      else if (period === 'week') fromDate.setDate(now.getDate() - 7);
      else if (period === 'month') fromDate.setMonth(now.getMonth() - 1);
      conditions.push('s.created_at >= ?');
      params.push(fromDate);
    }
    const where = conditions.join(' AND ');
    // Día en UTC, igual que toISOString(): los gráficos agrupan como antes
    const day = `strftime('%Y-%m-%d', s.created_at / 1000, 'unixepoch')`;
    const num = (v: any) => Number(v || 0);

    // Todo agrupado en la base: traer cada venta con sus ítems tardaba segundos en un mes
    const [dayRows, costRows, productRows, clientRows] = await Promise.all([
      this.prisma.$queryRawUnsafe<any[]>(
        `SELECT ${day} AS date, SUM(s.total) AS sales, COUNT(*) AS count FROM sales s WHERE ${where} GROUP BY 1 ORDER BY 1`, ...params),
      this.prisma.$queryRawUnsafe<any[]>(`
        SELECT ${day} AS date, SUM(si.quantity * COALESCE(p.cost_price, 0)) AS cost
        FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN products p ON p.id = si.product_id
        WHERE ${where} GROUP BY 1`, ...params),
      this.prisma.$queryRawUnsafe<any[]>(`
        SELECT si.product_id AS id, MAX(si.product_name) AS name, SUM(si.quantity) AS quantity,
               SUM(si.total) AS revenue, COALESCE(MAX(p.stock), 0) AS stock
        FROM sale_items si JOIN sales s ON s.id = si.sale_id LEFT JOIN products p ON p.id = si.product_id
        WHERE ${where} GROUP BY si.product_id ORDER BY quantity DESC LIMIT 10`, ...params),
      this.prisma.$queryRawUnsafe<any[]>(`
        SELECT c.id AS id, c.name AS name, c.dni AS dni, c.phone AS phone,
               COUNT(*) AS salesCount, SUM(s.total) AS totalSpent
        FROM sales s JOIN clients c ON c.id = s.client_id
        WHERE ${where} GROUP BY c.id ORDER BY totalSpent DESC LIMIT 10`, ...params),
    ]);

    const costByDay = new Map(costRows.map((r) => [r.date, num(r.cost)]));
    const chartData: any = {};
    for (const r of dayRows) {
      const sales = num(r.sales);
      chartData[r.date] = { date: r.date, sales, profit: sales - (costByDay.get(r.date) || 0), count: num(r.count) };
    }

    return {
      stats: chartData,
      history: Object.values(chartData),
      topProducts: productRows.map((r) => ({ id: r.id, name: r.name, quantity: num(r.quantity), revenue: num(r.revenue), stock: num(r.stock) })),
      topClients: clientRows.map((r) => ({ id: r.id, name: r.name, dni: r.dni, phone: r.phone, salesCount: num(r.salesCount), totalSpent: num(r.totalSpent) })),
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

