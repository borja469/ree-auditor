CREATE TABLE "omie_automation_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "days_back" INTEGER NOT NULL DEFAULT 3,
    "session1" VARCHAR(5),
    "session2" VARCHAR(5),
    "session3" VARCHAR(5),
    "last_run_key" VARCHAR(30),
    "last_run_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "omie_automation_config_pkey" PRIMARY KEY ("id")
);

INSERT INTO "omie_automation_config" ("id", "active", "days_back", "session1", "session2", "session3", "updated_at")
VALUES (1, false, 3, '06:00', '12:00', '18:00', CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
