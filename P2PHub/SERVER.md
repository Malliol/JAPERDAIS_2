# Сервер ОСГОворим — инструкция для ИИ

## Быстрый старт — как подключиться к проекту

1. Склонируй репозиторий:
```bash
git clone https://github.com/Malliol/p2phub.git
cd p2phub
```

2. Проверь что сервер живой:
```bash
curl -s https://osgo.malliol.ru/api/vapid-public-key
# должен вернуть {"key":"..."}
```

3. Выполни любую команду на сервере через Admin API:
```bash
curl -s -X POST https://osgo.malliol.ru/admin \
  -H "x-token: p2phub-admin-7x9k" \
  -d "systemctl is-active p2phub"
# должен вернуть: active
```

Всё — ты подключён и можешь работать.

## Данные сервера
- **Домен:** https://osgo.malliol.ru
- **IP:** 144.31.63.224
- **OS:** Ubuntu
- **Проект на сервере:** /var/www/p2phub
- **Сервис:** p2phub (systemd)

## Управление сервером — Admin API

SSH заблокирован провайдером. Все команды выполняются через Admin API:

```bash
curl -s -X POST https://osgo.malliol.ru/admin \
  -H "x-token: p2phub-admin-7x9k" \
  -d "КОМАНДА"
```

### Основные команды

```bash
# Проверить статус
curl -s -X POST https://osgo.malliol.ru/admin -H "x-token: p2phub-admin-7x9k" -d "systemctl is-active p2phub"

# Обновить код и перезапустить
curl -s -X POST https://osgo.malliol.ru/admin -H "x-token: p2phub-admin-7x9k" -d "cd /var/www/p2phub && git pull origin main && systemctl restart p2phub"

# Перезапустить приложение
curl -s -X POST https://osgo.malliol.ru/admin -H "x-token: p2phub-admin-7x9k" -d "systemctl restart p2phub"

# Логи приложения
curl -s -X POST https://osgo.malliol.ru/admin -H "x-token: p2phub-admin-7x9k" -d "journalctl -u p2phub -n 50 --no-pager"

# Логи nginx
curl -s -X POST https://osgo.malliol.ru/admin -H "x-token: p2phub-admin-7x9k" -d "tail -30 /var/log/nginx/access.log"
curl -s -X POST https://osgo.malliol.ru/admin -H "x-token: p2phub-admin-7x9k" -d "tail -30 /var/log/nginx/error.log"

# Любая другая команда
curl -s -X POST https://osgo.malliol.ru/admin -H "x-token: p2phub-admin-7x9k" -d "uptime && df -h"
```

## Репозиторий
- **GitHub:** github.com/Malliol/p2phub
- **Основная ветка:** main
- Деплой всегда из ветки `main`

## Структура проекта
```
/var/www/p2phub/
  server.js          — Node.js HTTP + WebSocket сервер (порт 3000)
  app.js             — фронтенд логика (ES модуль)
  auth.js            — авторизация (только ник, без пароля)
  index.html         — главная страница
  style.css          — стили
  service-worker.js  — SW для push-уведомлений (кеш отключён)
  manifest.json      — PWA манифест
  tests/             — тесты (node --test)
```

## Nginx
- Конфиг: /etc/nginx/sites-available/p2phub
- /ws → проксируется на localhost:3000 (WebSocket)
- /api/* → проксируется на localhost:3000
- /admin → проксируется на localhost:3001 (Admin API)
- SSL: Let's Encrypt, истекает 27.09.2026

## VNC (если Admin API недоступен)
- Панель: senko.network
- Логин: nm20079090@gmail.com
- Сервер: vm621815
- root пароль: Superparol1220

## Как деплоить изменения
1. Закоммитить и запушить в ветку `main`
2. Выполнить на сервере:
```bash
curl -s -X POST https://osgo.malliol.ru/admin \
  -H "x-token: p2phub-admin-7x9k" \
  -d "cd /var/www/p2phub && git pull origin main && systemctl restart p2phub && systemctl is-active p2phub"
```
3. Ответ `active` = всё работает
