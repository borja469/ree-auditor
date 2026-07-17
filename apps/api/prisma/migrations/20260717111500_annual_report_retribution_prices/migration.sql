DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AnnualReportRetributionType') THEN
    CREATE TYPE "AnnualReportRetributionType" AS ENUM ('OS', 'OM');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "annual_report_retribution_prices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "year" INTEGER NOT NULL,
  "month" INTEGER NOT NULL,
  "type" "AnnualReportRetributionType" NOT NULL,
  "price" DECIMAL(24,12) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "annual_report_retribution_prices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ux_annual_report_retribution_price_period_type"
  ON "annual_report_retribution_prices"("year", "month", "type");

CREATE INDEX IF NOT EXISTS "annual_report_retribution_prices_year_idx"
  ON "annual_report_retribution_prices"("year");

CREATE INDEX IF NOT EXISTS "annual_report_retribution_prices_type_idx"
  ON "annual_report_retribution_prices"("type");
