ALTER TYPE "OmieDownloadEstado" ADD VALUE IF NOT EXISTS 'SIN_DATOS';

ALTER TABLE "omie_reer_official_annotations"
  ADD COLUMN IF NOT EXISTS "agente" VARCHAR(30) NOT NULL DEFAULT 'STROM',
  ADD COLUMN IF NOT EXISTS "codigo_documento" VARCHAR(10) NOT NULL DEFAULT '9230',
  ADD COLUMN IF NOT EXISTS "contenido_xml" TEXT,
  ADD COLUMN IF NOT EXISTS "estado" "OmieDownloadEstado" NOT NULL DEFAULT 'PROCESADO',
  ADD COLUMN IF NOT EXISTS "registros" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "mensaje_error" TEXT,
  ADD COLUMN IF NOT EXISTS "fecha_descarga" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "omie_reer_official_annotations_fecha_version_agente_idx"
  ON "omie_reer_official_annotations"("fecha", "version", "agente");

CREATE INDEX IF NOT EXISTS "omie_reer_official_annotations_codigo_documento_idx"
  ON "omie_reer_official_annotations"("codigo_documento");

CREATE INDEX IF NOT EXISTS "omie_reer_official_annotations_estado_idx"
  ON "omie_reer_official_annotations"("estado");
