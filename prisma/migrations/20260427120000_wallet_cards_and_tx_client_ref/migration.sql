-- Wallet payment methods (Runa Finance app) + idempotent transaction client ref

ALTER TABLE "payment_methods" ADD COLUMN IF NOT EXISTS "client_id" VARCHAR(128);
ALTER TABLE "payment_methods" ADD COLUMN IF NOT EXISTS "balance" DECIMAL(18,2);
ALTER TABLE "payment_methods" ADD COLUMN IF NOT EXISTS "last4" VARCHAR(8);
ALTER TABLE "payment_methods" ADD COLUMN IF NOT EXISTS "network" VARCHAR(32);
ALTER TABLE "payment_methods" ADD COLUMN IF NOT EXISTS "design" VARCHAR(64);
ALTER TABLE "payment_methods" ADD COLUMN IF NOT EXISTS "cover_image_key" VARCHAR(512);
ALTER TABLE "payment_methods" ADD COLUMN IF NOT EXISTS "card_currency" VARCHAR(8);

CREATE INDEX IF NOT EXISTS "payment_methods_user_id_client_id_idx" ON "payment_methods"("user_id", "client_id");

ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "client_reference_id" VARCHAR(128);

CREATE UNIQUE INDEX IF NOT EXISTS "transactions_user_client_ref_unique" ON "transactions"("user_id", "client_reference_id");
