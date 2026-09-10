CREATE TYPE "MibgasPrivateEnvironment" AS ENUM ('PREPROD', 'PROD');
CREATE TYPE "MibgasPrivateDownloadStatus" AS ENUM ('PENDIENTE', 'DESCARGANDO', 'PROCESADO', 'SIN_DATOS', 'ERROR');
CREATE TYPE "MibgasPrivateQueryKind" AS ENUM ('DATOS_USUARIO', 'DIRECTORIO', 'CONFIGURACION', 'TRANSACCIONES', 'ANOTACIONES');

CREATE TABLE "mibgas_private_connection_config" (
  "id" INTEGER NOT NULL DEFAULT 1,
  "environment" "MibgasPrivateEnvironment" NOT NULL DEFAULT 'PREPROD',
  "endpoint" VARCHAR(1000) NOT NULL,
  "timeout_ms" INTEGER NOT NULL DEFAULT 30000,
  "status" VARCHAR(40) NOT NULL DEFAULT 'SIN_COMPROBAR',
  "last_successful_connection" TIMESTAMP(3),
  "agent_code" VARCHAR(80),
  "agent_description" VARCHAR(255),
  "certificate_code" VARCHAR(160),
  "certificate_subject" VARCHAR(1000),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mibgas_private_connection_config_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mibgas_query_directory" (
  "id" UUID NOT NULL,
  "environment" "MibgasPrivateEnvironment" NOT NULL,
  "query_code" VARCHAR(20) NOT NULL,
  "title" VARCHAR(500),
  "section" VARCHAR(255),
  "query_type" VARCHAR(40),
  "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "raw_payload_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mibgas_query_directory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mibgas_query_configurations" (
  "id" UUID NOT NULL,
  "environment" "MibgasPrivateEnvironment" NOT NULL,
  "query_code" VARCHAR(20) NOT NULL,
  "title" VARCHAR(500),
  "section" VARCHAR(255),
  "query_type" VARCHAR(40),
  "parameters_json" JSONB NOT NULL,
  "columns_json" JSONB NOT NULL,
  "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "raw_xml" TEXT,
  "raw_payload_json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mibgas_query_configurations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mibgas_private_downloads" (
  "id" UUID NOT NULL,
  "environment" "MibgasPrivateEnvironment" NOT NULL,
  "query_kind" "MibgasPrivateQueryKind" NOT NULL,
  "query_code" VARCHAR(20),
  "query_title" VARCHAR(500),
  "session_date" DATE,
  "parameters_json" JSONB NOT NULL,
  "status" "MibgasPrivateDownloadStatus" NOT NULL DEFAULT 'PENDIENTE',
  "records" INTEGER NOT NULL DEFAULT 0,
  "duration_ms" INTEGER,
  "published_at" TIMESTAMP(3),
  "executed_by" VARCHAR(80) NOT NULL DEFAULT 'MANUAL',
  "content_hash" VARCHAR(128),
  "file_name" VARCHAR(255),
  "error_message" TEXT,
  "raw_xml" TEXT,
  "raw_payload_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mibgas_private_downloads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mibgas_transactions" (
  "id" UUID NOT NULL,
  "download_id" UUID NOT NULL,
  "environment" "MibgasPrivateEnvironment" NOT NULL,
  "trading_day" DATE NOT NULL,
  "message_id" VARCHAR(160),
  "message_version" VARCHAR(40),
  "message_datetime" TIMESTAMP(3),
  "sender_id" VARCHAR(80),
  "receiver_id" VARCHAR(80),
  "contract_id" VARCHAR(160) NOT NULL,
  "message_scope" VARCHAR(20),
  "market_participant_id" VARCHAR(80),
  "portfolio_id" VARCHAR(160),
  "contract_type" VARCHAR(20),
  "auction_number" VARCHAR(40),
  "order_id" VARCHAR(80),
  "transaction_id" VARCHAR(120) NOT NULL,
  "buy_sell_indicator" VARCHAR(5),
  "price" DECIMAL(20,8),
  "quantity" DECIMAL(24,8),
  "transaction_datetime" TIMESTAMP(3),
  "raw_payload_json" JSONB NOT NULL,
  "source_xml_hash" VARCHAR(128),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mibgas_transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mibgas_annotations" (
  "id" UUID NOT NULL,
  "download_id" UUID NOT NULL,
  "environment" "MibgasPrivateEnvironment" NOT NULL,
  "trading_day" DATE NOT NULL,
  "message_id" VARCHAR(160),
  "message_version" VARCHAR(40),
  "message_datetime" TIMESTAMP(3),
  "sender_id" VARCHAR(80),
  "receiver_id" VARCHAR(80),
  "contract_id" VARCHAR(160) NOT NULL,
  "message_scope" VARCHAR(20),
  "market_participant_id" VARCHAR(80),
  "portfolio_id" VARCHAR(160),
  "registry_account_id" VARCHAR(160),
  "clearing_account_id" VARCHAR(160),
  "contract_type" VARCHAR(20),
  "auction_number" VARCHAR(40),
  "annotation_id" VARCHAR(120) NOT NULL,
  "annotation_type" VARCHAR(20),
  "order_id" VARCHAR(80),
  "transaction_id" VARCHAR(120),
  "first_gas_day" DATE,
  "last_gas_day" DATE,
  "buy_sell_indicator" VARCHAR(5),
  "price" DECIMAL(20,8),
  "quantity" DECIMAL(24,8),
  "quantity_sign" VARCHAR(5),
  "delivery" DECIMAL(24,8),
  "amount" DECIMAL(24,8),
  "amount_sign" VARCHAR(5),
  "tax_amount" DECIMAL(24,8),
  "tax_amount_sign" VARCHAR(5),
  "raw_payload_json" JSONB NOT NULL,
  "source_xml_hash" VARCHAR(128),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "mibgas_annotations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ux_mibgas_query_directory_environment_code" ON "mibgas_query_directory"("environment", "query_code");
CREATE INDEX "mibgas_query_directory_environment_idx" ON "mibgas_query_directory"("environment");
CREATE INDEX "mibgas_query_directory_query_type_idx" ON "mibgas_query_directory"("query_type");
CREATE INDEX "mibgas_query_directory_section_idx" ON "mibgas_query_directory"("section");

CREATE UNIQUE INDEX "ux_mibgas_query_config_environment_code" ON "mibgas_query_configurations"("environment", "query_code");
CREATE INDEX "mibgas_query_configurations_environment_idx" ON "mibgas_query_configurations"("environment");
CREATE INDEX "mibgas_query_configurations_query_type_idx" ON "mibgas_query_configurations"("query_type");
CREATE INDEX "mibgas_query_configurations_section_idx" ON "mibgas_query_configurations"("section");

CREATE INDEX "mibgas_private_downloads_environment_idx" ON "mibgas_private_downloads"("environment");
CREATE INDEX "mibgas_private_downloads_query_kind_idx" ON "mibgas_private_downloads"("query_kind");
CREATE INDEX "mibgas_private_downloads_query_code_idx" ON "mibgas_private_downloads"("query_code");
CREATE INDEX "mibgas_private_downloads_session_date_idx" ON "mibgas_private_downloads"("session_date");
CREATE INDEX "mibgas_private_downloads_status_idx" ON "mibgas_private_downloads"("status");
CREATE INDEX "mibgas_private_downloads_created_at_idx" ON "mibgas_private_downloads"("created_at");

CREATE UNIQUE INDEX "ux_mibgas_transactions_environment_transaction" ON "mibgas_transactions"("environment", "transaction_id");
CREATE INDEX "mibgas_transactions_download_id_idx" ON "mibgas_transactions"("download_id");
CREATE INDEX "mibgas_transactions_trading_day_idx" ON "mibgas_transactions"("trading_day");
CREATE INDEX "mibgas_transactions_contract_id_idx" ON "mibgas_transactions"("contract_id");
CREATE INDEX "mibgas_transactions_portfolio_id_idx" ON "mibgas_transactions"("portfolio_id");
CREATE INDEX "mibgas_transactions_transaction_datetime_idx" ON "mibgas_transactions"("transaction_datetime");

CREATE UNIQUE INDEX "ux_mibgas_annotations_environment_annotation" ON "mibgas_annotations"("environment", "annotation_id");
CREATE INDEX "mibgas_annotations_download_id_idx" ON "mibgas_annotations"("download_id");
CREATE INDEX "mibgas_annotations_trading_day_idx" ON "mibgas_annotations"("trading_day");
CREATE INDEX "mibgas_annotations_contract_id_idx" ON "mibgas_annotations"("contract_id");
CREATE INDEX "mibgas_annotations_portfolio_id_idx" ON "mibgas_annotations"("portfolio_id");
CREATE INDEX "mibgas_annotations_transaction_id_idx" ON "mibgas_annotations"("transaction_id");
CREATE INDEX "mibgas_annotations_first_gas_day_idx" ON "mibgas_annotations"("first_gas_day");
CREATE INDEX "mibgas_annotations_last_gas_day_idx" ON "mibgas_annotations"("last_gas_day");

ALTER TABLE "mibgas_transactions" ADD CONSTRAINT "mibgas_transactions_download_id_fkey" FOREIGN KEY ("download_id") REFERENCES "mibgas_private_downloads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mibgas_annotations" ADD CONSTRAINT "mibgas_annotations_download_id_fkey" FOREIGN KEY ("download_id") REFERENCES "mibgas_private_downloads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
