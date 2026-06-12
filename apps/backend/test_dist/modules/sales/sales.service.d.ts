import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../websockets/events.gateway';
interface CreateSaleDto {
    sessionId: string;
    items: {
        productId: string;
        quantity: number;
        discount?: number;
    }[];
    payments: {
        method: string;
        amount: number;
        reference?: string;
    }[];
    notes?: string;
    clientId?: string;
}
export declare class SalesService {
    private prisma;
    private events;
    constructor(prisma: PrismaService, events: EventsGateway);
    create(userId: string, dto: CreateSaleDto): Promise<{
        user: {
            username: string;
            fullName: string;
        };
        items: {
            id: string;
            productId: string;
            subtotal: number;
            total: number;
            productName: string;
            unitPrice: number;
            quantity: number;
            discount: number;
            saleId: string;
        }[];
        payments: {
            id: string;
            createdAt: Date;
            saleId: string;
            method: string;
            amount: number;
            reference: string | null;
        }[];
    } & {
        id: string;
        createdAt: Date;
        userId: string;
        status: string;
        saleNumber: number;
        subtotal: number;
        taxAmount: number;
        discountAmount: number;
        total: number;
        paymentMethodSummary: string;
        notes: string | null;
        sessionId: string;
        clientId: string | null;
    }>;
    findAll(params?: {
        sessionId?: string;
        userId?: string;
        from?: string;
        to?: string;
        paymentMethod?: string;
        limit?: number;
    }): Promise<({
        user: {
            username: string;
            fullName: string;
        };
        items: {
            id: string;
            productId: string;
            subtotal: number;
            total: number;
            productName: string;
            unitPrice: number;
            quantity: number;
            discount: number;
            saleId: string;
        }[];
        payments: {
            id: string;
            createdAt: Date;
            saleId: string;
            method: string;
            amount: number;
            reference: string | null;
        }[];
    } & {
        id: string;
        createdAt: Date;
        userId: string;
        status: string;
        saleNumber: number;
        subtotal: number;
        taxAmount: number;
        discountAmount: number;
        total: number;
        paymentMethodSummary: string;
        notes: string | null;
        sessionId: string;
        clientId: string | null;
    })[]>;
    findById(id: string): Promise<{
        user: {
            username: string;
            fullName: string;
        };
        session: {
            terminalName: string;
        };
        items: ({
            product: {
                barcode: string;
                imageUrl: string;
            };
        } & {
            id: string;
            productId: string;
            subtotal: number;
            total: number;
            productName: string;
            unitPrice: number;
            quantity: number;
            discount: number;
            saleId: string;
        })[];
        payments: {
            id: string;
            createdAt: Date;
            saleId: string;
            method: string;
            amount: number;
            reference: string | null;
        }[];
    } & {
        id: string;
        createdAt: Date;
        userId: string;
        status: string;
        saleNumber: number;
        subtotal: number;
        taxAmount: number;
        discountAmount: number;
        total: number;
        paymentMethodSummary: string;
        notes: string | null;
        sessionId: string;
        clientId: string | null;
    }>;
    cancel(id: string, userId: string): Promise<{
        items: {
            id: string;
            productId: string;
            subtotal: number;
            total: number;
            productName: string;
            unitPrice: number;
            quantity: number;
            discount: number;
            saleId: string;
        }[];
        payments: {
            id: string;
            createdAt: Date;
            saleId: string;
            method: string;
            amount: number;
            reference: string | null;
        }[];
    } & {
        id: string;
        createdAt: Date;
        userId: string;
        status: string;
        saleNumber: number;
        subtotal: number;
        taxAmount: number;
        discountAmount: number;
        total: number;
        paymentMethodSummary: string;
        notes: string | null;
        sessionId: string;
        clientId: string | null;
    }>;
    getTodaySummary(): Promise<{
        totalSales: number;
        totalRevenue: number;
        totalCost: number;
        netProfit: number;
        weeklyTotal: number;
        paymentBreakdown: {
            CASH: number;
            CLOVER: number;
            MERCADOPAGO: number;
        };
        averageTicket: number;
    }>;
    getDashboardData(period?: 'day' | 'week' | 'month'): Promise<{
        stats: any;
        history: unknown[];
        topProducts: unknown[];
    }>;
}
export {};
