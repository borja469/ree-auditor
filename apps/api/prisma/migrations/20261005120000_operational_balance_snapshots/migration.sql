CREATE TABLE "cm_operational_balance_snapshots" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "year" INTEGER NOT NULL,
  "calculation_version" VARCHAR(80) NOT NULL,
  "scope_key" VARCHAR(160) NOT NULL DEFAULT 'ALL',
  "filters_json" JSONB NOT NULL,
  "result_json" JSONB NOT NULL,
  "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "cm_operational_balance_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ux_cm_operational_balance_snapshot_scope"
  ON "cm_operational_balance_snapshots"("year", "calculation_version", "scope_key");

CREATE INDEX "cm_operational_balance_snapshots_year_idx"
  ON "cm_operational_balance_snapshots"("year");

CREATE INDEX "cm_operational_balance_snapshots_calculated_at_idx"
  ON "cm_operational_balance_snapshots"("calculated_at");
