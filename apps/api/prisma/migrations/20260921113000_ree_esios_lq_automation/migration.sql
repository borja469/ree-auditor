CREATE TABLE "ree_esios_lq_automation_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "schedule_time" VARCHAR(5) NOT NULL DEFAULT '06:30',
    "days_back" INTEGER NOT NULL DEFAULT 7,
    "owner" VARCHAR(40) NOT NULL DEFAULT 'STROM',
    "sync_liqui_empresa" BOOLEAN NOT NULL DEFAULT true,
    "sync_liquicomun" BOOLEAN NOT NULL DEFAULT true,
    "last_run_key" VARCHAR(30),
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ree_esios_lq_automation_config_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ree_esios_lq_automation_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "trigger" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "execution_time_ms" INTEGER,
    "publication_from" DATE NOT NULL,
    "publication_to" DATE NOT NULL,
    "days_back" INTEGER NOT NULL,
    "owner" VARCHAR(40) NOT NULL,
    "sync_liqui_empresa" BOOLEAN NOT NULL,
    "sync_liquicomun" BOOLEAN NOT NULL,
    "total_publications" INTEGER NOT NULL DEFAULT 0,
    "imported_files" INTEGER NOT NULL DEFAULT 0,
    "skipped_files" INTEGER NOT NULL DEFAULT 0,
    "failed_items" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "result_json" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ree_esios_lq_automation_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ree_esios_lq_automation_runs_started_at_idx" ON "ree_esios_lq_automation_runs"("started_at");
CREATE INDEX "ree_esios_lq_automation_runs_status_idx" ON "ree_esios_lq_automation_runs"("status");
CREATE INDEX "ree_esios_lq_automation_runs_publication_from_publication_to_idx" ON "ree_esios_lq_automation_runs"("publication_from", "publication_to");
