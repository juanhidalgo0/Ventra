import { Injectable, NotFoundException, InternalServerErrorException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { EventsGateway } from '../../websockets/events.gateway';
import { FirebaseSyncService } from './firebase-sync.service';
import { DBFFile } from 'dbffile';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { parse } from 'csv-parse/sync';
import * as fs from 'fs';

@Injectable()
export class ProductsService {
  private isSyncing = false;

  constructor(
    private prisma: PrismaService,
    private eventsGateway: EventsGateway,
    private firebaseSync: FirebaseSyncService,
  ) {}

  async verifyGoogleEmailOwnsTerminalCommerce(email: string): Promise<boolean> {
    return this.firebaseSync.verifyGoogleEmailOwnsTerminalCommerce(email);
  }

  async findAll(params?: { search?: string; categoryId?: string; isActive?: boolean; isFavorite?: boolean; lowStock?: boolean; skip?: number; take?: number }) {
    try {
      const where: any = { isActive: true };
      if (params?.search) {
        where.OR = [
          { name: { contains: params.search } },
          { barcode: { contains: params.search } },
          { sku: { contains: params.search } },
          { additionalBarcodes: { some: { barcode: { contains: params.search } } } },
        ];
      }
      if (params?.categoryId) where.categoryId = params.categoryId;
      if (params?.isFavorite) where.isFavorite = true;

      const selectOrInclude = {
        include: {
          category: { select: { id: true, name: true, color: true, icon: true } }, 
          brand: { select: { id: true, name: true } }, 
          supplier: { select: { id: true, name: true } },
          additionalBarcodes: true
        }
      };

      if (params?.lowStock) {
        const products = await this.prisma.product.findMany({
          where: { isActive: true },
          ...selectOrInclude,
          orderBy: { name: 'asc' },
        });
        return products.filter((p) => p.stock <= p.minStock);
      }

      const results = await this.prisma.product.findMany({
        where,
        ...selectOrInclude,
        orderBy: { name: 'asc' },
        skip: params?.skip || 0,
        take: params?.take || 50,
      });

      return results;
    } catch (error) {
      console.error('Error in ProductsService.findAll:', error);
      throw new InternalServerErrorException('Error al obtener productos: ' + error.message);
    }
  }

  async findById(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id }, include: { category: true, brand: true, supplier: true } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    return product;
  }

  async findByBarcode(barcode: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        OR: [
          { barcode },
          { additionalBarcodes: { some: { barcode } } }
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
    const { additionalBarcodes, ...data } = createProductDto;
    
    // Clean up data to only include valid schema fields
    const validFields = [
      'name', 'barcode', 'sku', 'description', 'imageUrl', 
      'costPrice', 'salePrice', 'stock', 'minStock', 'unit', 
      'presentationType', 'unitsPerPack',
      'taxRate', 'isActive', 'isFavorite', 'allowCustomPrice', 'unlimitedStock', 'categoryId', 'brandId', 'supplierId'
    ];
    
    const productData: any = {};
    for (const key of validFields) {
      if (data[key] !== undefined) {
        if (['categoryId', 'brandId', 'supplierId'].includes(key) && data[key] === '') {
          productData[key] = null;
        } else if (key === 'name' && typeof data[key] === 'string') {
          productData[key] = data[key].toUpperCase();
        } else {
          productData[key] = data[key];
        }
      }
    }

    if (productData.imageUrl && (productData.imageUrl.startsWith('http://') || productData.imageUrl.startsWith('https://'))) {
      productData.imageUrl = await this.firebaseSync.compressRemoteImageToBase64(productData.imageUrl);
    }

    let product: any;
    try {
      product = await this.prisma.product.create({
        data: {
          ...productData,
          additionalBarcodes: additionalBarcodes && additionalBarcodes.length > 0 ? {
            create: additionalBarcodes.map((b: string) => ({ barcode: b }))
          } : undefined
        },
        include: { 
          category: { select: { id: true, name: true, color: true } }, 
          brand: { select: { id: true, name: true } },
          additionalBarcodes: true
        }
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        const field = err?.meta?.target?.[0] || 'campo';
        throw new BadRequestException(`Ya existe un producto con ese ${field === 'barcode' ? 'código de barras' : field}`);
      }
      throw err;
    }

    if (product.barcode) {
      this.firebaseSync.syncProductToFirestore(
        product.barcode, 
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
    }

    return product;
  }

  async update(id: string, data: any, userId?: string) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Producto no encontrado');
    const { additionalBarcodes } = data;

    const validFields = [
      'name', 'barcode', 'sku', 'description', 'imageUrl', 
      'costPrice', 'salePrice', 'stock', 'minStock', 'unit', 
      'presentationType', 'unitsPerPack',
      'taxRate', 'isActive', 'isFavorite', 'allowCustomPrice', 'unlimitedStock', 'categoryId', 'brandId', 'supplierId'
    ];
    
    const updateData: any = {};
    for (const key of validFields) {
      if (data[key] !== undefined) {
        // Handle empty strings for optional relations
        if (['categoryId', 'brandId', 'supplierId'].includes(key) && data[key] === '') {
          updateData[key] = null;
        } else if (key === 'name' && typeof data[key] === 'string') {
          updateData[key] = data[key].toUpperCase();
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
                barcode: b,
                productId: id
              }
            });
          }
        }
      }

      return tx.product.update({ 
        where: { id }, 
        data: updateData, 
        include: { 
          category: { select: { id: true, name: true, color: true } }, 
          brand: { select: { id: true, name: true } },
          additionalBarcodes: true
        } 
      });
    });

    if (updatedProduct.barcode) {
      this.firebaseSync.syncProductToFirestore(
        updatedProduct.barcode, 
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
    }

    return updatedProduct;
  }

  async delete(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Producto no encontrado');
    const updated = await this.prisma.product.update({ where: { id }, data: { isActive: false } });

    if (updated.barcode) {
      this.firebaseSync.syncProductDeletion(updated.barcode).catch(err => {
        console.error('Error syncing deleted product to Firestore:', err);
      });
    }

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

    if (product.barcode) {
      this.firebaseSync.syncProductToFirestore(product.barcode, stockAfter, product.salePrice).catch(err => {
        console.error('Error syncing adjusted product to Firestore:', err);
      });
    }

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
      const dbf = await DBFFile.open(dbfPath);
      console.log(`Importing ${dbf.recordCount} products from DBF...`);

      let importedCount = 0;
      let updatedCount = 0;

      // Read records in batches of 500
      const batchSize = 500;
      for (let i = 0; i < dbf.recordCount; i += batchSize) {
        const records = await dbf.readRecords(batchSize);
        
        await this.prisma.$transaction(async (tx) => {
          for (const record of records as any[]) {
            const sku = record.NUM_ART.trim();
            if (!sku) continue;

            const name = record.DESC.trim().toUpperCase();
            const stock = record.EXISTENCIA || 0;
            const paquete = record.PAQUETE || 1;
            const costPrice = record.COSTO / paquete;
            const salePrice = record.PRECIOA || 0;

            const existing = await tx.product.findUnique({
              where: { sku },
            });

            if (existing) {
              await tx.product.update({
                where: { id: existing.id },
                data: {
                  stock,
                  costPrice,
                  salePrice,
                  updatedAt: new Date(),
                },
              });
              updatedCount++;
            } else {
              await tx.product.create({
                data: {
                  sku,
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

    try {
      console.log(`--- Starting import of ${file.originalname} ---`);
      if (extension === '.dbf') {
        const dbf = await DBFFile.open(file.path);
        console.log(`DBF opened, record count: ${dbf.recordCount}`);
        records = await dbf.readRecords();
        console.log(`Read ${records.length} records`);
        // Convert DBF records to common format
        console.log(`Parsed ${records.length} records from DBF`);
        records = records.map((r: any) => {
          const paquete = parseFloat(r.PAQUETE) || 1;
          const costo = parseFloat(r.COSTO) || 0;
          const barcode = String(r.NUM_ART || '').trim();
          return {
            sku: barcode,
            barcode: barcode,
            name: String(r.DESC || '').trim().toUpperCase(),
            stock: parseFloat(r.EXISTENCIA) || 0,
            costPrice: costo / (paquete || 1),
            salePrice: parseFloat(r.PRECIOA) || 0
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
            salePrice: parseFloat(r.salePrice || r.precio || r.PRECIOA || '0')
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
            salePrice: parseFloat(r.salePrice || r.precio || r.PRECIOA || '0')
          };
        });
      } else {
        throw new Error(`Formato de archivo no soportado: ${extension}`);
      }

      const total = records.length;
      console.log(`Beginning processing of ${total} records in batches of 100...`);
      let imported = 0;
      let updated = 0;

      // Process in batches and report progress
      const batchSize = 100;
      for (let i = 0; i < total; i += batchSize) {
        const batch = records.slice(i, i + batchSize);
        
        let lastItemName = '';
        await this.prisma.$transaction(async (tx) => {
          for (const record of batch) {
            if (!record.sku) continue;
            lastItemName = record.name;

            const existing = await tx.product.findUnique({ where: { sku: record.sku } });

            if (existing) {
              await tx.product.update({
                where: { id: existing.id },
                data: {
                  stock: isNaN(record.stock) ? 0 : record.stock,
                  costPrice: isNaN(record.costPrice) ? 0 : record.costPrice,
                  salePrice: isNaN(record.salePrice) ? 0 : record.salePrice,
                  updatedAt: new Date(),
                }
              });
              updated++;
            } else {
              await tx.product.create({
                data: {
                  sku: record.sku,
                  barcode: record.barcode,
                  name: record.name ? record.name.toUpperCase() : 'SIN NOMBRE',
                  stock: isNaN(record.stock) ? 0 : record.stock,
                  costPrice: isNaN(record.costPrice) ? 0 : record.costPrice,
                  salePrice: isNaN(record.salePrice) ? 0 : record.salePrice,
                }
              });
              imported++;
            }
          }
        }, {
          timeout: 30000 // 30 seconds per batch
        });

        const currentProgress = Math.min(i + batchSize, total);
        const percentage = Math.floor((currentProgress / total) * 100);

        console.log(`Processed batch ${Math.floor(i/batchSize) + 1}. Total progress: ${percentage}%`);
        
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
      
      // Filtrar aquellos que realmente tienen código de barra no vacío
      const validProducts = products.filter(p => p.barcode && p.barcode.trim() !== '');
      const totalProducts = validProducts.length;
      const omittedCount = allActiveProductsCount - totalProducts;

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
    const result = await this.prisma.product.updateMany({
      where: { isActive: true },
      data: { isActive: false }
    });
    
    return { count: result.count };
  }

  async bulkDeleteZeroNegative() {
    console.log('[ProductsService] Soft-deleting products with zero or negative stock...');
    const result = await this.prisma.product.updateMany({
      where: { 
        isActive: true,
        stock: { lte: 0 }
      },
      data: { isActive: false }
    });
    
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
