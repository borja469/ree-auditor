CREATE TABLE "omie_reer_consum_results" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "fecha" DATE NOT NULL,
  "periodo" INTEGER NOT NULL,
  "periodo_etiqueta" VARCHAR(10) NOT NULL,
  "precio_publicado_eur_mwh" DECIMAL(20,12) NOT NULL,
  "volumen_economico_eur" DECIMAL(20,6) NOT NULL,
  "energia_nacional_mwh" DECIMAL(20,6) NOT NULL,
  "coeficiente_derivado_eur_mwh" DECIMAL(24,12) NOT NULL,
  "fichero_origen" VARCHAR(180) NOT NULL,
  "url_origen" VARCHAR(700) NOT NULL,
  "hash_fichero" VARCHAR(64) NOT NULL,
  "fecha_publicacion" TIMESTAMP(3),
  "fecha_carga" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "version_carga" INTEGER NOT NULL DEFAULT 1,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "omie_reer_consum_results_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ux_omie_reer_consum_fecha_periodo_version" ON "omie_reer_consum_results"("fecha", "periodo", "version_carga");
CREATE INDEX "omie_reer_consum_results_fecha_idx" ON "omie_reer_consum_results"("fecha");
CREATE INDEX "omie_reer_consum_results_fecha_version_carga_idx" ON "omie_reer_consum_results"("fecha", "version_carga");
CREATE INDEX "omie_reer_consum_results_hash_fichero_idx" ON "omie_reer_consum_results"("hash_fichero");

CREATE TABLE "omie_reer_official_annotations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "fecha" DATE NOT NULL,
  "periodo" INTEGER NOT NULL,
  "version" INTEGER NOT NULL,
  "ecreer_mwh" DECIMAL(20,6) NOT NULL,
  "epreer_eur_mwh" DECIMAL(20,12) NOT NULL,
  "eopreer_eur" DECIMAL(20,6) NOT NULL,
  "s_imp" INTEGER,
  "s_ene" INTEGER,
  "seg" VARCHAR(30),
  "cta" VARCHAR(30),
  "c_mag" VARCHAR(30),
  "c_prc" VARCHAR(30),
  "c_cpto" VARCHAR(30),
  "ses" VARCHAR(20),
  "fichero_origen" VARCHAR(180) NOT NULL,
  "hash_fichero" VARCHAR(64) NOT NULL,
  "fecha_carga" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "omie_reer_official_annotations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ux_omie_reer_official_fecha_periodo_version_file" ON "omie_reer_official_annotations"("fecha", "periodo", "version", "fichero_origen");
CREATE INDEX "omie_reer_official_annotations_fecha_idx" ON "omie_reer_official_annotations"("fecha");
CREATE INDEX "omie_reer_official_annotations_fecha_version_idx" ON "omie_reer_official_annotations"("fecha", "version");
CREATE INDEX "omie_reer_official_annotations_hash_fichero_idx" ON "omie_reer_official_annotations"("hash_fichero");
