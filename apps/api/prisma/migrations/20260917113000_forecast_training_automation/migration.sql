CREATE TABLE "forecast_training_automation_config" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "schedule_time" VARCHAR(5) NOT NULL DEFAULT '02:00',
  "training_start_date" DATE NOT NULL DEFAULT '2025-01-01',
  "modelo" VARCHAR(60) NOT NULL DEFAULT 'gradientBoostingD1',
  "use_active_model_type" BOOLEAN NOT NULL DEFAULT true,
  "geo_id" INTEGER,
  "last_run_key" VARCHAR(32),
  "last_run_at" TIMESTAMP(3),
  "last_job_id" UUID,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "forecast_training_automation_config_pkey" PRIMARY KEY ("id")
);

INSERT INTO "forecast_training_automation_config" ("id")
VALUES (1)
ON CONFLICT ("id") DO NOTHING;
