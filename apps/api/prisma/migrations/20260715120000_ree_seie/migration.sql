ALTER TYPE "ReeFileType" ADD VALUE IF NOT EXISTS 'SEIE';

CREATE TABLE "ree_seie_files" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "file_name" TEXT NOT NULL,
  "container_file_name" TEXT,
  "file_hash" TEXT NOT NULL,
  "tipo_archivo" "ReeFileType" NOT NULL,
  "version" TEXT NOT NULL,
  "fecha_liquidacion" DATE NOT NULL,
  "sujeto_eic" TEXT,
  "encoding" TEXT NOT NULL,
  "delimiter" TEXT NOT NULL,
  "status" "ReeImportStatus" NOT NULL DEFAULT 'IMPORTED',
  "error_message" TEXT,
  "original_content" BYTEA,
  "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "total_records" INTEGER NOT NULL DEFAULT 0,
  "valid_records" INTEGER NOT NULL DEFAULT 0,
  "invalid_records" INTEGER NOT NULL DEFAULT 0,
  "duplicated_records" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "ree_seie_files_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ree_seie_records" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "file_id" UUID NOT NULL,
  "upload_id" UUID NOT NULL,
  "filename" TEXT NOT NULL,
  "hash" TEXT NOT NULL,
  "fecha_carga" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version" TEXT NOT NULL,
  "fecha_liquidacion" DATE NOT NULL,
  "sujeto_eic" TEXT,
  "fecha" DATE,
  "hora" INTEGER,
  "codigo" TEXT,
  "magnitud" DECIMAL(20,6),
  "precio" DECIMAL(20,8),
  "energia" DECIMAL(20,6),
  "unidad" TEXT,
  "tipo" TEXT,
  "sentido" TEXT,
  "segmento" TEXT,
  "campo_01_fecha" TEXT,
  "campo_02_hora" TEXT,
  "campo_03_codigo" TEXT,
  "campo_04_magnitud" TEXT,
  "campo_05_reservado_1" TEXT,
  "campo_06_precio" TEXT,
  "campo_07_reservado_2" TEXT,
  "campo_08_energia" TEXT,
  "campo_09_reservado_3" TEXT,
  "campo_10_reservado_4" TEXT,
  "campo_11_tipo" TEXT,
  "campo_12_sentido" TEXT,
  "campo_13_unidad" TEXT,
  "campo_14_segmento" TEXT,
  "campo_15_signo_importe" TEXT,
  "campo_16_signo_magnitud" TEXT,
  "campo_17_sujeto_eic" TEXT,
  "campo_18_codigo_precio" TEXT,
  "campo_19_codigo_unidad_2" TEXT,
  "campo_20_codigo_unidad_3" TEXT,
  "campo_21_clase" TEXT,
  "campo_22_valor_1" TEXT,
  "campo_23_valor_2" TEXT,
  "campo_24_valor_3" TEXT,
  "validation_errors" JSONB,
  "raw_payload_json" JSONB NOT NULL,
  "raw_line" TEXT NOT NULL,
  "source_line_number" INTEGER NOT NULL,
  "record_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ree_seie_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ree_seie_files_file_hash_key" ON "ree_seie_files"("file_hash");
CREATE INDEX "ree_seie_files_tipo_archivo_idx" ON "ree_seie_files"("tipo_archivo");
CREATE INDEX "ree_seie_files_version_idx" ON "ree_seie_files"("version");
CREATE INDEX "ree_seie_files_fecha_liquidacion_idx" ON "ree_seie_files"("fecha_liquidacion");
CREATE INDEX "ree_seie_files_sujeto_eic_idx" ON "ree_seie_files"("sujeto_eic");
CREATE INDEX "ree_seie_files_imported_at_idx" ON "ree_seie_files"("imported_at");
CREATE UNIQUE INDEX "ree_seie_records_record_hash_key" ON "ree_seie_records"("record_hash");
CREATE INDEX "ree_seie_records_upload_id_idx" ON "ree_seie_records"("upload_id");
CREATE INDEX "ree_seie_records_hash_idx" ON "ree_seie_records"("hash");
CREATE INDEX "ree_seie_records_fecha_carga_idx" ON "ree_seie_records"("fecha_carga");
CREATE INDEX "ree_seie_records_fecha_idx" ON "ree_seie_records"("fecha");
CREATE INDEX "ree_seie_records_fecha_liquidacion_idx" ON "ree_seie_records"("fecha_liquidacion");
CREATE INDEX "ree_seie_records_codigo_idx" ON "ree_seie_records"("codigo");
CREATE INDEX "ree_seie_records_unidad_idx" ON "ree_seie_records"("unidad");
CREATE INDEX "ree_seie_records_tipo_idx" ON "ree_seie_records"("tipo");
CREATE INDEX "ree_seie_records_sentido_idx" ON "ree_seie_records"("sentido");
CREATE INDEX "ree_seie_records_segmento_idx" ON "ree_seie_records"("segmento");
CREATE INDEX "ree_seie_records_filename_idx" ON "ree_seie_records"("filename");
ALTER TABLE "ree_seie_records" ADD CONSTRAINT "ree_seie_records_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "ree_seie_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;
