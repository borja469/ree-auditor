ALTER TABLE "omie_guarantees_deposited"
  ALTER COLUMN "amount" DROP NOT NULL,
  ADD COLUMN "prepaid_payment" DECIMAL(20, 2);
