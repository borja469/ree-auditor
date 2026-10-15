CREATE TABLE "sips_config" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "environment" VARCHAR(20) NOT NULL DEFAULT 'production',
  "consumer_key_encrypted" TEXT,
  "consumer_secret_encrypted" TEXT,
  "connection_status" VARCHAR(30) NOT NULL DEFAULT 'UNTESTED',
  "last_connection_test" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sips_config_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "sips_queries" (
  "id" UUID NOT NULL,
  "cups" VARCHAR(24) NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "queried_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" VARCHAR(30) NOT NULL,
  "record_count" INTEGER NOT NULL DEFAULT 0,
  "reference_date" DATE,
  "error_code" VARCHAR(40),
  "content_hash" VARCHAR(64),
  "snapshot_encrypted" TEXT,
  "requested_by" VARCHAR(120) NOT NULL,
  CONSTRAINT "sips_queries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sips_queries_cups_queried_at_idx" ON "sips_queries"("cups", "queried_at");
CREATE TABLE "sips_ps" (
  "cups" VARCHAR(24) NOT NULL,
  "distributor" VARCHAR(255),
  "tariff" VARCHAR(40),
  "normalized" JSONB NOT NULL,
  "raw_encrypted" TEXT NOT NULL,
  "content_hash" VARCHAR(64) NOT NULL,
  "reference_date" DATE,
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sips_ps_pkey" PRIMARY KEY ("cups")
);
CREATE TABLE "sips_consumptions" (
  "id" UUID NOT NULL,
  "cups" VARCHAR(24) NOT NULL,
  "date_from" DATE NOT NULL,
  "date_to" DATE NOT NULL,
  "tariff" VARCHAR(40),
  "normalized" JSONB NOT NULL,
  "raw" JSONB NOT NULL,
  "content_hash" VARCHAR(64) NOT NULL,
  "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sips_consumptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sips_consumptions_cups_date_from_date_to_key" ON "sips_consumptions"("cups", "date_from", "date_to");
CREATE INDEX "sips_consumptions_cups_date_to_idx" ON "sips_consumptions"("cups", "date_to");
