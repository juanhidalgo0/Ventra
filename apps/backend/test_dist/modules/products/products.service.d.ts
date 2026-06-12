import { PrismaService } from '../../database/prisma.service';
export declare class ProductsService {
    private prisma;
    constructor(prisma: PrismaService);
    findAll(params?: {
        search?: string;
        categoryId?: string;
        isActive?: boolean;
        isFavorite?: boolean;
        lowStock?: boolean;
    }): Promise<({
        category: {
            id: string;
            name: string;
            color: string;
            icon: string;
        };
        brand: {
            id: string;
            name: string;
        };
        supplier: {
            id: string;
            name: string;
        };
    } & {
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        sku: string | null;
        barcode: string | null;
        categoryId: string | null;
        brandId: string | null;
        supplierId: string | null;
        description: string | null;
        imageUrl: string | null;
        costPrice: number;
        salePrice: number;
        stock: number;
        minStock: number;
        unit: string;
        taxRate: number;
        isFavorite: boolean;
    })[]>;
    findById(id: string): Promise<{
        category: {
            id: string;
            isActive: boolean;
            name: string;
            color: string;
            icon: string;
            displayOrder: number;
        };
        brand: {
            id: string;
            name: string;
        };
        supplier: {
            id: string;
            name: string;
            contact: string | null;
            phone: string | null;
            email: string | null;
        };
    } & {
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        sku: string | null;
        barcode: string | null;
        categoryId: string | null;
        brandId: string | null;
        supplierId: string | null;
        description: string | null;
        imageUrl: string | null;
        costPrice: number;
        salePrice: number;
        stock: number;
        minStock: number;
        unit: string;
        taxRate: number;
        isFavorite: boolean;
    }>;
    findByBarcode(barcode: string): Promise<{
        category: {
            id: string;
            name: string;
            color: string;
        };
    } & {
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        sku: string | null;
        barcode: string | null;
        categoryId: string | null;
        brandId: string | null;
        supplierId: string | null;
        description: string | null;
        imageUrl: string | null;
        costPrice: number;
        salePrice: number;
        stock: number;
        minStock: number;
        unit: string;
        taxRate: number;
        isFavorite: boolean;
    }>;
    create(data: any): Promise<{
        category: {
            id: string;
            name: string;
            color: string;
        };
        brand: {
            id: string;
            name: string;
        };
    } & {
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        sku: string | null;
        barcode: string | null;
        categoryId: string | null;
        brandId: string | null;
        supplierId: string | null;
        description: string | null;
        imageUrl: string | null;
        costPrice: number;
        salePrice: number;
        stock: number;
        minStock: number;
        unit: string;
        taxRate: number;
        isFavorite: boolean;
    }>;
    update(id: string, data: any, userId?: string): Promise<{
        category: {
            id: string;
            name: string;
            color: string;
        };
        brand: {
            id: string;
            name: string;
        };
    } & {
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        sku: string | null;
        barcode: string | null;
        categoryId: string | null;
        brandId: string | null;
        supplierId: string | null;
        description: string | null;
        imageUrl: string | null;
        costPrice: number;
        salePrice: number;
        stock: number;
        minStock: number;
        unit: string;
        taxRate: number;
        isFavorite: boolean;
    }>;
    delete(id: string): Promise<{
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        sku: string | null;
        barcode: string | null;
        categoryId: string | null;
        brandId: string | null;
        supplierId: string | null;
        description: string | null;
        imageUrl: string | null;
        costPrice: number;
        salePrice: number;
        stock: number;
        minStock: number;
        unit: string;
        taxRate: number;
        isFavorite: boolean;
    }>;
    toggleFavorite(id: string): Promise<{
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        sku: string | null;
        barcode: string | null;
        categoryId: string | null;
        brandId: string | null;
        supplierId: string | null;
        description: string | null;
        imageUrl: string | null;
        costPrice: number;
        salePrice: number;
        stock: number;
        minStock: number;
        unit: string;
        taxRate: number;
        isFavorite: boolean;
    }>;
}
