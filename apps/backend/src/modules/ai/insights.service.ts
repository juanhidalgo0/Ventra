import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/** Una consulta que pidió la IA (ver ASK_PLAN_SCHEMA en firebase/functions/ai.js) */
export interface AskQuery {
  tipo: string;
  desde?: string;
  hasta?: string;
  agrupar?: string;
  orden?: string;
  buscar?: string;
  limite?: number;
  dias?: number;
}

const SKIP_PRODUCTS = ['PAGO_CTA_CTE'];
const DAY = 864e5;
const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const arDate = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const METHODS: Record<string, string> = { CASH: 'Efectivo', CLOVER: 'Tarjeta (posnet)', MERCADOPAGO: 'Mercado Pago', TRANSFER: 'Transferencia', CARD: 'Tarjeta', DEBIT: 'Débito', CREDIT: 'Crédito', ACCOUNT: 'Cuenta corriente', CUENTA_CORRIENTE: 'Cuenta corriente', DEBT: 'Cuenta corriente', QR: 'QR', MIXED: 'Mixto' };

/**
 * "Preguntale a tu negocio": las consultas que puede pedir la IA. Son fijas y de solo lectura:
 * la IA elige cuáles y con qué fechas, la PC las corre y le devuelve los números para redactar.
 */
@Injectable()
export class InsightsService {
  constructor(private prisma: PrismaService) {}

  /** desde/hasta en días de Argentina (hasta incluido). Sin fechas válidas: los últimos 30 días. */
  range(desde?: string, hasta?: string) {
    const ok = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
    const today = arDate(new Date());
    const to = ok(hasta) ? hasta! : today;
    const from = ok(desde) ? desde! : arDate(new Date(new Date(`${to}T12:00:00-03:00`).getTime() - 29 * DAY));
    const start = new Date(`${from}T00:00:00-03:00`);
    const end = new Date(new Date(`${to}T00:00:00-03:00`).getTime() + DAY);
    return { from, to, start, end: end > start ? end : new Date(start.getTime() + DAY) };
  }

  async run(queries: AskQuery[]) {
    const out: any[] = [];
    for (const q of (queries || []).slice(0, 3)) {
      try {
        out.push({ consulta: q.tipo, ...(await this.one(q)) });
      } catch (err: any) {
        out.push({ consulta: q.tipo, error: 'No se pudo calcular' });
      }
    }
    return out;
  }

  private one(q: AskQuery) {
    const limit = Math.min(50, Math.max(1, Number(q.limite) || 10));
    switch (q.tipo) {
      case 'ventas': return this.sales(q);
      case 'productos': return this.products(q, limit);
      case 'sin_ventas': return this.notSelling(Math.min(365, Math.max(1, Number(q.dias) || 30)));
      case 'stock_bajo': return this.lowStock();
      case 'stock_valorizado': return this.stockValue();
      case 'deudores': return this.debtors(limit);
      case 'cliente': return this.client(q);
      case 'gastos': return this.expenses(q);
      case 'compras': return this.purchases(q);
      default: return Promise.resolve({ error: 'Consulta desconocida' });
    }
  }

  private async sales(q: AskQuery) {
    const { from, to, start, end } = this.range(q.desde, q.hasta);
    const where = { status: 'COMPLETED', createdAt: { gte: start, lt: end } };
    const by = q.agrupar || 'ninguno';
    const periodo = { desde: from, hasta: to };
    if (by === 'medio_de_pago') {
      const pays = await this.prisma.payment.findMany({ where: { sale: where }, select: { method: true, amount: true } });
      const g = new Map<string, number>();
      for (const p of pays) { const k = METHODS[p.method] || p.method; g.set(k, (g.get(k) || 0) + p.amount); }
      const total = [...g.values()].reduce((a, b) => a + b, 0);
      return { periodo, total: r2(total), porMedioDePago: [...g].sort((a, b) => b[1] - a[1]).map(([medio, monto]) => ({ medio, monto: r2(monto) })) };
    }
    const sales = await this.prisma.sale.findMany({ where, select: { total: true, createdAt: true, userId: true } });
    const total = sales.reduce((a, s) => a + s.total, 0);
    const resumen = { periodo, total: r2(total), ventas: sales.length, ticketPromedio: sales.length ? r2(total / sales.length) : 0 };
    if (by === 'ninguno' || !by) return resumen;
    let users = new Map<string, string>();
    if (by === 'vendedor') {
      const list = await this.prisma.user.findMany({ select: { id: true, fullName: true, username: true } });
      users = new Map(list.map((u) => [u.id, u.fullName || u.username]));
    }
    const keyOf = (d: Date, userId: string) => {
      const day = arDate(d);
      const local = new Date(d.toLocaleString('en-US', { timeZone: 'America/Argentina/Buenos_Aires' }));
      if (by === 'dia') return day;
      if (by === 'mes') return day.slice(0, 7);
      if (by === 'semana') { const dt = new Date(`${day}T12:00:00-03:00`); const back = (dt.getUTCDay() + 6) % 7; return `semana del ${arDate(new Date(dt.getTime() - back * DAY))}`; }
      if (by === 'dia_de_semana') return WEEKDAYS[local.getDay()];
      if (by === 'hora') return `${String(local.getHours()).padStart(2, '0')} h`;
      if (by === 'vendedor') return users.get(userId) || 'Sin usuario';
      return 'total';
    };
    const g = new Map<string, { total: number; ventas: number }>();
    for (const s of sales) {
      const k = keyOf(s.createdAt, s.userId);
      const cur = g.get(k) || { total: 0, ventas: 0 };
      cur.total += s.total; cur.ventas++;
      g.set(k, cur);
    }
    const sortable = by === 'dia' || by === 'mes' || by === 'semana' || by === 'hora';
    const rows = [...g].map(([grupo, v]) => ({ grupo, total: r2(v.total), ventas: v.ventas, ticketPromedio: r2(v.total / v.ventas) }));
    rows.sort(sortable ? (a, b) => a.grupo.localeCompare(b.grupo) : (a, b) => b.total - a.total);
    return { ...resumen, agrupadoPor: by, grupos: rows.slice(0, 100) };
  }

  private async products(q: AskQuery, limit: number) {
    const { from, to, start, end } = this.range(q.desde, q.hasta);
    const grouped = await this.prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: { status: 'COMPLETED', createdAt: { gte: start, lt: end } }, productId: { notIn: SKIP_PRODUCTS } },
      _sum: { quantity: true, total: true },
    });
    const products = await this.prisma.product.findMany({
      where: { id: { in: grouped.map((g) => g.productId) } },
      select: { id: true, name: true, costPrice: true, stock: true, category: { select: { name: true } }, brand: { select: { name: true } } },
    });
    const byId = new Map(products.map((p) => [p.id, p]));
    const search = norm(q.buscar || '');
    let rows = grouped.map((g) => {
      const p = byId.get(g.productId);
      const units = Number(g._sum.quantity) || 0;
      const revenue = Number(g._sum.total) || 0;
      return {
        producto: p?.name || 'Producto borrado',
        categoria: p?.category?.name || null,
        marca: p?.brand?.name || null,
        unidades: r2(units),
        vendido: r2(revenue),
        gananciaEstimada: p && p.costPrice > 0 ? r2(revenue - units * p.costPrice) : null,
        stockActual: p ? r2(p.stock) : null,
      };
    });
    if (search) rows = rows.filter((r) => [r.producto, r.categoria, r.marca].some((v) => v && norm(v).includes(search)));
    const key = q.orden === 'plata' ? 'vendido' : q.orden === 'ganancia' ? 'gananciaEstimada' : 'unidades';
    rows.sort(q.orden === 'menos_vendidos' ? (a, b) => a.unidades - b.unidades : (a, b) => (Number(b[key]) || 0) - (Number(a[key]) || 0));
    const total = rows.reduce((a, r) => a + r.vendido, 0);
    return {
      periodo: { desde: from, hasta: to },
      ...(search ? { busqueda: q.buscar } : {}),
      productosDistintos: rows.length,
      totalVendido: r2(total),
      unidadesTotales: r2(rows.reduce((a, r) => a + r.unidades, 0)),
      productos: rows.slice(0, limit),
    };
  }

  private async notSelling(days: number) {
    const since = new Date(Date.now() - days * DAY);
    const sold = await this.prisma.saleItem.findMany({ where: { sale: { createdAt: { gte: since } } }, select: { productId: true }, distinct: ['productId'] });
    const soldIds = new Set(sold.map((s) => s.productId));
    const products = await this.prisma.product.findMany({
      where: { isActive: true, stock: { gt: 0 }, id: { notIn: ['VENTA_RAPIDA', ...SKIP_PRODUCTS] } },
      select: { id: true, name: true, stock: true, costPrice: true },
    });
    const rows = products.filter((p) => !soldIds.has(p.id)).map((p) => ({ producto: p.name, stock: r2(p.stock), plataParada: r2(p.stock * p.costPrice) }));
    rows.sort((a, b) => b.plataParada - a.plataParada);
    return { dias: days, cantidad: rows.length, plataParadaAlCosto: r2(rows.reduce((a, r) => a + r.plataParada, 0)), productos: rows.slice(0, 30) };
  }

  private async lowStock() {
    const products = await this.prisma.product.findMany({
      where: { isActive: true, unlimitedStock: false, id: { notIn: ['VENTA_RAPIDA', ...SKIP_PRODUCTS] } },
      select: { name: true, stock: true, minStock: true },
    });
    const rows = products.filter((p) => p.stock <= 0 || (p.minStock > 0 && p.stock <= p.minStock))
      .map((p) => ({ producto: p.name, stock: r2(p.stock), minimo: r2(p.minStock) }))
      .sort((a, b) => a.stock - b.stock);
    return { sinStock: rows.filter((r) => r.stock <= 0).length, enElMinimo: rows.filter((r) => r.stock > 0).length, productos: rows.slice(0, 50) };
  }

  private async stockValue() {
    const products = await this.prisma.product.findMany({
      where: { isActive: true, unlimitedStock: false, stock: { gt: 0 }, id: { notIn: ['VENTA_RAPIDA', ...SKIP_PRODUCTS] } },
      select: { stock: true, costPrice: true, salePrice: true },
    });
    const cost = products.reduce((a, p) => a + p.stock * p.costPrice, 0);
    const sale = products.reduce((a, p) => a + p.stock * p.salePrice, 0);
    return { productosConStock: products.length, alCosto: r2(cost), aPrecioDeVenta: r2(sale), sinCostoCargado: products.filter((p) => !p.costPrice).length };
  }

  private async debtors(limit: number) {
    const clients = await this.prisma.client.findMany({ where: { balance: { gt: 0.5 } }, select: { name: true, balance: true, creditLimit: true, phone: true }, orderBy: { balance: 'desc' } });
    return {
      clientesQueDeben: clients.length,
      totalAdeudado: r2(clients.reduce((a, c) => a + c.balance, 0)),
      clientes: clients.slice(0, limit).map((c) => ({ cliente: c.name, debe: r2(c.balance), limite: c.creditLimit ?? null, pasoElLimite: !!c.creditLimit && c.balance > c.creditLimit })),
    };
  }

  private async client(q: AskQuery) {
    const search = norm(q.buscar || '');
    if (!search) return { error: 'Falta el nombre del cliente' };
    const all = await this.prisma.client.findMany({ select: { id: true, name: true, balance: true } });
    const matches = all.filter((c) => norm(c.name).includes(search));
    if (!matches.length) return { encontrado: false, buscado: q.buscar };
    const c = matches.sort((a, b) => a.name.length - b.name.length)[0];
    const { from, to, start, end } = this.range(q.desde, q.hasta);
    const sales = await this.prisma.sale.findMany({
      where: { clientId: c.id, status: 'COMPLETED', createdAt: { gte: start, lt: end } },
      select: { total: true, createdAt: true, items: { select: { productName: true, quantity: true, total: true } } },
      orderBy: { createdAt: 'desc' },
    });
    const g = new Map<string, { unidades: number; plata: number }>();
    for (const s of sales) for (const it of s.items) {
      const cur = g.get(it.productName) || { unidades: 0, plata: 0 };
      cur.unidades += it.quantity; cur.plata += it.total;
      g.set(it.productName, cur);
    }
    const last = await this.prisma.sale.findFirst({ where: { clientId: c.id, status: 'COMPLETED' }, select: { createdAt: true }, orderBy: { createdAt: 'desc' } });
    return {
      cliente: c.name,
      otrosConNombreParecido: matches.length > 1 ? matches.slice(1, 5).map((m) => m.name) : undefined,
      periodo: { desde: from, hasta: to },
      compras: sales.length,
      totalComprado: r2(sales.reduce((a, s) => a + s.total, 0)),
      saldoCuentaCorriente: r2(c.balance),
      ultimaCompra: last ? arDate(last.createdAt) : null,
      productosMasComprados: [...g].sort((a, b) => b[1].plata - a[1].plata).slice(0, 10).map(([producto, v]) => ({ producto, unidades: r2(v.unidades), plata: r2(v.plata) })),
    };
  }

  private async expenses(q: AskQuery) {
    const { from, to, start, end } = this.range(q.desde, q.hasta);
    const rows = await this.prisma.cashMovement.findMany({ where: { type: 'EXPENSE', createdAt: { gte: start, lt: end } }, select: { amount: true, description: true } });
    const g = new Map<string, { concepto: string; monto: number; veces: number }>();
    for (const m of rows) {
      // Sin las marcas internas entre corchetes ("[gasto-…]")
      const label = String(m.description || '').replace(/\s*\[[^\]]*\]\s*/g, ' ').trim() || 'Sin detalle';
      const k = norm(label);
      const cur = g.get(k) || { concepto: label, monto: 0, veces: 0 };
      cur.monto += Math.abs(m.amount); cur.veces++;
      g.set(k, cur);
    }
    const list = [...g.values()].sort((a, b) => b.monto - a.monto);
    return { periodo: { desde: from, hasta: to }, total: r2(list.reduce((a, x) => a + x.monto, 0)), cantidad: rows.length, porConcepto: list.slice(0, 20).map((x) => ({ ...x, monto: r2(x.monto) })) };
  }

  private async purchases(q: AskQuery) {
    const { from, to, start, end } = this.range(q.desde, q.hasta);
    const rows = await this.prisma.purchase.findMany({
      where: { status: 'COMPLETED', createdAt: { gte: start, lt: end } },
      select: { total: true, paymentStatus: true, supplier: { select: { name: true } } },
    });
    const g = new Map<string, { proveedor: string; total: number; compras: number; impago: number }>();
    for (const p of rows) {
      const k = p.supplier?.name || 'Sin proveedor';
      const cur = g.get(k) || { proveedor: k, total: 0, compras: 0, impago: 0 };
      cur.total += p.total; cur.compras++;
      if (p.paymentStatus === 'OWED') cur.impago += p.total;
      g.set(k, cur);
    }
    const list = [...g.values()].sort((a, b) => b.total - a.total);
    return {
      periodo: { desde: from, hasta: to },
      total: r2(list.reduce((a, x) => a + x.total, 0)),
      compras: rows.length,
      porProveedor: list.slice(0, 20).map((x) => ({ ...x, total: r2(x.total), impago: r2(x.impago) })),
    };
  }
}
