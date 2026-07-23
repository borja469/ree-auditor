CREATE TABLE "mir_contracts" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "mir_contract_id" INTEGER NOT NULL,
  "policy_id" INTEGER,
  "policy_code" VARCHAR(80),
  "commercial_id" INTEGER,
  "commercial_name" VARCHAR(255),
  "annual_consumption" DECIMAL(20,6),
  "contract_end_date" DATE,
  "tariff_id" INTEGER,
  "tariff_name" VARCHAR(80),
  "price_list_id" INTEGER,
  "price_list_name" VARCHAR(160),
  "synchronized_at" TIMESTAMP(3) NOT NULL,
  "sync_status" VARCHAR(30) NOT NULL DEFAULT 'OK',
  "validation_errors" JSONB,
  "raw_payload_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mir_contracts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "mir_contracts_mir_contract_id_key" ON "mir_contracts"("mir_contract_id");
CREATE INDEX "mir_contracts_policy_code_idx" ON "mir_contracts"("policy_code");
CREATE INDEX "mir_contracts_commercial_name_idx" ON "mir_contracts"("commercial_name");
CREATE INDEX "mir_contracts_tariff_name_idx" ON "mir_contracts"("tariff_name");
CREATE INDEX "mir_contracts_price_list_name_idx" ON "mir_contracts"("price_list_name");
CREATE INDEX "mir_contracts_contract_end_date_idx" ON "mir_contracts"("contract_end_date");
CREATE INDEX "mir_contracts_synchronized_at_idx" ON "mir_contracts"("synchronized_at");
CREATE INDEX "mir_contracts_sync_status_idx" ON "mir_contracts"("sync_status");
