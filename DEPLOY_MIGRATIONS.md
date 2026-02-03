# Миграции на сервере (baseline и deploy)

## Ошибки 500 при /auth/login и 503 при /auth/request-registration-code

Если на продакшене логин возвращает **500**, а запрос кода регистрации — **503**, скорее всего в БД не применены миграции: в таблице `users` нет полей удаления аккаунта, и/или нет таблицы `admins`. Код ожидает эти поля/таблицу.

**Быстрое исправление на сервере** (подставьте имя контейнера postgres и базу, если не `runa`):

```bash
# 1) Добавить в users поля удаления аккаунта
docker exec -i runa_postgres psql -U runa -d runa -c "
ALTER TABLE \"users\" ADD COLUMN IF NOT EXISTS \"deletionRequestedAt\" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS \"scheduledDeleteAt\" TIMESTAMP(3),
ADD COLUMN IF NOT EXISTS \"restoreUntil\" TIMESTAMP(3);
"

# 2) Создать таблицу admins (если ещё нет)
docker exec -i runa_postgres psql -U runa -d runa -c "
CREATE TABLE IF NOT EXISTS \"admins\" (
    \"id\" SERIAL NOT NULL,
    \"email\" TEXT NOT NULL,
    \"passwordHash\" TEXT NOT NULL,
    \"createdAt\" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT \"admins_pkey\" PRIMARY KEY (\"id\")
);
CREATE UNIQUE INDEX IF NOT EXISTS \"admins_email_key\" ON \"admins\"(\"email\");
"
```

После этого перезапустите бэкенд и повторите логин/запрос кода. В логах бэкенда (`docker logs runa_backend`) при следующих ошибках будет видна точная причина.

---

## Что отправить в репозиторий (один раз)

Миграции раньше не были в git. Добавьте и запушьте:

```bash
cd backend-runa
git add prisma/migrations/
git add .gitignore
git status   # убедитесь: migrations и .gitignore
git commit -m "Add prisma migrations (account deletion, admins table)"
git push
```

После этого на сервере после `git pull` появятся папки:
- `prisma/migrations/20260202000000_add_account_deletion_schedule/`
- `prisma/migrations/20260202100000_add_admins_table/`

---

## Если на сервере ошибка P3005 (schema is not empty, no migration found)

На сервере база уже не пустая, а таблицы `_prisma_migrations` нет или она пустая. Нужно сделать **baseline**: пометить уже применённые миграции как выполненные, затем применить только новые.

### Вариант A: База уже совпадает со schema (миграции применяли вручную)

1. На сервере после `git pull`:
   ```bash
   cd backend-runa
   npx prisma migrate resolve --applied 20260202000000_add_account_deletion_schedule
   npx prisma migrate resolve --applied 20260202100000_add_admins_table
   ```
2. Дальше для новых миграций просто: `npx prisma migrate deploy`

### Вариант B: На сервере нет полей удаления и таблицы admins

1. Применить SQL вручную (PostgreSQL):
   - выполнить содержимое `prisma/migrations/20260202000000_add_account_deletion_schedule/migration.sql`
   - выполнить содержимое `prisma/migrations/20260202100000_add_admins_table/migration.sql`
2. Пометить миграции как применённые:
   ```bash
   npx prisma migrate resolve --applied 20260202000000_add_account_deletion_schedule
   npx prisma migrate resolve --applied 20260202100000_add_admins_table
   ```
3. В дальнейшем: `npx prisma migrate deploy`

### Вариант C: Создать таблицу _prisma_migrations с нуля (если её нет)

Если Prisma никогда не создавала миграции на этом сервере:

```sql
CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(36) PRIMARY KEY,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMPTZ,
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0
);
```

После этого использовать Вариант A или B (resolve --applied для каждой миграции).

---

## Проверка: какие SQL есть в проекте

| Файл | В git? | Назначение |
|------|--------|------------|
| `prisma/schema.prisma` | да | Схема Prisma |
| `prisma/sql/add_account_deletion_fields.sql` | да | Ручной SQL (дублирует миграцию) |
| `prisma/sql/add_investment_initial_balance.sql` | да | Ручной SQL |
| `prisma/sql/post_migration_checks.sql` | да | Проверки |
| `prisma/migrations/20260202000000_.../migration.sql` | **добавить** | Удаление аккаунта |
| `prisma/migrations/20260202100000_.../migration.sql` | **добавить** | Таблица admins |

Все перечисленные пути **не** в .gitignore — после `git add prisma/migrations/` и push всё будет на сервере.
