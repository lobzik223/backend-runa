# Миграция: промокоды — скидка в % или ₽

Если в БД уже есть таблица `promo_codes` с колонкой `discountRubles`, выполни вручную (PostgreSQL):

```sql
-- Добавить новые колонки
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS "discountType" TEXT DEFAULT 'RUB';
ALTER TABLE promo_codes ADD COLUMN IF NOT EXISTS "discountValue" INT;
-- Перенести данные
UPDATE promo_codes SET "discountValue" = "discountRubles" WHERE "discountRubles" IS NOT NULL;
UPDATE promo_codes SET "discountValue" = 0 WHERE "discountValue" IS NULL;
ALTER TABLE promo_codes ALTER COLUMN "discountValue" SET NOT NULL;
-- Удалить старую колонку
ALTER TABLE promo_codes DROP COLUMN IF EXISTS "discountRubles";

-- Платежи: сумма к оплате для статистики
ALTER TABLE yookassa_payments ADD COLUMN IF NOT EXISTS "amountPaid" DECIMAL(10,2);
CREATE INDEX IF NOT EXISTS "yookassa_payments_userId_promoCodeId_idx" ON yookassa_payments("userId", "promoCodeId");
```

Либо выполни `npx prisma migrate dev --name promo_discount_type` и при необходимости подправь сгенерированную миграцию (перенос данных из discountRubles в discountValue).
