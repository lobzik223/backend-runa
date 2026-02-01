-- Добавление поля начального баланса инвестиционного счёта (по умолчанию 100 000 ₽)
-- Выполнить на сервере: psql -U runa -d runa -f prisma/sql/add_investment_initial_balance.sql
-- или через Prisma: npx prisma migrate dev --name add_investment_initial_balance

ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "investmentInitialBalance" DECIMAL(18,2) NOT NULL DEFAULT 100000;
