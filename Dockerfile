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

# Системные зависимости + Python для Tinkoff Invest (python script).
RUN apt-get update && apt-get install -y --no-install-recommends \
    dumb-init \
    tzdata \
    ca-certificates \
    python3 \
    python3-pip \
    netcat-openbsd \
  && rm -rf /var/lib/apt/lists/*

# Создание непривилегированного пользователя
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

# Копирование файлов зависимостей
COPY package*.json ./
COPY prisma ./prisma/

# Установка production зависимостей
RUN npm ci --only=production && \
    npm cache clean --force

# Установка Prisma CLI глобально для миграций
RUN npm install -g prisma@^6.2.0

# Обновление pip и установка Python зависимостей для tinkoff_service.py
RUN pip3 install --upgrade pip setuptools wheel && \
    pip3 install --no-cache-dir tinkoff-investments || \
    (pip3 install --no-cache-dir --upgrade pip && pip3 install --no-cache-dir tinkoff-investments)

# Копирование собранного приложения из builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

# Копирование Python-скрипта (в Docker он живет здесь)
COPY python ./python

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
ENTRYPOINT ["dumb-init", "--", "docker-entrypoint.sh"]
CMD ["node", "dist/main.js"]
