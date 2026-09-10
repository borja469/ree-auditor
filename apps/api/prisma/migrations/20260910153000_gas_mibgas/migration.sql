CREATE TABLE "gas_mibgas_prices" (
    "id" UUID NOT NULL,
    "trading_day" DATE NOT NULL,
    "product" VARCHAR(120) NOT NULL,
    "place_of_delivery" VARCHAR(80) NOT NULL,
    "area" VARCHAR(40) NOT NULL,
    "first_day_delivery" DATE NOT NULL,
    "last_day_delivery" DATE NOT NULL,
    "price_eur_mwh" DECIMAL(20,8),
    "source_year" INTEGER NOT NULL,
    "source_filename" VARCHAR(180) NOT NULL,
    "source_emission_datetime" TIMESTAMP(3),
    "delivery_period_label" VARCHAR(120),
    "raw_payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gas_mibgas_prices_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gas_mibgas_sync_runs" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "run_type" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "url" VARCHAR(700),
    "source_filename" VARCHAR(180),
    "source_emission_datetime" TIMESTAMP(3),
    "rows_read" INTEGER NOT NULL DEFAULT 0,
    "inserted_rows" INTEGER NOT NULL DEFAULT 0,
    "updated_rows" INTEGER NOT NULL DEFAULT 0,
    "unchanged_rows" INTEGER NOT NULL DEFAULT 0,
    "null_price_rows" INTEGER NOT NULL DEFAULT 0,
    "error_rows" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gas_mibgas_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "gas_mibgas_automation_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "schedule_time" VARCHAR(5) NOT NULL DEFAULT '22:30',
    "sync_current_year" BOOLEAN NOT NULL DEFAULT true,
    "last_run_key" VARCHAR(30),
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "gas_mibgas_automation_config_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ux_gas_mibgas_prices_natural_key" ON "gas_mibgas_prices"("trading_day", "product", "place_of_delivery", "area", "first_day_delivery", "last_day_delivery");
CREATE INDEX "gas_mibgas_prices_trading_day_idx" ON "gas_mibgas_prices"("trading_day");
CREATE INDEX "gas_mibgas_prices_product_idx" ON "gas_mibgas_prices"("product");
CREATE INDEX "gas_mibgas_prices_place_of_delivery_idx" ON "gas_mibgas_prices"("place_of_delivery");
CREATE INDEX "gas_mibgas_prices_area_idx" ON "gas_mibgas_prices"("area");
CREATE INDEX "gas_mibgas_prices_first_day_delivery_idx" ON "gas_mibgas_prices"("first_day_delivery");
CREATE INDEX "gas_mibgas_prices_last_day_delivery_idx" ON "gas_mibgas_prices"("last_day_delivery");
CREATE INDEX "gas_mibgas_prices_source_year_idx" ON "gas_mibgas_prices"("source_year");
CREATE INDEX "gas_mibgas_sync_runs_year_idx" ON "gas_mibgas_sync_runs"("year");
CREATE INDEX "gas_mibgas_sync_runs_run_type_idx" ON "gas_mibgas_sync_runs"("run_type");
CREATE INDEX "gas_mibgas_sync_runs_status_idx" ON "gas_mibgas_sync_runs"("status");
CREATE INDEX "gas_mibgas_sync_runs_started_at_idx" ON "gas_mibgas_sync_runs"("started_at");
