-- Admin: add role, name, updatedAt
DO $$ BEGIN
  CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "name" TEXT;
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "role" "AdminRole" NOT NULL DEFAULT 'SUPER_ADMIN';
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- User: block fields (only SUPER_ADMIN can set via panel)
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "blockedUntil" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "blockReason" TEXT;

-- Admin reports (30 days retention)
CREATE TABLE IF NOT EXISTS "admin_reports" (
    "id" TEXT NOT NULL,
    "adminId" INTEGER NOT NULL,
    "category" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_reports_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "admin_reports_createdAt_idx" ON "admin_reports"("createdAt");
CREATE INDEX IF NOT EXISTS "admin_reports_adminId_createdAt_idx" ON "admin_reports"("adminId", "createdAt");

-- Promo codes (admin-created)
CREATE TABLE IF NOT EXISTS "promo_codes" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "discountRubles" INTEGER NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "promo_codes_code_key" ON "promo_codes"("code");
CREATE INDEX IF NOT EXISTS "promo_codes_code_idx" ON "promo_codes"("code");
CREATE INDEX IF NOT EXISTS "promo_codes_validUntil_idx" ON "promo_codes"("validUntil");

-- YooKassa payment: optional promo link
ALTER TABLE "yookassa_payments" ADD COLUMN IF NOT EXISTS "promoCodeId" TEXT;

ALTER TABLE "yookassa_payments" DROP CONSTRAINT IF EXISTS "yookassa_payments_promoCodeId_fkey";
ALTER TABLE "yookassa_payments" ADD CONSTRAINT "yookassa_payments_promoCodeId_fkey"
    FOREIGN KEY ("promoCodeId") REFERENCES "promo_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX IF NOT EXISTS "yookassa_payments_promoCodeId_idx" ON "yookassa_payments"("promoCodeId");
