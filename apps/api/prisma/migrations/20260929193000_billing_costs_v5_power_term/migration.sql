ALTER TYPE "CmInvoiceCostComponentCode" ADD VALUE IF NOT EXISTS 'TOLLS_CHARGES_POWER';
ALTER TYPE "CmInvoiceCostEnergyBasis" ADD VALUE IF NOT EXISTS 'CONTRACTED_POWER';

ALTER TABLE "cm_invoice_cost_runs"
  ADD COLUMN IF NOT EXISTS "total_tolls_charges_power_eur" DECIMAL(24,10);
