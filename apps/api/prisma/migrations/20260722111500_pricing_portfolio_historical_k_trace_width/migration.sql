ALTER TABLE "pricing_portfolio_monthly_consumption"
  ALTER COLUMN "loss_mode" TYPE VARCHAR(80),
  ALTER COLUMN "k_factor_version" TYPE VARCHAR(255),
  ALTER COLUMN "k_factor_source_month" TYPE VARCHAR(255);
