ALTER TABLE "ree_k_factor" ADD COLUMN "settlement_type" "ReeSettlementType";
ALTER TABLE "ree_k_factor" ADD COLUMN "settlement_number" INTEGER;

ALTER TABLE "ree_k_factor_imports" ADD COLUMN "settlement_type" "ReeSettlementType";
ALTER TABLE "ree_k_factor_imports" ADD COLUMN "settlement_number" INTEGER;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ree_k_factor WHERE version::text !~ '^[AC][1-5]$') THEN
    RAISE EXCEPTION 'ree_k_factor contiene versiones no migrables a settlement_type/settlement_number';
  END IF;

  IF EXISTS (SELECT 1 FROM ree_k_factor_imports WHERE version IS NOT NULL AND version::text !~ '^[AC][1-5]$') THEN
    RAISE EXCEPTION 'ree_k_factor_imports contiene versiones no migrables a settlement_type/settlement_number';
  END IF;
END $$;

UPDATE "ree_k_factor"
SET
  "settlement_type" = substring(version::text from 1 for 1)::"ReeSettlementType",
  "settlement_number" = substring(version::text from 2 for 1)::integer;

UPDATE "ree_k_factor_imports"
SET
  "settlement_type" = substring(version::text from 1 for 1)::"ReeSettlementType",
  "settlement_number" = substring(version::text from 2 for 1)::integer
WHERE version IS NOT NULL;

ALTER TABLE "ree_k_factor" ALTER COLUMN "settlement_type" SET NOT NULL;
ALTER TABLE "ree_k_factor" ALTER COLUMN "settlement_number" SET NOT NULL;

ALTER TABLE "ree_k_factor" ADD CONSTRAINT "ree_k_factor_settlement_number_check" CHECK ("settlement_number" BETWEEN 1 AND 5);
ALTER TABLE "ree_k_factor_imports" ADD CONSTRAINT "ree_k_factor_imports_settlement_number_check" CHECK ("settlement_number" IS NULL OR "settlement_number" BETWEEN 1 AND 5);

CREATE INDEX "ree_k_factor_settlement_type_settlement_number_idx" ON "ree_k_factor"("settlement_type", "settlement_number");
CREATE INDEX "ree_k_factor_imports_settlement_type_settlement_number_idx" ON "ree_k_factor_imports"("settlement_type", "settlement_number");
CREATE INDEX "ree_k_factor_identity_idx" ON "ree_k_factor"("fecha", "hora", "cuartohora", "version", "tipo_archivo", "tarifa", "periodo");
