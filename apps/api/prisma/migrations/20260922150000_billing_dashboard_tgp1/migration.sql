ALTER TYPE "CmInvoiceConsumptionSource" ADD VALUE IF NOT EXISTS 'P1';

ALTER TABLE "cm_invoices"
  ADD COLUMN IF NOT EXISTS "p1_intervals" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "cm_invoice_curve_p1_raw" (
  "id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "gisce_source_id" INTEGER NOT NULL,
  "cups" VARCHAR(30) NOT NULL,
  "datetime" TIMESTAMP(3) NOT NULL,
  "ai" DECIMAL(24, 6),
  "ao" DECIMAL(24, 6),
  "ai_quality" VARCHAR(40),
  "ao_quality" VARCHAR(40),
  "r1" DECIMAL(24, 6),
  "r1_quality" VARCHAR(40),
  "r2" DECIMAL(24, 6),
  "r2_quality" VARCHAR(40),
  "r3" DECIMAL(24, 6),
  "r3_quality" VARCHAR(40),
  "r4" DECIMAL(24, 6),
  "r4_quality" VARCHAR(40),
  "measure_type" INTEGER,
  "source" INTEGER,
  "type" VARCHAR(80),
  "season" INTEGER,
  "validated" BOOLEAN,
  "gisce_create_at" TIMESTAMP(3),
  "gisce_update_at" TIMESTAMP(3),
  "raw_data" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cm_invoice_curve_p1_raw_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ux_cm_invoice_p1_raw_invoice_source"
  ON "cm_invoice_curve_p1_raw"("invoice_id", "gisce_source_id");

CREATE INDEX IF NOT EXISTS "cm_invoice_curve_p1_raw_invoice_id_datetime_idx"
  ON "cm_invoice_curve_p1_raw"("invoice_id", "datetime");

CREATE INDEX IF NOT EXISTS "cm_invoice_curve_p1_raw_cups_datetime_idx"
  ON "cm_invoice_curve_p1_raw"("cups", "datetime");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'cm_invoice_curve_p1_raw_invoice_id_fkey'
  ) THEN
    ALTER TABLE "cm_invoice_curve_p1_raw"
      ADD CONSTRAINT "cm_invoice_curve_p1_raw_invoice_id_fkey"
      FOREIGN KEY ("invoice_id") REFERENCES "cm_invoices"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
