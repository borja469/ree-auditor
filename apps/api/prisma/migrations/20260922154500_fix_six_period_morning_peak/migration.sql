UPDATE "tarifas_periodos"
SET "periodo" = CASE
  WHEN "temporada" = 'alta' THEN 'P1'
  WHEN "temporada" = 'media-alta' THEN 'P2'
  WHEN "temporada" = 'media' THEN 'P3'
  ELSE 'P4'
END
WHERE "tipo_dia" = 'LABORABLE'
  AND "hora" BETWEEN 10 AND 14
  AND "tarifa" IN ('3.0TD', '6.1TD', '6.2TD', '6.3TD', '6.4TD');

UPDATE "tarifas_periodos"
SET "periodo" = CASE
  WHEN "temporada" = 'alta' THEN 'P2'
  WHEN "temporada" = 'media-alta' THEN 'P3'
  WHEN "temporada" = 'media' THEN 'P4'
  ELSE 'P5'
END
WHERE "tipo_dia" = 'LABORABLE'
  AND "hora" = 15
  AND "tarifa" IN ('3.0TD', '6.1TD', '6.2TD', '6.3TD', '6.4TD');
