CREATE TABLE IF NOT EXISTS "ree_k_factor_dedup_audit" (
  "deleted_id" UUID NOT NULL,
  "kept_id" UUID NOT NULL,
  "fecha" DATE NOT NULL,
  "hora" INTEGER NOT NULL,
  "cuartohora" INTEGER NOT NULL,
  "version" "ReeSettlementVersion" NOT NULL,
  "tipo_archivo" "ReeKFactorFileType" NOT NULL,
  "tarifa" TEXT NOT NULL,
  "periodo" TEXT NOT NULL,
  "valor_k" DECIMAL(20,10) NOT NULL,
  "kept_valor_k" DECIMAL(20,10) NOT NULL,
  "deleted_created_at" TIMESTAMP(3) NOT NULL,
  "kept_created_at" TIMESTAMP(3) NOT NULL,
  "cleanup_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ree_k_factor_dedup_audit_pkey" PRIMARY KEY ("deleted_id")
);

ALTER TABLE "ree_k_factor_dedup_audit"
  ADD COLUMN IF NOT EXISTS "kept_valor_k" DECIMAL(20,10);

DO $$
DECLARE
  unsafe_groups integer;
  remaining_duplicates integer;
BEGIN
  SELECT COUNT(*)::integer
  INTO unsafe_groups
  FROM (
    SELECT
      fecha,
      hora,
      cuartohora,
      version,
      tipo_archivo,
      tarifa,
      periodo,
      COUNT(DISTINCT settlement_type) AS settlement_type_values,
      COUNT(DISTINCT settlement_number) AS settlement_number_values
    FROM ree_k_factor
    GROUP BY fecha, hora, cuartohora, version, tipo_archivo, tarifa, periodo
    HAVING COUNT(*) > 1
  ) duplicated
  WHERE settlement_type_values > 1
     OR settlement_number_values > 1;

  IF unsafe_groups > 0 THEN
    RAISE EXCEPTION 'ree_k_factor contiene % grupos duplicados con diferencias de identidad settlement. Saneamiento abortado.', unsafe_groups;
  END IF;

  WITH ranked AS (
    SELECT
      id,
      FIRST_VALUE(id) OVER functional_window AS kept_id,
      FIRST_VALUE(valor_k) OVER functional_window AS kept_valor_k,
      FIRST_VALUE(created_at) OVER functional_window AS kept_created_at,
      ROW_NUMBER() OVER functional_window AS row_number
    FROM ree_k_factor
    WINDOW functional_window AS (
      PARTITION BY fecha, hora, cuartohora, version, tipo_archivo, tarifa, periodo
      ORDER BY created_at DESC, id DESC
    )
  )
  INSERT INTO "ree_k_factor_dedup_audit" (
    "deleted_id",
    "kept_id",
    "fecha",
    "hora",
    "cuartohora",
    "version",
    "tipo_archivo",
    "tarifa",
    "periodo",
    "valor_k",
    "kept_valor_k",
    "deleted_created_at",
    "kept_created_at",
    "cleanup_at"
  )
  SELECT
    k.id,
    ranked.kept_id,
    k.fecha,
    k.hora,
    k.cuartohora,
    k.version,
    k.tipo_archivo,
    k.tarifa,
    k.periodo,
    k.valor_k,
    ranked.kept_valor_k,
    k.created_at,
    ranked.kept_created_at,
    CURRENT_TIMESTAMP
  FROM ranked
  JOIN ree_k_factor k ON k.id = ranked.id
  WHERE ranked.row_number > 1
  ON CONFLICT ("deleted_id") DO NOTHING;

  DELETE FROM ree_k_factor k
  USING "ree_k_factor_dedup_audit" audit
  WHERE k.id = audit.deleted_id;

  SELECT COUNT(*)::integer
  INTO remaining_duplicates
  FROM (
    SELECT 1
    FROM ree_k_factor
    GROUP BY fecha, hora, cuartohora, version, tipo_archivo, tarifa, periodo
    HAVING COUNT(*) > 1
  ) still_duplicated;

  IF remaining_duplicates > 0 THEN
    RAISE EXCEPTION 'ree_k_factor conserva % grupos duplicados tras saneamiento. Constraint no creada.', remaining_duplicates;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ree_k_factor_dedup_audit_kept_id_idx" ON "ree_k_factor_dedup_audit"("kept_id");
CREATE INDEX IF NOT EXISTS "ree_k_factor_dedup_audit_fecha_version_tipo_archivo_idx" ON "ree_k_factor_dedup_audit"("fecha", "version", "tipo_archivo");
CREATE INDEX IF NOT EXISTS "ree_k_factor_dedup_audit_cleanup_at_idx" ON "ree_k_factor_dedup_audit"("cleanup_at");

CREATE UNIQUE INDEX IF NOT EXISTS "ree_k_factor_functional_unique" ON "ree_k_factor"("fecha", "hora", "cuartohora", "version", "tipo_archivo", "tarifa", "periodo");
