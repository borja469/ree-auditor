CREATE TABLE "forecast_training_jobs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "status" VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  "modelo" VARCHAR(60) NOT NULL,
  "fecha_desde" DATE NOT NULL,
  "fecha_hasta" DATE NOT NULL,
  "geo_id" INTEGER,
  "usuario" VARCHAR(160),
  "input" JSONB NOT NULL,
  "result" JSONB,
  "error_message" TEXT,
  "forecast_model_id" UUID,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "forecast_training_jobs_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "forecast_training_jobs"
  ADD CONSTRAINT "forecast_training_jobs_forecast_model_id_fkey"
  FOREIGN KEY ("forecast_model_id") REFERENCES "forecast_models"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "forecast_training_jobs_status_idx" ON "forecast_training_jobs"("status");
CREATE INDEX "forecast_training_jobs_modelo_idx" ON "forecast_training_jobs"("modelo");
CREATE INDEX "forecast_training_jobs_created_at_idx" ON "forecast_training_jobs"("created_at");
CREATE INDEX "forecast_training_jobs_forecast_model_id_idx" ON "forecast_training_jobs"("forecast_model_id");
