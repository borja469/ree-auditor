CREATE TYPE "CmInvoiceProcessingStatus" AS ENUM ('IMPORTED', 'PROCESSING', 'READY', 'WARNING', 'ERROR');
CREATE TYPE "CmInvoiceConsumptionSource" AS ENUM ('F1', 'F5D', 'PROFILE_FINAL', 'PROFILE_INTERMEDIATE', 'PROFILE_INITIAL', 'MISSING');
CREATE TYPE "CmInvoiceProfileType" AS ENUM ('FINAL', 'INTERMEDIO', 'INICIAL');

CREATE TABLE "cm_invoice_import_batches" (
  "id" UUID NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at" TIMESTAMP(3),
  "execution_time_ms" INTEGER,
  "invoice_date_from" DATE NOT NULL,
  "invoice_date_to" DATE NOT NULL,
  "gisce_pages" INTEGER NOT NULL DEFAULT 0,
  "total_found" INTEGER NOT NULL DEFAULT 0,
  "processed_count" INTEGER NOT NULL DEFAULT 0,
  "created_count" INTEGER NOT NULL DEFAULT 0,
  "updated_count" INTEGER NOT NULL DEFAULT 0,
  "unchanged_count" INTEGER NOT NULL DEFAULT 0,
  "error_count" INTEGER NOT NULL DEFAULT 0,
  "status" VARCHAR(30) NOT NULL DEFAULT 'RUNNING',
  "message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cm_invoice_import_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cm_invoices" (
  "id" UUID NOT NULL,
  "gisce_invoice_id" INTEGER NOT NULL,
  "invoice_number" VARCHAR(120),
  "cups_gisce_id" INTEGER,
  "cups" VARCHAR(30) NOT NULL,
  "polissa_id" INTEGER,
  "polissa_number" VARCHAR(120),
  "invoice_date" DATE,
  "period_start" DATE,
  "period_end" DATE,
  "tariff_code" VARCHAR(20),
  "processing_status" "CmInvoiceProcessingStatus" NOT NULL DEFAULT 'IMPORTED',
  "processing_message" TEXT,
  "expected_intervals" INTEGER NOT NULL DEFAULT 0,
  "f1_intervals" INTEGER NOT NULL DEFAULT 0,
  "f5d_intervals" INTEGER NOT NULL DEFAULT 0,
  "profiled_intervals" INTEGER NOT NULL DEFAULT 0,
  "missing_intervals" INTEGER NOT NULL DEFAULT 0,
  "reconciliation_issues" JSONB,
  "raw_payload_json" JSONB NOT NULL,
  "import_batch_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cm_invoices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cm_invoice_lines" (
  "id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "gisce_line_id" INTEGER NOT NULL,
  "account_id" INTEGER,
  "account_name" VARCHAR(255),
  "line_name" VARCHAR(120),
  "quantity" DECIMAL(24,6),
  "price_unit" DECIMAL(24,10),
  "price_subtotal" DECIMAL(24,6),
  "raw_payload_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cm_invoice_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cm_invoice_curve_f1_raw" (
  "id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "gisce_source_id" INTEGER NOT NULL,
  "cups" VARCHAR(30) NOT NULL,
  "datetime" TIMESTAMP(3) NOT NULL,
  "ai" DECIMAL(24,6),
  "ao" DECIMAL(24,6),
  "r1" DECIMAL(24,6),
  "r2" DECIMAL(24,6),
  "r3" DECIMAL(24,6),
  "r4" DECIMAL(24,6),
  "measure_type" INTEGER,
  "source" INTEGER,
  "validated" BOOLEAN,
  "gisce_create_at" TIMESTAMP(3),
  "gisce_update_at" TIMESTAMP(3),
  "raw_data" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cm_invoice_curve_f1_raw_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cm_invoice_curve_f5d_raw" (
  "id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "gisce_source_id" INTEGER NOT NULL,
  "cups" VARCHAR(30) NOT NULL,
  "datetime" TIMESTAMP(3) NOT NULL,
  "ai" DECIMAL(24,6),
  "ao" DECIMAL(24,6),
  "ai_fix" BOOLEAN,
  "ao_fix" BOOLEAN,
  "bill" VARCHAR(120),
  "r1" DECIMAL(24,6),
  "r2" DECIMAL(24,6),
  "r3" DECIMAL(24,6),
  "r4" DECIMAL(24,6),
  "source" INTEGER,
  "validated" BOOLEAN,
  "gisce_create_at" TIMESTAMP(3),
  "gisce_update_at" TIMESTAMP(3),
  "raw_data" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cm_invoice_curve_f5d_raw_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cm_invoice_consumption_curve" (
  "id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "cups" VARCHAR(30) NOT NULL,
  "datetime" TIMESTAMP(3) NOT NULL,
  "resolution_minutes" INTEGER NOT NULL,
  "tariff_period" VARCHAR(5) NOT NULL,
  "consumption_meter_kwh" DECIMAL(24,6),
  "consumption_pf_kwh" DECIMAL(24,6),
  "consumption_bc_kwh" DECIMAL(24,6),
  "loss_percentage" DECIMAL(12,6),
  "loss_version" VARCHAR(40),
  "loss_source_id" TEXT,
  "consumption_source" "CmInvoiceConsumptionSource" NOT NULL,
  "profile_type" "CmInvoiceProfileType",
  "profile_version_id" VARCHAR(80),
  "profile_row_id" VARCHAR(80),
  "source_raw_id" UUID,
  "validation_status" VARCHAR(30) NOT NULL DEFAULT 'OK',
  "validation_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cm_invoice_consumption_curve_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cm_gisce_config" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "base_url" VARCHAR(1000),
  "username" VARCHAR(255),
  "password_encrypted" TEXT,
  "timeout_ms" INTEGER NOT NULL DEFAULT 60000,
  "invoice_date_field" VARCHAR(120) NOT NULL DEFAULT 'date_invoice',
  "invoice_start_field" VARCHAR(120) NOT NULL DEFAULT 'data_inici',
  "invoice_end_field" VARCHAR(120) NOT NULL DEFAULT 'data_final',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "cm_gisce_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cm_invoices_gisce_invoice_id_key" ON "cm_invoices"("gisce_invoice_id");
CREATE UNIQUE INDEX "cm_invoice_lines_gisce_line_id_key" ON "cm_invoice_lines"("gisce_line_id");
CREATE UNIQUE INDEX "ux_cm_invoice_f1_raw_invoice_source" ON "cm_invoice_curve_f1_raw"("invoice_id", "gisce_source_id");
CREATE UNIQUE INDEX "ux_cm_invoice_f5d_raw_invoice_source" ON "cm_invoice_curve_f5d_raw"("invoice_id", "gisce_source_id");
CREATE UNIQUE INDEX "ux_cm_invoice_curve_invoice_datetime" ON "cm_invoice_consumption_curve"("invoice_id", "datetime");

CREATE INDEX "cm_invoice_import_batches_started_at_idx" ON "cm_invoice_import_batches"("started_at");
CREATE INDEX "cm_invoice_import_batches_invoice_date_from_invoice_date_to_idx" ON "cm_invoice_import_batches"("invoice_date_from", "invoice_date_to");
CREATE INDEX "cm_invoice_import_batches_status_idx" ON "cm_invoice_import_batches"("status");
CREATE INDEX "cm_invoices_cups_idx" ON "cm_invoices"("cups");
CREATE INDEX "cm_invoices_invoice_date_idx" ON "cm_invoices"("invoice_date");
CREATE INDEX "cm_invoices_period_start_period_end_idx" ON "cm_invoices"("period_start", "period_end");
CREATE INDEX "cm_invoices_processing_status_idx" ON "cm_invoices"("processing_status");
CREATE INDEX "cm_invoices_import_batch_id_idx" ON "cm_invoices"("import_batch_id");
CREATE INDEX "cm_invoice_lines_invoice_id_idx" ON "cm_invoice_lines"("invoice_id");
CREATE INDEX "cm_invoice_lines_account_name_idx" ON "cm_invoice_lines"("account_name");
CREATE INDEX "cm_invoice_lines_line_name_idx" ON "cm_invoice_lines"("line_name");
CREATE INDEX "cm_invoice_curve_f1_raw_invoice_id_datetime_idx" ON "cm_invoice_curve_f1_raw"("invoice_id", "datetime");
CREATE INDEX "cm_invoice_curve_f1_raw_cups_datetime_idx" ON "cm_invoice_curve_f1_raw"("cups", "datetime");
CREATE INDEX "cm_invoice_curve_f5d_raw_invoice_id_datetime_idx" ON "cm_invoice_curve_f5d_raw"("invoice_id", "datetime");
CREATE INDEX "cm_invoice_curve_f5d_raw_cups_datetime_idx" ON "cm_invoice_curve_f5d_raw"("cups", "datetime");
CREATE INDEX "cm_invoice_consumption_curve_invoice_id_idx" ON "cm_invoice_consumption_curve"("invoice_id");
CREATE INDEX "cm_invoice_consumption_curve_cups_datetime_idx" ON "cm_invoice_consumption_curve"("cups", "datetime");
CREATE INDEX "cm_invoice_consumption_curve_tariff_period_idx" ON "cm_invoice_consumption_curve"("tariff_period");
CREATE INDEX "cm_invoice_consumption_curve_consumption_source_idx" ON "cm_invoice_consumption_curve"("consumption_source");

ALTER TABLE "cm_invoices" ADD CONSTRAINT "cm_invoices_import_batch_id_fkey" FOREIGN KEY ("import_batch_id") REFERENCES "cm_invoice_import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "cm_invoice_lines" ADD CONSTRAINT "cm_invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "cm_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cm_invoice_curve_f1_raw" ADD CONSTRAINT "cm_invoice_curve_f1_raw_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "cm_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cm_invoice_curve_f5d_raw" ADD CONSTRAINT "cm_invoice_curve_f5d_raw_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "cm_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cm_invoice_consumption_curve" ADD CONSTRAINT "cm_invoice_consumption_curve_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "cm_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
