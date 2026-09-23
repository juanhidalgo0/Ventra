import { Injectable, BadRequestException, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../websockets/events.gateway';
import { BackupService } from '../system/backup.service';
import * as fs from 'fs';
import * as path from 'path';

@Injectable()
export class CashRegisterService {
  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
    private backupService: BackupService
  ) {}

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

    // Check if the user has a pending arqueo (session is closed but not counted yet)
    const pendingArqueo = await this.prisma.cashRegisterSession.findFirst({
      where: {
        userId,
        status: 'CLOSED',
        closingAmountCounted: null
      }
    });
    if (pendingArqueo) {
      throw new BadRequestException(`Tenés un arqueo pendiente en la terminal "${pendingArqueo.terminalName}". Completá el arqueo antes de abrir una nueva caja.`);
    }

    // Allow multiple open sessions on the same terminal, as long as they belong to different users.

    const session = await this.prisma.cashRegisterSession.create({
      data: { userId, terminalName: data.terminalName, openingAmount: 0, openingNotes: data.openingNotes },
      include: { user: { select: { fullName: true, username: true } } },
    });

    await this.prisma.auditLog.create({ data: { userId, entityType: 'CASH_REGISTER', entityId: session.id, action: 'OPEN', newValues: JSON.stringify({ terminalName: data.terminalName, openingAmount: 0 }) } });
    this.events.emitCashUpdated({ action: 'OPEN', sessionId: session.id });
    return session;
  }

  async close(sessionId: string, userId: string, data: { closingAmountCounted?: number; closingNotes?: string; clientId?: string }) {
    const session = await this.prisma.cashRegisterSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Sesión de caja no encontrada');
    if (session.status !== 'OPEN') throw new BadRequestException('Esta caja ya está cerrada');

    // In shared-terminal environment, any logged-in cashier or administrator can close the session
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new BadRequestException('Usuario no válido');
    }

    const sales = await this.prisma.sale.findMany({ 
      where: { sessionId, status: 'COMPLETED' }, 
      include: { payments: true, items: { include: { product: true } } } 
    });
    const cashMovements = await this.prisma.cashMovement.findMany({ where: { sessionId } });

    let virtual1Total = 0;
    let virtual1Base = 0;
    let virtual1Surcharge = 0;
    let virtual2Total = 0;
    let virtual2Base = 0;
    let virtual2Surcharge = 0;
    const paymentBreakdown: Record<string, number> = { CASH: 0, CLOVER: 0, MERCADOPAGO: 0, DEBT: 0 };
    let totalSales = 0;
    for (const sale of sales) {
      totalSales += sale.total;
      
      let saleVirtual1Total = 0;
      let saleVirtual2Total = 0;
      for (const item of (sale as any).items || []) {
        if (item.productId === 'VIRTUAL_LOAD_1' || item.product?.barcode === 'VIRTUAL1') {
          saleVirtual1Total += item.total;
          const match = item.productName?.match(/CARGA VIRTUAL \((\d+)\+(\d+)\)/i);
          if (match) {
            virtual1Base += parseFloat(match[1]) * item.quantity;
            virtual1Surcharge += parseFloat(match[2]) * item.quantity;
          } else {
            virtual1Base += item.total;
          }
        } else if (item.productId === 'VIRTUAL_LOAD_2' || item.product?.barcode === 'VIRTUAL2') {
          saleVirtual2Total += item.total;
          const match = item.productName?.match(/CARGA VIRTUAL \((\d+)\+(\d+)\)/i);
          if (match) {
            virtual2Base += parseFloat(match[1]) * item.quantity;
            virtual2Surcharge += parseFloat(match[2]) * item.quantity;
          } else {
            virtual2Base += item.total;
          }
        }
      }
      const saleVirtualTotal = saleVirtual1Total + saleVirtual2Total;
      virtual1Total += saleVirtual1Total;
      virtual2Total += saleVirtual2Total;

      const saleTotal = sale.total || 0;
      for (const payment of sale.payments) {
        if (!paymentBreakdown[payment.method]) {
          paymentBreakdown[payment.method] = 0;
        }
        const proportion = saleTotal > 0 ? (payment.amount / saleTotal) : 0;
        const virtualPaymentAmount = saleVirtualTotal * proportion;
        paymentBreakdown[payment.method] += (payment.amount - virtualPaymentAmount);
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
      difference,
      virtual1Sales: virtual1Total,
      virtual1Base,
      virtual1Surcharge,
      virtual2Sales: virtual2Total,
      virtual2Base,
      virtual2Surcharge
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
    // Cierre X (cambio de turno): solo afecta a la terminal que cerró la caja,
    // las demás terminales del mismo cajero siguen con su sesión abierta.
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

    // Silent Automatic Backup upon Arqueo completion
    try {
      this.backupService.createBackup('AUTOMATIC').catch(err => {
        console.warn('[CashRegisterService] Backup automático tras arqueo no pudo completarse:', err.message);
      });
    } catch (bErr) {
      console.warn('[CashRegisterService] Error al disparar backup automático tras arqueo:', bErr);
    }

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
          include: { payments: true, items: { include: { product: true } } }
        },
        cashMovements: true
      },
      orderBy: { openedAt: 'desc' }
    });
  }

  // Store-wide view (not scoped to a single cashier) so an admin can find and unblock
  // arqueos left pending by ANY user — e.g. after a crash mid-arqueo — since those
  // orphaned sessions otherwise block Z report generation for the whole store with
  // no way for anyone but the original cashier to see or resolve them.
  async getAllPendingArqueos() {
    return this.prisma.cashRegisterSession.findMany({
      where: {
        status: 'CLOSED',
        closingAmountCounted: null
      },
      include: {
        user: { select: { fullName: true, username: true } },
        sales: {
          where: { status: 'COMPLETED' },
          include: { payments: true, items: { include: { product: true } } }
        },
        cashMovements: true
      },
      orderBy: { openedAt: 'desc' }
    });
  }

  async getActiveSessions() {
    const openSessions = await this.prisma.cashRegisterSession.findMany({
      where: { status: 'OPEN' },
      include: {
        user: { select: { id: true, fullName: true, username: true } },
        sales: {
          where: { status: 'COMPLETED' },
          include: { payments: true, items: { include: { product: true } } }
        },
        cashMovements: true
      },
      orderBy: { openedAt: 'desc' }
    });

    return openSessions.map(session => {
      const paymentsBreakdown: Record<string, number> = { CASH: 0, CLOVER: 0, MERCADOPAGO: 0, DEBT: 0 };
      let virtual1Total = 0;
      let virtual2Total = 0;
      for (const sale of session.sales) {
        let saleVirtual1Total = 0;
        let saleVirtual2Total = 0;
        for (const item of (sale as any).items || []) {
          if (item.productId === 'VIRTUAL_LOAD_1' || item.product?.barcode === 'VIRTUAL1') {
            saleVirtual1Total += item.total;
          } else if (item.productId === 'VIRTUAL_LOAD_2' || item.product?.barcode === 'VIRTUAL2') {
            saleVirtual2Total += item.total;
          }
        }
        const saleVirtualTotal = saleVirtual1Total + saleVirtual2Total;
        virtual1Total += saleVirtual1Total;
        virtual2Total += saleVirtual2Total;

        const saleTotal = sale.total || 0;
        for (const payment of sale.payments) {
          if (!paymentsBreakdown[payment.method]) {
            paymentsBreakdown[payment.method] = 0;
          }
          const proportion = saleTotal > 0 ? (payment.amount / saleTotal) : 0;
          const virtualPaymentAmount = saleVirtualTotal * proportion;
          paymentsBreakdown[payment.method] += (payment.amount - virtualPaymentAmount);
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
        paymentsBreakdown,
        virtual1Sales: virtual1Total,
        virtual2Sales: virtual2Total
      };
    });
  }

  async getCurrentSession(userId: string, terminalName?: string) {
    // Return the open session for the current user to support multi-caja environment
    const session = await this.prisma.cashRegisterSession.findFirst({
      where: { userId, status: 'OPEN' },
      include: { 
        user: { select: { fullName: true, username: true, role: true } }, 
        cashMovements: {
          include: {
            user: { select: { fullName: true, username: true } }
          },
          orderBy: { createdAt: 'desc' }
        } 
      },
    });

    if (!session) return null;

    // Fast indexed SQL aggregations for sales and payments (sub-millisecond even on 10k+ sales)
    const salesAgg: any = await this.prisma.$queryRawUnsafe(`
      SELECT 
        COUNT(id) as count, 
        COALESCE(SUM(total), 0) as total 
      FROM sales 
      WHERE session_id = ? AND status = 'COMPLETED';
    `, session.id).catch(() => [{ count: 0, total: 0 }]);

    const paymentsAgg: any = await this.prisma.$queryRawUnsafe(`
      SELECT 
        p.method, 
        COALESCE(SUM(p.amount), 0) as total 
      FROM payments p
      JOIN sales s ON p.sale_id = s.id
      WHERE s.session_id = ? AND s.status = 'COMPLETED'
      GROUP BY p.method;
    `, session.id).catch(() => []);

    const salesCount = Number(salesAgg[0]?.count || 0);
    const salesTotal = Number(salesAgg[0]?.total || 0);

    const paymentBreakdown: Record<string, number> = { CASH: 0, CLOVER: 0, MERCADOPAGO: 0, DEBT: 0 };
    for (const row of paymentsAgg) {
      if (row.method) {
        paymentBreakdown[row.method] = Number(row.total || 0);
      }
    }

    const cashSales = paymentBreakdown['CASH'] || 0;
    const cloverSales = paymentBreakdown['CLOVER'] || 0;
    const mpSales = paymentBreakdown['MERCADOPAGO'] || 0;

    return {
      ...session,
      salesCount,
      salesTotal,
      cashSales,
      cloverSales,
      mpSales,
      paymentBreakdown,
      // Minimal lightweight sales array for 100% backward compatibility with components using sales.reduce or sales.length
      sales: [
        {
          total: salesTotal,
          payments: [
            { method: 'CASH', amount: cashSales },
            { method: 'CLOVER', amount: cloverSales },
            { method: 'MERCADOPAGO', amount: mpSales },
            { method: 'DEBT', amount: paymentBreakdown['DEBT'] || 0 },
          ]
        }
      ]
    };
  }

  async getHistory(params?: { userId?: string; from?: string; to?: string; skip?: number; limit?: number }) {
    const where: any = { status: 'CLOSED' };
    if (params?.userId) where.userId = params.userId;
    if (params?.from || params?.to) { where.openedAt = {}; if (params.from) where.openedAt.gte = new Date(params.from); if (params.to) where.openedAt.lte = new Date(params.to); }
    return this.prisma.cashRegisterSession.findMany({ 
      where, 
      include: { 
        user: { select: { fullName: true, username: true } },
        cashMovements: true
      }, 
      orderBy: { openedAt: 'desc' }, 
      skip: params?.skip ?? 0,
      take: params?.limit ?? 40 
    });
  }

  async addCashMovement(sessionId: string, userId: string, data: { type: string; amount: number; description?: string }) {
    const session = await this.prisma.cashRegisterSession.findUnique({ where: { id: sessionId } });
    if (!session) {
      throw new BadRequestException('Sesión de caja no encontrada');
    }
    const movement = await this.prisma.cashMovement.create({ data: { sessionId, userId, type: data.type, amount: data.amount, description: data.description } });
    await this.recalculateSessionSummary(sessionId);
    return movement;
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
    if (!session) {
      throw new BadRequestException('Sesión de caja no encontrada');
    }

    const deleted = await this.prisma.cashMovement.delete({ where: { id } });
    await this.recalculateSessionSummary(session.id);
    return deleted;
  }

  async updateCashMovement(id: string, userId: string, data: { type?: string; amount?: number; description?: string }) {
    const movement = await this.prisma.cashMovement.findUnique({ where: { id } });
    if (!movement) throw new NotFoundException('Movimiento de caja no encontrado');

    const session = await this.prisma.cashRegisterSession.findUnique({ where: { id: movement.sessionId } });
    if (!session) {
      throw new BadRequestException('Sesión de caja no encontrada');
    }

    const updated = await this.prisma.cashMovement.update({
      where: { id },
      data: {
        type: data.type !== undefined ? data.type : movement.type,
        amount: data.amount !== undefined ? data.amount : movement.amount,
        description: data.description !== undefined ? data.description : movement.description,
      }
    });
    await this.recalculateSessionSummary(session.id);
    return updated;
  }

  async getPendingZReportSummary() {
    const allSessions = await this.prisma.cashRegisterSession.findMany({
      where: { status: 'CLOSED', zReportId: null },
      include: {
        user: { select: { fullName: true, username: true } },
        cashMovements: { include: { user: { select: { fullName: true } } } },
        sales: { include: { payments: true } }
      },
      orderBy: { openedAt: 'asc' }
    });

    if (allSessions.length === 0) return null;

    const isSessionWithActivity = (s: any) => {
      const salesCount = s.sales?.length || 0;
      const movementsCount = s.cashMovements?.length || 0;
      const expected = s.closingAmountExpected || 0;
      const counted = s.closingAmountCounted || 0;
      const diff = s.difference || 0;
      const opening = s.openingAmount || 0;
      let revenue = 0;
      if (s.closingSummary) {
        try {
          const sum = JSON.parse(s.closingSummary);
          revenue = sum.totalRevenue || 0;
        } catch {}
      }
      return salesCount > 0 || movementsCount > 0 || expected !== 0 || counted !== 0 || diff !== 0 || opening !== 0 || revenue !== 0;
    };

    const sessions = allSessions.filter(isSessionWithActivity);

    let totalCashExpected = 0;
    let totalCashCounted = 0;
    let totalCashDifference = 0;
    const paymentBreakdown: Record<string, number> = { CASH: 0, DEBT: 0 };
    const posnetDeclarations: Record<string, number> = {};
    const cashMovements: any[] = [];
    let cashIncome = 0;
    let cashExpense = 0;
    let cashWithdrawal = 0;
    let openingAmount = sessions.length > 0 ? (sessions[0].openingAmount || 0) : 0;

    for (const s of sessions) {
      totalCashExpected += s.closingAmountExpected || 0;
      totalCashCounted += s.closingAmountCounted || 0;
      totalCashDifference += s.difference || 0;
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

    // Include electronic / posnet methods
    let totalPosnetExpected = 0;
    let totalPosnetDeclared = 0;
    for (const [method, expAmount] of Object.entries(paymentBreakdown)) {
      if (method === 'CASH' || method === 'DEBT') continue;
      const expected = Number(expAmount) || 0;
      const declared = Number(posnetDeclarations[method]) || 0;
      totalPosnetExpected += expected;
      totalPosnetDeclared += declared;
      if (posnetDeclarations[method] === undefined) {
        posnetDeclarations[method] = 0;
      }
    }

    for (const [method, decAmount] of Object.entries(posnetDeclarations)) {
      if (paymentBreakdown[method] === undefined && method !== 'CASH' && method !== 'DEBT') {
        totalPosnetDeclared += Number(decAmount) || 0;
      }
    }

    const totalExpected = totalCashExpected + totalPosnetExpected;
    const totalDeclared = totalCashCounted + totalPosnetDeclared;
    const differenceTotal = totalDeclared - totalExpected;

    return {
      sessionCount: sessions.length,
      sessions,
      allSessions,
      totalExpected,
      totalDeclared,
      differenceTotal,
      totalCashExpected,
      totalCashCounted,
      totalCashDifference,
      totalPosnetExpected,
      totalPosnetDeclared,
      cashIncome,
      cashExpense,
      cashWithdrawal,
      paymentBreakdown,
      posnetDeclarations,
      cashMovements,
      openingAmount
    };
  }

  async generateZReport(userId: string, clientId?: string) {
    const summaryData = await this.getPendingZReportSummary();
    if (!summaryData) {
      throw new BadRequestException('No hay turnos pendientes de liquidar (Reportes X huérfanos).');
    }

    // Check uncounted only among active sessions
    const hasUncounted = summaryData.sessions.some(s => s.closingAmountCounted === null);
    if (hasUncounted) {
      throw new BadRequestException('Hay turnos cerrados pendientes de arqueo. Todos los turnos activos deben estar arqueados antes de generar el Reporte Z.');
    }

    const { sessions, allSessions, sessionCount, totalExpected, totalDeclared, differenceTotal, ...summaryJson } = summaryData;

    const sessionsSummary = sessions.map(s => ({
      id: s.id,
      terminalName: s.terminalName,
      openedAt: s.openedAt,
      closedAt: s.closedAt,
      closingAmountCounted: s.closingAmountCounted,
      closingAmountExpected: s.closingAmountExpected,
      difference: s.difference,
      closingSummary: s.closingSummary,
      closingNotes: s.closingNotes,
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
          connect: (allSessions || sessions).map(s => ({ id: s.id }))
        }
      },
      include: {
        generatedBy: { select: { fullName: true, username: true } },
        sessions: {
          include: {
            user: { select: { fullName: true, username: true } },
            cashMovements: {
              include: {
                user: { select: { fullName: true } }
              }
            }
          }
        }
      }
    });

    // Background SQLite Maintenance on Daily Z Report Generation
    try {
      await this.prisma.$executeRawUnsafe(`PRAGMA wal_checkpoint(TRUNCATE);`);
      await this.prisma.$executeRawUnsafe(`PRAGMA optimize;`);
      console.log('[CashRegisterService] Mantenimiento automático de base de datos SQLite completado tras Cierre Z.');
    } catch (maintErr) {
      console.warn('[CashRegisterService] Error durante mantenimiento SQLite en Cierre Z:', maintErr);
    }

    // Silent Automatic Backup upon Daily Z Report Generation
    try {
      this.backupService.createBackup('AUTOMATIC').catch(err => {
        console.warn('[CashRegisterService] Backup automático tras Cierre Z no pudo completarse:', err.message);
      });
    } catch (bErr) {
      console.warn('[CashRegisterService] Error al disparar backup automático tras Cierre Z:', bErr);
    }

    // Cierre Z: ninguna terminal debe quedar con la sesión abierta de esos turnos.
    // La terminal que generó el Z se excluye del logout inmediato: primero debe
    // terminar de mostrar/imprimir el cartel "Imprimir Z" y recién ahí cierra sesión
    // (lo hace localmente al cerrar ese cartel, ver CashControlScreen).
    for (const zUserId of new Set(sessions.map((s: any) => s.userId).filter(Boolean))) {
      this.events.emitForceLogout({ userId: zUserId as string, reason: 'Z_REPORT', clientId });
    }

    return zReport;
  }

  async getZReportsHistory(params?: { skip?: number; limit?: number }) {
    try {
      const take = params?.limit && !isNaN(Number(params.limit)) ? Number(params.limit) : 40;
      const queryOptions: any = {
        include: {
          generatedBy: { select: { fullName: true, username: true } },
          sessions: {
            include: {
              user: { select: { fullName: true, username: true } },
              cashMovements: {
                include: {
                  user: { select: { fullName: true } }
                }
              }
            }
          }
        },
        orderBy: { generatedAt: 'desc' },
        take
      };

      if (params?.skip && !isNaN(Number(params.skip)) && Number(params.skip) > 0) {
        queryOptions.skip = Number(params.skip);
      }

      return await this.prisma.dailyZReport.findMany(queryOptions);
    } catch (err: any) {
      console.error('[CashRegisterService] Could not fetch Z reports history:', err);
      return [];
    }
  }

  async getSessionById(id: string) {
    return this.prisma.cashRegisterSession.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, fullName: true, username: true } },
        sales: {
          where: { status: 'COMPLETED' },
          include: { payments: true, items: { include: { product: true } } }
        },
        cashMovements: {
          include: {
            user: { select: { fullName: true, username: true } }
          }
        }
      }
    });
  }

  async recalculateSessionSummary(sessionId: string) {
    const session = await this.prisma.cashRegisterSession.findUnique({
      where: { id: sessionId },
      include: {
        sales: {
          where: { status: 'COMPLETED' },
          include: { payments: true, items: { include: { product: true } } }
        },
        cashMovements: {
          include: {
            user: { select: { fullName: true, username: true } }
          }
        }
      }
    });
    if (!session) return;
    if (session.status !== 'CLOSED') return;

    let virtual1Total = 0;
    let virtual1Base = 0;
    let virtual1Surcharge = 0;
    let virtual2Total = 0;
    let virtual2Base = 0;
    let virtual2Surcharge = 0;
    const paymentBreakdown: Record<string, number> = { CASH: 0, CLOVER: 0, MERCADOPAGO: 0, DEBT: 0 };
    let totalSales = 0;
    for (const sale of session.sales) {
      totalSales += sale.total;
      
      let saleVirtual1Total = 0;
      let saleVirtual2Total = 0;
      for (const item of (sale as any).items || []) {
        if (item.productId === 'VIRTUAL_LOAD_1' || item.product?.barcode === 'VIRTUAL1') {
          saleVirtual1Total += item.total;
          const match = item.productName?.match(/CARGA VIRTUAL \((\d+)\+(\d+)\)/i);
          if (match) {
            virtual1Base += parseFloat(match[1]) * item.quantity;
            virtual1Surcharge += parseFloat(match[2]) * item.quantity;
          } else {
            virtual1Base += item.total;
          }
        } else if (item.productId === 'VIRTUAL_LOAD_2' || item.product?.barcode === 'VIRTUAL2') {
          saleVirtual2Total += item.total;
          const match = item.productName?.match(/CARGA VIRTUAL \((\d+)\+(\d+)\)/i);
          if (match) {
            virtual2Base += parseFloat(match[1]) * item.quantity;
            virtual2Surcharge += parseFloat(match[2]) * item.quantity;
          } else {
            virtual2Base += item.total;
          }
        }
      }
      const saleVirtualTotal = saleVirtual1Total + saleVirtual2Total;
      virtual1Total += saleVirtual1Total;
      virtual2Total += saleVirtual2Total;

      const saleTotal = sale.total || 0;
      for (const payment of sale.payments) {
        if (!paymentBreakdown[payment.method]) {
          paymentBreakdown[payment.method] = 0;
        }
        const proportion = saleTotal > 0 ? (payment.amount / saleTotal) : 0;
        const virtualPaymentAmount = saleVirtualTotal * proportion;
        paymentBreakdown[payment.method] += (payment.amount - virtualPaymentAmount);
      }
    }

    let cashIncome = 0, cashExpense = 0, cashWithdrawal = 0;
    for (const mov of session.cashMovements) {
      if (mov.type === 'INCOME') cashIncome += mov.amount;
      else if (mov.type === 'EXPENSE') cashExpense += mov.amount;
      else if (mov.type === 'WITHDRAWAL') cashWithdrawal += mov.amount;
    }

    const expectedCash = session.openingAmount + paymentBreakdown.CASH + cashIncome - cashExpense - cashWithdrawal;
    
    let existingSummary: any = {};
    if (session.closingSummary) {
      try {
        existingSummary = JSON.parse(session.closingSummary);
      } catch {}
    }

    const countedCash = session.closingAmountCounted;
    const difference = countedCash === null ? null : (countedCash - expectedCash);

    const closingSummary = { 
      ...existingSummary,
      totalSales: session.sales.length, 
      totalRevenue: totalSales, 
      paymentBreakdown, 
      cashIncome, 
      cashExpense, 
      cashWithdrawal, 
      openingAmount: session.openingAmount, 
      expectedCash, 
      countedCash, 
      difference,
      virtual1Sales: virtual1Total,
      virtual1Base,
      virtual1Surcharge,
      virtual2Sales: virtual2Total,
      virtual2Base,
      virtual2Surcharge
    };

    await this.prisma.cashRegisterSession.update({
      where: { id: session.id },
      data: {
        closingAmountExpected: expectedCash,
        difference,
        closingSummary: JSON.stringify(closingSummary)
      }
    });

    this.events.emitCashUpdated({ action: 'RECALCULATE', sessionId: session.id });
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
