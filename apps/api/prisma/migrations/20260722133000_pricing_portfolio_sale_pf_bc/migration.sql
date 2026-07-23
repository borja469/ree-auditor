ALTER TABLE "pricing_portfolio_monthly_consumption"
  ADD COLUMN "estimated_sale_amount_bc_eur" DECIMAL(24, 6);

ALTER TABLE "pricing_portfolio_forecast"
  ADD COLUMN "estimated_sale_amount_bc" DECIMAL(24, 6);
