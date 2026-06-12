import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  async onModuleInit() {
    // Retry connect up to 3 times with 2s delay (handles DB lock on startup)
    let connected = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await this.$connect();
        connected = true;
        break;
      } catch (err) {
        console.warn(`[PrismaService] $connect attempt ${attempt}/3 failed:`, err);
        if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
      }
    }
    if (!connected) {
      console.error('[PrismaService] CRITICAL: Could not connect to SQLite database after 3 attempts.');
    }

    // Auto-migrate schema changes if updating an existing database
    try {
      const productColumns: any[] = await this.$queryRawUnsafe(`PRAGMA table_info(products);`);
      const hasPresentationType = productColumns.some(c => c.name === 'presentation_type');
      if (!hasPresentationType) {
        console.log('[PrismaService] Auto-migrating products table: adding presentation_type...');
        await this.$executeRawUnsafe(`ALTER TABLE products ADD COLUMN presentation_type TEXT NOT NULL DEFAULT 'UNIT';`);
      }
      const hasUnitsPerPack = productColumns.some(c => c.name === 'units_per_pack');
      if (!hasUnitsPerPack) {
        console.log('[PrismaService] Auto-migrating products table: adding units_per_pack...');
        await this.$executeRawUnsafe(`ALTER TABLE products ADD COLUMN units_per_pack INTEGER NOT NULL DEFAULT 1;`);
      }
      const hasUnlimitedStock = productColumns.some(c => c.name === 'unlimited_stock');
      if (!hasUnlimitedStock) {
        console.log('[PrismaService] Auto-migrating products table: adding unlimited_stock...');
        await this.$executeRawUnsafe(`ALTER TABLE products ADD COLUMN unlimited_stock INTEGER NOT NULL DEFAULT 0;`);
      }

      const purchaseItemColumns: any[] = await this.$queryRawUnsafe(`PRAGMA table_info(purchase_items);`);
      const hasBuyFormat = purchaseItemColumns.some(c => c.name === 'buy_format');
      if (!hasBuyFormat) {
        console.log('[PrismaService] Auto-migrating purchase_items table: adding buy_format...');
        await this.$executeRawUnsafe(`ALTER TABLE purchase_items ADD COLUMN buy_format TEXT NOT NULL DEFAULT 'UNIT';`);
      }
    } catch (err) {
      console.error('[PrismaService] Failed to auto-migrate database schema:', err);
    }

    try {
      // Optimize SQLite performance for low-end machines (WAL mode, cache size, synchronous normal, temp store memory)
      // PRAGMAs are run using queryRawUnsafe because some of them or some SQLite versions return results, which causes executeRawUnsafe to throw an error.
      await this.$queryRawUnsafe(`PRAGMA journal_mode = WAL;`);
      await this.$queryRawUnsafe(`PRAGMA synchronous = NORMAL;`);
      await this.$queryRawUnsafe(`PRAGMA busy_timeout = 5000;`);
      await this.$queryRawUnsafe(`PRAGMA cache_size = -64000;`); // 64MB Cache in RAM
      await this.$queryRawUnsafe(`PRAGMA temp_store = MEMORY;`);
      
      // Asynchronously run VACUUM and ANALYZE to compact and optimize indexes on boot
      this.$executeRawUnsafe(`VACUUM;`).catch((e) => console.error('Error running VACUUM:', e));
      this.$executeRawUnsafe(`ANALYZE;`).catch((e) => console.error('Error running ANALYZE:', e));
    } catch (err) {
      console.error('Failed to apply SQLite PRAGMAs:', err);
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
