ALTER TABLE "pricing_portfolio_monthly_consumption"
  ADD COLUMN "sale_surcharge_eur_mwh" DECIMAL(20, 6),
  ADD COLUMN "applied_sale_price_eur_mwh" DECIMAL(20, 6);

ALTER TABLE "pricing_portfolio_forecast"
  ADD COLUMN "sale_surcharges_json" JSONB;
