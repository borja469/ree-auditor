CREATE TABLE "pricing_portfolio_sale_surcharges" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "tariff" VARCHAR(20) NOT NULL,
  "surcharge_eur_mwh" DECIMAL(20, 6),
  "source" VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pricing_portfolio_sale_surcharges_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ux_pricing_portfolio_sale_surcharges_month_tariff"
  ON "pricing_portfolio_sale_surcharges"("year", "month", "tariff");

CREATE INDEX "pricing_portfolio_sale_surcharges_year_month_idx"
  ON "pricing_portfolio_sale_surcharges"("year", "month");

CREATE INDEX "pricing_portfolio_sale_surcharges_tariff_idx"
  ON "pricing_portfolio_sale_surcharges"("tariff");
