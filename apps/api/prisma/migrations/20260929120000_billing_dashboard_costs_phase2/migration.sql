CREATE TYPE "CmInvoiceCostRunStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'WARNING', 'ERROR');
CREATE TYPE "CmInvoiceIntervalCostStatus" AS ENUM ('OK', 'WARNING', 'ERROR');
CREATE TYPE "CmInvoiceCostComponentCode" AS ENUM ('OMIE_MD', 'CAD', 'PC3', 'BS3', 'RAD3');
CREATE TYPE "CmInvoiceCostEnergyBasis" AS ENUM ('BC');

CREATE TABLE "cm_invoice_cost_runs" (
  "id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "status" "CmInvoiceCostRunStatus" NOT NULL DEFAULT 'PENDING',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "calculation_version" VARCHAR(80) NOT NULL DEFAULT 'PHASE2_ENERGY_COSTS_V1',
  "total_omie_eur" DECIMAL(24,10),
  "total_liquidations_eur" DECIMAL(24,10),
  "total_cost_eur" DECIMAL(24,10),
  "intervals_count" INTEGER NOT NULL DEFAULT 0,
  "ok_intervals_count" INTEGER NOT NULL DEFAULT 0,
  "warning_intervals_count" INTEGER NOT NULL DEFAULT 0,
  "error_intervals_count" INTEGER NOT NULL DEFAULT 0,
  "incidents_count" INTEGER NOT NULL DEFAULT 0,
  "summary_json" JSONB,
  "message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cm_invoice_cost_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cm_invoice_interval_costs" (
  "id" UUID NOT NULL,
  "cost_run_id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "curve_interval_id" UUID,
  "datetime" TIMESTAMP(3) NOT NULL,
  "tariff_period" VARCHAR(5) NOT NULL,
  "bc_kwh" DECIMAL(24,9),
  "liquidations_cost_eur" DECIMAL(24,10),
  "total_cost_eur" DECIMAL(24,10),
  "status" "CmInvoiceIntervalCostStatus" NOT NULL DEFAULT 'OK',
  "incident_codes" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cm_invoice_interval_costs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cm_invoice_interval_cost_components" (
  "id" UUID NOT NULL,
  "interval_cost_id" UUID NOT NULL,
  "component_code" "CmInvoiceCostComponentCode" NOT NULL,
  "energy_basis" "CmInvoiceCostEnergyBasis" NOT NULL,
  "energy_kwh" DECIMAL(24,9),
  "energy_mwh" DECIMAL(24,12),
  "price_eur_mwh" DECIMAL(24,10),
  "cost_eur" DECIMAL(24,10),
  "source_table" VARCHAR(80),
  "source_row_id" UUID,
  "source_version" "ReeSettlementVersion",
  "source_resolution_minutes" INTEGER,
  "status" "CmInvoiceIntervalCostStatus" NOT NULL DEFAULT 'OK',
  "incident_code" VARCHAR(80),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cm_invoice_interval_cost_components_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cm_invoice_cost_runs_invoice_id_started_at_idx" ON "cm_invoice_cost_runs"("invoice_id", "started_at");
CREATE INDEX "cm_invoice_cost_runs_status_idx" ON "cm_invoice_cost_runs"("status");

CREATE INDEX "cm_invoice_interval_costs_cost_run_id_datetime_idx" ON "cm_invoice_interval_costs"("cost_run_id", "datetime");
CREATE INDEX "cm_invoice_interval_costs_invoice_id_datetime_idx" ON "cm_invoice_interval_costs"("invoice_id", "datetime");
CREATE INDEX "cm_invoice_interval_costs_curve_interval_id_idx" ON "cm_invoice_interval_costs"("curve_interval_id");
CREATE INDEX "cm_invoice_interval_costs_status_idx" ON "cm_invoice_interval_costs"("status");

CREATE INDEX "cm_invoice_interval_cost_components_interval_cost_id_idx" ON "cm_invoice_interval_cost_components"("interval_cost_id");
CREATE INDEX "cm_invoice_interval_cost_components_component_code_idx" ON "cm_invoice_interval_cost_components"("component_code");
CREATE INDEX "cm_invoice_interval_cost_components_source_version_idx" ON "cm_invoice_interval_cost_components"("source_version");
CREATE INDEX "cm_invoice_interval_cost_components_status_idx" ON "cm_invoice_interval_cost_components"("status");
CREATE INDEX "cm_invoice_interval_cost_components_incident_code_idx" ON "cm_invoice_interval_cost_components"("incident_code");

ALTER TABLE "cm_invoice_cost_runs"
  ADD CONSTRAINT "cm_invoice_cost_runs_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "cm_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cm_invoice_interval_costs"
  ADD CONSTRAINT "cm_invoice_interval_costs_cost_run_id_fkey"
  FOREIGN KEY ("cost_run_id") REFERENCES "cm_invoice_cost_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cm_invoice_interval_costs"
  ADD CONSTRAINT "cm_invoice_interval_costs_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "cm_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cm_invoice_interval_costs"
  ADD CONSTRAINT "cm_invoice_interval_costs_curve_interval_id_fkey"
  FOREIGN KEY ("curve_interval_id") REFERENCES "cm_invoice_consumption_curve"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cm_invoice_interval_cost_components"
  ADD CONSTRAINT "cm_invoice_interval_cost_components_interval_cost_id_fkey"
  FOREIGN KEY ("interval_cost_id") REFERENCES "cm_invoice_interval_costs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
