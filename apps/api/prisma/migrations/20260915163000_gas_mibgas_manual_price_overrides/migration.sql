CREATE TABLE "gas_mibgas_manual_price_overrides" (
  "id" UUID NOT NULL,
  "product" VARCHAR(120) NOT NULL,
  "place_of_delivery" VARCHAR(80) NOT NULL,
  "area" VARCHAR(40) NOT NULL,
  "first_day_delivery" DATE NOT NULL,
  "last_day_delivery" DATE NOT NULL,
  "price_eur_mwh" DECIMAL(20,8) NOT NULL,
  "source" VARCHAR(80) NOT NULL DEFAULT 'SUBASTA_MANUAL',
  "comment" TEXT,
  "usuario" VARCHAR(160),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "gas_mibgas_manual_price_overrides_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ux_gas_mibgas_manual_price_natural_key"
  ON "gas_mibgas_manual_price_overrides"("product", "place_of_delivery", "area", "first_day_delivery", "last_day_delivery");

CREATE INDEX "gas_mibgas_manual_price_overrides_first_day_delivery_idx"
  ON "gas_mibgas_manual_price_overrides"("first_day_delivery");

CREATE INDEX "gas_mibgas_manual_price_overrides_product_idx"
  ON "gas_mibgas_manual_price_overrides"("product");
