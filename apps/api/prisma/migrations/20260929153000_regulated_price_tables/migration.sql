CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TYPE "RegulatedPriceCode" AS ENUM ('RETH', 'EFIH', 'PC3', 'TOLLS_CHARGES');

CREATE TABLE "regulated_price_versions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "code" "RegulatedPriceCode" NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "valid_from" DATE NOT NULL,
  "valid_to" DATE,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "regulated_price_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "regulated_price_versions_valid_range_check" CHECK ("valid_to" IS NULL OR "valid_to" >= "valid_from"),
  CONSTRAINT "regulated_price_versions_no_overlap" EXCLUDE USING gist (
    "code" WITH =,
    daterange("valid_from", COALESCE("valid_to" + INTERVAL '1 day', 'infinity'::timestamp)::date, '[)') WITH &&
  )
);

CREATE INDEX "regulated_price_versions_code_valid_from_valid_to_idx" ON "regulated_price_versions"("code", "valid_from", "valid_to");

CREATE TABLE "regulated_reth_prices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "version_id" UUID NOT NULL,
  "price_eur_mwh" NUMERIC(20,8) NOT NULL,
  "energy_basis" VARCHAR(40) NOT NULL DEFAULT 'BC',
  "unit" VARCHAR(40) NOT NULL DEFAULT 'EUR_MWH',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "regulated_reth_prices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "regulated_reth_prices_version_id_key" UNIQUE ("version_id"),
  CONSTRAINT "regulated_reth_prices_price_nonnegative_check" CHECK ("price_eur_mwh" >= 0),
  CONSTRAINT "regulated_reth_prices_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "regulated_price_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "regulated_efih_prices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "version_id" UUID NOT NULL,
  "price_eur_mwh" NUMERIC(20,8) NOT NULL,
  "energy_basis" VARCHAR(40) NOT NULL DEFAULT 'PF',
  "unit" VARCHAR(40) NOT NULL DEFAULT 'EUR_MWH',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "regulated_efih_prices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "regulated_efih_prices_version_id_key" UNIQUE ("version_id"),
  CONSTRAINT "regulated_efih_prices_price_nonnegative_check" CHECK ("price_eur_mwh" >= 0),
  CONSTRAINT "regulated_efih_prices_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "regulated_price_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "regulated_pc3_prices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "version_id" UUID NOT NULL,
  "tariff_code" VARCHAR(20) NOT NULL,
  "p1_eur_mwh" NUMERIC(20,8),
  "p2_eur_mwh" NUMERIC(20,8),
  "p3_eur_mwh" NUMERIC(20,8),
  "p4_eur_mwh" NUMERIC(20,8),
  "p5_eur_mwh" NUMERIC(20,8),
  "p6_eur_mwh" NUMERIC(20,8),
  "energy_basis" VARCHAR(40) NOT NULL DEFAULT 'BC',
  "unit" VARCHAR(40) NOT NULL DEFAULT 'EUR_MWH',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "regulated_pc3_prices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ux_regulated_pc3_version_tariff" UNIQUE ("version_id", "tariff_code"),
  CONSTRAINT "regulated_pc3_prices_nonnegative_check" CHECK (
    ("p1_eur_mwh" IS NULL OR "p1_eur_mwh" >= 0) AND
    ("p2_eur_mwh" IS NULL OR "p2_eur_mwh" >= 0) AND
    ("p3_eur_mwh" IS NULL OR "p3_eur_mwh" >= 0) AND
    ("p4_eur_mwh" IS NULL OR "p4_eur_mwh" >= 0) AND
    ("p5_eur_mwh" IS NULL OR "p5_eur_mwh" >= 0) AND
    ("p6_eur_mwh" IS NULL OR "p6_eur_mwh" >= 0)
  ),
  CONSTRAINT "regulated_pc3_prices_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "regulated_price_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "regulated_pc3_prices_tariff_code_idx" ON "regulated_pc3_prices"("tariff_code");

CREATE TABLE "regulated_tolls_charges_prices" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "version_id" UUID NOT NULL,
  "tariff_code" VARCHAR(20) NOT NULL,
  "power_p1_eur_kw_year" NUMERIC(20,8),
  "power_p2_eur_kw_year" NUMERIC(20,8),
  "power_p3_eur_kw_year" NUMERIC(20,8),
  "power_p4_eur_kw_year" NUMERIC(20,8),
  "power_p5_eur_kw_year" NUMERIC(20,8),
  "power_p6_eur_kw_year" NUMERIC(20,8),
  "energy_p1_eur_mwh" NUMERIC(20,8),
  "energy_p2_eur_mwh" NUMERIC(20,8),
  "energy_p3_eur_mwh" NUMERIC(20,8),
  "energy_p4_eur_mwh" NUMERIC(20,8),
  "energy_p5_eur_mwh" NUMERIC(20,8),
  "energy_p6_eur_mwh" NUMERIC(20,8),
  "energy_basis" VARCHAR(40) NOT NULL DEFAULT 'PF',
  "energy_unit" VARCHAR(40) NOT NULL DEFAULT 'EUR_MWH',
  "power_basis" VARCHAR(40) NOT NULL DEFAULT 'CONTRACTED_POWER',
  "power_unit" VARCHAR(40) NOT NULL DEFAULT 'EUR_KW_YEAR',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "regulated_tolls_charges_prices_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ux_regulated_tolls_charges_version_tariff" UNIQUE ("version_id", "tariff_code"),
  CONSTRAINT "regulated_tolls_charges_nonnegative_check" CHECK (
    ("power_p1_eur_kw_year" IS NULL OR "power_p1_eur_kw_year" >= 0) AND
    ("power_p2_eur_kw_year" IS NULL OR "power_p2_eur_kw_year" >= 0) AND
    ("power_p3_eur_kw_year" IS NULL OR "power_p3_eur_kw_year" >= 0) AND
    ("power_p4_eur_kw_year" IS NULL OR "power_p4_eur_kw_year" >= 0) AND
    ("power_p5_eur_kw_year" IS NULL OR "power_p5_eur_kw_year" >= 0) AND
    ("power_p6_eur_kw_year" IS NULL OR "power_p6_eur_kw_year" >= 0) AND
    ("energy_p1_eur_mwh" IS NULL OR "energy_p1_eur_mwh" >= 0) AND
    ("energy_p2_eur_mwh" IS NULL OR "energy_p2_eur_mwh" >= 0) AND
    ("energy_p3_eur_mwh" IS NULL OR "energy_p3_eur_mwh" >= 0) AND
    ("energy_p4_eur_mwh" IS NULL OR "energy_p4_eur_mwh" >= 0) AND
    ("energy_p5_eur_mwh" IS NULL OR "energy_p5_eur_mwh" >= 0) AND
    ("energy_p6_eur_mwh" IS NULL OR "energy_p6_eur_mwh" >= 0)
  ),
  CONSTRAINT "regulated_tolls_charges_prices_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "regulated_price_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "regulated_tolls_charges_prices_tariff_code_idx" ON "regulated_tolls_charges_prices"("tariff_code");

WITH version_rows AS (
  INSERT INTO "regulated_price_versions" ("code", "name", "valid_from", "valid_to", "notes")
  VALUES
    ('RETH', 'RETh inicial', DATE '2026-01-01', NULL, 'Version inicial configurable. Base BC, unidad EUR_MWH.'),
    ('EFIH', 'EFIh inicial', DATE '2026-01-01', NULL, 'Version inicial configurable. Base PF, unidad EUR_MWH.'),
    ('PC3', 'PC3 inicial por tarifa', DATE '2026-01-01', NULL, 'PC3 manual/configurado. No usar PC3 REGANECU para coste de factura.'),
    ('TOLLS_CHARGES', 'Peajes y cargos iniciales', DATE '2026-01-01', NULL, 'Energia base PF EUR_MWH; potencia base CONTRACTED_POWER EUR_KW_YEAR.')
  RETURNING id, code
)
INSERT INTO "regulated_reth_prices" ("version_id", "price_eur_mwh")
SELECT id, 0 FROM version_rows WHERE code = 'RETH';

WITH version_rows AS (
  SELECT id, code FROM "regulated_price_versions" WHERE "valid_from" = DATE '2026-01-01'
)
INSERT INTO "regulated_efih_prices" ("version_id", "price_eur_mwh")
SELECT id, 0 FROM version_rows WHERE code = 'EFIH';

WITH pc3_version AS (
  SELECT id FROM "regulated_price_versions" WHERE "code" = 'PC3' AND "valid_from" = DATE '2026-01-01'
)
INSERT INTO "regulated_pc3_prices" ("version_id", "tariff_code", "p1_eur_mwh", "p2_eur_mwh", "p3_eur_mwh", "p4_eur_mwh", "p5_eur_mwh", "p6_eur_mwh")
SELECT id, tariff_code, p1, p2, p3, p4, p5, p6
FROM pc3_version
CROSS JOIN (VALUES
  ('2.0TD', 0.8, 0.133, 0, 0, 0, 0),
  ('3.0TD', 1.082, 0.5, 0.333, 0.25, 0.25, 0),
  ('6.1TD', 0.465, 0.213, 0.142, 0.107, 0.107, 0),
  ('6.2TD', 0.465, 0.213, 0.142, 0.107, 0.107, 0),
  ('6.3TD', 0.465, 0.213, 0.142, 0.107, 0.107, 0),
  ('6.4TD', 0.465, 0.213, 0.142, 0.107, 0.107, 0),
  ('3.0TDVE', NULL, NULL, NULL, NULL, NULL, NULL),
  ('6.1TDVE', NULL, NULL, NULL, NULL, NULL, NULL)
) AS values_table(tariff_code, p1, p2, p3, p4, p5, p6);

WITH tolls_version AS (
  SELECT id FROM "regulated_price_versions" WHERE "code" = 'TOLLS_CHARGES' AND "valid_from" = DATE '2026-01-01'
)
INSERT INTO "regulated_tolls_charges_prices" (
  "version_id", "tariff_code",
  "power_p1_eur_kw_year", "power_p2_eur_kw_year", "power_p3_eur_kw_year", "power_p4_eur_kw_year", "power_p5_eur_kw_year", "power_p6_eur_kw_year",
  "energy_p1_eur_mwh", "energy_p2_eur_mwh", "energy_p3_eur_mwh", "energy_p4_eur_mwh", "energy_p5_eur_mwh", "energy_p6_eur_mwh"
)
SELECT id, tariff_code, pp1, pp2, pp3, pp4, pp5, pp6, ep1, ep2, ep3, ep4, ep5, ep6
FROM tolls_version
CROSS JOIN (VALUES
  ('2.0TD', 27.704413, 0.725423, 0, 0, 0, 0, 97.553, 29.267, 3.292, 0, 0, 0),
  ('3.0TD', 20.376927, 10.617621, 4.481534, 3.886333, 2.513851, 1.442287, 63.352, 38.914, 19.279, 9.795, 4.706, 2.898),
  ('6.1TD', 29.595368, 15.514709, 6.801881, 5.393829, 2.125113, 1.004181, 46.274, 26.717, 12.928, 6.678, 2.619, 1.588),
  ('6.2TD', 20.103588, 11.115668, 3.709113, 2.728152, 1.265617, 0.605381, 23.88, 13.975, 6.2, 3.083, 1.234, 0.752),
  ('6.3TD', 13.053392, 7.587863, 3.062065, 2.332116, 1.010041, 0.481394, 18.775, 10.876, 4.992, 2.494, 1.009, 0.614),
  ('6.4TD', 7.905445, 4.585787, 1.460005, 1.15856, 0.492827, 0.230511, 11.275, 6.055, 2.597, 1.286, 0.403, 0.232),
  ('3.0TDVE', 3.727958, 1.968328, 0.623462, 0.471799, 0.130238, 0.130238, 187.451, 106.578, 50.751, 26.122, 10.216, 6.227),
  ('6.1TDVE', 5.523814, 2.926765, 1.09528, 0.770513, 0.016375, 0.014472, 222.504, 119.324, 55.4, 28.975, 8.585, 5.084)
) AS values_table(tariff_code, pp1, pp2, pp3, pp4, pp5, pp6, ep1, ep2, ep3, ep4, ep5, ep6);
