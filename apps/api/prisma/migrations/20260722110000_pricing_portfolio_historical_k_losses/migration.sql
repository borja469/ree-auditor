ALTER TABLE "pricing_portfolio_monthly_consumption"
  ADD COLUMN "loss_mode" VARCHAR(40),
  ADD COLUMN "boe_loss_percentage" DECIMAL(12, 6),
  ADD COLUMN "k_factor" DECIMAL(20, 10),
  ADD COLUMN "k_factor_version" VARCHAR(10),
  ADD COLUMN "k_factor_source_month" VARCHAR(7);
