# RUNA backend (NestJS + PostgreSQL + Redis)

Production-oriented backend scaffold for the RUNA mobile app.

## Quick start (local)

1) Start dependencies:

```bash
cd backend-runa
docker compose up -d
```

2) Create `.env` from `env.example`:

```bash
copy env.example .env
```

3) Install deps and run migrations:

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
```

4) Run API:

```bash
npm run dev
```

API base (matches current mobile client): `http://localhost:3000/api`

## Проверка после deploy (Docker prod)

```bash
# Статус контейнеров
docker compose -f docker-compose.prod.yml ps

# Логи бэкенда (если что-то не так)
docker compose -f docker-compose.prod.yml logs -f backend

# Проверка API (на сервере)
curl -s http://localhost:3000/api/health
# Ожидается: {"status":"ok","message":"RUNA backend is healthy","maintenance":false}
```

## Режим «Ведутся работы» (maintenance)

Пользователи видят экран «Ведутся работы на сервере», когда сервер так включён или бэкенд недоступен.

**Включить** (перед перезапуском/обновлением):
```bash
docker compose -f docker-compose.prod.yml exec backend node scripts/maintenance.js on
```

**Выключить** (после того как сервер снова работает):
```bash
docker compose -f docker-compose.prod.yml exec backend node scripts/maintenance.js off
```

Либо через API (подставь свой `APP_KEY`):
```bash
curl -X POST http://localhost:3000/api/health/maintenance -H "Content-Type: application/json" -d '{"enabled":true}' -H "X-Runa-App-Key: YOUR_APP_KEY"
curl -X POST http://localhost:3000/api/health/maintenance -H "Content-Type: application/json" -d '{"enabled":false}' -H "X-Runa-App-Key: YOUR_APP_KEY"
```

## Premium подписка (выдать / снять с аккаунта)

Скрипт на сервере (из папки `backend-runa` или внутри контейнера):

**Выдать Premium** (по email или по id пользователя, по умолчанию на 365 дней):
```bash
node scripts/subscription-admin.js grant <email или userId> [дней]
# примеры:
node scripts/subscription-admin.js grant user@example.com 365
node scripts/subscription-admin.js grant 5 30
```

**Снять Premium**:
```bash
node scripts/subscription-admin.js revoke <email или userId>
# примеры:
node scripts/subscription-admin.js revoke user@example.com
node scripts/subscription-admin.js revoke 5
```

В Docker (prod):
```bash
docker compose -f docker-compose.prod.yml exec backend node scripts/subscription-admin.js grant user@example.com 365
docker compose -f docker-compose.prod.yml exec backend node scripts/subscription-admin.js revoke user@example.com
```

Локально (из папки backend-runa, с настроенным `.env` и БД):
```bash
npm run subscription:grant -- user@example.com 365
npm run subscription:revoke -- user@example.com
```

## Endpoints (MVP)

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/refresh`
- `POST /auth/logout`

