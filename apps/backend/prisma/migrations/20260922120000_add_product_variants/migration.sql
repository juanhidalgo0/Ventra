-- AlterTable
ALTER TABLE "products" ADD COLUMN "base_name" TEXT;
ALTER TABLE "products" ADD COLUMN "variant_group_id" TEXT;
ALTER TABLE "products" ADD COLUMN "variant_attrs" TEXT;

-- CreateIndex
CREATE INDEX "products_variant_group_id_idx" ON "products"("variant_group_id");
