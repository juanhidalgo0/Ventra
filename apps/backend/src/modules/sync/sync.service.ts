import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { PrismaService } from '../../database/prisma.service';
import { SubscriptionService } from '../subscription/subscription.service';

/**
 * Réplica de la base local en la nube (etapa 1).
 *
 * - Triggers de SQLite anotan cada alta/cambio/baja en `sync_outbox`; así no se
 *   escapa ningún cambio, aunque la tabla no tenga fecha de modificación.
 * - Cada pocos segundos, si hay internet, se suben los pendientes en tandas.
 * - Resincronización completa (carga inicial, o si la base cambió por fuera, por
 *   ejemplo al restaurar un backup): se detecta con una "marca de agua" que se
 *   guarda en la base y en un archivo aparte; si no coinciden, se resube todo.
 * - Las fotos embebidas (data:...) viajan aparte a Storage; en la nube la fila
 *   guarda solo una referencia.
 * - Solo funciona en PCs vinculadas a una cuenta de Ventra.
 */

// VENTRA_FUNCTIONS_URL permite apuntar a una nube de pruebas
const FUNCTIONS_URL = process.env.VENTRA_FUNCTIONS_URL || 'https://us-central1-ventra-9cba5.cloudfunctions.net';
const CYCLE_MS = 5000;
const OUTBOX_BATCH = 1000;
const PAGE = 500;
const MAX_BATCH_BYTES = 1_500_000;
const IMAGES_PER_CYCLE = 100;
const IMAGE_CONCURRENCY = 5;
const IMG_PREFIX = 'ventra-img:';
/** Tablas que no son datos del comercio. */
const EXCLUDED = new Set(['app_licenses', 'image_suggestions', 'sync_outbox', 'sync_state', 'sync_images', '_prisma_migrations']);

type SyncPhase = 'disabled' | 'idle' | 'syncing' | 'full' | 'restoring' | 'offline' | 'error';
interface CloudRow { t: string; id: string; d?: any; x?: boolean }

export interface SyncStatus {
  enabled: boolean;
  phase: SyncPhase;
  pending: number;
  pendingImages: number;
  lastSyncAt: string | null;
  lastError: string | null;
  progress: { label: string; done: number; total: number } | null;
}

@Injectable()
export class SyncService implements OnModuleInit, OnModuleDestroy {
  private readonly stateFile = path.join(process.cwd(), 'ventra-sync.json');
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private phase: SyncPhase = 'disabled';
  private lastSyncAt: string | null = null;
  private lastError: string | null = null;
  private progress: SyncStatus['progress'] = null;
  private tableCols = new Map<string, string[]>();
  private installedFor: string | null = null;

  constructor(private prisma: PrismaService, private subscription: SubscriptionService) {}

  onModuleInit() {
    this.timer = setInterval(() => this.cycle().catch(() => {}), CYCLE_MS);
    setTimeout(() => this.cycle().catch(() => {}), 3000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private get endpoint() {
    return `${FUNCTIONS_URL}/ventraSync`;
  }

  // ── Llamadas a la nube ────────────────────────────────────────────
  private async call(action: string, body: Record<string, any> = {}) {
    const creds = this.subscription.getDeviceCredentials();
    if (!creds) throw new Error('PC sin vincular');
    const { data } = await axios.post(this.endpoint, { ...creds, action, ...body }, { timeout: 90000, maxBodyLength: 20_000_000 });
    if (data && data.ok === false) throw new Error(data.error || 'La nube rechazó la operación');
    return data;
  }

  // ── Estado local (tablas propias + archivo de marca de agua) ─────
  private async ensureLocalTables() {
    await this.prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS sync_outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, row_id TEXT NOT NULL, op TEXT NOT NULL)`);
    await this.prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT)`);
    await this.prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS sync_images (product_id TEXT PRIMARY KEY, hash TEXT NOT NULL, uploaded INTEGER NOT NULL DEFAULT 0)`);
  }

  private async getState(key: string): Promise<string | null> {
    const rows: any[] = await this.prisma.$queryRawUnsafe(`SELECT value FROM sync_state WHERE key = ?`, key);
    return rows[0]?.value ?? null;
  }

  private async setState(key: string, value: string) {
    await this.prisma.$executeRawUnsafe(`INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value);
  }

  private readFile(): { deviceId?: string; watermark?: string; lastSyncAt?: string } {
    try { return JSON.parse(fs.readFileSync(this.stateFile, 'utf8')); } catch { return {}; }
  }

  private writeFile(data: { deviceId: string; watermark: string; lastSyncAt: string }) {
    try { fs.writeFileSync(this.stateFile, JSON.stringify(data, null, 2)); } catch {}
  }

  /** Nueva marca de agua: primero en la base, después en el archivo. Si algo se corta en el medio, la próxima vez no coinciden y se resube todo (seguro). */
  private async bumpWatermark(deviceId: string) {
    const wm = crypto.randomUUID();
    await this.setState('watermark', wm);
    this.lastSyncAt = new Date().toISOString();
    this.writeFile({ deviceId, watermark: wm, lastSyncAt: this.lastSyncAt });
  }

  // ── Tablas y triggers ─────────────────────────────────────────────
  private async syncedTables(): Promise<string[]> {
    const rows: any[] = await this.prisma.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`);
    const tables: string[] = [];
    for (const { name } of rows) {
      if (EXCLUDED.has(name) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
      const cols = await this.columns(name, true);
      if (cols.includes('id')) tables.push(name);
    }
    return tables.sort();
  }

  private async columns(table: string, refresh = false): Promise<string[]> {
    if (!refresh && this.tableCols.has(table)) return this.tableCols.get(table)!;
    const info: any[] = await this.prisma.$queryRawUnsafe(`PRAGMA table_info("${table}")`);
    const cols = info.map((c) => String(c.name)).filter((c) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(c));
    this.tableCols.set(table, cols);
    return cols;
  }

  /** Instala los triggers si falta alguno. Devuelve true si tuvo que instalar (=> hace falta resubir todo). */
  private async ensureTriggers(tables: string[]): Promise<boolean> {
    const existing: any[] = await this.prisma.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'ventra_sync_%'`);
    const have = new Set(existing.map((r) => r.name));
    let installed = false;
    for (const t of tables) {
      const defs: [string, string][] = [
        [`ventra_sync_ins_${t}`, `AFTER INSERT ON "${t}" BEGIN INSERT INTO sync_outbox (tbl, row_id, op) VALUES ('${t}', NEW.id, 'U'); END`],
        [`ventra_sync_upd_${t}`, `AFTER UPDATE ON "${t}" BEGIN INSERT INTO sync_outbox (tbl, row_id, op) VALUES ('${t}', NEW.id, 'U'); END`],
        [`ventra_sync_del_${t}`, `AFTER DELETE ON "${t}" BEGIN INSERT INTO sync_outbox (tbl, row_id, op) VALUES ('${t}', OLD.id, 'D'); END`],
      ];
      for (const [name, body] of defs) {
        if (have.has(name)) continue;
        await this.prisma.$executeRawUnsafe(`CREATE TRIGGER IF NOT EXISTS "${name}" ${body}`);
        installed = true;
      }
    }
    return installed;
  }

  private async dropTriggers() {
    const hasOutbox: any[] = await this.prisma.$queryRawUnsafe(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_outbox'`);
    if (!hasOutbox.length) return;
    const existing: any[] = await this.prisma.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'ventra_sync_%'`);
    for (const { name } of existing) await this.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${name}"`);
    await this.prisma.$executeRawUnsafe(`DELETE FROM sync_outbox`);
  }

  // ── Lectura de filas con sus valores exactos de SQLite ───────────
  /** json_object con los valores tal cual los guarda SQLite (enteros, texto, reales). Se parte en grupos por el límite de argumentos. */
  private async jsonExpr(table: string): Promise<string> {
    const cols = (await this.columns(table)).filter((c) => !(table === 'products' && c === 'image_url'));
    const parts: string[] = [];
    for (let i = 0; i < cols.length; i += 40) {
      // Los REAL van con 17 dígitos: json_object los redondea a 15 y la réplica dejaría de ser exacta
      parts.push(`json_object(${cols.slice(i, i + 40).map((c) =>
        `'${c}', CASE WHEN typeof("${c}") = 'real' THEN json(printf('%!.17g', "${c}")) ELSE "${c}" END`).join(', ')})`);
    }
    return parts.reduce((acc, p) => (acc ? `json_patch(${acc}, ${p})` : p), '');
  }

  private async readRows(table: string, where: string, params: any[]): Promise<{ id: string; data: any; image?: string | null }[]> {
    const isProducts = table === 'products' && (await this.columns(table)).includes('image_url');
    const imgSel = isProducts ? `, image_url AS img` : '';
    const rows: any[] = await this.prisma.$queryRawUnsafe(`SELECT id, ${await this.jsonExpr(table)} AS j${imgSel} FROM "${table}" ${where}`, ...params);
    return rows.map((r) => {
      const data = JSON.parse(r.j);
      let image: string | null | undefined;
      if (isProducts) {
        const img: string | null = r.img ?? null;
        if (img && img.startsWith('data:')) {
          const hash = crypto.createHash('sha1').update(img).digest('hex');
          data.image_url = IMG_PREFIX + hash;
          image = img;
        } else {
          data.image_url = img;
        }
      }
      return { id: String(r.id), data, image };
    });
  }

  /** Registra fotos embebidas nuevas o cambiadas para subirlas aparte. */
  private async trackImages(rows: { id: string; data: any; image?: string | null }[]) {
    for (const r of rows) {
      if (!r.image) continue;
      const hash = String(r.data.image_url).slice(IMG_PREFIX.length);
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO sync_images (product_id, hash, uploaded) VALUES (?, ?, 0)
         ON CONFLICT(product_id) DO UPDATE SET uploaded = CASE WHEN sync_images.hash = excluded.hash THEN sync_images.uploaded ELSE 0 END, hash = excluded.hash`,
        r.id, hash);
    }
  }

  private async pushRows(rows: CloudRow[]) {
    let batch: CloudRow[] = [];
    let bytes = 0;
    const flush = async () => {
      if (!batch.length) return;
      await this.call('push', { rows: batch });
      batch = []; bytes = 0;
    };
    for (const r of rows) {
      const size = JSON.stringify(r).length;
      if (batch.length >= OUTBOX_BATCH || (bytes + size > MAX_BATCH_BYTES && batch.length)) await flush();
      batch.push(r); bytes += size;
    }
    await flush();
  }

  // ── Ciclos ────────────────────────────────────────────────────────
  async cycle() {
    if (this.running) return;
    const creds = this.subscription.getDeviceCredentials();
    if (!creds) {
      // Sin vincular: no se anota nada (limpia triggers de una vinculación anterior)
      if (this.installedFor !== 'none') {
        await this.dropTriggers().catch(() => {});
        this.installedFor = 'none';
      }
      this.phase = 'disabled';
      return;
    }
    this.running = true;
    try {
      await this.ensureLocalTables();
      const tables = await this.syncedTables();
      const installedNow = await this.ensureTriggers(tables);
      this.installedFor = creds.deviceId;

      const file = this.readFile();
      const dbWm = await this.getState('watermark');
      this.lastSyncAt = file.lastSyncAt || this.lastSyncAt;
      const needsFull = installedNow || file.deviceId !== creds.deviceId || !dbWm || dbWm !== file.watermark
        || (await this.getState('full_needed')) === '1';

      if (needsFull) await this.runFull(tables, creds.deviceId);
      else await this.runIncremental(creds.deviceId);
      await this.uploadImages();

      this.phase = 'idle';
      this.lastError = null;
    } catch (err: any) {
      const offline = !err.response && (err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT' || err.code === 'ECONNABORTED' || err.code === 'EAI_AGAIN');
      this.phase = offline ? 'offline' : 'error';
      this.lastError = offline ? 'Sin conexión: los cambios se suben cuando vuelva internet' : (err.response?.data?.error || err.message);
      if (!offline) console.warn('[Sync] Error:', this.lastError);
    } finally {
      this.progress = null;
      this.running = false;
    }
  }

  private async runFull(tables: string[], deviceId: string) {
    this.phase = 'full';
    await this.setState('full_needed', '1');
    const maxSeqRows: any[] = await this.prisma.$queryRawUnsafe(`SELECT COALESCE(MAX(seq), 0) AS m FROM sync_outbox`);
    const maxSeq = Number(maxSeqRows[0].m);

    let total = 0;
    for (const t of tables) {
      const c: any[] = await this.prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM "${t}"`);
      total += Number(c[0].n);
    }
    this.progress = { label: 'Subiendo tus datos a la nube', done: 0, total };

    const { gen } = await this.call('beginFull');
    for (const t of tables) {
      let lastId = '';
      for (;;) {
        const rows = await this.readRows(t, `WHERE id > ? ORDER BY id LIMIT ${PAGE}`, [lastId]);
        if (!rows.length) break;
        await this.trackImages(rows);
        await this.pushRows(rows.map((r) => ({ t, id: r.id, d: r.data })));
        lastId = rows[rows.length - 1].id;
        this.progress.done += rows.length;
        if (rows.length < PAGE) break;
      }
    }
    await this.call('endFull', { gen });

    await this.prisma.$executeRawUnsafe(`DELETE FROM sync_outbox WHERE seq <= ?`, maxSeq);
    await this.setState('full_needed', '0');
    await this.bumpWatermark(deviceId);
    console.log(`[Sync] Resincronización completa: ${total} filas`);
  }

  private async runIncremental(deviceId: string) {
    const entries: any[] = await this.prisma.$queryRawUnsafe(`SELECT seq, tbl, row_id, op FROM sync_outbox ORDER BY seq LIMIT ${OUTBOX_BATCH}`);
    if (!entries.length) return;
    this.phase = 'syncing';
    const maxSeq = Number(entries[entries.length - 1].seq);

    // Una sola vez por fila: vale el estado actual de la base
    const byTable = new Map<string, Set<string>>();
    for (const e of entries) {
      if (!byTable.has(e.tbl)) byTable.set(e.tbl, new Set());
      byTable.get(e.tbl)!.add(String(e.row_id));
    }
    const out: CloudRow[] = [];
    const tables = await this.syncedTables();
    for (const [t, idSet] of byTable) {
      const ids = [...idSet];
      const exists = tables.includes(t);
      const found = new Map<string, any>();
      if (exists) {
        for (let i = 0; i < ids.length; i += 400) {
          const chunk = ids.slice(i, i + 400);
          const rows = await this.readRows(t, `WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk);
          await this.trackImages(rows);
          rows.forEach((r) => found.set(r.id, r.data));
        }
      }
      for (const id of ids) out.push(found.has(id) ? { t, id, d: found.get(id) } : { t, id, x: true });
    }
    await this.pushRows(out);
    await this.prisma.$executeRawUnsafe(`DELETE FROM sync_outbox WHERE seq <= ?`, maxSeq);
    await this.bumpWatermark(deviceId);
  }

  private async uploadImages() {
    const pending: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT si.product_id, si.hash, p.image_url FROM sync_images si JOIN products p ON p.id = si.product_id WHERE si.uploaded = 0 LIMIT ${IMAGES_PER_CYCLE}`);
    const uploadOne = async (row: any) => {
      const img: string | null = row.image_url;
      if (!img || !img.startsWith('data:')) {
        await this.prisma.$executeRawUnsafe(`DELETE FROM sync_images WHERE product_id = ?`, row.product_id);
        return;
      }
      try {
        await this.call('putImage', { productId: row.product_id, dataUrl: img });
        await this.prisma.$executeRawUnsafe(`UPDATE sync_images SET uploaded = 1 WHERE product_id = ? AND hash = ?`, row.product_id, row.hash);
      } catch (err: any) {
        if (err.response?.status === 413 || err.response?.status === 400) {
          // Foto inválida o enorme: no se reintenta para no trabar la cola
          await this.prisma.$executeRawUnsafe(`UPDATE sync_images SET uploaded = 1 WHERE product_id = ?`, row.product_id);
        } else throw err;
      }
    };
    for (let i = 0; i < pending.length; i += IMAGE_CONCURRENCY) {
      await Promise.all(pending.slice(i, i + IMAGE_CONCURRENCY).map(uploadOne));
    }
  }

  /** Orden de borrado: cada tabla antes que las tablas a las que referencia. */
  private async deleteOrder(tables: string[]): Promise<string[]> {
    const parents = new Map<string, Set<string>>();
    for (const t of tables) {
      const fks: any[] = await this.prisma.$queryRawUnsafe(`PRAGMA foreign_key_list("${t}")`);
      parents.set(t, new Set(fks.map((f) => String(f.table)).filter((p) => p !== t && tables.includes(p))));
    }
    const order: string[] = [];
    const visiting = new Set<string>();
    const done = new Set<string>();
    // Recorre de hijos hacia padres: una tabla sale después de todas las que la referencian
    const children = (t: string) => tables.filter((c) => parents.get(c)!.has(t));
    const visit = (t: string) => {
      if (done.has(t) || visiting.has(t)) return;
      visiting.add(t);
      children(t).forEach(visit);
      visiting.delete(t);
      done.add(t);
      order.push(t);
    };
    tables.forEach(visit);
    return order;
  }

  // ── Recuperar desde la nube ───────────────────────────────────────
  /** Reemplaza la base local por la copia de la nube. Antes guarda un backup de seguridad. */
  async restoreFromCloud(): Promise<{ rows: number; images: number; backup: string }> {
    const creds = this.subscription.getDeviceCredentials();
    if (!creds) throw new Error('Vinculá esta PC a tu cuenta antes de recuperar datos');
    if (this.running) throw new Error('Hay una sincronización en curso. Probá de nuevo en unos segundos.');
    this.running = true;
    this.phase = 'restoring';
    try {
      await this.ensureLocalTables();

      // 1. Bajar todo
      this.progress = { label: 'Descargando tus datos', done: 0, total: 0 };
      const byTable = new Map<string, any[]>();
      let after: any = null;
      let count = 0;
      do {
        const page = await this.call('pull', { after });
        for (const r of page.rows as CloudRow[]) {
          if (!byTable.has(r.t)) byTable.set(r.t, []);
          byTable.get(r.t)!.push(r.d);
        }
        count += page.rows.length;
        this.progress.done = count;
        after = page.next;
      } while (after);
      if (!count) throw new Error('No hay datos tuyos en la nube todavía');

      // 2. Fotos
      const products = byTable.get('products') || [];
      const withImage = products.filter((p) => typeof p.image_url === 'string' && p.image_url.startsWith(IMG_PREFIX));
      this.progress = { label: 'Descargando fotos de productos', done: 0, total: withImage.length };
      let images = 0;
      for (let i = 0; i < withImage.length; i += 8) {
        await Promise.all(withImage.slice(i, i + 8).map(async (p) => {
          try {
            const { dataUrl } = await this.call('getImage', { productId: p.id });
            p.image_url = dataUrl;
            images++;
          } catch {
            p.image_url = null;
          }
          this.progress!.done++;
        }));
      }

      // 3. Backup de seguridad de lo que hay ahora
      const backupDir = path.join(process.cwd(), 'backups');
      fs.mkdirSync(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
      const backup = path.join(backupDir, `backup_safety_${stamp}.db`);
      await this.prisma.$executeRawUnsafe(`VACUUM INTO '${backup.split(path.sep).join('/').replace(/'/g, "''")}'`);

      // 4. Reemplazar en una sola transacción (todo o nada)
      this.progress = { label: 'Guardando en esta PC', done: 0, total: count };
      const localTables = await this.syncedTables();
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`PRAGMA defer_foreign_keys = ON`);
        // Primero las tablas hijas: un ON DELETE RESTRICT se controla al instante
        for (const t of await this.deleteOrder(localTables)) await tx.$executeRawUnsafe(`DELETE FROM "${t}"`);
        for (const [t, rows] of byTable) {
          if (!localTables.includes(t)) continue;
          const cols = await this.columns(t, true);
          const present = cols.filter((c) => rows.some((r) => r && Object.prototype.hasOwnProperty.call(r, c)));
          if (!present.includes('id')) continue;
          const select = present.map((c) => `json_extract(value, '$.${c}')`).join(', ');
          for (let i = 0; i < rows.length; i += 400) {
            const chunk = rows.slice(i, i + 400);
            await tx.$executeRawUnsafe(
              `INSERT INTO "${t}" (${present.map((c) => `"${c}"`).join(', ')}) SELECT ${select} FROM json_each(?)`,
              JSON.stringify(chunk));
            this.progress!.done += chunk.length;
          }
        }
        // La nube ya es igual a esta PC: nada pendiente para subir
        await tx.$executeRawUnsafe(`DELETE FROM sync_outbox`);
        await tx.$executeRawUnsafe(`DELETE FROM sync_images`);
      }, { timeout: 10 * 60 * 1000, maxWait: 30000 });

      // Las fotos recuperadas ya están en la nube con el mismo contenido
      for (const p of withImage) {
        if (typeof p.image_url === 'string' && p.image_url.startsWith('data:')) {
          const hash = crypto.createHash('sha1').update(p.image_url).digest('hex');
          await this.prisma.$executeRawUnsafe(`INSERT OR REPLACE INTO sync_images (product_id, hash, uploaded) VALUES (?, ?, 1)`, p.id, hash);
        }
      }
      await this.setState('full_needed', '0');
      await this.bumpWatermark(creds.deviceId);
      console.log(`[Sync] Recuperación desde la nube: ${count} filas, ${images} fotos`);
      return { rows: count, images, backup: path.basename(backup) };
    } finally {
      this.progress = null;
      this.phase = 'idle';
      this.running = false;
    }
  }

  async getStatus(): Promise<SyncStatus> {
    const enabled = !!this.subscription.getDeviceCredentials();
    let pending = 0;
    let pendingImages = 0;
    if (enabled) {
      try {
        const a: any[] = await this.prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM sync_outbox`);
        const b: any[] = await this.prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM sync_images WHERE uploaded = 0`);
        pending = Number(a[0].n);
        pendingImages = Number(b[0].n);
      } catch {}
    }
    return {
      enabled,
      phase: enabled ? this.phase : 'disabled',
      pending,
      pendingImages,
      lastSyncAt: this.lastSyncAt || this.readFile().lastSyncAt || null,
      lastError: this.lastError,
      progress: this.progress,
    };
  }

  /** Fuerza un ciclo ya (botón "Sincronizar ahora"). */
  async syncNow() {
    await this.cycle();
    return this.getStatus();
  }
}
