ALTER TABLE "pricing_portfolio_monthly_consumption"
  ADD COLUMN "sale_price_year" INTEGER,
  ADD COLUMN "sale_price_month" INTEGER,
  ADD COLUMN "sale_price_eur_mwh" DECIMAL(20, 6),
  ADD COLUMN "estimated_sale_amount_eur" DECIMAL(24, 6),
  ADD COLUMN "sale_price_status" VARCHAR(40);

ALTER TABLE "pricing_portfolio_forecast"
  ADD COLUMN "estimated_sale_amount" DECIMAL(24, 6),
  ADD COLUMN "sale_price_status" VARCHAR(40);

CREATE INDEX "pricing_portfolio_monthly_consumption_sale_price_idx"
  ON "pricing_portfolio_monthly_consumption"("sale_price_year", "sale_price_month", "sale_price_status");

CREATE INDEX "pricing_portfolio_forecast_sale_price_status_idx"
  ON "pricing_portfolio_forecast"("sale_price_status");
