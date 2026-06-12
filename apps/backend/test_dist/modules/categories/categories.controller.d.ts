import { PrismaService } from '../../database/prisma.service';
export declare class CategoriesController {
    private prisma;
    constructor(prisma: PrismaService);
    findAll(): Promise<({
        _count: {
            products: number;
        };
    } & {
        id: string;
        isActive: boolean;
        name: string;
        color: string;
        icon: string;
        displayOrder: number;
    })[]>;
    create(data: {
        name: string;
        color?: string;
        icon?: string;
    }): Promise<{
        id: string;
        isActive: boolean;
        name: string;
        color: string;
        icon: string;
        displayOrder: number;
    }>;
    update(id: string, data: any): Promise<{
        id: string;
        isActive: boolean;
        name: string;
        color: string;
        icon: string;
        displayOrder: number;
    }>;
    delete(id: string): Promise<{
        id: string;
        isActive: boolean;
        name: string;
        color: string;
        icon: string;
        displayOrder: number;
    }>;
}
