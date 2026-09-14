ALTER TABLE "mibgas_transactions"
  ADD COLUMN "session_date" DATE,
  ADD COLUMN "first_gas_day" DATE,
  ADD COLUMN "last_gas_day" DATE,
  ADD COLUMN "amount" DECIMAL(24,8);

UPDATE "mibgas_transactions"
SET
  "session_date" = CASE
    WHEN ("raw_payload_json"->>'fesesion') ~ '^\d{4}-\d{2}-\d{2}$' THEN ("raw_payload_json"->>'fesesion')::date
    ELSE NULL
  END,
  "first_gas_day" = CASE
    WHEN ("raw_payload_json"->>'dgasini') ~ '^\d{4}-\d{2}-\d{2}$' THEN ("raw_payload_json"->>'dgasini')::date
    ELSE "trading_day"
  END,
  "last_gas_day" = CASE
    WHEN ("raw_payload_json"->>'dgasfin') ~ '^\d{4}-\d{2}-\d{2}$' THEN ("raw_payload_json"->>'dgasfin')::date
    WHEN ("raw_payload_json"->>'dgasini') ~ '^\d{4}-\d{2}-\d{2}$' THEN ("raw_payload_json"->>'dgasini')::date
    ELSE "trading_day"
  END,
  "amount" = CASE
    WHEN ("raw_payload_json"->>'importe') ~ '^-?\d+(\.\d+)?$' THEN ("raw_payload_json"->>'importe')::numeric
    ELSE NULL
  END;

CREATE INDEX "mibgas_transactions_session_date_idx" ON "mibgas_transactions"("session_date");
CREATE INDEX "mibgas_transactions_first_gas_day_idx" ON "mibgas_transactions"("first_gas_day");
CREATE INDEX "mibgas_transactions_last_gas_day_idx" ON "mibgas_transactions"("last_gas_day");
