DROP INDEX IF EXISTS "ux_esios_indicator_values";

UPDATE "esios_indicator_values"
SET "datetime_utc" = "datetime"
WHERE "datetime_utc" IS NULL;

CREATE UNIQUE INDEX "ux_esios_indicator_values_utc"
ON "esios_indicator_values"("indicator_id", "datetime_utc");
