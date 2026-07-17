CREATE TABLE "pricing_meff_prices" (
    "id" UUID NOT NULL,
    "fecha_publicacion" DATE NOT NULL,
    "cod" VARCHAR(120) NOT NULL,
    "tipo" VARCHAR(120),
    "clase" VARCHAR(120),
    "periodo" VARCHAR(120),
    "entrega" VARCHAR(120),
    "multiplicador" VARCHAR(120),
    "precio" DECIMAL(20,8),
    "raw_payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_meff_prices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ux_pricing_meff_fecha_publicacion_cod" ON "pricing_meff_prices"("fecha_publicacion", "cod");
CREATE INDEX "pricing_meff_prices_fecha_publicacion_idx" ON "pricing_meff_prices"("fecha_publicacion");
CREATE INDEX "pricing_meff_prices_cod_idx" ON "pricing_meff_prices"("cod");
CREATE INDEX "pricing_meff_prices_tipo_idx" ON "pricing_meff_prices"("tipo");
CREATE INDEX "pricing_meff_prices_periodo_idx" ON "pricing_meff_prices"("periodo");
CREATE INDEX "pricing_meff_prices_entrega_idx" ON "pricing_meff_prices"("entrega");
CREATE INDEX "pricing_meff_prices_multiplicador_idx" ON "pricing_meff_prices"("multiplicador");
