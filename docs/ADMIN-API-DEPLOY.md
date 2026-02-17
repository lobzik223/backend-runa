# Админ API: почему 404 и что сделать

Если панель показывает **Cannot GET /api/admin/stats/dashboard** (и 404 в консоли), запросы доходят до бэкенда, но маршруты не находятся. Обычно это значит, что **работает старый образ backend** без новых админ-контроллеров.

## 1. Пересобрать образ и перезапустить backend

На сервере в каталоге с `backend-runa`:

```bash
cd ~/backend-runa
docker compose -f docker-compose.prod.yml build --no-cache backend
docker compose -f docker-compose.prod.yml up -d backend
```

Дождись старта (секунд 10–20), затем проверь:

```bash
# Должен ответить 401 (маршрут есть, нет токена), а не 404
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/admin/stats/dashboard
```

Ожидается **401**. Если **404** — в образе по-прежнему старый код: убедись, что в `backend-runa` лежат файлы `src/modules/admin/admin-stats.controller.ts` и `admin-stats.service.ts`, затем снова выполни `build --no-cache` и `up -d`.

## 2. Панель должна стучаться на api.runafinance.online

Сборка панели для продакшена должна идти с **VITE_API_URL**, чтобы запросы шли на `https://api.runafinance.online/api/...`, а не на `panel.runafinance.online/api/...`.

- В репозитории уже есть **panel-runa/.env.production** с `VITE_API_URL=https://api.runafinance.online`. При `npm run build` Vite подхватывает этот файл.
- Если собираешь без него, перед сборкой задай переменную вручную:
  ```bash
  export VITE_API_URL=https://api.runafinance.online
  npm run build
  ```

После правок: пересобери панель, скопируй `dist/*` в `/var/www/panel-runa/`, обнови страницу в браузере (Ctrl+Shift+R).
