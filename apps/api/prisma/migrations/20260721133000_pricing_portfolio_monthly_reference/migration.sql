ALTER TABLE "pricing_portfolio_monthly_consumption"
  ADD COLUMN "reference_date" DATE NOT NULL DEFAULT DATE '1970-01-01';

DROP INDEX IF EXISTS "ux_pricing_portfolio_monthly_consumption_contract_period";

CREATE UNIQUE INDEX "ux_pricing_portfolio_monthly_consumption_contract_ref_period"
  ON "pricing_portfolio_monthly_consumption"("contract_id", "reference_date", "year", "month", "tariff_period");

CREATE INDEX "pricing_portfolio_monthly_consumption_reference_date_idx"
  ON "pricing_portfolio_monthly_consumption"("reference_date");
