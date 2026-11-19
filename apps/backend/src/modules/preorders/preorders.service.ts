import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { nextDocNumber } from '../sync/numbering';
import { applyCombos, combosFromPromotions, comboShares, COMBO_TYPES } from './combos';

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const INCLUDE = {
  client: { select: { id: true, name: true, address: true, locality: true, phone: true, cuit: true, dni: true, ivaCondition: true } },
  user: { select: { fullName: true, username: true } },
  items: true,
};

/**
 * Preventa: el vendedor toma el pedido en el celular (con o sin señal) y en la PC se pasa a la
 * caja, donde se cobra como una venta normal. El pedido en sí no mueve stock ni plata.
 */
@Injectable()
export class PreOrdersService {
  constructor(private prisma: PrismaService) {}

  list(q: { status?: string; from?: string; to?: string; clientId?: string; locality?: string; userId?: string; unassigned?: boolean }) {
    const where: any = {};
    if (q.unassigned) where.runId = null;
    if (q.status && q.status !== 'ALL') where.status = q.status;
    if (q.from || q.to) {
      where.createdAt = {};
      if (q.from) where.createdAt.gte = new Date(q.from);
      if (q.to) where.createdAt.lte = new Date(q.to);
    }
    if (q.clientId) where.clientId = q.clientId;
    else if (q.locality) where.client = { locality: q.locality };
    if (q.userId) where.userId = q.userId;
    return (this.prisma as any).preOrder.findMany({ where, include: INCLUDE, orderBy: { createdAt: 'desc' }, take: 500 });
  }

      async lastByClient() {
    const since = new Date(Date.now() - 120 * 86400000);
    const orders = await (this.prisma as any).preOrder.findMany({
      where: { status: { in: ['PENDING', 'BILLED'] }, clientId: { not: null }, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, clientId: true, orderNumber: true, createdAt: true, items: { select: { productId: true, productName: true, quantity: true, packSize: true } } },
      take: 3000,
    });
    const out: Record<string, any> = {};
    for (const o of orders) if (!out[o.clientId] && o.items.length) out[o.clientId] = { id: o.id, orderNumber: o.orderNumber, date: o.createdAt, items: o.items };
    return out;
  }

  async committed() {
    const items = await (this.prisma as any).preOrderItem.findMany({ where: { order: { status: 'PENDING' } }, select: { productId: true, quantity: true } });
    const out: Record<string, number> = {};
    for (const it of items) out[it.productId] = Math.round(((out[it.productId] || 0) + it.quantity) * 1000) / 1000;
    return out;
  }

  async findOne(id: string) {
    const order = await (this.prisma as any).preOrder.findUnique({ where: { id }, include: INCLUDE });
    if (!order) throw new NotFoundException('Pedido no encontrado');
    return order;
  }

    async save(id: string, data: any, userId: string, canSetPrices = false) {
    if (!/^[\w-]{8,64}$/.test(id || '')) throw new BadRequestException('Pedido inválido');
    // Pedido de la tienda online aceptado: entra una sola vez (si otro equipo ya lo pasó, se
    // devuelve ese sin tocarlo, aunque ya lo hayan editado o haya salido en un reparto) y siempre
    // con los precios del catálogo, aunque lo acepte el dueño: el precio lo eligió el cliente en la tienda.
    const fromOnline = data?.fromOnline === true;
    if (fromOnline) {
      const existing = await (this.prisma as any).preOrder.findUnique({ where: { id }, include: INCLUDE });
      if (existing) return existing;
      canSetPrices = false;
    }
    const parsed = (Array.isArray(data?.items) ? data.items : [])
      .map((i: any) => {
        const quantity = Number(i.quantity);
        // Un renglón de combo que vuelve al editar el pedido: cuenta como suelto (el combo se arma de nuevo abajo)
        const unitPrice = i.promoId && Number(i.regularPrice) > 0 ? Number(i.regularPrice) : Number(i.unitPrice);
        const packSize = Number(i.packSize) > 1 ? Math.round(Number(i.packSize)) : null;
        return {
          productId: String(i.productId || ''),
          productName: String(i.productName || 'Producto').slice(0, 200),
          quantity, packSize, unitPrice,
          total: round2(quantity * unitPrice),
        } as any;
      })
      .filter((i: any) => i.productId && Number.isFinite(i.quantity) && i.quantity > 0 && Number.isFinite(i.unitPrice) && i.unitPrice >= 0);
    // El mismo producto, de la misma forma y al mismo precio, va en un solo renglón
    const items: any[] = [];
    for (const it of parsed) {
      const same = items.find((x) => x.productId === it.productId && x.packSize === it.packSize && Math.abs(x.unitPrice - it.unitPrice) < 1e-9);
      if (same) { same.quantity += it.quantity; same.total = round2(same.quantity * same.unitPrice); } else items.push(it);
    }
        if (!items.length) throw new BadRequestException('El pedido no tiene productos');
    // Lista Mayorista: el cliente paga el precio mayorista de la unidad (y del bulto, si le sale más barato así) y el de los combos
    const orderClient = data?.clientId ? await (this.prisma as any).client.findUnique({ where: { id: String(data.clientId) }, select: { priceList: true, tradeDiscountPercentage: true } }) : null;
    const isTrade = orderClient?.priceList === 'TRADE';
    const existingItems: any[] = await (this.prisma as any).preOrderItem.findMany({ where: { orderId: id }, select: { productId: true, packSize: true, unitPrice: true, promoId: true, regularPrice: true } });
    // Precios del catálogo: el del bulto si va por bulto, si no el de la unidad. Así un pedido
    // tomado en el celular no puede salir con un precio inventado (el dueño sí puede cambiarlo).
    //
    // Vale el precio del momento en que se tomó el pedido: el de un renglón que ya estaba en el
    // pedido no cambia al editarlo, y uno tomado sin señal antes de un aumento entra con el precio
    // de antes (si el celular manda ese, y solo si es el que tenía el producto: no se inventa).
    if (!canSetPrices) {
      const ids = [...new Set(items.map((i: any) => i.productId))] as string[];
      const products = await (this.prisma as any).product.findMany({
        where: { id: { in: ids } },
        select: { id: true, salePrice: true, unitsPerPack: true, packPrice: true, packDiscount: true, wholesalePrice: true, wholesaleMinQty: true, tradePrice: true },
      });
      const tradeOff = Number(orderClient?.tradeDiscountPercentage) || 0;
      const retailUnit = (p: any) => {
        const sale = Number(p.salePrice) || 0;
        if (!isTrade) return sale;
        if (Number(p.tradePrice) > 0) return Number(p.tradePrice);
        return tradeOff > 0 ? Math.round(sale * (1 - tradeOff / 100) * 100) / 100 : sale;
      };
      const prev: any[] = ids.length ? await this.prisma.$queryRawUnsafe<any[]>(
        `SELECT id, CAST(prev_sale_price AS REAL) AS ps, CAST(prev_pack_price AS REAL) AS pp, CAST(price_changed_at AS REAL) AS at FROM products WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids,
      ).catch(() => []) : [];
      const prevById = new Map(prev.map((r: any) => [r.id, r]));
      const byId = new Map(products.map((p: any) => [p.id, p]));
      // El renglón que estaba en un combo guarda aparte su precio suelto
      const kept = new Map(existingItems.map((e) => [`${e.productId}|${e.packSize || ''}`, e.promoId && Number(e.regularPrice) > 0 ? Number(e.regularPrice) : Number(e.unitPrice)]));
      const takenRaw = data?.takenAt ? new Date(data.takenAt).getTime() : NaN;
      const takenAt = Number.isFinite(takenRaw) ? Math.min(Date.now(), Math.max(Date.now() - 7 * 86400000, takenRaw)) : Date.now();
      const unitOf = (salePrice: number, packPrice: number, packSize: number | null, looseUnit?: number) => packSize
        ? (packPrice > 0 ? packPrice : salePrice * packSize) / packSize
        : looseUnit ?? (salePrice || 0);
      for (const it of items) {
        const p: any = byId.get(it.productId);
        if (!p) throw new BadRequestException(`El producto "${it.productName}" ya no está en el catálogo`);
        const byPack = it.packSize && Number(p.unitsPerPack) === it.packSize;
        if (!byPack) it.packSize = null;
        const asked = it.unitPrice;
        let unit = unitOf(Number(p.salePrice), Number(p.packPrice), it.packSize, retailUnit(p));
        // Bulto con % de descuento: la unidad de la lista del cliente con el % (packOf/packForClient en la caja)
        const packOff = Number(p.packDiscount) || 0;
        if (it.packSize && packOff > 0 && packOff < 100) unit = Math.round(retailUnit(p) * (1 - packOff / 100) * 10000) / 10000;
        // Al mayorista, cada unidad del bulto no le sale más cara que su unidad suelta (packForClient en la caja)
        else if (it.packSize && isTrade && (Number(p.tradePrice) > 0 || tradeOff > 0)) unit = Math.min(unit, retailUnit(p));
        const before = kept.get(`${it.productId}|${it.packSize || ''}`);
        const pr: any = prevById.get(it.productId);
        if (before !== undefined) unit = before;
        else if (pr && Number(pr.at) > takenAt && pr.ps !== null) {
          const old = unitOf(Number(pr.ps), Number(pr.pp) || 0, it.packSize);
          if (Math.abs(asked - old) < 0.01) unit = old;
        }
        it.unitPrice = unit;
        it.total = round2(it.quantity * unit);
      }
      // Oferta por cantidad (precio mayorista): llevando el mínimo del producto entre todos sus
      // renglones, la unidad sale al precio de la oferta si es más barato
      const units = new Map<string, number>();
      for (const it of items) units.set(it.productId, (units.get(it.productId) || 0) + it.quantity);
      for (const it of items) {
        const p: any = byId.get(it.productId);
        const price = Number(p?.wholesalePrice) || 0;
        const min = Number(p?.wholesaleMinQty) || 0;
        if (price > 0 && min > 0 && (units.get(it.productId) || 0) >= min - 1e-9 && price < it.unitPrice - 1e-9) {
          it.unitPrice = price;
          it.total = round2(it.quantity * price);
        }
      }
    }
    // Combos (también con precios puestos por el dueño): las unidades del combo pasan a su propio renglón
    const lines = await this.withCombos(items, isTrade, new Set(existingItems.map((e) => e.promoId).filter(Boolean)));
    const total = round2(lines.reduce((s: number, i: any) => s + i.total, 0));
    const clientId = data?.clientId ? String(data.clientId) : null;
    const notes = data?.notes ? String(data.notes).slice(0, 500) : null;
    const deliveryDate = data?.deliveryDate && !isNaN(new Date(data.deliveryDate).getTime()) ? new Date(data.deliveryDate) : null;

    return this.prisma.$transaction(async (tx: any) => {
      if (clientId && !(await tx.client.findUnique({ where: { id: clientId }, select: { id: true } }))) {
        throw new BadRequestException('El cliente del pedido no existe');
      }
      const existing = await tx.preOrder.findUnique({ where: { id } });
      if (existing && fromOnline) return tx.preOrder.findUnique({ where: { id }, include: INCLUDE });
      if (existing) {
        if (existing.status !== 'PENDING') {
          throw new BadRequestException(existing.status === 'BILLED' ? 'Este pedido ya se cobró en la caja: no se puede cambiar' : 'Este pedido está cancelado');
        }
        await tx.preOrderItem.deleteMany({ where: { orderId: id } });
        return tx.preOrder.update({ where: { id }, data: { clientId, notes, deliveryDate, total, items: { create: lines } }, include: INCLUDE });
      }
      // Mismo número que va a tener la venta (ver nextDocNumber)
      const orderNumber = await nextDocNumber(tx);
      return tx.preOrder.create({
        data: { id, orderNumber, clientId, userId, notes, deliveryDate, total, items: { create: lines } },
        include: INCLUDE,
      });
    });
  }

  /**
   * Arma los combos de Promociones con las unidades sueltas del pedido (ver combos.ts). Cada
   * producto que entra en un combo queda en un renglón aparte con su parte del precio del combo,
   * así el reparto, la rendición y la caja cobran lo mismo sin otra cuenta.
   */
  async withCombos(items: any[], isTrade: boolean, keep: Set<string>): Promise<any[]> {
    const loose = items.map((it, i) => ({ it, key: String(i) })).filter(({ it }) => !it.packSize);
    if (!loose.length) return items;
    const promos = await (this.prisma as any).promotion.findMany({ where: { type: { in: COMBO_TYPES } }, include: { products: true } }).catch(() => []);
    const combos = combosFromPromotions(promos, { trade: isTrade, keep });
    if (!combos.length) return items;
    const uses = applyCombos(loose.map(({ it, key }) => ({ key, productId: it.productId, quantity: it.quantity, price: it.unitPrice })), combos);
    if (!uses.length) return items;
    const out = items.map((it) => ({ ...it }));
    const extra: any[] = [];
    for (const use of uses) {
      for (const sh of comboShares(use)) {
        const base = out[Number(sh.key)];
        base.quantity = Math.round((base.quantity - sh.quantity) * 1000) / 1000;
        base.total = round2(base.quantity * base.unitPrice);
        extra.push({
          productId: base.productId, productName: base.productName, quantity: sh.quantity, packSize: null,
          unitPrice: sh.total / sh.quantity, total: sh.total,
          promoId: use.id, promoName: use.name.slice(0, 120), regularPrice: base.unitPrice,
        });
      }
    }
    return [...out.filter((it) => it.quantity > 1e-9), ...extra];
  }

  async cancel(id: string) {
    const { count } = await (this.prisma as any).preOrder.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'CANCELLED' } });
    if (!count) {
      const order = await (this.prisma as any).preOrder.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Pedido no encontrado');
      if (order.status === 'BILLED') throw new BadRequestException('Este pedido ya se cobró: para devolverlo, anulá la venta');
    }
    return this.findOne(id);
  }
}
