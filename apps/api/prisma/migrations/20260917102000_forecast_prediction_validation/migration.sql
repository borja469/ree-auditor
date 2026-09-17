ALTER TABLE "forecast_prediction_runs"
  ADD COLUMN "status" VARCHAR(40) NOT NULL DEFAULT 'PENDIENTE_VALIDACION',
  ADD COLUMN "is_official" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "validated_at" TIMESTAMP(3),
  ADD COLUMN "validated_by" VARCHAR(160),
  ADD COLUMN "validation_comment" TEXT,
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX "forecast_prediction_runs_status_idx" ON "forecast_prediction_runs"("status");
CREATE INDEX "forecast_prediction_runs_is_official_idx" ON "forecast_prediction_runs"("is_official");

CREATE UNIQUE INDEX "ux_forecast_prediction_runs_official_range"
  ON "forecast_prediction_runs"("fecha_desde", "fecha_hasta")
  WHERE "is_official" = true;
