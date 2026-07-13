CREATE TABLE "pricing_calculator_manual_values" (
    "id" UUID NOT NULL,
    "concepto" VARCHAR(80) NOT NULL,
    "tarifa" VARCHAR(40) NOT NULL,
    "periodo" VARCHAR(10) NOT NULL,
    "valor" DECIMAL(20,8),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pricing_calculator_manual_values_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ux_pricing_calculator_manual_values_concept_tariff_period" ON "pricing_calculator_manual_values"("concepto", "tarifa", "periodo");
CREATE INDEX "pricing_calculator_manual_values_tarifa_idx" ON "pricing_calculator_manual_values"("tarifa");
CREATE INDEX "pricing_calculator_manual_values_periodo_idx" ON "pricing_calculator_manual_values"("periodo");
