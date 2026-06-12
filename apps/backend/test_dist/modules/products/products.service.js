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
exports.ProductsService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../database/prisma.service");
let ProductsService = class ProductsService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findAll(params) {
        const where = { isActive: true };
        if (params?.search) {
            where.OR = [
                { name: { contains: params.search } },
                { barcode: { contains: params.search } },
                { sku: { contains: params.search } },
            ];
        }
        if (params?.categoryId)
            where.categoryId = params.categoryId;
        if (params?.isFavorite)
            where.isFavorite = true;
        if (params?.lowStock) {
            const products = await this.prisma.product.findMany({
                where: { isActive: true },
                include: { category: { select: { id: true, name: true, color: true, icon: true } }, brand: { select: { id: true, name: true } }, supplier: { select: { id: true, name: true } } },
                orderBy: { name: 'asc' },
            });
            return products.filter((p) => p.stock <= p.minStock);
        }
        return this.prisma.product.findMany({
            where,
            include: { category: { select: { id: true, name: true, color: true, icon: true } }, brand: { select: { id: true, name: true } }, supplier: { select: { id: true, name: true } } },
            orderBy: { name: 'asc' },
        });
    }
    async findById(id) {
        const product = await this.prisma.product.findUnique({ where: { id }, include: { category: true, brand: true, supplier: true } });
        if (!product)
            throw new common_1.NotFoundException('Producto no encontrado');
        return product;
    }
    async findByBarcode(barcode) {
        const product = await this.prisma.product.findUnique({
            where: { barcode },
            include: { category: { select: { id: true, name: true, color: true } } },
        });
        if (!product)
            throw new common_1.NotFoundException('Producto no encontrado');
        return product;
    }
    async create(data) {
        return this.prisma.product.create({ data, include: { category: { select: { id: true, name: true, color: true } }, brand: { select: { id: true, name: true } } } });
    }
    async update(id, data, userId) {
        const existing = await this.prisma.product.findUnique({ where: { id } });
        if (!existing)
            throw new common_1.NotFoundException('Producto no encontrado');
        if (data.salePrice && data.salePrice !== existing.salePrice && userId) {
            await this.prisma.priceHistory.create({ data: { productId: id, userId, oldPrice: existing.salePrice, newPrice: data.salePrice } });
        }
        return this.prisma.product.update({ where: { id }, data, include: { category: { select: { id: true, name: true, color: true } }, brand: { select: { id: true, name: true } } } });
    }
    async delete(id) {
        const product = await this.prisma.product.findUnique({ where: { id } });
        if (!product)
            throw new common_1.NotFoundException('Producto no encontrado');
        return this.prisma.product.update({ where: { id }, data: { isActive: false } });
    }
    async toggleFavorite(id) {
        const product = await this.prisma.product.findUnique({ where: { id } });
        if (!product)
            throw new common_1.NotFoundException('Producto no encontrado');
        return this.prisma.product.update({ where: { id }, data: { isFavorite: !product.isFavorite } });
    }
};
exports.ProductsService = ProductsService;
exports.ProductsService = ProductsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ProductsService);
//# sourceMappingURL=products.service.js.map