import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../websockets/events.gateway';
import { AiService } from './ai.service';
import { readSheetFiles } from '../purchases/invoice-reader/sheet-rows';
import { readPdfLines } from '../purchases/invoice-reader/pdf-text';
import { parseArNumber } from '../purchases/invoice-reader/numbers';
import { computeCost } from '../products/ventra-format';
import { ProductMatcherService, PRODUCT_SELECT, norm } from './product-matcher.service';

type Iva = 'si' | 'no' | 'no_se';
/** incluido: la lista ya tiene IVA; sumar: es sin IVA y el costo lo lleva; sin: sin IVA y el costo queda sin IVA */
export type IvaMode = 'incluido' | 'sumar' | 'sin';
export interface ListRow { code: string; barcode: string; name: string; price: number; packUnits: number }
export interface PriceOptions { ivaMode: IvaMode; discount: number; keepMargin: boolean; round: number }

const MAX_ROWS = 5000;
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Lista de precios de un proveedor (PDF, Excel/CSV o fotos) → costos nuevos. La PC lee la
 * planilla sola cuando reconoce las columnas; si no, la IA dice qué columna es cada cosa (con
 * las primeras filas, aunque la lista tenga miles). PDFs y fotos los lee la IA. Después se busca
 * cada renglón en el catálogo (código de barras, código del proveedor, nombre, y la IA para los
 * que faltan) y el dueño revisa antes de aplicar.
 */
@Injectable()
export class PriceListService {
  constructor(private prisma: PrismaService, private ai: AiService, private events: EventsGateway, private matcher: ProductMatcherService) {}

  async read(files: { buffer: Buffer; mimetype?: string; originalname?: string }[], supplierId?: string) {
    if (!files.length) throw new BadRequestException('Subí la lista de precios.');
    const first = files[0];
    const name = first.originalname || '';
    let read: { rows: ListRow[]; iva: Iva; source: string; supplierName?: string; fromAi?: boolean };
    if (files.every((f) => /^image\//.test(f.mimetype || ''))) {
      const images = await this.ai.shrink(files, 2000);
      const { result } = await this.ai.call('pricelist', { mode: 'rows', images });
      read = { rows: this.cleanRows(result?.items), iva: result?.priceIncludesIva || 'no_se', source: 'foto', supplierName: result?.supplierName || '', fromAi: true };
    } else if (/\.pdf$/i.test(name) || first.mimetype === 'application/pdf') {
      let lines;
      try { lines = await readPdfLines(first.buffer); } catch { throw new BadRequestException('No se pudo abrir el PDF. Puede estar dañado o protegido con contraseña.'); }
      const text = lines.map((l) => l.text).filter((t) => t.trim());
      if (text.filter((t) => /[a-z]{3}/i.test(t)).length < 5) throw new BadRequestException('Este PDF es una imagen escaneada: sacale fotos a las hojas y subilas.');
      const { result } = await this.ai.call('pricelist', { mode: 'rows', lines: text.slice(0, 4000) });
      read = { rows: this.cleanRows(result?.items), iva: result?.priceIncludesIva || 'no_se', source: 'pdf', supplierName: result?.supplierName || '', fromAi: true };
    } else if (/\.(xlsx|xls|csv|txt)$/i.test(name)) {
      read = await this.readSheet(first.buffer, name);
    } else {
      throw new BadRequestException('Subí la lista en PDF, Excel (.xlsx/.xls), CSV o fotos.');
    }
    if (!read.rows.length) throw new BadRequestException('No se encontraron productos con precio en la lista.');
    const rows = read.rows.slice(0, MAX_ROWS);
    // Proveedor: el elegido o el de la lista. Si lo leyó la IA y no está cargado, se crea; si es un
    // título de la planilla, solo se usa si coincide con uno cargado
    let supplier = supplierId ? await this.prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true, name: true } }) : null;
    if (!supplier && read.supplierName) supplier = await this.matcher.findSupplier(read.supplierName, !!read.fromAi);
    const { matches, aiMatched } = await this.match(rows, supplier?.id);
    return {
      source: read.source,
      priceIncludesIva: read.iva,
      total: rows.length,
      truncated: read.rows.length > MAX_ROWS,
      aiMatched,
      supplier,
      supplierGuess: supplier ? null : read.supplierName || null,
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
    let supplierName = '';
    let fromAi = false;
    if (!map) {
      const sample = grid.slice(0, 40).map((row) => row.map((c) => String(c ?? '')));
      const { result } = await this.ai.call('pricelist', { mode: 'map', sample });
      if (result && result.name >= 0 && result.price >= 0) { map = result; supplierName = result.supplierName || ''; fromAi = true; }
    }
    // Sin IA: el primer título de arriba del encabezado puede ser el nombre del proveedor
    if (!supplierName && map) {
      for (const row of grid.slice(0, Math.max(0, map.headerRow))) {
        const t = row.map((c) => String(c ?? '').trim()).find((c) => /[a-z]{3}/i.test(c));
        if (t && !/(lista|precio|fecha|vigencia|pagina|página|hoja|actualiz)/i.test(t) && t.length <= 60) { supplierName = t; break; }
      }
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
    return { rows, iva: (map.priceIncludesIva || 'no_se') as Iva, source: 'planilla', supplierName, fromAi };
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

  /** Qué producto del catálogo es cada renglón (ver ProductMatcherService) */
  private async match(rows: ListRow[], supplierId?: string) {
    const { matches: found, aiMatched, candidates } = await this.matcher.match(rows, { supplierId });
    const view = (p: any) => ({
      id: p.id, name: p.name, costPrice: p.costPrice, salePrice: p.salePrice, packPrice: p.packPrice,
      unitsPerPack: p.unitsPerPack, supplierId: p.supplierId, usesListPrice: p.listPrice != null && p.listPrice > 0,
    });
    const matches: any[] = found.map((m) => (m ? { ...m, product: view(m.product) } : null));

    return {
      aiMatched,
      matches: matches.map((m, i) => {
        // Sin encontrar: los más parecidos del catálogo, para asociarlo con un toque
        if (!m) return { product: null, by: null, confidence: null, perPack: false, candidates: candidates[i] || [] };
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

  /**
   * El dueño dijo qué producto es un renglón que no se encontró: se aprende ya para ese proveedor
   * (las próximas listas y boletas lo encuentran solas), aunque todavía no aplique precios.
   */
  async learn(supplierId: string, items: { code?: string; name?: string; productId: string }[]) {
    if (!supplierId) throw new BadRequestException('Elegí el proveedor para que Ventra lo recuerde.');
    const supplier = await this.prisma.supplier.findUnique({ where: { id: supplierId }, select: { id: true } });
    if (!supplier) throw new BadRequestException('Proveedor no encontrado');
    const valid = (items || []).filter((i) => i && i.productId).slice(0, 500);
    await this.matcher.learn(supplier.id, valid.map((i) => ({ code: i.code, name: i.name, productId: String(i.productId) })));
    return { learned: valid.length };
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

  async apply(body: { items: { productId: string; price: number; perPack?: boolean; code?: string; name?: string }[]; supplierId?: string } & PriceOptions, userId: string) {
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
    // La próxima lista o boleta de este proveedor encuentra estos productos directo
    if (supplier) await this.matcher.learn(supplier.id, items.map((i) => ({ code: i.code, name: i.name, productId: String(i.productId) })));
    try { this.events.server?.emit('products:bulk-updated', { count: updated }); } catch { /* sin clientes conectados */ }
    return { updated };
  }
}
