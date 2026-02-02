# Команды админа на сервере (бэкенд в Docker)

Выполнять из папки, где лежит `docker-compose.yml` или `docker-compose.prod.yml` (обычно `backend-runa`).

**Используйте `docker compose` (пробел) — встроенный Compose V2. Если у вас старый `docker-compose` (через дефис), замените на него.**

Прод (production):
```bash
docker compose -f docker-compose.prod.yml exec backend <команда>
```
Обычный:
```bash
docker compose exec backend <команда>
```

---

## 1. Один раз: создать таблицу админов

После деплоя кода с моделью `Admin` выполните **одну** из команд.

**Если у вас есть папка `prisma/migrations` и вы применяете миграции:**

```bash
docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy
```

**Если миграций нет** (ошибка «No migration found» / P3005) — применить схему напрямую:

```bash
docker compose -f docker-compose.prod.yml exec backend npx prisma db push
```

Эта команда добавит таблицу `admins` в существующую БД без истории миграций.

---

## 2. Добавить первого админа

```bash
docker compose -f docker-compose.prod.yml exec backend node scripts/add-admin.js admin@runafinance.online ВашНадёжныйПароль
```

Подставьте свой email и пароль. Пароль вводится в команде (в истории будет виден) или можно добавить админа интерактивно без аргументов — скрипт спросит email и пароль (для первого админа аргументы обязательны).

---

## 3. Добавить ещё одного админа

Скрипт запросит email и пароль **текущего** админа, затем данные нового:

```bash
docker compose -f docker-compose.prod.yml exec backend node scripts/add-admin.js newadmin@example.com ПарольНовогоАдмина
```

Или без аргументов — тогда и email, и пароль нового админа запросятся с клавиатуры:

```bash
docker compose -f docker-compose.prod.yml exec backend node scripts/add-admin.js
```

---

## 4. Удалить админа

Скрипт запросит email и пароль **другого** админа (под которым вы входите), затем удалит указанного по email. Последнего админа удалить нельзя.

```bash
docker compose -f docker-compose.prod.yml exec backend node scripts/remove-admin.js oldadmin@example.com
```

Или без аргумента — тогда скрипт спросит email удаляемого админа:

```bash
docker compose -f docker-compose.prod.yml exec backend node scripts/remove-admin.js
```

---

## 5. Удалить всех пользователей из БД

Скрипт запросит email и пароль админа, затем повторный ввод пароля для подтверждения:

```bash
docker compose -f docker-compose.prod.yml exec backend node scripts/delete-all-users.js
```

---

## 6. Выдать Premium пользователю

Сначала запросит email и пароль админа, затем выполнит выдачу:

```bash
docker compose -f docker-compose.prod.yml exec backend node scripts/subscription-admin.js grant user@example.com 365
```

`365` — количество дней (можно изменить или не указывать, по умолчанию 365).

---

## 7. Снять Premium у пользователя

```bash
docker compose -f docker-compose.prod.yml exec backend node scripts/subscription-admin.js revoke user@example.com
```

Вместо email можно указать id пользователя, например `5`.

---

## Краткая шпаргалка (prod)

| Действие | Команда |
|---------|---------|
| Миграция (таблица админов) | `docker compose -f docker-compose.prod.yml exec backend npx prisma migrate deploy` |
| Первый админ | `docker compose -f docker-compose.prod.yml exec backend node scripts/add-admin.js admin@example.com Пароль123` |
| Ещё админ | `docker compose -f docker-compose.prod.yml exec backend node scripts/add-admin.js new@mail.com Пароль` |
| Удалить админа | `docker compose -f docker-compose.prod.yml exec backend node scripts/remove-admin.js oldadmin@example.com` |
| Удалить всех пользователей | `docker compose -f docker-compose.prod.yml exec backend node scripts/delete-all-users.js` |
| Выдать премиум | `docker compose -f docker-compose.prod.yml exec backend node scripts/subscription-admin.js grant user@mail.com 365` |
| Снять премиум | `docker compose -f docker-compose.prod.yml exec backend node scripts/subscription-admin.js revoke user@mail.com` |

Если используете обычный `docker-compose.yml` (без prod), везде убирайте `-f docker-compose.prod.yml`.
