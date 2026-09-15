import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super({
      log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
    });
  }

  private initPromise: Promise<void> | null = null;

  async onModuleInit() {
    await this.ensureInitialized();
  }

  async ensureInitialized() {
    if (!this.initPromise) {
      this.initPromise = (async () => {
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
              cleanPath = path.resolve(__dirname, '../../prisma', cleanPath);
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

        // Apply SQLite High Performance Pragmas (WAL mode, cache in RAM, normal sync, busy timeout)
        try {
          await this.$queryRawUnsafe(`PRAGMA journal_mode = WAL;`);
          await this.$queryRawUnsafe(`PRAGMA synchronous = NORMAL;`);
          await this.$queryRawUnsafe(`PRAGMA busy_timeout = 5000;`);
          await this.$queryRawUnsafe(`PRAGMA cache_size = -64000;`);
          await this.$queryRawUnsafe(`PRAGMA temp_store = MEMORY;`);
          console.log('[PrismaService] SQLite optimizado con éxito (WAL mode + 64MB RAM Cache).');
        } catch (pragmaErr) {
          console.warn('[PrismaService] Could not apply SQLite PRAGMAs:', pragmaErr);
        }

        // Automatically sync schema on startup only if it's a fresh database without tables
        try {
          const tableCheck: any[] = await this.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table' AND name='users';`);
          const isFreshDb = !tableCheck || tableCheck.length === 0;

          if (isFreshDb) {
            const path = require('path');
            const fs = require('fs');
            const parts = ['..', '..', 'node_modules', 'prisma', 'build', 'index.js'];
            const prismaCliPath = path.resolve(__dirname, ...parts);
            
            if (fs.existsSync(prismaCliPath)) {
              const { execSync } = require('child_process');
              console.log('[PrismaService] Base de datos vacía detectada. Inicializando esquema...');
              execSync(`node "${prismaCliPath}" db push --accept-data-loss --skip-generate`, {
                cwd: path.resolve(__dirname, '../..'),
                stdio: 'inherit'
              });
              console.log('[PrismaService] Sincronización de esquema inicial finalizada con éxito.');
            }
          }
        } catch (err: any) {
          console.error('[PrismaService] Error al verificar esquema en inicio:', err.message);
        }

        // 1. Ensure app_licenses table exists first (for license status checks on start)
        try {
          await this.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "app_licenses" (
              "id" TEXT NOT NULL PRIMARY KEY,
              "licenseKey" TEXT NOT NULL DEFAULT '',
              "machineUuid" TEXT NOT NULL DEFAULT '',
              "expiresAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              "lastCheckedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
          `);
        } catch (err) {
          console.error('[PrismaService] Failed to ensure app_licenses table:', err);
        }

        // 2. Auto-migrate products table if it exists
        try {
          const tableCheck: any[] = await this.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table' AND name='products';`);
          if (tableCheck.length > 0) {
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
            const hasLocation = productColumns.some(c => c.name === 'location');
            if (!hasLocation) {
              console.log('[PrismaService] Auto-migrating products table: adding location...');
              await this.$executeRawUnsafe(`ALTER TABLE products ADD COLUMN location TEXT DEFAULT NULL;`);
            }
            const hasWholesalePrice = productColumns.some(c => c.name === 'wholesale_price');
            if (!hasWholesalePrice) {
              console.log('[PrismaService] Auto-migrating products table: adding wholesale_price...');
              await this.$executeRawUnsafe(`ALTER TABLE products ADD COLUMN wholesale_price REAL DEFAULT NULL;`);
            }
            const hasWholesaleMinQty = productColumns.some(c => c.name === 'wholesale_min_qty');
            if (!hasWholesaleMinQty) {
              console.log('[PrismaService] Auto-migrating products table: adding wholesale_min_qty...');
              await this.$executeRawUnsafe(`ALTER TABLE products ADD COLUMN wholesale_min_qty REAL DEFAULT NULL;`);
            }
            const hasTradePrice = productColumns.some(c => c.name === 'trade_price');
            if (!hasTradePrice) {
              console.log('[PrismaService] Auto-migrating products table: adding trade_price...');
              await this.$executeRawUnsafe(`ALTER TABLE products ADD COLUMN trade_price REAL DEFAULT NULL;`);
            }
            const hasIsKit = productColumns.some(c => c.name === 'is_kit');
            if (!hasIsKit) {
              console.log('[PrismaService] Auto-migrating products table: adding is_kit...');
              await this.$executeRawUnsafe(`ALTER TABLE products ADD COLUMN is_kit INTEGER NOT NULL DEFAULT 0;`);
            }
            const hasEquivalents = productColumns.some(c => c.name === 'equivalents');
            if (!hasEquivalents) {
              console.log('[PrismaService] Auto-migrating products table: adding equivalents...');
              await this.$executeRawUnsafe(`ALTER TABLE products ADD COLUMN equivalents TEXT DEFAULT NULL;`);
            }
            const hasPieceSize = productColumns.some(c => c.name === 'piece_size');
            if (!hasPieceSize) {
              console.log('[PrismaService] Auto-migrating products table: adding piece_size...');
              await this.$executeRawUnsafe(`ALTER TABLE products ADD COLUMN piece_size REAL DEFAULT NULL;`);
            }
          }
        } catch (err) {
          console.error('[PrismaService] Failed to auto-migrate products table:', err);
        }

        // 2.1 Auto-migrate sales table if it exists
        try {
          const tableCheck: any[] = await this.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table' AND name='sales';`);
          if (tableCheck.length > 0) {
            const saleColumns: any[] = await this.$queryRawUnsafe(`PRAGMA table_info(sales);`);
            const hasPickedUpBy = saleColumns.some(c => c.name === 'picked_up_by');
            if (!hasPickedUpBy) {
              console.log('[PrismaService] Auto-migrating sales table: adding picked_up_by...');
              await this.$executeRawUnsafe(`ALTER TABLE sales ADD COLUMN picked_up_by TEXT DEFAULT NULL;`);
            }
            const hasIsAcopio = saleColumns.some(c => c.name === 'is_acopio');
            if (!hasIsAcopio) {
              console.log('[PrismaService] Auto-migrating sales table: adding is_acopio...');
              await this.$executeRawUnsafe(`ALTER TABLE sales ADD COLUMN is_acopio INTEGER NOT NULL DEFAULT 0;`);
            }
            const hasAcopioStatus = saleColumns.some(c => c.name === 'acopio_status');
            if (!hasAcopioStatus) {
              console.log('[PrismaService] Auto-migrating sales table: adding acopio_status...');
              await this.$executeRawUnsafe(`ALTER TABLE sales ADD COLUMN acopio_status TEXT NOT NULL DEFAULT 'NONE';`);
            }
          }
        } catch (err) {
          console.error('[PrismaService] Failed to auto-migrate sales table:', err);
        }

        // 2.2 Auto-migrate sale_items table if it exists
        try {
          const tableCheck: any[] = await this.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table' AND name='sale_items';`);
          if (tableCheck.length > 0) {
            const saleItemColumns: any[] = await this.$queryRawUnsafe(`PRAGMA table_info(sale_items);`);
            const hasDeliveredQuantity = saleItemColumns.some(c => c.name === 'delivered_quantity');
            if (!hasDeliveredQuantity) {
              console.log('[PrismaService] Auto-migrating sale_items table: adding delivered_quantity...');
              await this.$executeRawUnsafe(`ALTER TABLE sale_items ADD COLUMN delivered_quantity REAL NOT NULL DEFAULT 0;`);
            }
          }
        } catch (err) {
          console.error('[PrismaService] Failed to auto-migrate sale_items table:', err);
        }

        // 2.3 Auto-migrate clients table if it exists
        try {
          const tableCheck: any[] = await this.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table' AND name='clients';`);
          if (tableCheck.length > 0) {
            const clientColumns: any[] = await this.$queryRawUnsafe(`PRAGMA table_info(clients);`);
            const hasCreditLimit = clientColumns.some(c => c.name === 'credit_limit');
            if (!hasCreditLimit) {
              console.log('[PrismaService] Auto-migrating clients table: adding credit_limit...');
              await this.$executeRawUnsafe(`ALTER TABLE clients ADD COLUMN credit_limit REAL DEFAULT NULL;`);
            }
            const hasAuthorizedPickups = clientColumns.some(c => c.name === 'authorized_pickups');
            if (!hasAuthorizedPickups) {
              console.log('[PrismaService] Auto-migrating clients table: adding authorized_pickups...');
              await this.$executeRawUnsafe(`ALTER TABLE clients ADD COLUMN authorized_pickups TEXT DEFAULT NULL;`);
            }
            const hasPriceList = clientColumns.some(c => c.name === 'price_list');
            if (!hasPriceList) {
              console.log('[PrismaService] Auto-migrating clients table: adding price_list...');
              await this.$executeRawUnsafe(`ALTER TABLE clients ADD COLUMN price_list TEXT NOT NULL DEFAULT 'RETAIL';`);
            }
            const hasTradeDiscountPercentage = clientColumns.some(c => c.name === 'trade_discount_percentage');
            if (!hasTradeDiscountPercentage) {
              console.log('[PrismaService] Auto-migrating clients table: adding trade_discount_percentage...');
              await this.$executeRawUnsafe(`ALTER TABLE clients ADD COLUMN trade_discount_percentage REAL DEFAULT NULL;`);
            }
          }
        } catch (err) {
          console.error('[PrismaService] Failed to auto-migrate clients table:', err);
        }

        // 2.4 Auto-migrate account_movements table if it exists
        try {
          const tableCheck: any[] = await this.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table' AND name='account_movements';`);
          if (tableCheck.length > 0) {
            const movementColumns: any[] = await this.$queryRawUnsafe(`PRAGMA table_info(account_movements);`);
            const hasPickedUpBy = movementColumns.some(c => c.name === 'picked_up_by');
            if (!hasPickedUpBy) {
              console.log('[PrismaService] Auto-migrating account_movements table: adding picked_up_by...');
              await this.$executeRawUnsafe(`ALTER TABLE account_movements ADD COLUMN picked_up_by TEXT DEFAULT NULL;`);
            }
          }
        } catch (err) {
          console.error('[PrismaService] Failed to auto-migrate account_movements table:', err);
        }

        // 2.5 Ensure quotes / quote_items tables exist
        try {
          await this.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "quotes" (
              "id" TEXT NOT NULL PRIMARY KEY,
              "quote_number" TEXT,
              "client_name" TEXT,
              "client_phone" TEXT,
              "user_id" TEXT NOT NULL,
              "total" REAL NOT NULL,
              "status" TEXT NOT NULL DEFAULT 'PENDING',
              "valid_until" DATETIME,
              "notes" TEXT,
              "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              "updated_at" DATETIME NOT NULL,
              CONSTRAINT "quotes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
            );
          `);
          await this.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "quotes_quote_number_key" ON "quotes"("quote_number");`);
          await this.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "quote_items" (
              "id" TEXT NOT NULL PRIMARY KEY,
              "quote_id" TEXT NOT NULL,
              "product_id" TEXT,
              "product_name" TEXT NOT NULL,
              "unit_price" REAL NOT NULL,
              "quantity" REAL NOT NULL,
              "subtotal" REAL NOT NULL,
              CONSTRAINT "quote_items_quote_id_fkey" FOREIGN KEY ("quote_id") REFERENCES "quotes" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
              CONSTRAINT "quote_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE SET NULL ON UPDATE CASCADE
            );
          `);
        } catch (err) {
          console.error('[PrismaService] Failed to ensure quotes tables:', err);
        }

        // 2.6 Ensure product_kit_items table exists
        try {
          await this.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "product_kit_items" (
              "id" TEXT NOT NULL PRIMARY KEY,
              "parent_product_id" TEXT NOT NULL,
              "child_product_id" TEXT NOT NULL,
              "quantity" REAL NOT NULL DEFAULT 1,
              CONSTRAINT "product_kit_items_parent_product_id_fkey" FOREIGN KEY ("parent_product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
              CONSTRAINT "product_kit_items_child_product_id_fkey" FOREIGN KEY ("child_product_id") REFERENCES "products" ("id") ON DELETE CASCADE ON UPDATE CASCADE
            );
          `);
        } catch (err) {
          console.error('[PrismaService] Failed to ensure product_kit_items table:', err);
        }

        // 2.7 Ensure delivery_receipts / delivery_receipt_items tables exist
        try {
          await this.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "delivery_receipts" (
              "id" TEXT NOT NULL PRIMARY KEY,
              "remito_number" INTEGER NOT NULL,
              "sale_id" TEXT NOT NULL,
              "client_id" TEXT,
              "receiver_name" TEXT,
              "driver_name" TEXT,
              "delivery_address" TEXT,
              "notes" TEXT,
              "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              CONSTRAINT "delivery_receipts_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
              CONSTRAINT "delivery_receipts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients" ("id") ON DELETE SET NULL ON UPDATE CASCADE
            );
          `);
          await this.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "delivery_receipts_remito_number_key" ON "delivery_receipts"("remito_number");`);
          await this.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "delivery_receipt_items" (
              "id" TEXT NOT NULL PRIMARY KEY,
              "delivery_receipt_id" TEXT NOT NULL,
              "product_id" TEXT NOT NULL,
              "product_name" TEXT NOT NULL,
              "quantity" REAL NOT NULL,
              CONSTRAINT "delivery_receipt_items_delivery_receipt_id_fkey" FOREIGN KEY ("delivery_receipt_id") REFERENCES "delivery_receipts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
              CONSTRAINT "delivery_receipt_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
            );
          `);
        } catch (err) {
          console.error('[PrismaService] Failed to ensure delivery_receipts tables:', err);
        }

        // 3. Auto-migrate purchase_items table if it exists
        try {
          const tableCheck: any[] = await this.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table' AND name='purchase_items';`);
          if (tableCheck.length > 0) {
            const purchaseItemColumns: any[] = await this.$queryRawUnsafe(`PRAGMA table_info(purchase_items);`);
            const hasBuyFormat = purchaseItemColumns.some(c => c.name === 'buy_format');
            if (!hasBuyFormat) {
              console.log('[PrismaService] Auto-migrating purchase_items table: adding buy_format...');
              await this.$executeRawUnsafe(`ALTER TABLE purchase_items ADD COLUMN buy_format TEXT NOT NULL DEFAULT 'UNIT';`);
            }
          }
        } catch (err) {
          console.error('[PrismaService] Failed to auto-migrate purchase_items table:', err);
        }

        // 4. Auto-migrate categories table if it exists
        try {
          const tableCheck: any[] = await this.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table' AND name='categories';`);
          if (tableCheck.length > 0) {
            const categoryColumns: any[] = await this.$queryRawUnsafe(`PRAGMA table_info(categories);`);
            const hasParentCategoryId = categoryColumns.some(c => c.name === 'parent_category_id');
            if (!hasParentCategoryId) {
              console.log('[PrismaService] Auto-migrating categories table: adding parent_category_id...');
              await this.$executeRawUnsafe(`ALTER TABLE categories ADD COLUMN parent_category_id TEXT DEFAULT NULL;`);
            }
          }
        } catch (err) {
          console.error('[PrismaService] Failed to auto-migrate categories table:', err);
        }

        // 5. Ensure daily_z_reports table exists
        try {
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
        } catch (err) {
          console.error('[PrismaService] Failed to ensure daily_z_reports table:', err);
        }

        // 6. Ensure surcharges table exists
        try {
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
        } catch (err) {
          console.error('[PrismaService] Failed to ensure surcharges table:', err);
        }

        // 7. Auto-migrate cash_register_sessions table if it exists
        try {
          const tableCheck: any[] = await this.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table' AND name='cash_register_sessions';`);
          if (tableCheck.length > 0) {
            const sessionColumns: any[] = await this.$queryRawUnsafe(`PRAGMA table_info(cash_register_sessions);`);
            const hasZReportId = sessionColumns.some(c => c.name === 'z_report_id');
            if (!hasZReportId) {
              console.log('[PrismaService] Auto-migrating cash_register_sessions table: adding z_report_id...');
              await this.$executeRawUnsafe(`ALTER TABLE cash_register_sessions ADD COLUMN z_report_id TEXT DEFAULT NULL;`);
            }
          }
        } catch (err) {
          console.error('[PrismaService] Failed to auto-migrate cash_register_sessions table:', err);
        }

        // 8. Auto-migrate promotion_products table if it exists
        try {
          const tableCheck: any[] = await this.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table' AND name='promotion_products';`);
          if (tableCheck.length > 0) {
            const promoProdColumns: any[] = await this.$queryRawUnsafe(`PRAGMA table_info(promotion_products);`);
            const hasGroupId = promoProdColumns.some(c => c.name === 'group_id');
            if (!hasGroupId) {
              console.log('[PrismaService] Auto-migrating promotion_products table: adding group_id...');
              await this.$executeRawUnsafe(`ALTER TABLE promotion_products ADD COLUMN group_id TEXT DEFAULT NULL;`);
            }
          }
        } catch (err) {
          console.error('[PrismaService] Failed to auto-migrate promotion_products table:', err);
        }

        // 8.1 Auto-migrate promotions table if it exists
        try {
          const tableCheck: any[] = await this.$queryRawUnsafe(`SELECT name FROM sqlite_master WHERE type='table' AND name='promotions';`);
          if (tableCheck.length > 0) {
            const promoColumns: any[] = await this.$queryRawUnsafe(`PRAGMA table_info(promotions);`);
            const hasCode = promoColumns.some(c => c.name === 'code');
            if (!hasCode) {
              console.log('[PrismaService] Auto-migrating promotions table: adding code...');
              await this.$executeRawUnsafe(`ALTER TABLE promotions ADD COLUMN code TEXT DEFAULT NULL;`);
              await this.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "promotions_code_key" ON "promotions"("code");`);
            }
            const hasLimitType = promoColumns.some(c => c.name === 'limit_type');
            if (!hasLimitType) {
              await this.$executeRawUnsafe(`ALTER TABLE promotions ADD COLUMN limit_type TEXT NOT NULL DEFAULT 'NONE';`);
            }
            const hasLimitStock = promoColumns.some(c => c.name === 'limit_stock');
            if (!hasLimitStock) {
              await this.$executeRawUnsafe(`ALTER TABLE promotions ADD COLUMN limit_stock REAL DEFAULT NULL;`);
            }
            const hasSoldStock = promoColumns.some(c => c.name === 'sold_stock');
            if (!hasSoldStock) {
              await this.$executeRawUnsafe(`ALTER TABLE promotions ADD COLUMN sold_stock REAL NOT NULL DEFAULT 0;`);
            }
            const hasStartDate = promoColumns.some(c => c.name === 'start_date');
            if (!hasStartDate) {
              await this.$executeRawUnsafe(`ALTER TABLE promotions ADD COLUMN start_date DATETIME DEFAULT NULL;`);
            }
            const hasEndDate = promoColumns.some(c => c.name === 'end_date');
            if (!hasEndDate) {
              await this.$executeRawUnsafe(`ALTER TABLE promotions ADD COLUMN end_date DATETIME DEFAULT NULL;`);
            }
          }
        } catch (err) {
          console.error('[PrismaService] Failed to auto-migrate promotions table:', err);
        }

        // 9. Ensure marketing_groups table exists
        try {
          await this.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "marketing_groups" (
              "id" TEXT NOT NULL PRIMARY KEY,
              "name" TEXT NOT NULL,
              "description" TEXT,
              "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
            );
          `);
        } catch (err) {
          console.error('[PrismaService] Failed to ensure marketing_groups table:', err);
        }

        // 10. Ensure marketing_group_items table exists
        try {
          await this.$executeRawUnsafe(`
            CREATE TABLE IF NOT EXISTS "marketing_group_items" (
              "id" TEXT NOT NULL PRIMARY KEY,
              "marketing_group_id" TEXT NOT NULL,
              "product_id" TEXT NOT NULL,
              "order" INTEGER NOT NULL DEFAULT 0,
              "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              CONSTRAINT "marketing_group_items_marketing_group_id_fkey" FOREIGN KEY ("marketing_group_id") REFERENCES "marketing_groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
              CONSTRAINT "marketing_group_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
            );
          `);
          await this.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "marketing_group_items_marketing_group_id_idx" ON "marketing_group_items"("marketing_group_id");`);
          await this.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "marketing_group_items_product_id_idx" ON "marketing_group_items"("product_id");`);
        } catch (err) {
          console.error('[PrismaService] Failed to ensure marketing_group_items table:', err);
        }

        // 11. Ensure critical indexes exist for fast queries and joins (isolated so each is guaranteed)
        const indexStatements = [
          `CREATE INDEX IF NOT EXISTS "sale_items_product_id_idx" ON "sale_items"("product_id");`,
          `CREATE INDEX IF NOT EXISTS "sale_items_sale_id_idx" ON "sale_items"("sale_id");`,
          `CREATE INDEX IF NOT EXISTS "payments_sale_id_idx" ON "payments"("sale_id");`,
          `CREATE INDEX IF NOT EXISTS "cash_movements_session_id_idx" ON "cash_movements"("session_id");`,
          `CREATE INDEX IF NOT EXISTS "cash_sessions_status_idx" ON "cash_register_sessions"("status");`,
          `CREATE INDEX IF NOT EXISTS "sales_status_idx" ON "sales"("status");`,
          `CREATE INDEX IF NOT EXISTS "sales_client_id_idx" ON "sales"("client_id");`,
          `CREATE INDEX IF NOT EXISTS "products_stock_min_idx" ON "products"("stock", "min_stock");`,
          `CREATE INDEX IF NOT EXISTS "product_barcodes_product_id_idx" ON "product_barcodes"("product_id");`,
          `CREATE INDEX IF NOT EXISTS "purchase_items_purchase_id_idx" ON "purchase_items"("purchase_id");`,
          `CREATE INDEX IF NOT EXISTS "purchase_items_product_id_idx" ON "purchase_items"("product_id");`,
          `CREATE INDEX IF NOT EXISTS "purchases_supplier_id_idx" ON "purchases"("supplier_id");`,
          `CREATE INDEX IF NOT EXISTS "purchases_created_at_idx" ON "purchases"("created_at");`,
          `CREATE INDEX IF NOT EXISTS "price_history_product_id_idx" ON "price_history"("product_id");`,
          `CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx" ON "audit_logs"("created_at");`,
          `CREATE INDEX IF NOT EXISTS "audit_logs_entity_type_idx" ON "audit_logs"("entity_type");`,
          `CREATE INDEX IF NOT EXISTS "sales_client_id_idx" ON "sales"("client_id");`,
          `CREATE INDEX IF NOT EXISTS "quotes_status_idx" ON "quotes"("status");`,
          `CREATE INDEX IF NOT EXISTS "quotes_created_at_idx" ON "quotes"("created_at");`,
          `CREATE INDEX IF NOT EXISTS "quote_items_quote_id_idx" ON "quote_items"("quote_id");`,
          `CREATE INDEX IF NOT EXISTS "product_kit_items_parent_product_id_idx" ON "product_kit_items"("parent_product_id");`,
          `CREATE INDEX IF NOT EXISTS "product_kit_items_child_product_id_idx" ON "product_kit_items"("child_product_id");`,
          `CREATE INDEX IF NOT EXISTS "delivery_receipts_sale_id_idx" ON "delivery_receipts"("sale_id");`,
          `CREATE INDEX IF NOT EXISTS "delivery_receipts_client_id_idx" ON "delivery_receipts"("client_id");`,
          `CREATE INDEX IF NOT EXISTS "delivery_receipts_created_at_idx" ON "delivery_receipts"("created_at");`,
          `CREATE INDEX IF NOT EXISTS "delivery_receipt_items_delivery_receipt_id_idx" ON "delivery_receipt_items"("delivery_receipt_id");`,
          `CREATE INDEX IF NOT EXISTS "delivery_receipt_items_product_id_idx" ON "delivery_receipt_items"("product_id");`
        ];
        for (const sql of indexStatements) {
          try {
            await this.$executeRawUnsafe(sql);
          } catch (indexErr) {
            console.warn('[PrismaService] Index notice:', indexErr);
          }
        }

        try {
          // Optimize SQLite performance for low-end machines (WAL mode, cache size, synchronous normal, temp store memory)
          await this.$queryRawUnsafe(`PRAGMA journal_mode = WAL;`);
          await this.$queryRawUnsafe(`PRAGMA synchronous = NORMAL;`);
          await this.$queryRawUnsafe(`PRAGMA busy_timeout = 5000;`);
          await this.$queryRawUnsafe(`PRAGMA cache_size = -64000;`); // 64MB Cache in RAM
          await this.$queryRawUnsafe(`PRAGMA temp_store = MEMORY;`);
          await this.$queryRawUnsafe(`PRAGMA wal_autocheckpoint = 1000;`); // Auto-checkpoint every 4MB
          
          // Truncate any bloated WAL logs back to 0 bytes on boot (instant, non-locking)
          await this.$queryRawUnsafe(`PRAGMA wal_checkpoint(TRUNCATE);`);
          
          // Optimize index stats without locking the database file
          this.$executeRawUnsafe(`ANALYZE;`).catch((e) => console.error('Error running ANALYZE:', e));
        } catch (err) {
          console.error('Failed to apply SQLite PRAGMAs:', err);
        }
      })();
    }
    await this.initPromise;
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
