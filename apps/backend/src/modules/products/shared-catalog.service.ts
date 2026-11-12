import { Injectable } from '@nestjs/common';
import axios from 'axios';
import { SubscriptionService } from '../subscription/subscription.service';

const FUNCTIONS_URL = process.env.VENTRA_FUNCTIONS_URL || 'https://us-central1-ventra-9cba5.cloudfunctions.net';
const TTL_MS = 60 * 60 * 1000;

export interface SharedBarcode { name: string | null; imageUrl: string | null; votes: number }
/** Mapa compartido entre comercios (firebase/functions/supplier-codes.js) */
export interface SharedSupplierCode { barcode: string; name: string | null; unitsPerPack: number | null; votes: number; rivals: number; confidence: 'alta' | 'sugerencia' | 'contradice'; mine?: boolean }

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

  /**
   * Mapa compartido código del proveedor → código de barras (tanda 3 de boletas): los códigos de una
   * boleta que no se encontraron. Sin vinculación o sin internet: vacío, sin error (sigue como siempre).
   */
  async supplierCodes(cuit: string, codes: string[]): Promise<Record<string, SharedSupplierCode>> {
    const c = String(cuit || '').replace(/\D/g, '');
    const list = [...new Set(codes.map((x) => String(x || '').trim()).filter(Boolean))].slice(0, 200);
    if (c.length !== 11 || !list.length) return {};
    const creds = this.subscription?.getDeviceCredentials();
    if (!creds) return {};
    try {
      const { data } = await axios.post(`${FUNCTIONS_URL}/ventraBarcodes`, { ...creds, action: 'supplierGet', cuit: c, codes: list }, { timeout: 4000 });
      return data?.items || {};
    } catch {
      return {};
    }
  }

  /**
   * Productos nuevos de una boleta sin código de barras (tanda 7.1): por cada nombre, hasta 3 códigos del
   * catálogo compartido con nombre parecido (y el mismo tamaño). Son sugerencias: el dueño elige con un toque.
   */
  async searchNames(names: string[]): Promise<{ barcode: string; name: string; votes: number; score: number }[][]> {
    const list = names.map((n) => String(n || '').trim()).slice(0, 40);
    if (!list.some(Boolean)) return list.map(() => []);
    const creds = this.subscription?.getDeviceCredentials();
    if (!creds) return list.map(() => []);
    try {
      const { data } = await axios.post(`${FUNCTIONS_URL}/ventraBarcodes`, { ...creds, action: 'searchName', names: list }, { timeout: 5000 });
      return Array.isArray(data?.results) ? data.results : list.map(() => []);
    } catch {
      return list.map(() => []);
    }
  }

  /** Lo que asoció el dueño al confirmar una compra: su voto en el mapa compartido. Nunca precios ni cantidades. */
  async confirmSupplierCodes(cuit: string, items: { code?: string; barcode?: string | null; name?: string; unitsPerPack?: number }[]): Promise<void> {
    const c = String(cuit || '').replace(/\D/g, '');
    const clean = items.map((i) => ({ code: String(i.code || '').trim(), barcode: String(i.barcode || '').trim(), name: String(i.name || '').trim().slice(0, 120), unitsPerPack: Number(i.unitsPerPack) || 0 }))
      .filter((i) => i.code && /^\d{8,14}$/.test(i.barcode));
    if (c.length !== 11 || !clean.length) return;
    const creds = this.subscription?.getDeviceCredentials();
    if (!creds) return;
    try {
      await axios.post(`${FUNCTIONS_URL}/ventraBarcodes`, { ...creds, action: 'supplierConfirm', cuit: c, items: clean.slice(0, 200) }, { timeout: 8000 });
    } catch { /* se pierde ese voto: no es crítico */ }
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
