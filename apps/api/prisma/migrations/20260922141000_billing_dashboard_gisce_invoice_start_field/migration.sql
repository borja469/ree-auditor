ALTER TABLE "cm_gisce_config"
  ALTER COLUMN "invoice_start_field" SET DEFAULT 'data_inicial';

UPDATE "cm_gisce_config"
SET "invoice_start_field" = 'data_inicial'
WHERE "invoice_start_field" = 'data_inici';
