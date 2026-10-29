import { BadRequestException, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../database/prisma.service';
import { NotifyService } from '../subscription/notify.service';
import { DEFAULT_BIG_AMOUNT, FOLLOW_UP_MS, FollowUp, VoidAction, VoidFacts, flagCashiers, scoreVoid } from './void-score';

/** Todo lo de este control va al historial de movimientos con este tipo (viaja por el sync) */
export const ENTITY = 'POS_VOID';
const SETTING_KEY = 'void_watch';
const CART_ACTIONS = new Set<VoidAction>(['ITEM_REMOVED', 'QTY_REDUCED', 'CART_CLEARED', 'HELD_CART_DELETED']);
/** Juntar varios sospechosos en un solo aviso al celular */
const NOTIFY_WINDOW_MS = 5 * 60 * 1000;
const NOTIFY_FLUSH_AT = 5;

interface Incoming {
  id?: string; action?: string; at?: string; userId?: string | null; userName?: string | null;
  sessionId?: string | null; terminal?: string | null;
  items?: { productId?: string; name?: string; quantity?: number; price?: number; secondsInCart?: number | null }[];
  amount?: number; totalBefore?: number; totalAfter?: number; totalShown?: boolean; secondsSinceTotal?: number | null;
  heldSince?: string; heldName?: string;
}

const num = (v: any) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const parse = (s: string | null) => { try { return s ? JSON.parse(s) : {}; } catch { return {}; } };

/**
 * Control de anulaciones: lo que los cajeros sacan del ticket y lo que se borra del catálogo.
 * Guarda cada quita, le pone un puntaje de sospecha (void-score.ts) y avisa al celular del
 * dueño solo lo sospechoso. Los cajeros no ven nada de esto: el listado es solo del ADMIN y
 * el aviso no sale en su campanita (notifications.controller).
 */
@Injectable()
export class PosTrailService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Anulaciones');
  /** Quitas recibidas EN ESTA PC que esperan los 3 minutos para evaluarse (sobrevive a un reinicio) */
  private readonly file = path.join(process.cwd(), 'ventra-pos-trail.json');
  private pending = new Set<string>();
  private timers = new Map<string, NodeJS.Timeout>();
  private toNotify: any[] = [];
  private notifyTimer: NodeJS.Timeout | null = null;

  constructor(private prisma: PrismaService, private notify: NotifyService) {}

  onModuleInit() {
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(saved.pending)) saved.pending.forEach((id: string) => this.pending.add(id));
      if (Array.isArray(saved.toNotify)) this.toNotify = saved.toNotify.slice(-50);
    } catch { /* primera vez */ }
    if (this.toNotify.length) setTimeout(() => this.flushNotify(), 60_000).unref?.();
    if (this.pending.size) setTimeout(() => [...this.pending].forEach((id) => this.schedule(id, 0)), 30_000).unref?.();
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearTimeout(t));
    if (this.notifyTimer) clearTimeout(this.notifyTimer);
  }

  private save() {
    try { fs.writeFileSync(this.file, JSON.stringify({ pending: [...this.pending].slice(-500), toNotify: this.toNotify })); } catch { /* sin disco */ }
  }

  async bigAmount(): Promise<number> {
    const row = await this.prisma.storeSetting.findUnique({ where: { id: SETTING_KEY } }).catch(() => null);
    const v = num(parse(row?.value ?? null).bigAmount);
    return v > 0 ? v : DEFAULT_BIG_AMOUNT;
  }

  async setBigAmount(value: number) {
    const v = Math.round(num(value));
    if (v < 100 || v > 100_000_000) throw new BadRequestException('Monto inválido');
    await this.prisma.storeSetting.upsert({
      where: { id: SETTING_KEY },
      create: { id: SETTING_KEY, value: JSON.stringify({ bigAmount: v }) },
      update: { value: JSON.stringify({ bigAmount: v }) },
    });
    return { bigAmount: v };
  }

  /** Lo que manda la caja (en tandas; lo que quedó en cola sin conexión llega después). */
  async ingest(requesterId: string, events: Incoming[]) {
    if (!Array.isArray(events)) throw new BadRequestException('Faltan los movimientos');
    const list = events.slice(0, 200).filter((e) => e && typeof e.id === 'string' && e.id.length <= 64 && CART_ACTIONS.has(e.action as VoidAction));
    if (!list.length) return { ok: true, saved: 0 };
    const existing = await this.prisma.auditLog.findMany({ where: { entityType: ENTITY, entityId: { in: list.map((e) => e.id!) } }, select: { entityId: true } });
    const seen = new Set(existing.map((e) => e.entityId));
    const userIds = [...new Set(list.map((e) => e.userId).filter(Boolean) as string[])];
    const known = new Set((await this.prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true } })).map((u) => u.id));
    let saved = 0;
    for (const e of list) {
      if (seen.has(e.id!)) continue;
      seen.add(e.id!);
      const at = new Date(e.at || Date.now());
      const createdAt = Number.isNaN(at.getTime()) || at.getTime() > Date.now() ? new Date() : at;
      const items = (Array.isArray(e.items) ? e.items : []).slice(0, 100).map((i) => ({
        productId: String(i.productId || '').slice(0, 80), name: String(i.name || 'Producto').slice(0, 120),
        quantity: num(i.quantity), price: num(i.price),
        secondsInCart: i.secondsInCart == null ? null : Math.max(0, Math.round(num(i.secondsInCart))),
      }));
      const data = {
        items,
        amount: Math.round(items.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100,
        totalBefore: num(e.totalBefore), totalAfter: num(e.totalAfter),
        totalShown: !!e.totalShown, secondsSinceTotal: e.secondsSinceTotal == null ? null : Math.round(num(e.secondsSinceTotal)),
        sessionId: e.sessionId ? String(e.sessionId).slice(0, 64) : null,
        userName: e.userName ? String(e.userName).slice(0, 80) : null,
        ...(e.heldSince ? { heldSince: String(e.heldSince).slice(0, 40), heldName: String(e.heldName || '').slice(0, 80) } : {}),
      };
      const row = await this.prisma.auditLog.create({
        data: {
          id: randomUUID(), entityType: ENTITY, entityId: e.id!, action: e.action!,
          userId: e.userId && known.has(e.userId) ? e.userId : requesterId || null,
          terminal: e.terminal ? String(e.terminal).slice(0, 60) : null,
          newValues: JSON.stringify(data), createdAt,
        },
      });
      saved++;
      this.pending.add(row.id);
      this.schedule(row.id, createdAt.getTime() + FOLLOW_UP_MS + 5000 - Date.now());
    }
    this.save();
    return { ok: true, saved };
  }

  /** Borrar del catálogo (uno o varios): queda registrado con quién fue. */
  async recordProductDeletion(userId: string | undefined, products: { id: string; name: string; stock: number; salePrice: number }[], bulk = false) {
    if (!products.length) return;
    try {
      const user = userId ? await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true, fullName: true } }) : null;
      const stock = products.reduce((s, p) => s + Math.max(0, num(p.stock)), 0);
      const data = {
        items: products.slice(0, 50).map((p) => ({ productId: p.id, name: p.name, quantity: Math.max(0, num(p.stock)), price: num(p.salePrice), secondsInCart: null })),
        count: products.length, stock, byAdmin: user?.role === 'ADMIN', userName: user?.fullName || null,
        amount: Math.round(products.reduce((s, p) => s + Math.max(0, num(p.stock)) * num(p.salePrice), 0) * 100) / 100,
      };
      const row = await this.prisma.auditLog.create({
        data: { entityType: ENTITY, entityId: randomUUID(), action: bulk || products.length > 1 ? 'PRODUCTS_BULK_DELETED' : 'PRODUCT_DELETED', userId: user?.id || null, newValues: JSON.stringify(data) },
      });
      await this.evaluate(row.id);
    } catch (err: any) {
      this.logger.warn(`No se pudo registrar el borrado: ${err?.message || err}`);
    }
  }

  private schedule(id: string, delay: number) {
    const old = this.timers.get(id);
    if (old) clearTimeout(old);
    const t = setTimeout(() => { this.timers.delete(id); this.evaluate(id).catch(() => {}); }, Math.max(0, delay));
    t.unref?.();
    this.timers.set(id, t);
  }

  /** Puntaje final (ya pasaron los 3 minutos): se guarda en la fila y, si es sospechoso, se avisa. */
  private async evaluate(id: string) {
    const row = await this.prisma.auditLog.findUnique({ where: { id }, include: { user: { select: { fullName: true, username: true } } } });
    this.pending.delete(id);
    this.save();
    if (!row || row.entityType !== ENTITY) return;
    const data = parse(row.newValues);
    if (data.scored) return;
    const follow = CART_ACTIONS.has(row.action as VoidAction) ? (await this.followUps([row])).get(row.id) : undefined;
    const result = scoreVoid({ ...data, action: row.action as VoidAction }, follow?.follow, await this.bigAmount());
    await this.prisma.auditLog.update({ where: { id }, data: { newValues: JSON.stringify({ ...data, scored: true, score: result.score, level: result.level, reasons: result.reasons }) } });
    if (result.level !== 'sospechoso') return;
    this.toNotify.push({
      user: row.user?.fullName || data.userName || row.user?.username || 'Un empleado',
      action: row.action, amount: num(data.amount), terminal: row.terminal || null,
      reason: result.reasons[0] || '', at: row.createdAt.toISOString(),
    });
    this.save();
    if (this.toNotify.length >= NOTIFY_FLUSH_AT) return this.flushNotify();
    if (!this.notifyTimer) {
      this.notifyTimer = setTimeout(() => this.flushNotify(), NOTIFY_WINDOW_MS);
      this.notifyTimer.unref?.();
    }
  }

  private flushNotify() {
    if (this.notifyTimer) { clearTimeout(this.notifyTimer); this.notifyTimer = null; }
    const items = this.toNotify.splice(0);
    this.save();
    if (items.length) this.notify.enqueue('suspiciousVoid', { items });
  }

  /**
   * Qué pasó en la misma caja en los 3 minutos siguientes a cada quita: si hubo venta, cuál, y
   * si esa venta volvió a cobrar algo de lo quitado. Las que todavía no cumplieron los 3 minutos
   * quedan sin seguimiento (puntaje provisorio).
   */
  private async followUps(rows: { id: string; createdAt: Date; userId: string | null; newValues: string | null }[]) {
    const out = new Map<string, { follow?: FollowUp; next?: { saleNumber: number; at: string; total: number } }>();
    if (!rows.length) return out;
    const times = rows.map((r) => r.createdAt.getTime());
    const from = new Date(Math.min(...times)), to = new Date(Math.max(...times) + FOLLOW_UP_MS);
    const sessions = [...new Set(rows.map((r) => parse(r.newValues).sessionId).filter(Boolean))] as string[];
    const users = [...new Set(rows.map((r) => r.userId).filter(Boolean))] as string[];
    const sales = await this.prisma.sale.findMany({
      where: { createdAt: { gte: from, lte: to }, status: { in: ['COMPLETED', 'INTERNAL'] }, OR: [{ sessionId: { in: sessions } }, { userId: { in: users } }] },
      select: { saleNumber: true, sessionId: true, userId: true, total: true, createdAt: true, items: { select: { productId: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const now = Date.now();
    for (const r of rows) {
      const d = parse(r.newValues);
      const t = r.createdAt.getTime();
      const after = sales.filter((s) => (d.sessionId ? s.sessionId === d.sessionId : s.userId === r.userId) && s.createdAt.getTime() >= t && s.createdAt.getTime() <= t + FOLLOW_UP_MS);
      const removed = new Set((d.items || []).map((i: any) => i.productId));
      const next = after[0] ? { saleNumber: after[0].saleNumber, at: after[0].createdAt.toISOString(), total: after[0].total } : undefined;
      const known = now - t >= FOLLOW_UP_MS;
      out.set(r.id, {
        next,
        follow: known ? { saleAfter: after.length > 0, sameProductResold: after.some((s) => s.items.some((i) => removed.has(i.productId))) } : undefined,
      });
    }
    return out;
  }

  /** Listado para la pantalla del dueño, con puntaje, motivos, seguimiento y ranking de cajeros. */
  async list(q: { from?: string; to?: string; userId?: string; level?: string }) {
    const day = /^\d{4}-\d{2}-\d{2}$/;
    const today = new Date();
    const fromD = day.test(String(q.from)) ? new Date(`${q.from}T00:00:00`) : new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6);
    const toD = day.test(String(q.to)) ? new Date(`${q.to}T23:59:59.999`) : new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
    const rows = await this.prisma.auditLog.findMany({
      where: { entityType: ENTITY, createdAt: { gte: fromD, lte: toD } },
      include: { user: { select: { id: true, fullName: true, username: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 3000,
    });
    const big = await this.bigAmount();
    const cartRows = rows.filter((r) => CART_ACTIONS.has(r.action as VoidAction));
    const follow = await this.followUps(cartRows);

    const events = rows.map((r) => {
      const d = parse(r.newValues);
      const f = follow.get(r.id);
      const s = scoreVoid({ ...d, action: r.action as VoidAction } as VoidFacts, f?.follow, big);
      return {
        id: r.id, action: r.action, at: r.createdAt.toISOString(), terminal: r.terminal,
        userId: r.userId, userName: r.user?.fullName || d.userName || r.user?.username || 'Sin usuario',
        items: d.items || [], amount: num(d.amount), totalBefore: num(d.totalBefore), totalAfter: num(d.totalAfter),
        totalShown: !!d.totalShown, secondsSinceTotal: d.secondsSinceTotal ?? null,
        count: d.count ?? null, heldSince: d.heldSince || null, heldName: d.heldName || null,
        nextSale: f?.next || null, score: s.score, level: s.level, reasons: s.reasons, pending: s.pending,
      };
    });

    // Ranking: quitas del ticket cada 100 ventas, por cajero
    const salesBy = await this.prisma.sale.groupBy({ by: ['userId'], where: { createdAt: { gte: fromD, lte: toD }, status: 'COMPLETED' }, _count: { _all: true } });
    const stats = new Map<string, { userId: string; userName: string; sales: number; voids: number; amount: number; suspicious: number; review: number }>();
    const stat = (id: string, name: string) => {
      if (!stats.has(id)) stats.set(id, { userId: id, userName: name, sales: 0, voids: 0, amount: 0, suspicious: 0, review: 0 });
      return stats.get(id)!;
    };
    const names = new Map((await this.prisma.user.findMany({ where: { id: { in: salesBy.map((s) => s.userId) } }, select: { id: true, fullName: true, username: true } })).map((u) => [u.id, u.fullName || u.username]));
    for (const s of salesBy) stat(s.userId, names.get(s.userId) || 'Sin usuario').sales = s._count._all;
    for (const e of events) {
      if (!e.userId || !CART_ACTIONS.has(e.action as VoidAction)) continue;
      const st = stat(e.userId, e.userName);
      st.voids++; st.amount += e.amount;
      if (e.level === 'sospechoso') st.suspicious++;
      else if (e.level === 'revisar') st.review++;
    }
    const all = [...stats.values()];
    const flagged = flagCashiers(all);
    const cashiers = all
      .filter((c) => c.voids > 0)
      .map((c) => ({ ...c, amount: Math.round(c.amount), per100: c.sales ? Math.round((c.voids / c.sales) * 1000) / 10 : null, flagged: flagged.has(c.userId) }))
      .sort((a, b) => b.suspicious - a.suspicious || b.amount - a.amount);

    const filtered = events.filter((e) => (!q.userId || e.userId === q.userId) && (!q.level || q.level === 'all' || e.level === q.level || (q.level === 'alertas' && e.level !== 'normal')));
    return {
      from: fromD.toISOString(), to: toD.toISOString(), bigAmount: big,
      totals: {
        count: events.length,
        amount: Math.round(events.filter((e) => CART_ACTIONS.has(e.action as VoidAction)).reduce((s, e) => s + e.amount, 0)),
        suspicious: events.filter((e) => e.level === 'sospechoso').length,
        review: events.filter((e) => e.level === 'revisar').length,
      },
      cashiers,
      events: filtered,
    };
  }
}
