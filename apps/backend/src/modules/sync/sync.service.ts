import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { PrismaService } from '../../database/prisma.service';
import { SubscriptionService } from '../subscription/subscription.service';

/**
 * Sincronización de esta caja con la nube, en los dos sentidos.
 *
 * Todas las cajas de un comercio (PCs del local y la caja en la nube) suben sus
 * cambios y bajan los de las demás. Reglas:
 *
 * - Cada alta/cambio/baja queda anotada por triggers de SQLite en `sync_outbox`
 *   con la hora en que ocurrió. En la nube gana el cambio más reciente.
 * - Contadores (stock, saldo de clientes, vendidos de promos) NO viajan como
 *   número: cada cambio se anota como diferencia (+x / −x) en `sync_deltas` y las
 *   otras cajas la suman. Dos cajas vendiendo lo mismo sin internet no se pisan.
 * - Lo que se baja de la nube se aplica con la marca `applying`, así los triggers
 *   no lo vuelven a subir.
 * - Arranque: la primera caja del comercio sube todo (y el saldo inicial de los
 *   contadores); una caja nueva baja todo de la nube; si la base cambió por fuera
 *   (backup restaurado) se completa lo que falte y se realinea con la nube.
 * - Fotos embebidas (data:...) viajan aparte a Storage.
 * - Solo funciona en cajas vinculadas a una cuenta de Ventra.
 */

// VENTRA_FUNCTIONS_URL permite apuntar a una nube de pruebas
const FUNCTIONS_URL = process.env.VENTRA_FUNCTIONS_URL || 'https://us-central1-ventra-9cba5.cloudfunctions.net';
const CYCLE_MS = 5000;
/**
 * Cada ciclo sube lo propio al instante, pero solo le pregunta a la nube por cambios de
 * otras cajas cuando toca: cada 5 s mientras hay movimiento y, en reposo, cada vez más
 * espaciado hasta 1 minuto. Cada consulta es una llamada a la función y despierta Neon.
 */
const PULL_IDLE_MAX_MS = 60_000;
/** Si la nube responde con error, no se reintenta cada 5 s para siempre: se espacia hasta 5 min. */
const ERROR_RETRY_MAX_MS = 5 * 60_000;
const OUTBOX_BATCH = 1000;
const PAGE = 500;
const MAX_BATCH_BYTES = 1_500_000;
const IMAGES_PER_CYCLE = 100;
const IMAGE_CONCURRENCY = 5;
const IMG_PREFIX = 'ventra-img:';
const TRIGGER_PREFIX = 'ventra_sync2_';
/** Tablas que no son datos del comercio. */
const EXCLUDED = new Set(['app_licenses', 'image_suggestions', 'sync_outbox', 'sync_state', 'sync_images', 'sync_deltas', 'sync_stash', 'sync_img_fetch', '_prisma_migrations']);
/** Lo que sobrevive a un reinicio de fábrica (igual que en la nube). */
const KEEP_ON_RESET = new Set(['fiscal_config', 'fiscal_tokens', 'surcharges']);
/** Columnas que varias cajas modifican sumando/restando. */
const COUNTERS: Record<string, string[]> = { products: ['stock'], clients: ['balance'], promotions: ['sold_stock'] };
const NOW_MS = `CAST(ROUND((julianday('now') - 2440587.5) * 86400000) AS INTEGER)`;
const NOT_APPLYING = `(SELECT value FROM sync_state WHERE key = 'applying') IS NOT '1'`;
// Ojo: Prisma lee las columnas INTEGER de SQLite como enteros de 32 bits. Las horas
// en milisegundos no entran: siempre se leen con CAST(... AS REAL) (exacto hasta 2^53).

type SyncPhase = 'disabled' | 'idle' | 'syncing' | 'full' | 'restoring' | 'offline' | 'error' | 'waiting';
interface CloudRow { t: string; id: string; d?: any; x?: boolean; ts?: number }
type Tx = Pick<PrismaService, '$queryRawUnsafe' | '$executeRawUnsafe'>;

export interface SyncStatus {
  enabled: boolean;
  phase: SyncPhase;
  pending: number;
  pendingImages: number;
  /** Fotos que faltan subir a la nube / bajar de la nube */
  imagesUp: number;
  imagesDown: number;
  imagesTotal: number;
  lastSyncAt: string | null;
  lastError: string | null;
  progress: { label: string; done: number; total: number } | null;
  nodeIndex: number | null;
}

@Injectable()
export class SyncService implements OnModuleInit, OnModuleDestroy {
  private readonly stateFile = path.join(process.cwd(), 'ventra-sync.json');
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private phase: SyncPhase = 'disabled';
  private lastSyncAt: string | null = null;
  private lastError: string | null = null;
  private pullDelay = CYCLE_MS;
  private nextPullAt = 0;
  private errorDelay = 0;
  private retryAt = 0;
  private progress: SyncStatus['progress'] = null;
  /**
   * true mientras una descarga completa tiene la base tomada en UNA transacción
   * (puede durar minutos en una PC nueva). Mientras tanto no se puede escribir:
   * main.ts responde los cambios con un mensaje claro en vez de dejarlos colgados.
   */
  private writeLock = false;

  /** Lo que se muestra a quien intenta escribir mientras la base está tomada. */
  getWriteLock(): { label: string; done: number; total: number } | null {
    return this.writeLock ? (this.progress || { label: 'Descargando tus datos', done: 0, total: 0 }) : null;
  }
  private tableCols = new Map<string, string[]>();
  private installedFor: string | null = null;
  private registeredFor: string | null = null;
  private nodeIndex: number | null = null;

  constructor(private prisma: PrismaService, private subscription: SubscriptionService) {}

  onModuleInit() {
    this.timer = setInterval(() => this.cycle().catch(() => {}), CYCLE_MS);
    setTimeout(() => this.cycle().catch(() => {}), 3000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  // ── Reinicio de fábrica de la cuenta ──────────────────────────────
  private async knownGen(): Promise<number | null> {
    const g = await this.getState('cloud_gen');
    return g === null ? null : Number(g);
  }

  /** Si la cuenta se reinició desde otra caja, corta el ciclo para vaciar esta base. */
  private async checkGen(gen: any) {
    if (gen === undefined || gen === null) return;
    const known = await this.knownGen();
    if (known === null) { await this.setState('cloud_gen', String(gen)); return; }
    if (Number(gen) > known) throw new AccountResetError(Number(gen));
  }

  /**
   * Reinicio de fábrica desde ESTA caja: borra los datos de la cuenta en la nube (todas
   * las cajas vinculadas se vacían solas en su próxima sincronización) y después esta base.
   * Sin internet no se puede: quedaría esta caja vacía y las demás con los datos.
   */
  async resetAccount(): Promise<void> {
    if (!this.subscription.getDeviceCredentials()) throw new Error('PC sin vincular');
    for (let i = 0; this.running && i < 60; i++) await new Promise((r) => setTimeout(r, 1000));
    this.running = true;
    try {
      const res = await this.call('reset');
      await this.wipeLocal(Number(res.gen));
    } finally {
      this.running = false;
    }
  }

  private async applyAccountReset(gen: number) {
    console.warn(`[Sync] La cuenta se reinició desde otra caja (reinicio #${gen}): vaciando esta base`);
    await this.wipeLocal(gen);
  }

  /** Vacía la base (sin anotar las bajas para subir) y la deja lista para arrancar de cero. */
  private async wipeLocal(gen: number) {
    this.phase = 'full';
    this.progress = { label: 'Borrando los datos de esta caja', done: 0, total: 0 };
    this.writeLock = true;
    this.writeStatusFile();
    try {
      await this.ensureLocalTables();
      const tables = (await this.syncedTables()).filter((t) => !KEEP_ON_RESET.has(t));
      const order = await this.deleteOrder(tables);
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`PRAGMA defer_foreign_keys = ON`);
        await this.setState('applying', '1', tx);
        for (const t of order) await tx.$executeRawUnsafe(`DELETE FROM "${t}"`);
        for (const t of ['sync_outbox', 'sync_deltas', 'sync_images', 'sync_img_fetch', 'sync_stash']) await tx.$executeRawUnsafe(`DELETE FROM ${t}`);
        await tx.$executeRawUnsafe(`DELETE FROM sync_state WHERE key IN ('bootstrap', 'pull_after', 'watermark', 'watermark_prev')`);
        await this.setState('cloud_gen', String(gen), tx);
        await tx.$executeRawUnsafe(`DELETE FROM sync_state WHERE key = 'applying'`);
      }, { timeout: 10 * 60 * 1000, maxWait: 60000 });
      this.registeredFor = null;
      console.warn('[Sync] Base vaciada por reinicio de fábrica de la cuenta');
    } finally {
      this.writeLock = false;
      this.progress = null;
      this.phase = 'idle';
      this.writeStatusFile();
    }
  }

  // ── Nube ──────────────────────────────────────────────────────────
  private async call(action: string, body: Record<string, any> = {}) {
    const creds = this.subscription.getDeviceCredentials();
    if (!creds) throw new Error('PC sin vincular');
    const { data } = await axios.post(`${FUNCTIONS_URL}/ventraSync`, { ...creds, action, ...body }, { timeout: 90000, maxBodyLength: 20_000_000 });
    if (data && data.ok === false) throw new Error(data.error || 'La nube rechazó la operación');
    return data;
  }

  // ── Estado local ──────────────────────────────────────────────────
  private async ensureLocalTables() {
    const ex = (q: string) => this.prisma.$executeRawUnsafe(q);
    await ex(`CREATE TABLE IF NOT EXISTS sync_state (key TEXT PRIMARY KEY, value TEXT)`);
    await ex(`CREATE TABLE IF NOT EXISTS sync_outbox (seq INTEGER PRIMARY KEY AUTOINCREMENT, tbl TEXT NOT NULL, row_id TEXT NOT NULL, op TEXT NOT NULL, ts INTEGER NOT NULL DEFAULT 0)`);
    const outCols: any[] = await this.prisma.$queryRawUnsafe(`PRAGMA table_info(sync_outbox)`);
    if (!outCols.some((c) => c.name === 'ts')) await ex(`ALTER TABLE sync_outbox ADD COLUMN ts INTEGER NOT NULL DEFAULT 0`);
    await ex(`CREATE INDEX IF NOT EXISTS sync_outbox_row ON sync_outbox (tbl, row_id)`);
    await ex(`CREATE TABLE IF NOT EXISTS sync_deltas (id TEXT PRIMARY KEY, tbl TEXT NOT NULL, row_id TEXT NOT NULL, col TEXT NOT NULL, delta REAL NOT NULL, ts INTEGER NOT NULL)`);
    await ex(`CREATE TABLE IF NOT EXISTS sync_stash (id TEXT PRIMARY KEY, tbl TEXT NOT NULL, row_id TEXT NOT NULL, col TEXT NOT NULL, delta REAL NOT NULL)`);
    await ex(`CREATE TABLE IF NOT EXISTS sync_images (product_id TEXT PRIMARY KEY, hash TEXT NOT NULL, uploaded INTEGER NOT NULL DEFAULT 0)`);
    await ex(`CREATE TABLE IF NOT EXISTS sync_img_fetch (product_id TEXT PRIMARY KEY, hash TEXT NOT NULL)`);
  }

  private async getState(key: string, db: Tx = this.prisma): Promise<string | null> {
    const rows: any[] = await db.$queryRawUnsafe(`SELECT value FROM sync_state WHERE key = ?`, key);
    return rows[0]?.value ?? null;
  }

  private async setState(key: string, value: string, db: Tx = this.prisma) {
    await db.$executeRawUnsafe(`INSERT INTO sync_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, key, value);
  }

  /** corrupt: el archivo existe pero no se puede leer (p. ej. lleno de ceros tras un corte de luz). */
  private readFile(): { deviceId?: string; watermark?: string; lastSyncAt?: string; corrupt?: boolean } {
    let text: string;
    try { text = fs.readFileSync(this.stateFile, 'utf8'); } catch { return {}; }
    try { return JSON.parse(text); } catch { return { corrupt: true }; }
  }

  /** Se escribe en un archivo aparte y se renombra: un corte a mitad de camino no deja el archivo roto. */
  private writeFile(deviceId: string, watermark: string) {
    const tmp = `${this.stateFile}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify({ deviceId, watermark, lastSyncAt: this.lastSyncAt }, null, 2));
      fs.renameSync(tmp, this.stateFile);
    } catch (err: any) {
      console.warn('[Sync] No se pudo guardar el archivo de estado:', err.message);
    }
  }

  private lastReport = 0;

  /**
   * Estado de esta caja: en un archivo (lo lee el anfitrión de la nube) y, mientras
   * sube o baja datos, informado a la nube cada pocos segundos (así otra caja que la
   * espera puede mostrar su avance).
   */
  private writeStatusFile() {
    try {
      fs.writeFileSync(path.join(process.cwd(), 'ventra-sync-status.json'), JSON.stringify({
        phase: this.phase, message: this.lastError, progress: this.progress, at: new Date().toISOString(),
      }));
    } catch {}
    const busy = this.phase === 'full' || this.phase === 'syncing' || this.phase === 'restoring';
    if (busy && this.progress && Date.now() - this.lastReport > 4000 && this.subscription.getDeviceCredentials()) {
      this.lastReport = Date.now();
      this.call('report', { status: { phase: this.phase, ...this.progress } }).catch(() => {});
    }
  }

  /** Marca de agua en la base y en un archivo aparte: si no coinciden, la base cambió por fuera. */
  private async bumpWatermark(deviceId: string) {
    const wm = crypto.randomUUID();
    // La marca anterior queda guardada: la base y el archivo se escriben en dos pasos
    // y un corte brusco entre ambos los dejaba en desacuerdo, lo que se interpretaba
    // como "la base cambió por fuera" y disparaba una bajada completa de todo el
    // catálogo. Aceptando tambien la marca previa, un apagón a destiempo ya no cuesta
    // una resincronización entera.
    const anterior = await this.getState('watermark');
    if (anterior) await this.setState('watermark_prev', anterior);
    await this.setState('watermark', wm);
    this.lastSyncAt = new Date().toISOString();
    this.writeFile(deviceId, wm);
  }

  // ── Tablas, columnas y triggers ───────────────────────────────────
  private async syncedTables(): Promise<string[]> {
    const rows: any[] = await this.prisma.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`);
    const tables: string[] = [];
    for (const { name } of rows) {
      if (EXCLUDED.has(name) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
      if ((await this.columns(name, true)).includes('id')) tables.push(name);
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

  private async counterCols(table: string): Promise<string[]> {
    const cols = await this.columns(table);
    return (COUNTERS[table] || []).filter((c) => cols.includes(c));
  }

  /** Instala los triggers que falten. Devuelve true si instaló alguno. */
  private async ensureTriggers(tables: string[]): Promise<boolean> {
    const existing: any[] = await this.prisma.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'ventra_sync%'`);
    // Triggers de la etapa 1 (sin hora ni marca de aplicación): se reemplazan
    for (const { name } of existing.filter((r) => !String(r.name).startsWith(TRIGGER_PREFIX))) {
      await this.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${name}"`);
    }
    const have = new Set(existing.map((r) => r.name));
    let installed = false;
    const create = async (name: string, body: string) => {
      if (have.has(name)) return;
      await this.prisma.$executeRawUnsafe(`CREATE TRIGGER IF NOT EXISTS "${name}" ${body}`);
      installed = true;
    };
    for (const t of tables) {
      await create(`${TRIGGER_PREFIX}ins_${t}`, `AFTER INSERT ON "${t}" WHEN ${NOT_APPLYING} BEGIN INSERT INTO sync_outbox (tbl, row_id, op, ts) VALUES ('${t}', NEW.id, 'U', ${NOW_MS}); END`);
      await create(`${TRIGGER_PREFIX}upd_${t}`, `AFTER UPDATE ON "${t}" WHEN ${NOT_APPLYING} BEGIN INSERT INTO sync_outbox (tbl, row_id, op, ts) VALUES ('${t}', NEW.id, 'U', ${NOW_MS}); END`);
      await create(`${TRIGGER_PREFIX}del_${t}`, `AFTER DELETE ON "${t}" WHEN ${NOT_APPLYING} BEGIN INSERT INTO sync_outbox (tbl, row_id, op, ts) VALUES ('${t}', OLD.id, 'D', ${NOW_MS}); END`);
      for (const c of await this.counterCols(t)) {
        const ins = `INSERT INTO sync_deltas (id, tbl, row_id, col, delta, ts) VALUES (lower(hex(randomblob(16))), '${t}', NEW.id, '${c}'`;
        await create(`${TRIGGER_PREFIX}cnti_${t}_${c}`, `AFTER INSERT ON "${t}" WHEN ${NOT_APPLYING} AND COALESCE(NEW."${c}", 0) <> 0 BEGIN ${ins}, NEW."${c}", ${NOW_MS}); END`);
        await create(`${TRIGGER_PREFIX}cntu_${t}_${c}`, `AFTER UPDATE OF "${c}" ON "${t}" WHEN ${NOT_APPLYING} AND COALESCE(NEW."${c}", 0) <> COALESCE(OLD."${c}", 0) BEGIN ${ins}, COALESCE(NEW."${c}", 0) - COALESCE(OLD."${c}", 0), ${NOW_MS}); END`);
      }
    }
    return installed;
  }

  private async dropTriggers() {
    const hasState: any[] = await this.prisma.$queryRawUnsafe(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sync_outbox'`);
    if (!hasState.length) return;
    const existing: any[] = await this.prisma.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'ventra_sync%'`);
    for (const { name } of existing) await this.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${name}"`);
    await this.prisma.$executeRawUnsafe(`DELETE FROM sync_outbox`);
    await this.prisma.$executeRawUnsafe(`DELETE FROM sync_deltas`);
  }

  // ── Lectura de filas con sus valores exactos ──────────────────────
  /** json_object con los valores tal cual los guarda SQLite; los REAL con 17 dígitos (exactos). */
  private async jsonExpr(table: string): Promise<string> {
    const cols = (await this.columns(table)).filter((c) => !(table === 'products' && c === 'image_url'));
    const parts: string[] = [];
    for (let i = 0; i < cols.length; i += 40) {
      parts.push(`json_object(${cols.slice(i, i + 40).map((c) =>
        `'${c}', CASE WHEN typeof("${c}") = 'real' THEN json(printf('%!.17g', "${c}")) ELSE "${c}" END`).join(', ')})`);
    }
    return parts.reduce((acc, p) => (acc ? `json_patch(${acc}, ${p})` : p), '');
  }

  private async readRows(table: string, where: string, params: any[]): Promise<{ id: string; data: any; image?: string | null }[]> {
    const isProducts = table === 'products' && (await this.columns(table)).includes('image_url');
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT id, ${await this.jsonExpr(table)} AS j${isProducts ? ', image_url AS img' : ''} FROM "${table}" ${where}`, ...params);
    return rows.map((r) => {
      const data = JSON.parse(r.j);
      let image: string | null | undefined;
      if (isProducts) {
        const img: string | null = r.img ?? null;
        if (img && img.startsWith('data:')) {
          data.image_url = IMG_PREFIX + crypto.createHash('sha1').update(img).digest('hex');
          image = img;
        } else data.image_url = img;
      }
      return { id: String(r.id), data, image };
    });
  }

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
      const res = await this.call('push', { rows: batch, gen: await this.knownGen() });
      if (res?.reset) throw new AccountResetError(res.gen);
      batch = []; bytes = 0;
    };
    for (const r of rows) {
      const size = JSON.stringify(r).length;
      if (batch.length >= OUTBOX_BATCH || (bytes + size > MAX_BATCH_BYTES && batch.length)) await flush();
      batch.push(r); bytes += size;
    }
    await flush();
  }

  /** Sube todas las filas de la base (arranque o para completar lo que falte en la nube). */
  private async pushAll(tables: string[], ts: number, label: string) {
    let total = 0;
    for (const t of tables) {
      const c: any[] = await this.prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM "${t}"`);
      total += Number(c[0].n);
    }
    this.progress = { label, done: 0, total };
    for (const t of await this.parentFirst(tables)) {
      let lastId = '';
      for (;;) {
        const rows = await this.readRows(t, `WHERE id > ? ORDER BY id LIMIT ${PAGE}`, [lastId]);
        if (!rows.length) break;
        await this.trackImages(rows);
        await this.pushRows(rows.map((r) => ({ t, id: r.id, d: r.data, ts })));
        lastId = rows[rows.length - 1].id;
        this.progress.done += rows.length;
        this.writeStatusFile();
        if (rows.length < PAGE) break;
      }
    }
  }

  /** Saldo inicial de los contadores: cada valor actual se sube como una diferencia desde 0. */
  private async pushBaselines(tables: string[]) {
    const out: CloudRow[] = [];
    const now = Date.now();
    for (const t of tables) {
      for (const c of await this.counterCols(t)) {
        const rows: any[] = await this.prisma.$queryRawUnsafe(`SELECT id, "${c}" AS v FROM "${t}" WHERE COALESCE("${c}", 0) <> 0`);
        for (const r of rows) out.push({ t: '_delta', id: crypto.randomUUID(), d: { t, id: String(r.id), c, v: Number(r.v) }, ts: now });
      }
    }
    await this.pushRows(out);
  }

  private async localHasBusinessData(): Promise<boolean> {
    try {
      const r: any[] = await this.prisma.$queryRawUnsafe(`SELECT (SELECT COUNT(*) FROM products) + (SELECT COUNT(*) FROM sales) AS n`);
      return Number(r[0].n) > 0;
    } catch {
      return false;
    }
  }

  // ── Ciclo ─────────────────────────────────────────────────────────
  async cycle() {
    if (this.running || Date.now() < this.retryAt) return;
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

      if (this.registeredFor !== creds.deviceId) {
        const reg = await this.call('register', { kind: process.env.VENTRA_NODE_KIND || 'pc' });
        this.nodeIndex = reg.nodeIndex;
        await this.setState('node_index', String(reg.nodeIndex));
        await this.checkGen(reg.gen);
        this.registeredFor = creds.deviceId;
      }

      let file = this.readFile();
      this.lastSyncAt = file.lastSyncAt || this.lastSyncAt;
      const dbWm = await this.getState('watermark');
      const dbWmPrev = await this.getState('watermark_prev');
      const bootstrapped = (await this.getState('bootstrap')) === 'done';
      // Archivo roto (no borrado): la base no cambió por fuera, se rehace el archivo en vez
      // de volver a bajar todo de la nube
      if (file.corrupt && bootstrapped && dbWm) {
        console.warn('[Sync] El archivo de estado estaba dañado: se rehace a partir de la base');
        this.writeFile(creds.deviceId, dbWm);
        file = this.readFile();
      }
      const consistent = file.deviceId === creds.deviceId && !!dbWm
        && (dbWm === file.watermark || (!!dbWmPrev && dbWmPrev === file.watermark));

      if (!bootstrapped || !consistent || installedNow) await this.bootstrap(tables, creds.deviceId, bootstrapped);
      else {
        const pushed = await this.pushPending();
        if (pushed || Date.now() >= this.nextPullAt) {
          const pulled = await this.pullChanges(false);
          this.pullDelay = pushed || pulled ? CYCLE_MS : Math.min(this.pullDelay * 2, PULL_IDLE_MAX_MS);
          this.nextPullAt = Date.now() + this.pullDelay;
          await this.bumpWatermark(creds.deviceId);
        }
      }
      if (this.phase === 'waiting') return;
      await this.uploadImages();
      await this.downloadImages();

      this.phase = 'idle';
      this.lastError = null;
      this.errorDelay = 0;
    } catch (err: any) {
      if (err instanceof AccountResetError) {
        await this.applyAccountReset(err.gen).catch((e) => console.error('[Sync] No se pudo vaciar la base tras el reinicio:', e));
        return;
      }
      const offline = !err.response && ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN', 'ECONNRESET'].includes(err.code);
      this.phase = offline ? 'offline' : 'error';
      this.lastError = offline ? 'Sin conexión: los cambios se suben cuando vuelva internet' : (err.response?.data?.error || err.message);
      if (!offline) {
        this.errorDelay = Math.min(this.errorDelay ? this.errorDelay * 2 : CYCLE_MS, ERROR_RETRY_MAX_MS);
        this.retryAt = Date.now() + this.errorDelay;
        console.warn(`[Sync] Error (reintento en ${Math.round(this.errorDelay / 1000)} s):`, this.lastError);
      }
    } finally {
      if (this.phase !== 'waiting') this.progress = null;
      this.running = false;
      this.writeStatusFile();
    }
  }

  /**
   * Arranque de esta caja en el comercio (o realineación si la base cambió por fuera):
   *  - Comercio vacío en la nube: esta caja es la original; sube todo y el saldo inicial de los contadores.
   *  - Comercio con datos: completa en la nube lo que solo tiene esta caja (sin pisar nada) y baja todo.
   */
  private async bootstrap(tables: string[], deviceId: string, wasBootstrapped: boolean) {
    this.phase = 'full';
    this.writeStatusFile();
    const reg = await this.call('register', { kind: process.env.VENTRA_NODE_KIND || 'pc' });
    this.nodeIndex = reg.nodeIndex;
    await this.setState('node_index', String(reg.nodeIndex));
    const hasData = await this.localHasBusinessData();
    // Lo anotado hasta ahora queda cubierto por esta pasada completa
    await this.prisma.$executeRawUnsafe(`DELETE FROM sync_outbox`);
    await this.prisma.$executeRawUnsafe(`DELETE FROM sync_deltas`);

    if (reg.cloudRows === 0) {
      await this.pushAll(tables, Date.now(), 'Subiendo tus datos a la nube');
      if ((await this.call('claimLedger')).claimed) await this.pushBaselines(tables);
      await this.pullChanges(false);
    } else if (!reg.ledger && reg.nodeIndex === 0) {
      // Caja original que venía de la etapa 1 (solo subía): se suma al esquema de dos sentidos
      await this.pushAll(tables, 1, 'Actualizando tu copia en la nube');
      if ((await this.call('claimLedger')).claimed) await this.pushBaselines(tables);
      await this.pullChanges(false);
    } else if (!reg.ledger && !hasData) {
      // Caja nueva en un comercio cuya PC original todavía no cargó el saldo inicial de
      // stock y saldos: se espera, si no esta caja vería los contadores en 0
      this.phase = 'waiting';
      // Si la PC original ya está subiendo, se muestra su avance
      const origin = (reg.nodes || []).find((n: any) => n.idx === 0);
      const st = origin?.status;
      const fresh = st && Date.now() - Date.parse(st.at) < 2 * 60 * 1000;
      if (fresh && st.total > 0) {
        this.progress = { label: 'Tu PC del local está subiendo sus datos', done: Number(st.done) || 0, total: Number(st.total) || 0 };
        this.lastError = 'La PC del local se está actualizando. Cuando termine, esta caja baja los datos sola.';
      } else {
        this.progress = null;
        this.lastError = origin
          ? 'Esperando que la PC del local termine de actualizarse (tiene que estar prendida y con Ventra abierto).'
          : 'Esperando que la PC del local se actualice a la última versión de Ventra y suba su stock.';
      }
      this.writeStatusFile();
      return;
    } else {
      // Caja nueva o base restaurada: lo que solo tiene esta caja completa la nube; después manda la nube
      if (hasData && wasBootstrapped) await this.pushAll(tables, 0, 'Completando datos en la nube');
      await this.pullChanges(true, !hasData, reg.cloudRows);
    }
    await this.setState('bootstrap', 'done');
    await this.bumpWatermark(deviceId);
    console.log(`[Sync] Caja #${reg.nodeIndex} lista`);
  }

  /** Sube lo anotado: filas cambiadas y diferencias de contadores. */
  /** Sube lo pendiente de esta caja. Devuelve si había algo. */
  private async pushPending(): Promise<boolean> {
    const entries: any[] = await this.prisma.$queryRawUnsafe(`SELECT seq, tbl, row_id, op, CAST(ts AS REAL) AS ts FROM sync_outbox ORDER BY seq LIMIT ${OUTBOX_BATCH}`);
    const deltas: any[] = await this.prisma.$queryRawUnsafe(`SELECT id, tbl, row_id, col, delta, CAST(ts AS REAL) AS ts FROM sync_deltas ORDER BY ts LIMIT ${OUTBOX_BATCH}`);
    if (!entries.length && !deltas.length) return false;
    this.phase = 'syncing';

    const out: CloudRow[] = [];
    if (entries.length) {
      const maxTs = new Map<string, number>();
      const byTable = new Map<string, Set<string>>();
      for (const e of entries) {
        const key = `${e.tbl}|${e.row_id}`;
        maxTs.set(key, Math.max(maxTs.get(key) || 0, Number(e.ts) || Date.now()));
        if (!byTable.has(e.tbl)) byTable.set(e.tbl, new Set());
        byTable.get(e.tbl)!.add(String(e.row_id));
      }
      const tables = await this.syncedTables();
      const order = await this.parentFirst(tables);
      const sorted = [...byTable.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
      for (const [t, idSet] of sorted) {
        const ids = [...idSet];
        const found = new Map<string, any>();
        if (tables.includes(t)) {
          for (let i = 0; i < ids.length; i += 400) {
            const chunk = ids.slice(i, i + 400);
            const rows = await this.readRows(t, `WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk);
            await this.trackImages(rows);
            rows.forEach((r) => found.set(r.id, r.data));
          }
        }
        for (const id of ids) {
          const ts = maxTs.get(`${t}|${id}`)!;
          out.push(found.has(id) ? { t, id, d: found.get(id), ts } : { t, id, x: true, ts });
        }
      }
    }
    // Las diferencias van después de las filas: quien las recibe ya tiene el registro
    for (const d of deltas) out.push({ t: '_delta', id: String(d.id), d: { t: d.tbl, id: d.row_id, c: d.col, v: Number(d.delta) }, ts: Number(d.ts) });

    await this.pushRows(out);
    if (entries.length) await this.prisma.$executeRawUnsafe(`DELETE FROM sync_outbox WHERE seq <= ?`, Number(entries[entries.length - 1].seq));
    if (deltas.length) {
      const ids = deltas.map((d) => String(d.id));
      for (let i = 0; i < ids.length; i += 400) {
        const chunk = ids.slice(i, i + 400);
        await this.prisma.$executeRawUnsafe(`DELETE FROM sync_deltas WHERE id IN (${chunk.map(() => '?').join(',')})`, ...chunk);
      }
    }
    return true;
  }

  /**
   * Baja cambios de la nube y los aplica.
   *  - full: desde el principio, incluidos los propios; al final los contadores se
   *    recalculan como la suma de todas sus diferencias.
   *  - wipe: antes vacía las tablas locales (caja nueva / recuperar).
   */
  private async pullChanges(full: boolean, wipe = false, expected = 0) {
    let after = full ? '0' : (await this.getState('pull_after')) || '0';
    const tables = await this.syncedTables();
    const counterSums = new Map<string, number>();
    let head = after;
    let applied = 0;
    if (full) this.progress = { label: wipe ? 'Descargando tus datos' : 'Alineando con la nube', done: 0, total: expected };

    const applyPage = async (tx: Tx, rows: CloudRow[]) => {
      for (const r of rows) {
        if (r.t === '_delta') {
          const d = r.d || {};
          if (full) {
            const key = `${d.t}|${d.id}|${d.c}`;
            counterSums.set(key, (counterSums.get(key) || 0) + Number(d.v || 0));
          } else await this.applyDelta(tx, tables, r.id, d);
          continue;
        }
        await this.applyRow(tx, tables, r, full);
      }
    };

    if (full) {
      // Todo en una transacción, bajando y aplicando de a tandas (sin juntar todo en
      // memoria). Las claves foráneas se controlan al final, así el orden de llegada da igual.
      const order = wipe ? await this.deleteOrder(tables) : [];
      this.writeLock = true;
      try {
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`PRAGMA defer_foreign_keys = ON`);
        await this.setState('applying', '1', tx);
        if (wipe) {
          for (const t of order) await tx.$executeRawUnsafe(`DELETE FROM "${t}"`);
          for (const t of ['sync_images', 'sync_img_fetch', 'sync_stash']) await tx.$executeRawUnsafe(`DELETE FROM ${t}`);
        }
        for (;;) {
          const page = await this.call('pull', { after, all: true });
          head = page.head;
          await applyPage(tx, page.rows as CloudRow[]);
          applied += page.rows.length;
          if (this.progress) {
            this.progress.done = applied;
            // La estimación cuenta solo lo vigente (no bajas ni movimientos de stock): pasada, se muestra solo la cantidad
            if (this.progress.total && applied > this.progress.total) this.progress.total = 0;
            this.writeStatusFile();
          }
          after = page.last;
          if (!page.more) break;
        }
        // Contadores = suma de todas sus diferencias (incluye el saldo inicial)
        for (const t of tables) for (const c of await this.counterCols(t)) await tx.$executeRawUnsafe(`UPDATE "${t}" SET "${c}" = 0`);
        for (const [key, sum] of counterSums) {
          const [t, id, c] = key.split('|');
          if (!tables.includes(t) || !(await this.counterCols(t)).includes(c)) continue;
          await tx.$executeRawUnsafe(`UPDATE "${t}" SET "${c}" = ? WHERE id = ?`, sum, id);
        }
        await this.setState('pull_after', String(head), tx);
        await tx.$executeRawUnsafe(`DELETE FROM sync_state WHERE key = 'applying'`);
      }, { timeout: 30 * 60 * 1000, maxWait: 30000 });
      } finally {
        this.writeLock = false;
      }
      return applied;
    }

    for (;;) {
      const page = await this.call('pull', { after, all: false });
      await this.checkGen(page.gen);
      head = page.head;
      if (page.rows.length) {
        this.phase = 'syncing';
        await this.prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`PRAGMA defer_foreign_keys = ON`);
          await this.setState('applying', '1', tx);
          await applyPage(tx, page.rows as CloudRow[]);
          await this.setState('pull_after', String(page.last), tx);
          await tx.$executeRawUnsafe(`DELETE FROM sync_state WHERE key = 'applying'`);
        }, { timeout: 5 * 60 * 1000, maxWait: 30000 });
        applied += page.rows.length;
      } else if (String(page.last) !== String(after)) {
        // Sin cambios de otras cajas, pero el marcador avanzó sobre lo propio
        await this.setState('pull_after', String(page.last));
      }
      after = page.last;
      if (!page.more) break;
    }
    return applied;
  }

  private async applyDelta(tx: Tx, tables: string[], deltaId: string, d: any) {
    if (!tables.includes(d.t) || !(await this.counterCols(d.t)).includes(d.c)) return;
    const n = await tx.$executeRawUnsafe(`UPDATE "${d.t}" SET "${d.c}" = COALESCE("${d.c}", 0) + ? WHERE id = ?`, Number(d.v || 0), String(d.id));
    // El registro todavía no llegó: se guarda y se aplica cuando llegue
    if (!n) await tx.$executeRawUnsafe(`INSERT OR IGNORE INTO sync_stash (id, tbl, row_id, col, delta) VALUES (?, ?, ?, ?, ?)`, deltaId, d.t, String(d.id), d.c, Number(d.v || 0));
  }

  /** Aplica una fila de otra caja. Gana el cambio más reciente; los contadores no se pisan. */
  private async applyRow(tx: Tx, tables: string[], r: CloudRow, full: boolean) {
    if (!tables.includes(r.t)) return;
    // Si esta caja tiene un cambio sin subir más nuevo, gana el local (se sube después)
    const pending: any[] = await tx.$queryRawUnsafe(`SELECT CAST(MAX(ts) AS REAL) AS ts FROM sync_outbox WHERE tbl = ? AND row_id = ?`, r.t, r.id);
    if (pending[0]?.ts != null && Number(pending[0].ts) > Number(r.ts || 0)) return;

    if (r.x || !r.d) {
      try {
        await tx.$executeRawUnsafe(`DELETE FROM "${r.t}" WHERE id = ?`, r.id);
      } catch (err: any) {
        console.warn(`[Sync] No se pudo borrar ${r.t}/${r.id}: ${err.message}`);
      }
      return;
    }

    const cols = await this.columns(r.t);
    const counters = await this.counterCols(r.t);
    const data = { ...r.d };
    // Fotos: la fila trae una referencia; se conserva la foto local si es la misma, si no se descarga
    if (r.t === 'products' && typeof data.image_url === 'string' && data.image_url.startsWith(IMG_PREFIX)) {
      const hash = data.image_url.slice(IMG_PREFIX.length);
      const local: any[] = await tx.$queryRawUnsafe(`SELECT image_url FROM products WHERE id = ?`, r.id);
      const localImg: string | null = local[0]?.image_url ?? null;
      if (localImg && localImg.startsWith('data:') && crypto.createHash('sha1').update(localImg).digest('hex') === hash) {
        data.image_url = localImg;
      } else {
        data.image_url = localImg && localImg.startsWith('data:') ? localImg : null;
        await tx.$executeRawUnsafe(`INSERT OR REPLACE INTO sync_img_fetch (product_id, hash) VALUES (?, ?)`, r.id, hash);
      }
    }

    const present = cols.filter((c) => Object.prototype.hasOwnProperty.call(data, c));
    if (!present.includes('id')) return;
    const exists: any[] = await tx.$queryRawUnsafe(`SELECT 1 FROM "${r.t}" WHERE id = ?`, r.id);
    const json = JSON.stringify(data);
    if (exists.length) {
      const setCols = present.filter((c) => c !== 'id' && !counters.includes(c));
      if (setCols.length) {
        await tx.$executeRawUnsafe(
          `UPDATE "${r.t}" SET ${setCols.map((c) => `"${c}" = json_extract(?1, '$.${c}')`).join(', ')} WHERE id = ?2`, json, r.id);
      }
    } else {
      // Alta: los contadores arrancan en 0 y los llenan sus diferencias
      const values = present.map((c) => (counters.includes(c) && !full ? '0' : `json_extract(?1, '$.${c}')`));
      await tx.$executeRawUnsafe(`INSERT INTO "${r.t}" (${present.map((c) => `"${c}"`).join(', ')}) VALUES (${values.join(', ')})`, json);
      if (!full && counters.length) {
        const stashed: any[] = await tx.$queryRawUnsafe(`SELECT id, col, delta FROM sync_stash WHERE tbl = ? AND row_id = ?`, r.t, r.id);
        for (const s of stashed) {
          await tx.$executeRawUnsafe(`UPDATE "${r.t}" SET "${s.col}" = COALESCE("${s.col}", 0) + ? WHERE id = ?`, Number(s.delta), r.id);
        }
        if (stashed.length) await tx.$executeRawUnsafe(`DELETE FROM sync_stash WHERE tbl = ? AND row_id = ?`, r.t, r.id);
      }
    }
  }

  /** Orden de alta: cada tabla después de las tablas a las que referencia. */
  private async parentFirst(tables: string[]): Promise<string[]> {
    return (await this.deleteOrder(tables)).reverse();
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

  // ── Fotos ─────────────────────────────────────────────────────────
  private async uploadImages() {
    const pending: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT si.product_id, si.hash, p.image_url FROM sync_images si JOIN products p ON p.id = si.product_id WHERE si.uploaded = 0 LIMIT ${IMAGES_PER_CYCLE}`);
    const one = async (row: any) => {
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
          await this.prisma.$executeRawUnsafe(`UPDATE sync_images SET uploaded = 1 WHERE product_id = ?`, row.product_id);
        } else throw err;
      }
    };
    for (let i = 0; i < pending.length; i += IMAGE_CONCURRENCY) await Promise.all(pending.slice(i, i + IMAGE_CONCURRENCY).map(one));
  }

  /** Fotos que cambiaron en otra caja: se bajan y se guardan sin volver a subirlas. */
  private async downloadImages(limit = IMAGES_PER_CYCLE) {
    const pending: any[] = await this.prisma.$queryRawUnsafe(`SELECT product_id, hash FROM sync_img_fetch LIMIT ${limit}`);
    const one = async (row: any) => {
      try {
        const { dataUrl } = await this.call('getImage', { productId: row.product_id });
        await this.prisma.$transaction(async (tx) => {
          await this.setState('applying', '1', tx);
          await tx.$executeRawUnsafe(`UPDATE products SET image_url = ? WHERE id = ?`, dataUrl, row.product_id);
          await tx.$executeRawUnsafe(`INSERT OR REPLACE INTO sync_images (product_id, hash, uploaded) VALUES (?, ?, 1)`, row.product_id,
            crypto.createHash('sha1').update(dataUrl).digest('hex'));
          await tx.$executeRawUnsafe(`DELETE FROM sync_state WHERE key = 'applying'`);
        });
      } catch (err: any) {
        if (err.response?.status !== 404) throw err;
      }
      await this.prisma.$executeRawUnsafe(`DELETE FROM sync_img_fetch WHERE product_id = ? AND hash = ?`, row.product_id, row.hash);
    };
    for (let i = 0; i < pending.length; i += IMAGE_CONCURRENCY) await Promise.all(pending.slice(i, i + IMAGE_CONCURRENCY).map(one));
    return pending.length;
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
      const tables = await this.syncedTables();
      await this.ensureTriggers(tables);
      const backupDir = path.join(process.cwd(), 'backups');
      fs.mkdirSync(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '_').slice(0, 15);
      const backup = path.join(backupDir, `backup_safety_${stamp}.db`);
      await this.prisma.$executeRawUnsafe(`VACUUM INTO '${backup.split(path.sep).join('/').replace(/'/g, "''")}'`);

      // Lo que esta caja tenía sin subir se descarta: manda la nube
      await this.prisma.$executeRawUnsafe(`DELETE FROM sync_outbox`);
      await this.prisma.$executeRawUnsafe(`DELETE FROM sync_deltas`);
      await this.pullChanges(true, true);
      const counted: any[] = await this.prisma.$queryRawUnsafe(
        tables.map((t) => `SELECT COUNT(*) AS n FROM "${t}"`).join(' UNION ALL '));
      const rows = counted.reduce((a, r) => a + Number(r.n), 0);

      this.progress = { label: 'Descargando fotos de productos', done: 0, total: 0 };
      let images = 0;
      for (;;) {
        const n = await this.downloadImages(200);
        images += n;
        this.progress.done = images;
        if (!n) break;
      }
      await this.setState('bootstrap', 'done');
      await this.bumpWatermark(creds.deviceId);
      console.log(`[Sync] Recuperación desde la nube: ${rows} filas, ${images} fotos`);
      return { rows, images, backup: path.basename(backup) };
    } finally {
      this.progress = null;
      this.phase = 'idle';
      this.running = false;
    }
  }

  async getStatus(): Promise<SyncStatus> {
    const enabled = !!this.subscription.getDeviceCredentials();
    let pending = 0;
    let imagesUp = 0;
    let imagesDown = 0;
    let imagesTotal = 0;
    if (enabled) {
      try {
        const a: any[] = await this.prisma.$queryRawUnsafe(`SELECT (SELECT COUNT(*) FROM sync_outbox) + (SELECT COUNT(*) FROM sync_deltas) AS n`);
        const b: any[] = await this.prisma.$queryRawUnsafe(
          `SELECT (SELECT COUNT(*) FROM sync_images WHERE uploaded = 0) AS up, (SELECT COUNT(*) FROM sync_img_fetch) AS down,
                  (SELECT COUNT(*) FROM products WHERE image_url IS NOT NULL AND image_url <> '') AS total`);
        pending = Number(a[0].n);
        imagesUp = Number(b[0].up);
        imagesDown = Number(b[0].down);
        imagesTotal = Number(b[0].total);
      } catch {}
    }
    return {
      enabled,
      phase: enabled ? this.phase : 'disabled',
      pending,
      pendingImages: imagesUp + imagesDown,
      imagesUp,
      imagesDown,
      imagesTotal,
      lastSyncAt: this.lastSyncAt || this.readFile().lastSyncAt || null,
      lastError: this.lastError,
      progress: this.progress,
      nodeIndex: this.nodeIndex,
    };
  }

  /** Fuerza un ciclo ya (botón "Sincronizar ahora"). */
  async syncNow() {
    this.nextPullAt = 0;
    this.retryAt = 0;
    await this.cycle();
    return this.getStatus();
  }
}

/** La cuenta se reinició (borrar todo) desde otra caja. */
class AccountResetError extends Error {
  constructor(public gen: number) { super('Reinicio de la cuenta'); }
}
