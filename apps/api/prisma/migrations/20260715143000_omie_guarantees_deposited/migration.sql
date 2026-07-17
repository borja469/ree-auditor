CREATE TABLE "omie_guarantees_deposited" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "date" DATE NOT NULL,
    "amount" DECIMAL(20,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "omie_guarantees_deposited_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "omie_guarantees_deposited_date_key" ON "omie_guarantees_deposited"("date");
