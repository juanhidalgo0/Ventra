-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_products" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "barcode" TEXT,
    "sku" TEXT,
    "name" TEXT NOT NULL,
    "category_id" TEXT,
    "brand_id" TEXT,
    "supplier_id" TEXT,
    "description" TEXT,
    "image_url" TEXT,
    "cost_price" REAL NOT NULL DEFAULT 0,
    "sale_price" REAL NOT NULL,
    "stock" REAL NOT NULL DEFAULT 0,
    "min_stock" REAL NOT NULL DEFAULT 0,
    "unit" TEXT NOT NULL DEFAULT 'UNIT',
    "presentation_type" TEXT NOT NULL DEFAULT 'UNIT',
    "units_per_pack" INTEGER NOT NULL DEFAULT 1,
    "tax_rate" REAL NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_favorite" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "products_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_products" ("barcode", "brand_id", "category_id", "cost_price", "created_at", "description", "id", "image_url", "is_active", "is_favorite", "min_stock", "name", "sale_price", "sku", "stock", "supplier_id", "tax_rate", "unit", "updated_at") SELECT "barcode", "brand_id", "category_id", "cost_price", "created_at", "description", "id", "image_url", "is_active", "is_favorite", "min_stock", "name", "sale_price", "sku", "stock", "supplier_id", "tax_rate", "unit", "updated_at" FROM "products";
DROP TABLE "products";
ALTER TABLE "new_products" RENAME TO "products";
CREATE UNIQUE INDEX "products_barcode_key" ON "products"("barcode");
CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");
CREATE INDEX "products_name_idx" ON "products"("name");
CREATE INDEX "products_barcode_idx" ON "products"("barcode");
CREATE INDEX "products_category_id_idx" ON "products"("category_id");
CREATE INDEX "products_brand_id_idx" ON "products"("brand_id");
CREATE INDEX "products_supplier_id_idx" ON "products"("supplier_id");
CREATE TABLE "new_purchase_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "purchase_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "quantity" REAL NOT NULL,
    "cost" REAL NOT NULL,
    "total" REAL NOT NULL,
    "buy_format" TEXT NOT NULL DEFAULT 'UNIT',
    CONSTRAINT "purchase_items_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "purchase_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_purchase_items" ("cost", "id", "product_id", "product_name", "purchase_id", "quantity", "total") SELECT "cost", "id", "product_id", "product_name", "purchase_id", "quantity", "total" FROM "purchase_items";
DROP TABLE "purchase_items";
ALTER TABLE "new_purchase_items" RENAME TO "purchase_items";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
