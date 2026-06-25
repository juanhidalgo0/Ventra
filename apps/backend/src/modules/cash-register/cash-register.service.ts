import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../websockets/events.gateway';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class CashRegisterService {
  constructor(private prisma: PrismaService, private events: EventsGateway) {}

  async getTerminalName(terminalId: string) {
    if (!terminalId) throw new BadRequestException('Se requiere terminalId');
    const filePath = path.join(process.cwd(), 'prisma', 'terminals.json');
    let terminals: string[] = [];
    try {
      if (fs.existsSync(filePath)) {
        terminals = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch (err) {
      console.error('Error reading terminals file:', err);
    }

    let index = terminals.indexOf(terminalId);
    if (index === -1) {
      terminals.push(terminalId);
      try {
        const dirPath = path.dirname(filePath);
        if (!fs.existsSync(dirPath)) {
          fs.mkdirSync(dirPath, { recursive: true });
        }
        fs.writeFileSync(filePath, JSON.stringify(terminals, null, 2), 'utf8');
      } catch (err) {
        console.error('Error writing terminals file:', err);
      }
      index = terminals.length - 1;
    }

    return { terminalName: `Terminal ${index + 1}` };
  }

  async open(userId: string, data: { terminalName: string; openingAmount: number; openingNotes?: string }) {
    // Check if the current user already has an open session
    const existingUserOpen = await this.prisma.cashRegisterSession.findFirst({ where: { userId, status: 'OPEN' } });
    if (existingUserOpen) throw new BadRequestException(`Ya tenés una caja abierta en terminal "${existingUserOpen.terminalName}". Cerrala antes de abrir una nueva.`);

    // Check if the terminal already has an open session (only one open cash register session per PC/device at the same time)
    const existingTerminalOpen = await this.prisma.cashRegisterSession.findFirst({ where: { terminalName: data.terminalName, status: 'OPEN' } });
    if (existingTerminalOpen) throw new BadRequestException(`Ya existe una caja abierta en este dispositivo/terminal ("${data.terminalName}").`);

    const session = await this.prisma.cashRegisterSession.create({
      data: { userId, terminalName: data.terminalName, openingAmount: 0, openingNotes: data.openingNotes },
      include: { user: { select: { fullName: true, username: true } } },
    });

    await this.prisma.auditLog.create({ data: { userId, entityType: 'CASH_REGISTER', entityId: session.id, action: 'OPEN', newValues: JSON.stringify({ terminalName: data.terminalName, openingAmount: 0 }) } });
    this.events.emitCashUpdated({ action: 'OPEN', sessionId: session.id });
    return session;
  }

  async close(sessionId: string, userId: string, data: { closingAmountCounted?: number; closingNotes?: string }) {
    const session = await this.prisma.cashRegisterSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Sesión de caja no encontrada');
    if (session.status !== 'OPEN') throw new BadRequestException('Esta caja ya está cerrada');

    // In shared-terminal environment, any logged-in cashier or administrator can close the session
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('Usuario no válido');
    }

    const sales = await this.prisma.sale.findMany({ where: { sessionId, status: 'COMPLETED' }, include: { payments: true } });
    const cashMovements = await this.prisma.cashMovement.findMany({ where: { sessionId } });

    const paymentBreakdown: Record<string, number> = { CASH: 0, CLOVER: 0, MERCADOPAGO: 0, DEBT: 0 };
    let totalSales = 0;
    for (const sale of sales) {
      totalSales += sale.total;
      for (const payment of sale.payments) {
        if (!paymentBreakdown[payment.method]) {
          paymentBreakdown[payment.method] = 0;
        }
        paymentBreakdown[payment.method] += payment.amount;
      }
    }

    let cashIncome = 0, cashExpense = 0, cashWithdrawal = 0;
    for (const mov of cashMovements) {
      if (mov.type === 'INCOME') cashIncome += mov.amount;
      else if (mov.type === 'EXPENSE') cashExpense += mov.amount;
      else if (mov.type === 'WITHDRAWAL') cashWithdrawal += mov.amount;
    }

    const expectedCash = session.openingAmount + paymentBreakdown.CASH + cashIncome - cashExpense - cashWithdrawal;
    
    const isInstantClose = data.closingAmountCounted === undefined || data.closingAmountCounted === null;
    const difference = isInstantClose ? null : (data.closingAmountCounted - expectedCash);

    const closingSummary = { 
      totalSales: sales.length, 
      totalRevenue: totalSales, 
      paymentBreakdown, 
      cashIncome, 
      cashExpense, 
      cashWithdrawal, 
      openingAmount: session.openingAmount, 
      expectedCash, 
      countedCash: isInstantClose ? null : data.closingAmountCounted, 
      difference 
    };

    const updated = await this.prisma.cashRegisterSession.update({
      where: { id: sessionId },
      data: { 
        status: 'CLOSED', 
        closingAmountExpected: expectedCash, 
        closingAmountCounted: isInstantClose ? null : data.closingAmountCounted, 
        difference, 
        closingNotes: data.closingNotes, 
        closingSummary: JSON.stringify(closingSummary), 
        closedAt: new Date() 
      },
      include: { user: { select: { fullName: true, username: true } } },
    });

    await this.prisma.auditLog.create({ data: { userId, entityType: 'CASH_REGISTER', entityId: sessionId, action: 'CLOSE', newValues: JSON.stringify(closingSummary) } });
    this.events.emitCashUpdated({ action: 'CLOSE', sessionId });
    return { ...updated, closingSummaryParsed: closingSummary };
  }

  async completeArqueo(sessionId: string, userId: string, data: { closingAmountCounted: number; closingNotes?: string; posnetDeclarations?: Record<string, number> }) {
    const session = await this.prisma.cashRegisterSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Sesión de caja no encontrada');
    if (session.status !== 'CLOSED') throw new BadRequestException('La caja debe estar cerrada para realizar el arqueo');
    if (session.closingAmountCounted !== null) throw new BadRequestException('El arqueo para esta caja ya fue completado');

    const expectedCash = session.closingAmountExpected || 0;
    const difference = data.closingAmountCounted - expectedCash;

    let summary: any = {};
    if (session.closingSummary) {
      try {
        summary = JSON.parse(session.closingSummary);
      } catch {}
    }
    summary.countedCash = data.closingAmountCounted;
    summary.difference = difference;
    if (data.posnetDeclarations) {
      summary.posnetDeclarations = data.posnetDeclarations;
    }

    const updated = await this.prisma.cashRegisterSession.update({
      where: { id: sessionId },
      data: {
        closingAmountCounted: data.closingAmountCounted,
        difference,
        closingNotes: data.closingNotes || session.closingNotes,
        closingSummary: JSON.stringify(summary)
      },
      include: { user: { select: { fullName: true, username: true } } }
    });

    await this.prisma.auditLog.create({ data: { userId, entityType: 'CASH_REGISTER', entityId: sessionId, action: 'ARQUEO_COMPLETE', newValues: JSON.stringify(summary) } });
    this.events.emitCashUpdated({ action: 'ARQUEO_COMPLETE', sessionId });
    return { ...updated, closingSummaryParsed: summary };
  }

  async getPendingArqueos(userId: string) {
    return this.prisma.cashRegisterSession.findMany({
      where: {
        userId,
        status: 'CLOSED',
        closingAmountCounted: null
      },
      include: {
        user: { select: { fullName: true, username: true } },
        sales: {
          where: { status: 'COMPLETED' },
          include: { payments: true }
        },
        cashMovements: true
      },
      orderBy: { closedAt: 'desc' }
    });
  }

  async getActiveSessions() {
    const openSessions = await this.prisma.cashRegisterSession.findMany({
      where: { status: 'OPEN' },
      include: {
        user: { select: { id: true, fullName: true, username: true } },
        sales: {
          where: { status: 'COMPLETED' },
          include: { payments: true }
        },
        cashMovements: true
      }
    });

    return openSessions.map(session => {
      const paymentsBreakdown: Record<string, number> = {};
      for (const sale of session.sales) {
        for (const payment of sale.payments) {
          if (!paymentsBreakdown[payment.method]) {
            paymentsBreakdown[payment.method] = 0;
          }
          paymentsBreakdown[payment.method] += payment.amount;
        }
      }
      const cashPaymentsSum = paymentsBreakdown['CASH'] || 0;
      const cloverSales = paymentsBreakdown['CLOVER'] || 0;
      const mpSales = paymentsBreakdown['MERCADOPAGO'] || 0;
      const debtSales = paymentsBreakdown['DEBT'] || 0;
      
      let movementsSum = 0;
      for (const mov of session.cashMovements) {
        if (mov.type === 'INCOME') movementsSum += mov.amount;
        else if (mov.type === 'EXPENSE') movementsSum -= mov.amount;
        else if (mov.type === 'WITHDRAWAL') movementsSum -= mov.amount;
      }
      const expectedAmount = session.openingAmount + cashPaymentsSum + movementsSum;
      return {
        ...session,
        expectedAmount,
        cashSales: cashPaymentsSum,
        cloverSales,
        mpSales,
        debtSales,
        paymentsBreakdown
      };
    });
  }

  async getCurrentSession(userId: string, terminalName?: string) {
    // Return the open session for the current user to support multi-caja environment
    return this.prisma.cashRegisterSession.findFirst({
      where: { userId, status: 'OPEN' },
      include: { 
        user: { select: { fullName: true, username: true } }, 
        sales: { where: { status: 'COMPLETED' }, include: { payments: true }, orderBy: { createdAt: 'desc' } }, 
        cashMovements: {
          include: {
            user: { select: { fullName: true, username: true } }
          }
        } 
      },
    });
  }

  async getHistory(params?: { userId?: string; from?: string; to?: string; limit?: number }) {
    const where: any = { status: 'CLOSED' };
    if (params?.userId) where.userId = params.userId;
    if (params?.from || params?.to) { where.closedAt = {}; if (params.from) where.closedAt.gte = new Date(params.from); if (params.to) where.closedAt.lte = new Date(params.to); }
    return this.prisma.cashRegisterSession.findMany({ 
      where, 
      include: { 
        user: { select: { fullName: true, username: true } },
        cashMovements: true 
      }, 
      orderBy: { closedAt: 'desc' }, 
      take: params?.limit || 50 
    });
  }

  async addCashMovement(sessionId: string, userId: string, data: { type: string; amount: number; description?: string }) {
    const session = await this.prisma.cashRegisterSession.findUnique({ where: { id: sessionId } });
    if (!session || session.status !== 'OPEN') throw new BadRequestException('No hay una caja abierta');
    return this.prisma.cashMovement.create({ data: { sessionId, userId, type: data.type, amount: data.amount, description: data.description } });
  }

  async getMovements(params?: { type?: string; from?: string; to?: string }) {
    const where: any = {};
    if (params?.type) {
      where.type = params.type;
    }
    if (params?.from || params?.to) {
      where.createdAt = {};
      if (params.from) where.createdAt.gte = new Date(params.from);
      if (params.to) where.createdAt.lte = new Date(params.to);
    }
    return this.prisma.cashMovement.findMany({
      where,
      include: {
        user: { select: { fullName: true, username: true } },
        session: { select: { terminalName: true } }
      },
      orderBy: { createdAt: 'desc' }
    });
  }

  async deleteCashMovement(id: string, userId: string) {
    const movement = await this.prisma.cashMovement.findUnique({ where: { id } });
    if (!movement) throw new NotFoundException('Movimiento de caja no encontrado');

    const session = await this.prisma.cashRegisterSession.findUnique({ where: { id: movement.sessionId } });
    if (!session || session.status !== 'OPEN') {
      throw new BadRequestException('Solo se pueden eliminar movimientos de una sesión de caja abierta');
    }

    return this.prisma.cashMovement.delete({ where: { id } });
  }

  async getPendingZReportSummary() {
    const sessions = await this.prisma.cashRegisterSession.findMany({
      where: { status: 'CLOSED', zReportId: null },
      include: {
        user: { select: { fullName: true, username: true } },
        cashMovements: { include: { user: { select: { fullName: true } } } },
        sales: { include: { payments: true } }
      },
      orderBy: { openedAt: 'asc' }
    });

    if (sessions.length === 0) return null;

    let totalExpected = 0;
    let totalDeclared = 0;
    let differenceTotal = 0;
    const paymentBreakdown: Record<string, number> = { CASH: 0, DEBT: 0 };
    const posnetDeclarations: Record<string, number> = {};
    const cashMovements: any[] = [];
    let cashIncome = 0;
    let cashExpense = 0;
    let cashWithdrawal = 0;
    let openingAmount = sessions[0].openingAmount;

    for (const s of sessions) {
      totalExpected += s.closingAmountExpected || 0;
      totalDeclared += s.closingAmountCounted || 0;
      differenceTotal += s.difference || 0;
      cashMovements.push(...s.cashMovements);

      if (s.closingSummary) {
        try {
          const sum = JSON.parse(s.closingSummary);
          cashIncome += sum.cashIncome || 0;
          cashExpense += sum.cashExpense || 0;
          cashWithdrawal += sum.cashWithdrawal || 0;

          if (sum.paymentBreakdown) {
            for (const [k, v] of Object.entries(sum.paymentBreakdown)) {
              if (!paymentBreakdown[k]) paymentBreakdown[k] = 0;
              paymentBreakdown[k] += Number(v) || 0;
            }
          }
          if (sum.posnetDeclarations) {
            for (const [k, v] of Object.entries(sum.posnetDeclarations)) {
              if (!posnetDeclarations[k]) posnetDeclarations[k] = 0;
              posnetDeclarations[k] += Number(v) || 0;
            }
          }
        } catch {}
      }
    }

    return {
      sessionCount: sessions.length,
      sessions,
      totalExpected,
      totalDeclared,
      differenceTotal,
      cashIncome,
      cashExpense,
      cashWithdrawal,
      paymentBreakdown,
      posnetDeclarations,
      cashMovements,
      openingAmount
    };
  }

  async generateZReport(userId: string) {
    const summaryData = await this.getPendingZReportSummary();
    if (!summaryData) {
      throw new BadRequestException('No hay turnos pendientes de liquidar (Reportes X huérfanos).');
    }

    // Double check that all pending sessions are actually CLOSED and COUNTED
    const hasUncounted = summaryData.sessions.some(s => s.closingAmountCounted === null);
    if (hasUncounted) {
      throw new BadRequestException('Hay turnos cerrados pendientes de arqueo. Todos los turnos deben estar arqueados antes de generar el Reporte Z.');
    }

    const { sessions, sessionCount, totalExpected, totalDeclared, differenceTotal, ...summaryJson } = summaryData;

    const sessionsSummary = sessions.map(s => ({
      id: s.id,
      terminalName: s.terminalName,
      openedAt: s.openedAt,
      closedAt: s.closedAt,
      closingAmountCounted: s.closingAmountCounted,
      difference: s.difference,
      user: { fullName: s.user?.fullName }
    }));

    const zReport = await this.prisma.dailyZReport.create({
      data: {
        generatedById: userId,
        totalExpected,
        totalDeclared,
        differenceTotal,
        summary: JSON.stringify({
          ...summaryJson,
          sessionCount,
          sessions: sessionsSummary
        }),
        sessions: {
          connect: sessions.map(s => ({ id: s.id }))
        }
      }
    });

    return zReport;
  }

  async getZReportsHistory() {
    return this.prisma.dailyZReport.findMany({
      include: {
        generatedBy: { select: { fullName: true, username: true } },
        sessions: {
          include: {
            user: { select: { fullName: true, username: true } }
          }
        }
      },
      orderBy: { generatedAt: 'desc' },
      take: 50
    });
  }

  async resetAllCajas() {
    console.log('[CashRegisterService] Deleting all cash register sessions, cash movements, client account movements, payments, sales items, sales...');
    
    await this.prisma.$transaction(async (tx) => {
      // 1. Delete all cash movements
      await tx.cashMovement.deleteMany({});
      
      // 2. Delete all client account movements
      await tx.accountMovement.deleteMany({});
      
      // 3. Reset all client balances to 0
      await tx.client.updateMany({
        data: { balance: 0 }
      });
      
      // 4. Delete all payments
      await tx.payment.deleteMany({});
      
      // 5. Delete all sale items
      await tx.saleItem.deleteMany({});
      
      // 6. Delete all sales
      await tx.sale.deleteMany({});
      
      // 7. Delete all cash register sessions
      await tx.cashRegisterSession.deleteMany({});
    });

    console.log('[CashRegisterService] Reset completed successfully!');
    this.events.emitCashUpdated({ action: 'RESET' });
    return { success: true };
  }
}
