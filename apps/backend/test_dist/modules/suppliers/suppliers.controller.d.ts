import { PrismaService } from '../../database/prisma.service';
export declare class SuppliersController {
    private prisma;
    constructor(prisma: PrismaService);
    findAll(): Promise<({
        _count: {
            products: number;
        };
    } & {
        id: string;
        name: string;
        contact: string | null;
        phone: string | null;
        email: string | null;
    })[]>;
}
