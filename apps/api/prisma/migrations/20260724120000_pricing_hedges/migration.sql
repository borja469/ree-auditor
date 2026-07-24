CREATE TABLE "pricing_hedge_operations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "contract_date" DATE NOT NULL,
  "operation_type" VARCHAR(10) NOT NULL,
  "product_cod" VARCHAR(120) NOT NULL,
  "power_mw" DECIMAL(20, 6) NOT NULL,
  "contracted_price_eur_mwh" DECIMAL(20, 8) NOT NULL,
  "broker" VARCHAR(160),
  "observations" TEXT,
  "deleted_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pricing_hedge_operations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pricing_hedge_operations_operation_type_check" CHECK ("operation_type" IN ('COMPRA', 'VENTA'))
);

CREATE TABLE "pricing_hedge_allocations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "buy_operation_id" UUID NOT NULL,
  "sell_operation_id" UUID NOT NULL,
  "power_mw" DECIMAL(20, 6) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pricing_hedge_allocations_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "pricing_hedge_operations_product_cod_idx" ON "pricing_hedge_operations"("product_cod");
CREATE INDEX "pricing_hedge_operations_contract_date_idx" ON "pricing_hedge_operations"("contract_date");
CREATE INDEX "pricing_hedge_operations_operation_type_idx" ON "pricing_hedge_operations"("operation_type");
CREATE INDEX "pricing_hedge_operations_deleted_at_idx" ON "pricing_hedge_operations"("deleted_at");
CREATE INDEX "pricing_hedge_allocations_buy_operation_id_idx" ON "pricing_hedge_allocations"("buy_operation_id");
CREATE INDEX "pricing_hedge_allocations_sell_operation_id_idx" ON "pricing_hedge_allocations"("sell_operation_id");

ALTER TABLE "pricing_hedge_allocations"
  ADD CONSTRAINT "pricing_hedge_allocations_buy_operation_id_fkey"
  FOREIGN KEY ("buy_operation_id") REFERENCES "pricing_hedge_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pricing_hedge_allocations"
  ADD CONSTRAINT "pricing_hedge_allocations_sell_operation_id_fkey"
  FOREIGN KEY ("sell_operation_id") REFERENCES "pricing_hedge_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
