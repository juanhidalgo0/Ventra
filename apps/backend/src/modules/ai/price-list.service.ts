import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../websockets/events.gateway';
import { AiService } from './ai.service';
import { readSheetFiles } from '../purchases/invoice-reader/sheet-rows';
import { readPdfLines } from '../purchases/invoice-reader/pdf-text';
import { parseArNumber } from '../purchases/invoice-reader/numbers';
import { computeCost } from '../products/ventra-format';

type Iva = 'si' | 'no' | 'no_se';
/** incluido: la lista ya tiene IVA; sumar: es sin IVA y el costo lo lleva; sin: sin IVA y el costo queda sin IVA */
export type IvaMode = 'incluido' | 'sumar' | 'sin';
export interface ListRow { code: string; barcode: string; name: string; price: number; packUnits: number }
export interface PriceOptions { ivaMode: IvaMode; discount: number; keepMargin: boolean; round: number }

const MAX_ROWS = 5000;
const norm = (s: string) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/(\d),(\d)/g, '$1.$2').replace(/(\d)([a-z])/g, '$1 $2').replace(/[^a-z0-9. ]/g, ' ').replace(/\s+/g, ' ').trim();
const codeKey = (s: string) => String(s || '').toUpperCase().replace(/[\s.\-_/]/g, '').replace(/^0+/, '');
const words = (s: string) => norm(s).split(' ').filter((w) => w.length > 1 && !/^(de|la|el|con|sin|x|por|en|y)$/.test(w));
/** Los números del nombre (tamaños, pesos, sabores numerados): tienen que coincidir */
const sizes = (s: string) => (norm(s).match(/\d+(?:\.\d+)?/g) || []).map((n) => String(Number(n))).sort().join(' ');
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

const PRODUCT_SELECT = {
  id: true, name: true, barcode: true, sku: true, supplierId: true, costPrice: true, salePrice: true, packPrice: true,
  wholesalePrice: true, tradePrice: true, unitsPerPack: true, taxRate: true, listPrice: true, discount1: true, discount2: true, discount3: true,
  additionalBarcodes: { select: { barcode: true } },
} as const;

/**
 * Lista de precios de un proveedor (PDF, Excel/CSV o fotos) → costos nuevos. La PC lee la
 * planilla sola cuando reconoce las columnas; si no, la IA dice qué columna es cada cosa (con
 * las primeras filas, aunque la lista tenga miles). PDFs y fotos los lee la IA. Después se busca
 * cada renglón en el catálogo (código de barras, código del proveedor, nombre, y la IA para los
 * que faltan) y el dueño revisa antes de aplicar.
 */
@Injectable()
export class PriceListService {
  constructor(private prisma: PrismaService, private ai: AiService, private events: EventsGateway) {}

  async read(files: { buffer: Buffer; mimetype?: string; originalname?: string }[], supplierId?: string) {
    if (!files.length) throw new BadRequestException('Subí la lista de precios.');
    const first = files[0];
    const name = first.originalname || '';
    let read: { rows: ListRow[]; iva: Iva; source: string };
    if (files.every((f) => /^image\//.test(f.mimetype || ''))) {
      const images = await this.ai.shrink(files, 2000);
      const { result } = await this.ai.call('pricelist', { mode: 'rows', images });
      read = { rows: this.cleanRows(result?.items), iva: result?.priceIncludesIva || 'no_se', source: 'foto' };
    } else if (/\.pdf$/i.test(name) || first.mimetype === 'application/pdf') {
      let lines;
      try { lines = await readPdfLines(first.buffer); } catch { throw new BadRequestException('No se pudo abrir el PDF. Puede estar dañado o protegido con contraseña.'); }
      const text = lines.map((l) => l.text).filter((t) => t.trim());
      if (text.filter((t) => /[a-z]{3}/i.test(t)).length < 5) throw new BadRequestException('Este PDF es una imagen escaneada: sacale fotos a las hojas y subilas.');
      const { result } = await this.ai.call('pricelist', { mode: 'rows', lines: text.slice(0, 4000) });
      read = { rows: this.cleanRows(result?.items), iva: result?.priceIncludesIva || 'no_se', source: 'pdf' };
    } else if (/\.(xlsx|xls|csv|txt)$/i.test(name)) {
      read = await this.readSheet(first.buffer, name);
    } else {
      throw new BadRequestException('Subí la lista en PDF, Excel (.xlsx/.xls), CSV o fotos.');
    }
    if (!read.rows.length) throw new BadRequestException('No se encontraron productos con precio en la lista.');
    const rows = read.rows.slice(0, MAX_ROWS);
    const { matches, aiMatched } = await this.match(rows, supplierId);
    return {
      source: read.source,
      priceIncludesIva: read.iva,
      total: rows.length,
      truncated: read.rows.length > MAX_ROWS,
      aiMatched,
      rows: rows.map((r, i) => ({ ...r, i, ...matches[i] })),
    };
  }

  private cleanRows(items: any[]): ListRow[] {
    return (Array.isArray(items) ? items : []).map((it) => ({
      code: String(it?.code || '').trim().slice(0, 40),
      barcode: String(it?.barcode || '').replace(/\D/g, '').slice(0, 14),
      name: String(it?.name || '').trim().slice(0, 160),
      price: Number(it?.price) || 0,
      packUnits: Math.max(0, Math.round(Number(it?.packUnits) || 0)),
    })).filter((r) => r.name && r.price > 0);
  }

  /** Planilla: encabezado reconocible → se lee sola; si no, la IA dice qué columna es cada cosa */
  private async readSheet(buffer: Buffer, fileName: string) {
    let sheets;
    try { sheets = readSheetFiles(buffer, fileName); } catch { throw new BadRequestException('No se pudo abrir la planilla. Probá guardándola de nuevo como .xlsx o .csv.'); }
    const grids = sheets.map((rows) => rows.map((r) => r.cells.map((c: any) => (c.raw !== undefined && c.raw !== null && c.raw !== '' ? c.raw : c.text))));
    const grid = grids.sort((a, b) => b.length - a.length)[0] || [];
    if (!grid.length) throw new BadRequestException('La planilla está vacía.');
    let map = this.guessColumns(grid);
    if (!map) {
      const sample = grid.slice(0, 40).map((row) => row.map((c) => String(c ?? '')));
      const { result } = await this.ai.call('pricelist', { mode: 'map', sample });
      if (result && result.name >= 0 && result.price >= 0) map = result;
    }
    if (!map) throw new BadRequestException('No se reconocieron las columnas de la lista (descripción y precio).');
    const at = (row: any[], col: number) => (col >= 0 ? row[col] : '');
    const rows: ListRow[] = [];
    for (const row of grid.slice(Math.max(0, map.headerRow + 1))) {
      const price = parseArNumber(at(row, map.price));
      const name = String(at(row, map.name) ?? '').trim();
      if (!name || !price || price <= 0 || !/[a-z]/i.test(name)) continue;
      rows.push({
        code: String(at(row, map.code) ?? '').trim().slice(0, 40),
        barcode: String(at(row, map.barcode) ?? '').replace(/\D/g, '').slice(0, 14),
        name: name.slice(0, 160),
        price,
        packUnits: Math.max(0, Math.round(parseArNumber(at(row, map.packUnits)) || 0)),
      });
    }
    return { rows, iva: (map.priceIncludesIva || 'no_se') as Iva, source: 'planilla' };
  }

  /** Encabezado con una sola columna de precio y una de descripción: no hace falta la IA */
  private guessColumns(grid: any[][]) {
    for (let r = 0; r < Math.min(30, grid.length); r++) {
      const cells = grid[r].map((c) => norm(String(c ?? '')));
      const find = (re: RegExp) => cells.findIndex((c) => re.test(c));
      const name = find(/^(descripcion|detalle|producto|articulo|nombre)/);
      const prices = cells.map((c, i) => (/(precio|importe|costo|p lista|valor)/.test(c) ? i : -1)).filter((i) => i >= 0);
      if (name < 0 || prices.length !== 1) continue;
      const header = cells[prices[0]];
      return {
        headerRow: r,
        name,
        price: prices[0],
        code: cells.findIndex((c, i) => i !== name && /^(cod|codigo|art|sku|item)/.test(c) && !/barra|ean/.test(c)),
        barcode: find(/(barra|ean|gtin)/),
        packUnits: find(/(x bulto|por bulto|u bulto|unid.*bulto|bulto|pack|caja x)/),
        priceIncludesIva: /(s iva|sin iva|neto|\+ iva)/.test(header) ? 'no' : /(c iva|con iva|final)/.test(header) ? 'si' : 'no_se',
      };
    }
    return null;
  }

  /** Qué producto del catálogo es cada renglón */
  private async match(rows: ListRow[], supplierId?: string) {
    const products = await this.prisma.product.findMany({ where: { isActive: true, id: { notIn: ['VENTA_RAPIDA', 'PAGO_CTA_CTE'] } }, select: PRODUCT_SELECT });
    const byBarcode = new Map<string, any>();
    const bySku = new Map<string, any>();
    const byName = new Map<string, any>();
    const index = new Map<string, any[]>();
    for (const p of products) {
      for (const b of [p.barcode, ...p.additionalBarcodes.map((x) => x.barcode)]) if (b) byBarcode.set(codeKey(b), p);
      if (p.sku) bySku.set(codeKey(p.sku), p);
      byName.set(norm(p.name), p);
      for (const w of new Set(words(p.name))) { const l = index.get(w) || []; l.push(p); index.set(w, l); }
    }
    const view = (p: any) => ({
      id: p.id, name: p.name, costPrice: p.costPrice, salePrice: p.salePrice, packPrice: p.packPrice,
      unitsPerPack: p.unitsPerPack, supplierId: p.supplierId, usesListPrice: p.listPrice != null && p.listPrice > 0,
    });
    const matches: any[] = rows.map((r) => {
      const bc = r.barcode || (/^\d{8,14}$/.test(r.code) ? r.code : '');
      let p = bc ? byBarcode.get(codeKey(bc)) : null;
      if (p) return { product: view(p), by: 'barcode', confidence: 'alta' };
      p = r.code ? bySku.get(codeKey(r.code)) : null;
      if (p) return { product: view(p), by: 'code', confidence: supplierId && p.supplierId && p.supplierId !== supplierId ? 'media' : 'alta' };
      p = byName.get(norm(r.name));
      if (p) return { product: view(p), by: 'name', confidence: 'alta' };
      // Por nombre parecido: muchas palabras en común y los mismos números (tamaño, peso)
      const ws = words(r.name);
      const rs = sizes(r.name);
      const seen = new Set<any>();
      let best: any = null;
      let bestScore = 0;
      for (const w of ws) for (const cand of (index.get(w) || []).length < 300 ? index.get(w) || [] : []) {
        if (seen.has(cand)) continue;
        seen.add(cand);
        if (sizes(cand.name) !== rs) continue;
        const cw = new Set(words(cand.name));
        const common = ws.filter((x) => cw.has(x)).length;
        let score = common / Math.max(ws.length, cw.size);
        if (supplierId && cand.supplierId === supplierId) score += 0.05;
        if (score > bestScore) { bestScore = score; best = cand; }
      }
      if (best && bestScore >= 0.75) return { product: view(best), by: 'name', confidence: bestScore >= 0.9 ? 'alta' : 'media' };
      return null;
    });

    // Los que faltan, con la IA (si la PC está vinculada y no se pasó del tope)
    let aiMatched = 0;
    const missing = rows.map((r, i) => ({ r, i })).filter((x) => !matches[x.i]).slice(0, 400);
    if (missing.length && products.length) {
      try {
        const { result } = await this.ai.call('pricelist', {
          mode: 'match',
          items: missing.map((x) => ({ name: x.r.name, code: x.r.code })),
          catalog: products.slice(0, 4000).map((p) => ({ id: p.id, name: p.name })),
        });
        const byId = new Map(products.map((p) => [p.id, p]));
        for (const m of result?.matches || []) {
          const target = missing[Number(m.i)];
          const p = byId.get(String(m.productId));
          if (!target || !p) continue;
          matches[target.i] = { product: view(p), by: 'ia', confidence: m.confianza === 'alta' ? 'media' : 'baja' };
          aiMatched++;
        }
      } catch { /* sin IA: quedan sin encontrar */ }
    }

    // Un producto en dos renglones: se queda el más seguro
    const rank = { alta: 3, media: 2, baja: 1 } as Record<string, number>;
    const owner = new Map<string, number>();
    matches.forEach((m, i) => {
      if (!m) return;
      const prev = owner.get(m.product.id);
      if (prev === undefined) { owner.set(m.product.id, i); return; }
      if (rank[m.confidence] > rank[matches[prev].confidence]) { matches[prev] = null; owner.set(m.product.id, i); } else matches[i] = null;
    });

    return {
      aiMatched,
      matches: matches.map((m, i) => {
        if (!m) return { product: null, by: null, confidence: null, perPack: false };
        // ¿El precio es del bulto? Si la lista lo dice, o si así queda más cerca del costo anterior
        const upp = Number(m.product.unitsPerPack) || 1;
        const r = rows[i];
        let perPack = false;
        if (upp > 1) {
          if (r.packUnits === upp) perPack = true;
          else if (m.product.costPrice > 0) perPack = Math.abs(Math.log(r.price / upp / m.product.costPrice)) < Math.abs(Math.log(r.price / m.product.costPrice));
        }
        return { ...m, perPack };
      }),
    };
  }

  /** Costo y precios nuevos de un producto (lo mismo para la vista previa y para aplicar) */
  compute(p: any, price: number, perPack: boolean, o: PriceOptions) {
    const upp = Number(p.unitsPerPack) || 1;
    const unit = (perPack && upp > 1 ? price / upp : price) * (1 - Math.min(90, Math.max(0, Number(o.discount) || 0)) / 100);
    const iva = Number(p.taxRate) > 0 ? Number(p.taxRate) : 21;
    let listPrice: number | null = null;
    let cost: number;
    if (p.listPrice != null && p.listPrice > 0 && o.ivaMode !== 'incluido') {
      // Productos con precio de lista y descuentos propios (formato Ventra): se respeta su cuenta
      listPrice = r2(unit);
      cost = computeCost(listPrice, p.discount1 || 0, p.discount2 || 0, p.discount3 || 0, o.ivaMode === 'sumar' ? iva : 0);
    } else {
      cost = r2(unit * (o.ivaMode === 'sumar' ? 1 + iva / 100 : 1));
    }
    const step = [10, 100].includes(Number(o.round)) ? Number(o.round) : 0;
    const roundUp = (n: number) => (step ? Math.ceil(n / step - 1e-9) * step : r2(n));
    const factor = o.keepMargin && p.costPrice > 0 ? cost / p.costPrice : 1;
    const scale = (v: number | null) => (v && factor !== 1 ? roundUp(v * factor) : v);
    return {
      oldCost: p.costPrice, newCost: cost, listPrice,
      oldSale: p.salePrice, newSale: scale(p.salePrice) as number,
      packPrice: scale(p.packPrice), wholesalePrice: scale(p.wholesalePrice), tradePrice: scale(p.tradePrice),
      changePct: p.costPrice > 0 ? r2((cost / p.costPrice - 1) * 100) : null,
      saleUnchanged: factor === 1,
    };
  }

  async preview(items: { productId: string; price: number; perPack?: boolean }[], o: PriceOptions) {
    const list = (items || []).slice(0, MAX_ROWS);
    const products = await this.prisma.product.findMany({ where: { id: { in: list.map((i) => String(i.productId)) } }, select: PRODUCT_SELECT });
    const byId = new Map(products.map((p) => [p.id, p]));
    return list.map((it) => {
      const p = byId.get(String(it.productId));
      return p ? { productId: p.id, ...this.compute(p, Number(it.price) || 0, !!it.perPack, o) } : { productId: it.productId, missing: true };
    });
  }

  async apply(body: { items: { productId: string; price: number; perPack?: boolean }[]; supplierId?: string } & PriceOptions, userId: string) {
    const items = (body.items || []).filter((i) => i && i.productId && Number(i.price) > 0).slice(0, MAX_ROWS);
    if (!items.length) throw new BadRequestException('No hay precios para aplicar.');
    const o: PriceOptions = { ivaMode: ['incluido', 'sumar', 'sin'].includes(body.ivaMode) ? body.ivaMode : 'incluido', discount: Number(body.discount) || 0, keepMargin: body.keepMargin !== false, round: Number(body.round) || 0 };
    const products = await this.prisma.product.findMany({ where: { id: { in: items.map((i) => String(i.productId)) } }, select: PRODUCT_SELECT });
    const byId = new Map(products.map((p) => [p.id, p]));
    const supplier = body.supplierId ? await this.prisma.supplier.findUnique({ where: { id: body.supplierId }, select: { id: true } }) : null;
    const ops: any[] = [];
    let updated = 0;
    for (const it of items) {
      const p = byId.get(String(it.productId));
      if (!p) continue;
      const c = this.compute(p, Number(it.price), !!it.perPack, o);
      if (!(c.newCost > 0)) continue;
      const data: any = { costPrice: c.newCost };
      if (c.listPrice != null) data.listPrice = c.listPrice;
      if (!c.saleUnchanged) {
        data.salePrice = c.newSale;
        if (p.packPrice) data.packPrice = c.packPrice;
        if (p.wholesalePrice) data.wholesalePrice = c.wholesalePrice;
        if (p.tradePrice) data.tradePrice = c.tradePrice;
      }
      if (supplier && !p.supplierId) data.supplierId = supplier.id;
      ops.push(this.prisma.product.update({ where: { id: p.id }, data }));
      updated++;
      if (!c.saleUnchanged && c.newSale !== p.salePrice) {
        ops.push(this.prisma.priceHistory.create({ data: { productId: p.id, userId, oldPrice: p.salePrice, newPrice: c.newSale } }));
      }
    }
    for (let i = 0; i < ops.length; i += 400) await this.prisma.$transaction(ops.slice(i, i + 400));
    try { this.events.server?.emit('products:bulk-updated', { count: updated }); } catch { /* sin clientes conectados */ }
    return { updated };
  }
}
