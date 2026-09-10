ALTER TYPE "MibgasPrivateQueryKind" ADD VALUE IF NOT EXISTS 'POSICIONES_PERIODO';

CREATE TABLE IF NOT EXISTS "mibgas_net_positions" (
  "id" UUID NOT NULL,
  "download_id" UUID NOT NULL,
  "environment" "MibgasPrivateEnvironment" NOT NULL,
  "row_key" VARCHAR(500) NOT NULL,
  "trading_day" DATE NOT NULL,
  "installation" VARCHAR(40),
  "portfolio_id" VARCHAR(160),
  "product_id" VARCHAR(160),
  "segment_id" VARCHAR(80),
  "sale_quantity" DECIMAL(24,8),
  "purchase_quantity" DECIMAL(24,8),
  "net_quantity" DECIMAL(24,8),
  "is_total" BOOLEAN NOT NULL DEFAULT false,
  "raw_payload_json" JSONB NOT NULL,
  "source_xml_hash" VARCHAR(128),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mibgas_net_positions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ux_mibgas_net_positions_environment_row_key" ON "mibgas_net_positions"("environment", "row_key");
CREATE INDEX IF NOT EXISTS "mibgas_net_positions_download_id_idx" ON "mibgas_net_positions"("download_id");
CREATE INDEX IF NOT EXISTS "mibgas_net_positions_trading_day_idx" ON "mibgas_net_positions"("trading_day");
CREATE INDEX IF NOT EXISTS "mibgas_net_positions_installation_idx" ON "mibgas_net_positions"("installation");
CREATE INDEX IF NOT EXISTS "mibgas_net_positions_portfolio_id_idx" ON "mibgas_net_positions"("portfolio_id");
CREATE INDEX IF NOT EXISTS "mibgas_net_positions_product_id_idx" ON "mibgas_net_positions"("product_id");
CREATE INDEX IF NOT EXISTS "mibgas_net_positions_is_total_idx" ON "mibgas_net_positions"("is_total");

ALTER TABLE "mibgas_net_positions"
  ADD CONSTRAINT "mibgas_net_positions_download_id_fkey"
  FOREIGN KEY ("download_id") REFERENCES "mibgas_private_downloads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
