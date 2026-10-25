import { Injectable, Logger, OnModuleInit, OnModuleDestroy, BadRequestException } from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto';
import * as os from 'os';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../websockets/events.gateway';

/**
 * GO Delivery: el catálogo de la caja publicado en la app de GO y los pedidos que llegan de ahí.
 *
 * Se vincula con un código que da GO (functions/ventra-bridge.js en el repo de GoDelivery) y la
 * caja recibe una clave propia del comercio (no la del administrador de GO, como la conexión vieja
 * de FirebaseSyncService, que con el puente vinculado no arranca).
 *
 * Una sola PC del comercio hace el trabajo (go_link.poller_host): publica y recibe los pedidos.
 * Los cambios hechos en otras cajas le llegan por el sync y los publica en la próxima comparación.
 *
 *   go_link        (sync)  la vinculación y qué se publica
 *   go_products    (sync)  producto por producto: publicar sí/no (por encima de la regla general)
 *   go_orders      (sync)  los pedidos de GO, para la pantalla y las estadísticas
 *   go_published   (local) lo último que esta PC mandó de cada producto (para mandar solo cambios)
 *
 * En los comercios donde "lo compra el repartidor", el repartidor paga en el mostrador como
 * cualquier cliente: la venta se cobra en la caja como siempre y el stock baja por esa venta.
 */
const GO_URL = process.env.GO_FUNCTIONS_URL || 'https://us-central1-godelivery-magdalena.cloudfunctions.net';
/** La app GO (para abrir el panel del comercio y la tienda) */
const GO_APP_URL = (process.env.GO_APP_URL || 'https://godelivery-magdalena.web.app').replace(/\/+$/, '');
const POLL_MS = 30_000;
const RECONCILE_MS = 3 * 60_000;
const FULL_MS = 6 * 60 * 60_000;
const MAX_BATCH = 200;
const MAX_BATCH_BYTES = 4_000_000;
const FINAL = ['completed', 'delivered', 'cancelled'];
/** Los productos sin rubro se eligen como si fueran un rubro más */
export const NO_CATEGORY = '__none__';

type Link = {
  id: string; comercio_id: string; store_name: string; api_key: string;
  fulfillment_mode: string | null; shopper_max_total: number | null;
  publish_mode: string; publish_categories: string | null; sync_stock: number;
  poller_host: string | null; linked_at: string | null;
};

// SQLite devuelve algunos enteros (COUNT, length) como BigInt
const fp = (v: unknown) => crypto.createHash('sha1').update(JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? Number(x) : x))).digest('hex');
const num = (v: any) => Number(v) || 0;

@Injectable()
export class GoService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('GO');
  private timers: NodeJS.Timeout[] = [];
  private link: Link | null = null;
  private linkReadAt = 0;
  private touchTimer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;
  private lastFullAt = 0;
  private lastPushAt = 0;
  private lastPollAt = 0;
  private lastError = '';

  constructor(private prisma: PrismaService, private events: EventsGateway) {}

  private get host() { return os.hostname(); }

  async onModuleInit() {
    await this.prisma.ensureInitialized();
    await this.ensureTables();
    const every = (ms: number, fn: () => Promise<unknown>) => {
      const t = setInterval(() => fn().catch(() => {}), ms);
      t.unref?.();
      this.timers.push(t);
    };
    every(POLL_MS, () => this.pollOrders());
    every(RECONCILE_MS, () => this.reconcile());
    setTimeout(() => this.reconcile().catch(() => {}), 20_000).unref?.();
  }

  onModuleDestroy() {
    this.timers.forEach(clearInterval);
  }

  private async ensureTables() {
    const run = (sql: string) => this.prisma.$executeRawUnsafe(sql);
    await run(`CREATE TABLE IF NOT EXISTS "go_link" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "comercio_id" TEXT NOT NULL,
      "store_name" TEXT,
      "api_key" TEXT NOT NULL,
      "fulfillment_mode" TEXT,
      "shopper_max_total" REAL,
      "publish_mode" TEXT NOT NULL DEFAULT 'selected',
      "publish_categories" TEXT,
      "sync_stock" INTEGER NOT NULL DEFAULT 0,
      "poller_host" TEXT,
      "linked_at" DATETIME DEFAULT CURRENT_TIMESTAMP,
      "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP
    );`);
    await run(`CREATE TABLE IF NOT EXISTS "go_products" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "publish" INTEGER,
      "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP
    );`);
    await run(`CREATE TABLE IF NOT EXISTS "go_orders" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "number" TEXT,
      "status" TEXT,
      "is_shopper" INTEGER NOT NULL DEFAULT 0,
      "shop_pending" INTEGER NOT NULL DEFAULT 0,
      "created_ms" REAL,
      "completed_ms" REAL,
      "cancelled_ms" REAL,
      "cancel_reason" TEXT,
      "customer" TEXT,
      "driver_name" TEXT,
      "payment_method" TEXT,
      "subtotal" REAL NOT NULL DEFAULT 0,
      "estimated_subtotal" REAL NOT NULL DEFAULT 0,
      "total" REAL NOT NULL DEFAULT 0,
      "delivery_cost" REAL NOT NULL DEFAULT 0,
      "items" TEXT,
      "fingerprint" TEXT,
      "updated_at" DATETIME DEFAULT CURRENT_TIMESTAMP
    );`);
    await run(`CREATE INDEX IF NOT EXISTS "go_orders_created_idx" ON "go_orders"("created_ms");`);
    // La venta de la caja con la que se cobró el pedido (Cobrar pedido GO): una sola por pedido
    await run(`ALTER TABLE "go_orders" ADD COLUMN "sale_id" TEXT`).catch(() => { /* ya estaba */ });
    // Estado propio de esta PC (no viaja por el sync: ver EXCLUDED en SyncService)
    await run(`CREATE TABLE IF NOT EXISTS "go_published" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "data_fp" TEXT NOT NULL,
      "image_fp" TEXT,
      "pushed_at" DATETIME DEFAULT CURRENT_TIMESTAMP
    );`);
  }

  // ───────────────────────────────────────────── vinculación

  async getLink(fresh = false): Promise<Link | null> {
    if (!fresh && Date.now() - this.linkReadAt < 15_000) return this.link;
    const rows = await this.prisma.$queryRawUnsafe<Link[]>(`SELECT * FROM go_link WHERE id = 'main'`).catch(() => [] as Link[]);
    this.link = rows[0] || null;
    this.linkReadAt = Date.now();
    return this.link;
  }

  /** ¿Esta caja usa el puente nuevo? (la conexión vieja no arranca) */
  async isLinked() {
    return !!(await this.getLink());
  }

  private async isMainPc() {
    const l = await this.getLink();
    return !!l && l.poller_host === this.host;
  }

  private async bridge(action: string, body: Record<string, unknown> = {}, key?: string) {
    try {
      const { data } = await axios.post(`${GO_URL}/ventraBridge`, { action, ...body }, {
        headers: key ? { 'x-ventra-key': key } : {},
        timeout: 60_000,
        maxBodyLength: 12_000_000,
      });
      return data;
    } catch (e: any) {
      const msg = e?.response?.data?.error || (e?.code === 'ECONNABORTED' ? 'GO no respondió a tiempo' : 'Sin conexión con GO');
      const err: any = new Error(msg);
      err.status = e?.response?.status || 0;
      throw err;
    }
  }

  async linkWithCode(code: string, storeName = '') {
    const clean = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (clean.length !== 8) throw new BadRequestException('El código de GO tiene 8 letras y números');
    let r: any;
    try {
      r = await this.bridge('link', { code: clean, storeName });
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }
    // Al vincular no se publica nada: el dueño elige qué (uno por uno o por rubros). Los rubros
    // quedan todos marcados para cuando elija "Por rubros".
    const cats: { id: string; name: string }[] = await this.prisma.$queryRawUnsafe(`SELECT id FROM categories WHERE is_active = 1`);
    const allowed = [NO_CATEGORY, ...cats.map((c) => c.id)];
    await this.prisma.$executeRawUnsafe(`DELETE FROM go_link`);
    await this.prisma.$executeRawUnsafe(`DELETE FROM go_published`);
    await this.prisma.$executeRawUnsafe(
      `INSERT INTO go_link (id, comercio_id, store_name, api_key, fulfillment_mode, shopper_max_total, publish_mode, publish_categories, sync_stock, poller_host, linked_at, updated_at)
       VALUES ('main', ?, ?, ?, ?, ?, 'selected', ?, 0, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      r.store.comercioId, r.store.name || '', r.key, r.store.fulfillmentMode || null, r.store.shopperMaxTotal ?? null,
      JSON.stringify(allowed), this.host,
    );
    await this.getLink(true);
    this.lastFullAt = 0;
    this.reconcile().catch(() => {});
    return this.status();
  }

  async unlink() {
    const l = await this.getLink(true);
    if (!l) return { linked: false };
    await this.bridge('unlink', {}, l.api_key).catch(() => {}); // si GO no responde, igual se desvincula acá
    await this.prisma.$executeRawUnsafe(`DELETE FROM go_link`);
    await this.prisma.$executeRawUnsafe(`DELETE FROM go_published`);
    await this.getLink(true);
    return { linked: false };
  }

  /**
   * Link para entrar al panel del comercio en la app GO (fotos, datos, horarios y todo el modo
   * comercio) sin iniciar sesión en GO: el puente da un código de un solo uso que vence en 2 minutos.
   */
  async panelLink(section = 'settings') {
    const l = await this.getLink(true);
    if (!l) throw new BadRequestException('La caja no está vinculada con GO');
    let r: any;
    try {
      r = await this.bridge('panelLink', {}, l.api_key);
    } catch (e: any) {
      throw new BadRequestException(e.message);
    }
    const s = ['panel', 'settings', 'products', 'promos', 'metrics', 'orders'].includes(section) ? section : 'settings';
    return { url: `${GO_APP_URL}/#/ventra/${encodeURIComponent(r.code)}?s=${s}` };
  }

  /** Esta PC pasa a ser la que publica y recibe los pedidos */
  async makeMainPc() {
    await this.prisma.$executeRawUnsafe(`UPDATE go_link SET poller_host = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 'main'`, this.host);
    await this.prisma.$executeRawUnsafe(`DELETE FROM go_published`); // no sabe qué mandó la otra: compara todo de nuevo
    await this.getLink(true);
    this.lastFullAt = 0;
    this.reconcile().catch(() => {});
    return this.status();
  }

  async status() {
    const l = await this.getLink(true);
    if (!l) return { linked: false };
    const [pub]: any[] = await this.prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM go_published`);
    let store: any = null;
    if (l.poller_host === this.host) {
      try {
        store = (await this.bridge('status', {}, l.api_key)).store;
        // GO puede cambiar el modo o el nombre: se guardan para mostrarlos en todas las cajas
        if (store && (store.fulfillmentMode !== l.fulfillment_mode || store.name !== l.store_name)) {
          await this.prisma.$executeRawUnsafe(`UPDATE go_link SET fulfillment_mode = ?, store_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 'main'`,
            store.fulfillmentMode || null, store.name || l.store_name);
        }
      } catch (e: any) {
        if (e.status === 401) store = { unlinked: true };
      }
    }
    return {
      linked: true,
      comercioId: l.comercio_id,
      storeName: store?.name || l.store_name,
      fulfillmentMode: store?.fulfillmentMode || l.fulfillment_mode,
      storeActive: store ? store.isActive !== false && store.approved !== false : null,
      storePaused: store?.isPaused === true,
      unlinkedInGo: store?.unlinked === true,
      publishMode: l.publish_mode,
      publishCategories: safeJson(l.publish_categories, []),
      syncStock: !!l.sync_stock,
      isMainPc: l.poller_host === this.host,
      mainPc: l.poller_host,
      thisPc: this.host,
      linkedAt: l.linked_at,
      publishedCount: Number(pub?.n) || 0,
      lastPushAt: this.lastPushAt || null,
      lastPollAt: this.lastPollAt || null,
      lastError: this.lastError || null,
    };
  }

  async updateSettings(body: { publishMode?: string; publishCategories?: string[]; syncStock?: boolean }) {
    const l = await this.getLink(true);
    if (!l) throw new BadRequestException('La caja no está vinculada con GO');
    const mode = ['all', 'categories', 'selected'].includes(String(body.publishMode)) ? String(body.publishMode) : l.publish_mode;
    const cats = Array.isArray(body.publishCategories) ? body.publishCategories.map(String).slice(0, 500) : safeJson(l.publish_categories, []);
    const stock = body.syncStock === undefined ? l.sync_stock : (body.syncStock ? 1 : 0);
    await this.prisma.$executeRawUnsafe(`UPDATE go_link SET publish_mode = ?, publish_categories = ?, sync_stock = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 'main'`,
      mode, JSON.stringify(cats), stock);
    await this.getLink(true);
    this.lastFullAt = 0; // cambió qué se publica: publicación completa
    this.reconcile().catch(() => {});
    return this.status();
  }

  // ───────────────────────────────────────────── qué se publica

  /** Productos con su estado en GO: para la pantalla de elegir qué publicar */
  async listProducts(q: { search?: string; categoryId?: string; only?: string }) {
    const l = await this.getLink();
    const rows = await this.candidates(l);
    const s = String(q.search || '').trim().toLowerCase();
    return rows
      .filter((r) => (!q.categoryId || r.category_id === q.categoryId) && (!s || r.name.toLowerCase().includes(s) || String(r.barcode || '').includes(s)))
      .filter((r) => (q.only === 'published' ? r.published : q.only === 'hidden' ? !r.published : true))
      .slice(0, 300)
      .map((r) => ({ id: r.id, name: r.name, barcode: r.barcode, price: r.sale_price, category: r.category, categoryId: r.category_id, published: r.published, override: r.override, reason: r.reason }));
  }

  /**
   * Saca todos los productos de la tienda de GO: "Solo los que elijo" sin nada elegido (también
   * se olvidan los elegidos a mano). GO los oculta en la próxima publicación, en unos segundos.
   */
  async unpublishAll() {
    const l = await this.getLink(true);
    if (!l) throw new BadRequestException('La caja no está vinculada con GO');
    await this.prisma.$executeRawUnsafe(`UPDATE go_link SET publish_mode = 'selected', updated_at = CURRENT_TIMESTAMP WHERE id = 'main'`);
    await this.prisma.$executeRawUnsafe(`DELETE FROM go_products WHERE publish = 1`);
    await this.getLink(true);
    this.lastFullAt = 0; // publicación completa: GO oculta todo lo que tenía
    this.reconcile().catch(() => {});
    return this.status();
  }

  /** publish: true / false fija el producto; null vuelve a la regla general */
  async setProductsPublish(ids: string[], publish: boolean | null) {
    const list = (Array.isArray(ids) ? ids : []).map(String).slice(0, 1000);
    for (const id of list) {
      if (publish === null) await this.prisma.$executeRawUnsafe(`DELETE FROM go_products WHERE id = ?`, id);
      else await this.prisma.$executeRawUnsafe(
        `INSERT INTO go_products (id, publish, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET publish = excluded.publish, updated_at = CURRENT_TIMESTAMP WHERE go_products.publish IS NOT excluded.publish`,
        id, publish ? 1 : 0);
    }
    this.touch();
    return { ok: true, count: list.length };
  }

  /**
   * Todos los productos activos con su motivo de publicarse o no. La foto no se lee entera:
   * alcanza con una huella (largo, principio y final) para saber si cambió.
   */
  private async candidates(l: Link | null) {
    const rows: any[] = await this.prisma.$queryRawUnsafe(`
      SELECT p.id, p.barcode, p.name, p.description, CAST(p.sale_price AS REAL) AS sale_price, CAST(p.stock AS REAL) AS stock,
             p.unlimited_stock, p.unit, p.category_id, c.name AS category,
             length(p.image_url) AS img_len, substr(p.image_url, 1, 40) AS img_head, substr(p.image_url, -40) AS img_tail,
             g.publish AS override
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN go_products g ON g.id = p.id
      WHERE p.is_active = 1`);
    const mode = l?.publish_mode || 'selected';
    const cats = new Set(safeJson<string[]>(l?.publish_categories, []));
    return rows.map((r) => {
      const override = r.override === null || r.override === undefined ? null : Number(r.override) === 1;
      let published: boolean;
      let reason = '';
      if (!(num(r.sale_price) > 0)) { published = false; reason = 'Sin precio'; }
      else if (r.unit && !['UNIT', 'PACK'].includes(String(r.unit))) { published = false; reason = 'Por peso o medida: todavía no se publica'; }
      else if (override !== null) { published = override; reason = override ? 'Elegido a mano' : 'Sacado a mano'; }
      else if (mode === 'all') published = true;
      else if (mode === 'selected') { published = false; reason = 'No elegido'; }
      else { published = cats.has(r.category_id || NO_CATEGORY); if (!published) reason = 'Rubro sin publicar'; }
      return { ...r, name: String(r.name || ''), override, published, reason };
    });
  }

  // ───────────────────────────────────────────── publicar

  /** Un producto cambió en esta caja: se publica en unos segundos (si esta es la PC de GO) */
  touch() {
    if (this.touchTimer) clearTimeout(this.touchTimer);
    this.touchTimer = setTimeout(() => { this.touchTimer = null; this.reconcile().catch(() => {}); }, 3000);
    this.touchTimer.unref?.();
  }

  async syncNow() {
    this.lastFullAt = 0;
    await this.reconcile();
    await this.pollOrders();
    return this.status();
  }

  /**
   * Compara lo que hay en la caja con lo último que se mandó a GO y manda solo lo distinto.
   * Cada 6 horas (o si cambió qué se publica) manda además la lista completa de lo publicado,
   * así GO oculta lo que quedó afuera aunque se haya perdido algún aviso.
   */
  reconcile(): Promise<unknown> {
    if (this.running) return this.running;
    this.running = this.doReconcile().finally(() => { this.running = null; });
    return this.running;
  }

  private async doReconcile() {
    const l = await this.getLink();
    if (!l || l.poller_host !== this.host) return;
    const syncStock = !!l.sync_stock;
    const all = await this.candidates(l);
    const wanted = all.filter((r) => r.published);
    const sent: any[] = await this.prisma.$queryRawUnsafe(`SELECT id, data_fp, image_fp FROM go_published`);
    const sentMap = new Map(sent.map((s) => [s.id, s]));
    const changed: { r: any; dataFp: string; imageFp: string | null; withImage: boolean }[] = [];
    for (const r of wanted) {
      const dataFp = fp([r.name, num(r.sale_price), r.barcode || '', r.category || '', r.description || '', syncStock ? (r.unlimited_stock ? 'inf' : Math.max(0, Math.floor(num(r.stock)))) : '']);
      const imageFp = r.img_len ? fp([r.img_len, r.img_head, r.img_tail]) : null;
      const prev = sentMap.get(r.id);
      if (!prev || prev.data_fp !== dataFp || (prev.image_fp || null) !== imageFp) {
        changed.push({ r, dataFp, imageFp, withImage: !!imageFp && (!prev || (prev.image_fp || null) !== imageFp) });
      }
    }
    const wantedIds = new Set(wanted.map((r) => r.id));
    const deletes = sent.filter((s) => !wantedIds.has(s.id)).map((s) => s.id);
    const full = Date.now() - this.lastFullAt > FULL_MS;
    if (!changed.length && !deletes.length && !full) return;

    try {
      // Tandas de hasta 200 productos y ~4 MB (las fotos van incrustadas)
      let batch: typeof changed = [];
      let bytes = 0;
      const send = async (last: boolean) => {
        const upserts: any[] = [];
        for (const c of batch) {
          let image: string | undefined;
          if (c.withImage) {
            const [row]: any[] = await this.prisma.$queryRawUnsafe(`SELECT image_url FROM products WHERE id = ?`, c.r.id);
            const url = String(row?.image_url || '');
            if (url.startsWith('data:image/') || /^https:\/\//.test(url)) image = url;
          }
          upserts.push({
            ventraId: c.r.id, barcode: c.r.barcode || '', name: c.r.name, price: num(c.r.sale_price),
            category: c.r.category || '', description: c.r.description || '',
            ...(syncStock ? { stock: c.r.unlimited_stock ? 9999 : Math.max(0, Math.floor(num(c.r.stock))) } : {}),
            ...(image ? { image } : {}),
          });
        }
        const body: any = { upserts, syncStock };
        if (last) {
          body.deletes = deletes;
          if (full) body.publishedIds = [...wantedIds];
        }
        const r = await this.bridge('catalog', body, l.api_key);
        const failed = new Set((r?.errors || []).map((e: any) => e.ventraId));
        for (const c of batch) {
          if (failed.has(c.r.id)) continue;
          await this.prisma.$executeRawUnsafe(
            `INSERT INTO go_published (id, data_fp, image_fp, pushed_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET data_fp = excluded.data_fp, image_fp = excluded.image_fp, pushed_at = CURRENT_TIMESTAMP`,
            c.r.id, c.dataFp, c.imageFp);
        }
        batch = [];
        bytes = 0;
      };
      for (const c of changed) {
        const size = c.withImage ? num(c.r.img_len) + 400 : 400;
        if (batch.length && (batch.length >= MAX_BATCH || bytes + size > MAX_BATCH_BYTES)) await send(false);
        batch.push(c);
        bytes += size;
      }
      await send(true);
      if (deletes.length) {
        for (const id of deletes) await this.prisma.$executeRawUnsafe(`DELETE FROM go_published WHERE id = ?`, id);
      }
      if (full) this.lastFullAt = Date.now();
      this.lastPushAt = Date.now();
      this.lastError = '';
      if (changed.length || deletes.length) this.logger.log(`Catálogo publicado en GO: ${changed.length} cambios, ${deletes.length} sacados`);
    } catch (e: any) {
      this.lastError = e.message || 'No se pudo publicar en GO';
      this.logger.warn(`No se pudo publicar en GO: ${this.lastError}`);
    }
  }

  // ───────────────────────────────────────────── pedidos

  async pollOrders() {
    const l = await this.getLink();
    if (!l || l.poller_host !== this.host) return;
    const [last]: any[] = await this.prisma.$queryRawUnsafe(`SELECT MAX(created_ms) AS m FROM go_orders`);
    const open: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT id FROM go_orders WHERE status NOT IN ('completed','delivered','cancelled') AND created_ms > ? ORDER BY created_ms DESC LIMIT 100`,
      Date.now() - 4 * 864e5);
    let r: any;
    try {
      r = await this.bridge('orders', { since: Number(last?.m) || 0, openIds: open.map((o) => o.id) }, l.api_key);
    } catch (e: any) {
      this.lastError = e.message;
      return;
    }
    this.lastPollAt = Date.now();
    const known: any[] = await this.prisma.$queryRawUnsafe(`SELECT id, fingerprint, status FROM go_orders WHERE id IN (${(r.orders || []).map(() => '?').join(',') || "''"})`, ...(r.orders || []).map((o: any) => o.id));
    const knownMap = new Map(known.map((k) => [k.id, k]));
    for (const o of r.orders || []) {
      const f = fp(o);
      const prev = knownMap.get(o.id);
      if (prev && prev.fingerprint === f) continue; // sin cambios: no se escribe (cada escritura viaja por el sync)
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO go_orders (id, number, status, is_shopper, shop_pending, created_ms, completed_ms, cancelled_ms, cancel_reason, customer, driver_name, payment_method, subtotal, estimated_subtotal, total, delivery_cost, items, fingerprint, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET number = excluded.number, status = excluded.status, is_shopper = excluded.is_shopper, shop_pending = excluded.shop_pending,
           created_ms = excluded.created_ms, completed_ms = excluded.completed_ms, cancelled_ms = excluded.cancelled_ms, cancel_reason = excluded.cancel_reason,
           customer = excluded.customer, driver_name = excluded.driver_name, payment_method = excluded.payment_method, subtotal = excluded.subtotal,
           estimated_subtotal = excluded.estimated_subtotal, total = excluded.total, delivery_cost = excluded.delivery_cost, items = excluded.items,
           fingerprint = excluded.fingerprint, updated_at = CURRENT_TIMESTAMP`,
        o.id, o.number != null ? String(o.number) : null, o.status, o.isShopper ? 1 : 0, o.shopPending ? 1 : 0,
        num(o.createdAt), o.completedAt || null, o.cancelledAt || null, o.cancelReason || null,
        o.customer || null, o.driverName || null, o.paymentMethod || null,
        num(o.subtotal), num(o.estimatedSubtotal), num(o.total), num(o.deliveryCost), JSON.stringify(o.items || []), f,
      );
      // Aviso discreto en las cajas: pedido nuevo, o el repartidor ya está comprando
      try {
        if (!prev && !FINAL.includes(o.status)) this.events.server?.emit('go:order', { type: 'new', id: o.id, number: o.number, count: (o.items || []).length, isShopper: o.isShopper });
        else if (prev && prev.status !== o.status) this.events.server?.emit('go:order', { type: 'status', id: o.id, number: o.number, status: o.status });
      } catch { /* sin pantallas conectadas */ }
    }
    this.lastError = '';
  }

  async listOrders(q: { from?: string; to?: string; status?: string }) {
    const { from, to } = range(q.from, q.to);
    const rows: any[] = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM go_orders WHERE created_ms >= ? AND created_ms < ? ORDER BY created_ms DESC LIMIT 1000`, from, to);
    return rows
      .filter((r) => !q.status || (q.status === 'open' ? !FINAL.includes(r.status) : q.status === 'delivered' ? ['completed', 'delivered'].includes(r.status) : r.status === q.status))
      .map(toOrder);
  }

  /** Estadísticas de los pedidos de GO en un período (fechas YYYY-MM-DD, hora local) */
  async stats(q: { from?: string; to?: string }) {
    const { from, to } = range(q.from, q.to);
    const rows: any[] = await this.prisma.$queryRawUnsafe(`SELECT * FROM go_orders WHERE created_ms >= ? AND created_ms < ?`, from, to);
    const orders = rows.map(toOrder);
    const delivered = orders.filter((o) => ['completed', 'delivered'].includes(o.status));
    const cancelled = orders.filter((o) => o.status === 'cancelled');
    const open = orders.filter((o) => !FINAL.includes(o.status));
    const revenue = delivered.reduce((s, o) => s + o.subtotal, 0);
    const products = new Map<string, { name: string; qty: number; amount: number }>();
    const missing = new Map<string, { name: string; times: number }>();
    const byHour = Array(24).fill(0);
    const byWeekday = Array(7).fill(0);
    const byDay = new Map<string, { orders: number; amount: number }>();
    let minutes = 0;
    let timed = 0;
    for (const o of delivered) {
      const d = new Date(o.createdMs);
      byHour[d.getHours()]++;
      byWeekday[d.getDay()]++;
      const day = ymd(d);
      const cur = byDay.get(day) || { orders: 0, amount: 0 };
      byDay.set(day, { orders: cur.orders + 1, amount: cur.amount + o.subtotal });
      if (o.completedMs && o.completedMs > o.createdMs) { minutes += (o.completedMs - o.createdMs) / 60000; timed++; }
      for (const it of o.items) {
        const key = it.ventraId || it.name;
        if (it.shopStatus === 'missing') {
          const m = missing.get(key) || { name: it.name, times: 0 };
          m.times++;
          missing.set(key, m);
          continue;
        }
        const name = it.replacement?.name || it.name;
        const p = products.get(it.replacement ? `r:${name}` : key) || { name, qty: 0, amount: 0 };
        p.qty += num(it.qty);
        p.amount += num(it.qty) * num(it.price);
        products.set(it.replacement ? `r:${name}` : key, p);
      }
    }
    // Lo que faltó también en pedidos cancelados porque no había nada
    for (const o of cancelled) for (const it of o.items) if (it.shopStatus === 'missing') {
      const key = it.ventraId || it.name;
      const m = missing.get(key) || { name: it.name, times: 0 };
      m.times++;
      missing.set(key, m);
    }
    const reasons = new Map<string, number>();
    for (const o of cancelled) reasons.set(o.cancelReason || 'Sin motivo', (reasons.get(o.cancelReason || 'Sin motivo') || 0) + 1);
    return {
      from, to,
      orders: orders.length,
      delivered: delivered.length,
      cancelled: cancelled.length,
      open: open.length,
      revenue: Math.round(revenue),
      avgTicket: delivered.length ? Math.round(revenue / delivered.length) : 0,
      avgMinutes: timed ? Math.round(minutes / timed) : null,
      itemsSold: [...products.values()].reduce((s, p) => s + p.qty, 0),
      topProducts: [...products.values()].sort((a, b) => b.qty - a.qty || b.amount - a.amount).slice(0, 15),
      missing: [...missing.values()].sort((a, b) => b.times - a.times).slice(0, 15),
      cancelReasons: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
      byHour,
      byWeekday,
      byDay: [...byDay.entries()].map(([day, v]) => ({ day, ...v, amount: Math.round(v.amount) })).sort((a, b) => a.day.localeCompare(b.day)),
    };
  }
}

function safeJson<T>(s: string | null | undefined, fallback: T): T {
  try { return s ? JSON.parse(s) : fallback; } catch { return fallback; }
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Fechas YYYY-MM-DD (hora local, "to" incluido). Sin fechas: los últimos 30 días. */
function range(fromS?: string, toS?: string) {
  const parse = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : null);
  const toD = parse(toS) || new Date(new Date().setHours(0, 0, 0, 0));
  const fromD = parse(fromS) || new Date(toD.getTime() - 29 * 864e5);
  return { from: fromD.getTime(), to: toD.getTime() + 864e5 };
}

function toOrder(r: any) {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    isShopper: !!Number(r.is_shopper),
    shopPending: !!Number(r.shop_pending),
    createdMs: Number(r.created_ms) || 0,
    completedMs: Number(r.completed_ms) || null,
    cancelledMs: Number(r.cancelled_ms) || null,
    cancelReason: r.cancel_reason,
    customer: r.customer,
    driverName: r.driver_name,
    paymentMethod: r.payment_method,
    subtotal: Number(r.subtotal) || 0,
    estimatedSubtotal: Number(r.estimated_subtotal) || 0,
    total: Number(r.total) || 0,
    deliveryCost: Number(r.delivery_cost) || 0,
    items: safeJson<any[]>(r.items, []),
    saleId: r.sale_id || null,
  };
}
