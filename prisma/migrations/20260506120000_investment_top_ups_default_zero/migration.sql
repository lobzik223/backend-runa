-- Таблица пополнений инвестсчёта (для дневного лимита) и новый default баланса 0 для новых пользователей
CREATE TABLE IF NOT EXISTS "investment_top_ups" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "investment_top_ups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "investment_top_ups_userId_currency_createdAt_idx" ON "investment_top_ups"("userId", "currency", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'investment_top_ups_userId_fkey'
  ) THEN
    ALTER TABLE "investment_top_ups" ADD CONSTRAINT "investment_top_ups_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

ALTER TABLE "users" ALTER COLUMN "investmentInitialBalance" SET DEFAULT 0;
