ALTER TYPE "CmInvoiceCostComponentCode" ADD VALUE IF NOT EXISTS 'BONO_SOCIAL';
ALTER TYPE "CmInvoiceCostComponentCode" ADD VALUE IF NOT EXISTS 'OTROS';
ALTER TYPE "CmInvoiceCostComponentCode" ADD VALUE IF NOT EXISTS 'IMU';

ALTER TYPE "CmInvoiceCostEnergyBasis" ADD VALUE IF NOT EXISTS 'ECONOMIC_AMOUNT';

ALTER TYPE "RegulatedPriceCode" ADD VALUE IF NOT EXISTS 'BONO_SOCIAL';
ALTER TYPE "RegulatedPriceCode" ADD VALUE IF NOT EXISTS 'OTROS';
ALTER TYPE "RegulatedPriceCode" ADD VALUE IF NOT EXISTS 'IMU';

ALTER TABLE "cm_invoice_cost_runs"
  ADD COLUMN IF NOT EXISTS "total_configured_eur" DECIMAL(24, 10),
  ADD COLUMN IF NOT EXISTS "total_tolls_charges_eur" DECIMAL(24, 10),
  ADD COLUMN IF NOT EXISTS "total_derived_eur" DECIMAL(24, 10);

ALTER TABLE "cm_invoice_interval_costs"
  ADD COLUMN IF NOT EXISTS "configured_cost_eur" DECIMAL(24, 10),
  ADD COLUMN IF NOT EXISTS "tolls_charges_cost_eur" DECIMAL(24, 10),
  ADD COLUMN IF NOT EXISTS "derived_cost_eur" DECIMAL(24, 10);

ALTER TABLE "cm_invoice_interval_cost_components"
  ADD COLUMN IF NOT EXISTS "base_amount_eur" DECIMAL(24, 10),
  ADD COLUMN IF NOT EXISTS "percentage" DECIMAL(12, 6);

CREATE TABLE IF NOT EXISTS "regulated_social_bonus_prices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "version_id" UUID NOT NULL,
  "price_eur_mwh" DECIMAL(20, 8) NOT NULL,
  "energy_basis" VARCHAR(40) NOT NULL DEFAULT 'PF',
  "unit" VARCHAR(40) NOT NULL DEFAULT 'EUR_MWH',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "regulated_social_bonus_prices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "regulated_social_bonus_prices_version_id_key" UNIQUE ("version_id"),
  CONSTRAINT "regulated_social_bonus_prices_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "regulated_price_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "regulated_other_prices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "version_id" UUID NOT NULL,
  "price_eur_mwh" DECIMAL(20, 8) NOT NULL,
  "energy_basis" VARCHAR(40) NOT NULL DEFAULT 'BC',
  "unit" VARCHAR(40) NOT NULL DEFAULT 'EUR_MWH',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "regulated_other_prices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "regulated_other_prices_version_id_key" UNIQUE ("version_id"),
  CONSTRAINT "regulated_other_prices_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "regulated_price_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS "regulated_imu_rates" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "version_id" UUID NOT NULL,
  "percentage" DECIMAL(12, 6) NOT NULL,
  "basis" VARCHAR(40) NOT NULL DEFAULT 'ECONOMIC_AMOUNT',
  "unit" VARCHAR(40) NOT NULL DEFAULT 'PERCENT',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "regulated_imu_rates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "regulated_imu_rates_version_id_key" UNIQUE ("version_id"),
  CONSTRAINT "regulated_imu_rates_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "regulated_price_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
