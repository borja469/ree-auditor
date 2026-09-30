CREATE TYPE "CmInvoiceMarginStatus" AS ENUM ('READY', 'WARNING', 'NOT_AVAILABLE');

CREATE TABLE "cm_invoice_margin_snapshots" (
  "id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "cost_run_id" UUID NOT NULL,
  "calculation_version" VARCHAR(80) NOT NULL,
  "margin_status" "CmInvoiceMarginStatus" NOT NULL,
  "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "associated_revenue_eur" DECIMAL(24,10),
  "associated_cost_eur" DECIMAL(24,10),
  "margin_eur" DECIMAL(24,10),
  "margin_eur_mwh" DECIMAL(24,10),
  "pf_total_kwh" DECIMAL(24,9),
  "warnings" JSONB,
  "details_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cm_invoice_margin_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ux_cm_invoice_margin_invoice_run_version" ON "cm_invoice_margin_snapshots"("invoice_id", "cost_run_id", "calculation_version");
CREATE INDEX "cm_invoice_margin_snapshots_invoice_id_calculated_at_idx" ON "cm_invoice_margin_snapshots"("invoice_id", "calculated_at");
CREATE INDEX "cm_invoice_margin_snapshots_cost_run_id_idx" ON "cm_invoice_margin_snapshots"("cost_run_id");
CREATE INDEX "cm_invoice_margin_snapshots_margin_status_idx" ON "cm_invoice_margin_snapshots"("margin_status");
CREATE INDEX "cm_invoice_margin_snapshots_margin_eur_idx" ON "cm_invoice_margin_snapshots"("margin_eur");
CREATE INDEX "cm_invoice_margin_snapshots_margin_eur_mwh_idx" ON "cm_invoice_margin_snapshots"("margin_eur_mwh");

ALTER TABLE "cm_invoice_margin_snapshots"
  ADD CONSTRAINT "cm_invoice_margin_snapshots_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "cm_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cm_invoice_margin_snapshots"
  ADD CONSTRAINT "cm_invoice_margin_snapshots_cost_run_id_fkey"
  FOREIGN KEY ("cost_run_id") REFERENCES "cm_invoice_cost_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
