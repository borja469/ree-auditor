CREATE TABLE "esios_series_automation_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "schedule_time" VARCHAR(5) NOT NULL DEFAULT '06:00',
    "days_back" INTEGER NOT NULL DEFAULT 7,
    "days_forward" INTEGER NOT NULL DEFAULT 0,
    "selected_indicator_ids" JSONB NOT NULL DEFAULT '[]',
    "last_run_key" VARCHAR(30),
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esios_series_automation_config_pkey" PRIMARY KEY ("id")
);
