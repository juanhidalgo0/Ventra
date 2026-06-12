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
exports.ClientsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../database/prisma.service");
let ClientsService = class ClientsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findAll() {
        return this.prisma.client.findMany({
            where: { isActive: true },
            orderBy: { name: 'asc' },
        });
    }
    async findOne(id) {
        const client = await this.prisma.client.findUnique({
            where: { id },
            include: {
                movements: {
                    orderBy: { createdAt: 'desc' },
                    take: 50,
                },
            },
        });
        if (!client)
            throw new common_1.NotFoundException('Cliente no encontrado');
        return client;
    }
    async create(data) {
        return this.prisma.client.create({ data });
    }
    async update(id, data) {
        return this.prisma.client.update({ where: { id }, data });
    }
    async addMovement(clientId, data) {
        return this.prisma.$transaction(async (tx) => {
            const client = await tx.client.findUnique({ where: { id: clientId } });
            if (!client)
                throw new common_1.NotFoundException('Cliente no encontrado');
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
};
exports.ClientsService = ClientsService;
exports.ClientsService = ClientsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ClientsService);
//# sourceMappingURL=clients.service.js.map