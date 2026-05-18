-- Дата завершения кредитного договора (для LOAN): график и напоминания до этой даты.
ALTER TABLE "credit_accounts" ADD COLUMN "maturityAt" TIMESTAMP(3);
