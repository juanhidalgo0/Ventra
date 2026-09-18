import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../websockets/events.gateway';
import {
  buildVentraWorkbook,
  parseVentraWorkbook,
  productToRow,
  ParsedRow,
  VentraFormatError,
} from './ventra-format';
import { convertModpresup, isAccessDatabase, ModpresupFormatError } from './modpresup-converter';

type RowAction = 'CREATE' | 'UPDATE' | 'SKIP';

interface PlannedRow extends ParsedRow {
  action: RowAction;
  existingId: string | null;
  /** Códigos adicionales que se pueden agregar sin chocar con otro producto */
  addableBarcodes: string[];
}

interface ExistingProduct {
  id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  salePrice: number;
  additionalBarcodes: { barcode: string }[];
}

const MAX_ISSUES_RETURNED = 2000;
const BATCH_SIZE = 200;

@Injectable()
export class VentraImportService {
  private isImporting = false;

  constructor(
    private prisma: PrismaService,
    private eventsGateway: EventsGateway,
  ) {}

  // -------------------------------------------------------------------------
  // Exportación
  // -------------------------------------------------------------------------

  async exportProducts(): Promise<Buffer> {
    const products = await this.prisma.product.findMany({
      include: {
        category: { select: { name: true } },
        brand: { select: { name: true } },
        supplier: { select: { name: true } },
        additionalBarcodes: { select: { barcode: true } },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return buildVentraWorkbook(products.map(productToRow));
  }

  template(): Buffer {
    return buildVentraWorkbook([]);
  }

  // -------------------------------------------------------------------------
  // Vista previa e importación
  // -------------------------------------------------------------------------

  /**
   * Lee el archivo subido. Acepta el formato Ventra (.xlsx) o una base de
   * modpresup (.mdb), que se convierte al formato Ventra en el momento.
   * El tipo se detecta por el contenido, no por la extensión.
   */
  private parse(buffer: Buffer) {
    try {
      if (isAccessDatabase(buffer)) {
        const conversion = convertModpresup(buffer);
        const result = parseVentraWorkbook(buildVentraWorkbook(conversion.rows));
        for (const r of result.rows) {
          const notes = r.data.codigo ? conversion.notes.get(r.data.codigo) : undefined;
          if (notes) r.warnings.push(...notes);
        }
        return { ...result, source: 'MODPRESUP' as const };
      }
      return { ...parseVentraWorkbook(buffer), source: 'VENTRA' as const };
    } catch (err: any) {
      if (err instanceof VentraFormatError || err instanceof ModpresupFormatError) throw new BadRequestException(err.message);
      throw err;
    }
  }

  /** Decide qué hacer con cada fila comparando contra la base actual. */
  private async plan(rows: ParsedRow[]) {
    const products: ExistingProduct[] = await this.prisma.product.findMany({
      select: { id: true, sku: true, barcode: true, name: true, salePrice: true, additionalBarcodes: { select: { barcode: true } } },
    });

    const bySku = new Map<string, ExistingProduct>();
    const byBarcode = new Map<string, ExistingProduct>();
    for (const p of products) {
      if (p.sku) bySku.set(p.sku.toUpperCase(), p);
      if (p.barcode) byBarcode.set(p.barcode, p);
      for (const ab of p.additionalBarcodes) byBarcode.set(ab.barcode, p);
    }

    const describe = (p: ExistingProduct) => `"${p.name}"${p.sku ? ` (código ${p.sku})` : ''}`;
    const matchedIds = new Set<string>();

    const planned: PlannedRow[] = rows.map(r => {
      const { codigo, codigo_barras, codigos_adicionales } = r.data;
      const errors = [...r.errors];
      const warnings = [...r.warnings];

      let existing: ExistingProduct | null = codigo ? bySku.get(codigo.toUpperCase()) ?? null : null;
      if (!existing && codigo_barras) {
        const owner = byBarcode.get(codigo_barras);
        // Solo se reconoce por código de barras si el producto no tiene otro código interno
        if (owner && (!owner.sku || !codigo)) existing = owner;
      }

      if (codigo_barras) {
        const owner = byBarcode.get(codigo_barras);
        if (owner && owner.id !== existing?.id) {
          errors.push(`El código de barras ${codigo_barras} ya pertenece a ${describe(owner)}`);
        }
      }

      const addableBarcodes: string[] = [];
      for (const bc of codigos_adicionales) {
        if (bc === codigo_barras) continue;
        const owner = byBarcode.get(bc);
        if (owner && owner.id !== existing?.id) warnings.push(`Código adicional ${bc} ya pertenece a ${describe(owner)}, se omite`);
        else if (!owner) addableBarcodes.push(bc);
      }

      if (existing) {
        if (matchedIds.has(existing.id)) errors.push(`Otra fila del archivo ya actualiza a ${describe(existing)}`);
        matchedIds.add(existing.id);
      }

      const action: RowAction = errors.length > 0 ? 'SKIP' : existing ? 'UPDATE' : 'CREATE';
      return { ...r, errors, warnings, action, existingId: existing?.id ?? null, addableBarcodes };
    });

    return { planned, existingCount: products.length, matchedCount: matchedIds.size };
  }

  private async newNames(planned: PlannedRow[]) {
    const [categories, brands, suppliers] = await Promise.all([
      this.prisma.category.findMany({ select: { name: true } }),
      this.prisma.brand.findMany({ select: { name: true } }),
      this.prisma.supplier.findMany({ select: { name: true } }),
    ]);
    const missing = (existing: { name: string }[], pick: (r: PlannedRow) => string | null) => {
      const known = new Set(existing.map(e => e.name.trim().toUpperCase()));
      const result = new Map<string, string>();
      for (const r of planned) {
        if (r.action === 'SKIP') continue;
        const name = pick(r);
        if (name && !known.has(name.toUpperCase()) && !result.has(name.toUpperCase())) result.set(name.toUpperCase(), name);
      }
      return [...result.values()].sort();
    };
    return {
      categories: missing(categories, r => r.data.rubro),
      brands: missing(brands, r => r.data.marca),
      suppliers: missing(suppliers, r => r.data.proveedor),
    };
  }

  async preview(buffer: Buffer) {
    const { presentColumns, rows, source } = this.parse(buffer);
    if (rows.length === 0) throw new BadRequestException('El archivo no tiene productos.');

    const { planned, existingCount, matchedCount } = await this.plan(rows);
    const created = planned.filter(r => r.action === 'CREATE').length;
    const updated = planned.filter(r => r.action === 'UPDATE').length;
    const skipped = planned.filter(r => r.action === 'SKIP').length;
    const withWarnings = planned.filter(r => r.action !== 'SKIP' && r.warnings.length > 0).length;

    const issues = planned
      .filter(r => r.errors.length > 0 || r.warnings.length > 0)
      .sort((a, b) => b.errors.length - a.errors.length || a.row - b.row)
      .slice(0, MAX_ISSUES_RETURNED)
      .map(r => ({
        row: r.row,
        codigo: r.data.codigo,
        nombre: r.data.nombre,
        action: r.action,
        errors: r.errors,
        warnings: r.warnings,
      }));

    return {
      source,
      total: planned.length,
      created,
      updated,
      skipped,
      withWarnings,
      issuesTruncated: planned.filter(r => r.errors.length > 0 || r.warnings.length > 0).length > MAX_ISSUES_RETURNED,
      issues,
      presentColumns,
      notInFile: existingCount - matchedCount,
      newNames: await this.newNames(planned),
    };
  }

  async import(buffer: Buffer, options: { updateStock: boolean }, userId?: string) {
    if (this.isImporting) throw new ConflictException('Ya hay una importación en curso.');
    this.isImporting = true;
    try {
      return await this.runImport(buffer, options, userId);
    } finally {
      this.isImporting = false;
    }
  }

  private async runImport(buffer: Buffer, options: { updateStock: boolean }, userId?: string) {
    const { presentColumns, rows } = this.parse(buffer);
    const { planned } = await this.plan(rows);
    const has = (col: string) => presentColumns.includes(col);
    const toProcess = planned.filter(r => r.action !== 'SKIP');
    const total = toProcess.length;

    const categoryIds = await this.ensureNamed('category', toProcess.map(r => r.data.rubro));
    const brandIds = await this.ensureNamed('brand', toProcess.map(r => r.data.marca));
    const supplierIds = await this.ensureNamed('supplier', toProcess.map(r => r.data.proveedor));

    const existingSales = new Map<string, number>();
    if (userId) {
      const ids = toProcess.filter(r => r.existingId).map(r => r.existingId as string);
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = await this.prisma.product.findMany({ where: { id: { in: ids.slice(i, i + 500) } }, select: { id: true, salePrice: true } });
        chunk.forEach(p => existingSales.set(p.id, p.salePrice));
      }
    }

    let created = 0;
    let updated = 0;
    const failed: { row: number; codigo: string | null; nombre: string; error: string }[] = [];

    for (let i = 0; i < total; i += BATCH_SIZE) {
      const batch = toProcess.slice(i, i + BATCH_SIZE);
      try {
        await this.prisma.$transaction(async tx => {
          for (const r of batch) await this.applyRow(tx, r, { has, options, categoryIds, brandIds, supplierIds, existingSales, userId });
        }, { timeout: 120000 });
        batch.forEach(r => (r.action === 'CREATE' ? created++ : updated++));
      } catch {
        // Si un lote falla, se reintenta fila por fila para aislar el problema
        for (const r of batch) {
          try {
            await this.prisma.$transaction(async tx => {
              await this.applyRow(tx, r, { has, options, categoryIds, brandIds, supplierIds, existingSales, userId });
            }, { timeout: 30000 });
            r.action === 'CREATE' ? created++ : updated++;
          } catch (err: any) {
            failed.push({ row: r.row, codigo: r.data.codigo, nombre: r.data.nombre, error: err.message?.split('\n').pop() || 'Error desconocido' });
          }
        }
      }

      const current = Math.min(i + BATCH_SIZE, total);
      this.eventsGateway.emitImportProgress({
        progress: Math.floor((current / total) * 100),
        total,
        current,
        status: `Importando: ${batch[batch.length - 1]?.data.nombre || ''}`,
        details: { imported: created, updated, lastItem: batch[batch.length - 1]?.data.nombre || '' },
      });
      await new Promise(resolve => setTimeout(resolve, 5));
    }

    return {
      success: failed.length === 0,
      total: planned.length,
      created,
      updated,
      skipped: planned.length - total,
      failed,
    };
  }

  private async applyRow(
    tx: any,
    r: PlannedRow,
    ctx: {
      has: (col: string) => boolean;
      options: { updateStock: boolean };
      categoryIds: Map<string, string>;
      brandIds: Map<string, string>;
      supplierIds: Map<string, string>;
      existingSales: Map<string, number>;
      userId?: string;
    },
  ) {
    const d = r.data;
    const { has } = ctx;
    const idOf = (map: Map<string, string>, name: string | null) => (name ? map.get(name.toUpperCase()) ?? null : null);

    const data: any = {};
    const set = (col: string, field: string, value: any) => { if (has(col)) data[field] = value; };

    set('codigo', 'sku', d.codigo);
    set('codigo_barras', 'barcode', d.codigo_barras);
    set('nombre', 'name', d.nombre);
    set('descripcion', 'description', d.descripcion);
    set('rubro', 'categoryId', idOf(ctx.categoryIds, d.rubro));
    set('marca', 'brandId', idOf(ctx.brandIds, d.marca));
    set('proveedor', 'supplierId', idOf(ctx.supplierIds, d.proveedor));
    set('unidad', 'unit', d.unidad);
    set('precio_lista', 'listPrice', d.precio_lista);
    set('desc1', 'discount1', d.desc1);
    set('desc2', 'discount2', d.desc2);
    set('desc3', 'discount3', d.desc3);
    set('iva', 'taxRate', d.iva);
    // El costo puede venir calculado desde precio de lista aunque la columna no esté
    if (d.costo !== null) data.costPrice = d.costo;
    data.salePrice = d.precio_venta;
    set('precio_mayorista', 'wholesalePrice', d.precio_mayorista);
    set('cantidad_mayorista', 'wholesaleMinQty', d.cantidad_mayorista);
    set('precio_gremio', 'tradePrice', d.precio_gremio);
    set('stock_minimo', 'minStock', d.stock_minimo);
    set('ubicacion', 'location', d.ubicacion);
    set('activo', 'isActive', d.activo);

    let productId: string;
    if (r.action === 'UPDATE' && r.existingId) {
      if (has('stock') && ctx.options.updateStock) data.stock = d.stock;
      await tx.product.update({ where: { id: r.existingId }, data });
      productId = r.existingId;

      const oldPrice = ctx.existingSales.get(productId);
      if (ctx.userId && oldPrice !== undefined && Math.abs(oldPrice - d.precio_venta) > 0.001) {
        await tx.priceHistory.create({ data: { productId, userId: ctx.userId, oldPrice, newPrice: d.precio_venta } });
      }
    } else {
      if (has('stock')) data.stock = d.stock;
      const product = await tx.product.create({ data: { ...data, name: d.nombre } });
      productId = product.id;
    }

    for (const barcode of r.addableBarcodes) {
      await tx.productBarcode.upsert({ where: { barcode }, update: {}, create: { barcode, productId } });
    }
  }

  /** Devuelve un mapa NOMBRE_EN_MAYÚSCULAS -> id, creando los que falten. */
  private async ensureNamed(model: 'category' | 'brand' | 'supplier', names: (string | null)[]) {
    const delegate: any = (this.prisma as any)[model];
    const map = new Map<string, string>();
    const existing: { id: string; name: string }[] = await delegate.findMany({ select: { id: true, name: true } });
    for (const e of existing) {
      const key = e.name.trim().toUpperCase();
      if (!map.has(key)) map.set(key, e.id);
    }
    for (const name of names) {
      if (!name || map.has(name.toUpperCase())) continue;
      const data: any = { name };
      if (model === 'category') data.color = '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
      const createdRow = await delegate.create({ data });
      map.set(name.toUpperCase(), createdRow.id);
    }
    return map;
  }
}
