import { AsyncLocalStorage } from 'async_hooks';
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

/**
 * Demo pública: una base por visitante.
 *
 * La demo (DEMO_MODE=true) la abren muchas personas a la vez. Antes compartían una sola base:
 * el rubro, el nombre o una venta de uno le aparecían al siguiente. Ahora cada visitante, al
 * tocar "Probar", recibe su propia copia de la base de ejemplo (un archivo SQLite aparte) y
 * una cookie que la identifica. Cada pedido /api corre "dentro" de su base: PrismaService
 * manda las consultas a la base del visitante del pedido en curso (ver routeToVisitor).
 *
 * La base principal queda como molde: la arma y la reinicia DemoResetService, y nadie escribe
 * en ella (un cambio sin cookie de demo se rechaza). Las copias se borran solas.
 */

export const isDemoMode = () => process.env.DEMO_MODE === 'true';

interface DemoVisitor { id: string; client: PrismaClient; lastUsed: number }

export const demoContext = new AsyncLocalStorage<DemoVisitor>();

const COOKIE = 'ventra_demo';
const ID_RE = /^[a-f0-9]{32}$/;
/** Una demo dura un día desde el último uso */
const KEEP_MS = 24 * 3600e3;
/**
 * Conexiones abiertas: se cierran tras un rato sin uso y se vuelven a abrir solas. Cada una
 * ocupa memoria y la máquina de la demo tiene 512 MB: pocas a la vez.
 */
const IDLE_CLOSE_MS = 10 * 60e3;
const MAX_OPEN = 8;
/** Tope de demos guardadas: pasado esto se borran las más viejas */
const MAX_FILES = 300;
/** Tope de demos nuevas por minuto (todas juntas): frena a un robot que llene el disco */
const MAX_NEW_PER_MINUTE = 40;

class DemoVisitors {
  private open = new Map<string, DemoVisitor>();
  private created: number[] = [];
  private sweeper: NodeJS.Timeout | null = null;
  private baseDir = '';

  /** Las demos van en una carpeta junto a la base molde (la llama PrismaService al arrancar). */
  configure(templateDbPath: string) {
    this.baseDir = path.join(path.dirname(templateDbPath), 'demo-visitors');
  }

  dir() {
    return path.resolve(process.env.DEMO_VISITORS_DIR || this.baseDir || 'demo-visitors');
  }

  private file(id: string) { return path.join(this.dir(), `${id}.db`); }

  private connect(id: string): DemoVisitor {
    const url = 'file:' + this.file(id).split(path.sep).join('/') + '?connection_limit=1';
    const client = new PrismaClient({ datasources: { db: { url } }, log: ['error'] });
    const visitor = { id, client, lastUsed: Date.now() };
    this.open.set(id, visitor);
    this.trimOpen();
    this.startSweeper();
    return visitor;
  }

  /**
   * Nueva demo: copia la base molde con VACUUM INTO (copia consistente aunque la base esté en
   * uso). `template` tiene que ser la base principal, no la de un visitante.
   */
  async create(template: { $executeRawUnsafe: (q: string) => Promise<unknown> }): Promise<DemoVisitor> {
    const now = Date.now();
    this.created = this.created.filter((t) => now - t < 60e3);
    if (this.created.length >= MAX_NEW_PER_MINUTE) throw Object.assign(new Error('Hay mucha gente probando la demo. Probá de nuevo en un minuto.'), { status: 429 });
    this.created.push(now);
    fs.mkdirSync(this.dir(), { recursive: true });
    const id = crypto.randomBytes(16).toString('hex');
    const target = this.file(id).split(path.sep).join('/').replace(/'/g, "''");
    await template.$executeRawUnsafe(`VACUUM INTO '${target}'`);
    const visitor = this.connect(id);
    this.cleanFiles();
    return visitor;
  }

  /** La demo de esta cookie, si todavía existe. */
  get(id: string | null): DemoVisitor | null {
    if (!id || !ID_RE.test(id)) return null;
    const known = this.open.get(id);
    if (known) { known.lastUsed = Date.now(); return known; }
    const file = this.file(id);
    if (!fs.existsSync(file)) return null;
    try { const t = new Date(); fs.utimesSync(file, t, t); } catch { /* sigue igual */ }
    return this.connect(id);
  }

  private close(id: string) {
    const v = this.open.get(id);
    if (!v) return;
    this.open.delete(id);
    v.client.$disconnect().catch(() => {});
  }

  private trimOpen() {
    if (this.open.size <= MAX_OPEN) return;
    const byAge = [...this.open.values()].sort((a, b) => a.lastUsed - b.lastUsed);
    for (const v of byAge.slice(0, this.open.size - MAX_OPEN)) this.close(v.id);
  }

  /** Borra las demos vencidas y, si hay demasiadas, las más viejas. */
  private cleanFiles() {
    let entries: { id: string; mtime: number }[] = [];
    try {
      entries = fs.readdirSync(this.dir())
        .filter((f) => /^[a-f0-9]{32}\.db$/.test(f))
        .map((f) => {
          const id = f.slice(0, -3);
          const opened = this.open.get(id);
          const mtime = Math.max(fs.statSync(this.file(id)).mtimeMs, opened?.lastUsed || 0);
          return { id, mtime };
        })
        .sort((a, b) => b.mtime - a.mtime);
    } catch { return; }
    const now = Date.now();
    entries.forEach((e, i) => {
      if (now - e.mtime < KEEP_MS && i < MAX_FILES) return;
      this.close(e.id);
      for (const suffix of ['', '-journal', '-wal', '-shm']) {
        try { fs.unlinkSync(this.file(e.id) + suffix); } catch { /* ya no estaba */ }
      }
    });
  }

  private startSweeper() {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      const now = Date.now();
      for (const v of [...this.open.values()]) if (now - v.lastUsed > IDLE_CLOSE_MS) this.close(v.id);
      this.cleanFiles();
    }, 5 * 60e3);
    this.sweeper.unref();
  }
}

export const demoVisitors = new DemoVisitors();

export function readDemoCookie(req: any): string | null {
  const raw = String(req.headers?.cookie || '').split(';').map((c) => c.trim()).find((c) => c.startsWith(COOKIE + '='));
  return raw ? raw.slice(COOKIE.length + 1) : null;
}

export function setDemoCookie(req: any, res: any, id: string) {
  const secure = req.secure || String(req.headers?.['x-forwarded-proto'] || '').includes('https');
  res.setHeader('Set-Cookie', `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${KEEP_MS / 1000}${secure ? '; Secure' : ''}`);
}

/**
 * Middleware de Express (solo en la demo): cada pedido /api corre dentro de la base de su
 * visitante. Va DESPUÉS de leer el cuerpo del pedido: el lector del cuerpo sigue en otro
 * contexto asíncrono y se perdería a qué visitante pertenece.
 *
 * Sin demo propia (cookie vencida o ninguna) se puede leer la base molde (la pantalla de
 * entrada consulta cosas antes de "Probar"), pero no cambiarla.
 */
export function demoVisitorMiddleware(req: any, res: any, next: () => void) {
  const url: string = req.originalUrl || req.url || '';
  if (!url.startsWith('/api/') || url.startsWith('/api/demo/start')) return next();
  // Las copias de seguridad trabajan sobre el archivo de la base molde, no sobre la del visitante
  if (url.startsWith('/api/system/backup')) {
    return res.status(403).json({ statusCode: 403, message: 'En la demo no se hacen copias de seguridad.' });
  }
  const visitor = demoVisitors.get(readDemoCookie(req));
  if (visitor) return demoContext.run(visitor, next);
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  res.status(401).json({ statusCode: 401, message: 'Tu demo terminó. Entrá de nuevo para empezar otra.', demoExpired: true });
}

/**
 * Envuelve PrismaService: dentro de un pedido de un visitante, las consultas van a su base.
 * Los métodos propios de PrismaService (arranque, mantenimiento) siguen en la base molde.
 */
export function routeToVisitor<T extends object>(base: T): T {
  const own = new Set<PropertyKey>(Object.getOwnPropertyNames(Object.getPrototypeOf(base)));
  return new Proxy(base, {
    get(target, prop) {
      const visitor = demoContext.getStore();
      if (visitor && !own.has(prop)) {
        const v = (visitor.client as any)[prop];
        if (v !== undefined) return typeof v === 'function' ? v.bind(visitor.client) : v;
      }
      const v = Reflect.get(target, prop, target);
      // Atado a la base molde: si la consulta sigue después de que cambie el contexto, no se cruza
      return typeof v === 'function' && typeof prop === 'string' && prop.startsWith('$') ? v.bind(target) : v;
    },
  });
}
