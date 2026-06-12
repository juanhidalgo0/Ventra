import { ClientsService } from './clients.service';
export declare class ClientsController {
    private readonly clientsService;
    constructor(clientsService: ClientsService);
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
    addMovement(id: string, data: any): Promise<{
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
