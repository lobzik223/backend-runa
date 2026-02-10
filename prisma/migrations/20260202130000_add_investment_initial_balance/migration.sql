-- AlterTable (table is mapped as "users" in schema)
-- Add investment account initial balance column if missing (e.g. DB was created before this field)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "investmentInitialBalance" DECIMAL(18,2) NOT NULL DEFAULT 100000;
