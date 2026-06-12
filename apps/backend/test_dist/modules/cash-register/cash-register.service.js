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
exports.CashRegisterService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../database/prisma.service");
const events_gateway_1 = require("../../websockets/events.gateway");
let CashRegisterService = class CashRegisterService {
    constructor(prisma, events) {
        this.prisma = prisma;
        this.events = events;
    }
    async open(userId, data) {
        const existingOpen = await this.prisma.cashRegisterSession.findFirst({ where: { userId, status: 'OPEN' } });
        if (existingOpen)
            throw new common_1.BadRequestException(`Ya tenés una caja abierta en terminal "${existingOpen.terminalName}". Cerrala antes de abrir una nueva.`);
        const session = await this.prisma.cashRegisterSession.create({
            data: { userId, terminalName: data.terminalName, openingAmount: data.openingAmount, openingNotes: data.openingNotes },
            include: { user: { select: { fullName: true, username: true } } },
        });
        await this.prisma.auditLog.create({ data: { userId, entityType: 'CASH_REGISTER', entityId: session.id, action: 'OPEN', newValues: JSON.stringify({ terminalName: data.terminalName, openingAmount: data.openingAmount }) } });
        this.events.emitCashUpdated({ action: 'OPEN', sessionId: session.id });
        return session;
    }
    async close(sessionId, userId, data) {
        const session = await this.prisma.cashRegisterSession.findUnique({ where: { id: sessionId } });
        if (!session)
            throw new common_1.NotFoundException('Sesión de caja no encontrada');
        if (session.status !== 'OPEN')
            throw new common_1.BadRequestException('Esta caja ya está cerrada');
        if (session.userId !== userId)
            throw new common_1.BadRequestException('Solo el cajero que abrió la caja puede cerrarla');
        const sales = await this.prisma.sale.findMany({ where: { sessionId, status: 'COMPLETED' }, include: { payments: true } });
        const cashMovements = await this.prisma.cashMovement.findMany({ where: { sessionId } });
        const paymentBreakdown = { CASH: 0, CLOVER: 0, MERCADOPAGO: 0 };
        let totalSales = 0;
        for (const sale of sales) {
            totalSales += sale.total;
            for (const payment of sale.payments) {
                if (payment.method in paymentBreakdown)
                    paymentBreakdown[payment.method] += payment.amount;
            }
        }
        let cashIncome = 0, cashExpense = 0, cashWithdrawal = 0;
        for (const mov of cashMovements) {
            if (mov.type === 'INCOME')
                cashIncome += mov.amount;
            else if (mov.type === 'EXPENSE')
                cashExpense += mov.amount;
            else if (mov.type === 'WITHDRAWAL')
                cashWithdrawal += mov.amount;
        }
        const expectedCash = session.openingAmount + paymentBreakdown.CASH + cashIncome - cashExpense - cashWithdrawal;
        const difference = data.closingAmountCounted - expectedCash;
        const closingSummary = { totalSales: sales.length, totalRevenue: totalSales, paymentBreakdown, cashIncome, cashExpense, cashWithdrawal, openingAmount: session.openingAmount, expectedCash, countedCash: data.closingAmountCounted, difference };
        const updated = await this.prisma.cashRegisterSession.update({
            where: { id: sessionId },
            data: { status: 'CLOSED', closingAmountExpected: expectedCash, closingAmountCounted: data.closingAmountCounted, difference, closingNotes: data.closingNotes, closingSummary: JSON.stringify(closingSummary), closedAt: new Date() },
            include: { user: { select: { fullName: true, username: true } } },
        });
        await this.prisma.auditLog.create({ data: { userId, entityType: 'CASH_REGISTER', entityId: sessionId, action: 'CLOSE', newValues: JSON.stringify(closingSummary) } });
        this.events.emitCashUpdated({ action: 'CLOSE', sessionId });
        return { ...updated, closingSummaryParsed: closingSummary };
    }
    async getCurrentSession(userId) {
        return this.prisma.cashRegisterSession.findFirst({
            where: { userId, status: 'OPEN' },
            include: { user: { select: { fullName: true, username: true } }, sales: { where: { status: 'COMPLETED' }, include: { payments: true }, orderBy: { createdAt: 'desc' } }, cashMovements: true },
        });
    }
    async getHistory(params) {
        const where = { status: 'CLOSED' };
        if (params?.userId)
            where.userId = params.userId;
        if (params?.from || params?.to) {
            where.closedAt = {};
            if (params.from)
                where.closedAt.gte = new Date(params.from);
            if (params.to)
                where.closedAt.lte = new Date(params.to);
        }
        return this.prisma.cashRegisterSession.findMany({ where, include: { user: { select: { fullName: true, username: true } } }, orderBy: { closedAt: 'desc' }, take: params?.limit || 50 });
    }
    async addCashMovement(sessionId, userId, data) {
        const session = await this.prisma.cashRegisterSession.findUnique({ where: { id: sessionId } });
        if (!session || session.status !== 'OPEN')
            throw new common_1.BadRequestException('No hay una caja abierta');
        return this.prisma.cashMovement.create({ data: { sessionId, userId, type: data.type, amount: data.amount, description: data.description } });
    }
};
exports.CashRegisterService = CashRegisterService;
exports.CashRegisterService = CashRegisterService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, events_gateway_1.EventsGateway])
], CashRegisterService);
//# sourceMappingURL=cash-register.service.js.map