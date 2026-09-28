ALTER TYPE "ReeSettlementVersion" ADD VALUE IF NOT EXISTS 'A2';
ALTER TYPE "ReeSettlementVersion" ADD VALUE IF NOT EXISTS 'A3';
ALTER TYPE "ReeSettlementVersion" ADD VALUE IF NOT EXISTS 'A4';
ALTER TYPE "ReeSettlementVersion" ADD VALUE IF NOT EXISTS 'A5';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ReeSettlementType') THEN
    CREATE TYPE "ReeSettlementType" AS ENUM ('A', 'C');
  END IF;
END
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM ree_files WHERE version::text !~ '^[AC][1-5]$') THEN
    RAISE EXCEPTION 'ree_files contiene versiones no migrables a settlement_type/settlement_number';
  END IF;
  IF EXISTS (SELECT 1 FROM reganecu_records WHERE version::text !~ '^[AC][1-5]$') THEN
    RAISE EXCEPTION 'reganecu_records contiene versiones no migrables a settlement_type/settlement_number';
  END IF;
  IF EXISTS (SELECT 1 FROM reganecu_qh_records WHERE version::text !~ '^[AC][1-5]$') THEN
    RAISE EXCEPTION 'reganecu_qh_records contiene versiones no migrables a settlement_type/settlement_number';
  END IF;
  IF EXISTS (SELECT 1 FROM ree_seie_files WHERE upper(btrim(version)) !~ '^[AC][1-5]$') THEN
    RAISE EXCEPTION 'ree_seie_files contiene versiones no migrables a settlement_type/settlement_number';
  END IF;
  IF EXISTS (SELECT 1 FROM ree_seie_records WHERE upper(btrim(version)) !~ '^[AC][1-5]$') THEN
    RAISE EXCEPTION 'ree_seie_records contiene versiones no migrables a settlement_type/settlement_number';
  END IF;
  IF EXISTS (SELECT 1 FROM ree_esios_lq_zip_files WHERE upper(btrim(settlement)) !~ '^[AC][1-5]$') THEN
    RAISE EXCEPTION 'ree_esios_lq_zip_files contiene settlements no migrables a settlement_type/settlement_number';
  END IF;
END
$$;

ALTER TABLE "ree_files" ADD COLUMN "settlement_type" "ReeSettlementType";
ALTER TABLE "ree_files" ADD COLUMN "settlement_number" INTEGER;
ALTER TABLE "reganecu_records" ADD COLUMN "settlement_type" "ReeSettlementType";
ALTER TABLE "reganecu_records" ADD COLUMN "settlement_number" INTEGER;
ALTER TABLE "reganecu_qh_records" ADD COLUMN "settlement_type" "ReeSettlementType";
ALTER TABLE "reganecu_qh_records" ADD COLUMN "settlement_number" INTEGER;
ALTER TABLE "ree_seie_files" ADD COLUMN "settlement_type" "ReeSettlementType";
ALTER TABLE "ree_seie_files" ADD COLUMN "settlement_number" INTEGER;
ALTER TABLE "ree_seie_records" ADD COLUMN "settlement_type" "ReeSettlementType";
ALTER TABLE "ree_seie_records" ADD COLUMN "settlement_number" INTEGER;
ALTER TABLE "ree_esios_lq_zip_files" ADD COLUMN "settlement_type" "ReeSettlementType";
ALTER TABLE "ree_esios_lq_zip_files" ADD COLUMN "settlement_number" INTEGER;

UPDATE "ree_files"
SET
  "settlement_type" = substring(version::text from 1 for 1)::"ReeSettlementType",
  "settlement_number" = substring(version::text from 2 for 1)::integer;

UPDATE "reganecu_records"
SET
  "settlement_type" = substring(version::text from 1 for 1)::"ReeSettlementType",
  "settlement_number" = substring(version::text from 2 for 1)::integer;

UPDATE "reganecu_qh_records"
SET
  "settlement_type" = substring(version::text from 1 for 1)::"ReeSettlementType",
  "settlement_number" = substring(version::text from 2 for 1)::integer;

UPDATE "ree_seie_files"
SET
  "settlement_type" = substring(upper(btrim(version)) from 1 for 1)::"ReeSettlementType",
  "settlement_number" = substring(upper(btrim(version)) from 2 for 1)::integer,
  "version" = upper(btrim(version));

UPDATE "ree_seie_records"
SET
  "settlement_type" = substring(upper(btrim(version)) from 1 for 1)::"ReeSettlementType",
  "settlement_number" = substring(upper(btrim(version)) from 2 for 1)::integer,
  "version" = upper(btrim(version));

UPDATE "ree_esios_lq_zip_files"
SET
  "settlement_type" = substring(upper(btrim(settlement)) from 1 for 1)::"ReeSettlementType",
  "settlement_number" = substring(upper(btrim(settlement)) from 2 for 1)::integer,
  "settlement" = upper(btrim(settlement));

ALTER TABLE "ree_files" ALTER COLUMN "settlement_type" SET NOT NULL;
ALTER TABLE "ree_files" ALTER COLUMN "settlement_number" SET NOT NULL;
ALTER TABLE "reganecu_records" ALTER COLUMN "settlement_type" SET NOT NULL;
ALTER TABLE "reganecu_records" ALTER COLUMN "settlement_number" SET NOT NULL;
ALTER TABLE "reganecu_qh_records" ALTER COLUMN "settlement_type" SET NOT NULL;
ALTER TABLE "reganecu_qh_records" ALTER COLUMN "settlement_number" SET NOT NULL;
ALTER TABLE "ree_seie_files" ALTER COLUMN "settlement_type" SET NOT NULL;
ALTER TABLE "ree_seie_files" ALTER COLUMN "settlement_number" SET NOT NULL;
ALTER TABLE "ree_seie_records" ALTER COLUMN "settlement_type" SET NOT NULL;
ALTER TABLE "ree_seie_records" ALTER COLUMN "settlement_number" SET NOT NULL;
ALTER TABLE "ree_esios_lq_zip_files" ALTER COLUMN "settlement_type" SET NOT NULL;
ALTER TABLE "ree_esios_lq_zip_files" ALTER COLUMN "settlement_number" SET NOT NULL;

ALTER TABLE "ree_files" ADD CONSTRAINT "ree_files_settlement_number_check" CHECK ("settlement_number" BETWEEN 1 AND 5);
ALTER TABLE "reganecu_records" ADD CONSTRAINT "reganecu_records_settlement_number_check" CHECK ("settlement_number" BETWEEN 1 AND 5);
ALTER TABLE "reganecu_qh_records" ADD CONSTRAINT "reganecu_qh_records_settlement_number_check" CHECK ("settlement_number" BETWEEN 1 AND 5);
ALTER TABLE "ree_seie_files" ADD CONSTRAINT "ree_seie_files_settlement_number_check" CHECK ("settlement_number" BETWEEN 1 AND 5);
ALTER TABLE "ree_seie_records" ADD CONSTRAINT "ree_seie_records_settlement_number_check" CHECK ("settlement_number" BETWEEN 1 AND 5);
ALTER TABLE "ree_esios_lq_zip_files" ADD CONSTRAINT "ree_esios_lq_zip_files_settlement_number_check" CHECK ("settlement_number" BETWEEN 1 AND 5);

CREATE INDEX "ree_files_settlement_type_settlement_number_idx" ON "ree_files"("settlement_type", "settlement_number");
CREATE INDEX "reganecu_records_settlement_type_settlement_number_idx" ON "reganecu_records"("settlement_type", "settlement_number");
CREATE INDEX "reganecu_qh_records_settlement_type_settlement_number_idx" ON "reganecu_qh_records"("settlement_type", "settlement_number");
CREATE INDEX "ree_seie_files_settlement_type_settlement_number_idx" ON "ree_seie_files"("settlement_type", "settlement_number");
CREATE INDEX "ree_seie_records_settlement_type_settlement_number_idx" ON "ree_seie_records"("settlement_type", "settlement_number");
CREATE INDEX "ree_esios_lq_zip_files_settlement_type_settlement_number_idx" ON "ree_esios_lq_zip_files"("settlement_type", "settlement_number");
