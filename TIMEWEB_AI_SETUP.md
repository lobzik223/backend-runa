# Настройка Timeweb Cloud AI для RUNA Finance

## Инструкция по настройке

### 1. Переменные окружения

Добавьте следующие переменные в ваш `.env` файл на бэкенде:

```env
# Timeweb Cloud AI Configuration
TIMEWEB_AI_ACCESS_ID=009e0398-152a-4a94-84f0-65f32c7aacdc
TIMEWEB_AI_API_URL=https://agent.timeweb.cloud/api/v1/cloud-ai/agents/009e0398-152a-4a94-84f0-65f32c7aacdc/v1
```

**Важно:** 
- `TIMEWEB_AI_ACCESS_ID` - это ваш Access ID от Timeweb Cloud AI
- `TIMEWEB_AI_API_URL` - полный URL к API агента (можно не указывать, если используется стандартный формат)

### 2. Где разместить ключи

#### Локальная разработка:
Создайте файл `.env` в корне проекта `backend-runa/`:

```env
TIMEWEB_AI_ACCESS_ID=009e0398-152a-4a94-84f0-65f32c7aacdc
TIMEWEB_AI_API_URL=https://agent.timeweb.cloud/api/v1/cloud-ai/agents/009e0398-152a-4a94-84f0-65f32c7aacdc/v1
```

#### Production (сервер):
Добавьте переменные окружения в настройках вашего хостинга/сервера:

**Для Docker:**
```yaml
environment:
  - TIMEWEB_AI_ACCESS_ID=009e0398-152a-4a94-84f0-65f32c7aacdc
  - TIMEWEB_AI_API_URL=https://agent.timeweb.cloud/api/v1/cloud-ai/agents/009e0398-152a-4a94-84f0-65f32c7aacdc/v1
```

**Для PM2:**
```json
{
  "env": {
    "TIMEWEB_AI_ACCESS_ID": "009e0398-152a-4a94-84f0-65f32c7aacdc",
    "TIMEWEB_AI_API_URL": "https://agent.timeweb.cloud/api/v1/cloud-ai/agents/009e0398-152a-4a94-84f0-65f32c7aacdc/v1"
  }
}
```

**Для systemd:**
```ini
[Service]
Environment="TIMEWEB_AI_ACCESS_ID=009e0398-152a-4a94-84f0-65f32c7aacdc"
Environment="TIMEWEB_AI_API_URL=https://agent.timeweb.cloud/api/v1/cloud-ai/agents/009e0398-152a-4a94-84f0-65f32c7aacdc/v1"
```

### 3. Проверка работы

После добавления переменных окружения:

1. Перезапустите бэкенд сервер
2. Откройте приложение и перейдите в чат с RUNA AI
3. Отправьте сообщение, например: "Проанализируй мои расходы"
4. ИИ должен ответить с анализом ваших финансов

### 4. Что изменилось

- ✅ Интеграция с Timeweb Cloud AI API
- ✅ Детальный контекст о транзакциях пользователя (последние 15 транзакций)
- ✅ Полная информация о доходах, расходах, целях, кредитах
- ✅ Улучшенный промпт для более точных ответов
- ✅ Поддержка legacy OpenAI (если нужно)

### 5. Fallback режим

Если переменные окружения не настроены, система будет работать в "stub" режиме - возвращать базовые ответы без использования ИИ.

### 6. Документация Timeweb Cloud AI

Полная документация API: https://agent.timeweb.cloud/docs
