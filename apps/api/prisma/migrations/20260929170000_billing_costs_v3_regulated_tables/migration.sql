ALTER TYPE "CmInvoiceCostComponentCode" ADD VALUE IF NOT EXISTS 'RETH';
ALTER TYPE "CmInvoiceCostComponentCode" ADD VALUE IF NOT EXISTS 'PC3_CONFIG';
ALTER TYPE "CmInvoiceCostComponentCode" ADD VALUE IF NOT EXISTS 'EFIH';
ALTER TYPE "CmInvoiceCostComponentCode" ADD VALUE IF NOT EXISTS 'TOLLS_CHARGES_ENERGY';

ALTER TYPE "CmInvoiceCostEnergyBasis" ADD VALUE IF NOT EXISTS 'PF';

ALTER TABLE "cm_invoice_cost_runs"
  ADD COLUMN IF NOT EXISTS "total_regulated_eur" NUMERIC(24,10);

ALTER TABLE "cm_invoice_interval_costs"
  ADD COLUMN IF NOT EXISTS "pf_kwh" NUMERIC(24,9),
  ADD COLUMN IF NOT EXISTS "regulated_cost_eur" NUMERIC(24,10);

ALTER TABLE "cm_invoice_interval_cost_components"
  ADD COLUMN IF NOT EXISTS "regulated_price_version_id" UUID,
  ADD COLUMN IF NOT EXISTS "regulated_price_version_name" VARCHAR(120),
  ADD COLUMN IF NOT EXISTS "source_valid_from" DATE,
  ADD COLUMN IF NOT EXISTS "source_valid_to" DATE,
  ADD COLUMN IF NOT EXISTS "source_tariff_code" VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "source_tariff_period" VARCHAR(5);

CREATE INDEX IF NOT EXISTS "cm_invoice_interval_cost_components_regulated_price_version_id_idx"
  ON "cm_invoice_interval_cost_components"("regulated_price_version_id");
