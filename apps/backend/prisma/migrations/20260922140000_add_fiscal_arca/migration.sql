-- AlterTable: datos del comprobante electrónico en cada venta
ALTER TABLE "sales" ADD COLUMN "invoice_status" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "sales" ADD COLUMN "invoice_type" TEXT;
ALTER TABLE "sales" ADD COLUMN "invoice_cbte_tipo" INTEGER;
ALTER TABLE "sales" ADD COLUMN "invoice_point_of_sale" INTEGER;
ALTER TABLE "sales" ADD COLUMN "invoice_number" INTEGER;
ALTER TABLE "sales" ADD COLUMN "cae" TEXT;
ALTER TABLE "sales" ADD COLUMN "cae_expires_at" DATETIME;
ALTER TABLE "sales" ADD COLUMN "invoice_date" DATETIME;
ALTER TABLE "sales" ADD COLUMN "invoice_requested_at" DATETIME;
ALTER TABLE "sales" ADD COLUMN "invoice_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sales" ADD COLUMN "invoice_error" TEXT;
ALTER TABLE "sales" ADD COLUMN "receptor_doc_tipo" INTEGER;
ALTER TABLE "sales" ADD COLUMN "receptor_doc_nro" TEXT;
ALTER TABLE "sales" ADD COLUMN "receptor_name" TEXT;
ALTER TABLE "sales" ADD COLUMN "receptor_iva_condition" TEXT;
CREATE INDEX "sales_invoice_status_idx" ON "sales"("invoice_status");

-- AlterTable: CUIT y condición frente al IVA del cliente
ALTER TABLE "clients" ADD COLUMN "cuit" TEXT;
ALTER TABLE "clients" ADD COLUMN "iva_condition" TEXT NOT NULL DEFAULT 'CONSUMIDOR_FINAL';

-- CreateTable
CREATE TABLE "fiscal_config" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'fiscal_config',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "cuit" TEXT NOT NULL DEFAULT '',
    "razon_social" TEXT NOT NULL DEFAULT '',
    "iva_condition" TEXT NOT NULL DEFAULT 'MONOTRIBUTO',
    "point_of_sale" INTEGER NOT NULL DEFAULT 1,
    "environment" TEXT NOT NULL DEFAULT 'HOMOLOGACION',
    "cert_source" TEXT NOT NULL DEFAULT 'DELEGATED',
    "cert_pem" TEXT,
    "key_pem" TEXT,
    "cert_expires_at" DATETIME,
    "auto_invoice" BOOLEAN NOT NULL DEFAULT false,
    "start_date" DATETIME,
    "last_error" TEXT,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "fiscal_tokens" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "cuit" TEXT NOT NULL,
    "service" TEXT NOT NULL DEFAULT 'wsfe',
    "environment" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "sign" TEXT NOT NULL,
    "expires_at" DATETIME NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "fiscal_tokens_cuit_service_environment_key" ON "fiscal_tokens"("cuit", "service", "environment");
