import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { SubscriptionService } from './subscription.service';

const FUNCTIONS_URL = process.env.VENTRA_FUNCTIONS_URL || 'https://us-central1-ventra-9cba5.cloudfunctions.net';

type EventType = 'lowStock' | 'cashDiff' | 'saleCancel' | 'invoiceFail';
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
  private sending = false;

  constructor(private readonly subscription: SubscriptionService) {
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.queue = Array.isArray(saved.queue) ? saved.queue : [];
      this.lastAlert = saved.lastAlert || {};
    } catch { /* primera vez */ }
    this.retryTimer = setInterval(() => this.flushQueue(), RETRY_MS);
    this.retryTimer.unref?.();
    if (this.queue.length) setTimeout(() => this.flushQueue(), 60_000).unref?.();
  }

  onModuleDestroy() {
    if (this.retryTimer) clearInterval(this.retryTimer);
    if (this.lowStockTimer) clearTimeout(this.lowStockTimer);
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

  enqueue(type: EventType, data: any) {
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
