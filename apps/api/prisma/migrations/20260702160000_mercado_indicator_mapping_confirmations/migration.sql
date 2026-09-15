CREATE TABLE "mercado_indicator_mapping_confirmations" (
  "id" UUID NOT NULL,
  "variable" VARCHAR(80) NOT NULL,
  "indicator_id" INTEGER NOT NULL,
  "geo_id" INTEGER,
  "geo_key" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mercado_indicator_mapping_confirmations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mercado_indicator_mapping_confirmations_variable_key"
  ON "mercado_indicator_mapping_confirmations"("variable");

CREATE INDEX "mercado_indicator_mapping_confirmations_indicator_id_idx"
  ON "mercado_indicator_mapping_confirmations"("indicator_id");

ALTER TABLE "mercado_indicator_mapping_confirmations"
  ADD CONSTRAINT "mercado_indicator_mapping_confirmations_indicator_id_fkey"
  FOREIGN KEY ("indicator_id") REFERENCES "esios_indicators"("indicator_id")
  ON DELETE CASCADE ON UPDATE CASCADE;
