CREATE TYPE "CmInvoiceDocumentType" AS ENUM ('INVOICE', 'CREDIT_NOTE');

ALTER TABLE "cm_invoices"
  ADD COLUMN "document_type" "CmInvoiceDocumentType" NOT NULL DEFAULT 'INVOICE',
  ADD COLUMN "economic_sign" INTEGER NOT NULL DEFAULT 1;

UPDATE "cm_invoices"
SET
  "document_type" = 'CREDIT_NOTE',
  "economic_sign" = -1
WHERE
  lower(coalesce("raw_payload_json"->>'type', '')) = 'out_refund'
  OR coalesce("invoice_number", '') LIKE 'A%';

CREATE INDEX "cm_invoices_document_type_idx" ON "cm_invoices"("document_type");
