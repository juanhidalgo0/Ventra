import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { PrismaService } from '../../database/prisma.service';
import { SubscriptionService } from '../subscription/subscription.service';
import { MpPaymentLite, reconcile, SaleLite } from './mp-reconcile';

const FUNCTIONS_URL = process.env.VENTRA_FUNCTIONS_URL || 'https://us-central1-ventra-9cba5.cloudfunctions.net';

export interface MpConnection {
  connected: boolean;
  mpUserId?: string | null;
  nickname?: string | null;
  email?: string | null;
  name?: string | null;
  liveMode?: boolean;
  connectedAt?: string | null;
  needsReconnect?: boolean;
  countTransfers?: boolean;
}

export interface PointTerminal {
  id: string;
  operatingMode: string | null;
  storeId: string | null;
  posId: string | number | null;
  externalPosId: string | null;
}

export interface PointOrder {
  id: string;
  status: string | null;
  statusDetail: string | null;
  payment: { id: string; status: string | null; amount: number; paidAmount: number | null; method: string | null; type: string | null; installments: number | null; last4: string | null } | null;
  /** Texto que se guarda en el pago de la venta para encontrarlo en Mercado Pago */
  reference: string;
}

type Action = 'status' | 'start' | 'disconnect' | 'settings' | 'terminals' | 'setPdv' | 'charge' | 'order' | 'cancel' | 'payments' | 'payment';

/** Margen alrededor del turno al pedir los pagos (una venta de la apertura o del cierre) */
const WINDOW_MARGIN_MS = 5 * 60 * 1000;
const MP_METHOD = 'MERCADOPAGO';

/**
 * Cuenta de Mercado Pago del comercio. La conexión y los tokens viven en la nube
 * (ventraMpConnect / ventraMpOAuth): esta PC pide el link del QR, consulta el estado y
 * manda los cobros a la maquinita Point con su vinculación, así los tokens del comercio
 * nunca quedan en una PC.
 */
@Injectable()
export class MercadoPagoService {
  constructor(
    private readonly subscription: SubscriptionService,
    private readonly prisma: PrismaService,
  ) {}

  private async call<T>(action: Action, body: Record<string, any> = {}): Promise<T> {
    const creds = this.subscription.getDeviceCredentials();
    if (!creds) {
      throw new BadRequestException('Primero vinculá esta PC a tu cuenta de Ventra (Configuración → Suscripción y nube).');
    }
    try {
      const { data } = await axios.post(`${FUNCTIONS_URL}/ventraMpConnect`, { ...body, ...creds, action }, { timeout: 20000 });
      return data as T;
    } catch (err: any) {
      const res = err?.response;
      const msg = res?.data?.error;
      if (res?.status === 409) throw new ConflictException({ message: msg, code: res.data?.code });
      if (msg && res.status < 500) throw new BadRequestException(msg);
      throw new ServiceUnavailableException(msg || 'No hay conexión con Mercado Pago. Revisá internet y probá de nuevo.');
    }
  }

  status() {
    return this.call<MpConnection>('status');
  }

  /** Link corto para el QR: lleva a la autorización oficial de Mercado Pago. */
  start() {
    return this.call<{ url: string; expiresInSeconds: number }>('start');
  }

  disconnect() {
    return this.call<MpConnection>('disconnect');
  }

  /** countTransfers: las transferencias recibidas cuentan como cobros del negocio. */
  settings(patch: { countTransfers?: boolean; mpMethods?: string[] }) {
    return this.call<MpConnection>('settings', patch);
  }

  /** Pagos aprobados recibidos entre dos momentos (la nube ya saca las transferencias si no cuentan). */
  payments(begin: string, end: string) {
    return this.call<{ payments: (MpPaymentLite & { refunded: number })[] }>('payments', { begin, end });
  }

  terminals() {
    return this.call<{ terminals: PointTerminal[] }>('terminals');
  }

  /** Pasa la maquinita a modo punto de venta (después hay que reiniciarla). */
  setPdv(terminalId: string) {
    return this.call<{ terminal: PointTerminal }>('setPdv', { terminalId });
  }

  charge(terminalId: string, amount: number, externalReference: string, description?: string) {
    return this.call<PointOrder>('charge', { terminalId, amount, externalReference, description });
  }

  order(orderId: string) {
    return this.call<PointOrder>('order', { orderId });
  }

  cancel(orderId: string) {
    return this.call<PointOrder>('cancel', { orderId });
  }

  // ─── Cierre de caja: cruce con lo que Mercado Pago realmente cobró ───

  /**
   * Pagos reales del turno contra las ventas cargadas como Mercado Pago.
   * `mpMethods`: ids de medio de pago que son Mercado Pago en esta PC (además de MERCADOPAGO).
   */
  async reconcile(sessionId: string, mpMethods: string[] = []) {
    const session = await this.prisma.cashRegisterSession.findUnique({ where: { id: sessionId } });
    if (!session) throw new NotFoundException('Caja no encontrada');
    const begin = new Date(session.openedAt.getTime() - WINDOW_MARGIN_MS);
    const end = new Date((session.closedAt ? session.closedAt.getTime() : Date.now()) + WINDOW_MARGIN_MS);
    const mpSet = new Set([MP_METHOD, ...mpMethods.filter(Boolean)]);

    const { payments } = await this.call<{ payments: (MpPaymentLite & { refunded: number })[] }>('payments', {
      begin: begin.toISOString(),
      end: end.toISOString(),
    });
    // Un pago devuelto del todo no cuenta; uno devuelto en parte cuenta por lo que quedó
    const real = payments
      .map((p) => ({ ...p, amount: Math.round((p.amount - (p.refunded || 0)) * 100) / 100 }))
      .filter((p) => p.amount > 0);

    const select = { id: true, saleNumber: true, createdAt: true, payments: { select: { id: true, method: true, amount: true, reference: true } } };
    const toLite = (s: any): SaleLite => ({ saleId: s.id, saleNumber: s.saleNumber, at: s.createdAt, payments: s.payments });
    const [own, others] = await Promise.all([
      this.prisma.sale.findMany({ where: { sessionId, status: 'COMPLETED' }, select }),
      this.prisma.sale.findMany({
        where: { sessionId: { not: sessionId }, status: 'COMPLETED', createdAt: { gte: begin, lte: end }, payments: { some: { method: { in: [...mpSet] } } } },
        select,
      }),
    ]);
    return {
      window: { begin: begin.toISOString(), end: end.toISOString() },
      ...reconcile(real, own.map(toLite), others.map(toLite), (m) => mpSet.has(m)),
    };
  }

  /**
   * Corrige el medio de pago de una venta de una caja ABIERTA después del cruce:
   *  - toMp: la venta se cobró por Mercado Pago (se verifica el pago en Mercado Pago:
   *    aprobado, mismo monto y no asignado a otra venta);
   *  - fromMp: se cargó como Mercado Pago pero se cobró con otro medio.
   */
  async fix(userId: string, body: { paymentRowId?: string; action?: string; mpPaymentId?: string; method?: string; mpMethods?: string[] }) {
    const row = await this.prisma.payment.findUnique({
      where: { id: String(body.paymentRowId || '') },
      include: { sale: { include: { session: true, payments: true } } },
    });
    if (!row) throw new NotFoundException('Pago de venta no encontrado');
    if (row.sale.status !== 'COMPLETED') throw new BadRequestException('La venta está anulada');
    if (row.sale.session.status !== 'OPEN') throw new BadRequestException('Solo se corrigen ventas de una caja abierta');
    const mpSet = new Set([MP_METHOD, ...(Array.isArray(body.mpMethods) ? body.mpMethods : [])]);

    let method: string;
    let reference: string;
    if (body.action === 'toMp') {
      if (mpSet.has(row.method)) throw new BadRequestException('Esa venta ya es Mercado Pago');
      const paymentId = String(body.mpPaymentId || '').replace(/[^0-9]/g, '');
      if (!paymentId) throw new BadRequestException('Falta el pago de Mercado Pago');
      const mp = await this.call<MpPaymentLite & { status: string; refunded: number }>('payment', { paymentId });
      if (mp.status !== 'approved') throw new BadRequestException('Ese pago no está aprobado en Mercado Pago');
      if (Math.abs(mp.amount - (mp.refunded || 0) - row.amount) >= 0.01) throw new BadRequestException('El pago de Mercado Pago no es del mismo monto que la venta');
      const taken = await this.prisma.payment.findFirst({ where: { reference: { contains: `pago N° ${paymentId} ` }, id: { not: row.id } } });
      if (taken) throw new BadRequestException('Ese pago de Mercado Pago ya está asignado a otra venta');
      method = MP_METHOD;
      reference = `MP pago N° ${paymentId} (corregido en el cierre, antes ${row.method})`;
    } else if (body.action === 'fromMp') {
      if (!mpSet.has(row.method)) throw new BadRequestException('Esa venta no es Mercado Pago');
      method = String(body.method || '');
      if (!method || mpSet.has(method) || method === 'DEBT') throw new BadRequestException('Elegí el medio con el que se cobró');
      reference = 'Corregido en el cierre: estaba como Mercado Pago sin pago recibido';
    } else {
      throw new BadRequestException('Acción inválida');
    }

    const methods = row.sale.payments.map((p) => (p.id === row.id ? method : p.method));
    const summary = new Set(methods).size === 1 ? methods[0] : 'MIXED';
    return this.prisma.$transaction(async (tx) => {
      await tx.payment.update({ where: { id: row.id }, data: { method, reference } });
      await tx.sale.update({ where: { id: row.saleId }, data: { paymentMethodSummary: summary } });
      await tx.auditLog.create({
        data: {
          userId,
          entityType: 'SALE',
          entityId: row.saleId,
          action: 'PAYMENT_METHOD_FIX',
          oldValues: JSON.stringify({ paymentId: row.id, method: row.method, reference: row.reference }),
          newValues: JSON.stringify({ paymentId: row.id, method, reference }),
        },
      });
      return { ok: true, saleId: row.saleId, method, summary };
    });
  }
}
