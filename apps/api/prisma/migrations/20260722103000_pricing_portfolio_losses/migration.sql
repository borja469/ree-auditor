ALTER TABLE "pricing_portfolio_monthly_consumption"
  ADD COLUMN "elevated_consumption_kwh" DECIMAL(24, 6),
  ADD COLUMN "losses_kwh" DECIMAL(24, 6),
  ADD COLUMN "loss_percentage" DECIMAL(12, 6),
  ADD COLUMN "loss_version" VARCHAR(80);
