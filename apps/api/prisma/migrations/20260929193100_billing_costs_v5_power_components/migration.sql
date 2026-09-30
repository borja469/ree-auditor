CREATE TABLE IF NOT EXISTS "cm_invoice_power_cost_components" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "cost_run_id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "component_code" "CmInvoiceCostComponentCode" NOT NULL DEFAULT 'TOLLS_CHARGES_POWER',
  "calculation_basis" "CmInvoiceCostEnergyBasis" NOT NULL DEFAULT 'CONTRACTED_POWER',
  "tariff_code" VARCHAR(20),
  "tariff_period" VARCHAR(5),
  "contracted_power_kw" DECIMAL(24,9),
  "start_date" DATE NOT NULL,
  "end_date" DATE NOT NULL,
  "billed_days" INTEGER NOT NULL,
  "year_days" INTEGER,
  "annual_price_eur_kw_year" DECIMAL(24,10),
  "cost_eur" DECIMAL(24,10),
  "source_table" VARCHAR(80),
  "source_row_id" UUID,
  "regulated_price_version_id" UUID,
  "regulated_price_version_name" VARCHAR(120),
  "source_valid_from" DATE,
  "source_valid_to" DATE,
  "status" "CmInvoiceIntervalCostStatus" NOT NULL DEFAULT 'OK',
  "incident_code" VARCHAR(80),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "cm_invoice_power_cost_components_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "cm_invoice_power_cost_components"
  ADD CONSTRAINT "cm_invoice_power_cost_components_cost_run_id_fkey"
  FOREIGN KEY ("cost_run_id") REFERENCES "cm_invoice_cost_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cm_invoice_power_cost_components"
  ADD CONSTRAINT "cm_invoice_power_cost_components_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "cm_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "cm_invoice_power_cost_components_cost_run_id_idx" ON "cm_invoice_power_cost_components"("cost_run_id");
CREATE INDEX IF NOT EXISTS "cm_invoice_power_cost_components_invoice_id_idx" ON "cm_invoice_power_cost_components"("invoice_id");
CREATE INDEX IF NOT EXISTS "cm_invoice_power_cost_components_component_code_idx" ON "cm_invoice_power_cost_components"("component_code");
CREATE INDEX IF NOT EXISTS "cm_invoice_power_cost_components_tariff_period_idx" ON "cm_invoice_power_cost_components"("tariff_period");
CREATE INDEX IF NOT EXISTS "cm_invoice_power_cost_components_regulated_price_version_id_idx" ON "cm_invoice_power_cost_components"("regulated_price_version_id");
CREATE INDEX IF NOT EXISTS "cm_invoice_power_cost_components_status_idx" ON "cm_invoice_power_cost_components"("status");
CREATE INDEX IF NOT EXISTS "cm_invoice_power_cost_components_incident_code_idx" ON "cm_invoice_power_cost_components"("incident_code");
