CREATE TABLE "forecast_prediction_runs" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "modelo_id" UUID NOT NULL,
  "fecha_ejecucion" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "fecha_desde" DATE NOT NULL,
  "fecha_hasta" DATE NOT NULL,
  "tipo_prediccion" VARCHAR(40) NOT NULL,
  "input" JSONB NOT NULL,
  "output" JSONB NOT NULL,
  "usuario" VARCHAR(160),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "forecast_prediction_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "forecast_prediction_runs_modelo_id_idx" ON "forecast_prediction_runs"("modelo_id");
CREATE INDEX "forecast_prediction_runs_fecha_ejecucion_idx" ON "forecast_prediction_runs"("fecha_ejecucion");
CREATE INDEX "forecast_prediction_runs_fecha_desde_fecha_hasta_idx" ON "forecast_prediction_runs"("fecha_desde", "fecha_hasta");
CREATE INDEX "forecast_prediction_runs_tipo_prediccion_idx" ON "forecast_prediction_runs"("tipo_prediccion");

ALTER TABLE "forecast_prediction_runs"
  ADD CONSTRAINT "forecast_prediction_runs_modelo_id_fkey"
  FOREIGN KEY ("modelo_id") REFERENCES "forecast_models"("id") ON DELETE CASCADE ON UPDATE CASCADE;
