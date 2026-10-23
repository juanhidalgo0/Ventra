import { AiService } from '../ai/ai.service';
import { ProductMatcherService } from '../ai/product-matcher.service';
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { FirebaseSyncService } from '../products/firebase-sync.service';
import axios from 'axios';
import { Jimp } from 'jimp';
import * as XLSX from 'xlsx';
import { PRODUCT_WITHOUT_IMAGE } from '../../database/product-select';
import { createPurchaseLot } from '../products/lots.util';
import { InvoiceReadError, isPdfFile, isSheetFile, readInvoiceFile, type ParsedInvoice } from './invoice-reader';

/** Nombre de un producto nuevo tal como vino en la boleta, prolijo */
const niceName = (s: string) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, 120);

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
  ) {}

  async pending() {
    const rows = await (this.prisma as any).purchase.findMany({
      where: { status: 'PENDING' },
      select: { id: true, total: true, invoiceNumber: true, createdAt: true, supplier: { select: { name: true } }, user: { select: { fullName: true } }, _count: { select: { items: true } } },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    const drafts = await this.drafts(rows.map((p: any) => p.id));
    return rows.map((p: any) => ({ id: p.id, total: p.total, invoiceNumber: p.invoiceNumber, createdAt: p.createdAt, supplierName: p.supplier?.name || '', userName: p.user?.fullName || '', items: drafts.get(p.id)?.items?.length ?? p._count?.items ?? 0 }));
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
    return rows.map((p: any) => (drafts.has(p.id) ? { ...p, draft: drafts.get(p.id) } : p));
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
  }) {
    const total = data.manualTotal !== undefined 
      ? Number(data.manualTotal) 
      : (data.items || []).reduce((acc, item) => acc + (item.quantity * item.cost), 0) * 1.21;
    const productsToSync: { barcode: string; newStock: number; salePrice: number; name: string; description: string; categoryName: string; minStock: number; imageUrl: string }[] = [];

    const learned: { code?: string; name?: string; productId: string }[] = [];
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
          const sku = item.newProductData.sku || null;
          
          let existingProduct = null;
          if (barcode) {
            existingProduct = await tx.product.findUnique({ where: { barcode } });
          }
          if (!existingProduct && sku) {
            existingProduct = await tx.product.findUnique({ where: { sku } });
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
          }
        }

        if (item.source && productId) learned.push({ ...item.source, productId });

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
        const updatedSalePrice = item.salePrice || product.salePrice;
        const updateData: any = {
          costPrice: unitCostWithIva, // Store unit cost with IVA
          salePrice: updatedSalePrice,
          isActive: true // Reactivate if soft-deleted
        };

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
      const images = await this.ai.shrink(files, 2000);
      const { result } = await this.ai.call('invoice', { images, manualTotal: manualTotal ?? null });
      parsedData = result;
      if (!parsedData?.items?.length) {
        throw new BadRequestException('No encontramos productos en la foto. Probá con una foto más nítida, de frente y con buena luz.');
      }
      console.log(`[PurchasesService] Factura leída con IA: ${parsedData.items.length} productos.`);
    }

    // Proveedor: el que ya está cargado (parecido) o, en una boleta del celular, uno nuevo
    const supplier = await this.findSupplier(parsedData.supplierName);
    const settings = await this.scanSettings();

    // Control de la boleta: con IVA (factura A) la suma de renglones x 1,21 da el total; con el IVA
    // adentro (factura B/C, ticket), la suma da el total. Así se sabe también si los precios lo traen.
    const rawItems: any[] = parsedData.items || [];
    const lineTotals = rawItems.map((it) => parseArgentineNumber(it.total));
    const sum = lineTotals.reduce((a, b) => a + b, 0);
    const printed = parseArgentineNumber(parsedData.totalFacturaAPagar);
    const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(50, b * 0.02);
    let totalsOk: boolean | null = readCheck ? !!readCheck.ok : null;
    let netFactor = 1;
    if (!readCheck && printed > 0 && sum > 0) {
      if (near(sum * 1.21, printed)) totalsOk = true;
      else if (near(sum, printed)) { totalsOk = true; netFactor = 1 / 1.21; }
      else totalsOk = false;
    }

    const rows = rawItems.map((it) => {
      let barcode = it.barcode ? String(it.barcode).trim() : '';
      const sku = it.sku ? String(it.sku).trim() : '';
      if (barcode === sku) barcode = /^\d{8,14}$/.test(barcode) ? barcode : '';
      return { barcode, sku, code: sku, name: String(it.name || '').trim() };
    });
    const { matches } = await this.matcher.match(rows.map((r) => ({ code: r.sku, barcode: r.barcode, name: r.name })), { supplierId: supplier?.id, useAi: true });

    const roundUp = (n: number) => (settings.round ? Math.ceil(n / settings.round - 1e-9) * settings.round : Math.round(n * 100) / 100);
    const items = rawItems.map((it, i) => {
      const r = rows[i];
      const m = matches[i];
      const unitsPerPackVal = Number(it.unitsPerPack) || 1;
      const quantityVal = (Number(it.packageQuantity) || 1) * unitsPerPackVal;
      const netTotal = lineTotals[i] * netFactor;
      const netCost = quantityVal > 0 ? netTotal / quantityVal : 0;
      const costWithIva = netCost * 1.21;
      const p: any = m?.product || null;
      const changePct = p && p.costPrice > 0 ? Math.round((costWithIva / p.costPrice - 1) * 1000) / 10 : null;
      // Precio de venta sugerido: mantiene el margen del producto, o el margen de siempre si es nuevo
      const suggestedSalePrice = p
        ? (p.costPrice > 0 && settings.keepMargin ? roundUp(p.salePrice * (costWithIva / p.costPrice)) : p.salePrice)
        : roundUp(costWithIva * (1 + settings.margin / 100));
      const reasons: string[] = [];
      if (!(quantityVal > 0) || !(netCost > 0)) reasons.push('no se leyó la cantidad o el precio');
      if (m?.confidence === 'baja') reasons.push('no es seguro que sea ese producto');
      if (changePct !== null && (changePct > 60 || changePct < -40)) reasons.push(`el costo cambia ${changePct > 0 ? '+' : ''}${changePct}%`);
      else if (m?.confidence === 'media' && changePct !== null && Math.abs(changePct) > 25) reasons.push(`el costo cambia ${changePct > 0 ? '+' : ''}${changePct}% y el producto no es seguro`);
      return {
        barcode: r.barcode,
        sku: r.sku,
        name: r.name,
        quantity: quantityVal,
        unitsPerPack: unitsPerPackVal,
        presentationType: 'UNIT',
        cost: parseFloat(netCost.toFixed(2)),
        total: parseFloat(netTotal.toFixed(2)),
        match: m ? { by: m.by, confidence: m.confidence } : null,
        changePct,
        suggestedSalePrice,
        doubtful: reasons.length > 0,
        reasons,
        product: p ? {
          id: p.id, barcode: p.barcode, sku: p.sku, name: p.name, costPrice: p.costPrice, salePrice: p.salePrice,
          unit: p.unit, presentationType: p.presentationType, unitsPerPack: p.unitsPerPack, trackExpiry: p.trackExpiry,
        } : null,
      };
    });

    const base = {
      supplierName: parsedData.supplierName || '',
      matchedSupplier: supplier ? { id: supplier.id, name: supplier.name } : null,
      invoiceNumber: parsedData.invoiceNumber || '',
      date: parsedData.date || new Date().toISOString().split('T')[0],
      items,
      check: readCheck || (totalsOk === null ? null : {
        ok: totalsOk,
        message: totalsOk ? 'Los renglones suman el total de la boleta.' : `Los renglones suman $ ${Math.round(sum * 1.21).toLocaleString('es-AR')} con IVA y la boleta dice $ ${Math.round(printed).toLocaleString('es-AR')}: revisá cantidades y precios.`,
        details: [],
      }),
      invoice: readInfo,
      pricesIncludeIva: netFactor !== 1,
    };

    // En la PC la boleta se revisa en la misma pantalla: no se guarda nada todavía
    if (opts.inline) return { ...base, status: 'INLINE', purchaseId: null };

    // Del celular: si la boleta cierra y no hay nada dudoso, se carga sola (stock, costos, precios
    // y productos nuevos). Si no, queda para revisar en la PC, sin crear nada.
    const doubts = items.filter((it) => it.doubtful);
    const why: string[] = [];
    if (!settings.auto) why.push('la carga automática está apagada');
    if (totalsOk !== true) why.push(totalsOk === false ? 'los renglones no suman el total de la boleta' : 'no se pudo leer el total de la boleta');
    if (doubts.length) why.push(`${doubts.length} ${doubts.length === 1 ? 'renglón dudoso' : 'renglones dudosos'}`);
    if (!items.length) why.push('no hay productos');

    const supplierId = supplier?.id || (await this.findSupplier(parsedData.supplierName || 'Proveedor sin nombre', true))!.id;
    const resolvedUser = userId || (await this.prisma.user.findFirst({ where: { role: 'ADMIN' } }))?.id || (await this.prisma.user.findFirst())!.id;
    const printedTotal = printed > 0 ? printed : sum * 1.21 * netFactor;

    if (!why.length) {
      const purchase = await this.create({
        supplierId,
        userId: resolvedUser,
        invoiceNumber: parsedData.invoiceNumber || undefined,
        manualTotal: printedTotal,
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
            barcode: /^\d{8,14}$/.test(it.barcode) ? it.barcode : undefined,
            salePrice: it.suggestedSalePrice,
            taxRate: 21,
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
      await this.notify('Boleta cargada sola',
        `${supplier?.name || parsedData.supplierName || 'Proveedor'}: ${items.length} productos, ${updatedPrices} precios actualizados${newIds.size ? `, ${newIds.size} productos nuevos para revisar` : ''}.`);
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
    return { ...base, status: 'PENDING', purchaseId: pending.id, auto: false, why };
  }

  /** El proveedor de la boleta entre los cargados (nombre parecido); create: si no está, se agrega */
  private async findSupplier(name?: string, create = false) {
    const clean = String(name || '').trim();
    if (!clean) return null;
    const key = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\b(s\.?a\.?|s\.?r\.?l\.?|s\.?a\.?s\.?|sociedad anonima|de|la|el)\b/g, ' ').replace(/[^a-z0-9]/g, '');
    const target = key(clean);
    const all = await this.prisma.supplier.findMany({ select: { id: true, name: true } });
    const found = target ? all.find((s) => key(s.name) === target) || all.find((s) => { const k = key(s.name); return k.length >= 4 && (k.includes(target) || target.includes(k)); }) : null;
    if (found || !create) return found || null;
    return this.prisma.supplier.create({ data: { name: clean.slice(0, 120) } });
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
      auto: auto.enabled !== false,
      keepMargin: auto.keepMargin !== false,
      round: [0, 10, 100].includes(Number(auto.round)) ? Number(auto.round) : 10,
      margin: Number.isFinite(margin) && margin > 0 ? margin : 30,
    };
  }

  private async notify(title: string, body: string) {
    await this.prisma.appNotification.create({ data: { type: 'purchaseAuto', title, body, url: '/purchases' } }).catch(() => {});
  }

  async confirmPending(id: string, data: {
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
    const productsToSync: { barcode: string; newStock: number; salePrice: number; name: string; description: string; categoryName: string; minStock: number; imageUrl: string }[] = [];

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

          // Update Product Stock, Cost Price and Sale Price
          const updatedSalePrice = item.salePrice || product.salePrice;
          const updateData: any = {
            costPrice: unitCostWithIva,
            salePrice: updatedSalePrice,
            isActive: true
          };

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

  async getSuggestedReplenishment() {
    const lowStockProducts = await this.prisma.product.findMany({
      where: {
        isActive: true,
        unlimitedStock: false,
        minStock: { gt: 0 }
      },
      include: {
        supplier: {
          select: { id: true, name: true, phone: true, email: true, contact: true }
        },
        category: {
          select: { id: true, name: true }
        }
      },
      orderBy: [
        { supplierId: 'asc' },
        { name: 'asc' }
      ]
    });

    const filtered = lowStockProducts.filter((p: any) => p.stock <= p.minStock);

    const items = filtered.map((p: any) => {
      const targetStock = p.minStock * 2;
      const deficit = Math.max(1, Math.ceil(targetStock - p.stock));
      return {
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
        suggestedQty: deficit,
        estimatedTotal: deficit * (p.costPrice || 0),
        supplier: p.supplier || { id: 'UNASSIGNED', name: 'Sin Proveedor Asignado', phone: null, email: null },
        category: p.category?.name || 'General'
      };
    });

    return items;
  }
}
