-- CreateTable
CREATE TABLE "image_suggestions" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_key" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "brand" TEXT,
    "product_ids" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "candidates" TEXT NOT NULL,
    "best_score" REAL NOT NULL DEFAULT 0,
    "confidence" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "chosen_url" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "image_suggestions_family_key_key" ON "image_suggestions"("family_key");

-- CreateIndex
CREATE INDEX "image_suggestions_status_idx" ON "image_suggestions"("status");
