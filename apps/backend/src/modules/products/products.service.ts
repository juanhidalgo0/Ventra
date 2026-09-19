import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../websockets/events.gateway';
import { FirebaseSyncService } from './firebase-sync.service';
import { SyncImageService } from './sync-image.service';
import { DBFFile, DELETED } from 'dbffile';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';

function getSearchVariants(token: string): string[] {
  const t = token.trim();
  if (!t) return [];

  const set = new Set<string>();
  set.add(t.toLowerCase());
  set.add(t.toUpperCase());
  set.add(t.charAt(0).toUpperCase() + t.slice(1).toLowerCase());

  // Handle accents and tildes
  const removeAccents = (str: string) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const unaccented = removeAccents(t);
  set.add(unaccented.toLowerCase());
  set.add(unaccented.toUpperCase());

  // If token has ñ or Ñ, also search with n and N
  if (/[ñÑ]/.test(t)) {
    const withN = t.replace(/ñ/g, 'n').replace(/Ñ/g, 'N');
    set.add(withN.toLowerCase());
    set.add(withN.toUpperCase());
  }

  // If token has n or N, also generate variants where n is replaced by ñ (for words up to 20 chars)
  if (/[nN]/.test(t) && t.length <= 20) {
    for (let i = 0; i < t.length; i++) {
      if (t[i].toLowerCase() === 'n') {
        const replacedLower = (t.slice(0, i) + 'ñ' + t.slice(i + 1)).toLowerCase();
        set.add(replacedLower);
        set.add(replacedLower.toUpperCase());
      }
    }
  }

  // Handle Spanish accented vowels: á, é, í, ó, ú
  const vowels = [
    { plain: 'a', accented: 'á' },
    { plain: 'e', accented: 'é' },
    { plain: 'i', accented: 'í' },
    { plain: 'o', accented: 'ó' },
    { plain: 'u', accented: 'ú' }
  ];

  for (const v of vowels) {
    if (t.toLowerCase().includes(v.plain) && t.length <= 20) {
      for (let i = 0; i < t.length; i++) {
        if (t[i].toLowerCase() === v.plain) {
          const replacedLower = (t.slice(0, i) + v.accented + t.slice(i + 1)).toLowerCase();
          set.add(replacedLower);
          set.add(replacedLower.toUpperCase());
        }
      }
    }
  }

  // Hardware Store Measurement Equivalences (Pulgadas vs Milímetros vs Nombres)
  const measureEquivalences: Array<string[]> = [
    ['1/2', '1/2"', 'media', '20mm', '20 mm'],
    ['3/4', '3/4"', 'tres cuartos', '25mm', '25 mm'],
    ['1', '1"', 'una pulgada', '32mm', '32 mm'],
    ['3/8', '3/8"', 'tres octavos', '10mm', '10 mm'],
    ['5/8', '5/8"', 'cinco octavos', '16mm', '16 mm'],
    ['1/4', '1/4"', 'un cuarto', '6mm', '6.35mm', '6 mm'],
    ['5/16', '5/16"', 'cinco dieciseis', '8mm', '8 mm'],
    ['1 1/4', '1-1/4', '1 1/4"', '40mm', '40 mm'],
    ['1 1/2', '1-1/2', '1 1/2"', '50mm', '50 mm'],
    ['2', '2"', 'dos pulgadas', '63mm', '63 mm']
  ];

  const tClean = t.toLowerCase().replace(/["']/g, '').trim();
  for (const group of measureEquivalences) {
    if (group.some(m => m.toLowerCase().replace(/["']/g, '') === tClean)) {
      for (const eq of group) {
        set.add(eq);
        set.add(eq.toUpperCase());
      }
    }
  }

  return Array.from(set);
}

@Injectable()
export class ProductsService {
  private isSyncing = false;

  constructor(
    private prisma: PrismaService,
    private eventsGateway: EventsGateway,
    private firebaseSync: FirebaseSyncService,
    private syncImageService: SyncImageService,
  ) {}

  private buildSearchWhere(params?: { search?: string; categoryId?: string; isActive?: boolean; isFavorite?: boolean; hasImage?: boolean; noBarcode?: boolean }): any {
    // Hide the internal "Venta Rápida" product from inventory lists.
    const where: any = { id: { not: 'VENTA_RAPIDA' } };
    if (params?.isActive !== undefined) {
      where.isActive = params.isActive;
    } else {
      where.isActive = true;
    }

    if (params?.search) {
      const rawTokens = params.search.trim().split(/\s+/).filter(Boolean);
      if (rawTokens.length > 0) {
        where.AND = rawTokens.map((token) => {
          const variants = getSearchVariants(token);
          return {
            OR: [
              ...variants.map((v) => ({ name: { contains: v } })),
              ...variants.map((v) => ({ barcode: { contains: v } })),
              ...variants.map((v) => ({ sku: { contains: v } })),
              ...variants.map((v) => ({ additionalBarcodes: { some: { barcode: { contains: v } } } })),
            ]
          };
        });
      }
    }

    if (params?.categoryId) where.categoryId = params.categoryId;
    if (params?.isFavorite) where.isFavorite = true;

    if (params?.hasImage !== undefined) {
      if (params.hasImage) {
        where.NOT = [
          { imageUrl: null },
          { imageUrl: '' },
          { imageUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=400&q=80' }
        ];
      } else {
        where.OR = [
          { imageUrl: null },
          { imageUrl: '' },
          { imageUrl: 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=400&q=80' }
        ];
      }
    }

    if (params?.noBarcode) {
      where.AND = [...(where.AND || []), { OR: [{ barcode: null }, { barcode: '' }] }];
    }

    return where;
  }

  async verifyGoogleEmailOwnsTerminalCommerce(email: string): Promise<boolean> {
    return this.firebaseSync.verifyGoogleEmailOwnsTerminalCommerce(email);
  }

  /**
   * Enlaces de foto para el catálogo del POS sin mandar las fotos en sí.
   * Las URLs externas se devuelven tal cual; las guardadas en la base (data:...)
   * se reemplazan por /api/product-images/:id, que las sirve de a una.
   */
  private async getCatalogImageUrls(ids: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (ids.length === 0) return map;
    const rows: { id: string; inline: number; url: string | null; updatedAt: any }[] = await this.prisma.$queryRawUnsafe(`
      SELECT id,
             CASE WHEN substr(image_url, 1, 5) = 'data:' THEN 1 ELSE 0 END AS inline,
             CASE WHEN substr(image_url, 1, 5) = 'data:' THEN NULL ELSE image_url END AS url,
             updated_at AS updatedAt
      FROM products
      WHERE image_url IS NOT NULL AND image_url <> ''
    `);
    const wanted = new Set(ids);
    for (const r of rows) {
      if (!wanted.has(r.id)) continue;
      if (Number(r.inline) === 1) {
        const v = new Date(r.updatedAt).getTime() || 0;
        map.set(r.id, `/api/product-images/${encodeURIComponent(r.id)}?v=${v}`);
      } else if (r.url) {
        map.set(r.id, r.url);
      }
    }
    return map;
  }

  /** Foto de un producto guardada en la base, lista para servir como archivo. */
  async getProductImage(id: string): Promise<{ mime: string; data: Buffer } | { redirect: string } | null> {
    const product = await this.prisma.product.findUnique({ where: { id }, select: { imageUrl: true } });
    const url = product?.imageUrl;
    if (!url) return null;
    const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
    if (!m) return { redirect: url };
    const mime = m[1] || 'image/jpeg';
    const data = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
    return { mime, data };
  }

  async getPOSCatalog(updatedAfter?: string) {
    // "Venta Rápida" is opened with code "1" / F1, never shown as a catalog card.
    const where: any = { isActive: true, id: { not: 'VENTA_RAPIDA' } };
    if (updatedAfter) {
      const date = new Date(updatedAfter);
      if (!isNaN(date.getTime())) {
        where.updatedAt = { gt: date };
      }
    }

    const products = await this.prisma.product.findMany({
      where,
      select: {
        id: true,
        barcode: true,
        sku: true,
        name: true,
        salePrice: true,
        stock: true,
        categoryId: true,
        category: { select: { id: true, name: true, color: true } },
        // imageUrl NO: las fotos guardadas en la base (base64) pesan ~65 MB en total.
        // Se resuelven abajo como enlaces livianos que el navegador pide cuando las muestra.
        allowCustomPrice: true,
        unit: true,
        unitsPerPack: true,
        pieceSize: true,
        updatedAt: true,
        additionalBarcodes: {
          select: {
            barcode: true
          }
        },
      },
      orderBy: { updatedAt: 'desc' }
    });

    const imageById = await this.getCatalogImageUrls(products.map((p: any) => p.id));

    // Unidades vendidas en los últimos 60 días: es lo que ordena el catálogo del POS
    const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    let soldByProduct = new Map<string, number>();
    try {
      const rows: { productId: string; sold: number }[] = await this.prisma.$queryRaw`
        SELECT si.product_id AS productId, SUM(si.quantity) AS sold
        FROM sale_items si
        JOIN sales s ON s.id = si.sale_id
        WHERE s.created_at >= ${since} AND s.status = 'COMPLETED'
        GROUP BY si.product_id
      `;
      soldByProduct = new Map(rows.map(r => [r.productId, Number(r.sold) || 0]));
    } catch (err: any) {
      console.warn('[ProductsService] No se pudo calcular lo más vendido:', err.message);
    }

    const mappedProducts = products.map((p: any) => ({
      id: p.id,
      barcode: p.barcode,
      sku: p.sku,
      name: p.name,
      salePrice: p.salePrice,
      stock: p.stock,
      categoryId: p.categoryId,
      category: p.category,
      imageUrl: imageById.get(p.id) ?? null,
      allowCustomPrice: p.allowCustomPrice,
      unit: p.unit,
      unitsPerPack: p.unitsPerPack,
      pieceSize: p.pieceSize,
      additionalBarcodes: p.additionalBarcodes,
      salesCount: soldByProduct.get(p.id) ?? 0
    }));

    // Más vendidos primero; entre los que nunca se vendieron, por nombre
    mappedProducts.sort((a: any, b: any) =>
      (b.salesCount ?? 0) - (a.salesCount ?? 0) || (a.name || '').localeCompare(b.name || '', 'es'),
    );

    return {
      serverTime: new Date().toISOString(),
      products: mappedProducts
    };
  }

  async findAll(params?: { search?: string; categoryId?: string; isActive?: boolean; isFavorite?: boolean; lowStock?: boolean; hasImage?: boolean; noBarcode?: boolean; skip?: number; take?: number }) {
    try {
      const where = this.buildSearchWhere(params);

      const selectOrInclude = {
        include: {
          category: { select: { id: true, name: true, color: true, icon: true, parentCategory: { select: { id: true, name: true } } } }, 
          brand: { select: { id: true, name: true } }, 
          supplier: { select: { id: true, name: true } },
          additionalBarcodes: true,
        }
      };

      if (params?.lowStock) {
        const products = await this.prisma.product.findMany({
          where,
          ...selectOrInclude,
          orderBy: [
            { name: 'asc' }
          ],
        });
        return products.filter((p) => p.stock <= p.minStock);
      }

      const rawTokens = params?.search ? params.search.trim().split(/\s+/).filter(Boolean) : [];

      if (rawTokens.length > 0) {
        // Fetch candidates ordered by name ASC to guarantee determinism
        const candidateLimit = Math.max(500, (params?.skip || 0) + (params?.take || 50) * 10);
        let results = await this.prisma.product.findMany({
          where,
          ...selectOrInclude,
          orderBy: [
            { name: 'asc' }
          ],
          take: candidateLimit,
        });

        // Exact code match (barcode, SKU or alternate code) always comes first,
        // even if it falls outside the name-ordered candidate window above.
        const exactCode = params.search!.trim();
        const exactUpper = exactCode.toUpperCase();
        const codeVariants = Array.from(new Set([exactCode, exactUpper, exactCode.toLowerCase()]));
        const sameCode = (v?: string | null) => !!v && v.toUpperCase() === exactUpper;
        const isExactCode = (p: any) =>
          sameCode(p.barcode) || sameCode(p.sku) ||
          (p.additionalBarcodes || []).some((ab: any) => sameCode(ab.barcode));
        if (rawTokens.length === 1) {
          const { AND: _searchTokens, ...baseWhere } = where;
          const exactMatches = await this.prisma.product.findMany({
            where: {
              ...baseWhere,
              AND: [{ OR: [{ barcode: { in: codeVariants } }, { sku: { in: codeVariants } }, { additionalBarcodes: { some: { barcode: { in: codeVariants } } } }] }],
            },
            ...selectOrInclude,
          });
          if (exactMatches.length) {
            const ids = new Set(exactMatches.map((p) => p.id));
            results = [...exactMatches, ...results.filter((p) => !ids.has(p.id))];
          }
        }

        const normalizeStr = (str: string) => (str || '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
        const fullQueryNorm = normalizeStr(params.search || '');
        const tokensNorm = rawTokens.map(t => normalizeStr(t));

        results.sort((a: any, b: any) => {
          // 0. Exact code match
          const aCode = isExactCode(a);
          const bCode = isExactCode(b);
          if (aCode && !bCode) return -1;
          if (!aCode && bCode) return 1;

          const aName = normalizeStr(a.name);
          const bName = normalizeStr(b.name);
          
          // 1. Exact match of full query
          const aExact = aName === fullQueryNorm;
          const bExact = bName === fullQueryNorm;
          if (aExact && !bExact) return -1;
          if (!aExact && bExact) return 1;

          // 2. Starts with exact full query
          const aStarts = aName.startsWith(fullQueryNorm);
          const bStarts = bName.startsWith(fullQueryNorm);
          if (aStarts && !bStarts) return -1;
          if (!aStarts && bStarts) return 1;

          // 3. Match words in sequential order from the start
          const aWords = aName.split(' ');
          const bWords = bName.split(' ');

          const aStartsSequence = tokensNorm.every((token, i) => aWords[i] && aWords[i].startsWith(token));
          const bStartsSequence = tokensNorm.every((token, i) => bWords[i] && bWords[i].startsWith(token));
          if (aStartsSequence && !bStartsSequence) return -1;
          if (!aStartsSequence && bStartsSequence) return 1;

          // 4. All query tokens match word-starts anywhere in the product name
          const aAllTokensStartWords = tokensNorm.every((token) => aWords.some((w) => w.startsWith(token)));
          const bAllTokensStartWords = tokensNorm.every((token) => bWords.some((w) => w.startsWith(token)));
          if (aAllTokensStartWords && !bAllTokensStartWords) return -1;
          if (!aAllTokensStartWords && bAllTokensStartWords) return 1;

          // 5. Always sort alphabetically A-Z
          return (a.name || '').localeCompare(b.name || '', 'es', { sensitivity: 'base' });
        });

        const skip = params?.skip || 0;
        const take = params?.take || 50;
        return results.slice(skip, skip + take);
      }

      const results = await this.prisma.product.findMany({
        where,
        ...selectOrInclude,
        orderBy: [
          { name: 'asc' }
        ],
        skip: params?.skip || 0,
        take: params?.take || 50,
      });

      return results;
    } catch (error) {
      console.error('Error in ProductsService.findAll:', error);
      throw new InternalServerErrorException('Error al obtener productos: ' + error.message);
    }
  }

  async count(params?: { search?: string; categoryId?: string; hasImage?: boolean; noBarcode?: boolean }) {
    try {
      const where = this.buildSearchWhere(params);
      return await this.prisma.product.count({ where });
    } catch (err) {
      console.error('Error in count:', err);
      throw err;
    }
  }

  async findById(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        brand: true,
        supplier: true,
        additionalBarcodes: true,
        kitItems: { include: { childProduct: { select: { id: true, name: true, salePrice: true, stock: true, barcode: true } } } }
      }
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  /**
   * Internal barcodes are EAN-13 with the GS1 "restricted circulation" prefix 20, reserved
   * for in-store use, so they can never clash with a manufacturer's code:
   *   20 + 10-digit sequence + check digit
   */
  private static readonly INTERNAL_BARCODE_PREFIX = '20';

  static ean13CheckDigit(first12: string): string {
    const sum = first12
      .split('')
      .reduce((acc, d, i) => acc + Number(d) * (i % 2 === 0 ? 1 : 3), 0);
    return String((10 - (sum % 10)) % 10);
  }

  private async getUsedInternalBarcodes(): Promise<Set<string>> {
    const prefix = ProductsService.INTERNAL_BARCODE_PREFIX;
    const [main, extra] = await Promise.all([
      this.prisma.product.findMany({ where: { barcode: { startsWith: prefix } }, select: { barcode: true } }),
      this.prisma.productBarcode.findMany({ where: { barcode: { startsWith: prefix } }, select: { barcode: true } }),
    ]);
    return new Set([...main.map((p) => p.barcode!), ...extra.map((b) => b.barcode)]);
  }

  /** Returns `count` free internal EAN-13 codes, continuing after the highest one in use. */
  private async allocateInternalBarcodes(count: number): Promise<string[]> {
    const prefix = ProductsService.INTERNAL_BARCODE_PREFIX;
    const used = await this.getUsedInternalBarcodes();
    let seq = 0;
    for (const code of used) {
      if (code.length === 13 && /^\d+$/.test(code)) {
        seq = Math.max(seq, Number(code.slice(prefix.length, 12)));
      }
    }
    const codes: string[] = [];
    while (codes.length < count) {
      seq++;
      const body = prefix + String(seq).padStart(12 - prefix.length, '0');
      const code = body + ProductsService.ean13CheckDigit(body);
      if (!used.has(code)) codes.push(code);
    }
    return codes;
  }

  async getNextInternalBarcode() {
    const [barcode] = await this.allocateInternalBarcodes(1);
    return { barcode };
  }

  /** Assigns internal barcodes to the given products (or every active product) that have none. */
  async assignInternalBarcodes(ids?: string[]) {
    const where: any = { OR: [{ barcode: null }, { barcode: '' }] };
    if (ids && ids.length > 0) where.id = { in: ids };
    else where.isActive = true;

    const products = await this.prisma.product.findMany({ where, select: { id: true }, orderBy: { name: 'asc' } });
    if (products.length === 0) return { assigned: 0, products: [] };

    const codes = await this.allocateInternalBarcodes(products.length);
    await this.prisma.$transaction(
      products.map((p, i) => this.prisma.product.update({ where: { id: p.id }, data: { barcode: codes[i] } })),
    );

    const updated = await this.prisma.product.findMany({
      where: { id: { in: products.map((p) => p.id) } },
      select: { id: true, barcode: true },
    });

    // Avisar a las otras terminales para que su lista quede al día
    for (const p of updated) this.eventsGateway.emitProductUpdated(p);

    return { assigned: updated.length, products: updated };
  }

  async findByBarcode(barcode: string) {
    // Los códigos se guardan en mayúsculas, pero puede haber datos viejos en
    // minúsculas: se acepta cualquiera de las variantes.
    const raw = (barcode || '').trim();
    const variants = Array.from(new Set([raw, raw.toUpperCase(), raw.toLowerCase()]));
    const product = await this.prisma.product.findFirst({
      where: {
        OR: [
          { barcode: { in: variants } },
          { sku: { in: variants } },
          { additionalBarcodes: { some: { barcode: { in: variants } } } }
        ],
        isActive: true
      },
      include: { 
        category: { select: { id: true, name: true, color: true } },
        additionalBarcodes: true
      },
    });
    if (!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  async create(createProductDto: any) {
    const { additionalBarcodes, kitItems, ...data } = createProductDto;
    
    // Clean up data to only include valid schema fields
    const validFields = [
      'name', 'barcode', 'sku', 'description', 'imageUrl', 
      'costPrice', 'salePrice', 'stock', 'minStock', 'unit', 
      'presentationType', 'unitsPerPack',
      'taxRate', 'isActive', 'isFavorite', 'allowCustomPrice', 'unlimitedStock', 'categoryId', 'brandId', 'supplierId',
      'wholesalePrice', 'wholesaleMinQty', 'tradePrice', 'isKit', 'equivalents', 'location', 'pieceSize', 'showOnline',
      'listPrice', 'discount1', 'discount2', 'discount3'
    ];
    
    const productData: any = {};
    for (const key of validFields) {
      if (data[key] !== undefined) {
        if (['categoryId', 'brandId', 'supplierId', 'barcode', 'sku'].includes(key) && data[key] === '') {
          productData[key] = null;
        } else if (['name', 'barcode', 'sku'].includes(key) && typeof data[key] === 'string') {
          // Nombres y códigos siempre en mayúsculas
          productData[key] = key === 'name' ? data[key].toUpperCase() : data[key].trim().toUpperCase();
        } else {
          productData[key] = data[key];
        }
      }
    }

    if (productData.imageUrl && (productData.imageUrl.startsWith('http://') || productData.imageUrl.startsWith('https://'))) {
      productData.imageUrl = await this.firebaseSync.compressRemoteImageToBase64(productData.imageUrl);
    }

    // Clear any inactive products with the same barcode/sku to avoid unique constraint violations
    if (productData.barcode) {
      const existingInactive = await this.prisma.product.findFirst({
        where: { barcode: productData.barcode, isActive: false }
      });
      if (existingInactive) {
        await this.prisma.product.update({
          where: { id: existingInactive.id },
          data: { barcode: null }
        });
      }
      const existingAdditional = await this.prisma.productBarcode.findFirst({
        where: { barcode: productData.barcode, product: { isActive: false } }
      });
      if (existingAdditional) {
        await this.prisma.productBarcode.delete({ where: { id: existingAdditional.id } });
      }
    }
    if (productData.sku) {
      const existingInactiveSku = await this.prisma.product.findFirst({
        where: { sku: productData.sku, isActive: false }
      });
      if (existingInactiveSku) {
        await this.prisma.product.update({
          where: { id: existingInactiveSku.id },
          data: { sku: null }
        });
      }
    }

    let product: any;
    try {
      product = await this.prisma.product.create({
        data: {
          ...productData,
          additionalBarcodes: additionalBarcodes && additionalBarcodes.length > 0 ? {
            create: additionalBarcodes.map((b: string) => ({ barcode: String(b).trim().toUpperCase() }))
          } : undefined,
          kitItems: productData.isKit && kitItems && Array.isArray(kitItems) && kitItems.length > 0 ? {
            create: kitItems.map((k: any) => ({ childProductId: k.childProductId, quantity: Number(k.quantity) || 1 }))
          } : undefined
        },
        include: { 
          category: { select: { id: true, name: true, color: true, parentCategory: { select: { id: true, name: true } } } }, 
          brand: { select: { id: true, name: true } },
          additionalBarcodes: true,
          kitItems: { include: { childProduct: { select: { id: true, name: true, salePrice: true, stock: true, barcode: true } } } }
        }
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const field = err?.meta?.target?.[0] || 'campo';
        throw new BadRequestException(`Ya existe un producto con ese ${field === 'barcode' ? 'código de barras' : field}`);
      }
      throw err;
    }

    const syncBarcode = product.barcode || product.id;
    this.firebaseSync.syncProductToFirestore(
      syncBarcode, 
      product.stock, 
      product.salePrice,
      {
        name: product.name,
        description: product.description || '',
        categoryName: product.category?.name || 'Varios',
        minStock: product.minStock,
        imageUrl: product.imageUrl || ''
      }
    ).catch(err => {
      console.error('Error syncing new product to Firestore:', err);
    });

    if (product.barcode && (!product.imageUrl || product.imageUrl === 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=400&q=80')) {
      this.syncImageService.assignImageToSingleProduct(product.id, product.barcode).catch(err => {
        console.error('Error auto-assigning image to new product:', err);
      });
    }

    return product;
  }

  async update(id: string, data: any, userId?: string) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Producto no encontrado');
    const { additionalBarcodes, kitItems } = data;

    const validFields = [
      'name', 'barcode', 'sku', 'description', 'imageUrl', 
      'costPrice', 'salePrice', 'stock', 'minStock', 'unit', 
      'presentationType', 'unitsPerPack',
      'taxRate', 'isActive', 'isFavorite', 'allowCustomPrice', 'unlimitedStock', 'categoryId', 'brandId', 'supplierId',
      'wholesalePrice', 'wholesaleMinQty', 'tradePrice', 'isKit', 'equivalents', 'location', 'pieceSize', 'showOnline',
      'listPrice', 'discount1', 'discount2', 'discount3'
    ];
    
    const updateData: any = {};
    for (const key of validFields) {
      if (data[key] !== undefined) {
        // Handle empty strings for optional relations
        if (['categoryId', 'brandId', 'supplierId', 'barcode', 'sku'].includes(key) && data[key] === '') {
          updateData[key] = null;
        } else if (['name', 'barcode', 'sku'].includes(key) && typeof data[key] === 'string') {
          // Nombres y códigos siempre en mayúsculas
          updateData[key] = key === 'name' ? data[key].toUpperCase() : data[key].trim().toUpperCase();
        } else {
          updateData[key] = data[key];
        }
      }
    }

    if (updateData.imageUrl && (updateData.imageUrl.startsWith('http://') || updateData.imageUrl.startsWith('https://'))) {
      updateData.imageUrl = await this.firebaseSync.compressRemoteImageToBase64(updateData.imageUrl);
    }

    if (data.salePrice && data.salePrice !== existing.salePrice && userId) {
      await this.prisma.priceHistory.create({ data: { productId: id, userId, oldPrice: existing.salePrice, newPrice: data.salePrice } });
    }

    const updatedProduct = await this.prisma.$transaction(async (tx) => {
      if (additionalBarcodes && Array.isArray(additionalBarcodes)) {
        // Delete old additional barcodes and create new ones
        await tx.productBarcode.deleteMany({ where: { productId: id } });
        if (additionalBarcodes.length > 0) {
          for (const b of additionalBarcodes) {
            await tx.productBarcode.create({
              data: {
                barcode: String(b).trim().toUpperCase(),
                productId: id
              }
            });
          }
        }
      }

      if (data.isKit !== undefined) {
        await tx.productKitItem.deleteMany({ where: { parentProductId: id } });
        if (data.isKit && kitItems && Array.isArray(kitItems) && kitItems.length > 0) {
          for (const k of kitItems) {
            await tx.productKitItem.create({
              data: {
                parentProductId: id,
                childProductId: k.childProductId,
                quantity: Number(k.quantity) || 1
              }
            });
          }
        }
      }

      return tx.product.update({ 
        where: { id }, 
        data: updateData, 
        include: { 
          category: { select: { id: true, name: true, color: true, parentCategory: { select: { id: true, name: true } } } }, 
          brand: { select: { id: true, name: true } },
          additionalBarcodes: true,
          kitItems: { include: { childProduct: { select: { id: true, name: true, salePrice: true, stock: true, barcode: true } } } }
        } 
      });
    });

    const syncBarcode = updatedProduct.barcode || updatedProduct.id;
    this.firebaseSync.syncProductToFirestore(
      syncBarcode, 
      updatedProduct.stock, 
      updatedProduct.salePrice,
      {
        name: updatedProduct.name,
        description: updatedProduct.description || '',
        categoryName: updatedProduct.category?.name || 'Varios',
        minStock: updatedProduct.minStock,
        imageUrl: updatedProduct.imageUrl || ''
      }
    ).catch(err => {
      console.error('Error syncing updated product to Firestore:', err);
    });

    if (updatedProduct.barcode && (!updatedProduct.imageUrl || updatedProduct.imageUrl === 'https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=400&q=80')) {
      this.syncImageService.assignImageToSingleProduct(updatedProduct.id, updatedProduct.barcode).catch(err => {
        console.error('Error auto-assigning image to updated product:', err);
      });
    }

    return updatedProduct;
  }

  async delete(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    // Clear barcodes and delete additional barcodes to release unique constraints
    const updated = await this.prisma.product.update({ 
      where: { id }, 
      data: { 
        isActive: false,
        barcode: null,
        sku: null
      } 
    });
    await this.prisma.productBarcode.deleteMany({ where: { productId: id } });

    const syncBarcode = updated.barcode || updated.id;
    this.firebaseSync.syncProductDeletion(syncBarcode).catch(err => {
      console.error('Error syncing deleted product to Firestore:', err);
    });

    return updated;
  }

  async toggleFavorite(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    return this.prisma.product.update({ where: { id }, data: { isFavorite: !product.isFavorite } });
  }

  async addMovement(productId: string, data: { type: 'ENTRY' | 'EXIT' | 'ADJUSTMENT'; quantity: number; reason: string; note?: string; userId: string }) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) throw new NotFoundException('Producto no encontrado');

    const stockBefore = product.stock;
    const movementQuantity = data.type === 'EXIT' ? -Math.abs(data.quantity) : Math.abs(data.quantity);
    const stockAfter = stockBefore + movementQuantity;

    const movement = await this.prisma.$transaction(async (tx) => {
      // 1. Create movement record
      const m = await tx.inventoryMovement.create({
        data: {
          productId,
          userId: data.userId,
          type: data.type,
          quantity: movementQuantity,
          stockBefore,
          stockAfter,
          reason: data.reason,
          reference: data.note,
        },
      });

      // 2. Update product stock
      await tx.product.update({
        where: { id: productId },
        data: { stock: stockAfter },
      });

      return m;
    });

    const syncBarcode = product.barcode || product.id;
    this.firebaseSync.syncProductToFirestore(syncBarcode, stockAfter, product.salePrice).catch(err => {
      console.error('Error syncing adjusted product to Firestore:', err);
    });

    return movement;
  }

  async getMovements(params: { productId?: string; limit?: number }) {
    return this.prisma.inventoryMovement.findMany({
      where: params.productId ? { productId: params.productId } : {},
      include: { product: { select: { name: true, barcode: true } }, user: { select: { fullName: true } } },
      orderBy: { createdAt: 'desc' },
      take: params.limit || 50,
    });
  }

  async importFromLocalDbf() {
    const dbfPath = path.join(process.cwd(), '..', '..', 'ARTICULO.DBF');
    try {
      const dbf = await DBFFile.open(dbfPath, { readMode: 'loose' });
      console.log(`Importing ${dbf.recordCount} products from DBF...`);

      let importedCount = 0;
      let updatedCount = 0;

      // Helper for case-insensitive lookup
      const getDbfFieldValue = (rec: any, name: string) => {
        if (!rec) return undefined;
        const target = name.toUpperCase();
        if (rec[target] !== undefined) return rec[target];
        if (rec[name] !== undefined) return rec[name];
        for (const key of Object.keys(rec)) {
          if (key.toUpperCase() === target) return rec[key];
        }
        return undefined;
      };

      // Read records in batches of 500
      const batchSize = 500;
      for (let i = 0; i < dbf.recordCount; i += batchSize) {
        const records = await dbf.readRecords(batchSize);
        
        await this.prisma.$transaction(async (tx) => {
          for (const record of records as any[]) {
            const rawSku = getDbfFieldValue(record, 'NUM_ART');
            const sku = typeof rawSku === 'string' ? rawSku.trim() : String(rawSku || '').trim();
            if (!sku) continue;

            const rawName = getDbfFieldValue(record, 'DESC');
            const name = (typeof rawName === 'string' ? rawName.trim() : String(rawName || '').trim()).toUpperCase() || 'SIN NOMBRE';
            const stock = parseFloat(getDbfFieldValue(record, 'EXISTENCIA')) || 0;
            const paquete = parseFloat(getDbfFieldValue(record, 'PAQUETE')) || 1;
            const costo = parseFloat(getDbfFieldValue(record, 'COSTO')) || 0;
            const costPrice = costo / (paquete || 1);
            const salePrice = parseFloat(getDbfFieldValue(record, 'PRECIOA')) || 0;

            const existing = await tx.product.findUnique({
              where: { sku },
            });

            if (existing) {
              await tx.product.update({
                where: { id: existing.id },
                data: {
                  barcode: sku,
                  stock,
                  costPrice,
                  salePrice,
                  isActive: true,
                  updatedAt: new Date(),
                },
              });
              updatedCount++;
            } else {
              await tx.product.create({
                data: {
                  sku,
                  barcode: sku,
                  name,
                  stock,
                  costPrice,
                  salePrice,
                },
              });
              importedCount++;
            }
          }
        }, {
          timeout: 30000, // Increase timeout for large batches
        });
        
        console.log(`Processed ${Math.min(i + batchSize, dbf.recordCount)} / ${dbf.recordCount}`);
      }

      return {
        success: true,
        total: dbf.recordCount,
        imported: importedCount,
        updated: updatedCount,
      };
    } catch (error) {
      console.error('Error importing DBF:', error);
      throw new InternalServerErrorException('Error al importar el archivo DBF: ' + error.message);
    }
  }

  async importFile(file: Express.Multer.File) {
    const extension = path.extname(file.originalname).toLowerCase();
    let records: any[] = [];

    // Helper for case-insensitive lookup
    const getDbfFieldValue = (rec: any, name: string) => {
      if (!rec) return undefined;
      const target = name.toUpperCase();
      if (rec[target] !== undefined) return rec[target];
      if (rec[name] !== undefined) return rec[name];
      for (const key of Object.keys(rec)) {
        if (key.toUpperCase() === target) return rec[key];
      }
      return undefined;
    };

    try {
      console.log(`--- Starting import of ${file.originalname} ---`);
      if (extension === '.dbf') {
        const dbf = await DBFFile.open(file.path, { readMode: 'loose' });
        console.log(`DBF opened, record count: ${dbf.recordCount}`);

        let imported = 0;
        let updated = 0;
        let lastProcessedItemName = '';
        const total = dbf.recordCount;
        const batchSize = 250;

        for (let i = 0; i < total; i += batchSize) {
          const rawRecords = await dbf.readRecords(batchSize);

          for (const r of rawRecords) {
            // Skip soft-deleted records in the dBase DBF file
            if (r[DELETED] === true || r['@deleted'] === true) continue;

            const rawSku = getDbfFieldValue(r, 'NUM_ART');
            const barcode = typeof rawSku === 'string' ? rawSku.trim() : String(rawSku || '').trim();
            if (!barcode) continue;

            const rawName = getDbfFieldValue(r, 'DESC');
            const name = (typeof rawName === 'string' ? rawName.trim() : String(rawName || '').trim()).toUpperCase() || 'SIN NOMBRE';
            lastProcessedItemName = name;
            const stock = parseFloat(getDbfFieldValue(r, 'EXISTENCIA')) || 0;
            const paquete = parseFloat(getDbfFieldValue(r, 'PAQUETE')) || 1;
            const costo = parseFloat(getDbfFieldValue(r, 'COSTO')) || 0;
            const costPrice = costo / (paquete || 1);
            const salePrice = parseFloat(getDbfFieldValue(r, 'PRECIOA')) || 0;

            let finalBarcode = null;
            const lower = barcode.toLowerCase();
            if (barcode !== '' && lower !== 'sin código' && lower !== 'sin codigo' && lower !== 'null' && lower !== 'undefined') {
              finalBarcode = barcode;
            }

            try {
              let existing = await this.prisma.product.findUnique({ where: { sku: barcode } });
              if (existing) {
                await this.prisma.product.update({
                  where: { id: existing.id },
                  data: {
                    barcode: finalBarcode || existing.barcode,
                    stock: isNaN(stock) ? 0 : stock,
                    costPrice: isNaN(costPrice) ? 0 : costPrice,
                    salePrice: isNaN(salePrice) ? 0 : salePrice,
                    isActive: true,
                    updatedAt: new Date(),
                  }
                });
                updated++;
              } else {
                await this.prisma.product.create({
                  data: {
                    sku: barcode,
                    barcode: finalBarcode,
                    name,
                    stock: isNaN(stock) ? 0 : stock,
                    costPrice: isNaN(costPrice) ? 0 : costPrice,
                    salePrice: isNaN(salePrice) ? 0 : salePrice,
                    description: '',
                    imageUrl: '',
                  }
                });
                imported++;
              }
            } catch (err: any) {
              console.error(`Error processing product SKU ${barcode} in batch:`, err.message);
            }
          }

          const currentProgress = Math.min(i + batchSize, total);
          const percentage = Math.floor((currentProgress / total) * 100);
          console.log(`Processed DBF: ${currentProgress}/${total}. Progress: ${percentage}%`);

          this.eventsGateway.emitImportProgress({
            progress: percentage,
            total,
            current: currentProgress,
            status: `Importando: ${lastProcessedItemName || 'procesando lote...'}`,
            details: { imported, updated, lastItem: lastProcessedItemName }
          });

          // Yield to event loop
          await new Promise(resolve => setTimeout(resolve, 5));
        }

        console.log(`DBF Import completed. Total: ${total}, Imported: ${imported}, Updated: ${updated}`);
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
        return { success: true, total, imported, updated };
      } else if (extension === '.json') {
        console.log(`Parsing JSON file...`);
        const content = fs.readFileSync(file.path, 'utf-8');
        const data = JSON.parse(content);
        console.log(`Parsed ${data.length} records from JSON.`);
        records = data.map((r: any) => {
          const barcode = String(r.barcode || r.codigo_barra || '').trim();
          return {
            sku: String(r.sku || r.codigo || barcode || '').trim(),
            barcode: barcode,
            name: String(r.name || r.nombre || r.descripcion || '').trim().toUpperCase(),
            stock: parseFloat(r.stock || '0'),
            costPrice: parseFloat(r.costPrice || r.costo || '0'),
            salePrice: parseFloat(r.salePrice || r.precio || r.price || '0'),
            description: String(r.description || '').trim(),
            imageUrl: String(r.imageUrl || r.image || '').trim(),
            categoryName: String(r.category || r.categoria || '').trim()
          };
        });
      } else if (extension === '.csv') {
        console.log(`Parsing CSV file...`);
        const content = fs.readFileSync(file.path, 'utf-8');
        const parsed = parse(content, {
          columns: true,
          skip_empty_lines: true,
          trim: true
        });
        console.log(`Parsed ${parsed.length} records from CSV.`);
        records = parsed.map((r: any) => {
          const barcode = String(r.barcode || r.codigo_barra || r.NUM_ART || '').trim();
          return {
            sku: String(r.sku || r.codigo || barcode || '').trim(),
            barcode: barcode,
            name: String(r.name || r.nombre || r.descripcion || r.DESC || '').trim().toUpperCase(),
            stock: parseFloat(r.stock || r.existencia || r.EXISTENCIA || '0'),
            costPrice: parseFloat(r.costPrice || r.costo || r.COSTO || '0'),
            salePrice: parseFloat(r.salePrice || r.precio || r.PRECIOA || '0'),
            description: String(r.description || r.descripcion || '').trim(),
            imageUrl: String(r.imageUrl || r.image || r.imagen || '').trim(),
            categoryName: String(r.category || r.categoria || '').trim()
          };
        });
      } else if (extension === '.xlsx' || extension === '.xls') {
        console.log(`Parsing Excel file...`);
        const workbook = XLSX.readFile(file.path);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const data = XLSX.utils.sheet_to_json(sheet);
        console.log(`Parsed ${data.length} records from Excel.`);
        records = data.map((r: any) => {
          const barcode = String(r.barcode || r.codigo_barra || r.NUM_ART || '').trim();
          return {
            sku: String(r.sku || r.codigo || barcode || '').trim(),
            barcode: barcode,
            name: String(r.name || r.nombre || r.descripcion || r.DESC || '').trim().toUpperCase(),
            stock: parseFloat(r.stock || r.existencia || r.EXISTENCIA || '0'),
            costPrice: parseFloat(r.costPrice || r.costo || r.COSTO || '0'),
            salePrice: parseFloat(r.salePrice || r.precio || r.PRECIOA || '0'),
            description: String(r.description || r.descripcion || '').trim(),
            imageUrl: String(r.imageUrl || r.image || r.imagen || '').trim(),
            categoryName: String(r.category || r.categoria || '').trim()
          };
        });
      } else {
        throw new Error(`Formato de archivo no soportado: ${extension}`);
      }

      // Filtrar registros sin SKU válido para evitar que la importación aborte
      records = records.filter((r) => r.sku && r.sku.trim() !== '');

      const total = records.length;
      console.log(`Beginning processing of ${total} records in batches of 100...`);
      let imported = 0;
      let updated = 0;

      // Process in batches and report progress
      const batchSize = 100;
      console.log(`Beginning dynamic processing of ${total} records...`);

      for (let i = 0; i < total; i++) {
        const record = records[i];
        if (!record.sku) continue;
        const lastItemName = record.name || '';

        try {
          // Normalize barcode to null if it's empty, invalid, or placeholder to avoid unique constraint violations on empty strings
          let finalBarcode = null;
          if (record.barcode && typeof record.barcode === 'string') {
            const cleaned = record.barcode.trim();
            const lower = cleaned.toLowerCase();
            if (cleaned !== '' && lower !== 'sin código' && lower !== 'sin codigo' && lower !== 'null' && lower !== 'undefined') {
              finalBarcode = cleaned;
            }
          }

          // Find existing product by SKU or by Barcode to prevent unique constraint failures
          let existing = await this.prisma.product.findUnique({ where: { sku: record.sku } });
          if (!existing && finalBarcode) {
            existing = await this.prisma.product.findUnique({ where: { barcode: finalBarcode } });
          }

          // Ensure the barcode is truly unique before applying it to avoid Prisma Unique constraint failures
          if (finalBarcode) {
            const duplicateBarcodeProduct = await this.prisma.product.findFirst({
              where: { 
                barcode: finalBarcode,
                sku: { not: record.sku }
              }
            });
            if (duplicateBarcodeProduct) {
              console.warn(`Barcode ${finalBarcode} is already used by product ${duplicateBarcodeProduct.sku}. Setting barcode to null for ${record.sku} to prevent unique constraint failure.`);
              finalBarcode = null;
            }
          }

          let categoryId = undefined;
          if (record.categoryName) {
            const catName = record.categoryName.trim();
            if (catName !== '') {
              let category = await this.prisma.category.findFirst({
                where: { name: { equals: catName } }
              });
              if (!category) {
                category = await this.prisma.category.create({
                  data: {
                    name: catName,
                    color: '#' + Math.floor(Math.random()*16777215).toString(16).padStart(6, '0')
                  }
                });
              }
              categoryId = category.id;
            }
          }

          if (existing) {
            await this.prisma.product.update({
              where: { id: existing.id },
              data: {
                barcode: finalBarcode || existing.barcode,
                stock: isNaN(record.stock) ? 0 : record.stock,
                costPrice: isNaN(record.costPrice) ? 0 : record.costPrice,
                salePrice: isNaN(record.salePrice) ? 0 : record.salePrice,
                description: record.description !== undefined ? record.description : existing.description,
                imageUrl: (record.imageUrl !== undefined && record.imageUrl !== '') ? record.imageUrl : existing.imageUrl,
                categoryId: categoryId !== undefined ? categoryId : existing.categoryId,
                isActive: true,
                updatedAt: new Date(),
              }
            });
            updated++;
          } else {
            await this.prisma.product.create({
              data: {
                sku: record.sku,
                barcode: finalBarcode,
                name: record.name ? record.name.toUpperCase() : 'SIN NOMBRE',
                stock: isNaN(record.stock) ? 0 : record.stock,
                costPrice: isNaN(record.costPrice) ? 0 : record.costPrice,
                salePrice: isNaN(record.salePrice) ? 0 : record.salePrice,
                description: record.description || '',
                imageUrl: record.imageUrl || '',
                categoryId: categoryId,
              }
            });
            imported++;
          }
        } catch (itemError) {
          console.error(`Error processing product SKU ${record.sku} (${lastItemName}):`, itemError.message);
        }

        // Periodically report progress to frontend (every 50 items) and yield to event loop
        if (i % 50 === 0 || i === total - 1) {
          const currentProgress = i + 1;
          const percentage = Math.floor((currentProgress / total) * 100);

          console.log(`Processed: ${currentProgress}/${total}. Progress: ${percentage}%`);
          
          this.eventsGateway.emitImportProgress({
            progress: percentage,
            total,
            current: currentProgress,
            status: `Importando: ${lastItemName}`,
            details: {
              imported,
              updated,
              lastItem: lastItemName
            }
          });

          // Small sleep to yield CPU and allow memory collection
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      }

      console.log(`Import completed successfully. Total: ${total}, Imported: ${imported}, Updated: ${updated}`);

      // Cleanup file
      if (fs.existsSync(file.path)) fs.unlinkSync(file.path);

      return { success: true, total, imported, updated };
    } catch (error) {
      console.error(`!!! Service Error: ${error.message}`);
      if (file && fs.existsSync(file.path)) fs.unlinkSync(file.path);
      throw new InternalServerErrorException('Error al procesar el archivo: ' + error.message);
    }
  }

  async syncAllToGoDelivery(userId?: string, googleEmail?: string) {
    if (this.isSyncing) {
      console.log('[FirebaseSync] Sincronización ya está en curso. Ignorando solicitud duplicada.');
      return { success: true, message: 'Sincronización ya en curso en segundo plano' };
    }

    if (!userId) {
      throw new UnauthorizedException('Debes iniciar sesión con Google para sincronizar productos.');
    }

    let email = googleEmail;
    if (!email) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user && user.username.includes('@')) {
        email = user.username;
      }
    }

    if (!email) {
      // Intentar buscar el primer usuario vinculado con Google registrado localmente como fallback secundario
      const linkedGoogleUser = await this.prisma.user.findFirst({
        where: { username: { contains: '@' } }
      });
      if (linkedGoogleUser) {
        email = linkedGoogleUser.username;
      }
    }

    if (!email) {
      throw new BadRequestException('Debes iniciar sesión con Google para sincronizar productos con GoDelivery.');
    }

    // Verificar si el usuario y el comercio existen en GoDelivery
    const exists = await this.firebaseSync.checkUserAndCommerceExists(email);
    if (!exists.userExists) {
      throw new BadRequestException(`La cuenta de Google (${email}) no está registrada en GoDelivery. Por favor, regístrate en la plataforma.`);
    }
    if (!exists.commerceExists) {
      throw new BadRequestException(`La cuenta de Google (${email}) está registrada en GoDelivery, pero no tiene ningún comercio asociado.`);
    }

    // Resolver comercio ID antes de lanzar hilo de fondo
    await this.firebaseSync.resolveComercioIdByEmail(email);

    this.isSyncing = true;

    // Start background sync task so REST request returns instantly and avoids timeouts
    this.runBackgroundSync(email).catch(err => {
      console.error('[FirebaseSync] Error en tarea de fondo de sincronización masiva:', err.message);
      this.eventsGateway.emitSyncProgress({
        progress: 100,
        total: 0,
        current: 0,
        status: 'Error en la sincronización',
        error: err.message,
        isComplete: true
      });
      this.isSyncing = false;
    });

    return { success: true, message: 'Sincronización iniciada en segundo plano' };
  }

  private async runBackgroundSync(targetEmail: string) {
    try {
      console.log(`[FirebaseSync] [Background] Iniciando sincronización masiva de inventario para ${targetEmail}...`);
      
      await this.firebaseSync.resolveComercioIdByEmail(targetEmail);

      const allActiveProductsCount = await this.prisma.product.count({
        where: { isActive: true }
      });

      const products = await this.prisma.product.findMany({
        where: { 
          isActive: true
        },
        include: {
          category: { select: { name: true } }
        }
      });
      
      // Mapear productos. Si no tienen código de barras, usamos su ID como código de barras en GoDelivery
      const validProducts = products.map(p => ({
        ...p,
        barcode: (p.barcode && p.barcode.trim() !== '') ? p.barcode.trim() : p.id
      }));
      const totalProducts = validProducts.length;
      const omittedCount = 0; // Ya no se omite ningún producto activo

      // 1. Clear all old categories in GoDelivery first to ensure a clean sync
      this.eventsGateway.emitSyncProgress({
        progress: 0,
        total: allActiveProductsCount,
        current: 0,
        status: 'Eliminando categorías antiguas en GoDelivery...'
      });
      await this.firebaseSync.clearAllCategories();

      // 2. Extract unique category names from Kiosco products
      this.eventsGateway.emitSyncProgress({
        progress: 5,
        total: allActiveProductsCount,
        current: 0,
        status: 'Analizando categorías locales...'
      });
      const uniqueCategoryNames = new Set<string>();
      validProducts.forEach(p => {
        const catName = p.category?.name || '';
        if (catName && catName.trim() !== '' && catName.toLowerCase() !== 'varios') {
          uniqueCategoryNames.add(catName.trim());
        }
      });

      // 3. Pre-create these categories and populate cache
      if (uniqueCategoryNames.size > 0) {
        this.eventsGateway.emitSyncProgress({
          progress: 10,
          total: allActiveProductsCount,
          current: 0,
          status: 'Pre-creando categorías en la nube...'
        });
        await this.firebaseSync.precreateCategories(Array.from(uniqueCategoryNames));
      }

      // 4. Clean up orphaned products in GoDelivery Firestore
      this.eventsGateway.emitSyncProgress({
        progress: 12,
        total: allActiveProductsCount,
        current: 0,
        status: 'Limpiando productos obsoletos en GoDelivery...'
      });
      const localBarcodes = validProducts.map(p => p.barcode).filter((b): b is string => !!b);
      const deletedCount = await this.firebaseSync.cleanOrphanedProducts(localBarcodes);
      console.log(`[FirebaseSync] Sincronización 1:1 - Se eliminaron ${deletedCount} productos obsoletos/huérfanos de la nube.`);

      let syncedCount = 0;
      let failedCount = 0;
      const concurrencyLimit = 15;
      const chunks = [];
      for (let i = 0; i < validProducts.length; i += concurrencyLimit) {
        chunks.push(validProducts.slice(i, i + concurrencyLimit));
      }
      
      this.eventsGateway.emitSyncProgress({
        progress: 15,
        total: allActiveProductsCount,
        current: 0,
        status: 'Sincronizando catálogo de productos...'
      });

      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        await Promise.all(
          chunk.map(async (p) => {
            if (p.barcode) {
              try {
                const finalImg = await this.firebaseSync.syncProductToFirestore(
                  p.barcode, 
                  p.stock, 
                  p.salePrice,
                  {
                    name: p.name,
                    description: p.description || '',
                    categoryName: p.category?.name || 'Varios',
                    minStock: p.minStock,
                    imageUrl: p.imageUrl || ''
                  }
                );
                
                // Si la imagen remota fue comprimida y convertida a base64, guardarla localmente en SQLite
                if (finalImg && finalImg.startsWith('data:') && p.imageUrl !== finalImg) {
                  await this.prisma.product.update({
                    where: { id: p.id },
                    data: { imageUrl: finalImg }
                  });
                }
                syncedCount++;
              } catch (err: any) {
                console.error(`[FirebaseSync] Error syncing individual product [${p.barcode}]:`, err.message);
                failedCount++;
              }
            }
          })
        );

        // Progress calculates from 15% to 95%
        const progressPercent = 15 + Math.round(( (i + 1) / chunks.length ) * 80);
        this.eventsGateway.emitSyncProgress({
          progress: Math.min(progressPercent, 95),
          total: allActiveProductsCount,
          current: syncedCount,
          status: `Sincronizando: ${chunk[chunk.length - 1]?.name || ''}`
        });
      }
      
      this.eventsGateway.emitSyncProgress({
        progress: 100,
        total: allActiveProductsCount,
        current: syncedCount,
        omittedCount: omittedCount,
        failedCount: failedCount,
        status: '¡Sincronización masiva finalizada!',
        isComplete: true
      });
      console.log(`[FirebaseSync] Sincronización masiva finalizada. ${syncedCount} exitosos, ${omittedCount} omitidos, ${failedCount} fallidos.`);
    } catch (err: any) {
      console.error('[FirebaseSync] Error en sincronización masiva en segundo plano:', err.message);
      this.eventsGateway.emitSyncProgress({
        progress: 100,
        total: 0,
        current: 0,
        status: 'Error en la sincronización',
        error: err.message,
        isComplete: true
      });
    } finally {
      this.isSyncing = false;
    }
  }

  async bulkUpdatePrices(data: {
    supplierId?: string;
    categoryId?: string;
    brandId?: string;
    percentage: number;
    target?: 'COST_AND_SALE' | 'SALE_ONLY' | 'COST_ONLY';
  }) {
    const { supplierId, categoryId, brandId, percentage, target = 'COST_AND_SALE' } = data;
    if (percentage === 0 || isNaN(percentage)) {
      throw new BadRequestException('El porcentaje de actualización no puede ser 0');
    }

    const where: any = { isActive: true };
    if (supplierId) where.supplierId = supplierId;
    if (categoryId) where.categoryId = categoryId;
    if (brandId) where.brandId = brandId;

    const products = await this.prisma.product.findMany({ where });
    if (products.length === 0) {
      return { updatedCount: 0, message: 'No se encontraron productos con los filtros seleccionados.' };
    }

    const factor = 1 + (percentage / 100);

    const updates = products.map(p => {
      const updateData: any = {};
      if (target === 'COST_AND_SALE' || target === 'COST_ONLY') {
        updateData.costPrice = Math.round((p.costPrice * factor) * 100) / 100;
      }
      if (target === 'COST_AND_SALE' || target === 'SALE_ONLY') {
        updateData.salePrice = Math.round((p.salePrice * factor) * 100) / 100;
      }
      return this.prisma.product.update({
        where: { id: p.id },
        data: updateData,
      });
    });

    await this.prisma.$transaction(updates);

    try {
      this.eventsGateway.server?.emit('products:bulk-updated', { count: products.length });
    } catch {}

    return {
      updatedCount: products.length,
      percentage,
      target,
      message: `Se actualizaron ${products.length} productos con un ajuste del ${percentage > 0 ? '+' : ''}${percentage}%.`,
    };
  }

  /**
   * Redondea hacia arriba los precios de venta al múltiplo indicado (por defecto 10),
   * para que no queden con decimales: 1.912,28 -> 1.920.
   */
  async bulkRoundPrices(multiple = 10) {
    if (!Number.isFinite(multiple) || multiple <= 0) {
      throw new BadRequestException('El múltiplo debe ser mayor a 0');
    }
    console.log(`[ProductsService] Redondeando precios de venta hacia arriba a múltiplos de ${multiple}...`);

    const products = await this.prisma.product.findMany({
      where: { isActive: true, salePrice: { gt: 0 } },
      select: { id: true, salePrice: true },
    });

    const changes = products
      .map(p => ({ id: p.id, newPrice: Math.ceil(p.salePrice / multiple) * multiple, oldPrice: p.salePrice }))
      .filter(c => Math.abs(c.newPrice - c.oldPrice) > 0.0001);

    // Se agrupan por precio para hacer pocas consultas en lugar de una por producto
    const byPrice = new Map<number, string[]>();
    for (const c of changes) byPrice.set(c.newPrice, [...(byPrice.get(c.newPrice) || []), c.id]);

    for (const [price, ids] of byPrice) {
      for (let i = 0; i < ids.length; i += 300) {
        await this.prisma.product.updateMany({ where: { id: { in: ids.slice(i, i + 300) } }, data: { salePrice: price } });
      }
    }

    console.log(`[ProductsService] Precios redondeados: ${changes.length} de ${products.length}`);
    return { updated: changes.length, total: products.length, multiple };
  }

  async bulkResetStock() {
    console.log('[ProductsService] Resetting stock of all active products to 0...');
    const result = await this.prisma.product.updateMany({
      where: { isActive: true },
      data: { stock: 0 }
    });
    
    this.eventsGateway.emitStockUpdated([]);
    return { count: result.count };
  }

  async bulkDeleteAll() {
    console.log('[ProductsService] Soft-deleting all products...');
    
    // Delete all additional barcodes to release unique constraints
    await this.prisma.productBarcode.deleteMany({});
    
    const result = await this.prisma.product.updateMany({
      where: { isActive: true },
      data: { 
        isActive: false,
        barcode: null,
        sku: null
      }
    });
    
    return { count: result.count };
  }

  async bulkDeleteZeroNegative() {
    console.log('[ProductsService] Soft-deleting products with zero or negative stock...');
    const products = await this.prisma.product.findMany({
      where: { 
        isActive: true,
        stock: { lte: 0 }
      },
      select: { id: true, barcode: true }
    });
    const ids = products.map(p => p.id);

    await this.prisma.productBarcode.deleteMany({
      where: { productId: { in: ids } }
    });

    const result = await this.prisma.product.updateMany({
      where: { id: { in: ids } },
      data: { 
        isActive: false,
        barcode: null,
        sku: null
      }
    });

    // Sync deletion to GoDelivery Firestore
    Promise.all(products.map(p => {
      const syncBarcode = p.barcode || p.id;
      return this.firebaseSync.syncProductDeletion(syncBarcode).catch(err => {
        console.error(`Error syncing bulk deletion for ${syncBarcode}:`, err.message);
      });
    })).catch(err => console.error('Error in bulk deletion sync:', err));
    
    return { count: result.count };
  }

  async bulkRemoveAllImages() {
    console.log('[ProductsService] Resetting all product images to generic standard placeholder...');
    const result = await this.prisma.product.updateMany({
      where: { isActive: true },
      data: { imageUrl: '' }
    });
    
    return { count: result.count };
  }

  async bulkRemoveImagesSubset(ids: string[]) {
    console.log(`[ProductsService] Resetting product images to placeholder for subset of ${ids.length} products...`);
    const result = await this.prisma.product.updateMany({
      where: { id: { in: ids } },
      data: { imageUrl: '' }
    });

    // Sync image removal to GoDelivery Firestore in background
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      include: { category: true }
    });
    
    // We execute them sequentially/concurrently to avoid blocking the main thread
    Promise.all(products.map(p => {
      const syncBarcode = p.barcode || p.id;
      return this.firebaseSync.syncProductToFirestore(
        syncBarcode,
        p.stock,
        p.salePrice,
        {
          name: p.name,
          description: p.description || '',
          categoryName: p.category?.name || 'Varios',
          minStock: p.minStock,
          imageUrl: ''
        }
      ).catch(err => {
        console.error(`Error syncing image removal for ${syncBarcode}:`, err.message);
      });
    })).catch(err => console.error('Error in subset image sync:', err));

    return { count: result.count };
  }

  async bulkDeleteSubset(ids: string[]) {
    console.log(`[ProductsService] Soft-deleting subset of ${ids.length} products...`);
    
    await this.prisma.productBarcode.deleteMany({
      where: { productId: { in: ids } }
    });

    const result = await this.prisma.product.updateMany({
      where: { id: { in: ids } },
      data: { 
        isActive: false,
        barcode: null,
        sku: null
      }
    });

    // Sync product deletion to GoDelivery Firestore in background
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } }
    });

    Promise.all(products.map(p => {
      const syncBarcode = p.barcode || p.id;
      return this.firebaseSync.syncProductDeletion(syncBarcode).catch(err => {
        console.error(`Error syncing deletion for ${syncBarcode}:`, err.message);
      });
    })).catch(err => console.error('Error in subset deletion sync:', err));

    return { count: result.count };
  }

  async bulkSetShowOnline(ids: string[] | undefined, showOnline: boolean) {
    const where = ids && ids.length > 0 ? { id: { in: ids } } : { isActive: true };
    const result = await this.prisma.product.updateMany({
      where,
      data: { showOnline: !!showOnline }
    });
    return { success: true, count: result.count };
  }

  async bulkUpdateCategorySubset(ids: string[], categoryId: string) {
    console.log(`[ProductsService] Updating category for subset of ${ids.length} products to ${categoryId}...`);
    const result = await this.prisma.product.updateMany({
      where: { id: { in: ids } },
      data: { categoryId }
    });

    // Sync product updates to GoDelivery Firestore in background
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
      include: { category: true }
    });

    Promise.all(products.map(p => {
      const syncBarcode = p.barcode || p.id;
      return this.firebaseSync.syncProductToFirestore(
        syncBarcode,
        p.stock,
        p.salePrice,
        {
          name: p.name,
          description: p.description || '',
          categoryName: p.category?.name || 'Varios',
          minStock: p.minStock,
          imageUrl: p.imageUrl || ''
        }
      ).catch(err => {
        console.error(`Error syncing category change for product: ${p.sku}`, err.message);
      });
    })).catch(err => console.error('Error in subset category sync:', err));

    return { count: result.count };
  }

  async exportForGoDelivery() {
    console.log('[ProductsService] Exporting database for GoDelivery...');
    const products = await this.prisma.product.findMany({
      where: { isActive: true },
      include: { category: true }
    });
    
    return products.map(p => ({
      barcode: p.barcode || '',
      name: p.name,
      price: p.salePrice,
      stock: p.stock,
      category: p.category?.name || 'Varios',
      description: p.description || '',
      image: p.imageUrl || ''
    }));
  }

  async getGoDeliveryStats(userId: string, googleEmail?: string) {
    if (!userId) {
      throw new UnauthorizedException('Debes iniciar sesión con Google para consultar estadísticas.');
    }

    let email = googleEmail;
    if (!email) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user && user.username.includes('@')) {
        email = user.username;
      }
    }

    if (!email) {
      const linkedGoogleUser = await this.prisma.user.findFirst({
        where: { username: { contains: '@' } }
      });
      if (linkedGoogleUser) {
        email = linkedGoogleUser.username;
      }
    }

    if (!email) {
      throw new BadRequestException('Debes vincular tu cuenta de Google para obtener estadísticas de GoDelivery.');
    }

    return this.firebaseSync.getStoreStats(email);
  }

  async updateGoDeliverySettings(userId: string, configData: any, googleEmail?: string) {
    if (!userId) {
      throw new UnauthorizedException('Debes iniciar sesión con Google para actualizar configuraciones.');
    }

    let email = googleEmail;
    if (!email) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (user && user.username.includes('@')) {
        email = user.username;
      }
    }

    if (!email) {
      const linkedGoogleUser = await this.prisma.user.findFirst({
        where: { username: { contains: '@' } }
      });
      if (linkedGoogleUser) {
        email = linkedGoogleUser.username;
      }
    }

    if (!email) {
      throw new BadRequestException('Debes vincular tu cuenta de Google para actualizar configuraciones de GoDelivery.');
    }

    return this.firebaseSync.updateCommerceConfig(email, configData);
  }
}
