ALTER TABLE "cm_invoices"
  ADD COLUMN "price_list_id" INTEGER,
  ADD COLUMN "price_list_name" VARCHAR(255);

CREATE TABLE "cm_invoice_invoicing_modes" (
  "id" UUID NOT NULL,
  "invoice_id" UUID NOT NULL,
  "external_id" INTEGER NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cm_invoice_invoicing_modes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ux_cm_invoice_invoicing_modes_invoice_external"
  ON "cm_invoice_invoicing_modes"("invoice_id", "external_id");

CREATE INDEX "cm_invoices_price_list_name_idx"
  ON "cm_invoices"("price_list_name");

CREATE INDEX "cm_invoice_invoicing_modes_invoice_id_idx"
  ON "cm_invoice_invoicing_modes"("invoice_id");

CREATE INDEX "cm_invoice_invoicing_modes_external_id_idx"
  ON "cm_invoice_invoicing_modes"("external_id");

CREATE INDEX "cm_invoice_invoicing_modes_name_idx"
  ON "cm_invoice_invoicing_modes"("name");

ALTER TABLE "cm_invoice_invoicing_modes"
  ADD CONSTRAINT "cm_invoice_invoicing_modes_invoice_id_fkey"
  FOREIGN KEY ("invoice_id") REFERENCES "cm_invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
