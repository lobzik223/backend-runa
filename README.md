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

## Endpoints (MVP)

- `GET /health`
- `POST /auth/register`
- `POST /auth/login`
- `GET /auth/me`
- `POST /auth/refresh`
- `POST /auth/logout`

