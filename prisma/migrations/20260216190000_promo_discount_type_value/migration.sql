-- Промокоды: переход с discountRubles на discountType + discountValue (рубли или проценты)
ALTER TABLE "promo_codes" ADD COLUMN IF NOT EXISTS "discountType" TEXT DEFAULT 'RUB';
ALTER TABLE "promo_codes" ADD COLUMN IF NOT EXISTS "discountValue" INTEGER;

-- Перенос данных из старой колонки (если есть)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'promo_codes' AND column_name = 'discountRubles'
  ) THEN
    UPDATE "promo_codes" SET "discountValue" = "discountRubles" WHERE "discountRubles" IS NOT NULL;
  END IF;
END $$;

UPDATE "promo_codes" SET "discountValue" = 0 WHERE "discountValue" IS NULL;
ALTER TABLE "promo_codes" ALTER COLUMN "discountValue" SET NOT NULL;
ALTER TABLE "promo_codes" DROP COLUMN IF EXISTS "discountRubles";

-- YooKassa: сумма к оплате для статистики и индекс для проверки одноразового промо
ALTER TABLE "yookassa_payments" ADD COLUMN IF NOT EXISTS "amountPaid" DECIMAL(10,2);
CREATE INDEX IF NOT EXISTS "yookassa_payments_userId_promoCodeId_idx" ON "yookassa_payments"("userId", "promoCodeId");
