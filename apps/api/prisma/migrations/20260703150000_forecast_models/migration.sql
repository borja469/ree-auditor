CREATE TABLE "forecast_models" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "nombre" VARCHAR(160) NOT NULL,
  "tipo_modelo" VARCHAR(60) NOT NULL,
  "version" INTEGER NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT false,
  "fecha_entrenamiento" TIMESTAMP(3) NOT NULL,
  "fecha_desde" DATE NOT NULL,
  "fecha_hasta" DATE NOT NULL,
  "variables_utilizadas" JSONB NOT NULL,
  "variables_descartadas" JSONB NOT NULL,
  "coeficientes" JSONB NOT NULL,
  "intercepto" DECIMAL(24,12) NOT NULL,
  "metricas" JSONB NOT NULL,
  "walk_forward_metricas" JSONB,
  "feature_importance" JSONB,
  "numero_registros" INTEGER NOT NULL,
  "duracion_ms" INTEGER NOT NULL DEFAULT 0,
  "usuario" VARCHAR(160),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "forecast_models_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "forecast_models_tipo_modelo_version_key" ON "forecast_models"("tipo_modelo", "version");
CREATE INDEX "forecast_models_tipo_modelo_idx" ON "forecast_models"("tipo_modelo");
CREATE INDEX "forecast_models_activo_idx" ON "forecast_models"("activo");
CREATE INDEX "forecast_models_fecha_entrenamiento_idx" ON "forecast_models"("fecha_entrenamiento");
