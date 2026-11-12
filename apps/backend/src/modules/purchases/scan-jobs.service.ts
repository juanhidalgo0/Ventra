import { BadRequestException, HttpException, Injectable, NotFoundException, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
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

export type PhotoState = 'queued' | 'reading' | 'done' | 'failed' | 'waiting';
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
  status: 'reading' | 'grouping' | 'done' | 'error' | 'waiting';
  photos: Photo[];
  documents: ScanJobDoc[];
  error?: string;
  /** Tope de la IA alcanzado a mitad de camino: se guarda lo que se leyó */
  limitMessage?: string;
  left?: number;
  // ─── Internos (no van a la pantalla): para seguir sin internet (tanda 6.4) ───
  reads?: any[];
  /** Fotos ya achicadas que esperan conexión, por número de foto */
  waiting?: Record<number, { image: any; qr: any }>;
  userId?: string;
  manualTotal?: number;
  supplierCuits?: string[];
}

const CONCURRENCY = 3;
const KEEP_MS = 6 * 3600e3;
/** Sin internet: las fotos quedan en espera en disco (sobreviven a reiniciar la PC) y se reintenta cada minuto */
const QUEUE_DIR = path.join(process.cwd(), 'ventra-scan-queue');
const RETRY_MS = 60_000;
const KEEP_WAITING_MS = 7 * 24 * 3600e3;
const MAX_PHOTOS = 60;

@Injectable()
export class ScanJobsService implements OnModuleInit {
  private jobs = new Map<string, Job>();
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(private ai: AiService, private purchases: PurchasesService) {}

  /** Al arrancar: las lecturas que quedaron esperando internet siguen solas */
  onModuleInit() {
    try {
      if (!fs.existsSync(QUEUE_DIR)) return;
      for (const f of fs.readdirSync(QUEUE_DIR).filter((x) => x.endsWith('.json'))) {
        try {
          const job: Job = JSON.parse(fs.readFileSync(path.join(QUEUE_DIR, f), 'utf8'));
          if (Date.now() - job.createdAt > KEEP_WAITING_MS) { fs.unlinkSync(path.join(QUEUE_DIR, f)); continue; }
          this.jobs.set(job.id, job);
        } catch { /* archivo dañado: se ignora */ }
      }
      if ([...this.jobs.values()].some((j) => j.status === 'waiting')) this.scheduleRetry();
    } catch { /* sin disco: solo en memoria */ }
  }

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
    // Una lectura que espera internet tiene prioridad: que no quede tapada por otra más nueva
    const waiting = mine.find((j) => j.status === 'waiting');
    if (waiting) return this.view(waiting);
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
      // Sin internet: cuántas fotos esperan y el aviso para la pantalla
      waiting: job.photos.filter((p) => p.state === 'waiting').length,
    };
  }

  private cleanup() {
    const now = Date.now();
    for (const [id, j] of this.jobs) if (j.status !== 'waiting' && now - j.createdAt > KEEP_MS) this.jobs.delete(id);
  }

  private async run(job: Job, files: Express.Multer.File[], userId?: string, manualTotal?: number) {
    job.reads = new Array(files.length).fill(null);
    job.waiting = {};
    job.userId = userId;
    job.manualTotal = manualTotal;
    // Lo aprendido de los proveedores de este comercio entra en cada lectura
    job.supplierCuits = await this.purchases.supplierCuits().catch(() => [] as string[]);
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
          await this.readPhoto(job, i, image, qr);
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
    await this.afterReading(job);
  }

  /**
   * Una foto ya achicada → su lectura en la nube. Sin internet (la nube no responde dos veces) la foto
   * queda en espera: no es un error, se lee sola cuando vuelve la conexión (tanda 6.4).
   */
  private async readPhoto(job: Job, i: number, image: any, qr: any) {
    const photo = job.photos[i];
    const anchor = job.manualTotal ?? (qr && qrTotalPesos(qr) > 0 ? qrTotalPesos(qr) : null);
    // Una hoja larga con relecturas puede pasar los 2 minutos; si la conexión se corta, se reintenta una vez
    const pageBody = { stage: 'page', image, index: i, manualTotal: anchor, supplierCuits: job.supplierCuits || [], qr };
    let res: any;
    try {
      res = await this.ai.call('invoice', pageBody, { timeoutMs: 290_000 })
        .catch((err) => {
          if (!(err instanceof ServiceUnavailableException)) throw err;
          return this.ai.call('invoice', pageBody, { timeoutMs: 290_000 });
        });
    } catch (err) {
      if (!(err instanceof ServiceUnavailableException)) throw err;
      photo.state = 'waiting';
      photo.error = 'Sin internet: la foto quedó en espera y se lee sola cuando vuelva la conexión';
      job.waiting![i] = { image, qr };
      return;
    }
    delete job.waiting![i];
    const { result, left } = res;
    if (typeof left === 'number') job.left = left;
    const read = result?.read;
    if (!read) throw new Error('La nube de Ventra todavía no tiene esta versión. Probá en un rato.');
    job.reads![i] = read;
    photo.error = undefined;
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
  }

  /** Todas leídas (o en espera): si hay fotos esperando internet, queda guardado; si no, se juntan los comprobantes */
  private async afterReading(job: Job) {
    if (Object.keys(job.waiting || {}).length) {
      job.status = 'waiting';
      this.persist(job);
      this.scheduleRetry();
      return;
    }
    this.unpersist(job);
    const reads = job.reads || [];
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
        const saved = await this.purchases.saveScannedDocument(d, job.userId);
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
    job.reads = undefined;
    const saved = job.documents.filter((d) => d.status === 'PENDING').length;
    if (saved) {
      await this.purchases.notify('Boletas leídas',
        `${saved === 1 ? 'Una boleta quedó' : `${saved} boletas quedaron`} en Compras → Por revisar: ${job.documents.filter((d) => d.status === 'PENDING').map((d) => d.supplierName || 'Proveedor').join(', ')}.`);
    }
  }

  /** Cada minuto, mientras haya fotos esperando internet, se prueba de nuevo */
  private scheduleRetry() {
    if (this.retryTimer) return;
    this.retryTimer = setInterval(() => this.retryWaiting().catch(() => {}), RETRY_MS);
    (this.retryTimer as any).unref?.();
  }

  private retrying = false;
  async retryWaiting() {
    if (this.retrying) return;
    this.retrying = true;
    try {
      const waiting = [...this.jobs.values()].filter((j) => j.status === 'waiting');
      if (!waiting.length && this.retryTimer) { clearInterval(this.retryTimer); this.retryTimer = null; return; }
      for (const job of waiting) {
        job.status = 'reading';
        for (const k of Object.keys(job.waiting || {}).map(Number)) {
          const w = job.waiting![k];
          job.photos[k].state = 'reading';
          try {
            await this.readPhoto(job, k, w.image, w.qr);
          } catch (err: any) {
            job.photos[k].state = 'failed';
            job.photos[k].error = err?.message || 'No se pudo leer esta foto';
            delete job.waiting![k];
          }
          // Sigue sin internet: no tiene sentido probar las demás ahora
          if ((job.photos[k].state as PhotoState) === 'waiting') break;
        }
        await this.afterReading(job);
      }
    } finally {
      this.retrying = false;
    }
  }

  private persist(job: Job) {
    try {
      fs.mkdirSync(QUEUE_DIR, { recursive: true });
      fs.writeFileSync(path.join(QUEUE_DIR, `${job.id}.json`), JSON.stringify(job));
    } catch { /* sin disco: queda en memoria */ }
  }

  private unpersist(job: Job) {
    try { fs.unlinkSync(path.join(QUEUE_DIR, `${job.id}.json`)); } catch { /* no estaba */ }
  }
}
