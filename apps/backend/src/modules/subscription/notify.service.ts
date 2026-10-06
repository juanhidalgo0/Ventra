import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { SubscriptionService } from './subscription.service';
import { PrismaService } from '../../database/prisma.service';

const FUNCTIONS_URL = process.env.VENTRA_FUNCTIONS_URL || 'https://us-central1-ventra-9cba5.cloudfunctions.net';

type EventType = 'lowStock' | 'cashDiff' | 'saleCancel' | 'invoiceFail' | 'expiry' | 'mpUnmatched' | 'employeeConsumption';
interface QueuedEvent { type: EventType; data: any; at: number; tries: number }
interface LowStockItem { id: string; name: string; stock: number; minStock: number }

/** Espera para juntar varios productos en un solo aviso de stock bajo */
const LOW_STOCK_WINDOW_MS = 15 * 60 * 1000;
/** Con esta cantidad se avisa sin esperar la ventana */
const LOW_STOCK_FLUSH_AT = 8;
/** Un mismo producto no vuelve a avisar antes de esto (aunque se reponga y se vuelva a agotar) */
const LOW_STOCK_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 15 * 60 * 1000;
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Desde esta hora (local de la PC) sale el aviso diario de vencimientos */
const EXPIRY_ALERT_HOUR = 9;

/**
 * Avisos al celular del dueño que nacen en esta PC: stock mínimo, cierre de caja con
 * diferencia, venta anulada y factura rechazada. Los manda a la nube (ventraNotify), que
 * decide según las preferencias del dueño. Si no hay internet o es horario de silencio,
 * quedan en cola y se reintentan.
 *
 * El stock bajo es "inteligente": avisa solo cuando un producto CRUZA su mínimo (no en
 * cada venta posterior), junta los productos de los próximos 15 minutos en un solo aviso y
 * no repite el mismo producto por 24 h.
 */
@Injectable()
export class NotifyService implements OnModuleDestroy {
  private readonly logger = new Logger('Avisos');
  private readonly file = path.join(process.cwd(), 'ventra-notify.json');
  private queue: QueuedEvent[] = [];
  private lowStock = new Map<string, LowStockItem>();
  private lastAlert: Record<string, number> = {};
  private lowStockTimer: NodeJS.Timeout | null = null;
  private retryTimer: NodeJS.Timeout | null = null;
  private expiryTimer: NodeJS.Timeout | null = null;
  private sending = false;

  constructor(private readonly subscription: SubscriptionService, private readonly prisma: PrismaService) {
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.queue = Array.isArray(saved.queue) ? saved.queue : [];
      this.lastAlert = saved.lastAlert || {};
    } catch { /* primera vez */ }
    this.retryTimer = setInterval(() => this.flushQueue(), RETRY_MS);
    this.retryTimer.unref?.();
    if (this.queue.length) setTimeout(() => this.flushQueue(), 60_000).unref?.();
    // Vencimientos: se revisa cada hora y avisa una vez por día
    this.expiryTimer = setInterval(() => this.checkExpiryDaily(), 60 * 60 * 1000);
    this.expiryTimer.unref?.();
    setTimeout(() => this.checkExpiryDaily(), 2 * 60_000).unref?.();
  }

  onModuleDestroy() {
    if (this.retryTimer) clearInterval(this.retryTimer);
    if (this.lowStockTimer) clearTimeout(this.lowStockTimer);
    if (this.expiryTimer) clearInterval(this.expiryTimer);
  }

  /**
   * Después de una venta: productos cuyo stock pasó de arriba del mínimo a igual o debajo.
   * `sold` = cuánto se descontó de cada uno en esta venta.
   */
  checkLowStock(products: { id: string; name: string; stock: number; minStock: number | null; unlimitedStock?: boolean | null }[], sold: Map<string, number>) {
    const now = Date.now();
    for (const p of products) {
      const min = Number(p.minStock) || 0;
      if (min <= 0 || p.unlimitedStock) continue;
      const after = Number(p.stock) || 0;
      const before = after + (sold.get(p.id) || 0);
      if (!(after <= min && before > min)) continue; // no cruzó el mínimo en esta venta
      if (now - (this.lastAlert[p.id] || 0) < LOW_STOCK_COOLDOWN_MS) continue;
      this.lowStock.set(p.id, { id: p.id, name: p.name, stock: after, minStock: min });
    }
    if (!this.lowStock.size) return;
    if (this.lowStock.size >= LOW_STOCK_FLUSH_AT) return this.flushLowStock();
    if (!this.lowStockTimer) {
      this.lowStockTimer = setTimeout(() => this.flushLowStock(), LOW_STOCK_WINDOW_MS);
      this.lowStockTimer.unref?.();
    }
  }

  private flushLowStock() {
    if (this.lowStockTimer) { clearTimeout(this.lowStockTimer); this.lowStockTimer = null; }
    const items = [...this.lowStock.values()];
    this.lowStock.clear();
    if (!items.length) return;
    const now = Date.now();
    items.forEach((i) => { this.lastAlert[i.id] = now; });
    // Limpia registros viejos para que el archivo no crezca
    for (const [id, at] of Object.entries(this.lastAlert)) if (now - at > 7 * LOW_STOCK_COOLDOWN_MS) delete this.lastAlert[id];
    this.enqueue('lowStock', { items });
  }

  /**
   * Una vez por día (desde las 9): lotes vencidos o dentro del aviso de su producto.
   * Va a la campanita y, si la PC está vinculada, al celular del dueño.
   */
  async checkExpiryDaily() {
    const now = new Date();
    if (now.getHours() < EXPIRY_ALERT_HOUR) return;
    const dayKey = `expiry:${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    if (this.lastAlert[dayKey]) return;
    try {
      const lots = await this.prisma.productLot.findMany({
        where: { status: 'ACTIVE', product: { trackExpiry: true, isActive: true } },
        orderBy: { expiresAt: 'asc' },
        include: { product: { select: { name: true, expiryAlertDays: true } } },
      });
      const today = new Date(now); today.setHours(0, 0, 0, 0);
      const items = lots
        .map((l) => {
          const exp = new Date(l.expiresAt); exp.setHours(0, 0, 0, 0);
          return { name: l.product.name, daysLeft: Math.round((exp.getTime() - today.getTime()) / 86400000), alertDays: l.product.expiryAlertDays ?? 7 };
        })
        .filter((i) => i.daysLeft <= i.alertDays);
      this.lastAlert[dayKey] = Date.now();
      this.save();
      if (!items.length) return;
      const expired = items.filter((i) => i.daysLeft < 0).length;
      this.enqueue('expiry', { expired, soon: items.length - expired, items: items.slice(0, 20).map(({ name, daysLeft }) => ({ name, daysLeft })) });
    } catch (err: any) {
      this.logger.warn(`No se pudieron revisar los vencimientos: ${err?.message || err}`);
    }
  }

  /** Guarda el aviso en el historial local (campanita del POS / admin). */
  private async record(type: EventType, data: any) {
    const msg = localMessage(type, data);
    if (!msg) return;
    try {
      await this.prisma.appNotification.create({ data: { type, title: msg.title, body: msg.body, url: msg.url } });
      // El historial no crece sin fin: quedan los últimos 300
      const old = await this.prisma.appNotification.findMany({ orderBy: { createdAt: 'desc' }, skip: 300, select: { id: true } });
      if (old.length) await this.prisma.appNotification.deleteMany({ where: { id: { in: old.map((o) => o.id) } } });
    } catch (err: any) {
      this.logger.warn(`No se pudo guardar el aviso: ${err?.message || err}`);
    }
  }

  enqueue(type: EventType, data: any) {
    this.record(type, data);
    if (!this.subscription.getDeviceCredentials()) return; // PC sin vincular: no hay a quién avisar
    this.queue.push({ type, data, at: Date.now(), tries: 0 });
    this.save();
    this.flushQueue();
  }

  private save() {
    try { fs.writeFileSync(this.file, JSON.stringify({ queue: this.queue.slice(-100), lastAlert: this.lastAlert })); } catch { /* sin disco */ }
  }

  private async flushQueue() {
    if (this.sending || !this.queue.length) return;
    const creds = this.subscription.getDeviceCredentials();
    if (!creds) return;
    this.sending = true;
    try {
      const keep: QueuedEvent[] = [];
      for (const ev of this.queue) {
        if (Date.now() - ev.at > MAX_AGE_MS) continue; // ya no tiene sentido avisarlo
        try {
          const { data } = await axios.post(`${FUNCTIONS_URL}/ventraNotify`, { ...creds, event: { type: ev.type, data: ev.data } }, { timeout: 15000 });
          if (data?.reason === 'quiet') keep.push(ev); // se manda al terminar el silencio
        } catch (err: any) {
          const status = err?.response?.status;
          if (status === 400 || status === 401) continue; // no se va a poder mandar nunca
          ev.tries += 1;
          if (ev.tries < 20) keep.push(ev);
        }
      }
      this.queue = keep;
      this.save();
    } catch (err: any) {
      this.logger.warn(`No se pudieron mandar los avisos: ${err?.message || err}`);
    } finally {
      this.sending = false;
    }
  }
}

const money = (n: any) => '$' + Math.round(Number(n) || 0).toLocaleString('es-AR');

/** Texto del aviso para la campanita (el del celular lo arma la nube con el mismo criterio). */
export function localMessage(type: EventType, d: any): { title: string; body: string; url: string } | null {
  d = d || {};
  switch (type) {
    case 'lowStock': {
      const items: any[] = Array.isArray(d.items) ? d.items : [];
      if (!items.length) return null;
      const qty = (n: any) => Math.max(0, Math.round(Number(n) * 100) / 100);
      return {
        title: items.length === 1 ? `Stock bajo: ${items[0].name}` : `${items.length} productos llegaron al stock mínimo`,
        body: items.length === 1
          ? `Quedan ${qty(items[0].stock)} (mínimo ${items[0].minStock}).`
          : items.slice(0, 4).map((i) => `${i.name} (quedan ${qty(i.stock)})`).join(', ') + (items.length > 4 ? ` y ${items.length - 4} más` : ''),
        url: '/stock-control',
      };
    }
    case 'cashDiff': {
      const diff = Number(d.difference) || 0;
      if (!diff) return null;
      return {
        title: `${d.terminal || 'Una caja'} cerró con ${diff < 0 ? 'faltante' : 'sobrante'} de ${money(Math.abs(diff))}`,
        body: `${d.user || 'Sin usuario'} · esperado ${money(d.expected)} · declarado ${money(d.counted)}`,
        url: '/cash-control',
      };
    }
    case 'saleCancel':
      return { title: `Se anuló una venta de ${money(d.total)}`, body: `Ticket #${d.saleNumber || '—'} · ${d.user || 'Sin usuario'}`, url: '/historial' };
    case 'invoiceFail':
      return {
        title: 'Una factura no se pudo emitir',
        body: `Ticket #${d.saleNumber || '—'} (${money(d.total)}): ${String(d.error || 'sin detalle').slice(0, 140)}`,
        url: '/fiscal',
      };
    case 'expiry': {
      const expired = Number(d.expired) || 0, soon = Number(d.soon) || 0;
      if (!expired && !soon) return null;
      const parts: string[] = [];
      if (expired) parts.push(`${expired} vencido${expired > 1 ? 's' : ''}`);
      if (soon) parts.push(`${soon} por vencer`);
      const items: any[] = Array.isArray(d.items) ? d.items : [];
      return {
        title: `Vencimientos: ${parts.join(' y ')}`,
        body: items.slice(0, 4).map((i) => `${i.name} (${i.daysLeft < 0 ? `venció hace ${-i.daysLeft} d` : i.daysLeft === 0 ? 'vence hoy' : `vence en ${i.daysLeft} d`})`).join(', ')
          + (items.length > 4 ? ` y ${items.length - 4} más` : ''),
        url: '#expiring',
      };
    }
    case 'mpUnmatched': {
      const hora = d.at ? new Date(d.at).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : '';
      const canal = ({ point: 'en la maquinita', qr: 'con QR', transfer: 'por transferencia' } as Record<string, string>)[d.channel] || '';
      const metodo = d.method === 'CASH' ? 'efectivo' : d.method;
      return {
        title: `Entró ${money(d.amount)} a Mercado Pago sin venta de Mercado Pago`,
        body: d.saleNumber
          ? `Pago ${canal} a las ${hora}: la venta #${d.saleNumber} de ese monto se cargó como ${metodo}. Revisala.`
          : `Pago ${canal} a las ${hora} (N° ${d.paymentId}): no hay ninguna venta de ese monto cerca de esa hora.`,
        url: '/cash-control',
      };
    }
    case 'employeeConsumption': {
      const items: string[] = Array.isArray(d.items) ? d.items : [];
      const count = Number(d.count) || items.length;
      return {
        title: `Consumo de ${d.user || 'un empleado'}: ${money(d.total)}`,
        body: items.slice(0, 4).join(', ') + (count > 4 ? ` y ${count - 4} más` : ''),
        url: '/employee-consumption',
      };
    }
    default:
      return null;
  }
}
