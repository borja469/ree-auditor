CREATE TABLE "cm_indexed_price_history_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "date_from" DATE NOT NULL,
  "date_to" DATE NOT NULL,
  "calculation_version" VARCHAR(80) NOT NULL,
  "scope_key" VARCHAR(80) NOT NULL DEFAULT 'ALL',
  "result_json" JSONB NOT NULL,
  "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cm_indexed_price_history_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ux_cm_indexed_price_history_snapshot_scope"
  ON "cm_indexed_price_history_snapshots"("date_from", "date_to", "calculation_version", "scope_key");

CREATE INDEX "cm_indexed_price_history_snapshots_date_from_date_to_idx"
  ON "cm_indexed_price_history_snapshots"("date_from", "date_to");

CREATE INDEX "cm_indexed_price_history_snapshots_calculated_at_idx"
  ON "cm_indexed_price_history_snapshots"("calculated_at");
