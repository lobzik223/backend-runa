#!/bin/sh
set -e

echo "🚀 Starting Runa Finance Backend (Production)"

# Ожидание готовности PostgreSQL
echo "⏳ Waiting for PostgreSQL..."
until nc -z postgres 5432; do
  echo "PostgreSQL is unavailable - sleeping"
  sleep 2
done
echo "✅ PostgreSQL is up"

# Ожидание готовности Redis
echo "⏳ Waiting for Redis..."
until nc -z redis 6379; do
  echo "Redis is unavailable - sleeping"
  sleep 2
done
echo "✅ Redis is up"

# Применение миграций Prisma (только если нужно)
if [ "$RUN_MIGRATIONS" = "true" ]; then
  echo "📦 Running Prisma migrations..."
  npx prisma migrate deploy
  echo "✅ Migrations completed"
fi

# Запуск приложения
echo "🎯 Starting NestJS application..."
exec "$@"
