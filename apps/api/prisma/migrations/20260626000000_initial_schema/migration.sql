-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ReeFileType" AS ENUM ('REGANECU', 'REGANECUQH');

-- CreateEnum
CREATE TYPE "ReeSettlementVersion" AS ENUM ('A1', 'C1', 'C2', 'C3', 'C4', 'C5');

-- CreateEnum
CREATE TYPE "ReeImportStatus" AS ENUM ('IMPORTED', 'FAILED', 'DUPLICATED');

-- CreateEnum
CREATE TYPE "MedperFileType" AS ENUM ('MEDPERUP', 'MEDPERQH');

-- CreateEnum
CREATE TYPE "ReeKFactorFileType" AS ENUM ('KESTIMQH', 'KREALQH');

-- CreateEnum
CREATE TYPE "OmieTipoDocumento" AS ENUM ('PVD', 'PHF');

-- CreateEnum
CREATE TYPE "OmieDownloadEstado" AS ENUM ('PENDIENTE', 'DESCARGANDO', 'DESCARGADO', 'PROCESADO', 'ERROR');

-- CreateEnum
CREATE TYPE "OmieTipoPrecio" AS ENUM ('MD', 'MI', 'XBID');

-- CreateTable
CREATE TABLE "ree_files" (
    "id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "container_file_name" TEXT,
    "file_hash" TEXT NOT NULL,
    "tipo_archivo" "ReeFileType" NOT NULL,
    "version" "ReeSettlementVersion" NOT NULL,
    "fecha_liquidacion" DATE NOT NULL,
    "sujeto_eic" TEXT NOT NULL,
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

    CONSTRAINT "ree_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medper_files" (
    "id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "container_file_name" TEXT,
    "file_hash" TEXT NOT NULL,
    "tipo_archivo" "MedperFileType" NOT NULL,
    "version" TEXT NOT NULL,
    "fecha_inicio" DATE NOT NULL,
    "fecha_fin" DATE NOT NULL,
    "sujeto_eic" TEXT NOT NULL,
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

    CONSTRAINT "medper_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reganecu_records" (
    "id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "tipo_archivo" "ReeFileType" NOT NULL,
    "version" "ReeSettlementVersion" NOT NULL,
    "fecha_liquidacion" DATE NOT NULL,
    "sujeto_eic" TEXT NOT NULL,
    "brp" TEXT,
    "fecha" DATE,
    "hora" INTEGER,
    "codigo_upr" TEXT,
    "energia_mwh" DECIMAL(20,6),
    "precio_eur_mwh" DECIMAL(20,8),
    "importe_eur" DECIMAL(20,6),
    "codigo_agente_vendedor" TEXT,
    "segmento" TEXT,
    "facturacion" TEXT,
    "eic_upr" TEXT,
    "cuenta" TEXT,
    "signo_importe" TEXT,
    "signo_magnitud" TEXT,
    "eic_titular" TEXT,
    "codigo_magnitud" TEXT,
    "codigo_precio" TEXT,
    "codigo_apunte" TEXT,
    "tipo_oferta" TEXT,
    "tipo_upr" TEXT,
    "energia_contrato_bilateral_mwh" DECIMAL(20,6),
    "sesion" TEXT,
    "importe_calculado_eur" DECIMAL(20,6),
    "importe_diferencia_eur" DECIMAL(20,6),
    "importe_consistente" BOOLEAN NOT NULL DEFAULT true,
    "precio_anomalo" BOOLEAN NOT NULL DEFAULT false,
    "validation_errors" JSONB,
    "raw_payload_json" JSONB NOT NULL,
    "raw_line" TEXT NOT NULL,
    "source_line_number" INTEGER NOT NULL,
    "record_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reganecu_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reganecu_qh_records" (
    "id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "tipo_archivo" "ReeFileType" NOT NULL,
    "version" "ReeSettlementVersion" NOT NULL,
    "fecha_liquidacion" DATE NOT NULL,
    "sujeto_eic" TEXT NOT NULL,
    "brp" TEXT,
    "fecha" DATE,
    "hora" INTEGER,
    "codigo_upr" TEXT,
    "energia_mwh" DECIMAL(20,6),
    "precio_eur_mwh" DECIMAL(20,8),
    "importe_eur" DECIMAL(20,6),
    "codigo_agente_vendedor" TEXT,
    "segmento" TEXT,
    "facturacion" TEXT,
    "eic_upr" TEXT,
    "cuenta" TEXT,
    "signo_importe" TEXT,
    "signo_magnitud" TEXT,
    "eic_titular" TEXT,
    "codigo_magnitud" TEXT,
    "codigo_precio" TEXT,
    "codigo_apunte" TEXT,
    "tipo_oferta" TEXT,
    "tipo_upr" TEXT,
    "energia_contrato_bilateral_mwh" DECIMAL(20,6),
    "campo_hora_25" TEXT,
    "importe_calculado_eur" DECIMAL(20,6),
    "importe_diferencia_eur" DECIMAL(20,6),
    "importe_consistente" BOOLEAN NOT NULL DEFAULT true,
    "precio_anomalo" BOOLEAN NOT NULL DEFAULT false,
    "validation_errors" JSONB,
    "raw_payload_json" JSONB NOT NULL,
    "raw_line" TEXT NOT NULL,
    "source_line_number" INTEGER NOT NULL,
    "record_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reganecu_qh_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medperup_records" (
    "id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "tipo_archivo" "MedperFileType" NOT NULL,
    "version" TEXT NOT NULL,
    "fecha_inicio" DATE NOT NULL,
    "fecha_fin" DATE NOT NULL,
    "sujeto_eic" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "hora" INTEGER NOT NULL,
    "codigo_upr" TEXT NOT NULL,
    "tipo_tarifa" TEXT,
    "codigo_nivel_tension" TEXT,
    "concepto" TEXT,
    "medida_mwh" DECIMAL(20,6),
    "negative_energy" BOOLEAN NOT NULL DEFAULT false,
    "validation_errors" JSONB,
    "raw_payload_json" JSONB NOT NULL,
    "raw_line" TEXT NOT NULL,
    "source_line_number" INTEGER NOT NULL,
    "record_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medperup_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medperqh_records" (
    "id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "tipo_archivo" "MedperFileType" NOT NULL,
    "version" TEXT NOT NULL,
    "fecha_inicio" DATE NOT NULL,
    "fecha_fin" DATE NOT NULL,
    "sujeto_eic" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "hora" INTEGER NOT NULL,
    "cuarto_hora" INTEGER NOT NULL,
    "codigo_unidad" TEXT NOT NULL,
    "peaje" TEXT,
    "programa_energia_mwh" DECIMAL(20,6),
    "perdidas_mwh" DECIMAL(20,6),
    "bc_mwh" DECIMAL(20,6),
    "pf_mwh" DECIMAL(20,6),
    "bc_pf_difference_mwh" DECIMAL(20,6),
    "negative_energy" BOOLEAN NOT NULL DEFAULT false,
    "bc_pf_inconsistent" BOOLEAN NOT NULL DEFAULT false,
    "validation_errors" JSONB,
    "raw_payload_json" JSONB NOT NULL,
    "raw_line" TEXT NOT NULL,
    "source_line_number" INTEGER NOT NULL,
    "record_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "medperqh_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_overwrite_audits" (
    "id" UUID NOT NULL,
    "usuario" TEXT NOT NULL,
    "tipo_archivo" TEXT NOT NULL,
    "fecha" DATE NOT NULL,
    "version" TEXT NOT NULL,
    "replaced_file_id" UUID NOT NULL,
    "replaced_file_name" TEXT NOT NULL,
    "replaced_imported_at" TIMESTAMP(3) NOT NULL,
    "new_file_id" UUID NOT NULL,
    "new_file_name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_overwrite_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "perdidas_boe" (
    "id" UUID NOT NULL,
    "tarifa" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "porcentaje_perdida" DECIMAL(10,6) NOT NULL,
    "fecha_inicio" DATE NOT NULL,
    "fecha_fin" DATE NOT NULL,
    "version_boe" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "perdidas_boe_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendario_festivos" (
    "fecha" DATE NOT NULL,
    "descripcion" TEXT NOT NULL,
    "ambito" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "calendario_festivos_pkey" PRIMARY KEY ("fecha","ambito")
);

-- CreateTable
CREATE TABLE "tarifas_periodos" (
    "id" UUID NOT NULL,
    "tarifa" TEXT NOT NULL,
    "temporada" TEXT NOT NULL,
    "tipo_dia" TEXT NOT NULL,
    "hora" INTEGER NOT NULL,
    "cuartohora" INTEGER NOT NULL,
    "periodo" TEXT NOT NULL,
    "mes" INTEGER NOT NULL,
    "sistema" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tarifas_periodos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ree_k_factor" (
    "id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "hora" INTEGER NOT NULL,
    "cuartohora" INTEGER NOT NULL,
    "version" "ReeSettlementVersion" NOT NULL,
    "tipo_archivo" "ReeKFactorFileType" NOT NULL,
    "tarifa" TEXT NOT NULL,
    "periodo" TEXT NOT NULL,
    "valor_k" DECIMAL(20,10) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ree_k_factor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ree_k_factor_imports" (
    "id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "container_file_name" TEXT,
    "file_hash" TEXT,
    "tipo_archivo" "ReeKFactorFileType",
    "version" "ReeSettlementVersion",
    "fecha_inicio" DATE,
    "fecha_fin" DATE,
    "status" "ReeImportStatus" NOT NULL DEFAULT 'IMPORTED',
    "error_message" TEXT,
    "imported_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_records" INTEGER NOT NULL DEFAULT 0,
    "valid_records" INTEGER NOT NULL DEFAULT 0,
    "invalid_records" INTEGER NOT NULL DEFAULT 0,
    "duplicated_records" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ree_k_factor_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "omie_downloads" (
    "id" UUID NOT NULL,
    "tipo_documento" "OmieTipoDocumento" NOT NULL,
    "fecha_programa" DATE NOT NULL,
    "sesion" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "u_ofertante" TEXT NOT NULL DEFAULT 'STROC01',
    "fecha_descarga" TIMESTAMP(3) NOT NULL,
    "estado" "OmieDownloadEstado" NOT NULL DEFAULT 'PENDIENTE',
    "registros" INTEGER NOT NULL DEFAULT 0,
    "hash_contenido" TEXT,
    "nombre_fichero" TEXT,
    "mensaje_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "omie_downloads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "omie_programas" (
    "id" UUID NOT NULL,
    "tipo_programa" "OmieTipoDocumento" NOT NULL,
    "fecha_programa" DATE NOT NULL,
    "sesion" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "u_ofertante" TEXT NOT NULL,
    "periodo" INTEGER NOT NULL,
    "descripcion_periodo" TEXT NOT NULL,
    "clave" TEXT NOT NULL,
    "energia_mwh" DECIMAL(20,6) NOT NULL,
    "fecha_descarga" TIMESTAMP(3) NOT NULL,
    "download_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "omie_programas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "omie_transaction_downloads" (
    "id" UUID NOT NULL,
    "codigo_consulta" TEXT NOT NULL DEFAULT '4121',
    "fecha_desde" DATE NOT NULL,
    "fecha_hasta" DATE NOT NULL,
    "fecha_descarga" TIMESTAMP(3) NOT NULL,
    "estado" "OmieDownloadEstado" NOT NULL DEFAULT 'PENDIENTE',
    "registros" INTEGER NOT NULL DEFAULT 0,
    "dias_consultados" INTEGER NOT NULL DEFAULT 0,
    "columnas" JSONB,
    "resumen_estructura" JSONB,
    "hash_contenido" TEXT,
    "nombre_fichero" TEXT,
    "mensaje_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "omie_transaction_downloads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "omie_transaction_staging" (
    "id" UUID NOT NULL,
    "download_id" UUID NOT NULL,
    "dia_contrato" DATE NOT NULL,
    "row_index" INTEGER NOT NULL,
    "raw_payload_json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "omie_transaction_staging_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "omie_price_downloads" (
    "id" UUID NOT NULL,
    "tipo_precio" "OmieTipoPrecio" NOT NULL,
    "fecha_programa" DATE NOT NULL,
    "sesion" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fecha_descarga" TIMESTAMP(3) NOT NULL,
    "estado" "OmieDownloadEstado" NOT NULL DEFAULT 'PENDIENTE',
    "registros" INTEGER NOT NULL DEFAULT 0,
    "hash_contenido" TEXT,
    "mensaje_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "omie_price_downloads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "omie_prices" (
    "id" UUID NOT NULL,
    "tipo_precio" "OmieTipoPrecio" NOT NULL,
    "fecha_programa" DATE NOT NULL,
    "sesion" TEXT,
    "periodo" INTEGER NOT NULL,
    "clave" TEXT NOT NULL,
    "precio_eur_mwh" DECIMAL(20,6) NOT NULL,
    "fecha_descarga" TIMESTAMP(3) NOT NULL,
    "download_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "omie_prices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "omie_liquidation_invoices" (
    "fecha" DATE NOT NULL,
    "factura_compra" DECIMAL(20,2),
    "factura_venta" DECIMAL(20,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "omie_liquidation_invoices_pkey" PRIMARY KEY ("fecha")
);

-- CreateTable
CREATE TABLE "esios_config" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "api_url" VARCHAR(500) NOT NULL DEFAULT 'https://api.esios.ree.es',
    "api_token" TEXT,
    "timeout_seconds" INTEGER NOT NULL DEFAULT 60,
    "retries" INTEGER NOT NULL DEFAULT 3,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esios_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esios_indicators" (
    "id" BIGSERIAL NOT NULL,
    "indicator_id" INTEGER NOT NULL,
    "name" VARCHAR(500),
    "description" TEXT,
    "short_name" VARCHAR(255),
    "unit" VARCHAR(100),
    "frequency" VARCHAR(50),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esios_indicators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esios_indicator_values" (
    "id" BIGSERIAL NOT NULL,
    "indicator_id" INTEGER NOT NULL,
    "datetime" TIMESTAMP(3) NOT NULL,
    "datetime_utc" TIMESTAMP(3),
    "value" DECIMAL(18,6),
    "geo_id" INTEGER,
    "geo_name" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esios_indicator_values_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esios_download_logs" (
    "id" BIGSERIAL NOT NULL,
    "indicator_id" INTEGER,
    "start_date" TIMESTAMP(3),
    "end_date" TIMESTAMP(3),
    "downloaded_records" INTEGER NOT NULL DEFAULT 0,
    "inserted_records" INTEGER NOT NULL DEFAULT 0,
    "updated_records" INTEGER NOT NULL DEFAULT 0,
    "execution_time_ms" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(50) NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "esios_download_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esios_profile_uploads" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by" TEXT,
    "status" VARCHAR(30) NOT NULL,
    "error_message" TEXT,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esios_profile_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esios_initial_profiles" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "hour" INTEGER NOT NULL,
    "datetime" TIMESTAMP(3) NOT NULL,
    "profile_20td" DECIMAL(20,15) NOT NULL,
    "profile_30td" DECIMAL(20,15) NOT NULL,
    "profile_30tdve" DECIMAL(20,15) NOT NULL,
    "reference_demand_mw" DECIMAL(20,6) NOT NULL,
    "upload_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esios_initial_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esios_profile_coefficients" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "tariff" VARCHAR(20) NOT NULL,
    "alpha" DECIMAL(20,15) NOT NULL,
    "beta" DECIMAL(20,15) NOT NULL,
    "gamma" DECIMAL(20,15) NOT NULL,
    "upload_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esios_profile_coefficients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esios_profile_intermediate_results" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "datetime" TIMESTAMP(3) NOT NULL,
    "month" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "hour" INTEGER NOT NULL,
    "tariff" VARCHAR(20) NOT NULL,
    "initial_profile" DECIMAL(20,15) NOT NULL,
    "h0" DECIMAL(20,15) NOT NULL,
    "h1" DECIMAL(20,15) NOT NULL,
    "hf" DECIMAL(20,15) NOT NULL,
    "c0" DECIMAL(20,15) NOT NULL,
    "c1" DECIMAL(20,15) NOT NULL,
    "cf" DECIMAL(20,15) NOT NULL,
    "m0" DECIMAL(20,15) NOT NULL,
    "m1" DECIMAL(20,15) NOT NULL,
    "intermediate_profile" DECIMAL(20,15) NOT NULL,
    "demand_used_mw" DECIMAL(20,6) NOT NULL,
    "demand_source" VARCHAR(50) NOT NULL,
    "reference_demand_mw" DECIMAL(20,6) NOT NULL,
    "forecast_demand_mw" DECIMAL(20,6),
    "final_demand_mw" DECIMAL(20,6),
    "system_demand_mw" DECIMAL(20,6),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esios_profile_intermediate_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esios_ree_final_demand_uploads" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "day" INTEGER,
    "period_key" TEXT,
    "file_name" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by" TEXT,
    "status" VARCHAR(30) NOT NULL,
    "error_message" TEXT,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esios_ree_final_demand_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esios_ree_final_demands" (
    "id" UUID NOT NULL,
    "upload_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "hour" INTEGER NOT NULL,
    "datetime" TIMESTAMP(3) NOT NULL,
    "dst_flag" INTEGER,
    "demand_mw" DECIMAL(20,6) NOT NULL,
    "raw_line" TEXT NOT NULL,
    "source_line" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esios_ree_final_demands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esios_ree_final_profile_uploads" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "file_name" TEXT NOT NULL,
    "file_hash" TEXT NOT NULL,
    "uploaded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_by" TEXT,
    "status" VARCHAR(30) NOT NULL,
    "error_message" TEXT,
    "total_rows" INTEGER NOT NULL DEFAULT 0,
    "valid_rows" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esios_ree_final_profile_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esios_ree_final_profiles" (
    "id" UUID NOT NULL,
    "upload_id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "month" INTEGER NOT NULL,
    "day" INTEGER NOT NULL,
    "hour" INTEGER NOT NULL,
    "datetime" TIMESTAMP(3) NOT NULL,
    "dst_flag" INTEGER,
    "profile_20td" DECIMAL(20,15) NOT NULL,
    "profile_30td" DECIMAL(20,15) NOT NULL,
    "profile_30tdve" DECIMAL(20,15) NOT NULL,
    "raw_line" TEXT NOT NULL,
    "source_line" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "esios_ree_final_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "esios_profile_calculation_logs" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "execution_time_ms" INTEGER,
    "rows_processed" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "esios_profile_calculation_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ree_files_file_hash_idx" ON "ree_files"("file_hash");

-- CreateIndex
CREATE INDEX "ree_files_tipo_archivo_idx" ON "ree_files"("tipo_archivo");

-- CreateIndex
CREATE INDEX "ree_files_version_idx" ON "ree_files"("version");

-- CreateIndex
CREATE INDEX "ree_files_fecha_liquidacion_idx" ON "ree_files"("fecha_liquidacion");

-- CreateIndex
CREATE INDEX "ree_files_sujeto_eic_idx" ON "ree_files"("sujeto_eic");

-- CreateIndex
CREATE INDEX "ree_files_imported_at_idx" ON "ree_files"("imported_at");

-- CreateIndex
CREATE UNIQUE INDEX "ree_files_tipo_archivo_fecha_liquidacion_version_key" ON "ree_files"("tipo_archivo", "fecha_liquidacion", "version");

-- CreateIndex
CREATE INDEX "medper_files_file_hash_idx" ON "medper_files"("file_hash");

-- CreateIndex
CREATE INDEX "medper_files_tipo_archivo_idx" ON "medper_files"("tipo_archivo");

-- CreateIndex
CREATE INDEX "medper_files_version_idx" ON "medper_files"("version");

-- CreateIndex
CREATE INDEX "medper_files_fecha_inicio_idx" ON "medper_files"("fecha_inicio");

-- CreateIndex
CREATE INDEX "medper_files_fecha_fin_idx" ON "medper_files"("fecha_fin");

-- CreateIndex
CREATE INDEX "medper_files_sujeto_eic_idx" ON "medper_files"("sujeto_eic");

-- CreateIndex
CREATE INDEX "medper_files_imported_at_idx" ON "medper_files"("imported_at");

-- CreateIndex
CREATE UNIQUE INDEX "medper_files_tipo_archivo_fecha_inicio_version_key" ON "medper_files"("tipo_archivo", "fecha_inicio", "version");

-- CreateIndex
CREATE INDEX "reganecu_records_fecha_idx" ON "reganecu_records"("fecha");

-- CreateIndex
CREATE INDEX "reganecu_records_fecha_liquidacion_idx" ON "reganecu_records"("fecha_liquidacion");

-- CreateIndex
CREATE INDEX "reganecu_records_version_idx" ON "reganecu_records"("version");

-- CreateIndex
CREATE INDEX "reganecu_records_segmento_idx" ON "reganecu_records"("segmento");

-- CreateIndex
CREATE INDEX "reganecu_records_codigo_apunte_idx" ON "reganecu_records"("codigo_apunte");

-- CreateIndex
CREATE INDEX "reganecu_records_codigo_precio_idx" ON "reganecu_records"("codigo_precio");

-- CreateIndex
CREATE INDEX "reganecu_records_sujeto_eic_idx" ON "reganecu_records"("sujeto_eic");

-- CreateIndex
CREATE INDEX "reganecu_records_brp_idx" ON "reganecu_records"("brp");

-- CreateIndex
CREATE INDEX "reganecu_records_eic_upr_idx" ON "reganecu_records"("eic_upr");

-- CreateIndex
CREATE INDEX "reganecu_records_codigo_upr_idx" ON "reganecu_records"("codigo_upr");

-- CreateIndex
CREATE UNIQUE INDEX "reganecu_records_record_hash_key" ON "reganecu_records"("record_hash");

-- CreateIndex
CREATE INDEX "reganecu_qh_records_fecha_idx" ON "reganecu_qh_records"("fecha");

-- CreateIndex
CREATE INDEX "reganecu_qh_records_fecha_liquidacion_idx" ON "reganecu_qh_records"("fecha_liquidacion");

-- CreateIndex
CREATE INDEX "reganecu_qh_records_version_idx" ON "reganecu_qh_records"("version");

-- CreateIndex
CREATE INDEX "reganecu_qh_records_segmento_idx" ON "reganecu_qh_records"("segmento");

-- CreateIndex
CREATE INDEX "reganecu_qh_records_codigo_apunte_idx" ON "reganecu_qh_records"("codigo_apunte");

-- CreateIndex
CREATE INDEX "reganecu_qh_records_codigo_precio_idx" ON "reganecu_qh_records"("codigo_precio");

-- CreateIndex
CREATE INDEX "reganecu_qh_records_sujeto_eic_idx" ON "reganecu_qh_records"("sujeto_eic");

-- CreateIndex
CREATE INDEX "reganecu_qh_records_brp_idx" ON "reganecu_qh_records"("brp");

-- CreateIndex
CREATE INDEX "reganecu_qh_records_eic_upr_idx" ON "reganecu_qh_records"("eic_upr");

-- CreateIndex
CREATE INDEX "reganecu_qh_records_codigo_upr_idx" ON "reganecu_qh_records"("codigo_upr");

-- CreateIndex
CREATE UNIQUE INDEX "reganecu_qh_records_record_hash_key" ON "reganecu_qh_records"("record_hash");

-- CreateIndex
CREATE INDEX "medperup_records_fecha_idx" ON "medperup_records"("fecha");

-- CreateIndex
CREATE INDEX "medperup_records_timestamp_idx" ON "medperup_records"("timestamp");

-- CreateIndex
CREATE INDEX "medperup_records_version_idx" ON "medperup_records"("version");

-- CreateIndex
CREATE INDEX "medperup_records_sujeto_eic_idx" ON "medperup_records"("sujeto_eic");

-- CreateIndex
CREATE INDEX "medperup_records_codigo_upr_idx" ON "medperup_records"("codigo_upr");

-- CreateIndex
CREATE INDEX "medperup_records_tipo_tarifa_idx" ON "medperup_records"("tipo_tarifa");

-- CreateIndex
CREATE INDEX "medperup_records_codigo_nivel_tension_idx" ON "medperup_records"("codigo_nivel_tension");

-- CreateIndex
CREATE INDEX "medperup_records_concepto_idx" ON "medperup_records"("concepto");

-- CreateIndex
CREATE UNIQUE INDEX "medperup_records_record_hash_key" ON "medperup_records"("record_hash");

-- CreateIndex
CREATE INDEX "medperqh_records_fecha_idx" ON "medperqh_records"("fecha");

-- CreateIndex
CREATE INDEX "medperqh_records_timestamp_idx" ON "medperqh_records"("timestamp");

-- CreateIndex
CREATE INDEX "medperqh_records_version_idx" ON "medperqh_records"("version");

-- CreateIndex
CREATE INDEX "medperqh_records_sujeto_eic_idx" ON "medperqh_records"("sujeto_eic");

-- CreateIndex
CREATE INDEX "medperqh_records_codigo_unidad_idx" ON "medperqh_records"("codigo_unidad");

-- CreateIndex
CREATE INDEX "medperqh_records_peaje_idx" ON "medperqh_records"("peaje");

-- CreateIndex
CREATE INDEX "medperqh_records_negative_energy_idx" ON "medperqh_records"("negative_energy");

-- CreateIndex
CREATE INDEX "medperqh_records_bc_pf_inconsistent_idx" ON "medperqh_records"("bc_pf_inconsistent");

-- CreateIndex
CREATE UNIQUE INDEX "medperqh_records_record_hash_key" ON "medperqh_records"("record_hash");

-- CreateIndex
CREATE INDEX "import_overwrite_audits_tipo_archivo_fecha_version_idx" ON "import_overwrite_audits"("tipo_archivo", "fecha", "version");

-- CreateIndex
CREATE INDEX "import_overwrite_audits_created_at_idx" ON "import_overwrite_audits"("created_at");

-- CreateIndex
CREATE INDEX "perdidas_boe_tarifa_idx" ON "perdidas_boe"("tarifa");

-- CreateIndex
CREATE INDEX "perdidas_boe_periodo_idx" ON "perdidas_boe"("periodo");

-- CreateIndex
CREATE INDEX "perdidas_boe_fecha_inicio_fecha_fin_idx" ON "perdidas_boe"("fecha_inicio", "fecha_fin");

-- CreateIndex
CREATE UNIQUE INDEX "perdidas_boe_tarifa_periodo_fecha_inicio_fecha_fin_version__key" ON "perdidas_boe"("tarifa", "periodo", "fecha_inicio", "fecha_fin", "version_boe");

-- CreateIndex
CREATE INDEX "calendario_festivos_ambito_idx" ON "calendario_festivos"("ambito");

-- CreateIndex
CREATE INDEX "tarifas_periodos_tarifa_idx" ON "tarifas_periodos"("tarifa");

-- CreateIndex
CREATE INDEX "tarifas_periodos_periodo_idx" ON "tarifas_periodos"("periodo");

-- CreateIndex
CREATE INDEX "tarifas_periodos_mes_idx" ON "tarifas_periodos"("mes");

-- CreateIndex
CREATE INDEX "tarifas_periodos_sistema_idx" ON "tarifas_periodos"("sistema");

-- CreateIndex
CREATE UNIQUE INDEX "tarifas_periodos_tarifa_mes_tipo_dia_hora_cuartohora_sistem_key" ON "tarifas_periodos"("tarifa", "mes", "tipo_dia", "hora", "cuartohora", "sistema");

-- CreateIndex
CREATE INDEX "ree_k_factor_fecha_idx" ON "ree_k_factor"("fecha");

-- CreateIndex
CREATE INDEX "ree_k_factor_version_idx" ON "ree_k_factor"("version");

-- CreateIndex
CREATE INDEX "ree_k_factor_tipo_archivo_idx" ON "ree_k_factor"("tipo_archivo");

-- CreateIndex
CREATE INDEX "ree_k_factor_tarifa_idx" ON "ree_k_factor"("tarifa");

-- CreateIndex
CREATE INDEX "ree_k_factor_periodo_idx" ON "ree_k_factor"("periodo");

-- CreateIndex
CREATE INDEX "ree_k_factor_fecha_hora_cuartohora_idx" ON "ree_k_factor"("fecha", "hora", "cuartohora");

-- CreateIndex
CREATE INDEX "ree_k_factor_fecha_hora_cuartohora_tarifa_periodo_idx" ON "ree_k_factor"("fecha", "hora", "cuartohora", "tarifa", "periodo");

-- CreateIndex
CREATE INDEX "ree_k_factor_imports_version_idx" ON "ree_k_factor_imports"("version");

-- CreateIndex
CREATE INDEX "ree_k_factor_imports_tipo_archivo_idx" ON "ree_k_factor_imports"("tipo_archivo");

-- CreateIndex
CREATE INDEX "ree_k_factor_imports_fecha_inicio_idx" ON "ree_k_factor_imports"("fecha_inicio");

-- CreateIndex
CREATE INDEX "ree_k_factor_imports_fecha_fin_idx" ON "ree_k_factor_imports"("fecha_fin");

-- CreateIndex
CREATE INDEX "ree_k_factor_imports_status_idx" ON "ree_k_factor_imports"("status");

-- CreateIndex
CREATE INDEX "ree_k_factor_imports_imported_at_idx" ON "ree_k_factor_imports"("imported_at");

-- CreateIndex
CREATE INDEX "omie_downloads_fecha_programa_idx" ON "omie_downloads"("fecha_programa");

-- CreateIndex
CREATE INDEX "omie_downloads_tipo_documento_idx" ON "omie_downloads"("tipo_documento");

-- CreateIndex
CREATE INDEX "omie_downloads_estado_idx" ON "omie_downloads"("estado");

-- CreateIndex
CREATE INDEX "omie_downloads_fecha_descarga_idx" ON "omie_downloads"("fecha_descarga");

-- CreateIndex
CREATE UNIQUE INDEX "omie_downloads_tipo_documento_fecha_programa_sesion_version_key" ON "omie_downloads"("tipo_documento", "fecha_programa", "sesion", "version", "u_ofertante");

-- CreateIndex
CREATE INDEX "omie_programas_fecha_programa_idx" ON "omie_programas"("fecha_programa");

-- CreateIndex
CREATE INDEX "omie_programas_tipo_programa_idx" ON "omie_programas"("tipo_programa");

-- CreateIndex
CREATE INDEX "omie_programas_download_id_idx" ON "omie_programas"("download_id");

-- CreateIndex
CREATE INDEX "omie_programas_clave_idx" ON "omie_programas"("clave");

-- CreateIndex
CREATE UNIQUE INDEX "omie_programas_tipo_programa_fecha_programa_sesion_version__key" ON "omie_programas"("tipo_programa", "fecha_programa", "sesion", "version", "u_ofertante", "periodo");

-- CreateIndex
CREATE INDEX "omie_transaction_downloads_codigo_consulta_idx" ON "omie_transaction_downloads"("codigo_consulta");

-- CreateIndex
CREATE INDEX "omie_transaction_downloads_fecha_desde_idx" ON "omie_transaction_downloads"("fecha_desde");

-- CreateIndex
CREATE INDEX "omie_transaction_downloads_fecha_hasta_idx" ON "omie_transaction_downloads"("fecha_hasta");

-- CreateIndex
CREATE INDEX "omie_transaction_downloads_estado_idx" ON "omie_transaction_downloads"("estado");

-- CreateIndex
CREATE INDEX "omie_transaction_downloads_fecha_descarga_idx" ON "omie_transaction_downloads"("fecha_descarga");

-- CreateIndex
CREATE INDEX "omie_transaction_staging_download_id_idx" ON "omie_transaction_staging"("download_id");

-- CreateIndex
CREATE INDEX "omie_transaction_staging_dia_contrato_idx" ON "omie_transaction_staging"("dia_contrato");

-- CreateIndex
CREATE UNIQUE INDEX "omie_transaction_staging_download_id_row_index_key" ON "omie_transaction_staging"("download_id", "row_index");

-- CreateIndex
CREATE INDEX "omie_price_downloads_fecha_programa_idx" ON "omie_price_downloads"("fecha_programa");

-- CreateIndex
CREATE INDEX "omie_price_downloads_tipo_precio_idx" ON "omie_price_downloads"("tipo_precio");

-- CreateIndex
CREATE INDEX "omie_price_downloads_estado_idx" ON "omie_price_downloads"("estado");

-- CreateIndex
CREATE INDEX "omie_price_downloads_fecha_descarga_idx" ON "omie_price_downloads"("fecha_descarga");

-- CreateIndex
CREATE UNIQUE INDEX "omie_price_downloads_tipo_precio_fecha_programa_sesion_vers_key" ON "omie_price_downloads"("tipo_precio", "fecha_programa", "sesion", "version");

-- CreateIndex
CREATE INDEX "omie_prices_fecha_programa_idx" ON "omie_prices"("fecha_programa");

-- CreateIndex
CREATE INDEX "omie_prices_tipo_precio_idx" ON "omie_prices"("tipo_precio");

-- CreateIndex
CREATE INDEX "omie_prices_download_id_idx" ON "omie_prices"("download_id");

-- CreateIndex
CREATE INDEX "omie_prices_clave_idx" ON "omie_prices"("clave");

-- CreateIndex
CREATE UNIQUE INDEX "omie_prices_tipo_precio_fecha_programa_sesion_periodo_key" ON "omie_prices"("tipo_precio", "fecha_programa", "sesion", "periodo");

-- CreateIndex
CREATE UNIQUE INDEX "esios_indicators_indicator_id_key" ON "esios_indicators"("indicator_id");

-- CreateIndex
CREATE INDEX "esios_indicator_values_indicator_id_datetime_utc_idx" ON "esios_indicator_values"("indicator_id", "datetime_utc");

-- CreateIndex
CREATE INDEX "esios_indicator_values_datetime_idx" ON "esios_indicator_values"("datetime");

-- CreateIndex
CREATE UNIQUE INDEX "ux_esios_indicator_values" ON "esios_indicator_values"("indicator_id", "datetime");

-- CreateIndex
CREATE INDEX "esios_download_logs_indicator_id_idx" ON "esios_download_logs"("indicator_id");

-- CreateIndex
CREATE INDEX "esios_download_logs_created_at_idx" ON "esios_download_logs"("created_at");

-- CreateIndex
CREATE INDEX "esios_download_logs_status_idx" ON "esios_download_logs"("status");

-- CreateIndex
CREATE INDEX "esios_profile_uploads_year_idx" ON "esios_profile_uploads"("year");

-- CreateIndex
CREATE INDEX "esios_profile_uploads_uploaded_at_idx" ON "esios_profile_uploads"("uploaded_at");

-- CreateIndex
CREATE INDEX "esios_profile_uploads_status_idx" ON "esios_profile_uploads"("status");

-- CreateIndex
CREATE INDEX "esios_initial_profiles_year_idx" ON "esios_initial_profiles"("year");

-- CreateIndex
CREATE INDEX "esios_initial_profiles_datetime_idx" ON "esios_initial_profiles"("datetime");

-- CreateIndex
CREATE INDEX "esios_initial_profiles_upload_id_idx" ON "esios_initial_profiles"("upload_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_esios_initial_profiles_hour" ON "esios_initial_profiles"("year", "month", "day", "hour");

-- CreateIndex
CREATE INDEX "esios_profile_coefficients_year_idx" ON "esios_profile_coefficients"("year");

-- CreateIndex
CREATE INDEX "esios_profile_coefficients_tariff_idx" ON "esios_profile_coefficients"("tariff");

-- CreateIndex
CREATE INDEX "esios_profile_coefficients_upload_id_idx" ON "esios_profile_coefficients"("upload_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_esios_profile_coefficients_tariff" ON "esios_profile_coefficients"("year", "tariff");

-- CreateIndex
CREATE INDEX "esios_profile_intermediate_results_year_idx" ON "esios_profile_intermediate_results"("year");

-- CreateIndex
CREATE INDEX "esios_profile_intermediate_results_datetime_idx" ON "esios_profile_intermediate_results"("datetime");

-- CreateIndex
CREATE INDEX "esios_profile_intermediate_results_tariff_idx" ON "esios_profile_intermediate_results"("tariff");

-- CreateIndex
CREATE UNIQUE INDEX "ux_esios_profile_intermediate_results_datetime_tariff" ON "esios_profile_intermediate_results"("year", "datetime", "tariff");

-- CreateIndex
CREATE UNIQUE INDEX "ux_esios_ree_final_demand_upload_period_key" ON "esios_ree_final_demand_uploads"("period_key");

-- CreateIndex
CREATE INDEX "esios_ree_final_demand_uploads_year_idx" ON "esios_ree_final_demand_uploads"("year");

-- CreateIndex
CREATE INDEX "esios_ree_final_demand_uploads_month_idx" ON "esios_ree_final_demand_uploads"("month");

-- CreateIndex
CREATE INDEX "esios_ree_final_demand_uploads_year_month_day_idx" ON "esios_ree_final_demand_uploads"("year", "month", "day");

-- CreateIndex
CREATE INDEX "esios_ree_final_demand_uploads_uploaded_at_idx" ON "esios_ree_final_demand_uploads"("uploaded_at");

-- CreateIndex
CREATE INDEX "esios_ree_final_demand_uploads_status_idx" ON "esios_ree_final_demand_uploads"("status");

-- CreateIndex
CREATE INDEX "esios_ree_final_demands_datetime_idx" ON "esios_ree_final_demands"("datetime");

-- CreateIndex
CREATE INDEX "esios_ree_final_demands_upload_id_idx" ON "esios_ree_final_demands"("upload_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_esios_ree_final_demand_hour" ON "esios_ree_final_demands"("year", "month", "day", "hour");

-- CreateIndex
CREATE INDEX "esios_ree_final_profile_uploads_year_idx" ON "esios_ree_final_profile_uploads"("year");

-- CreateIndex
CREATE INDEX "esios_ree_final_profile_uploads_month_idx" ON "esios_ree_final_profile_uploads"("month");

-- CreateIndex
CREATE INDEX "esios_ree_final_profile_uploads_uploaded_at_idx" ON "esios_ree_final_profile_uploads"("uploaded_at");

-- CreateIndex
CREATE INDEX "esios_ree_final_profile_uploads_status_idx" ON "esios_ree_final_profile_uploads"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ux_esios_ree_final_profile_upload_month" ON "esios_ree_final_profile_uploads"("year", "month");

-- CreateIndex
CREATE INDEX "esios_ree_final_profiles_datetime_idx" ON "esios_ree_final_profiles"("datetime");

-- CreateIndex
CREATE INDEX "esios_ree_final_profiles_upload_id_idx" ON "esios_ree_final_profiles"("upload_id");

-- CreateIndex
CREATE UNIQUE INDEX "ux_esios_ree_final_profile_hour" ON "esios_ree_final_profiles"("year", "month", "day", "hour");

-- CreateIndex
CREATE INDEX "esios_profile_calculation_logs_year_idx" ON "esios_profile_calculation_logs"("year");

-- CreateIndex
CREATE INDEX "esios_profile_calculation_logs_status_idx" ON "esios_profile_calculation_logs"("status");

-- CreateIndex
CREATE INDEX "esios_profile_calculation_logs_created_at_idx" ON "esios_profile_calculation_logs"("created_at");

-- AddForeignKey
ALTER TABLE "reganecu_records" ADD CONSTRAINT "reganecu_records_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "ree_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reganecu_qh_records" ADD CONSTRAINT "reganecu_qh_records_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "ree_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medperup_records" ADD CONSTRAINT "medperup_records_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "medper_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medperqh_records" ADD CONSTRAINT "medperqh_records_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "medper_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "omie_programas" ADD CONSTRAINT "omie_programas_download_id_fkey" FOREIGN KEY ("download_id") REFERENCES "omie_downloads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "omie_transaction_staging" ADD CONSTRAINT "omie_transaction_staging_download_id_fkey" FOREIGN KEY ("download_id") REFERENCES "omie_transaction_downloads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "omie_prices" ADD CONSTRAINT "omie_prices_download_id_fkey" FOREIGN KEY ("download_id") REFERENCES "omie_price_downloads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esios_indicator_values" ADD CONSTRAINT "esios_indicator_values_indicator_id_fkey" FOREIGN KEY ("indicator_id") REFERENCES "esios_indicators"("indicator_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esios_download_logs" ADD CONSTRAINT "esios_download_logs_indicator_id_fkey" FOREIGN KEY ("indicator_id") REFERENCES "esios_indicators"("indicator_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esios_initial_profiles" ADD CONSTRAINT "esios_initial_profiles_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "esios_profile_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esios_profile_coefficients" ADD CONSTRAINT "esios_profile_coefficients_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "esios_profile_uploads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esios_ree_final_demands" ADD CONSTRAINT "esios_ree_final_demands_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "esios_ree_final_demand_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "esios_ree_final_profiles" ADD CONSTRAINT "esios_ree_final_profiles_upload_id_fkey" FOREIGN KEY ("upload_id") REFERENCES "esios_ree_final_profile_uploads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

