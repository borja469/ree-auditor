-- Auditoria de duplicados de carga por regla de negocio:
-- combinacion unica (tipo_fichero, fecha, version).

SELECT
  'ree_files' AS origen,
  tipo_archivo::text AS tipo_fichero,
  fecha_liquidacion AS fecha,
  version::text AS version,
  COUNT(*) AS cargas,
  ARRAY_AGG(file_name ORDER BY imported_at DESC) AS ficheros,
  ARRAY_AGG(imported_at ORDER BY imported_at DESC) AS fechas_carga
FROM ree_files
GROUP BY tipo_archivo, fecha_liquidacion, version
HAVING COUNT(*) > 1

UNION ALL

SELECT
  'medper_files' AS origen,
  tipo_archivo::text AS tipo_fichero,
  fecha_inicio AS fecha,
  version AS version,
  COUNT(*) AS cargas,
  ARRAY_AGG(file_name ORDER BY imported_at DESC) AS ficheros,
  ARRAY_AGG(imported_at ORDER BY imported_at DESC) AS fechas_carga
FROM medper_files
GROUP BY tipo_archivo, fecha_inicio, version
HAVING COUNT(*) > 1
ORDER BY origen, fecha DESC, tipo_fichero, version;

-- Auditoria adicional de registros duplicados por hash tecnico.
SELECT 'reganecu_records' AS tabla, COUNT(*) - COUNT(DISTINCT record_hash) AS duplicados FROM reganecu_records
UNION ALL
SELECT 'reganecu_qh_records', COUNT(*) - COUNT(DISTINCT record_hash) FROM reganecu_qh_records
UNION ALL
SELECT 'medperqh_records', COUNT(*) - COUNT(DISTINCT record_hash) FROM medperqh_records
UNION ALL
SELECT 'medperup_records', COUNT(*) - COUNT(DISTINCT record_hash) FROM medperup_records;
