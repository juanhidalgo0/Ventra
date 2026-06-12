"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SalesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../database/prisma.service");
const events_gateway_1 = require("../../websockets/events.gateway");
let SalesService = class SalesService {
    constructor(prisma, events) {
        this.prisma = prisma;
        this.events = events;
    }
    async create(userId, dto) {
        const session = await this.prisma.cashRegisterSession.findUnique({ where: { id: dto.sessionId } });
        if (!session || session.status !== 'OPEN')
            throw new common_1.BadRequestException('No hay una caja abierta para esta sesión');
        return this.prisma.$transaction(async (tx) => {
            let subtotal = 0;
            const saleItems = [];
            for (const item of dto.items) {
                const product = await tx.product.findUnique({ where: { id: item.productId } });
                if (!product)
                    throw new common_1.BadRequestException(`Producto no encontrado: ${item.productId}`);
                if (!product.isActive)
                    throw new common_1.BadRequestException(`Producto inactivo: ${product.name}`);
                if (product.stock < item.quantity)
                    throw new common_1.BadRequestException(`Stock insuficiente para "${product.name}": disponible ${product.stock}, solicitado ${item.quantity}`);
                const itemSubtotal = product.salePrice * item.quantity;
                const itemDiscount = item.discount || 0;
                const itemTotal = itemSubtotal - itemDiscount;
                saleItems.push({ productId: product.id, productName: product.name, unitPrice: product.salePrice, quantity: item.quantity, subtotal: itemSubtotal, discount: itemDiscount, total: itemTotal });
                subtotal += itemTotal;
                const stockBefore = product.stock;
                await tx.product.update({ where: { id: product.id }, data: { stock: { decrement: item.quantity } } });
                await tx.inventoryMovement.create({ data: { productId: product.id, userId, type: 'SALE', quantity: -item.quantity, stockBefore, stockAfter: stockBefore - item.quantity, reference: 'Venta POS' } });
            }
            const totalPayments = dto.payments.reduce((sum, p) => sum + p.amount, 0);
            if (Math.abs(totalPayments - subtotal) > 0.01)
                throw new common_1.BadRequestException(`El total de pagos ($${totalPayments}) no coincide con el total de la venta ($${subtotal})`);
            const paymentMethodSummary = dto.payments.length === 1 ? dto.payments[0].method : 'MIXED';
            const lastSale = await tx.sale.findFirst({ orderBy: { saleNumber: 'desc' } });
            const saleNumber = (lastSale?.saleNumber || 0) + 1;
            const sale = await tx.sale.create({
                data: {
                    saleNumber, userId, sessionId: dto.sessionId, subtotal, total: subtotal, paymentMethodSummary, notes: dto.notes, clientId: dto.clientId,
                    items: { create: saleItems },
                    payments: { create: dto.payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference })) },
                },
                include: { items: true, payments: true, user: { select: { fullName: true, username: true } } },
            });
            const debtAmount = dto.payments.filter(p => p.method === 'DEBT').reduce((sum, p) => sum + p.amount, 0);
            if (debtAmount > 0) {
                if (!dto.clientId)
                    throw new common_1.BadRequestException('Se requiere un cliente para ventas a crédito');
                const client = await tx.client.findUnique({ where: { id: dto.clientId } });
                if (!client)
                    throw new common_1.BadRequestException('Cliente no encontrado');
                const balanceBefore = client.balance;
                const balanceAfter = balanceBefore + debtAmount;
                await tx.accountMovement.create({
                    data: {
                        clientId: dto.clientId,
                        saleId: sale.id,
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
            await tx.auditLog.create({ data: { userId, entityType: 'SALE', entityId: sale.id, action: 'CREATE', newValues: JSON.stringify({ saleNumber: sale.saleNumber, total: sale.total, paymentMethodSummary, itemCount: saleItems.length }) } });
            this.events.emitSaleCreated(sale);
            this.events.emitStockUpdated(saleItems.map((i) => ({ productId: i.productId, newStock: 0 })));
            return sale;
        });
    }
    async findAll(params) {
        const where = {};
        if (params?.sessionId)
            where.sessionId = params.sessionId;
        if (params?.userId)
            where.userId = params.userId;
        if (params?.paymentMethod)
            where.paymentMethodSummary = params.paymentMethod;
        if (params?.from || params?.to) {
            where.createdAt = {};
            if (params.from)
                where.createdAt.gte = new Date(params.from);
            if (params.to)
                where.createdAt.lte = new Date(params.to);
        }
        return this.prisma.sale.findMany({
            where,
            include: { items: true, payments: true, user: { select: { fullName: true, username: true } } },
            orderBy: { createdAt: 'desc' },
            take: params?.limit || 100,
        });
    }
    async findById(id) {
        const sale = await this.prisma.sale.findUnique({
            where: { id },
            include: { items: { include: { product: { select: { barcode: true, imageUrl: true } } } }, payments: true, user: { select: { fullName: true, username: true } }, session: { select: { terminalName: true } } },
        });
        if (!sale)
            throw new common_1.NotFoundException('Venta no encontrada');
        return sale;
    }
    async cancel(id, userId) {
        const sale = await this.prisma.sale.findUnique({ where: { id }, include: { items: true } });
        if (!sale)
            throw new common_1.NotFoundException('Venta no encontrada');
        if (sale.status !== 'COMPLETED')
            throw new common_1.BadRequestException('Solo se pueden cancelar ventas completadas');
        return this.prisma.$transaction(async (tx) => {
            for (const item of sale.items) {
                const product = await tx.product.findUnique({ where: { id: item.productId } });
                await tx.product.update({ where: { id: item.productId }, data: { stock: { increment: item.quantity } } });
                await tx.inventoryMovement.create({ data: { productId: item.productId, userId, type: 'RETURN', quantity: item.quantity, stockBefore: product?.stock || 0, stockAfter: (product?.stock || 0) + item.quantity, reference: `Cancelación venta #${sale.saleNumber}` } });
            }
            const updatedSale = await tx.sale.update({ where: { id }, data: { status: 'CANCELLED' }, include: { items: true, payments: true } });
            await tx.auditLog.create({ data: { userId, entityType: 'SALE', entityId: sale.id, action: 'CANCEL', oldValues: JSON.stringify({ status: 'COMPLETED' }), newValues: JSON.stringify({ status: 'CANCELLED' }) } });
            this.events.emitStockUpdated([]);
            return updatedSale;
        });
    }
    async getTodaySummary() {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const sales = await this.prisma.sale.findMany({
            where: { createdAt: { gte: today }, status: 'COMPLETED' },
            include: { payments: true, items: { include: { product: { select: { costPrice: true } } } } },
        });
        const totalSales = sales.length;
        let totalRevenue = 0;
        let totalCost = 0;
        const paymentBreakdown = { CASH: 0, CLOVER: 0, MERCADOPAGO: 0 };
        for (const sale of sales) {
            totalRevenue += sale.total;
            for (const item of sale.items) {
                totalCost += (item.product?.costPrice || 0) * item.quantity;
            }
            for (const payment of sale.payments) {
                if (payment.method in paymentBreakdown) {
                    paymentBreakdown[payment.method] += payment.amount;
                }
            }
        }
        const grossProfit = totalRevenue;
        const netProfit = totalRevenue - totalCost;
        const lastWeek = new Date();
        lastWeek.setDate(lastWeek.getDate() - 7);
        const weeklySales = await this.prisma.sale.findMany({
            where: { createdAt: { gte: lastWeek }, status: 'COMPLETED' },
            select: { total: true },
        });
        const weeklyTotal = weeklySales.reduce((sum, s) => sum + s.total, 0);
        return {
            totalSales,
            totalRevenue,
            totalCost,
            netProfit,
            weeklyTotal,
            paymentBreakdown,
            averageTicket: totalSales > 0 ? totalRevenue / totalSales : 0,
        };
    }
    async getDashboardData(period = 'day') {
        const now = new Date();
        let fromDate = new Date();
        if (period === 'day')
            fromDate.setHours(0, 0, 0, 0);
        else if (period === 'week')
            fromDate.setDate(now.getDate() - 7);
        else if (period === 'month')
            fromDate.setMonth(now.getMonth() - 1);
        const sales = await this.prisma.sale.findMany({
            where: { createdAt: { gte: fromDate }, status: 'COMPLETED' },
            include: { items: { include: { product: { select: { costPrice: true } } } } },
            orderBy: { createdAt: 'asc' },
        });
        const chartData = {};
        const topProducts = {};
        for (const sale of sales) {
            const dateKey = sale.createdAt.toISOString().split('T')[0];
            if (!chartData[dateKey])
                chartData[dateKey] = { date: dateKey, sales: 0, profit: 0, count: 0 };
            chartData[dateKey].sales += sale.total;
            chartData[dateKey].count += 1;
            let saleCost = 0;
            for (const item of sale.items) {
                const itemProfit = (item.unitPrice - (item.product?.costPrice || 0)) * item.quantity;
                saleCost += (item.product?.costPrice || 0) * item.quantity;
                if (!topProducts[item.productId])
                    topProducts[item.productId] = { id: item.productId, name: item.productName, quantity: 0, revenue: 0 };
                topProducts[item.productId].quantity += item.quantity;
                topProducts[item.productId].revenue += item.total;
            }
            chartData[dateKey].profit += (sale.total - saleCost);
        }
        return {
            stats: chartData,
            history: Object.values(chartData),
            topProducts: Object.values(topProducts).sort((a, b) => b.quantity - a.quantity).slice(0, 5),
        };
    }
};
exports.SalesService = SalesService;
exports.SalesService = SalesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, events_gateway_1.EventsGateway])
], SalesService);
//# sourceMappingURL=sales.service.js.map