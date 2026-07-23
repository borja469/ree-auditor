CREATE TABLE "pricing_portfolio_monthly_consumption" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contract_id" UUID NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "tariff_period" VARCHAR(5) NOT NULL,
  "consumption_kwh" DECIMAL(24,6) NOT NULL,
  "profile_weight" DECIMAL(24,15) NOT NULL,
  "intervals" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pricing_portfolio_monthly_consumption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pricing_portfolio_forecast" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contract_id" UUID NOT NULL,
  "reference_date" DATE NOT NULL,
  "calculated_until" DATE,
  "estimated_consumption" DECIMAL(24,6) NOT NULL,
  "calculated_at" TIMESTAMP(3) NOT NULL,
  "status" VARCHAR(40) NOT NULL,
  CONSTRAINT "pricing_portfolio_forecast_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ux_pricing_portfolio_monthly_consumption_contract_period"
  ON "pricing_portfolio_monthly_consumption"("contract_id", "year", "month", "tariff_period");
CREATE INDEX "pricing_portfolio_monthly_consumption_contract_id_idx"
  ON "pricing_portfolio_monthly_consumption"("contract_id");
CREATE INDEX "pricing_portfolio_monthly_consumption_year_month_idx"
  ON "pricing_portfolio_monthly_consumption"("year", "month");
CREATE INDEX "pricing_portfolio_monthly_consumption_tariff_period_idx"
  ON "pricing_portfolio_monthly_consumption"("tariff_period");

CREATE UNIQUE INDEX "ux_pricing_portfolio_forecast_contract_reference"
  ON "pricing_portfolio_forecast"("contract_id", "reference_date");
CREATE INDEX "pricing_portfolio_forecast_reference_date_idx"
  ON "pricing_portfolio_forecast"("reference_date");
CREATE INDEX "pricing_portfolio_forecast_status_idx"
  ON "pricing_portfolio_forecast"("status");

ALTER TABLE "pricing_portfolio_monthly_consumption"
  ADD CONSTRAINT "pricing_portfolio_monthly_consumption_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "mir_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pricing_portfolio_forecast"
  ADD CONSTRAINT "pricing_portfolio_forecast_contract_id_fkey"
  FOREIGN KEY ("contract_id") REFERENCES "mir_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
