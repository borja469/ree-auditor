CREATE TABLE "mir_config" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "api_url" VARCHAR(1000),
  "contracts_path" VARCHAR(500) NOT NULL DEFAULT '/contracts',
  "username" VARCHAR(255),
  "password" TEXT,
  "timeout_ms" INTEGER NOT NULL DEFAULT 60000,
  "retries" INTEGER NOT NULL DEFAULT 3,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mir_config_pkey" PRIMARY KEY ("id")
);

INSERT INTO "mir_config" ("id", "api_url", "contracts_path", "username", "password", "timeout_ms", "retries", "updated_at")
VALUES (
  1,
  NULLIF(current_setting('app.mir_api_url', true), ''),
  '/contracts',
  NULL,
  NULL,
  60000,
  3,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
