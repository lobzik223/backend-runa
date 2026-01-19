#!/usr/bin/env sh
#
# Entrypoint для production-образа backend-runa.
# Подготавливает базу (миграции) и передаёт управление основной команде.

set -euo pipefail

# Для отладки выводим текущий NODE_ENV
echo "[entrypoint] NODE_ENV=${NODE_ENV:-unset}"

# Пробуем выполнить миграции, если есть prisma и переменная PRISMA_MIGRATE не запрещает это
if [ -d /app/prisma ] && [ "${PRISMA_MIGRATE:-true}" != "false" ]; then
  echo "[entrypoint] Запускаем prisma migrate deploy"
  prisma migrate deploy
fi

# Дополнительные проверки безопасности
if [ -z "${APP_KEY:-}" ] && [ "${NODE_ENV:-development}" = "production" ]; then
  echo "[entrypoint] WARNING: APP_KEY не задан в production" >&2
fi

# Передаем управление основной команде (см. Dockerfile CMD)
exec "$@"
