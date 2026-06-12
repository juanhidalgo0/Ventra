import { SalesService } from './sales.service';
export declare class SalesController {
    private salesService;
    constructor(salesService: SalesService);
    create(req: any, dto: any): Promise<{
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
    findAll(sessionId?: string, from?: string, to?: string, paymentMethod?: string, limit?: string): Promise<({
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
    cancel(id: string, req: any): Promise<{
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
}
