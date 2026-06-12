import { PrismaService } from '../../database/prisma.service';
export declare class ClientsService {
    private prisma;
    constructor(prisma: PrismaService);
    findAll(): Promise<{
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        phone: string | null;
        email: string | null;
        dni: string | null;
        address: string | null;
        balance: number;
    }[]>;
    findOne(id: string): Promise<{
        movements: {
            id: string;
            createdAt: Date;
            userId: string;
            description: string | null;
            clientId: string;
            saleId: string | null;
            amount: number;
            type: string;
            balanceBefore: number;
            balanceAfter: number;
        }[];
    } & {
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        phone: string | null;
        email: string | null;
        dni: string | null;
        address: string | null;
        balance: number;
    }>;
    create(data: any): Promise<{
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        phone: string | null;
        email: string | null;
        dni: string | null;
        address: string | null;
        balance: number;
    }>;
    update(id: string, data: any): Promise<{
        id: string;
        isActive: boolean;
        createdAt: Date;
        updatedAt: Date;
        name: string;
        phone: string | null;
        email: string | null;
        dni: string | null;
        address: string | null;
        balance: number;
    }>;
    addMovement(clientId: string, data: {
        type: 'DEBT' | 'PAYMENT';
        amount: number;
        description?: string;
        saleId?: string;
        userId: string;
    }): Promise<{
        id: string;
        createdAt: Date;
        userId: string;
        description: string | null;
        clientId: string;
        saleId: string | null;
        amount: number;
        type: string;
        balanceBefore: number;
        balanceAfter: number;
    }>;
}
