import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { SyncImageService } from '../products/sync-image.service';

// Runs only when DEMO_MODE=true (set as a Fly secret on the public demo
// deployment). Wipes everything a visitor could have typed in and reseeds a
// realistic sample kiosco, so the public "Probar demo" link on the landing
// page always opens to something populated and never accumulates real data.
// Real Argentine retail products (real EAN barcodes). Images are NOT hardcoded
// here — resetAndSeed() runs the app's own barcode-to-image sync afterwards,
// which pulls professional white/clean-background catalog photos from
// Carrefour/Jumbo/Dia/ChangoMas instead of crowdsourced Open Food Facts photos.
const DEMO_PRODUCTS: Array<{
  name: string; barcode: string; salePrice: number; stock: number; category: string;
}> = [
  { name: 'COCA-COLA', barcode: '7790895000997', salePrice: 3200, stock: 40, category: 'Bebidas' },
  { name: 'CERVEZA QUILMES CLÁSICA', barcode: '7792798007387', salePrice: 2650, stock: 36, category: 'Bebidas' },
  { name: 'AGUA MINERAL VILLAVICENCIO 2L', barcode: '7790315000422', salePrice: 1450, stock: 50, category: 'Bebidas' },
  { name: 'FERNET BRANCA 750ML', barcode: '7790290101602', salePrice: 8900, stock: 14, category: 'Bebidas' },
  { name: 'PAN LACTAL BIMBO', barcode: '7796989008542', salePrice: 2850, stock: 8, category: 'Panadería' },
  { name: 'YERBA MATE PLAYADITO 500G', barcode: '7793704000232', salePrice: 5100, stock: 25, category: 'Almacén' },
  { name: 'FIDEOS MATARAZZO', barcode: '7790070320018', salePrice: 1450, stock: 6, category: 'Almacén' },
  { name: 'ARROZ ORO SELECCIÓN 1KG', barcode: '7790070433091', salePrice: 2200, stock: 30, category: 'Almacén' },
  { name: 'ACEITE DE GIRASOL 900ML', barcode: '7790272001005', salePrice: 3400, stock: 18, category: 'Almacén' },
  { name: 'QUESO CREMOSO', barcode: '7790080040142', salePrice: 3950, stock: 10, category: 'Lácteos' },
  { name: 'YOGUR BEBIBLE VAINILLA', barcode: '7790787100415', salePrice: 2300, stock: 15, category: 'Lácteos' },
  { name: 'ALFAJOR DE DULCE DE LECHE', barcode: '77980229', salePrice: 650, stock: 60, category: 'Golosinas' },
  { name: 'CHOCOLATE MILKA', barcode: '7622210953681', salePrice: 1650, stock: 28, category: 'Golosinas' },
  { name: 'BON O BON', barcode: '77958921', salePrice: 550, stock: 45, category: 'Golosinas' },
  { name: 'PAPAS LAYS JAMÓN SERRANO', barcode: '7790310985618', salePrice: 2400, stock: 20, category: 'Snacks' },
  { name: 'LAVANDINA AYUDÍN 1L', barcode: '7790132098459', salePrice: 1200, stock: 24, category: 'Limpieza' },
  { name: 'JAMÓN COCIDO FETEADO', barcode: '7798105711701', salePrice: 3600, stock: 9, category: 'Fiambrería' },
];

@Injectable()
export class DemoResetService implements OnModuleInit {
  private readonly logger = new Logger('DemoReset');
  private get isDemo() { return process.env.DEMO_MODE === 'true'; }

  constructor(private prisma: PrismaService, private syncImageService: SyncImageService) {}

  async onModuleInit() {
    if (!this.isDemo) return;
    await this.prisma.ensureInitialized();
    const productCount = await this.prisma.product.count().catch(() => 0);
    if (productCount === 0) {
      this.logger.log('DEMO_MODE on and no products found — seeding demo data...');
      await this.resetAndSeed();
    }
  }

  // Every 6 hours — keeps the public demo fresh without wiping it mid-visit too often.
  @Cron('0 */6 * * *')
  async scheduledReset() {
    if (!this.isDemo) return;
    this.logger.log('Scheduled demo reset starting...');
    await this.resetAndSeed();
  }

  async resetAndSeed() {
    if (!this.isDemo) return;
    const wipeSteps: Array<[string, () => Promise<unknown>]> = [
      ['deliveryReceiptItem', () => this.prisma.deliveryReceiptItem.deleteMany()],
      ['deliveryReceipt', () => this.prisma.deliveryReceipt.deleteMany()],
      ['quoteItem', () => this.prisma.quoteItem.deleteMany()],
      ['quote', () => this.prisma.quote.deleteMany()],
      ['marketingGroupItem', () => this.prisma.marketingGroupItem.deleteMany()],
      ['marketingGroup', () => this.prisma.marketingGroup.deleteMany()],
      ['payment', () => this.prisma.payment.deleteMany()],
      ['saleItem', () => this.prisma.saleItem.deleteMany()],
      ['sale', () => this.prisma.sale.deleteMany()],
      ['cashMovement', () => this.prisma.cashMovement.deleteMany()],
      ['dailyZReport', () => this.prisma.dailyZReport.deleteMany()],
      ['cashRegisterSession', () => this.prisma.cashRegisterSession.deleteMany()],
      ['accountMovement', () => this.prisma.accountMovement.deleteMany()],
      ['inventoryMovement', () => this.prisma.inventoryMovement.deleteMany()],
      ['priceHistory', () => this.prisma.priceHistory.deleteMany()],
      ['purchaseItem', () => this.prisma.purchaseItem.deleteMany()],
      ['purchase', () => this.prisma.purchase.deleteMany()],
      ['supplierPayment', () => this.prisma.supplierPayment.deleteMany()],
      ['promotionProduct', () => this.prisma.promotionProduct.deleteMany()],
      ['promotion', () => this.prisma.promotion.deleteMany()],
      ['productKitItem', () => this.prisma.productKitItem.deleteMany()],
      ['productBarcode', () => this.prisma.productBarcode.deleteMany()],
      ['auditLog', () => this.prisma.auditLog.deleteMany()],
      ['client', () => this.prisma.client.deleteMany()],
      ['supplier', () => this.prisma.supplier.deleteMany()],
      ['product', () => this.prisma.product.deleteMany()],
      ['brand', () => this.prisma.brand.deleteMany()],
      ['surcharge', () => this.prisma.surcharge.deleteMany()],
      ['category', () => this.prisma.category.deleteMany()],
    ];
    for (const [name, run] of wipeSteps) {
      try {
        await run();
      } catch (err: any) {
        this.logger.warn(`Demo reset: failed to clear ${name}: ${err.message}`);
      }
    }

    const categoryColors: Record<string, string> = {
      Bebidas: '#3b82f6', Snacks: '#f59e0b', Lácteos: '#10b981', Panadería: '#f97316',
      Limpieza: '#06b6d4', Golosinas: '#ec4899', Fiambrería: '#ef4444', Almacén: '#8b5cf6',
    };
    const categoryMap = new Map<string, string>();
    for (const [name, color] of Object.entries(categoryColors)) {
      const cat = await this.prisma.category.create({ data: { name, color, icon: 'Package' } });
      categoryMap.set(name, cat.id);
    }

    for (const p of DEMO_PRODUCTS) {
      await this.prisma.product.create({
        data: {
          name: p.name,
          barcode: p.barcode,
          salePrice: p.salePrice,
          costPrice: Math.round(p.salePrice * 0.65),
          stock: p.stock,
          minStock: 5,
          categoryId: categoryMap.get(p.category),
        },
      });
    }

    const passwordHash = await bcrypt.hash('1234', 10);
    await this.prisma.user.upsert({
      where: { username: 'ADMIN' },
      update: { passwordHash, isActive: true, role: 'ADMIN' },
      create: { username: 'ADMIN', passwordHash, fullName: 'Administrador Demo', role: 'ADMIN' },
    });

    this.logger.log(`Demo data reset: ${DEMO_PRODUCTS.length} products, ${categoryMap.size} categories.`);

    // Populate real catalog photos (white/clean-background) via barcode lookup
    // against Carrefour/Jumbo/Dia/ChangoMas. Runs after seeding so it never
    // blocks the reset itself on slow external calls.
    this.syncImageService.assignImagesToProducts('demo-reset').then((result) => {
      this.logger.log(`Demo image sync: ${result.successCount}/${result.totalProcessed} images assigned.`);
    }).catch((err) => {
      this.logger.warn(`Demo image sync failed: ${err.message}`);
    });
  }
}
