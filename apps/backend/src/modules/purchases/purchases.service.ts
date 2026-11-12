import { AiService } from '../ai/ai.service';
import { ProductMatcherService, isBarcode } from '../ai/product-matcher.service';
import { Injectable, NotFoundException, BadRequestException, Optional } from '@nestjs/common';
import { NotifyService } from '../subscription/notify.service';
import { PrismaService } from '../../database/prisma.service';
import { FirebaseSyncService } from '../products/firebase-sync.service';
import { SyncImageService } from '../products/sync-image.service';
import { splitInvoiceCodes } from './invoice-reader/barcode-check';
import axios from 'axios';
import { Jimp } from 'jimp';
import * as XLSX from 'xlsx';
import { PRODUCT_WITHOUT_IMAGE } from '../../database/product-select';
import { createPurchaseLot } from '../products/lots.util';
import { InvoiceReadError, isPdfFile, isSheetFile, readInvoiceFile, type ParsedInvoice } from './invoice-reader';
import { readArcaQr, qrKind, qrTotalPesos, type ArcaQr } from './invoice-reader/arca-qr';

/**
 * Precio de venta de un producto que ya existe cuando cambia su costo: el que se eligió en la
 * compra o, si no vino ninguno, el que mantiene su margen (sube o baja en la misma proporción
 * que el costo). Si el costo no cambió o no tenía costo, queda el que tenía.
 */
export function keepMarginSale(product: { costPrice: number; salePrice: number }, newCost: number, chosen: number | undefined, round = 10) {
  if (chosen && chosen > 0) return chosen;
  if (!(product.costPrice > 0) || !(newCost > 0) || Math.abs(newCost - product.costPrice) < 0.01) return product.salePrice;
  const v = product.salePrice * (newCost / product.costPrice);
  return round ? Math.ceil(v / round - 1e-9) * round : Math.round(v * 100) / 100;
}

/** El precio del bulto, mayorista y de gremio acompañan al precio de venta (mismo margen) */
export function scaledPrices(product: { salePrice: number; packPrice?: number | null; wholesalePrice?: number | null; tradePrice?: number | null }, newSale: number, round = 10) {
  if (!(product.salePrice > 0) || Math.abs(newSale - product.salePrice) < 0.01) return {};
  const f = newSale / product.salePrice;
  const r = (v: number) => (round ? Math.ceil((v * f) / round - 1e-9) * round : Math.round(v * f * 100) / 100);
  const out: any = {};
  if (product.packPrice) out.packPrice = r(product.packPrice);
  if (product.wholesalePrice) out.wholesalePrice = r(product.wholesalePrice);
  if (product.tradePrice) out.tradePrice = r(product.tradePrice);
  return out;
}

/**
 * "Deshacer boleta" (plan de boletas, tanda 1.6): cómo estaba cada producto antes de la compra.
 * Se guarda en purchases.undo_info al confirmar. Si el mismo producto viene en dos renglones, vale
 * el "antes" del primero y el "después" del último.
 */
export interface UndoRow {
  id: string;
  created: boolean;
  before: { costPrice: number; salePrice: number; packPrice: number | null; wholesalePrice: number | null; tradePrice: number | null; isActive: boolean; supplierId: string | null };
  after: { costPrice: number; salePrice: number };
  barcodeSet?: string;
}
export function noteUndo(rows: Map<string, UndoRow>, product: any, created: boolean, update: { costPrice: number; salePrice: number }, barcodeSet?: string) {
  const prev = rows.get(product.id);
  if (prev) { prev.after = { costPrice: update.costPrice, salePrice: update.salePrice }; if (barcodeSet) prev.barcodeSet = barcodeSet; return; }
  rows.set(product.id, {
    id: product.id, created,
    before: { costPrice: product.costPrice, salePrice: product.salePrice, packPrice: product.packPrice ?? null, wholesalePrice: product.wholesalePrice ?? null, tradePrice: product.tradePrice ?? null, isActive: !!product.isActive, supplierId: product.supplierId ?? null },
    after: { costPrice: update.costPrice, salePrice: update.salePrice },
    ...(barcodeSet ? { barcodeSet } : {}),
  });
}

/**
 * Hojas que faltaban (tanda 1.7): una factura quedó en "Por revisar" con "faltan las hojas 3 y 4" y
 * después se escanean esas hojas. Se suman a la pendiente si las hojas nuevas son justo de las que
 * faltaban (si repiten una que ya estaba, se duplicarían renglones: no se junta). Si lo nuevo es la
 * factura entera, reemplaza a la pendiente. Devuelve el borrador nuevo o null si no corresponde. Pura.
 */
export function mergeMissingPages(old: any, add: any): any | null {
  const oldMissing: number[] = (Array.isArray(old?.missingPageNumbers) ? old.missingPageNumbers : []).map(Number).filter((n: number) => n > 0);
  if (!oldMissing.length && !(Number(old?.missingPages) > 0)) return null;
  const count = Math.max(Number(old?.pageCount) || 0, Number(add?.pageCount) || 0);
  const addMissing: number[] = (Array.isArray(add?.missingPageNumbers) ? add.missingPageNumbers : []).map(Number);
  const addComplete = !(Number(add?.missingPages) > 0) && !addMissing.length;
  // Llegó la factura entera: reemplaza a la que tenía hojas de menos
  if (addComplete && count > 1) return { ...add, sampleIds: [...(old.sampleIds || []), ...(add.sampleIds || [])] };
  if (!oldMissing.length || !(count > 1) || Number(add?.unnumberedPages) > 0) return null;
  const addHave = Array.from({ length: count }, (_, k) => k + 1).filter((n) => !addMissing.includes(n));
  if (!addHave.length || addHave.some((n) => !oldMissing.includes(n))) return null;
  const remaining = oldMissing.filter((n) => !addHave.includes(n));
  const items = [...(old.items || []), ...(add.items || [])];
  const printed = Number(add.printedTotal) > 0 ? Number(add.printedTotal) : Number(old.printedTotal) || 0;
  const sum = items.reduce((s: number, it: any) => s + (Number(it.total) || 0), 0);
  const near = (a: number, b: number) => b > 0 && Math.abs(a - b) <= Math.max(50, b * 0.02);
  const ok = printed > 0 ? near(sum * 1.21, printed) || near(sum, printed) : null;
  const check = remaining.length
    ? { ok: false, missingPages: true, message: `Faltan ${remaining.length === 1 ? 'la hoja' : 'las hojas'} ${listJoin(remaining.map(String))} (de ${count}): el total se controla cuando estén todas.`, details: [] }
    : ok === null ? null
      : { ok, message: ok ? 'Con las hojas que faltaban, los renglones suman el total de la boleta.' : `Con todas las hojas, los renglones suman $ ${Math.round(sum * 1.21).toLocaleString('es-AR')} con IVA y la boleta dice $ ${Math.round(printed).toLocaleString('es-AR')}: revisá cantidades, precios y descuentos.`, details: [] };
  const keep = (w: string) => !/^falta|^los renglones no suman|^no se pudo leer el total/.test(w);
  const why = [
    ...new Set([...(old.why || []), ...(add.why || [])].filter(keep)),
    ...(check?.missingPages ? [`faltan hojas (${remaining.join(', ')})`] : check?.ok === false ? ['los renglones no suman el total de la boleta'] : !check ? ['no se pudo leer el total de la boleta'] : []),
  ];
  return {
    ...old, items, check, why, printedTotal: printed || old.printedTotal,
    missingPageNumbers: remaining, missingPages: remaining.length, pageCount: count,
    photoIssues: [...(old.photoIssues || []), ...(add.photoIssues || [])],
    sampleIds: [...(old.sampleIds || []), ...(add.sampleIds || [])],
    mergedPages: [...(old.mergedPages || []), ...addHave],
  };
}

/** Nombre de un producto nuevo tal como vino en la boleta, prolijo */
const niceName = (s: string) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 120);
/** ["4","5","6"] → "4, 5 y 6" */
const listJoin = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}`);

/**
 * Unidades por bulto escritas en el nombre, como las ponen las distribuidoras de bebidas:
 * "COCA-COLA 600*12 PET" → 12, "1000*08 VR" → 8, "MONSTER 473ML*6L" → 6. Solo con "*" pegado a un
 * tamaño: "Pan Viena X6" o "Lactal X350gr" son la presentación, no bultos. 0 si no hay.
 */
export function unitsInName(name: string): number {
  const m = /\b\d{2,4}(?:[.,]\d+)?\s*(?:ml|cc|lts?|l|grs?|g|kg)?\s*\*\s*0?(\d{1,2})(?!\d)/i.exec(String(name || ''));
  const n = m ? Number(m[1]) : 0;
  return n >= 2 && n <= 48 ? n : 0;
}

function normalizeHeaderCell(s: any): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[_.\-\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function detectExcelColumns(rows: any[][]) {
  const synonyms: { [key: string]: string[] } = {
    sku: ['codigo', 'cod', 'sku', 'articulo', 'art', 'nro art', 'cod art', 'item', 'ref', 'clave'],
    barcode: ['barcode', 'barra', 'ean', 'gtin', 'cod barra', 'codigo barra', 'codbarra'],
    name: ['descripcion', 'detalle', 'nombre', 'producto', 'denominacion', 'concepto', 'desc', 'detalle del producto', 'material'],
    quantity: ['cantidad', 'cant', 'unidades', 'bultos', 'qty', 'u b', 'uxb', 'bulto'],
    cost: ['costo', 'p unit', 'p unitario', 'p costo', 'precio unit', 'precio unitario', 'precio', 'unitario', 'p lista', 'neto', 'imp neto', 'valor', 'p neto'],
    total: ['total', 'subtotal', 'importe', 'final', 'sub total', 'total linea', 'imp total'],
    unitsPerPack: ['u b', 'uxb', 'unidades bulto', 'emb', 'empaque']
  };

  let bestRow = -1;
  let maxMatches = 0;
  let detected: { [key: string]: number } = {};

  const scanLimit = Math.min(20, rows.length);
  for (let r = 0; r < scanLimit; r++) {
    const row = rows[r] || [];
    let currentMap: { [key: string]: number } = {};
    let matches = 0;

    for (let c = 0; c < row.length; c++) {
      const cellVal = normalizeHeaderCell(row[c]);
      if (!cellVal) continue;

      for (const [key, list] of Object.entries(synonyms)) {
        if (currentMap[key] === undefined && list.some(syn => cellVal === syn || cellVal.startsWith(syn + ' ') || cellVal.includes(' ' + syn) || cellVal.endsWith(' ' + syn))) {
          currentMap[key] = c;
          matches++;
          break;
        }
      }
    }

    if (matches > maxMatches && (currentMap.name !== undefined || currentMap.sku !== undefined)) {
      maxMatches = matches;
      bestRow = r;
      detected = currentMap;
    }
  }

  return { headerRow: bestRow, columns: detected };
}

function extractExcelMetadata(rows: any[][], headerRow: number) {
  let supplierName = '';
  let invoiceNumber = '';
  let date = '';

  const metaLimit = Math.min(headerRow, 12);
  for (let r = 0; r < metaLimit; r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const val = String(row[c] || '').trim();
      if (!val) continue;

      const invMatch = val.match(/(?:remito|factura|boleta|comprobante|fc|fa|nro|n°|num)[:\s#]*([A-Za-z0-9\-_]+(?:\s+[A-Za-z0-9\-_]+)?)/i);
      if (invMatch && !invoiceNumber && invMatch[1].length >= 3) {
        invoiceNumber = invMatch[1].trim();
      }

      const dateMatch = val.match(/(?:fecha)[:\s]*(\d{4}[-/.]\d{2}[-/.]\d{2}|\d{2}[-/.]\d{2}[-/.]\d{4})/i) || val.match(/(\d{4}[-/.]\d{2}[-/.]\d{2})/);
      if (dateMatch && !date) {
        date = dateMatch[1];
      }

      if (r <= 3 && !supplierName && val.length > 5 && !/cliente|fecha|remito|factura|cuit|ingresos|direccion/i.test(val)) {
        supplierName = val;
      }
    }
  }

  return { supplierName, invoiceNumber, date };
}

function parseExcelInvoiceData(file: Express.Multer.File, manualTotal?: number) {
  const workbook = XLSX.read(file.buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error('El archivo Excel no contiene hojas de cálculo legibles.');
  }

  const worksheet = workbook.Sheets[firstSheetName];
  const rows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  if (!rows || rows.length === 0) {
    throw new Error('La planilla Excel está vacía.');
  }

  const { headerRow, columns } = detectExcelColumns(rows);
  if (headerRow === -1 || (columns.name === undefined && columns.sku === undefined)) {
    throw new Error('No se pudieron identificar las columnas de la planilla Excel (se requiere al menos columna de Descripción/Producto o Código).');
  }

  const meta = extractExcelMetadata(rows, headerRow);

  const items: Array<{
    sku: string;
    barcode: string;
    name: string;
    packageQuantity: number;
    unitsPerPack: number;
    total: string;
  }> = [];

  const summaryKeywords = ['total general', 'total', 'subtotal', 'resumen', 'son pesos', 'i.v.a', 'iva', 'transporte', 'saldo'];

  for (let r = headerRow + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    if (row.length === 0) continue;

    const nonBlankCount = row.filter((c: any) => String(c).trim().length > 0).length;
    if (nonBlankCount === 0) continue;

    const rawName = columns.name !== undefined ? String(row[columns.name] || '').trim() : '';
    const rawSku = columns.sku !== undefined ? String(row[columns.sku] || '').trim() : '';
    const rawBarcode = columns.barcode !== undefined ? String(row[columns.barcode] || '').trim() : '';

    const firstColStr = String(row[0] || '').toLowerCase().trim();
    if (summaryKeywords.some(k => firstColStr.startsWith(k))) {
      continue;
    }

    if (!rawName && !rawSku) continue;

    const itemName = rawName || rawSku;
    if (summaryKeywords.some(k => itemName.toLowerCase().startsWith(k))) continue;

    const qty = columns.quantity !== undefined ? (parseArgentineNumber(row[columns.quantity]) || 1) : 1;
    const uPack = columns.unitsPerPack !== undefined ? (parseArgentineNumber(row[columns.unitsPerPack]) || 1) : 1;
    const cost = columns.cost !== undefined ? parseArgentineNumber(row[columns.cost]) : 0;
    let total = columns.total !== undefined ? parseArgentineNumber(row[columns.total]) : 0;

    if (total === 0 && cost > 0 && qty > 0) {
      total = cost * qty;
    }

    items.push({
      sku: rawSku,
      barcode: rawBarcode,
      name: itemName,
      packageQuantity: qty,
      unitsPerPack: uPack,
      total: String(total),
    });
  }

  if (items.length === 0) {
    throw new Error('No se detectaron filas de productos válidas debajo del encabezado de la planilla Excel.');
  }

  return {
    rawTableTranscription: '',
    supplierName: meta.supplierName,
    invoiceNumber: meta.invoiceNumber,
    date: meta.date || new Date().toISOString().split('T')[0],
    totalFacturaAPagar: manualTotal !== undefined ? String(manualTotal) : undefined,
    items,
  };
}

function parseArgentineNumber(val: any): number {
  if (val === undefined || val === null) return 0;
  if (typeof val === 'number') return val;
  const str = String(val).trim();
  
  // Remove spaces
  let cleanStr = str.replace(/\s/g, '');
  
  // If the string contains both dot and comma
  if (cleanStr.includes('.') && cleanStr.includes(',')) {
    const dotIdx = cleanStr.indexOf('.');
    const commaIdx = cleanStr.indexOf(',');
    if (dotIdx < commaIdx) {
      // Argentine format: 6.528,97 -> remove dots, replace comma with dot
      cleanStr = cleanStr.replace(/\./g, '').replace(/,/g, '.');
    } else {
      // US format: 6,528.97 -> remove commas
      cleanStr = cleanStr.replace(/,/g, '');
    }
  } else if (cleanStr.includes(',')) {
    // Only comma: 1549,03 -> replace with dot
    cleanStr = cleanStr.replace(/,/g, '.');
  } else {
    // Check if it's an integer with a dot that might be a thousands separator
    const parts = cleanStr.split('.');
    if (parts.length === 2 && parts[1].length === 3) {
      // E.g. 6.528 -> 6528
      cleanStr = cleanStr.replace(/\./g, '');
    }
  }
  
  const parsed = parseFloat(cleanStr);
  return isNaN(parsed) ? 0 : parsed;
}

@Injectable()
export class PurchasesService {
  constructor(
    private prisma: PrismaService,
    private firebaseSync: FirebaseSyncService,
    private ai: AiService,
    private matcher: ProductMatcherService,
    private syncImage: SyncImageService,
    // Aviso al celular del dueño cuando un empleado escanea una boleta (tanda 6.3)
    @Optional() private notifier?: NotifyService,
  ) {}

  /**
   * Cada producto de la compra que no tiene foto queda con una, sin que el dueño la elija: por código
   * de barras real o por el nombre (SyncImageService.autoPhotos). En segundo plano: no frena la carga.
   */
  private photosFor(purchaseId: string) {
    if (!this.syncImage) return;
    setImmediate(async () => {
      try {
        const items = await (this.prisma as any).purchaseItem.findMany({ where: { purchaseId }, select: { productId: true } });
        await this.syncImage.autoPhotos(items.map((i: any) => i.productId));
      } catch (e: any) {
        console.error('[Compras] Fotos automáticas:', e?.message || e);
      }
    });
  }

  async pending() {
    const rows = await (this.prisma as any).purchase.findMany({
      where: { status: 'PENDING' },
      select: { id: true, total: true, invoiceNumber: true, createdAt: true, notes: true, supplier: { select: { name: true } }, user: { select: { fullName: true } }, _count: { select: { items: true } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    const drafts = await this.drafts(rows.map((p: any) => p.id));
    return rows.map((p: any) => ({ id: p.id, total: p.total, invoiceNumber: p.invoiceNumber, createdAt: p.createdAt, supplierName: p.supplier?.name || '', userName: p.user?.fullName || '', items: drafts.get(p.id)?.items?.length ?? p._count?.items ?? 0, via: /WhatsApp/i.test(p.notes || '') ? 'whatsapp' : 'scan' }));
  }

  /** Renglones guardados de las compras escaneadas que esperan revisión */
  private async drafts(ids: string[]): Promise<Map<string, any>> {
    if (!ids.length) return new Map();
    const rows = await this.prisma.$queryRawUnsafe<{ id: string; draft: string }[]>(
      `SELECT id, draft FROM purchases WHERE draft IS NOT NULL AND id IN (${ids.map(() => '?').join(',')})`, ...ids,
    ).catch((): any[] => []);
    const out = new Map<string, any>();
    for (const r of rows) { try { out.set(r.id, JSON.parse(r.draft)); } catch { /* dañado: se revisa como antes */ } }
    return out;
  }

  async findAll() {
    const rows = await (this.prisma as any).purchase.findMany({
      include: { supplier: true, user: { select: { fullName: true } }, items: true },
      orderBy: { createdAt: 'desc' },
    });
    const drafts = await this.drafts(rows.filter((p: any) => p.status === 'PENDING').map((p: any) => p.id));
    const undo = await this.undoable(rows.filter((p: any) => p.status === 'COMPLETED').slice(0, 900).map((p: any) => p.id));
    return rows.map((p: any) => ({ ...(drafts.has(p.id) ? { ...p, draft: drafts.get(p.id) } : p), canUndo: undo.has(p.id) }));
  }

  /** Algunas compras con sus renglones leídos (las pestañas de "Revisar boletas"), en el orden pedido */
  async findByIds(ids: string[]) {
    const list = [...new Set(ids.map(String).filter(Boolean))].slice(0, 100);
    if (!list.length) return [];
    const rows = await (this.prisma as any).purchase.findMany({
      where: { id: { in: list } },
      include: { supplier: true, user: { select: { fullName: true } }, items: true },
    });
    const drafts = await this.drafts(rows.filter((p: any) => p.status === 'PENDING').map((p: any) => p.id));
    const byId = new Map(rows.map((p: any) => [p.id, drafts.has(p.id) ? { ...p, draft: drafts.get(p.id) } : p]));
    return list.map((id) => byId.get(id)).filter(Boolean);
  }

  async create(data: {
    supplierId: string;
    userId: string;
    invoiceNumber?: string;
    items?: { 
      productId?: string; 
      quantity: number; 
      cost: number; 
      buyFormat?: string;
      salePrice?: number;
      expiresAt?: string; // Vencimiento del lote (productos con control de vencimiento)
      /** El renglón de la boleta (código y nombre del proveedor): se aprende para la próxima */
      source?: { code?: string; name?: string };
      /** EAN de la boleta para un producto que no tenía código de barras (se guarda al confirmar) */
      setBarcode?: string;
      newProductData?: {
        name: string;
        barcode?: string;
        sku?: string;
        salePrice?: number;
        categoryId?: string;
        brandId?: string;
        unitsPerPack?: number;
        presentationType?: string;
        listPrice?: number;
        discount1?: number;
        discount2?: number;
        discount3?: number;
        taxRate?: number;
      };
    }[];
    paymentStatus: 'PAID' | 'OWED';
    paymentMethod?: string;
    notes?: string;
    manualTotal?: number;
    /** factura, remito, nota de credito: para reconocer después la factura de un remito (tanda 5) */
    docType?: string | null;
  }) {
    const total = data.manualTotal !== undefined 
      ? Number(data.manualTotal) 
      : (data.items || []).reduce((acc, item) => acc + (item.quantity * item.cost), 0) * 1.21;
    const productsToSync: { barcode: string; newStock: number; salePrice: number; name: string; description: string; categoryName: string; minStock: number; imageUrl: string }[] = [];

    const learned: { code?: string; name?: string; productId: string }[] = [];
    const priceRound = (await this.scanSettings()).round;
    const undo = new Map<string, UndoRow>();
    const createdIds = new Set<string>();
    const purchase = await this.prisma.$transaction(async (tx) => {
      // 1. Create Purchase
      const newPurchase = await (tx as any).purchase.create({
        data: {
          supplierId: data.supplierId,
          userId: data.userId,
          invoiceNumber: data.invoiceNumber,
          total,
          paymentStatus: data.paymentStatus,
          paymentMethod: data.paymentMethod,
          notes: data.notes,
        },
      });

      // 2. Create Items and Update Stock
      if (data.items && data.items.length > 0) {
        for (const item of data.items) {
          let productId = item.productId;

        // If it's a new product, create it first
        if (!productId && item.newProductData) {
          const barcode = item.newProductData.barcode || null;
          // El SKU (código del proveedor) no identifica al producto: otro proveedor puede usar el
          // mismo código. Si ya lo tiene otro producto, el nuevo queda sin SKU (Ventra lo recuerda igual)
          let sku = item.newProductData.sku || null;
          if (sku && await tx.product.findUnique({ where: { sku }, select: { id: true } })) sku = null;

          let existingProduct = null;
          if (barcode) {
            existingProduct = await tx.product.findUnique({ where: { barcode } });
          }

          if (existingProduct) {
            productId = existingProduct.id;
          } else {
            const costVal = (item.cost || 0) * 1.21;
            const saleVal = item.newProductData.salePrice || (costVal * 1.3);
            const newProduct = await tx.product.create({
              data: {
                name: item.newProductData.name,
                barcode: barcode,
                sku: sku,
                costPrice: costVal,
                salePrice: saleVal,
                stock: 0,
                categoryId: item.newProductData.categoryId || null,
                brandId: item.newProductData.brandId || null,
                unitsPerPack: item.newProductData.unitsPerPack || 1,
                presentationType: item.newProductData.presentationType || 'UNIT',
                // Compra al proveedor: precio de lista sin IVA, descuentos e IVA
                listPrice: item.newProductData.listPrice ?? null,
                discount1: item.newProductData.discount1 || 0,
                discount2: item.newProductData.discount2 || 0,
                discount3: item.newProductData.discount3 || 0,
                taxRate: item.newProductData.taxRate || 0,
                // Si vino la fecha del lote, el producto nuevo ya queda controlando vencimiento
                trackExpiry: Boolean(item.expiresAt),
              },
              include: { category: true }
            });
            productId = newProduct.id;
            createdIds.add(newProduct.id);
          }
        }

        if (item.source && productId) learned.push({ ...item.source, productId });
        // El EAN de la boleta, si el producto no tenía código de barras y nadie más lo usa
        let barcodeSet: string | undefined;
        if (item.setBarcode && isBarcode(item.setBarcode) && productId) {
          const owner = await tx.product.findUnique({ where: { barcode: item.setBarcode }, select: { id: true } });
          if (!owner && (await tx.product.updateMany({ where: { id: productId, OR: [{ barcode: null }, { barcode: '' }] }, data: { barcode: item.setBarcode } })).count) barcodeSet = item.setBarcode;
        }

        const product = await tx.product.findUnique({ 
          where: { id: productId }, 
          include: { category: true } 
        });
        if (!product) throw new NotFoundException(`Producto ${productId} no encontrado`);

        const isPack = item.buyFormat === 'PACK' && product.presentationType === 'PACK';
        const unitsPerPack = isPack ? (product.unitsPerPack || 1) : 1;
        const totalUnitsAdded = item.quantity * unitsPerPack;
        const unitCost = isPack ? (item.cost / unitsPerPack) : item.cost;
        const unitCostWithIva = unitCost * 1.21;

        await (tx as any).purchaseItem.create({
          data: {
            purchaseId: newPurchase.id,
            productId: productId,
            productName: product.name,
            quantity: item.quantity,
            cost: item.cost * 1.21,
            total: item.quantity * item.cost * 1.21,
            buyFormat: item.buyFormat || 'UNIT',
          },
        });

        if (!Number.isFinite(totalUnitsAdded)) throw new BadRequestException(`Cantidad inválida en ${product.name}`);
        const stockAfter = (await tx.product.update({ where: { id: productId }, data: { stock: { increment: totalUnitsAdded } }, select: { stock: true } })).stock;
        const stockBefore = stockAfter - totalUnitsAdded;

        // Update Product Stock, Cost Price and Sale Price
        // Sin precio (un remito en $ 0): solo suma stock. Antes dejaba el costo del producto en $ 0 (tanda 5)
        const noPrice = !(unitCostWithIva > 0) && !createdIds.has(product.id);
        // Sin un precio de venta elegido, se mantiene el margen que ya tenía el producto
        const updatedSalePrice = noPrice ? product.salePrice : keepMarginSale(product, unitCostWithIva, item.salePrice, priceRound);
        const updateData: any = noPrice ? {
          ...(product.supplierId ? {} : { supplierId: data.supplierId }),
          isActive: true,
        } : {
          costPrice: unitCostWithIva, // Store unit cost with IVA
          salePrice: updatedSalePrice,
          ...scaledPrices(product, updatedSalePrice, priceRound),
          // Sin proveedor asignado: queda el de esta compra (agrupa el pedido sugerido)
          ...(product.supplierId ? {} : { supplierId: data.supplierId }),
          isActive: true // Reactivate if soft-deleted
        };

        noteUndo(undo, product, createdIds.has(product.id), noPrice ? { costPrice: product.costPrice, salePrice: product.salePrice } : updateData, barcodeSet);

        if (item.newProductData) {
          if (item.newProductData.categoryId) {
            updateData.categoryId = item.newProductData.categoryId;
          }
          if (item.newProductData.brandId) {
            updateData.brandId = item.newProductData.brandId;
          }
          if (item.newProductData.name) {
            updateData.name = item.newProductData.name;
          }
          if (item.newProductData.unitsPerPack) {
            updateData.unitsPerPack = item.newProductData.unitsPerPack;
          }
          if (item.newProductData.presentationType) {
            updateData.presentationType = item.newProductData.presentationType;
          }
        }

        await tx.product.update({
          where: { id: productId },
          data: updateData,
        });

        // Create Inventory Movement
        await tx.inventoryMovement.create({
          data: {
            productId: productId,
            userId: data.userId,
            type: 'ENTRY',
            quantity: totalUnitsAdded,
            stockBefore,
            stockAfter,
            reason: isPack 
              ? `Compra a proveedor (${item.quantity} paq. x ${unitsPerPack} u.)` 
              : 'Compra a proveedor',
            reference: `Compra #${newPurchase.id}`,
          },
        });
        await createPurchaseLot(tx, product, item.expiresAt, totalUnitsAdded, newPurchase.id);

        productsToSync.push({
          barcode: product.barcode || product.id,
          newStock: stockAfter,
          salePrice: updatedSalePrice,
          name: product.name,
          description: product.description || '',
          categoryName: product.category?.name || 'Varios',
          minStock: product.minStock,
          imageUrl: product.imageUrl || '',
        });
      }
    }

      if (undo.size) await tx.$executeRawUnsafe(`UPDATE purchases SET undo_info = ? WHERE id = ?`, JSON.stringify({ v: 1, at: Date.now(), rows: [...undo.values()] }), newPurchase.id);
      if (data.docType) await tx.$executeRawUnsafe(`UPDATE purchases SET doc_type = ? WHERE id = ?`, String(data.docType).slice(0, 30), newPurchase.id);
      return newPurchase;
    });

    // La próxima boleta de este proveedor encuentra estos productos directo
    if (learned.length) await this.matcher.learn(data.supplierId, learned).catch(() => {});

    // Sync all updated stocks to GoDelivery in real-time outside transaction
    for (const p of productsToSync) {
      this.firebaseSync.syncProductToFirestore(
        p.barcode,
        p.newStock,
        p.salePrice,
        {
          name: p.name,
          description: p.description,
          categoryName: p.categoryName,
          minStock: p.minStock,
          imageUrl: p.imageUrl,
        }
      ).catch(err => {
        console.error(`Error syncing product ${p.barcode} to Firestore after purchase:`, err.message);
      });
    }

    this.photosFor(purchase.id);
    return purchase;
  }

  /**
   * Boleta de un proveedor (fotos con IA, PDF o planilla sin IA). inline: la PC la revisa en la
   * misma pantalla (no se guarda nada). Si no, viene del celular: se carga sola cuando cierra.
   */
  async scanInvoice(files: Express.Multer.File[], manualTotal?: number, userId?: string, opts: { inline?: boolean } = {}) {
    // PDF con texto, Excel y CSV se leen en la PC, sin IA ni costo
    const docFile = files.find(f => isPdfFile(f.originalname || '', f.mimetype) || isSheetFile(f.originalname || '', f.mimetype));
    const isExcel = !!docFile;
    let sourceLabel = 'Escaneado automáticamente con IA.';
    let readCheck: ParsedInvoice['check'] | null = null;
    let readInfo: Pick<ParsedInvoice, 'docType' | 'letter' | 'supplierCuit' | 'pricesIncludeIva' | 'totals'> | null = null;

    let parsedData: any = null;

    if (docFile) {
      const name = docFile.originalname || '';
      let parsed: ParsedInvoice;
      try {
        parsed = await readInvoiceFile(docFile.buffer, name, docFile.mimetype, manualTotal);
      } catch (err: any) {
        if (err instanceof InvoiceReadError) throw new BadRequestException(err.message);
        throw err;
      }
      // Planillas con un formato que el lector nuevo no reconoce: se prueba el lector anterior
      if (!parsed.items.length && isSheetFile(name, docFile.mimetype)) {
        try { parsedData = parseExcelInvoiceData(docFile, manualTotal); } catch { /* sigue abajo */ }
      }
      if (!parsedData) {
        if (!parsed.items.length) {
          throw new BadRequestException('No se encontraron productos en la boleta. Revisá que sea la factura o remito con el detalle de productos.');
        }
        parsedData = {
          supplierName: parsed.supplierName,
          invoiceNumber: parsed.invoiceNumber,
          date: parsed.date || new Date().toISOString().split('T')[0],
          totalFacturaAPagar: parsed.totals.total ?? parsed.check.computedTotal,
          items: parsed.items.map((it) => ({
            sku: it.sku,
            barcode: it.barcode,
            name: it.name,
            packageQuantity: it.quantity,
            unitsPerPack: it.unitsPerPack,
            total: it.netTotal,
          })),
        };
        readCheck = parsed.check;
        readInfo = { docType: parsed.docType, letter: parsed.letter, supplierCuit: parsed.supplierCuit, pricesIncludeIva: parsed.pricesIncludeIva, totals: parsed.totals };
      }
      sourceLabel = isPdfFile(name, docFile.mimetype) ? 'Cargado automáticamente desde el PDF del proveedor.' : 'Cargado automáticamente desde planilla Excel.';
      console.log(`[PurchasesService] Boleta leída sin IA (${name}): ${parsedData.items.length} productos. ${readCheck?.message || ''}`);
    } else {
      // Fotos: las lee la IA de Ventra en la nube (Claude, ver firebase/functions/ai.js). La PC no
      // tiene ninguna clave: pide con su vinculación y el comercio tiene un tope de facturas por mes.
      // Cada foto se lee sola: pueden ser comprobantes distintos (dos facturas, un remito y la nota de
      // otro proveedor). La nube junta las páginas del mismo comprobante y relee el que no cierra.
      // QR de ARCA de cada foto, leído sobre la original (achicada no se lee): total, CUIT, número y tipo exactos
      const qrs = await Promise.all(files.map((f) => readArcaQr(f.buffer)));
      if (manualTotal === undefined && files.length === 1 && qrs[0] && qrTotalPesos(qrs[0]) > 0) manualTotal = qrTotalPesos(qrs[0]);
      const supplierCuits = await this.supplierCuits();
      // Hasta 6 fotos van juntas; más, de a una (stage "page") y después se juntan: sin tope de fotos
      const result = files.length > 6
        ? await this.readPhotosByPage(files, qrs, supplierCuits)
        : (await this.ai.call('invoice', { images: await this.ai.shrink(files, 2000), manualTotal: manualTotal ?? null, multi: true, supplierCuits, qrs })).result;
      // Nube con la versión anterior: devuelve un solo comprobante
      const docs: any[] = Array.isArray(result?.documents) ? result.documents : [result];
      const usable = docs.filter((d) => d?.items?.length);
      if (!usable.length) {
        throw new BadRequestException('No encontramos productos en la foto. Probá con una foto más nítida, de frente y con buena luz.');
      }
      console.log(`[PurchasesService] Fotos leídas con IA: ${usable.length} comprobante(s), ${usable.reduce((s, d) => s + d.items.length, 0)} productos.`);
      const results: any[] = [];
      for (const d of usable) {
        const r = await this.scanOne(d, { readCheck: null, readInfo: null, sourceLabel, isExcel: false, userId, opts });
        results.push({ ...r, docType: d.docType || 'factura', images: Array.isArray(d.images) ? d.images : null, reread: !!d.reread });
      }
      const [first, ...others] = results;
      // El primero se revisa como siempre; los demás vienen aparte (la PC los deja en "Por revisar")
      return { ...first, others, failedImages: Array.isArray(result?.failedImages) ? result.failedImages : [], documentsFound: results.length };
    }
    return this.scanOne(parsedData, { readCheck, readInfo, sourceLabel, isExcel, userId, opts });
  }

  /** Lo que hay que mirar por el tipo de comprobante: nota de crédito, o la factura de un remito ya cargado */
  docNotes(base: any): string[] {
    const out: string[] = [];
    if (base.creditNote && !(base.qrNotes || []).some((n: string) => /nota de crédito/.test(n))) out.push('es una nota de crédito: resta de lo que le debés al proveedor (confirmala aparte)');
    if (base.remitoMatch) out.push(`parece la factura del remito${base.remitoMatch.invoiceNumber ? ` N° ${base.remitoMatch.invoiceNumber}` : ''} del ${new Date(base.remitoMatch.createdAt).toLocaleDateString('es-AR')}: al confirmarla así, el stock no se vuelve a sumar`);
    return out;
  }

  /**
   * Aprobar desde el celular (tanda 6.3): un empleado escaneó una boleta y quedó para revisar → al
   * dueño le llega el aviso al celular. Si la escaneó el dueño (o con el candado), no hace falta.
   */
  private async askOwner(userId: string | undefined, d: { supplier: string; items: number; total: number; purchaseId: string; why: string[] }) {
    if (!userId || !this.notifier) return;
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true, fullName: true } }).catch(() => null);
    if (!u || u.role === 'ADMIN') return;
    this.notifier.enqueue('purchaseToApprove', { ...d, user: u.fullName, why: d.why.slice(0, 3) });
  }

  // ─── Automático por proveedor (tanda 6.2) ───
  /** ¿Las boletas de este proveedor se cargan solas? */
  async supplierAuto(supplierId?: string | null): Promise<boolean> {
    if (!supplierId) return false;
    const r = await this.prisma.$queryRawUnsafe<{ scan_auto: number | null }[]>(`SELECT scan_auto FROM suppliers WHERE id = ?`, supplierId).catch(() => []);
    return Number(r[0]?.scan_auto) === 1;
  }

  /**
   * Una boleta escaneada de este proveedor se confirmó: sin tocar nada suma a la racha; si hubo que
   * corregir, la racha vuelve a 0 y, si se cargaban solas, se apaga (y se avisa). Devuelve la oferta
   * "¿Cargar solas las de este proveedor?" cuando la racha llega a 5 (si no la rechazó antes).
   */
  async scanStreak(supplierId: string, untouched: boolean) {
    const rows = await this.prisma.$queryRawUnsafe<{ name: string; scan_auto: number | null; scan_streak: number | null; scan_auto_declined: number | null }[]>(
      `SELECT name, scan_auto, scan_streak, scan_auto_declined FROM suppliers WHERE id = ?`, supplierId);
    const s = rows[0];
    if (!s) return null;
    if (!untouched) {
      await this.prisma.$executeRawUnsafe(`UPDATE suppliers SET scan_streak = 0, scan_auto = 0, scan_auto_declined = 0 WHERE id = ?`, supplierId);
      if (Number(s.scan_auto) === 1) await this.notify('Carga automática apagada', `Las boletas de ${s.name} ya no se cargan solas: una necesitó corrección. Cuando vuelvan a salir bien, te lo ofrecemos de nuevo.`);
      return null;
    }
    const streak = (Number(s.scan_streak) || 0) + 1;
    await this.prisma.$executeRawUnsafe(`UPDATE suppliers SET scan_streak = ? WHERE id = ?`, streak, supplierId);
    return streak >= 5 && Number(s.scan_auto) !== 1 && Number(s.scan_auto_declined) !== 1 ? { supplierId, name: s.name, streak } : null;
  }

  /** El dueño contestó la oferta: sí (se cargan solas) o no (no se vuelve a ofrecer hasta otra racha con corrección) */
  async setSupplierAuto(supplierId: string, enabled: boolean) {
    await this.prisma.$executeRawUnsafe(`UPDATE suppliers SET scan_auto = ?, scan_auto_declined = ? WHERE id = ?`, enabled ? 1 : 0, enabled ? 0 : 1, supplierId);
    return { ok: true, enabled };
  }

  /** ¿Ya se sabe algo de este proveedor? (códigos aprendidos o alguna compra confirmada) */
  private async supplierHasHistory(supplierId?: string | null): Promise<boolean> {
    if (!supplierId) return false;
    const codes = await this.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*) AS n FROM supplier_codes WHERE supplier_id = ?`, supplierId).catch(() => [{ n: 0 }]);
    if (Number(codes[0]?.n) > 0) return true;
    return (await this.prisma.purchase.count({ where: { supplierId, status: 'COMPLETED' } }).catch(() => 0)) > 0;
  }

  /** Muchas fotos (WhatsApp, más de 6): cada una se lee sola en la nube, de a 6, y al final se juntan */
  private async readPhotosByPage(files: Express.Multer.File[], qrs: (ArcaQr | null)[], supplierCuits: string[]) {
    const reads: any[] = new Array(files.length).fill(null);
    let next = 0;
    const worker = async () => {
      while (next < files.length) {
        const i = next++;
        try {
          const [image] = await this.ai.shrink([files[i]], 2000);
          const qr = qrs[i] || null;
          const anchor = qr && qrTotalPesos(qr) > 0 ? qrTotalPesos(qr) : null;
          const { result } = await this.ai.call('invoice', { stage: 'page', image, index: i, manualTotal: anchor, supplierCuits, qr }, { timeoutMs: 290_000 });
          reads[i] = result?.read || { image: i, error: 'No se pudo leer', items: [] };
        } catch (err: any) {
          // El tope del mes o del día corta todo; una foto que falla no
          if (err?.getStatus?.() === 429) throw err;
          reads[i] = { image: i, error: err?.message || 'No se pudo leer', items: [] };
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(6, files.length) }, worker));
    if (!reads.some((r) => r && !r.error && (r.items || []).length)) throw new BadRequestException('No encontramos productos en las fotos. Probá con fotos más nítidas, de frente y con buena luz.');
    const { result } = await this.ai.call('invoice', { stage: 'group', reads: reads.filter(Boolean) });
    return result;
  }

  /**
   * Lo que dice el QR de ARCA que hay que mirar: una nota de crédito o de débito no es una compra común,
   * y una factura a nombre de otro CUIT no es de este comercio (solo si se sabe el CUIT propio).
   */
  async qrNotes(qr: any): Promise<string[]> {
    if (!qr) return [];
    const notes: string[] = [];
    const kind = qr.kind || qrKind(qr);
    if (kind === 'nota de crédito') notes.push('es una nota de crédito (lo dice el QR de ARCA): no es una compra y no tiene que sumar stock');
    else if (kind === 'nota de débito') notes.push('es una nota de débito (lo dice el QR de ARCA)');
    const rec = String(qr.nroDocRec || '').replace(/\D/g, '');
    if (Number(qr.tipoDocRec) === 80 && rec.length === 11) {
      const own = (await this.matcher.ownCuits().catch(() => [] as string[])).filter((c) => c.length === 11);
      if (own.length && !own.includes(rec)) notes.push(`esta factura está a nombre de otro (CUIT ${rec.slice(0, 2)}-${rec.slice(2, 10)}-${rec.slice(10)})`);
    }
    return notes;
  }

  /**
   * Un comprobante que ya leyó la IA hoja por hoja (lectura en segundo plano, ver ScanJobsService) →
   * queda en "Por revisar" con lo leído y por qué hay que mirarlo. Nada de stock ni costos todavía.
   */
  async saveScannedDocument(doc: any, userId?: string) {
    const base: any = await this.scanOne(doc, { readCheck: null, readInfo: null, sourceLabel: 'Escaneado automáticamente con IA.', isExcel: false, userId, opts: { inline: true } });
    const out = { ...base, docType: doc.docType || 'factura', images: Array.isArray(doc.images) ? doc.images : null, reread: !!doc.reread };
    const why: string[] = [];
    if (base.check?.missingPages) why.push(base.missingPageNumbers?.length ? `faltan hojas (${base.missingPageNumbers.join(', ')})` : `${base.missingPages === 1 ? 'falta 1 hoja' : `faltan ${base.missingPages} hojas`}`);
    if (doc.unnumberedPages) why.push(doc.unnumberedPages === 1 ? 'en una foto no se ve qué número de hoja es' : `en ${doc.unnumberedPages} fotos no se ve qué número de hoja es`);
    else if (base.check && base.check.ok === false) why.push('los renglones no suman el total de la boleta');
    else if (!base.check) why.push('no se pudo leer el total de la boleta');
    const doubts = (base.items || []).filter((it: any) => it.doubtful).length;
    if (doubts) why.push(`${doubts} ${doubts === 1 ? 'renglón dudoso' : 'renglones dudosos'}`);
    if (base.strayNumber) why.push('no tiene número propio: el que se veía era de otra factura de atrás');
    if (base.photoIssues?.length) why.push(`la foto tiene partes que no se ven bien (${base.photoIssues.map((p: any) => p.issue).join('; ')})`);
    if (out.docType === 'remito') why.push('es un remito: los precios suelen venir en la factura');
    why.push(...(base.qrNotes || []), ...this.docNotes(base));
    // Las hojas que faltaban de una factura que está en "Por revisar": se suman a esa (antes decía "ya estaba cargada")
    // Proveedor con carga automática y boleta limpia: se carga sola como desde el celular (tanda 6.2)
    if (!why.length && base.check?.ok === true && await this.supplierAuto(base.matchedSupplier?.id)) {
      const auto: any = await this.scanOne(doc, { readCheck: null, readInfo: null, sourceLabel: 'Escaneado automáticamente con IA.', isExcel: false, userId, opts: { inline: false } });
      if (auto.status === 'COMPLETED') return { ...out, ...auto, why: [] };
    }
    const same = await this.findSameInvoice(base.matchedSupplier?.id, base.invoiceNumber);
    if (same?.status === 'PENDING') {
      const old = (await this.drafts([same.id])).get(same.id);
      const merged = old ? mergeMissingPages(old, { ...out, why }) : null;
      if (merged) {
        await this.prisma.$executeRawUnsafe(`UPDATE purchases SET draft = ?, total = ? WHERE id = ?`, JSON.stringify(merged), Number(merged.printedTotal) || 0, same.id);
        return { ...merged, purchaseId: same.id, status: 'PENDING', mergedPages: true };
      }
    }
    const r = await this.pendingFromPreview(out, userId, 'escaneo', why);
    return { ...out, why, purchaseId: r.purchaseId, status: r.status };
  }

  /**
   * Un comprobante ya leído (de un PDF, una planilla o una o varias fotos) → proveedor, productos
   * encontrados, control de totales y costos. inline: vista previa. Si no (celular): se carga solo si
   * cierra y no hay nada dudoso; si no, queda pendiente para revisar en la PC.
   */
  private async scanOne(parsedData: any, ctx: { readCheck: ParsedInvoice['check'] | null; readInfo: Pick<ParsedInvoice, 'docType' | 'letter' | 'supplierCuit' | 'pricesIncludeIva' | 'totals'> | null; sourceLabel: string; isExcel: boolean; userId?: string; opts: { inline?: boolean } }) {
    const { readCheck, readInfo, sourceLabel, isExcel, userId, opts } = ctx;
    // Proveedor: el que ya está cargado (nombre parecido) o, si no está, se crea con el nombre de la boleta
    const supplier = await this.matcher.findSupplier(parsedData.supplierName, true, parsedData.supplierCuit || readInfo?.supplierCuit);
    const settings = await this.scanSettings();
    // ¿Esta boleta ya se cargó? (mismo proveedor y número): escanearla de nuevo duplicaría el stock y la deuda
    // Nota de crédito (por lo que leyó la IA o por el QR de ARCA): numeración propia, se confirma aparte (tanda 5.2)
    const isCredit = parsedData.docType === 'nota de credito' || parsedData.qr?.kind === 'nota de crédito';
    const duplicate = await this.findSameInvoice(supplier?.id, parsedData.invoiceNumber, isCredit);

    // Control de la boleta: con IVA (factura A) la suma de renglones x 1,21 da el total; con el IVA
    // adentro (factura B/C, ticket), la suma da el total. Así se sabe también si los precios lo traen.
    // Renglones en $0 (un cambio de mercadería, "PEDIDO AC DIGITAL", una promo sin precio): no se compran,
    // y antes se ofrecían como productos nuevos para crear. Quedan anotados para avisarlos.
    const allItems: any[] = parsedData.items || [];
    const isFree = (it: any) => parseArgentineNumber(it.total) === 0;
    const skippedLines = allItems.filter(isFree).map((it) => String(it.name || '').trim()).filter(Boolean);
    // Descuentos en negativo ("LIMPIEZA DEL HOGAR 15%", bonificaciones): se reparten entre los productos
    // en proporción a su importe, así la boleta cierra y el costo de cada uno es lo que se pagó de verdad
    const discounts = allItems.filter((it) => parseArgentineNumber(it.total) < 0);
    const rawItems: any[] = allItems.filter((it) => parseArgentineNumber(it.total) > 0);
    // Un descuento que dice su % y da justo ese % de un solo producto (mejor si con la misma cantidad) es de
    // ese producto: Vital "LIMPIEZA DEL HOGAR 15%" 4 un = 15% del SKIP x4 (2026-11-12). El resto se reparte.
    const own = rawItems.map((it) => parseArgentineNumber(it.total));
    const pooled: number[] = [];
    for (const d of discounts) {
      const amount = -parseArgentineNumber(d.total);
      const pct = Number((String(d.name || '').match(/(\d+(?:[.,]\d+)?)\s*%/) || [])[1]?.replace(',', '.')) / 100;
      let target = -1;
      if (pct > 0 && pct < 1) {
        const fits = rawItems.map((_, i) => i).filter((i) => own[i] > amount && Math.abs(parseArgentineNumber(rawItems[i].total) * pct - amount) <= Math.max(2, amount * 0.01));
        const sameQty = fits.filter((i) => Number(rawItems[i].quantity) > 0 && Number(rawItems[i].quantity) === Number(d.quantity));
        target = sameQty.length === 1 ? sameQty[0] : fits.length === 1 ? fits[0] : -1;
      }
      if (target >= 0) own[target] -= amount;
      else pooled.push(amount);
    }
    const gross = own.reduce((s, v) => s + v, 0);
    const discountTotal = pooled.reduce((s, v) => s + v, 0);
    const discountFactor = gross > 0 && discountTotal > 0 && discountTotal < gross ? (gross - discountTotal) / gross : 1;
    const lineTotals = own.map((v) => v * discountFactor);
    const sum = lineTotals.reduce((a, b) => a + b, 0);
    const printed = parseArgentineNumber(parsedData.totalFacturaAPagar);
    const subtotal = parseArgentineNumber(parsedData.subtotalNeto);
    const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(50, b * 0.02);
    let totalsOk: boolean | null = readCheck ? !!readCheck.ok : null;
    let netFactor = 1;
    if (!readCheck && subtotal > 0 && sum > 0 && near(sum, subtotal)) {
      // Contra el subtotal neto impreso: cierra aunque haya percepciones, IVA 10,5% o impuestos
      // internos. Si el subtotal es igual al total (factura B/C o ticket), los precios traen IVA.
      totalsOk = true;
      if (printed > 0 && near(printed, subtotal)) netFactor = 1 / 1.21;
    } else if (!readCheck && printed > 0 && sum > 0) {
      if (near(sum * 1.21, printed)) totalsOk = true;
      else if (near(sum, printed)) { totalsOk = true; netFactor = 1 / 1.21; }
      else totalsOk = false;
    }
    // Si el total no lo confirma (falta una hoja, no se ve el pie) vale lo que leyó la IA: una lista de precios
    // "Exento" o una factura B trae precios finales y no hay que sumarles el 21% (cervezas, 2026-11-12)
    if (totalsOk !== true && netFactor === 1 && parsedData.precios === 'finales') netFactor = 1 / 1.21;
    // Con el IVA y las percepciones impresos la cuenta es exacta: el 2% de arriba dejaba pasar un descuento
    // olvidado que las percepciones tapaban (Vital, 2026-11-12). Solo puede pasar de "cierra" a "no cierra".
    const ivaPrinted = parseArgentineNumber(parsedData.ivaTotal);
    const otherTaxes = Math.max(0, parseArgentineNumber(parsedData.otrosImpuestos));
    const tight = (a: number, b: number) => b > 0 && Math.abs(a - b) <= Math.max(20, b * 0.005);
    if (!readCheck && totalsOk === true && ivaPrinted > 0 && printed > 0
      && !tight(sum + ivaPrinted + otherTaxes, printed) && !tight(sum, printed) && !(subtotal > 0 && tight(sum, subtotal))) totalsOk = false;
    // Y al revés: con percepciones grandes (Vital: IIBB + IVA 3%) la cuenta x 1,21 no da, pero la exacta sí
    if (!readCheck && totalsOk === false && ivaPrinted > 0 && printed > 0 && tight(sum + ivaPrinted + otherTaxes, printed)) totalsOk = true;
    // Faltan hojas (dice "hoja 1 de 6" y llegaron 3): el total no se puede controlar todavía
    const missingPageNumbers: number[] = Array.isArray(parsedData.missingPageNumbers) ? parsedData.missingPageNumbers.map(Number).filter((n: number) => n > 0) : [];
    // Hojas sin número legible: se sabe cuántas faltan, no cuáles
    const missingCount = missingPageNumbers.length || Math.max(0, Number(parsedData.missingPages) || 0);
    if (missingCount) totalsOk = null;
    // Impuestos internos (bebidas, cigarrillos): son costo, no se recuperan como el IVA o las percepciones.
    // Antes quedaban afuera del costo. Con precios sin IVA, se reparten entre los renglones según su importe.
    const internalTaxes = Math.max(0, parseArgentineNumber(parsedData.impuestosInternos));
    const internalFactor = internalTaxes > 0 && netFactor === 1 && sum > 0 && internalTaxes < sum * 0.6 ? 1 + internalTaxes / sum : 1;

    // Código de barras y SKU son distintos: el EAN va al código de barras y el código del proveedor
    // al SKU, aunque la IA los haya puesto cambiados. Se mira la columna entera: la de "ARTICULO" de
    // Nini (1000014274, 000005341002) es de códigos internos aunque alguno pase el control de casualidad
    const codes = splitInvoiceCodes(rawItems.map((it) => ({ barcode: it.barcode, sku: it.sku })));
    const rows = rawItems.map((it, i) => ({ ...codes[i], code: codes[i].sku, name: String(it.name || '').trim() }));
    // Con el CUIT, el buscador consulta el mapa compartido entre comercios (tanda 3)
    const { matches, candidates, sharedHints } = await this.matcher.match(rows.map((r) => ({ code: r.sku, barcode: r.barcode, name: r.name })), { supplierId: supplier?.id, useAi: true, supplierCuit: parsedData.supplierCuit || readInfo?.supplierCuit || null });

    const roundUp = (n: number) => (settings.round ? Math.ceil(n / settings.round - 1e-9) * settings.round : Math.round(n * 100) / 100);
    const items = rawItems.map((it, i) => {
      const r = rows[i];
      const m = matches[i];
      const p: any = m?.product || null;
      let unitsPerPackVal = Number(it.unitsPerPack) || 1;
      let quantityVal = (Number(it.packageQuantity) || 1) * unitsPerPackVal;
      const netTotal = lineTotals[i] * netFactor * internalFactor;
      // Vino como unidades pero el precio es del bulto entero (el producto trae N por bulto y el
      // costo queda N veces más cerca del que tenía): se pasa a unidades
      let packFixed = false;
      const upp = Number(p?.unitsPerPack) || 1;
      if (p && upp > 1 && unitsPerPackVal === 1 && p.costPrice > 0 && quantityVal > 0) {
        const asUnit = (netTotal / quantityVal) * 1.21;
        if (Math.abs(Math.log(asUnit / upp / p.costPrice)) < Math.abs(Math.log(asUnit / p.costPrice)) && Math.abs(Math.log(asUnit / upp / p.costPrice)) < Math.log(1.6)) {
          unitsPerPackVal = upp;
          quantityVal *= upp;
          packFixed = true;
        }
      }
      // "COCA-COLA 600*12" x 2 son 2 bultos de 12 = 24 botellas: el stock y el costo van por unidad.
      // Si el producto ya existe, solo cuando el costo por unidad queda más cerca del que tenía.
      let packFromName = 0;
      const nameUpp = !packFixed && unitsPerPackVal === 1 ? unitsInName(r.name) : 0;
      if (nameUpp > 1 && quantityVal > 0 && netTotal > 0) {
        const asUnit = (netTotal / quantityVal) * 1.21;
        const fits = !p || !(p.costPrice > 0) || Math.abs(Math.log(asUnit / nameUpp / p.costPrice)) < Math.abs(Math.log(asUnit / p.costPrice));
        if (fits) { unitsPerPackVal = nameUpp; quantityVal *= nameUpp; packFromName = nameUpp; }
      }
      const netCost = quantityVal > 0 ? netTotal / quantityVal : 0;
      const costWithIva = netCost * 1.21;
      const changePct = p && p.costPrice > 0 ? Math.round((costWithIva / p.costPrice - 1) * 1000) / 10 : null;
      // Precio de venta sugerido: mantiene el margen del producto, o el margen de siempre si es nuevo
      // Si el dueño anotó a mano el precio de venta al lado del renglón, manda ese
      const handPrice = parseArgentineNumber(it.handPrice);
      const handOk = handPrice > 0 && handPrice > costWithIva * 0.8 && handPrice < costWithIva * 20;
      const suggestedSalePrice = handOk ? handPrice : p
        ? (p.costPrice > 0 && settings.keepMargin ? roundUp(p.salePrice * (costWithIva / p.costPrice)) : p.salePrice)
        : roundUp(costWithIva * (1 + settings.margin / 100));
      const reasons: string[] = [];
      if (!(quantityVal > 0) || !(netCost > 0)) reasons.push('no se leyó la cantidad o el precio');
      if (m?.confidence === 'baja') reasons.push('no es seguro que sea ese producto');
      // La IA controla cada renglón: cantidad × precio unitario tiene que dar el total de la línea
      if (it.lineOk === false) reasons.push('la cantidad por el precio no da el total del renglón: comparalo con la foto');
      // Hoja sin total para controlar y lecturas que no coincidieron en este renglón
      if (it.unsure) reasons.push('la IA lo leyó distinto en dos lecturas: comparalo con la foto');
      // No está, pero hay alguno parecido: puede ser tuyo con otro nombre. No se crea solo (sería un duplicado)
      if (!p && candidates[i]?.length) reasons.push(`puede que ya lo tengas (¿${candidates[i][0].name}?)`);
      // Otros comercios ya dijeron qué producto es este código del proveedor: con 2 o más que coinciden
      // viene completo (código de barras, nombre, unidades por bulto); con uno solo o si no coinciden, a confirmar
      const sh = !p ? sharedHints?.[i] || null : null;
      if (sh && sh.confidence !== 'alta') reasons.push(sh.confidence === 'contradice' ? 'otros comercios no coinciden en qué producto es: confirmalo' : `otro comercio lo cargó como ${sh.name || sh.barcode}: confirmalo`);
      if (changePct !== null && (changePct > 60 || changePct < -40)) reasons.push(`el costo cambia ${changePct > 0 ? '+' : ''}${changePct}%`);
      else if (m?.confidence === 'media' && changePct !== null && Math.abs(changePct) > 25) reasons.push(`el costo cambia ${changePct > 0 ? '+' : ''}${changePct}% y el producto no es seguro`);
      return {
        barcode: r.barcode || (sh?.confidence === 'alta' ? sh.barcode : ''),
        sku: r.sku,
        name: r.name,
        shared: sh ? { barcode: sh.barcode, name: sh.name, unitsPerPack: sh.unitsPerPack, votes: sh.votes, confidence: sh.confidence } : null,
        quantity: quantityVal,
        unitsPerPack: unitsPerPackVal,
        packFromName,
        presentationType: 'UNIT',
        cost: parseFloat(netCost.toFixed(2)),
        total: parseFloat(netTotal.toFixed(2)),
        match: m ? { by: m.by, confidence: m.confidence } : null,
        changePct,
        suggestedSalePrice,
        handPrice: handOk ? handPrice : null,
        doubtful: reasons.length > 0,
        reasons,
        packFixed,
        candidates: p ? [] : candidates[i],
        product: p ? {
          id: p.id, barcode: p.barcode, sku: p.sku, name: p.name, costPrice: p.costPrice, salePrice: p.salePrice,
          unit: p.unit, presentationType: p.presentationType, unitsPerPack: p.unitsPerPack, trackExpiry: p.trackExpiry,
        } : null,
      };
    });

    const base = {
      supplierName: parsedData.supplierName || '',
      matchedSupplier: supplier ? { id: supplier.id, name: supplier.name } : null,
      // Para aprender del proveedor al confirmar (supplier-lessons.js)
      supplierCuit: parsedData.supplierCuit || readInfo?.supplierCuit || null,
      invoiceNumber: parsedData.invoiceNumber || '',
      date: parsedData.date || new Date().toISOString().split('T')[0],
      items,
      check: readCheck || (missingCount ? {
        ok: false,
        missingPages: true,
        message: `${missingPageNumbers.length
          ? `Faltan ${missingPageNumbers.length === 1 ? 'la hoja' : 'las hojas'} ${listJoin(missingPageNumbers.map(String))}`
          : `${missingCount === 1 ? 'Falta 1 hoja' : `Faltan ${missingCount} hojas`}`}${parsedData.pageCount ? ` (de ${parsedData.pageCount})` : ''}: el total se controla cuando estén todas. Sacales foto y escaneá todas juntas, o revisá lo que llegó y confirmalo.`,
        details: [],
      } : totalsOk === null ? null : {
        ok: totalsOk,
        message: totalsOk ? 'Los renglones suman el total de la boleta.' : `Los renglones suman $ ${Math.round(sum * 1.21 * netFactor).toLocaleString('es-AR')} con IVA y la boleta dice $ ${Math.round(printed).toLocaleString('es-AR')}: revisá cantidades, precios y descuentos.`,
        details: [],
      }),
      invoice: readInfo,
      // Total a pagar impreso (con percepciones e impuestos). Un remito sin precios: $ 0, no es deuda
      printedTotal: printed > 0 ? printed : ((parsedData.docType || readInfo?.docType) === 'remito' ? 0 : null),
      skippedLines,
      // Descuentos de la boleta repartidos entre los productos (para avisarlo en la revisión)
      // Impuestos internos sumados al costo de los renglones (para avisarlo en la revisión)
      internalTaxesApplied: internalFactor !== 1 ? Math.round(internalTaxes * 100) / 100 : null,
      discountsApplied: discounts.length && sum > 0 ? { total: Math.round(-discounts.reduce((t, it) => t + parseArgentineNumber(it.total), 0) * 100) / 100, lines: discounts.map((it) => String(it.name || '').trim()) } : null,
      pricesIncludeIva: netFactor !== 1,
      duplicate,
      // Varias fotos: qué tipo de comprobante es, cuáles fotos son suyas y si la IA tuvo que releerlo
      docType: parsedData.docType || readInfo?.docType || null,
      images: Array.isArray(parsedData.images) ? parsedData.images : null,
      reread: !!parsedData.reread,
      // Cómo se verificó la lectura: contra el total impreso, con dos lecturas iguales por hoja, o no se pudo
      verified: parsedData.verified || null,
      missingPages: Number(parsedData.missingPages) || 0,
      missingPageNumbers,
      // Primera boleta de este proveedor (nada aprendido ni compras confirmadas): la pantalla ofrece asociar de corrido
      firstFromSupplier: !(await this.supplierHasHistory(supplier?.id)),
      // "Hoja 1 de 6": para sumar después las hojas que faltan (mergeMissingPages)
      pageCount: Number(parsedData.pageCount) || 0,
      // Contado en la boleta: al revisarla arranca como pagada
      paymentSuggested: parsedData.condicionVenta === 'contado' ? 'PAID' : parsedData.condicionVenta === 'cuenta corriente' ? 'OWED' : null,
      // Hoja que tenía el número de otra factura asomando atrás (se separó)
      strayNumber: parsedData.strayNumber || null,
      // Fotos que se leyeron con partes que no se ven bien
      photoIssues: Array.isArray(parsedData.photoIssues) ? parsedData.photoIssues : [],
      // QR de ARCA (si se leyó) y lo que hay que mirar por él
      qr: parsedData.qr || null,
      qrNotes: await this.qrNotes(parsedData.qr),
      creditNote: isCredit,
      // ¿Es la factura de un remito que ya sumó el stock? (tanda 5.1)
      remitoMatch: !isCredit && (parsedData.docType || 'factura') !== 'remito'
        ? await this.findRemitoFor(supplier?.id, items.map((it) => ({ productId: it.product?.id, quantity: it.quantity }))) : null,
      // Muestras de la nube de estas hojas: al confirmar se les manda lo que quedó (invoice-samples.js)
      sampleIds: Array.isArray(parsedData.sampleIds) ? parsedData.sampleIds.map(String).slice(0, 60) : [] as string[],
    };

    // En la PC la boleta se revisa en la misma pantalla: no se guarda nada todavía
    if (opts.inline) return { ...base, status: 'INLINE', purchaseId: null };
    // Del celular, una boleta ya cargada no se vuelve a cargar ni queda pendiente
    if (duplicate) return { ...base, status: 'DUPLICATE', purchaseId: duplicate.id, auto: false, why: ['esta boleta ya estaba cargada'] };

    // Del celular: si la boleta cierra y no hay nada dudoso, se carga sola (stock, costos, precios
    // y productos nuevos). Si no, queda para revisar en la PC, sin crear nada.
    const doubts = items.filter((it) => it.doubtful);
    const why: string[] = [];
    // La carga automática: la general, o la de este proveedor (tanda 6.2: después de 5 boletas sin tocar)
    if (!settings.auto && !(await this.supplierAuto(supplier?.id))) why.push('la carga automática está apagada');
    if (totalsOk !== true) why.push(totalsOk === false ? 'los renglones no suman el total de la boleta' : 'no se pudo leer el total de la boleta');
    if (doubts.length) why.push(`${doubts.length} ${doubts.length === 1 ? 'renglón dudoso' : 'renglones dudosos'}`);
    if (!items.length) why.push('no hay productos');
    if (base.docType === 'remito') why.push('es un remito: los precios suelen venir en la factura');
    why.push(...base.qrNotes);
    why.push(...this.docNotes(base));

    const supplierId = supplier?.id || (await this.matcher.findSupplier('Proveedor sin nombre', true))!.id;
    const resolvedUser = userId || (await this.prisma.user.findFirst({ where: { role: 'ADMIN' } }))?.id || (await this.prisma.user.findFirst())!.id;
    const printedTotal = printed > 0 ? printed : base.docType === 'remito' ? 0 : sum * 1.21 * netFactor;

    if (!why.length) {
      const purchase = await this.create({
        supplierId,
        userId: resolvedUser,
        invoiceNumber: parsedData.invoiceNumber || undefined,
        manualTotal: printedTotal,
        docType: base.docType || 'factura',
        paymentStatus: 'OWED',
        notes: 'Cargada sola desde la foto de la boleta (Ventra IA).',
        items: items.map((it) => ({
          productId: it.product?.id,
          quantity: it.quantity,
          cost: it.cost,
          buyFormat: 'UNIT',
          salePrice: it.suggestedSalePrice,
          source: { code: it.sku, name: it.name },
          newProductData: it.product ? undefined : {
            name: niceName(it.name),
            barcode: isBarcode(it.barcode) ? it.barcode : undefined,
            sku: it.sku || undefined,
            salePrice: it.suggestedSalePrice,
            taxRate: 21,
            ...(it.shared?.confidence === 'alta' && Number(it.shared.unitsPerPack) > 1 ? { unitsPerPack: Number(it.shared.unitsPerPack) } : {}),
          },
        })),
      });
      // Los productos nuevos quedan a la vista del dueño para revisarlos (nombre, categoría, precio)
      const created = await this.prisma.purchaseItem.findMany({ where: { purchaseId: purchase.id }, select: { productId: true, productName: true } });
      const newIds = new Set<string>();
      for (const it of items) if (!it.product) { const c = created.find((x) => x.productName === niceName(it.name)); if (c) newIds.add(c.productId); }
      for (const id of newIds) {
        const name = created.find((c) => c.productId === id)?.productName || '';
        await this.prisma.$executeRawUnsafe(
          `INSERT INTO product_reviews (id, product_name, user_name, image_source, created_at) VALUES (?, ?, ?, NULL, CURRENT_TIMESTAMP) ON CONFLICT(id) DO NOTHING`,
          id, name.slice(0, 200), 'Boleta escaneada',
        ).catch(() => {});
      }
      const updatedPrices = items.filter((it) => it.product && it.suggestedSalePrice !== it.product.salePrice).length;
      // Aumentos que vale la pena saber (más de 10% desde el costo que tenía)
      const raises = items.filter((it) => it.product && it.changePct !== null && it.changePct >= 10)
        .sort((a, b) => (b.changePct || 0) - (a.changePct || 0)).slice(0, 3)
        .map((it) => `${it.product!.name} +${String(it.changePct).replace('.', ',')}%`);
      await this.notify('Boleta cargada sola',
        `${supplier?.name || parsedData.supplierName || 'Proveedor'}: ${items.length} productos, ${updatedPrices} precios actualizados${newIds.size ? `, ${newIds.size} productos nuevos para revisar` : ''}.${raises.length ? ` Aumentos: ${raises.join(', ')}.` : ''}`);
      this.confirmSamples(base, {
        supplierId, invoiceNumber: parsedData.invoiceNumber, manualTotal: printedTotal,
        items: items.map((it) => ({ productId: it.product?.id, quantity: it.quantity, cost: it.cost, buyFormat: 'UNIT', source: { code: it.sku, name: it.name }, newProductData: it.product ? undefined : { name: niceName(it.name), barcode: it.barcode } })),
      }, { auto: true });
      return { ...base, status: 'COMPLETED', purchaseId: purchase.id, auto: true, newProducts: newIds.size, updatedPrices };
    }

    // Para revisar: la compra queda pendiente con los renglones tal cual (sin crear productos)
    const pending = await (this.prisma as any).purchase.create({
      data: {
        supplierId,
        userId: resolvedUser,
        invoiceNumber: parsedData.invoiceNumber || null,
        total: printedTotal,
        status: 'PENDING',
        paymentStatus: 'OWED',
        notes: isExcel ? sourceLabel : 'Escaneada con IA: falta revisarla.',
      },
    });
    await this.prisma.$executeRawUnsafe(`UPDATE purchases SET draft = ? WHERE id = ?`, JSON.stringify({ ...base, why }), pending.id);
    await this.askOwner(userId, { supplier: supplier?.name || parsedData.supplierName || '', items: items.length, total: printedTotal, purchaseId: pending.id, why });
    return { ...base, status: 'PENDING', purchaseId: pending.id, auto: false, why };
  }

  /**
   * La boleta que el dueño mandó por WhatsApp y prefiere revisar en la PC: queda pendiente con lo que
   * ya se leyó (la vista previa de scan-invoice-json), sin volver a leerla con IA ni crear nada. La PC
   * la ve en Compras y avisa al toque (ScannedPurchasesWatcher).
   */
  async pendingFromPreview(preview: any, userId?: string, via = 'WhatsApp', whyOverride?: string[]) {
    const items = Array.isArray(preview?.items) ? preview.items : [];
    if (!items.length) throw new BadRequestException('La boleta no tiene renglones');
    const known = preview?.matchedSupplier?.id
      ? await (this.prisma as any).supplier.findUnique({ where: { id: String(preview.matchedSupplier.id) }, select: { id: true } }).catch(() => null)
      : null;
    const supplierId = known?.id || (await this.matcher.findSupplier(preview?.supplierName || 'Proveedor sin nombre', true))!.id;
    const duplicate = await this.findSameInvoice(supplierId, preview?.invoiceNumber);
    if (duplicate) return { status: 'DUPLICATE', purchaseId: duplicate.id };
    const resolvedUser = userId || (await this.prisma.user.findFirst({ where: { role: 'ADMIN' } }))?.id || (await this.prisma.user.findFirst())!.id;
    const sum = items.reduce((s: number, it: any) => s + (Number(it?.total) || (Number(it?.quantity) || 0) * (Number(it?.cost) || 0)), 0);
    // Lo que dice la boleta que se paga (con percepciones); un remito en $ 0 no deja deuda
    const printed = preview?.printedTotal != null ? Number(preview.printedTotal) : Number(preview?.invoice?.totals?.total) || 0;
    const total = printed > 0 || preview?.printedTotal === 0 ? printed : sum * 1.21;
    const pending = await (this.prisma as any).purchase.create({
      data: {
        supplierId, userId: resolvedUser, invoiceNumber: preview?.invoiceNumber || null, total,
        status: 'PENDING', paymentStatus: 'OWED', notes: via === 'escaneo' ? 'Escaneada con IA: falta revisarla.' : via === 'fotos' ? 'Otro comprobante de las fotos escaneadas: falta revisarlo.' : `Mandada por ${via}: falta revisarla.`,
      },
    });
    const { status: _s, purchaseId: _p, others: _o, failedImages: _f, documentsFound: _d, ...base } = preview || {};
    const why = whyOverride || [via === 'fotos' ? 'venía en las mismas fotos que otro comprobante' : `la mandaste por ${via} para revisarla en la PC`, ...(base.docType === 'remito' ? ['es un remito: los precios suelen venir en la factura'] : [])];
    await this.prisma.$executeRawUnsafe(`UPDATE purchases SET draft = ? WHERE id = ?`,
      JSON.stringify({ ...base, matchedSupplier: base.matchedSupplier || { id: supplierId, name: base.supplierName || '' }, why }), pending.id);
    return { status: 'PENDING', purchaseId: pending.id, items: items.length };
  }

  /** Una compra del mismo proveedor con el mismo número de boleta (sin contar las anuladas) */
  private async findSameInvoice(supplierId: string | null | undefined, invoiceNumber?: string | null, credit = false) {
    // "0010-00000094" y "00010-94" son la misma: punto de venta y número, sin los ceros de adelante
    const digits = (s: string) => {
      const parts = String(s || '').split(/\D+/).filter(Boolean);
      return parts.length >= 2 ? `${Number(parts[parts.length - 2])}-${Number(parts[parts.length - 1])}` : String(s || '').replace(/\D/g, '').replace(/^0+/, '');
    };
    const target = digits(invoiceNumber || '');
    if (!supplierId || target.length < 3) return null;
    const rows = await (this.prisma as any).purchase.findMany({
      where: { supplierId, invoiceNumber: { not: null }, status: { not: 'CANCELLED' } },
      select: { id: true, invoiceNumber: true, status: true, createdAt: true, total: true },
      orderBy: { createdAt: 'desc' }, take: 500,
    });
    const hits = rows.filter((r: any) => digits(r.invoiceNumber) === target);
    if (!hits.length) return null;
    // Una nota de crédito tiene su propia numeración: la NC 3-12 no es la factura 3-12 (tanda 5)
    const types = await this.prisma.$queryRawUnsafe<{ id: string; doc_type: string | null }[]>(
      `SELECT id, doc_type FROM purchases WHERE id IN (${hits.map(() => '?').join(',')})`, ...hits.map((h: any) => h.id),
    ).catch(() => [] as { id: string; doc_type: string | null }[]);
    const isNc = (id: string) => types.find((t) => t.id === id)?.doc_type === 'nota de credito';
    const same = hits.find((r: any) => isNc(r.id) === !!credit);
    return same ? { id: same.id, status: same.status, createdAt: same.createdAt, total: same.total } : null;
  }

  /**
   * Remito primero, factura después (tanda 5.1): una factura que trae los mismos productos y cantidades
   * que un remito reciente del mismo proveedor (confirmado y todavía sin factura) es la factura de ese
   * remito. Confirmarla así completa costos y deuda SIN volver a sumar el stock (antes se duplicaba).
   * items: { productId, quantity } de la factura (en unidades). Devuelve el remito o null.
   */
  async findRemitoFor(supplierId: string | null | undefined, items: { productId?: string | null; quantity: number }[]) {
    const lines = items.filter((i) => i.productId && i.quantity > 0);
    if (!supplierId || lines.length < 1) return null;
    const since = new Date(Date.now() - 45 * 864e5);
    const ids = (await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM purchases WHERE supplier_id = ? AND status = 'COMPLETED' AND doc_type = 'remito'`, supplierId,
    ).catch(() => [] as { id: string }[])).map((r) => r.id);
    if (!ids.length) return null;
    const remitos: any[] = await this.prisma.purchase.findMany({ where: { id: { in: ids }, createdAt: { gte: since } }, include: { items: true }, orderBy: { createdAt: 'desc' }, take: 20 });
    let best: any = null, bestScore = 0;
    for (const p of remitos) {
      const rem = new Map<string, number>();
      for (const it of p.items) rem.set(it.productId, (rem.get(it.productId) || 0) + it.quantity);
      const fac = new Map<string, number>();
      for (const it of lines) fac.set(it.productId!, (fac.get(it.productId!) || 0) + it.quantity);
      const same = [...fac.entries()].filter(([id, q]) => Math.abs((rem.get(id) || 0) - q) < 0.01).length;
      // Los mismos productos con las mismas cantidades: casi todos (permite un renglón distinto)
      const score = same / Math.max(fac.size, rem.size);
      if (score > bestScore && score >= 0.8) { bestScore = score; best = { id: p.id, invoiceNumber: p.invoiceNumber, createdAt: p.createdAt, items: p.items.length, match: Math.round(score * 100) }; }
    }
    return best;
  }

  /**
   * Confirmar una factura como "la factura de este remito": pone costos y precios de venta (como una
   * compra), pero no suma stock (ya lo sumó el remito). El remito queda con el número, el total y la deuda
   * de la factura, y la factura pendiente se borra. Todos los renglones tienen que ser productos del remito.
   */
  async invoiceForRemito(pendingId: string, remitoId: string, data: { supplierId: string; invoiceNumber?: string; manualTotal?: number; paymentStatus: 'PAID' | 'OWED'; paymentMethod?: string; items?: { productId?: string; quantity: number; cost: number; salePrice?: number; buyFormat?: string }[] }) {
    const remito: any = await this.prisma.purchase.findUnique({ where: { id: remitoId }, include: { items: true } });
    if (!remito || remito.status !== 'COMPLETED') throw new BadRequestException('Ese remito ya no está.');
    const items = data.items || [];
    if (!items.length || items.some((i) => !i.productId || !remito.items.some((r: any) => r.productId === i.productId))) {
      throw new BadRequestException('Para cargarla como factura del remito, cada renglón tiene que ser un producto del remito. Si trae otros productos, confirmala como compra común.');
    }
    const priceRound = (await this.scanSettings()).round;
    const total = data.manualTotal !== undefined ? Number(data.manualTotal) : items.reduce((s, i) => s + i.quantity * i.cost, 0) * 1.21;
    await this.prisma.$transaction(async (tx) => {
      for (const it of items) {
        const product: any = await tx.product.findUnique({ where: { id: it.productId! } });
        if (!product) continue;
        const isPack = it.buyFormat === 'PACK' && product.presentationType === 'PACK';
        const unitCostWithIva = (isPack ? it.cost / (product.unitsPerPack || 1) : it.cost) * 1.21;
        if (!(unitCostWithIva > 0)) continue;
        const sale = keepMarginSale(product, unitCostWithIva, it.salePrice, priceRound);
        await tx.product.update({ where: { id: product.id }, data: { costPrice: unitCostWithIva, salePrice: sale, ...scaledPrices(product, sale, priceRound) } });
        await (tx as any).purchaseItem.updateMany({ where: { purchaseId: remitoId, productId: product.id }, data: { cost: it.cost * 1.21, total: it.quantity * it.cost * 1.21 } });
      }
      await tx.purchase.update({ where: { id: remitoId }, data: {
        total, invoiceNumber: data.invoiceNumber || remito.invoiceNumber, paymentStatus: data.paymentStatus, paymentMethod: data.paymentMethod,
        notes: `${remito.notes ? `${remito.notes} · ` : ''}Factura ${data.invoiceNumber || ''} aplicada al remito (costos y deuda; el stock ya estaba).`.slice(0, 1000),
      } });
      await tx.$executeRawUnsafe(`UPDATE purchases SET doc_type = 'factura' WHERE id = ?`, remitoId);
      await (tx as any).purchaseItem.deleteMany({ where: { purchaseId: pendingId } });
      await tx.purchase.delete({ where: { id: pendingId } });
    });
    return { id: remitoId, invoiceForRemito: true };
  }

  /**
   * Nota de crédito (tanda 5.2): resta deuda con el proveedor (queda como compra en negativo). Resta stock
   * solo si el dueño confirma que es devolución de mercadería, y nunca toca costos ni precios de venta.
   */
  async confirmCreditNote(pendingId: string, data: { supplierId: string; userId: string; invoiceNumber?: string; total: number; returnStock?: boolean; items?: { productId?: string; quantity: number }[] }) {
    const row = await this.prisma.purchase.findUnique({ where: { id: pendingId }, select: { status: true } });
    if (!row || row.status !== 'PENDING') throw new BadRequestException('Esta nota de crédito ya fue cargada.');
    const total = -Math.abs(Number(data.total) || 0);
    if (!total) throw new BadRequestException('Falta el total de la nota de crédito.');
    const lines = data.returnStock ? (data.items || []).filter((i) => i.productId && i.quantity > 0) : [];
    await this.prisma.$transaction(async (tx) => {
      await (tx as any).purchaseItem.deleteMany({ where: { purchaseId: pendingId } });
      for (const it of lines) {
        const p: any = await tx.product.findUnique({ where: { id: it.productId! }, select: { id: true, name: true } });
        if (!p) continue;
        const { stock: after } = await tx.product.update({ where: { id: p.id }, data: { stock: { decrement: it.quantity } }, select: { stock: true } });
        await tx.inventoryMovement.create({ data: { productId: p.id, userId: data.userId, type: 'EXIT', quantity: -it.quantity, stockBefore: after + it.quantity, stockAfter: after, reason: 'Devolución al proveedor (nota de crédito)', reference: `Compra #${pendingId}` } });
        await (tx as any).purchaseItem.create({ data: { purchaseId: pendingId, productId: p.id, productName: p.name, quantity: -it.quantity, cost: 0, total: 0, buyFormat: 'UNIT' } });
      }
      await tx.purchase.update({ where: { id: pendingId }, data: {
        supplierId: data.supplierId, userId: data.userId, invoiceNumber: data.invoiceNumber || null, total, status: 'COMPLETED', paymentStatus: 'OWED',
        notes: `Nota de crédito${lines.length ? ' (devolución de mercadería: se restó el stock)' : ''}: resta de lo que le debés al proveedor.`,
      } });
      await tx.$executeRawUnsafe(`UPDATE purchases SET doc_type = 'nota de credito', draft = NULL WHERE id = ?`, pendingId);
    });
    return { id: pendingId, total, returned: lines.length };
  }

  /**
   * Cómo viene el costo de cada producto de una compra frente a las anteriores: cuánto subió desde
   * la última compra y si otro proveedor lo vendió más barato (últimos 6 meses). Costos con IVA,
   * por unidad (las compras por bulto se pasan a unidades).
   */
  async costInsights(supplierId: string | null | undefined, items: { productId: string; cost: number }[]) {
    const ids = [...new Set((items || []).map((i) => String(i.productId)).filter(Boolean))].slice(0, 500);
    if (!ids.length) return {};
    const since = new Date(Date.now() - 180 * 864e5);
    const history = await (this.prisma as any).purchaseItem.findMany({
      where: { productId: { in: ids }, purchase: { status: 'COMPLETED', createdAt: { gte: since } } },
      select: { productId: true, cost: true, buyFormat: true, product: { select: { unitsPerPack: true } }, purchase: { select: { createdAt: true, supplierId: true, supplier: { select: { name: true } } } } },
      orderBy: { purchase: { createdAt: 'desc' } },
    });
    const out: Record<string, any> = {};
    for (const it of items) {
      const newCost = (Number(it.cost) || 0) * 1.21;
      const rows = history.filter((h: any) => h.productId === it.productId).map((h: any) => ({
        cost: h.buyFormat === 'PACK' && h.product?.unitsPerPack > 1 ? h.cost / h.product.unitsPerPack : h.cost,
        at: h.purchase.createdAt, supplierId: h.purchase.supplierId, supplierName: h.purchase.supplier?.name || '',
      })).filter((h: any) => h.cost > 0);
      if (!rows.length || !(newCost > 0)) continue;
      const last = rows[0];
      const cheapest = rows.filter((r: any) => r.supplierId !== supplierId).sort((a: any, b: any) => a.cost - b.cost)[0];
      out[it.productId] = {
        lastCost: Math.round(last.cost * 100) / 100,
        lastSupplier: last.supplierName,
        lastAt: last.at,
        changePct: Math.round((newCost / last.cost - 1) * 1000) / 10,
        cheaper: cheapest && cheapest.cost < newCost * 0.97
          ? { supplierName: cheapest.supplierName, cost: Math.round(cheapest.cost * 100) / 100, at: cheapest.at }
          : null,
      };
    }
    return out;
  }

  /** Cómo se cargan las boletas escaneadas (Compras → configuración) */
  async scanSettings() {
    const read = async (id: string) => {
      const row = await this.prisma.storeSetting.findUnique({ where: { id } }).catch(() => null);
      // Desde las pantallas llega como texto (a veces un JSON adentro de otro)
      let v: any = row?.value ?? null;
      for (let i = 0; i < 2 && typeof v === 'string'; i++) { try { v = JSON.parse(v); } catch { break; } }
      return v;
    };
    const auto = (await read('purchase_auto')) || {};
    const margin = Number(await read('purchase_default_margin'));
    return {
      // Arranca apagada: toda boleta queda para confirmar en la PC hasta que el dueño la prenda
      auto: auto.enabled === true,
      keepMargin: auto.keepMargin !== false,
      round: [0, 10, 100].includes(Number(auto.round)) ? Number(auto.round) : 10,
      margin: Number.isFinite(margin) && margin > 0 ? margin : 30,
    };
  }

  async notify(title: string, body: string) {
    await this.prisma.appNotification.create({ data: { type: 'purchaseAuto', title, body, url: '/purchases' } }).catch(() => {});
  }

  /**
   * Confirmar una boleta por revisar. Si era una lectura de la IA y el dueño corrigió algo, esas
   * correcciones se mandan a la nube para que aprenda cómo viene la boleta de ese proveedor
   * (firebase/functions/supplier-lessons.js): la próxima, de cualquier comercio, se lee mejor.
   */
  async confirmPending(id: string, data: Parameters<PurchasesService['confirmPendingInner']>[1]) {
    const row = await this.prisma.$queryRawUnsafe<{ draft: string | null; supplier_id: string }[]>(`SELECT draft, supplier_id FROM purchases WHERE id = ?`, id).catch(() => []);
    let draft: any = null;
    try { draft = row[0]?.draft ? JSON.parse(row[0].draft) : null; } catch { /* sin borrador */ }
    // La factura de un remito: costos y deuda, sin volver a sumar el stock (tanda 5.1)
    const fromRemitoId = (data as any).fromRemitoId;
    if (fromRemitoId && draft?.remitoMatch?.id === fromRemitoId) {
      const r = await this.invoiceForRemito(id, String(fromRemitoId), data as any);
      if (draft?.items?.length) this.learnFromCorrections(draft, data).catch(() => {});
      if (draft) this.confirmSamples(draft, data, {});
      return r;
    }
    const result: any = await this.confirmPendingInner(id, { ...data, docType: draft?.docType || null } as any);
    if (draft?.items?.length) this.learnFromCorrections(draft, data).catch(() => { /* aprender nunca frena la compra */ });
    const untouched = !!draft && !this.correctionsOf(draft, data.items || []).length && (data.items || []).length === (draft.items || []).length;
    if (draft) this.confirmSamples(draft, data, { untouched });
    // Racha de boletas de este proveedor confirmadas sin tocar nada: a las 5, se ofrece cargarlas solas
    const offerAuto = draft?.items?.length ? await this.scanStreak(data.supplierId, untouched).catch(() => null) : null;
    return offerAuto ? { ...result, offerAuto } : result;
  }

  /**
   * "Leyó mal" (tanda 2.3): el comercio avisa desde la revisión que la IA leyó mal esta boleta. La nube
   * marca sus muestras (se evalúan primero) y le avisa al dueño de Ventra en el admin. No cambia la compra.
   */
  async reportMisread(id: string, note?: string) {
    const draft = (await this.drafts([id])).get(id);
    if (!draft) throw new BadRequestException('Solo se puede avisar de una boleta escaneada que está por revisar.');
    if (draft.misreadAt) return { ok: true, already: true };
    await this.ai.call('invoice', {
      stage: 'misread', sampleIds: Array.isArray(draft.sampleIds) ? draft.sampleIds : [], note: String(note || '').slice(0, 500),
      info: { supplierName: draft.matchedSupplier?.name || draft.supplierName || '', supplierCuit: draft.supplierCuit || '', invoiceNumber: draft.invoiceNumber || '', items: (draft.items || []).length, why: draft.why || [] },
    }, { timeoutMs: 30_000 });
    await this.prisma.$executeRawUnsafe(`UPDATE purchases SET draft = ? WHERE id = ?`, JSON.stringify({ ...draft, misreadAt: Date.now() }), id);
    return { ok: true };
  }

  /**
   * Lo que quedó al confirmar es la respuesta correcta de las muestras de esa boleta (tanda 1.1 del
   * plan de boletas). En segundo plano: nunca frena ni rompe la compra; sin muestras no manda nada.
   */
  confirmSamples(draft: any, data: { supplierId?: string; invoiceNumber?: string; manualTotal?: number; items?: any[] }, flags: { auto?: boolean; untouched?: boolean } = {}) {
    const sampleIds: string[] = Array.isArray(draft?.sampleIds) ? draft.sampleIds.filter(Boolean) : [];
    if (!sampleIds.length) return;
    setImmediate(async () => {
      try {
        const items = data.items || [];
        const ids = [...new Set(items.map((it: any) => it.productId).filter(Boolean))] as string[];
        const prods = ids.length ? await this.prisma.product.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, barcode: true, unitsPerPack: true } }) : [];
        const byId = new Map(prods.map((p) => [p.id, p]));
        const sup = data.supplierId ? await this.prisma.$queryRawUnsafe<{ cuit: string | null; name: string }[]>(`SELECT cuit, name FROM suppliers WHERE id = ?`, data.supplierId).catch(() => []) : [];
        await this.ai.call('invoice', {
          stage: 'confirm', sampleIds,
          confirmed: {
            supplierCuit: String(draft.supplierCuit || sup[0]?.cuit || ''), supplierName: sup[0]?.name || draft.matchedSupplier?.name || draft.supplierName || '',
            invoiceNumber: data.invoiceNumber || draft.invoiceNumber || '', date: draft.date || '', total: Number(data.manualTotal) || 0, docType: draft.docType || '',
            auto: !!flags.auto, untouched: !!flags.untouched || !!flags.auto,
            items: items.map((it: any) => {
              const p: any = it.productId ? byId.get(it.productId) : null;
              return {
                name: it.source?.name || it.newProductData?.name || p?.name || '', code: it.source?.code || '',
                barcode: p?.barcode || it.newProductData?.barcode || it.setBarcode || '', quantity: Number(it.quantity) || 0,
                unitsPerPack: Number(p?.unitsPerPack || it.newProductData?.unitsPerPack) || 1, cost: Number(it.cost) || 0, buyFormat: it.buyFormat || 'UNIT',
                productId: it.productId || '', productName: p?.name || it.newProductData?.name || '', isNew: !it.productId,
              };
            }),
          },
        }, { timeoutMs: 30_000 });
      } catch { /* las muestras nunca frenan la compra */ }
    });
  }

  /** Lo que la IA leyó contra lo que el dueño confirmó: las diferencias que valen como lección */
  correctionsOf(draft: any, items: { quantity: number; cost: number; buyFormat?: string; source?: { name?: string } }[]) {
    const diffs: { renglon: string; leido: string; corregido: string }[] = [];
    const confirmed = new Map<string, { quantity: number; cost: number; buyFormat?: string }>();
    for (const it of items || []) if (it.source?.name) confirmed.set(String(it.source.name).trim().toUpperCase(), it);
    const money = (n: number) => `$ ${Math.round(n * 100) / 100}`;
    for (const d of draft.items || []) {
      const name = String(d.name || '').trim();
      if (!name) continue;
      const c = confirmed.get(name.toUpperCase());
      if (!c) { diffs.push({ renglon: name, leido: `${d.quantity} u. a ${money(d.cost)} c/u`, corregido: 'el dueño sacó este renglón (no era un producto o estaba de más)' }); continue; }
      if (c.buyFormat === 'PACK') continue; // en bultos no se puede comparar renglón por renglón
      const qtyChanged = Math.abs((Number(c.quantity) || 0) - (Number(d.quantity) || 0)) > 0.01;
      const dc = Number(d.cost) || 0, cc = Number(c.cost) || 0;
      const costChanged = dc > 0 && cc > 0 && Math.abs(cc / dc - 1) > 0.03;
      if (qtyChanged || costChanged) {
        diffs.push({
          renglon: name,
          leido: `${d.quantity} u. a ${money(dc)} c/u (sin IVA)`,
          corregido: `${c.quantity} u. a ${money(cc)} c/u (sin IVA)${costChanged ? `, el costo x${(cc / dc).toFixed(3)}` : ''}${qtyChanged ? `, la cantidad x${((Number(c.quantity) || 0) / (Number(d.quantity) || 1)).toFixed(2)}` : ''}`,
        });
      }
    }
    return diffs.slice(0, 25);
  }

  private async learnFromCorrections(draft: any, data: { supplierId: string; items?: any[] }) {
    const diffs = this.correctionsOf(draft, data.items || []);
    if (!diffs.length) return;
    let cuit = String(draft.supplierCuit || '').replace(/\D/g, '');
    if (!cuit) {
      const s = await this.prisma.$queryRawUnsafe<{ cuit: string | null }[]>(`SELECT cuit FROM suppliers WHERE id = ?`, data.supplierId).catch(() => []);
      cuit = String(s[0]?.cuit || '').replace(/\D/g, '');
    }
    if (!cuit) return;
    await this.ai.call('lesson', { supplierCuit: cuit, supplierName: draft.matchedSupplier?.name || draft.supplierName || '', diffs });
  }

  /** CUIT de los proveedores del comercio: la nube suma lo aprendido de ellos al leer una boleta */
  async supplierCuits(): Promise<string[]> {
    const rows = await this.prisma.$queryRawUnsafe<{ cuit: string }[]>(`SELECT cuit FROM suppliers WHERE cuit IS NOT NULL AND cuit <> '' LIMIT 60`).catch(() => []);
    return rows.map((r) => String(r.cuit).replace(/\D/g, '')).filter((c) => c.length === 11);
  }

  async confirmPendingInner(id: string, data: {
    supplierId: string;
    userId: string;
    invoiceNumber?: string;
    items?: { 
      productId: string; 
      quantity: number; 
      cost: number; 
      buyFormat?: string;
      salePrice?: number;
      expiresAt?: string; // Vencimiento del lote (productos con control de vencimiento)
      source?: { code?: string; name?: string };
      newProductData?: any;
    }[];
    paymentStatus: 'PAID' | 'OWED';
    paymentMethod?: string;
    notes?: string;
    manualTotal?: number;
  }) {
    // Escaneada con la versión nueva (renglones en draft, productos nuevos sin crear): se registra
    // como una compra normal, que crea los productos nuevos, y la pendiente se borra
    const draftRow = await this.prisma.$queryRawUnsafe<{ status: string; draft: string | null }[]>(`SELECT status, draft FROM purchases WHERE id = ?`, id);
    if (!draftRow.length) throw new NotFoundException('Compra no encontrada');
    if (draftRow[0].status !== 'PENDING') throw new BadRequestException('Esta compra ya fue confirmada: su stock ya está cargado');
    if (draftRow[0].draft || (data.items || []).some((it: any) => !it.productId)) {
      const purchase = await this.create(data as any);
      await (this.prisma as any).purchaseItem.deleteMany({ where: { purchaseId: id } });
      await (this.prisma as any).purchase.delete({ where: { id } });
      return purchase;
    }
    const total = data.manualTotal !== undefined 
      ? Number(data.manualTotal) 
      : (data.items || []).reduce((acc, item) => acc + (item.quantity * item.cost), 0) * 1.21;
    const priceRound = (await this.scanSettings()).round;
    const productsToSync: { barcode: string; newStock: number; salePrice: number; name: string; description: string; categoryName: string; minStock: number; imageUrl: string }[] = [];
    const undo = new Map<string, UndoRow>();

    const purchase = await this.prisma.$transaction(async (tx) => {
      const current = await (tx as any).purchase.findUnique({ where: { id }, select: { status: true } });
      if (!current) throw new NotFoundException('Compra no encontrada');
      if (current.status !== 'PENDING') throw new BadRequestException('Esta compra ya fue confirmada: su stock ya está cargado');
      // 1. Update Purchase status to COMPLETED and other fields
      const updatedPurchase = await (tx as any).purchase.update({
        where: { id },
        data: {
          supplierId: data.supplierId,
          userId: data.userId,
          invoiceNumber: data.invoiceNumber,
          total,
          status: 'COMPLETED',
          paymentStatus: data.paymentStatus,
          paymentMethod: data.paymentMethod,
          notes: data.notes,
        },
      });

      // 2. Delete existing items of this purchase
      await (tx as any).purchaseItem.deleteMany({
        where: { purchaseId: id }
      });

      // 3. Create Items and Update Stock
      if (data.items && data.items.length > 0) {
        for (const item of data.items) {
          const productId = item.productId;
          const product = await tx.product.findUnique({ 
            where: { id: productId }, 
            include: { category: true } 
          });
          if (!product) throw new NotFoundException(`Producto ${productId} no encontrado`);

          const isPack = item.buyFormat === 'PACK' && product.presentationType === 'PACK';
          const unitsPerPack = isPack ? (product.unitsPerPack || 1) : 1;
          const totalUnitsAdded = item.quantity * unitsPerPack;
          const unitCost = isPack ? (item.cost / unitsPerPack) : item.cost;
          const unitCostWithIva = unitCost * 1.21;

          await (tx as any).purchaseItem.create({
            data: {
              purchaseId: id,
              productId: productId,
              productName: product.name,
              quantity: item.quantity,
              cost: item.cost * 1.21,
              total: item.quantity * item.cost * 1.21,
              buyFormat: item.buyFormat || 'UNIT',
            },
          });

          if (!Number.isFinite(totalUnitsAdded)) throw new BadRequestException(`Cantidad inválida en ${product.name}`);
          const stockAfter = (await tx.product.update({ where: { id: productId }, data: { stock: { increment: totalUnitsAdded } }, select: { stock: true } })).stock;
          const stockBefore = stockAfter - totalUnitsAdded;

          // Update Product Stock, Cost Price and Sale Price (sin precio, como un remito en $ 0: solo stock)
          const noPrice = !(unitCostWithIva > 0);
          const updatedSalePrice = noPrice ? product.salePrice : keepMarginSale(product, unitCostWithIva, item.salePrice, priceRound);
          const updateData: any = noPrice ? { ...(product.supplierId ? {} : { supplierId: data.supplierId }), isActive: true } : {
            costPrice: unitCostWithIva,
            salePrice: updatedSalePrice,
            ...scaledPrices(product, updatedSalePrice, priceRound),
            ...(product.supplierId ? {} : { supplierId: data.supplierId }),
            isActive: true
          };
          noteUndo(undo, product, false, noPrice ? { costPrice: product.costPrice, salePrice: product.salePrice } : updateData);

          await tx.product.update({
            where: { id: productId },
            data: updateData,
          });

          // Create Inventory Movement
          await tx.inventoryMovement.create({
            data: {
              productId: productId,
              userId: data.userId,
              type: 'ENTRY',
              quantity: totalUnitsAdded,
              stockBefore,
              stockAfter,
              reason: isPack 
                ? `Compra a proveedor (${item.quantity} paq. x ${unitsPerPack} u.)` 
                : 'Compra a proveedor',
              reference: `Compra #${id}`,
            },
          });
          await createPurchaseLot(tx, product, item.expiresAt, totalUnitsAdded, id);

          productsToSync.push({
            barcode: product.barcode || product.id,
            newStock: stockAfter,
            salePrice: updatedSalePrice,
            name: product.name,
            description: product.description || '',
            categoryName: product.category?.name || 'Varios',
            minStock: product.minStock,
            imageUrl: product.imageUrl || '',
          });
        }
      }

      if (undo.size) await tx.$executeRawUnsafe(`UPDATE purchases SET undo_info = ? WHERE id = ?`, JSON.stringify({ v: 1, at: Date.now(), rows: [...undo.values()] }), id);
      return updatedPurchase;
    });

    // Sync all updated stocks to GoDelivery
    for (const p of productsToSync) {
      this.firebaseSync.syncProductToFirestore(
        p.barcode,
        p.newStock,
        p.salePrice,
        {
          name: p.name,
          description: p.description,
          categoryName: p.categoryName,
          minStock: p.minStock,
          imageUrl: p.imageUrl,
        }
      ).catch(err => {
        console.error(`Error syncing product ${p.barcode} to Firestore after purchase confirmation:`, err.message);
      });
    }

    this.photosFor(id);
    return purchase;
  }

  /**
   * Saca del stock lo que esta compra sumó. Se usa lo que quedó anotado en los movimientos de
   * inventario de la compra (exacto aunque después cambien las unidades por paquete); para
   * compras viejas sin movimientos, se calcula por ítem. Una compra pendiente no sumó nada.
   */
  private async revertPurchaseStock(tx: any, purchase: any) {
    if (purchase.status && purchase.status !== 'COMPLETED') return;
    const moves: { productId: string; quantity: number }[] = await tx.inventoryMovement.findMany({
      where: { reference: `Compra #${purchase.id}`, type: 'ENTRY' },
      select: { productId: true, quantity: true },
    });
    const units = new Map<string, number>();
    if (moves.length) {
      for (const m of moves) units.set(m.productId, (units.get(m.productId) || 0) + m.quantity);
    } else {
      for (const item of purchase.items) {
        if (!item.product) continue;
        const isPack = item.buyFormat === 'PACK' && item.product.presentationType === 'PACK';
        const total = item.quantity * (isPack ? (item.product.unitsPerPack || 1) : 1);
        units.set(item.productId, (units.get(item.productId) || 0) + total);
      }
    }
    for (const [productId, qty] of units) {
      if (!qty) continue;
      const exists = await tx.product.findUnique({ where: { id: productId }, select: { id: true } });
      if (!exists) continue;
      const { stock: after } = await tx.product.update({ where: { id: productId }, data: { stock: { decrement: qty } }, select: { stock: true } });
      if (purchase.userId) {
        await tx.inventoryMovement.create({
          data: { productId, userId: purchase.userId, type: 'EXIT', quantity: -qty, stockBefore: after + qty, stockAfter: after, reason: 'Compra eliminada', reference: `Compra eliminada #${purchase.id}` },
        });
      }
    }
  }

  /**
   * Deshacer una boleta confirmada (tanda 1.6): saca el stock que sumó (y sus lotes), vuelve costo y
   * precios de venta a como estaban, y oculta los productos que creó si nunca se vendieron. Lo que
   * alguien cambió a mano después (otro precio) no se pisa: se avisa. La compra queda anulada (no se
   * borra) y deja de contar como deuda. Las compras confirmadas antes de esto no tienen con qué volver
   * los precios: para esas está Eliminar (solo saca el stock).
   */
  async undoPurchase(id: string) {
    const purchase: any = await this.prisma.purchase.findUnique({ where: { id }, include: { items: { include: { product: { select: PRODUCT_WITHOUT_IMAGE } } } } });
    if (!purchase) throw new NotFoundException('Compra no encontrada');
    if (purchase.status !== 'COMPLETED') throw new BadRequestException('Solo se puede deshacer una compra confirmada.');
    const raw = await this.prisma.$queryRawUnsafe<{ undo_info: string | null }[]>(`SELECT undo_info FROM purchases WHERE id = ?`, id).catch(() => []);
    let info: { rows: UndoRow[] } | null = null;
    try { info = raw[0]?.undo_info ? JSON.parse(raw[0].undo_info) : null; } catch { info = null; }
    if (!info?.rows?.length) throw new BadRequestException('Esta compra se confirmó antes de que existiera "Deshacer boleta" y no guardó los precios de antes. Podés eliminarla (saca el stock) y corregir los precios a mano.');
    const near = (a: number, b: number) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;
    const report = { restored: 0, hidden: 0, keptChanged: [] as string[], keptNew: [] as string[] };
    const touched: string[] = [];
    await this.prisma.$transaction(async (tx) => {
      const again = await tx.purchase.findUnique({ where: { id }, select: { status: true } });
      if (again?.status !== 'COMPLETED') throw new BadRequestException('Esta compra ya se deshizo.');
      await tx.productLot.updateMany({ where: { purchaseId: id, status: 'ACTIVE' }, data: { status: 'REMOVED' } });
      await this.revertPurchaseStock(tx, purchase);
      for (const row of info!.rows) {
        const p: any = await tx.product.findUnique({ where: { id: row.id }, select: { id: true, name: true, stock: true, costPrice: true, salePrice: true, barcode: true } });
        if (!p) continue;
        touched.push(p.id);
        const data: any = {};
        if (row.barcodeSet && p.barcode === row.barcodeSet) data.barcode = null;
        if (row.created) {
          // Producto que trajo esta boleta: se oculta si nunca se vendió (si se vendió, queda: tiene historia)
          const sold = await tx.saleItem.count({ where: { productId: p.id } });
          if (!sold && !(p.stock > 0)) { data.isActive = false; report.hidden++; } else report.keptNew.push(p.name);
        } else if (near(p.costPrice, row.after.costPrice) && near(p.salePrice, row.after.salePrice)) {
          Object.assign(data, {
            costPrice: row.before.costPrice, salePrice: row.before.salePrice,
            packPrice: row.before.packPrice, wholesalePrice: row.before.wholesalePrice, tradePrice: row.before.tradePrice,
            isActive: row.before.isActive, supplierId: row.before.supplierId,
          });
          report.restored++;
        } else report.keptChanged.push(p.name);
        if (Object.keys(data).length) await tx.product.update({ where: { id: p.id }, data });
      }
      const stamp = new Date().toLocaleDateString('es-AR');
      await tx.purchase.update({ where: { id }, data: { status: 'CANCELLED', notes: `${purchase.notes ? `${purchase.notes} · ` : ''}Boleta deshecha el ${stamp}: se sacó el stock y volvieron los precios de antes.`.slice(0, 1000) } });
      await tx.$executeRawUnsafe(`UPDATE purchases SET undo_info = NULL WHERE id = ?`, id);
    });
    // La tienda y GoDelivery ven el stock y los precios de vuelta
    const after = touched.length ? await this.prisma.product.findMany({ where: { id: { in: touched } }, select: { id: true, barcode: true, stock: true, salePrice: true, name: true } }) : [];
    for (const p of after) this.firebaseSync?.syncProductToFirestore(p.barcode || p.id, p.stock, p.salePrice, { name: p.name }).catch(() => {});
    return { success: true, ...report };
  }

  /** ¿Se puede deshacer? (para mostrar el botón): solo las confirmadas que guardaron cómo estaba todo */
  private async undoable(ids: string[]): Promise<Set<string>> {
    if (!ids.length) return new Set();
    const rows = await this.prisma.$queryRawUnsafe<{ id: string }[]>(
      `SELECT id FROM purchases WHERE undo_info IS NOT NULL AND status = 'COMPLETED' AND id IN (${ids.map(() => '?').join(',')})`, ...ids,
    ).catch((): any[] => []);
    return new Set(rows.map((r) => r.id));
  }

  async deleteOne(id: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: { items: { include: { product: { select: PRODUCT_WITHOUT_IMAGE } } } },
    });
    if (!purchase) throw new NotFoundException('Compra no encontrada');

    await this.prisma.$transaction(async (tx) => {
      // Los lotes que trajo esta compra dejan de existir
      await tx.productLot.updateMany({ where: { purchaseId: id, status: 'ACTIVE' }, data: { status: 'REMOVED' } });
      await this.revertPurchaseStock(tx, purchase);

      // Delete the purchase items first, then the purchase
      await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
      await tx.purchase.delete({ where: { id } });
    });

    return { success: true };
  }

  async deleteAll() {
    const purchases = await this.prisma.purchase.findMany({
      include: { items: { include: { product: { select: PRODUCT_WITHOUT_IMAGE } } } },
    });

    await this.prisma.$transaction(async (tx) => {
      await tx.productLot.updateMany({ where: { purchaseId: { not: null }, status: 'ACTIVE' }, data: { status: 'REMOVED' } });
      for (const p of purchases) await this.revertPurchaseStock(tx, p);

      await tx.purchaseItem.deleteMany({});
      await tx.purchase.deleteMany({});
    });

    return { success: true };
  }

  async restorePurchase(id: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!purchase) throw new NotFoundException('Compra no encontrada');

    const restoredProducts = [];

    await this.prisma.$transaction(async (tx) => {
      for (const item of purchase.items) {
        let product = await tx.product.findUnique({ where: { id: item.productId } });

        if (product) {
          // Reactivate and update cost price and stock
          const isPack = item.buyFormat === 'PACK' && product.presentationType === 'PACK';
          const unitsPerPack = isPack ? (product.unitsPerPack || 1) : 1;
          const totalUnits = item.quantity * unitsPerPack;

          // Activo: la compra ya está en su stock, no se vuelve a sumar. Dado de baja: vuelve con
          // lo que trajo la compra (una compra pendiente nunca sumó, así que tampoco).
          const newStock = product.isActive || purchase.status !== 'COMPLETED' ? product.stock : totalUnits;

          product = await tx.product.update({
            where: { id: product.id },
            data: {
              isActive: true,
              costPrice: item.cost,
              // If it had a very low sale price or default, we ensure it has a markup
              salePrice: product.salePrice > item.cost ? product.salePrice : (item.cost * 1.3),
              stock: newStock,
            },
          });
        } else {
          // Re-create the product
          const costVal = item.cost;
          const saleVal = costVal * 1.3;

          product = await tx.product.create({
            data: {
              id: item.productId,
              name: item.productName.toUpperCase(),
              costPrice: costVal,
              salePrice: saleVal,
              stock: item.quantity,
              isActive: true,
              presentationType: item.buyFormat || 'UNIT',
              unitsPerPack: 1,
            },
          });
        }
        restoredProducts.push(product);
      }
    });

    // Sync restored products with firestore in background
    for (const p of restoredProducts) {
      const syncBarcode = p.barcode || p.id;
      this.firebaseSync.syncProductToFirestore(
        syncBarcode,
        p.stock,
        p.salePrice,
        { name: p.name }
      ).catch(err => console.error('Error syncing restored product to Firestore:', err));
    }

    return { success: true, restoredCount: restoredProducts.length };
  }

  /**
   * Pedido sugerido para cada proveedor: lo que se vende (últimos 30 días) para cubrir 2 semanas,
   * y además lo que está en el stock mínimo o por debajo. Por bulto si el producto se compra así.
   * El proveedor es el del producto o, si no tiene, el de su última compra.
   */
  async getSuggestedReplenishment() {
    const DAYS_SOLD = 30;
    const COVER_DAYS = 14;
    const products = await this.prisma.product.findMany({
      where: { isActive: true, unlimitedStock: false, id: { notIn: ['VENTA_RAPIDA', 'SERVICIO', 'PAGO_CTA_CTE'] } },
      include: {
        supplier: { select: { id: true, name: true, phone: true, email: true, contact: true } },
        category: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
    const since = new Date(Date.now() - DAYS_SOLD * 864e5);
    const sold = await this.prisma.saleItem.groupBy({
      by: ['productId'],
      where: { sale: { status: 'COMPLETED', createdAt: { gte: since } } },
      _sum: { quantity: true },
    });
    const soldBy = new Map(sold.map((s) => [s.productId, Number(s._sum.quantity) || 0]));
    // Proveedor de la última compra, para los productos que no tienen uno asignado
    const lastBuys = await (this.prisma as any).purchaseItem.findMany({
      where: { purchase: { status: 'COMPLETED' } },
      select: { productId: true, purchase: { select: { createdAt: true, supplier: { select: { id: true, name: true, phone: true, email: true, contact: true } } } } },
      orderBy: { purchase: { createdAt: 'desc' } },
      take: 5000,
    });
    const lastSupplier = new Map<string, any>();
    for (const b of lastBuys) if (!lastSupplier.has(b.productId) && b.purchase?.supplier) lastSupplier.set(b.productId, b.purchase.supplier);

    const items: any[] = [];
    for (const p of products as any[]) {
      const daily = (soldBy.get(p.id) || 0) / DAYS_SOLD;
      const lowByMin = p.minStock > 0 && p.stock <= p.minStock;
      const lowBySales = daily > 0 && p.stock < daily * 7;
      if (!lowByMin && !lowBySales) continue;
      let qty = Math.max(lowByMin ? Math.ceil(p.minStock * 2 - p.stock) : 0, lowBySales ? Math.ceil(daily * COVER_DAYS - p.stock) : 0, 1);
      const upp = Number(p.unitsPerPack) || 1;
      const packs = upp > 1 ? Math.ceil(qty / upp) : null;
      if (packs) qty = packs * upp;
      const supplier = p.supplier || lastSupplier.get(p.id) || { id: 'UNASSIGNED', name: 'Sin Proveedor Asignado', phone: null, email: null };
      items.push({
        productId: p.id,
        barcode: p.barcode,
        sku: p.sku,
        name: p.name,
        stock: p.stock,
        minStock: p.minStock,
        costPrice: p.costPrice,
        unit: p.unit,
        presentationType: p.presentationType,
        unitsPerPack: p.unitsPerPack,
        suggestedQty: qty,
        suggestedPacks: packs,
        soldPerDay: Math.round(daily * 10) / 10,
        daysLeft: daily > 0 ? Math.floor(p.stock / daily) : null,
        estimatedTotal: qty * (p.costPrice || 0),
        supplier,
        category: p.category?.name || 'General',
      });
    }
    items.sort((a, b) => String(a.supplier.name).localeCompare(String(b.supplier.name), 'es') || (a.daysLeft ?? 999) - (b.daysLeft ?? 999));
    return items;
  }
}
