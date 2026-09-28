ALTER TABLE "cm_invoice_consumption_curve"
  ADD COLUMN IF NOT EXISTS "source_resolution_minutes" INTEGER;
