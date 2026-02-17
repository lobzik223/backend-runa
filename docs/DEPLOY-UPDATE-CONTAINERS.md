# Обновление контейнеров на сервере (без потери БД)

База данных пользователей хранится в **Docker volume** `runa_pgdata_prod`. Контейнеры можно пересобирать и перезапускать — данные не удалятся, если не удалять этот volume.

---

## Команды для сборки (билд)

**Если деплоишь через Docker** — на сервере **не нужно** вручную запускать `npm ci`, `prisma generate`, `npm run build`. Всё это уже делается **внутри образа** по Dockerfile при `docker build`. Достаточно:

```bash
cd /путь/к/backend-runa
docker compose -f docker-compose.prod.yml build --no-cache backend
docker compose -f docker-compose.prod.yml up -d backend
```

Убедись, что в каталоге `backend-runa` лежит актуальный код (в т.ч. папка `prisma/` с миграциями) — он попадёт в образ при сборке.

---

**Бэкенд без Docker** (например, проверить сборку на ПК):

```bash
cd backend-runa
npm ci
npx prisma generate
npm run build
```

**Панель (админка)** — не в контейнере, собирается на хосте и файлы копируются в nginx:

```bash
cd panel-runa
npm ci
npm run build
sudo cp -r dist/* /var/www/panel-runa/
sudo chown -R www-data:www-data /var/www/panel-runa
```

---

## Что делать по порядку

### 1. Подключиться к серверу и перейти в каталог бэкенда

```bash
cd /путь/к/backend-runa
```

(Замени на реальный путь, например `~/Runa_Finance-project/backend-runa` или `/home/user/backend-runa`.)

---

### 2. Убедиться, что загружен актуальный код

Должны быть залиты изменения из репозитория (git pull или копирование файлов), в том числе:

- папка `prisma/migrations/` со всеми миграциями (включая `20260216180000_subscription_block_history` и др.);
- обновлённый исходный код бэкенда.

---

### 3. Остановить только контейнер бэкенда (Postgres и Redis не трогаем)

**Вариант A — используете `docker-compose.prod.yml` (сборка на сервере):**

```bash
docker compose -f docker-compose.prod.yml stop backend
```

**Вариант B — используете `docker-compose.server.yml` (образ с Docker Hub):**

```bash
docker compose -f docker-compose.server.yml stop backend
```

Не выполняйте `docker compose down` без флагов и **никогда** не используйте `-v` (удаление volumes) — иначе можно удалить данные БД.

---

### 4. Пересобрать образ бэкенда (только для варианта A — сборка на сервере)

Если бэкенд собирается на сервере (`build` в docker-compose):

```bash
docker compose -f docker-compose.prod.yml build --no-cache backend
```

Если образ только подтягивается с Docker Hub (вариант B), вместо сборки обновите образ:

```bash
docker compose -f docker-compose.server.yml pull backend
```

---

### 5. Запустить бэкенд снова

**Вариант A:**

```bash
docker compose -f docker-compose.prod.yml up -d backend
```

**Вариант B:**

```bash
docker compose -f docker-compose.server.yml up -d backend
```

При старте контейнера в `docker-entrypoint.sh` выполняется `prisma migrate deploy` — все новые миграции (включая таблицы для истории подписок и блокировок) применятся к существующей БД автоматически.

---

### 6. Проверить, что бэкенд поднялся

```bash
docker compose -f docker-compose.prod.yml ps
# или
docker compose -f docker-compose.server.yml ps
```

Убедиться, что контейнер `runa_backend_prod` в статусе `Up`. При необходимости посмотреть логи:

```bash
docker compose -f docker-compose.prod.yml logs -f backend --tail 100
```

В логах должны быть строки вроде: `[entrypoint] Миграции применены успешно` и запуск приложения.

---

### 7. Обновить админ-панель (panel-runa)

Панель раздаётся через nginx из каталога на сервере (например `/var/www/panel-runa`). Контейнеров для неё может не быть — обновление через сборку и копирование файлов.

На сервере перейти в каталог панели и собрать проект:

```bash
cd /путь/к/panel-runa
npm ci
npm run build
```

Скопировать собранные файлы в каталог, откуда nginx раздаёт панель:

```bash
sudo mkdir -p /var/www/panel-runa
sudo cp -r dist/* /var/www/panel-runa/
sudo chown -R www-data:www-data /var/www/panel-runa
```

Перезагрузить nginx (если нужно):

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## Краткая шпаргалка (одним блоком)

**Только бэкенд (prod — сборка на сервере):**

```bash
cd /путь/к/backend-runa
docker compose -f docker-compose.prod.yml stop backend
docker compose -f docker-compose.prod.yml build --no-cache backend
docker compose -f docker-compose.prod.yml up -d backend
docker compose -f docker-compose.prod.yml logs -f backend --tail 50
```

**Бэкенд (образ с Docker Hub):**

```bash
cd /путь/к/backend-runa
docker compose -f docker-compose.server.yml stop backend
docker compose -f docker-compose.server.yml pull backend
docker compose -f docker-compose.server.yml up -d backend
```

**Панель:**

```bash
cd /путь/к/panel-runa
npm ci && npm run build
sudo cp -r dist/* /var/www/panel-runa/
sudo chown -R www-data:www-data /var/www/panel-runa
```

---

## Чего не делать

- Не выполнять `docker compose down -v` — флаг `-v` удаляет volumes, в том числе с БД.
- Не удалять volume вручную: `docker volume rm runa_pgdata_prod`.
- Не останавливать и не пересоздавать контейнер Postgres без необходимости — данные лежат в volume, но лишний раз его не трогать.

Volume `runa_pgdata_prod` при перезапуске и пересборке контейнера **backend** не затрагивается, база пользователей сохраняется.
