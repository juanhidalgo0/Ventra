-- CreateTable
CREATE TABLE "daily_z_reports" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "generated_by_id" TEXT NOT NULL,
    "generated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_expected" REAL NOT NULL,
    "total_declared" REAL NOT NULL,
    "difference_total" REAL NOT NULL,
    "summary" TEXT,
    CONSTRAINT "daily_z_reports_generated_by_id_fkey" FOREIGN KEY ("generated_by_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "marketing_groups" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "marketing_group_items" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketing_group_id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "marketing_group_items_marketing_group_id_fkey" FOREIGN KEY ("marketing_group_id") REFERENCES "marketing_groups" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "marketing_group_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "surcharges" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category_id" TEXT NOT NULL,
    "percentage" REAL NOT NULL DEFAULT 0,
    "payment_methods" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "surcharges_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_cash_register_sessions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "terminal_name" TEXT NOT NULL,
    "opening_amount" REAL NOT NULL,
    "closing_amount_expected" REAL,
    "closing_amount_counted" REAL,
    "difference" REAL,
    "opening_notes" TEXT,
    "closing_notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "closing_summary" TEXT,
    "opened_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" DATETIME,
    "z_report_id" TEXT,
    CONSTRAINT "cash_register_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "cash_register_sessions_z_report_id_fkey" FOREIGN KEY ("z_report_id") REFERENCES "daily_z_reports" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_cash_register_sessions" ("closed_at", "closing_amount_counted", "closing_amount_expected", "closing_notes", "closing_summary", "difference", "id", "opened_at", "opening_amount", "opening_notes", "status", "terminal_name", "user_id") SELECT "closed_at", "closing_amount_counted", "closing_amount_expected", "closing_notes", "closing_summary", "difference", "id", "opened_at", "opening_amount", "opening_notes", "status", "terminal_name", "user_id" FROM "cash_register_sessions";
DROP TABLE "cash_register_sessions";
ALTER TABLE "new_cash_register_sessions" RENAME TO "cash_register_sessions";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "marketing_group_items_marketing_group_id_idx" ON "marketing_group_items"("marketing_group_id");

-- CreateIndex
CREATE INDEX "marketing_group_items_product_id_idx" ON "marketing_group_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "surcharges_category_id_key" ON "surcharges"("category_id");
