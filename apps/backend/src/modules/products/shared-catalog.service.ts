import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { SubscriptionService } from '../subscription/subscription.service';

const FUNCTIONS_URL = process.env.VENTRA_FUNCTIONS_URL || 'https://us-central1-ventra-9cba5.cloudfunctions.net';
const TTL_MS = 60 * 60 * 1000;

export interface SharedBarcode { name: string | null; imageUrl: string | null; votes: number }

/**
 * Catálogo compartido entre los comercios de Ventra (función ventraBarcodes en la nube): cuando
 * un dueño confirma un producto (nombre y foto de un código de barras), ese dato queda verificado
 * y le llega primero al próximo comercio que escanee el mismo código. Sin vinculación o sin
 * internet no hace nada (la búsqueda sigue con los supermercados).
 */
@Injectable()
export class SharedCatalogService {
  private cache = new Map<string, { at: number; value: SharedBarcode | null }>();

  constructor(private subscription: SubscriptionService) {}

  async get(barcode: string): Promise<SharedBarcode | null> {
    const hit = this.cache.get(barcode);
    if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
    const creds = this.subscription.getDeviceCredentials();
    if (!creds) return null;
    try {
      const { data } = await axios.post(`${FUNCTIONS_URL}/ventraBarcodes`, { ...creds, action: 'get', barcodes: [barcode] }, { timeout: 2500 });
      const value: SharedBarcode | null = data?.items?.[barcode] || null;
      this.cache.set(barcode, { at: Date.now(), value });
      return value;
    } catch {
      return null; // sin conexión o sin la función: se sigue sin el catálogo compartido
    }
  }

  /** Lo confirmó el dueño: suma su voto. La foto solo si es un enlace (no las guardadas en la base). */
  async confirm(items: { barcode?: string | null; name?: string | null; imageUrl?: string | null }[]): Promise<void> {
    const clean = items
      .map((i) => ({ barcode: String(i.barcode || '').trim(), name: String(i.name || '').trim().slice(0, 120), imageUrl: /^https:\/\//.test(String(i.imageUrl || '')) ? String(i.imageUrl).slice(0, 500) : null }))
      .filter((i) => /^\d{8,14}$/.test(i.barcode) && (i.name || i.imageUrl));
    if (!clean.length) return;
    const creds = this.subscription.getDeviceCredentials();
    if (!creds) return;
    try {
      await axios.post(`${FUNCTIONS_URL}/ventraBarcodes`, { ...creds, action: 'confirm', items: clean.slice(0, 50) }, { timeout: 8000 });
      for (const i of clean) this.cache.delete(i.barcode);
    } catch { /* se pierde ese voto: no es crítico */ }
  }
}
