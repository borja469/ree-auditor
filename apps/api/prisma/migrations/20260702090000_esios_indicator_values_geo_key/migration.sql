DROP INDEX IF EXISTS "ux_esios_indicator_values_utc";

ALTER TABLE "esios_indicator_values"
ADD COLUMN IF NOT EXISTS "geo_key" INTEGER NOT NULL DEFAULT -1;

UPDATE "esios_indicator_values"
SET "geo_key" = COALESCE("geo_id", -1);

CREATE UNIQUE INDEX "ux_esios_indicator_values_utc_geo"
ON "esios_indicator_values"("indicator_id", "datetime_utc", "geo_key");

CREATE INDEX IF NOT EXISTS "esios_indicator_values_indicator_id_datetime_utc_geo_key_idx"
ON "esios_indicator_values"("indicator_id", "datetime_utc", "geo_key");

CREATE INDEX IF NOT EXISTS "esios_indicator_values_geo_id_idx"
ON "esios_indicator_values"("geo_id");
