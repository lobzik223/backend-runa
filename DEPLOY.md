# 🚀 Инструкция по деплою Backend Runa Finance на продакшен

## Сервер: 109.71.240.212

### 1. Подготовка сервера

```bash
# Обновление системы
sudo apt update && sudo apt upgrade -y

# Установка необходимых пакетов
sudo apt install -y docker.io docker-compose git curl nginx certbot python3-certbot-nginx

# Добавление пользователя в группу docker (если нужно)
sudo usermod -aG docker $USER
newgrp docker

# Проверка установки
docker --version
docker-compose --version
```

### 2. Клонирование репозитория

```bash
cd /opt
sudo git clone https://github.com/lobzik223/backend-runa.git
cd backend-runa
sudo chown -R $USER:$USER .
```

### 3. Настройка переменных окружения

```bash
# Создание production .env файла
cp .env.production.example .env.production
nano .env.production
```

**ВАЖНО: Заполни все переменные реальными значениями!**

#### Генерация секретов:

```bash
# JWT секреты (минимум 32 символа)
openssl rand -base64 32
openssl rand -base64 32

# APP_KEY (минимум 8 символов)
openssl rand -hex 16

# PostgreSQL пароль (сильный пароль!)
openssl rand -base64 24

# Redis пароль
openssl rand -hex 16
```

### 4. Настройка базы данных

```bash
# Запуск только PostgreSQL для первоначальной настройки
docker-compose -f docker-compose.prod.yml up -d postgres

# Ожидание готовности БД
sleep 10

# Применение миграций Prisma
docker-compose -f docker-compose.prod.yml run --rm backend npx prisma migrate deploy

# (Опционально) Генерация Prisma клиента
docker-compose -f docker-compose.prod.yml run --rm backend npx prisma generate
```

### 5. Запуск всех сервисов

```bash
# Сборка и запуск всех контейнеров
docker-compose -f docker-compose.prod.yml up -d --build

# Проверка статуса
docker-compose -f docker-compose.prod.yml ps

# Просмотр логов
docker-compose -f docker-compose.prod.yml logs -f backend
```

### 6. Настройка Nginx (Reverse Proxy)

```bash
# Копирование конфигурации
sudo cp nginx.conf.example /etc/nginx/sites-available/runa-backend

# Редактирование конфига (замени IP на свой домен если есть)
sudo nano /etc/nginx/sites-available/runa-backend

# Создание симлинка
sudo ln -s /etc/nginx/sites-available/runa-backend /etc/nginx/sites-enabled/

# Удаление дефолтного конфига
sudo rm /etc/nginx/sites-enabled/default

# Проверка конфигурации
sudo nginx -t

# Перезапуск nginx
sudo systemctl restart nginx
```

### 7. Настройка SSL (Let's Encrypt)

**Если у тебя есть домен:**

```bash
# Получение SSL сертификата
sudo certbot --nginx -d your-domain.com

# Автоматическое обновление (добавится в cron)
sudo certbot renew --dry-run
```

**Если домена нет (только IP):**
- Используй самоподписанный сертификат или пропусти SSL (не рекомендуется для продакшена)

### 8. Настройка Firewall

```bash
# UFW (если установлен)
sudo ufw allow 22/tcp    # SSH
sudo ufw allow 80/tcp    # HTTP
sudo ufw allow 443/tcp   # HTTPS
sudo ufw enable

# Или через iptables
sudo iptables -A INPUT -p tcp --dport 22 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 80 -j ACCEPT
sudo iptables -A INPUT -p tcp --dport 443 -j ACCEPT
sudo iptables -A INPUT -j DROP
```

### 9. Проверка работоспособности

```bash
# Health check
curl http://localhost:3000/api/health

# Через nginx (если настроен)
curl https://109.71.240.212/api/health
```

### 10. Мониторинг и логи

```bash
# Просмотр логов backend
docker-compose -f docker-compose.prod.yml logs -f backend

# Просмотр логов всех сервисов
docker-compose -f docker-compose.prod.yml logs -f

# Статус контейнеров
docker-compose -f docker-compose.prod.yml ps

# Использование ресурсов
docker stats
```

### 11. Обновление приложения

```bash
cd /opt/backend-runa

# Получение обновлений
git pull origin main

# Пересборка и перезапуск
docker-compose -f docker-compose.prod.yml up -d --build

# Применение новых миграций (если есть)
docker-compose -f docker-compose.prod.yml run --rm backend npx prisma migrate deploy
```

### 12. Резервное копирование

```bash
# Бэкап базы данных
docker-compose -f docker-compose.prod.yml exec postgres pg_dump -U runa runa > backup_$(date +%Y%m%d_%H%M%S).sql

# Восстановление из бэкапа
cat backup_YYYYMMDD_HHMMSS.sql | docker-compose -f docker-compose.prod.yml exec -T postgres psql -U runa runa
```

### 13. Полезные команды

```bash
# Остановка всех сервисов
docker-compose -f docker-compose.prod.yml down

# Остановка с удалением volumes (ОСТОРОЖНО!)
docker-compose -f docker-compose.prod.yml down -v

# Перезапуск конкретного сервиса
docker-compose -f docker-compose.prod.yml restart backend

# Вход в контейнер
docker-compose -f docker-compose.prod.yml exec backend sh

# Очистка неиспользуемых образов
docker system prune -a
```

## 🔒 Безопасность

1. **Измени все пароли** в `.env.production`
2. **Настрой firewall** - открой только необходимые порты
3. **Используй HTTPS** - настрой SSL сертификат
4. **Регулярно обновляй** систему и Docker образы
5. **Настрой мониторинг** - используй логи и алерты
6. **Делай бэкапы** базы данных регулярно

## 📝 Примечания

- Backend доступен на `http://127.0.0.1:3000` (только localhost)
- Внешний доступ через Nginx на портах 80/443
- База данных и Redis доступны только внутри Docker сети
- Все пароли должны быть сильными (минимум 32 символа для JWT)

## 🆘 Troubleshooting

**Проблема: Контейнер не запускается**
```bash
docker-compose -f docker-compose.prod.yml logs backend
```

**Проблема: База данных недоступна**
```bash
docker-compose -f docker-compose.prod.yml exec postgres pg_isready -U runa
```

**Проблема: Nginx не работает**
```bash
sudo nginx -t
sudo systemctl status nginx
sudo tail -f /var/log/nginx/error.log
```
