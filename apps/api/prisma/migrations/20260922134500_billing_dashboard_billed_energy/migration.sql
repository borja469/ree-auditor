ALTER TABLE "cm_invoices"
  ADD COLUMN IF NOT EXISTS "billed_energy_kwh" DECIMAL(20, 6);
