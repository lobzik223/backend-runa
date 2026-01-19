#!/bin/bash
# Скрипт для создания .env.production на сервере

cd ~/backend-runa

# Генерация всех необходимых значений
POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
JWT_ACCESS_SECRET=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
JWT_REFRESH_SECRET=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-32)
REDIS_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-24)
APP_KEY=$(openssl rand -hex 16)

# Создание файла .env.production
cat > .env.production << EOF
# ============================================
# PRODUCTION ENVIRONMENT CONFIGURATION
# ============================================
# Сгенерировано автоматически

# Server Configuration
NODE_ENV=production
PORT=3000
API_PREFIX=/api

# Database Configuration
POSTGRES_DB=runa
POSTGRES_USER=runa
POSTGRES_PASSWORD=$POSTGRES_PASSWORD

# JWT Secrets
JWT_ACCESS_SECRET=$JWT_ACCESS_SECRET
JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET
JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_SECONDS=2592000

# Security
CORS_ORIGIN=*
THROTTLE_TTL_SECONDS=60
THROTTLE_LIMIT=30

# Redis Configuration
REDIS_PASSWORD=$REDIS_PASSWORD

# Application Key
APP_KEY=$APP_KEY

# OpenAI (optional, for AI chat)
# OPENAI_API_KEY=sk-proj-XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
# OPENAI_MODEL=gpt-4o-mini
EOF

echo "✅ Файл .env.production создан!"
echo ""
echo "⚠️  ВАЖНО: Сохраните эти значения в безопасном месте!"
echo ""
echo "============================================"
echo "Сгенерированные значения:"
echo "============================================"
echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD"
echo "JWT_ACCESS_SECRET=$JWT_ACCESS_SECRET"
echo "JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET"
echo "REDIS_PASSWORD=$REDIS_PASSWORD"
echo "APP_KEY=$APP_KEY"
echo "============================================"
echo ""
echo "Следующие шаги:"
echo "1. Проверьте файл: cat .env.production"
echo "2. Запустите бекенд: docker compose -f docker-compose.prod.yml up -d"
echo "3. Проверьте логи: docker compose -f docker-compose.prod.yml logs -f"
