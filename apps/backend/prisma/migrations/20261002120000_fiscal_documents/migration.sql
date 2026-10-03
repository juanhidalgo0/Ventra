-- AlterTable: datos del comprobante impreso y factura automática
ALTER TABLE "fiscal_config" ADD COLUMN "auto_invoice_since" DATETIME;
ALTER TABLE "fiscal_config" ADD COLUMN "domicilio" TEXT NOT NULL DEFAULT '';
ALTER TABLE "fiscal_config" ADD COLUMN "iibb" TEXT NOT NULL DEFAULT '';
ALTER TABLE "fiscal_config" ADD COLUMN "inicio_actividades" DATETIME;
ALTER TABLE "fiscal_config" ADD COLUMN "default_iva_rate" REAL NOT NULL DEFAULT 21;

-- CreateTable: un comprobante electrónico (factura o nota de crédito) por fila
CREATE TABLE "fiscal_documents" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sale_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "environment" TEXT NOT NULL,
    "emisor_cuit" TEXT NOT NULL,
    "cbte_tipo" INTEGER,
    "invoice_type" TEXT,
    "point_of_sale" INTEGER NOT NULL,
    "number" INTEGER,
    "reserved_number" INTEGER,
    "cae" TEXT,
    "cae_expires_at" DATETIME,
    "issue_date" TEXT,
    "total" REAL NOT NULL DEFAULT 0,
    "neto" REAL NOT NULL DEFAULT 0,
    "iva" REAL NOT NULL DEFAULT 0,
    "iva_detail" TEXT,
    "receptor_doc_tipo" INTEGER NOT NULL DEFAULT 99,
    "receptor_doc_nro" TEXT NOT NULL DEFAULT '0',
    "receptor_name" TEXT,
    "receptor_iva_condition" TEXT NOT NULL DEFAULT 'CONSUMIDOR_FINAL',
    "assoc_document_id" TEXT,
    "reason" TEXT,
    "owner_node" INTEGER NOT NULL DEFAULT 0,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" DATETIME,
    "next_attempt_at" DATETIME,
    "error" TEXT,
    "error_kind" TEXT,
    "observations" TEXT,
    "created_by_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "fiscal_documents_sale_id_fkey" FOREIGN KEY ("sale_id") REFERENCES "sales" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "fiscal_documents_sale_id_idx" ON "fiscal_documents"("sale_id");
CREATE INDEX "fiscal_documents_status_idx" ON "fiscal_documents"("status");
CREATE INDEX "fiscal_documents_created_at_idx" ON "fiscal_documents"("created_at");
