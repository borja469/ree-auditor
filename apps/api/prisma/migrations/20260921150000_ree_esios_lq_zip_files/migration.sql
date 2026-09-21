CREATE TABLE "ree_esios_lq_zip_files" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "month" VARCHAR(7) NOT NULL,
  "settlement" VARCHAR(2) NOT NULL,
  "family" VARCHAR(20) NOT NULL,
  "owner" VARCHAR(40) NOT NULL,
  "message_id" VARCHAR(180) NOT NULL,
  "code" VARCHAR(40) NOT NULL,
  "message_type" VARCHAR(80),
  "message_owner" VARCHAR(80),
  "publication_date" DATE NOT NULL,
  "message_date" TIMESTAMP(3),
  "file_version" INTEGER NOT NULL DEFAULT 0,
  "zip_name" VARCHAR(240) NOT NULL,
  "file_path" TEXT NOT NULL,
  "sha256" VARCHAR(64) NOT NULL,
  "bytes" INTEGER NOT NULL,
  "downloaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ree_esios_lq_zip_files_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ree_esios_lq_zip_latest_unique" ON "ree_esios_lq_zip_files"("month", "settlement", "family", "owner");
CREATE INDEX "ree_esios_lq_zip_files_month_settlement_idx" ON "ree_esios_lq_zip_files"("month", "settlement");
CREATE INDEX "ree_esios_lq_zip_files_publication_date_idx" ON "ree_esios_lq_zip_files"("publication_date");
