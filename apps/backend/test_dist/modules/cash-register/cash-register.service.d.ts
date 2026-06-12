import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../websockets/events.gateway';
export declare class CashRegisterService {
    private prisma;
    private events;
    constructor(prisma: PrismaService, events: EventsGateway);
    open(userId: string, data: {
        terminalName: string;
        openingAmount: number;
        openingNotes?: string;
    }): Promise<{
        user: {
            username: string;
            fullName: string;
        };
    } & {
        id: string;
        userId: string;
        terminalName: string;
        openingAmount: number;
        closingAmountExpected: number | null;
        closingAmountCounted: number | null;
        difference: number | null;
        openingNotes: string | null;
        closingNotes: string | null;
        status: string;
        closingSummary: string | null;
        openedAt: Date;
        closedAt: Date | null;
    }>;
    close(sessionId: string, userId: string, data: {
        closingAmountCounted: number;
        closingNotes?: string;
    }): Promise<{
        closingSummaryParsed: {
            totalSales: number;
            totalRevenue: number;
            paymentBreakdown: {
                CASH: number;
                CLOVER: number;
                MERCADOPAGO: number;
            };
            cashIncome: number;
            cashExpense: number;
            cashWithdrawal: number;
            openingAmount: number;
            expectedCash: number;
            countedCash: number;
            difference: number;
        };
        user: {
            username: string;
            fullName: string;
        };
        id: string;
        userId: string;
        terminalName: string;
        openingAmount: number;
        closingAmountExpected: number | null;
        closingAmountCounted: number | null;
        difference: number | null;
        openingNotes: string | null;
        closingNotes: string | null;
        status: string;
        closingSummary: string | null;
        openedAt: Date;
        closedAt: Date | null;
    }>;
    getCurrentSession(userId: string): Promise<{
        user: {
            username: string;
            fullName: string;
        };
        sales: ({
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
        })[];
        cashMovements: {
            id: string;
            createdAt: Date;
            userId: string;
            description: string | null;
            sessionId: string;
            amount: number;
            type: string;
        }[];
    } & {
        id: string;
        userId: string;
        terminalName: string;
        openingAmount: number;
        closingAmountExpected: number | null;
        closingAmountCounted: number | null;
        difference: number | null;
        openingNotes: string | null;
        closingNotes: string | null;
        status: string;
        closingSummary: string | null;
        openedAt: Date;
        closedAt: Date | null;
    }>;
    getHistory(params?: {
        userId?: string;
        from?: string;
        to?: string;
        limit?: number;
    }): Promise<({
        user: {
            username: string;
            fullName: string;
        };
    } & {
        id: string;
        userId: string;
        terminalName: string;
        openingAmount: number;
        closingAmountExpected: number | null;
        closingAmountCounted: number | null;
        difference: number | null;
        openingNotes: string | null;
        closingNotes: string | null;
        status: string;
        closingSummary: string | null;
        openedAt: Date;
        closedAt: Date | null;
    })[]>;
    addCashMovement(sessionId: string, userId: string, data: {
        type: string;
        amount: number;
        description?: string;
    }): Promise<{
        id: string;
        createdAt: Date;
        userId: string;
        description: string | null;
        sessionId: string;
        amount: number;
        type: string;
    }>;
}
