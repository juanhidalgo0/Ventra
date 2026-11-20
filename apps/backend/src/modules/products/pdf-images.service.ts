import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Jimp } from 'jimp';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../websockets/events.gateway';
import { isBarcode } from '../purchases/invoice-reader/barcode-check';
import { SharedCatalogService } from './shared-catalog.service';

/**
 * Fotos desde un catálogo en PDF (el que manda un proveedor o el del sistema anterior): cada foto
 * se empareja con el producto cuyo código (interno o de barras) está escrito al lado, en la misma
 * tarjeta. Primero se muestra lo encontrado (preview) y el dueño confirma (apply).
 *
 * Emparejado: para cada foto, los códigos de productos que aparecen cerca (a menos de 1,3 veces el
 * tamaño de la foto). Se asignan de a pares, el más cercano primero; cada foto y cada código, una vez.
 * Así un logo o un adorno sin código cerca queda afuera.
 */

// Solo se lee el PDF (no se dibuja): estas piezas de dibujo no hacen falta
const g = globalThis as any;
g.DOMMatrix ??= class DOMMatrix {};
g.Path2D ??= class Path2D {};
// eslint-disable-next-line @typescript-eslint/no-var-requires
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
(globalThis as any).pdfjsWorker = require('pdfjs-dist/legacy/build/pdf.worker.js');

const MAX_PAGES = 200;
const MAX_IMAGES = 3000;
/** Lo encontrado se guarda un rato para confirmarlo sin volver a subir el PDF */
const TTL_MS = 30 * 60 * 1000;

interface Found { productId: string; image: string }
interface Pending { at: number; items: Map<string, Found> }

type Mat = number[];
const mul = (a: Mat, b: Mat): Mat => [
  a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5],
];

const norm = (s: string) => String(s || '').trim().toUpperCase();

@Injectable()
export class PdfImagesService {
  private pending = new Map<string, Pending>();

  constructor(private prisma: PrismaService, private events: EventsGateway, private shared: SharedCatalogService) {}

  /** Lee el PDF y devuelve qué foto le tocaría a cada producto (sin guardar nada todavía). */
  async preview(buffer: Buffer) {
    if (!buffer?.length) throw new BadRequestException('No se recibió ningún archivo');
    if (buffer.subarray(0, 5).toString() !== '%PDF-') throw new BadRequestException('El archivo no es un PDF');

    // Códigos de los productos: interno (sku) y de barras, sin distinguir mayúsculas
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true, sku: true, barcode: true, imageUrl: true },
    });
    const byCode = new Map<string, typeof products[number]>();
    for (const p of products) {
      if (p.sku) byCode.set(norm(p.sku), p);
      if (p.barcode && !byCode.has(norm(p.barcode))) byCode.set(norm(p.barcode), p);
    }

    let doc: any;
    try {
      doc = await pdfjs.getDocument({
        data: new Uint8Array(buffer),
        // El PDF viene de terceros: nada de ejecutar código armado desde el archivo (CVE-2024-4367)
        isEvalSupported: false,
        disableFontFace: true,
        useSystemFonts: false,
        isOffscreenCanvasSupported: false,
        verbosity: 0,
      }).promise;
    } catch {
      throw new BadRequestException('No se pudo leer el PDF');
    }

    const found = new Map<string, Found>();
    let images = 0;
    let unmatched = 0;
    try {
      const pages = Math.min(doc.numPages, MAX_PAGES);
      for (let p = 1; p <= pages && images < MAX_IMAGES; p++) {
        const page = await doc.getPage(p);
        const pics = await this.pagePictures(page);
        images += pics.length;
        const codes = await this.pageCodes(page, byCode);
        // Pares foto-código, del más cercano al más lejano
        const pairs: { i: number; c: number; d: number }[] = [];
        pics.forEach((pic, i) => {
          const cx = pic.x + pic.w / 2, cy = pic.y + pic.h / 2;
          const reach = 1.3 * Math.max(pic.w, pic.h);
          codes.forEach((code, c) => {
            const d = Math.hypot(code.x - cx, code.y - cy);
            if (d <= reach) pairs.push({ i, c, d });
          });
        });
        pairs.sort((a, b) => a.d - b.d);
        const usedPic = new Set<number>(), usedCode = new Set<number>();
        for (const { i, c } of pairs) {
          if (usedPic.has(i) || usedCode.has(c)) continue;
          usedPic.add(i); usedCode.add(c);
          const product = codes[c].product;
          if (found.has(product.id)) continue;
          const image = await this.toJpeg(page, pics[i].name).catch(() => null);
          if (image) found.set(product.id, { productId: product.id, image });
        }
        unmatched += pics.length - usedPic.size;
        page.cleanup();
      }
    } finally {
      await doc.destroy().catch(() => {});
    }

    this.prune();
    const token = randomUUID();
    this.pending.set(token, { at: Date.now(), items: found });
    const byId = new Map(products.map((p) => [p.id, p]));
    const items = [...found.values()].map((f) => {
      const p = byId.get(f.productId)!;
      return { productId: p.id, name: p.name, code: p.sku || p.barcode || '', hasImage: !!p.imageUrl, image: f.image };
    }).sort((a, b) => a.name.localeCompare(b.name, 'es'));
    return { token, images, unmatched, matched: items.length, withImage: items.filter((i) => i.hasImage).length, items };
  }

  /**
   * Guarda las fotos elegidas. Si el servidor todavía tiene lo que encontró preview, usa esas; si
   * se reinició en el medio (una actualización, la caja web que se apaga sola), las que manda la
   * pantalla, que son las mismas: JPEG chicos, solo para los productos que existen.
   */
  async apply(token: string, productIds: string[], images?: Record<string, string>) {
    const pend = token ? this.pending.get(token) : undefined;
    const fresh = pend && Date.now() - pend.at <= TTL_MS ? pend : undefined;
    const sent = images && typeof images === 'object' ? images : {};
    const ids = Array.isArray(productIds) ? productIds.map(String).slice(0, 500) : [];
    if (!fresh && !ids.some((id) => typeof sent[id] === 'string')) throw new BadRequestException('Pasó mucho tiempo: volvé a subir el PDF');
    let saved = 0;
    const toShare: { barcode: string; name: string; dataUrl: string }[] = [];
    for (const id of ids) {
      const img = sent[id];
      const f = fresh?.items.get(id) ?? (typeof img === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(img) && img.length < 400_000 ? { productId: id, image: img } : undefined);
      if (!f) continue;
      const product = await this.prisma.product.update({ where: { id }, data: { imageUrl: f.image }, select: { name: true, barcode: true } }).catch(() => null);
      if (!product) continue;
      this.events.emitProductUpdated({ id, imageUrl: f.image });
      saved++;
      // Con código de barras de verdad (no uno interno), la foto le sirve a los demás comercios
      const barcode = String(product.barcode || '').trim();
      if (isBarcode(barcode)) toShare.push({ barcode, name: product.name, dataUrl: f.image });
    }
    // En segundo plano: el dueño no espera a la nube
    if (toShare.length) this.shared.share(toShare).catch(() => 0);
    return { saved, shared: toShare.length };
  }

  private prune() {
    const now = Date.now();
    for (const [k, v] of this.pending) if (now - v.at > TTL_MS) this.pending.delete(k);
  }

  /** Fotos dibujadas en la página, con su lugar en la hoja (sin las muy chicas: íconos, viñetas) */
  private async pagePictures(page: any) {
    const ops = await page.getOperatorList();
    const O = pdfjs.OPS;
    let ctm: Mat = [1, 0, 0, 1, 0, 0];
    const stack: Mat[] = [];
    const out: { name: string; x: number; y: number; w: number; h: number }[] = [];
    for (let i = 0; i < ops.fnArray.length; i++) {
      const f = ops.fnArray[i];
      const a = ops.argsArray[i];
      if (f === O.save) stack.push(ctm);
      else if (f === O.restore) ctm = stack.pop() || ctm;
      else if (f === O.transform) ctm = mul(ctm, a);
      else if (f === O.paintImageXObject || f === O.paintJpegXObject) {
        const w = Math.hypot(ctm[0], ctm[1]), h = Math.hypot(ctm[2], ctm[3]);
        if (w < 25 || h < 25) continue;
        // Con la imagen dada vuelta (h negativo) el origen queda arriba
        const y = ctm[3] < 0 ? ctm[5] + ctm[3] : ctm[5];
        out.push({ name: a[0], x: ctm[4], y, w, h });
      }
    }
    return out;
  }

  /** Códigos de productos escritos en la página ("Código: 00548", "7790001234567"), con su lugar */
  private async pageCodes(page: any, byCode: Map<string, any>) {
    const content = await page.getTextContent();
    const labeled: { x: number; y: number; product: any }[] = [];
    const loose: { x: number; y: number; product: any }[] = [];
    const items = (content.items as any[]).filter((it) => typeof it.str === 'string' && it.str.trim());
    items.forEach((it, idx) => {
      const x = it.transform[4], y = it.transform[5];
      // "Código: 00548" (o "Cód." y el número en el trozo siguiente): esos mandan
      const isLabel = /c[oó]d(igo|\.)?\s*:?/i.test(it.str);
      const text = isLabel && !/\d/.test(it.str) && items[idx + 1] ? `${it.str} ${items[idx + 1].str}` : it.str;
      for (const tok of text.split(/[\s|:;]+/)) {
        // Números cortos ("10" de "X 10 ML", "98" de un precio) no cuentan como código
        const p = tok.length >= 3 && !/[.,]/.test(tok) ? byCode.get(norm(tok)) : undefined;
        if (p) { (isLabel ? labeled : loose).push({ x, y, product: p }); break; }
      }
    });
    return labeled.length ? labeled : loose;
  }

  /** La foto como JPEG chico (300 px, como las demás fotos de productos) */
  private async toJpeg(page: any, name: string): Promise<string | null> {
    const obj: any = await new Promise((resolve) => {
      const objs = String(name).startsWith('g_') ? page.commonObjs : page.objs;
      try { objs.get(name, resolve); } catch { resolve(null); }
    });
    if (!obj || !obj.width || !obj.height || !obj.data) return null;
    const { width, height, data, kind } = obj;
    const rgba = Buffer.alloc(width * height * 4);
    if (kind === 3) Buffer.from(data.buffer, data.byteOffset, data.byteLength).copy(rgba);
    else if (kind === 2) {
      for (let i = 0, j = 0; i < width * height; i++, j += 3) { rgba[i * 4] = data[j]; rgba[i * 4 + 1] = data[j + 1]; rgba[i * 4 + 2] = data[j + 2]; rgba[i * 4 + 3] = 255; }
    } else if (kind === 1) {
      const rowBytes = (width + 7) >> 3;
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1;
        const v = bit ? 255 : 0, o = (y * width + x) * 4;
        rgba[o] = rgba[o + 1] = rgba[o + 2] = v; rgba[o + 3] = 255;
      }
    } else return null;
    const img = new Jimp({ width, height, data: rgba });
    // Fondo blanco donde la foto es transparente (el JPEG no tiene transparencia)
    img.scan(0, 0, width, height, (_x: number, _y: number, idx: number) => {
      const al = img.bitmap.data[idx + 3] / 255;
      if (al < 1) for (let k = 0; k < 3; k++) img.bitmap.data[idx + k] = Math.round(img.bitmap.data[idx + k] * al + 255 * (1 - al));
      img.bitmap.data[idx + 3] = 255;
    });
    if (width > 300 || height > 300) img.resize(width >= height ? { w: 300 } : { h: 300 });
    const buf = await img.getBuffer('image/jpeg', { quality: 60 });
    return `data:image/jpeg;base64,${buf.toString('base64')}`;
  }
}
