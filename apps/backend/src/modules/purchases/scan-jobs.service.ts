import { BadRequestException, HttpException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AiService } from '../ai/ai.service';
import { PurchasesService } from './purchases.service';
import { demoContext } from '../system/demo-visitors';
import { readArcaQr, qrTotalPesos } from './invoice-reader/arca-qr';

/**
 * Lectura de boletas en segundo plano, sin límite de fotos (2026-11-12).
 *
 * Antes la PC mandaba todas las fotos en un solo pedido y esperaba: con 6 fotos tardaba casi 3 minutos
 * con una barra inventada, se cortaba al minuto y parecía colgada. Ahora:
 * - Se suben las fotos y se responde al toque con el número de lectura.
 * - Cada foto se lee sola en la nube (ventraAi stage "page"), de a 3 a la vez, y la pantalla pregunta
 *   cómo va (GET) para mostrar foto por foto qué se encontró.
 * - Al terminar, la nube junta las hojas del mismo comprobante (stage "group", sin IA, ahí se cuentan las
 *   facturas) y cada comprobante queda en Compras → Por revisar. El dueño puede irse de la pantalla.
 */

export type PhotoState = 'queued' | 'reading' | 'done' | 'failed';
export interface Photo {
  index: number;
  name: string;
  state: PhotoState;
  startedAt?: number;
  doneAt?: number;
  /** Lo que se vio en la foto, para mostrarlo mientras siguen las demás */
  found?: { supplierName: string; invoiceNumber: string; pageNumber: number; pageCount: number; items: number; issue?: string };
  error?: string;
}
export interface ScanJobDoc {
  purchaseId: string | null;
  status: string;
  supplierName: string;
  invoiceNumber: string;
  docType: string;
  images: number[];
  items: number;
  ok: boolean | null;
  message: string;
  why: string[];
}
export interface Job {
  id: string;
  owner: string;
  createdAt: number;
  finishedAt?: number;
  status: 'reading' | 'grouping' | 'done' | 'error';
  photos: Photo[];
  documents: ScanJobDoc[];
  error?: string;
  /** Tope de la IA alcanzado a mitad de camino: se guarda lo que se leyó */
  limitMessage?: string;
  left?: number;
}

const CONCURRENCY = 3;
const KEEP_MS = 6 * 3600e3;
const MAX_PHOTOS = 60;

@Injectable()
export class ScanJobsService {
  private jobs = new Map<string, Job>();

  constructor(private ai: AiService, private purchases: PurchasesService) {}

  /** Cada lectura es de quien la empezó (y, en la demo, de ese visitante) */
  private ownerKey(userId?: string) {
    return `${demoContext.getStore()?.id || ''}:${userId || ''}`;
  }

  start(files: Express.Multer.File[], userId?: string, manualTotal?: number) {
    const photos = (files || []).filter((f) => /^image\//.test(f.mimetype || ''));
    if (!photos.length) throw new BadRequestException('Subí fotos de la boleta (JPG o PNG). Los PDF y Excel se leen al toque, sin IA.');
    if (photos.length > MAX_PHOTOS) throw new BadRequestException(`Son muchas fotos juntas: subí hasta ${MAX_PHOTOS} por vez.`);
    this.cleanup();
    const job: Job = {
      id: randomUUID(),
      owner: this.ownerKey(userId),
      createdAt: Date.now(),
      status: 'reading',
      photos: photos.map((f, index) => ({ index, name: f.originalname || `Foto ${index + 1}`, state: 'queued' })),
      documents: [],
    };
    this.jobs.set(job.id, job);
    // Sigue solo: el pedido ya respondió (el contexto de la demo viaja con la promesa)
    this.run(job, photos, userId, photos.length === 1 ? manualTotal : undefined).catch((err) => {
      job.status = 'error';
      job.error = err?.message || 'No se pudieron leer las boletas';
      job.finishedAt = Date.now();
    });
    return this.view(job);
  }

  get(id: string, userId?: string) {
    const job = this.jobs.get(id);
    if (!job || job.owner !== this.ownerKey(userId)) throw new NotFoundException('Esa lectura ya no está. Volvé a subir las fotos.');
    return this.view(job);
  }

  /** La última lectura de este usuario (para volver a verla si se fue de la pantalla) */
  latest(userId?: string) {
    const key = this.ownerKey(userId);
    const mine = [...this.jobs.values()].filter((j) => j.owner === key).sort((a, b) => b.createdAt - a.createdAt);
    return mine[0] ? this.view(mine[0]) : null;
  }

  private view(job: Job) {
    const done = job.photos.filter((p) => p.state === 'done' || p.state === 'failed').length;
    return {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      finishedAt: job.finishedAt || null,
      total: job.photos.length,
      done,
      photos: job.photos,
      documents: job.documents,
      error: job.error || null,
      limitMessage: job.limitMessage || null,
      left: job.left ?? null,
    };
  }

  private cleanup() {
    const now = Date.now();
    for (const [id, j] of this.jobs) if (now - j.createdAt > KEEP_MS) this.jobs.delete(id);
  }

  private async run(job: Job, files: Express.Multer.File[], userId?: string, manualTotal?: number) {
    const reads: any[] = new Array(files.length).fill(null);
    // Lo aprendido de los proveedores de este comercio entra en cada lectura
    const supplierCuits = await this.purchases.supplierCuits().catch(() => [] as string[]);
    let next = 0;
    let stop = false;
    const worker = async () => {
      while (!stop && next < files.length) {
        const i = next++;
        const photo = job.photos[i];
        photo.state = 'reading';
        photo.startedAt = Date.now();
        try {
          // QR de ARCA sobre la foto original (achicada, el QR chico de la esquina no se lee): su importe es el
          // total exacto de la factura aunque el impreso esté tapado, y trae CUIT, número, fecha y tipo
          const qr = await readArcaQr(files[i].buffer);
          const [image] = await this.ai.shrink([files[i]], 2000);
          // La foto ya no hace falta en memoria
          (files[i] as any).buffer = null;
          const anchor = manualTotal ?? (qr && qrTotalPesos(qr) > 0 ? qrTotalPesos(qr) : null);
          // Una hoja larga con relecturas puede pasar los 2 minutos; si la conexión se corta, se reintenta una vez
          const pageBody = { stage: 'page', image, index: i, manualTotal: anchor, supplierCuits, qr };
          const { result, left } = await this.ai.call('invoice', pageBody, { timeoutMs: 290_000 })
            .catch((err) => {
              if (!(err instanceof ServiceUnavailableException)) throw err;
              return this.ai.call('invoice', pageBody, { timeoutMs: 290_000 });
            });
          if (typeof left === 'number') job.left = left;
          const read = result?.read;
          if (!read) throw new Error('La nube de Ventra todavía no tiene esta versión. Probá en un rato.');
          reads[i] = read;
          if (read.error || !(read.items || []).length) {
            photo.state = 'failed';
            photo.error = read.unreadable ? `${read.error}. Sacala de nuevo, de frente y con buena luz.` : 'No se encontraron productos en esta foto.';
          } else {
            photo.state = 'done';
            photo.found = {
              supplierName: read.supplierName || '',
              invoiceNumber: read.invoiceNumber || '',
              pageNumber: Number(read.pageNumber) || 0,
              pageCount: Number(read.pageCount) || 0,
              items: (read.items || []).filter((it: any) => !(String(it.total || '').trim().startsWith('-'))).length,
              issue: read.photoIssue || undefined,
            };
          }
        } catch (err: any) {
          photo.state = 'failed';
          photo.error = err?.message || 'No se pudo leer esta foto';
          // Tope del mes o del día: no tiene sentido seguir pidiendo
          if (err instanceof HttpException && err.getStatus() === 429) {
            stop = true;
            job.limitMessage = err.message;
          }
        } finally {
          photo.doneAt = Date.now();
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, files.length) }, worker));
    // Las que no llegaron a leerse por el tope
    for (const p of job.photos) if (p.state === 'queued') { p.state = 'failed'; p.error = job.limitMessage || 'No se leyó'; }

    const usable = reads.filter((r) => r && !r.error && (r.items || []).length);
    if (!usable.length) {
      job.status = 'error';
      job.error = job.limitMessage || job.photos.find((p) => p.error)?.error || 'No se pudo leer ninguna foto.';
      job.finishedAt = Date.now();
      return;
    }

    job.status = 'grouping';
    const { result, left } = await this.ai.call('invoice', { stage: 'group', reads: reads.filter(Boolean) });
    if (typeof left === 'number') job.left = left;
    const docs: any[] = (Array.isArray(result?.documents) ? result.documents : []).filter((d: any) => d?.items?.length);
    for (const d of docs) {
      try {
        const saved = await this.purchases.saveScannedDocument(d, userId);
        job.documents.push({
          purchaseId: saved.purchaseId || null,
          status: saved.status,
          supplierName: saved.matchedSupplier?.name || saved.supplierName || '',
          invoiceNumber: saved.invoiceNumber || '',
          docType: saved.docType || 'factura',
          images: Array.isArray(d.images) ? d.images : [],
          items: (saved.items || []).length,
          ok: saved.check ? !!saved.check.ok : null,
          message: saved.check?.message || '',
          why: saved.why || [],
        });
      } catch (err: any) {
        job.documents.push({
          purchaseId: null, status: 'ERROR', supplierName: d.supplierName || '', invoiceNumber: d.invoiceNumber || '', docType: d.docType || 'factura',
          images: Array.isArray(d.images) ? d.images : [], items: (d.items || []).length, ok: null, message: err?.message || 'No se pudo guardar', why: [],
        });
      }
    }
    job.status = 'done';
    job.finishedAt = Date.now();
    const saved = job.documents.filter((d) => d.status === 'PENDING').length;
    if (saved) {
      await this.purchases.notify('Boletas leídas',
        `${saved === 1 ? 'Una boleta quedó' : `${saved} boletas quedaron`} en Compras → Por revisar: ${job.documents.filter((d) => d.status === 'PENDING').map((d) => d.supplierName || 'Proveedor').join(', ')}.`);
    }
  }
}
