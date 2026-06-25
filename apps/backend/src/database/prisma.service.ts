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
      console.warn('[PrismaService] Attempting self-healing: deleting WAL/SHM files to release locks...');
      try {
        const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
        const dbUrlWithoutQuery = dbUrl.split('?')[0];
        let cleanPath = dbUrlWithoutQuery.replace('file:', '');
        const path = require('path');
        const fs = require('fs');
        if (!path.isAbsolute(cleanPath)) {
          cleanPath = path.join(process.cwd(), 'prisma', cleanPath);
        }
        const dbPath = path.normalize(cleanPath);
        const walPath = `${dbPath}-wal`;
        const shmPath = `${dbPath}-shm`;
        const journalPath = `${dbPath}-journal`;
        if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
        if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
        if (fs.existsSync(journalPath)) fs.unlinkSync(journalPath);
        
        console.log('[PrismaService] WAL/SHM files deleted. Trying final connection...');
        await this.$connect();
        connected = true;
      } catch (selfHealError) {
        console.error('[PrismaService] Self-healing failed:', selfHealError);
      }
    }

    if (!connected) {
      console.error('[PrismaService] CRITICAL: Could not connect to SQLite database after self-healing.');
      return; // Exit early to prevent fatal crashes during schema checks
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
      const hasAllowCustomPrice = productColumns.some(c => c.name === 'allow_custom_price');
      if (!hasAllowCustomPrice) {
        console.log('[PrismaService] Auto-migrating products table: adding allow_custom_price...');
        await this.$executeRawUnsafe(`ALTER TABLE products ADD COLUMN allow_custom_price INTEGER NOT NULL DEFAULT 0;`);
      }

      const purchaseItemColumns: any[] = await this.$queryRawUnsafe(`PRAGMA table_info(purchase_items);`);
      const hasBuyFormat = purchaseItemColumns.some(c => c.name === 'buy_format');
      if (!hasBuyFormat) {
        console.log('[PrismaService] Auto-migrating purchase_items table: adding buy_format...');
        await this.$executeRawUnsafe(`ALTER TABLE purchase_items ADD COLUMN buy_format TEXT NOT NULL DEFAULT 'UNIT';`);
      }

      const categoryColumns: any[] = await this.$queryRawUnsafe(`PRAGMA table_info(categories);`);
      const hasParentCategoryId = categoryColumns.some(c => c.name === 'parent_category_id');
      if (!hasParentCategoryId) {
        console.log('[PrismaService] Auto-migrating categories table: adding parent_category_id...');
        await this.$executeRawUnsafe(`ALTER TABLE categories ADD COLUMN parent_category_id TEXT DEFAULT NULL;`);
      }

      // Ensure app_licenses table exists (for license status checks on start)
      await this.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "app_licenses" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "license_key" TEXT NOT NULL,
          "expires_at" DATETIME,
          "is_active" INTEGER NOT NULL DEFAULT 1,
          "is_demo" INTEGER NOT NULL DEFAULT 0,
          "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updated_at" DATETIME NOT NULL
        );
      `);

      // Ensure daily_z_reports table exists
      await this.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "daily_z_reports" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "generated_by_id" TEXT NOT NULL,
          "generated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "total_expected" REAL NOT NULL,
          "total_declared" REAL NOT NULL,
          "difference_total" REAL NOT NULL,
          "summary" TEXT,
          CONSTRAINT "daily_z_reports_generated_by_id_fkey" FOREIGN KEY ("generated_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
        );
      `);

      // Ensure surcharges table exists
      await this.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "surcharges" (
          "id" TEXT NOT NULL PRIMARY KEY,
          "category_id" TEXT NOT NULL UNIQUE,
          "percentage" REAL NOT NULL DEFAULT 0,
          "payment_methods" TEXT NOT NULL,
          "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updated_at" DATETIME NOT NULL,
          CONSTRAINT "surcharges_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
        );
      `);

      // Z Report Auto-Migrations
      const sessionColumns: any[] = await this.$queryRawUnsafe(`PRAGMA table_info(cash_register_sessions);`);
      const hasZReportId = sessionColumns.some(c => c.name === 'z_report_id');
      if (!hasZReportId) {
        console.log('[PrismaService] Auto-migrating cash_register_sessions table: adding z_report_id...');
        await this.$executeRawUnsafe(`ALTER TABLE cash_register_sessions ADD COLUMN z_report_id TEXT DEFAULT NULL;`);
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
