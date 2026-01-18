#!/bin/sh
set -e

echo "Waiting for database to be ready..."
# Простая проверка доступности PostgreSQL
until nc -z postgres 5432; do
  echo "PostgreSQL is unavailable - sleeping"
  sleep 1
done

echo "Database is ready!"

# Prisma schema sync / migrations
# В репозитории может не быть prisma/migrations (тогда migrate deploy ничего не создаст).
# Для dev/демо окружения создаём таблицы через `db push`.
if [ -d "prisma/migrations" ] && [ "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  echo "Running Prisma migrations (migrate deploy)..."
  npx prisma migrate deploy
else
  echo "No prisma/migrations found. Running Prisma db push to create schema..."
  npx prisma db push --skip-generate
fi

# Seed system reference data (categories/payment methods) - safe and lightweight
echo "Seeding system data (categories/payment methods)..."
node dist/scripts/seed-system-data.js || echo "Seed skipped/failed (continuing)..."

# Запуск приложения
echo "Starting application..."
exec "$@"
