-- Поля для заморозки аккаунта перед удалением (30 дней, восстановление 14 дней).
-- При использовании Prisma Migrate выполните: npx prisma migrate dev --name add_account_deletion_schedule
-- Либо при использовании db push миграция не нужна.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "deletionRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "scheduledDeleteAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "restoreUntil" TIMESTAMP(3);
