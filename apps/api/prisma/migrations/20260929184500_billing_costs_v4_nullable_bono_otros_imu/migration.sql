ALTER TABLE "regulated_social_bonus_prices"
  ALTER COLUMN "price_eur_mwh" DROP NOT NULL;

ALTER TABLE "regulated_other_prices"
  ALTER COLUMN "price_eur_mwh" DROP NOT NULL;

ALTER TABLE "regulated_imu_rates"
  ALTER COLUMN "percentage" DROP NOT NULL;
