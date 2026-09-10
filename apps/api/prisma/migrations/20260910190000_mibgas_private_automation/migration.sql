CREATE TABLE IF NOT EXISTS "mibgas_private_automation_config" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "days_back" INTEGER NOT NULL DEFAULT 1,
  "days_forward" INTEGER NOT NULL DEFAULT 3,
  "session1" VARCHAR(5),
  "session2" VARCHAR(5),
  "session3" VARCHAR(5),
  "last_run_key" VARCHAR(30),
  "last_run_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mibgas_private_automation_config_pkey" PRIMARY KEY ("id")
);
