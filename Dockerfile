# Многоэтапная сборка для оптимизации размера образа
# Используем Debian-slim, чтобы Python/gRPC ставились без боли (wheels).
FROM node:20-bookworm-slim AS builder

# Установка рабочей директории
WORKDIR /app

# Копирование файлов зависимостей
COPY package*.json ./
COPY prisma ./prisma/

# Установка зависимостей
RUN npm ci

# Копирование исходного кода
COPY . .

# Генерация Prisma клиента
RUN npx prisma generate

# Сборка приложения
RUN npm run build

# Production образ
FROM node:20-bookworm-slim AS production

# Установка рабочей директории
WORKDIR /app

# Системные зависимости
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    tzdata \
    ca-certificates \
    netcat-openbsd \
  && rm -rf /var/lib/apt/lists/*

# Создание непривилегированного пользователя
RUN groupadd --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs --shell /bin/false --create-home nestjs

# Копирование файлов зависимостей
COPY package*.json ./
COPY prisma ./prisma/

# Установка production зависимостей
RUN npm ci --only=production && \
    npm cache clean --force

# Установка Prisma CLI глобально для миграций
RUN npm install -g prisma@^6.2.0

# Копирование собранного приложения из builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Копирование entrypoint скрипта
COPY docker-entrypoint.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Изменение владельца файлов
RUN chown -R nestjs:nodejs /app

# Переключение на непривилегированного пользователя
USER nestjs

# Открытие порта
EXPOSE 3000

# Переменные окружения по умолчанию
ENV NODE_ENV=production
ENV PORT=3000

# Healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Запуск приложения через entrypoint
ENTRYPOINT ["dumb-init", "--", "bash", "/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
