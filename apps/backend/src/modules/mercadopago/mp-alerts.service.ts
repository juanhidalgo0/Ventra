import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { PrismaService } from '../../database/prisma.service';
import { NotifyService } from '../subscription/notify.service';
import { MercadoPagoService } from './mercadopago.service';

/** Cada cuánto se miran los pagos nuevos */
const CHECK_MS = 3 * 60 * 1000;
/** Tiempo que tiene el cajero para registrar la venta después del pago */
const GRACE_MS = 5 * 60 * 1000;
/** Una venta de ese monto hasta este tiempo antes o después cuenta como la del pago */
const MATCH_MS = 30 * 60 * 1000;
/** Lo más viejo que se revisa (al arrancar la PC, por ejemplo) */
const LOOKBACK_MS = 3 * 60 * 60 * 1000;

interface State { lastCheck: number; seen: Record<string, number>; mpMethods: string[] }

/**
 * Aviso en el momento (no recién al cerrar la caja) cuando entra un pago a Mercado Pago
 * y no hay una venta de Mercado Pago de ese monto: casi siempre es una venta cargada
 * como efectivo o Clover. Las transferencias cuentan solo si el comercio lo activó
 * (eso lo filtra la nube). Corre en la PC servidor, no en la caja de la nube.
 */
@Injectable()
export class MpAlertsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Avisos MP');
  private readonly file = path.join(process.cwd(), 'ventra-mp-alerts.json');
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private state: State = { lastCheck: 0, seen: {}, mpMethods: ['MERCADOPAGO'] };

  constructor(
    private readonly prisma: PrismaService,
    private readonly notify: NotifyService,
    private readonly mp: MercadoPagoService,
  ) {
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.state = { ...this.state, ...saved };
    } catch { /* primera vez */ }
  }

  onModuleInit() {
    if ((process.env.VENTRA_NODE_KIND || 'pc') === 'cloud') return;
    this.timer = setInterval(() => this.check(), CHECK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Medios de pago que son Mercado Pago en esta PC (los manda la caja: viven en su configuración). */
  setMpMethods(methods: string[]) {
    const clean = [...new Set(['MERCADOPAGO', ...methods.map(String).filter(Boolean)])].slice(0, 30);
    if (clean.join(',') === this.state.mpMethods.join(',')) return;
    this.state.mpMethods = clean;
    this.save();
  }

  private save() {
    try { fs.writeFileSync(this.file, JSON.stringify(this.state)); } catch { /* sin disco */ }
  }

  async check() {
    if (this.running) return;
    this.running = true;
    try {
      const status = await this.mp.status().catch(() => null);
      if (!status?.connected || status.needsReconnect) return;
      const now = Date.now();
      const begin = new Date(Math.max(this.state.lastCheck - GRACE_MS - MATCH_MS, now - LOOKBACK_MS));
      const { payments } = await this.mp.payments(begin.toISOString(), new Date(now).toISOString());
      const mpSet = new Set(this.state.mpMethods);

      for (const p of payments) {
        const amount = Math.round((p.amount - (p.refunded || 0)) * 100) / 100;
        const at = p.at ? new Date(p.at).getTime() : 0;
        if (!(amount > 0) || !at || this.state.seen[p.id]) continue;
        if (now - at < GRACE_MS) continue; // todavía puede estar cargándose la venta

        const near = await this.prisma.payment.findMany({
          where: {
            amount: { gte: amount - 0.01, lte: amount + 0.01 },
            sale: { status: 'COMPLETED', createdAt: { gte: new Date(at - MATCH_MS), lte: new Date(at + MATCH_MS) } },
          },
          select: { method: true, reference: true, sale: { select: { saleNumber: true, createdAt: true } } },
        });
        this.state.seen[p.id] = now;
        const ok = near.some((r) => mpSet.has(r.method) || (r.reference || '').startsWith('MP ') || (r.reference || '').includes(`pago N° ${p.id} `));
        if (ok) continue;

        const wrong = near.find((r) => !mpSet.has(r.method));
        this.notify.enqueue('mpUnmatched', {
          paymentId: p.id,
          amount,
          at: p.at,
          channel: p.channel,
          saleNumber: wrong?.sale.saleNumber ?? null,
          method: wrong ? wrong.method : null,
        });
      }

      // El registro de pagos vistos no crece sin fin
      for (const [id, t] of Object.entries(this.state.seen)) if (now - t > 3 * 24 * 60 * 60 * 1000) delete this.state.seen[id];
      this.state.lastCheck = now;
      this.save();
    } catch (err: any) {
      this.logger.warn(`No se pudieron revisar los pagos de Mercado Pago: ${err?.message || err}`);
    } finally {
      this.running = false;
    }
  }
}
