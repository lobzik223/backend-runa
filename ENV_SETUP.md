# 📝 Инструкция по настройке .env файла

## Для разработки (локально)

1. Скопируй пример:
```bash
cp env.example .env
```

2. Отредактируй `.env` - большинство значений уже подходят для разработки.

## Для продакшена

1. Скопируй пример:
```bash
cp env.production.example .env.production
```

2. Сгенерируй все секреты:

### Генерация секретов (Linux/Mac):
```bash
# JWT Access Secret (минимум 32 символа)
openssl rand -base64 32

# JWT Refresh Secret (минимум 32 символа)
openssl rand -base64 32

# APP_KEY (минимум 8 символов)
openssl rand -hex 16

# PostgreSQL пароль (сильный пароль!)
openssl rand -base64 24

# Redis пароль
openssl rand -hex 16
```

### Генерация секретов (Windows PowerShell):
```powershell
# JWT Access Secret
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))

# JWT Refresh Secret
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))

# APP_KEY
-join ((48..57) + (97..122) | Get-Random -Count 32 | ForEach-Object {[char]$_})

# PostgreSQL пароль
[Convert]::ToBase64String((1..24 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))

# Redis пароль
-join ((48..57) + (97..102) | Get-Random -Count 16 | ForEach-Object {[char]$_})
```

3. Заполни `.env.production`:

```env
# Server
NODE_ENV=production
PORT=3000
API_PREFIX=/api

# Database (используй сгенерированные пароли!)
POSTGRES_DB=runa
POSTGRES_USER=runa
POSTGRES_PASSWORD=ТВОЙ_СГЕНЕРИРОВАННЫЙ_ПАРОЛЬ_32_СИМВОЛА

# JWT Secrets (ОБЯЗАТЕЛЬНО сгенерируй новые!)
JWT_ACCESS_SECRET=ТВОЙ_СГЕНЕРИРОВАННЫЙ_СЕКРЕТ_32_СИМВОЛА
JWT_REFRESH_SECRET=ТВОЙ_СГЕНЕРИРОВАННЫЙ_СЕКРЕТ_32_СИМВОЛА
JWT_ACCESS_TTL_SECONDS=900
JWT_REFRESH_TTL_SECONDS=2592000

# Security (укажи реальный домен фронтенда!)
CORS_ORIGIN=https://твой-домен.com
THROTTLE_TTL_SECONDS=60
THROTTLE_LIMIT=30

# Redis
REDIS_PASSWORD=ТВОЙ_СГЕНЕРИРОВАННЫЙ_ПАРОЛЬ_REDIS

# Application Key
APP_KEY=ТВОЙ_СГЕНЕРИРОВАННЫЙ_APP_KEY

# OpenAI (если используешь AI чат)
OPENAI_API_KEY=sk-proj-твой-реальный-ключ
OPENAI_MODEL=gpt-4o-mini

# Tinkoff Invest (если используешь инвестиции)
TINKOFF_DEMO_TOKEN=твой-токен-тинкофф
```

## ⚠️ ВАЖНО:

1. **НЕ коммить `.env` и `.env.production` в git!** Они в `.gitignore`
2. **Используй разные секреты для продакшена и разработки**
3. **CORS_ORIGIN** - укажи конкретный домен, не `*`
4. **Все пароли должны быть сильными** (минимум 16 символов)
5. **JWT секреты** - минимум 32 символа каждый

## Проверка настроек:

После заполнения проверь:
```bash
# Проверка синтаксиса (Linux/Mac)
cat .env.production | grep -v "^#" | grep -v "^$" | cut -d= -f1

# Проверка что все переменные заполнены
grep "CHANGE_ME" .env.production  # Не должно быть результатов!
```
