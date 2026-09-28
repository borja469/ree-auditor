CREATE TABLE IF NOT EXISTS "cm_billing_jobs" (
  "id" UUID NOT NULL,
  "type" VARCHAR(40) NOT NULL,
  "status" VARCHAR(30) NOT NULL DEFAULT 'QUEUED',
  "requested_by" VARCHAR(120),
  "params" JSONB,
  "result" JSONB,
  "total_items" INTEGER NOT NULL DEFAULT 0,
  "processed_items" INTEGER NOT NULL DEFAULT 0,
  "success_count" INTEGER NOT NULL DEFAULT 0,
  "error_count" INTEGER NOT NULL DEFAULT 0,
  "current_item" VARCHAR(255),
  "message" TEXT,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "cm_billing_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "cm_billing_jobs_type_status_idx" ON "cm_billing_jobs"("type", "status");
CREATE INDEX IF NOT EXISTS "cm_billing_jobs_created_at_idx" ON "cm_billing_jobs"("created_at");
