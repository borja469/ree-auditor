ALTER TABLE "pricing_portfolio_forecast"
  ADD COLUMN "estimated_meff_sale_amount" DECIMAL(24, 6),
  ADD COLUMN "meff_valuation_status" VARCHAR(40);

CREATE TABLE "pricing_portfolio_monthly_valuation" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contract_id" UUID NOT NULL,
  "reference_date" DATE NOT NULL,
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "consumption_bc_kwh" DECIMAL(24, 6) NOT NULL,
  "meff_price_eur_mwh" DECIMAL(20, 6),
  "estimated_meff_sale_eur" DECIMAL(24, 6),
  "meff_publication_date" DATE,
  "meff_product_code" VARCHAR(120),
  "meff_price_origin" VARCHAR(40),
  "status" VARCHAR(40) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pricing_portfolio_monthly_valuation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pricing_portfolio_monthly_valuation_contract_id_fkey"
    FOREIGN KEY ("contract_id") REFERENCES "mir_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ux_pricing_portfolio_monthly_valuation_contract_ref_month"
  ON "pricing_portfolio_monthly_valuation"("contract_id", "reference_date", "year", "month");

CREATE INDEX "pricing_portfolio_monthly_valuation_reference_date_idx"
  ON "pricing_portfolio_monthly_valuation"("reference_date");

CREATE INDEX "pricing_portfolio_monthly_valuation_year_month_idx"
  ON "pricing_portfolio_monthly_valuation"("year", "month");

CREATE INDEX "pricing_portfolio_monthly_valuation_status_idx"
  ON "pricing_portfolio_monthly_valuation"("status");

CREATE INDEX "pricing_portfolio_forecast_meff_valuation_status_idx"
  ON "pricing_portfolio_forecast"("meff_valuation_status");
