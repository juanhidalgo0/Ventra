import { BadRequestException, HttpException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import axios from 'axios';
import { Jimp } from 'jimp';
import { PrismaService } from '../../database/prisma.service';
import { SubscriptionService } from '../subscription/subscription.service';

const FUNCTIONS_URL = process.env.VENTRA_FUNCTIONS_URL || 'https://us-central1-ventra-9cba5.cloudfunctions.net';

export interface AiImage { mediaType: string; data: string }

/**
 * IA de Ventra (función ventraAi en la nube): la clave de Claude no está en la PC; se pide con
 * la vinculación del equipo, y cada comercio tiene un tope de usos por mes.
 */
@Injectable()
export class AiService {
  constructor(private prisma: PrismaService, private subscription: SubscriptionService) {}

  /** Las fotos del celular pesan varios MB: se achican a lo que hace falta para leerlas */
  async shrink(files: { buffer: Buffer; mimetype?: string }[] = [], maxSide = 1800): Promise<AiImage[]> {
    const out: AiImage[] = [];
    for (const f of files.slice(0, 6)) {
      if (!/^image\//.test(f.mimetype || '')) throw new BadRequestException('Subí fotos (JPG o PNG). Los PDF y Excel se leen sin IA.');
      try {
        const img = await Jimp.read(f.buffer);
        if (img.width > maxSide || img.height > maxSide) {
          if (img.width >= img.height) img.resize({ w: maxSide }); else img.resize({ h: maxSide });
        }
        const buf = await img.getBuffer('image/jpeg', { quality: 82 });
        out.push({ mediaType: 'image/jpeg', data: buf.toString('base64') });
      } catch {
        // Formato que Jimp no abre (webp): va tal cual
        out.push({ mediaType: f.mimetype || 'image/jpeg', data: f.buffer.toString('base64') });
      }
    }
    return out;
  }

  async call(kind: 'order' | 'invoice' | 'pricelist' | 'match' | 'ask' | 'help' | 'gocats', body: Record<string, unknown>): Promise<{ result: any; left: number; leftToday?: number }> {
    const creds = this.subscription.getDeviceCredentials();
    if (!creds) throw new BadRequestException('La IA necesita esta PC vinculada a tu cuenta de Ventra (Configuración → Suscripción y nube).');
    try {
      const { data } = await axios.post(`${FUNCTIONS_URL}/ventraAi`, { ...creds, kind, ...body }, { timeout: 150_000, maxBodyLength: 40_000_000 });
      return { result: data.result, left: data.left, leftToday: data.leftToday };
    } catch (err: any) {
      const status = err?.response?.status;
      const message = err?.response?.data?.error;
      if (status && message) throw new HttpException(message, status >= 500 ? 503 : status);
      throw new ServiceUnavailableException('No se pudo conectar con la IA de Ventra. Revisá internet y probá de nuevo.');
    }
  }

  /**
   * Pedido de WhatsApp (texto y/o fotos) → renglones del catálogo, en unidades como los pedidos
   * de preventa. Los precios no vienen de la IA: los pone el pedido al guardarse.
   */
  async parseOrder(text: string, files: { buffer: Buffer; mimetype?: string }[]) {
    const products = await this.prisma.product.findMany({
      where: { isActive: true, id: { notIn: ['VENTA_RAPIDA', 'PAGO_CTA_CTE'] } },
      select: { id: true, name: true, unitsPerPack: true, salePrice: true, packPrice: true, stock: true },
    });
    const images = await this.shrink(files, 1600);
    const { result, left } = await this.call('order', {
      text: String(text || '').slice(0, 6000),
      images,
      catalog: products.map((p) => ({ id: p.id, name: p.name, pack: Number(p.unitsPerPack) > 1 ? Number(p.unitsPerPack) : undefined })),
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const items = (result?.items || []).map((it: any) => {
      const p: any = it.productId ? byId.get(String(it.productId)) : null;
      const size = p && it.unidad === 'bulto' && Number(p.unitsPerPack) > 1 ? Number(p.unitsPerPack) : 0;
      const qty = Math.max(0, Number(it.cantidad) || 0) || 1;
      return {
        productId: p ? p.id : null,
        productName: p ? p.name : null,
        asked: String(it.pedido || ''),
        note: String(it.nota || ''),
        confidence: ['alta', 'media', 'baja'].includes(it.confianza) ? it.confianza : 'baja',
        // En unidades, como los pedidos de preventa (2 bultos x12 = 24)
        quantity: size ? qty * size : qty,
        packSize: size || null,
        unitsPerPack: p ? Number(p.unitsPerPack) || 1 : null,
        stock: p ? Number(p.stock) || 0 : null,
      };
    });
    return { client: String(result?.cliente || ''), note: String(result?.aclaracion || ''), items, left };
  }

  /**
   * Preguntale a tu negocio: la IA elige consultas fijas (InsightsService), la PC las corre y la
   * IA redacta la respuesta con esos números. La base nunca sale entera de la PC.
   */
  async ask(question: string, run: (queries: any[]) => Promise<any[]>) {
    const q = String(question || '').trim().slice(0, 500);
    if (!q) throw new BadRequestException('Escribí tu pregunta.');
    const { result: plan } = await this.call('ask', { step: 'plan', question: q });
    const queries = Array.isArray(plan?.queries) ? plan.queries : [];
    if (!queries.length) return { answer: String(plan?.noSePuede || 'Eso no lo puedo responder con los datos del sistema.'), data: [] };
    const data = await run(queries);
    const { result, left, leftToday } = await this.call('ask', { step: 'answer', question: q, data });
    // Cada pregunta son dos usos (elegir las consultas y redactar)
    return { answer: String(result?.answer || ''), data, left, questionsLeftToday: leftToday === undefined ? undefined : Math.floor(leftToday / 2) };
  }

  /**
   * WhatsApp del dueño (función ventraWaOwner): ver si está vinculado, pedir el código para
   * vincularlo (lo manda el dueño desde su teléfono al número de Ventra) o desvincularlo.
   */
  async whatsapp(action: 'status' | 'code' | 'unlink') {
    const creds = this.subscription.getDeviceCredentials();
    if (!creds) throw new BadRequestException('Para preguntar por WhatsApp, esta PC tiene que estar vinculada a tu cuenta de Ventra (Configuración → Suscripción y nube).');
    try {
      const { data } = await axios.post(`${FUNCTIONS_URL}/ventraWaOwner`, { ...creds, action }, { timeout: 20_000 });
      return data;
    } catch (err: any) {
      const status = err?.response?.status;
      const message = err?.response?.data?.error;
      if (status && message) throw new HttpException(message, status >= 500 ? 503 : status);
      throw new ServiceUnavailableException('No se pudo conectar con Ventra. Revisá internet y probá de nuevo.');
    }
  }

  /** Ayuda adentro del sistema: cómo se hace algo en Ventra */
  async help(messages: { role: string; content: string }[], screen?: string) {
    const { result, left, leftToday } = await this.call('help', { messages: (messages || []).slice(-12), screen: String(screen || '').slice(0, 60) });
    return { answer: String(result?.answer || ''), left, leftToday };
  }
}
